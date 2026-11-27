//! 真实 codex 驱动：外部 CLI + `codex exec --json` 事件。
//!
//! v1 刻意最小：每回合 spawn 一次 `codex exec`，sandbox 固定 `read-only`，
//! 只用于聊天成员；工作室仍用 pi。没有工具审批卡、不计工具预算，也不发内容增量帧。
//! 驱动只做协议转换与终态结算，不替 Lodge 判断房间、阶段或证据。
//!
//! 凭据：`~/.codex/deepseek.key`（0600，纯 key）由基座读出，只给 codex 子进程
//! 注入 `DEEPSEEK_API_KEY`；文件不存在也照常 spawn，让 CLI 自己的错误成为失败原因。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, BufReader};
#[cfg(unix)]
use tokio::process::Command;

use super::{stderr_reason, thread_context, time_limit_text, DriverContext};
use crate::model::{TurnOutcome, TurnUsage};
use crate::state::App;
use crate::turns::settle;

/// 这一版只接 DeepSeek：provider 配置是驱动的一部分，模型名由成员选择。
const PROVIDER: &str = "deepseek";
const PROVIDER_NAME: &str = "DeepSeek";
const PROVIDER_BASE_URL: &str = "https://api.deepseek.com/v1";
const PROVIDER_ENV_KEY: &str = "DEEPSEEK_API_KEY";
/// wire_api 只接受 `responses`；这个版本的 codex 已经移除了 `chat`。
const PROVIDER_WIRE_API: &str = "responses";
const DEFAULT_MODEL: &str = "deepseek-chat";

pub(crate) async fn run(app: Arc<App>, ctx: DriverContext) {
    codex_turn_inner(&app, &ctx).await;
    // 回合不管怎么结束，都把驱动进程组收掉；SIGKILL 兜底由看门人负责。
    ctx.cancel.stop();
    // 给看门人一点时间把子进程带走，再让 child 句柄析构。
    tokio::time::sleep(Duration::from_millis(300)).await;
}

async fn codex_turn_inner(app: &Arc<App>, ctx: &DriverContext) {
    let Some(binary) = crate::discovery::codex_binary() else {
        settle_codex(
            app,
            ctx,
            TurnOutcome::Failed,
            "没找到 codex 命令；先安装并登录。",
            &TurnUsage::default(),
        );
        return;
    };
    // 边界值由回合开始时一次性建好；没有它就没有这一回合（不猜、不裸跑）。
    let Some(sandbox) = ctx.sandbox.as_ref() else {
        settle_codex(
            app,
            ctx,
            TurnOutcome::Failed,
            "这一回合没有边界值；驱动不起来。",
            &TurnUsage::default(),
        );
        return;
    };
    // 磁盘快满了就不开跑：写到一半撑满盘，坏的是整台机器，不只是这一回合。
    if let Some(free) = crate::sandbox::low_disk(sandbox.work()) {
        settle_codex(
            app,
            ctx,
            TurnOutcome::Failed,
            &format!("磁盘余量不足（只剩 {} MB）；先腾出空间再跑。", free / (1024 * 1024)),
            &TurnUsage::default(),
        );
        return;
    }

    // Unix 外面套一层看门人：基座被 SIGKILL 时它会把整组子进程带走。
    // Windows 没有 --supervise：取消与超时由 CancelToken 按进程树收。
    #[cfg(unix)]
    let mut command = match std::env::current_exe() {
        Ok(exe) => {
            let mut command = Command::new(exe);
            command.arg("--supervise").arg(&binary);
            command
        }
        Err(_) => Command::new(&binary),
    };
    #[cfg(windows)]
    let mut command = crate::platform::command_for(&binary);

    command.args(["exec", "--json", "--skip-git-repo-check"]);
    // 边界由基座给：外面已经有 seatbelt / Job Object，codex 再套一层自己的沙箱会在里面起不来
    // （`sandbox_apply: Operation not permitted`），工具全哑。codex 的文档也把这个开关留给
    // “已经被外部沙箱包住”的宿主；没有基座边界时才退回它自己的只读沙箱。
    let own_sandbox = if ctx.sandbox.is_some() {
        "danger-full-access"
    } else {
        "read-only"
    };
    command.args(["--sandbox", own_sandbox]);
    for setting in [
        format!("model_provider=\"{PROVIDER}\""),
        format!("model_providers.{PROVIDER}.name=\"{PROVIDER_NAME}\""),
        format!("model_providers.{PROVIDER}.base_url=\"{PROVIDER_BASE_URL}\""),
        format!("model_providers.{PROVIDER}.env_key=\"{PROVIDER_ENV_KEY}\""),
        format!("model_providers.{PROVIDER}.wire_api=\"{PROVIDER_WIRE_API}\""),
    ] {
        command.arg("-c").arg(setting);
    }
    // 空 model 用驱动自己的默认（DeepSeek Chat）；Discovery 也把这个名字报给 Lodge。
    let model = if ctx.model.trim().is_empty() {
        DEFAULT_MODEL
    } else {
        ctx.model.as_str()
    };
    command.arg("-m").arg(model);

    // codex 没有 --append-system-prompt：soul、技能清单和房间上下文一起进提示词；
    // 技能正文和技能清单都不进提示词：codex 自己从 $CODEX_HOME/skills 发现，按需读。
    let context = thread_context(app, &ctx.thread_id);
    let mut prompt = String::new();
    let system = ctx.system.clone();
    if !system.is_empty() {
        prompt.push_str("【你的角色】\n");
        prompt.push_str(&system);
        prompt.push_str("\n\n");
    }
    if !context.is_empty() {
        prompt.push_str("【房间最近的对话】\n");
        prompt.push_str(&context);
        prompt.push_str("\n\n");
    }
    prompt.push_str("【这一轮】\n");
    prompt.push_str(&ctx.prompt);

    command
        .arg("--")
        .arg(prompt)
        .current_dir(sandbox.work())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    // 默认继承会把自己的凭据和平台变量一起交出去；只留声明过的那几样。
    crate::sandbox::scrub_env(&mut command);
    // 只给 codex 子进程注入 DeepSeek 的 key；不写进 ENV_KEEP，也不在基座里全局设置。
    if let Some(key) = deepseek_key() {
        command.env(PROVIDER_ENV_KEY, key);
    }
    // codex 会在自己的 home 里写 session/日志；指到回合临时目录，不碰真实 ~/.codex。
    let codex_home = sandbox.scratch().join("codex");
    if let Err(error) = std::fs::create_dir_all(&codex_home) {
        settle_codex(
            app,
            ctx,
            TurnOutcome::Failed,
            &format!("codex 的回合目录建不起来：{error}"),
            &TurnUsage::default(),
        );
        return;
    }
    command.env("CODEX_HOME", &codex_home);
    // 技能走 codex 自己的技能目录（$CODEX_HOME/skills）：清单与正文都由它按需处理，
    // 提示词里不再重复一份。CODEX_HOME 每回合都是隔离的，用户级技能进不来。
    if !ctx.skills.is_empty() {
        let _ = crate::drivers::write_skill_dirs(&codex_home.join("skills"), &ctx.skills);
    }
    // 边界落到命令上：代理环境、平台包装。落不下来就不跑，不静默降级。
    let mut command = match sandbox.apply(command) {
        Ok(command) => command,
        Err(reason) => {
            settle_codex(
                app,
                ctx,
                TurnOutcome::Failed,
                &format!("这一回合需要沙箱，但{reason}；先修好再跑。"),
                &TurnUsage::default(),
            );
            return;
        }
    };
    // sandbox 的 Unix 包装层默认把 stdin 接成管道；codex 会一直等 stdin 的 EOF 才开跑。
    // 在包装之后再收一次，让一次性回合的 stdin 立刻是 /dev/null，而不是挂到预算到点。
    command.stdin(Stdio::null());
    #[cfg(windows)]
    crate::platform::hide_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            settle_codex(
                app,
                ctx,
                TurnOutcome::Failed,
                &format!("codex 启动失败：{error}"),
                &TurnUsage::default(),
            );
            return;
        }
    };
    if let Some(pid) = child.id() {
        ctx.cancel.set_pid(pid);
        if ctx.cancel.is_cancelled() {
            ctx.cancel.cancel();
        }
    }

    let stderr_tail = Arc::new(std::sync::Mutex::new(String::new()));
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(mut text) = tail.lock() {
                    text.push_str(&line);
                    text.push('\n');
                    if text.len() > 8_000 {
                        let keep = text.len() - 8_000;
                        *text = text[keep..].to_string();
                    }
                }
            }
        });
    }

    let Some(stdout) = child.stdout.take() else {
        settle_codex(
            app,
            ctx,
            TurnOutcome::Failed,
            "codex 没有可读的 stdout",
            &TurnUsage::default(),
        );
        return;
    };
    let mut lines = BufReader::new(stdout).lines();
    let mut text = String::new();
    let mut last_error = String::new();
    let mut last_item_error = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ctx.budget.max_ms);

    loop {
        if ctx.cancel.is_cancelled() {
            return;
        }
        let next = tokio::time::timeout_at(deadline, lines.next_line()).await;
        let line = match next {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                let reason = format!("codex 输出中断：{error}");
                settle_codex(app, ctx, TurnOutcome::Failed, &reason, &TurnUsage::default());
                return;
            }
            Err(_) => {
                let reason = format!(
                    "这一回合超过时间上限（{}）；停在半路。",
                    time_limit_text(ctx.budget.max_ms)
                );
                settle_codex(app, ctx, TurnOutcome::Stopped, &reason, &TurnUsage::default());
                return;
            }
        };
        let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
        match frame.get("type").and_then(Value::as_str).unwrap_or("") {
            "thread.started" => {
                // 会话号只用来对日志；它不参与终态判断。
                if let Some(thread) = frame.get("thread_id").and_then(Value::as_str) {
                    eprintln!("lodge-base-slice: codex thread {thread}");
                }
            }
            // codex 每次都会发一条 item.type=error 的告警（例如模型元数据缺失）；
            // 它不是终态。只有顶层 error / turn.failed 或没有 turn.completed 的退出才算失败。
            "item.completed" => {
                let item = frame.get("item");
                match item
                    .and_then(|item| item.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                {
                    "agent_message" => {
                        if let Some(part) = item
                            .and_then(|item| item.get("text"))
                            .and_then(Value::as_str)
                        {
                            text.push_str(part);
                        }
                    }
                    // 成功的回合也会带这种告警，所以不当场判死；没有 turn.completed 时
                    // 才把它当作退出原因（优先于 stderr 尾巴）。
                    "error" => {
                        if let Some(message) = item
                            .and_then(|item| item.get("message"))
                            .and_then(Value::as_str)
                            .filter(|message| !message.trim().is_empty())
                        {
                            last_item_error = message.chars().take(300).collect();
                        }
                    }
                    _ => {}
                }
            }
            "turn.completed" => {
                let usage = usage_of(&frame);
                settle_codex(app, ctx, TurnOutcome::Completed, &text, &usage);
                return;
            }
            "turn.failed" => {
                let detail = frame
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .filter(|message| !message.trim().is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| {
                        if !last_error.is_empty() {
                            last_error.clone()
                        } else if !last_item_error.is_empty() {
                            last_item_error.clone()
                        } else {
                            stderr_reason(&stderr_tail, "没有给出原因")
                        }
                    });
                let reason = failure_reason(&detail);
                settle_codex(app, ctx, TurnOutcome::Failed, &reason, &TurnUsage::default());
                return;
            }
            // 顶层 error 可能是重试中的中间失败；先记下，等 turn.completed / 退出再决定。
            "error" => {
                if let Some(message) = frame.get("message").and_then(Value::as_str) {
                    if !message.trim().is_empty() {
                        last_error = message.chars().take(300).collect();
                    }
                }
            }
            _ => {}
        }
    }

    if ctx.cancel.is_cancelled() {
        return;
    }
    let reason = if !last_error.is_empty() {
        failure_reason(&last_error)
    } else if !last_item_error.is_empty() {
        failure_reason(&last_item_error)
    } else {
        stderr_reason(&stderr_tail, "codex 没有给出终态就退出了")
    };
    settle_codex(app, ctx, TurnOutcome::Failed, &reason, &TurnUsage::default());
}

fn settle_codex(
    app: &App,
    ctx: &DriverContext,
    outcome: TurnOutcome,
    text: &str,
    usage: &TurnUsage,
) {
    // 取消由 turns 侧写终态；驱动不再抢着结算。
    if ctx.cancel.is_cancelled() {
        return;
    }
    settle(
        &app.turns,
        &app.store,
        &app.events,
        &ctx.thread_id,
        &ctx.bot_id,
        &ctx.turn_id,
        outcome,
        text,
        usage,
    );
}

fn failure_reason(detail: &str) -> String {
    format!(
        "codex 报告失败：{}",
        detail.chars().take(300).collect::<String>()
    )
}

fn usage_of(frame: &Value) -> TurnUsage {
    let usage = frame.get("usage");
    let count = |key: &str| {
        usage
            .and_then(|usage| usage.get(key))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    TurnUsage {
        input: count("input_tokens"),
        output: count("output_tokens"),
        cache_read: count("cached_input_tokens"),
        tool_calls: 0,
    }
}

/// 凭据文件：显式 `LODGE_CODEX_KEY_FILE` 优先（契约测试用），否则 `~/.codex/deepseek.key`。
fn deepseek_key_path() -> Option<PathBuf> {
    std::env::var_os("LODGE_CODEX_KEY_FILE")
        .map(PathBuf::from)
        .or_else(|| {
            crate::platform::home_dir().map(|home| home.join(".codex").join("deepseek.key"))
        })
}

fn deepseek_key() -> Option<String> {
    let path = deepseek_key_path()?;
    read_key(&path)
}

/// 读 key：去掉尾部空白（文件可能带一个换行）；空的或读不到都返回 None，不拦回合。
fn read_key(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let key = text.trim().to_string();
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_agent_message_items_become_room_text() {
        let message = json!({
            "type": "item.completed",
            "item": { "type": "agent_message", "text": "你好" }
        });
        let reasoning = json!({
            "type": "item.completed",
            "item": { "type": "reasoning", "text": "不要进房间" }
        });
        assert_eq!(
            message
                .get("item")
                .and_then(|item| item.get("type"))
                .and_then(Value::as_str),
            Some("agent_message")
        );
        assert_eq!(
            reasoning
                .get("item")
                .and_then(|item| item.get("type"))
                .and_then(Value::as_str),
            Some("reasoning")
        );
    }

    #[test]
    fn usage_is_read_from_turn_completed() {
        let frame = json!({
            "type": "turn.completed",
            "usage": {
                "input_tokens": 8955,
                "cached_input_tokens": 8704,
                "output_tokens": 2
            }
        });
        let usage = usage_of(&frame);
        assert_eq!((usage.input, usage.output, usage.cache_read), (8955, 2, 8704));
        assert_eq!(usage.tool_calls, 0);
    }

    #[test]
    fn a_missing_or_blank_key_file_means_no_injected_key() {
        let dir = std::env::temp_dir().join(format!("lodge-codex-key-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("deepseek.key");
        assert_eq!(read_key(&file), None, "a missing file is not a turn failure");

        std::fs::write(&file, "  \n").unwrap();
        assert_eq!(read_key(&file), None, "whitespace is not a key");

        std::fs::write(&file, "sk-test-123\n").unwrap();
        assert_eq!(read_key(&file).as_deref(), Some("sk-test-123"), "the trailing newline is trimmed");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_catalog_can_carry_the_body_file_path() {
        let skills = vec![("lodge-build".to_string(), "# Build\n先跑最小切片。".to_string())];
        let dir = std::path::Path::new("/tmp/turn/skills");
        let catalog = crate::drivers::skill_catalog_in(&skills, Some(dir));
        assert!(catalog.contains("正文：/tmp/turn/skills/lodge-build.md"));
        assert!(!catalog.contains("先跑最小切片"), "正文不进提示词");
        let plain = crate::drivers::skill_catalog(&skills);
        assert!(plain.contains("use_skill"));
        assert!(!plain.contains("正文："));
    }

    #[test]
    fn failure_reasons_are_prefixed_and_bounded() {
        let reason = failure_reason(&"x".repeat(400));
        assert!(reason.starts_with("codex 报告失败："));
        assert_eq!(reason.chars().count(), "codex 报告失败：".chars().count() + 300);
    }
}
