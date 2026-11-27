//! 真实 claude 驱动：外部 CLI + stream-json 事件。
//!
//! v1 刻意最小：每回合 spawn 一次 `claude -p`，关掉全部工具（`--tools ""`），
//! 只用于聊天成员；工作室仍用 pi。没有工具审批卡，也不发内容增量帧。
//! 驱动只做协议转换与终态结算，不替 Lodge 判断房间、阶段或证据。

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

pub(crate) async fn run(app: Arc<App>, ctx: DriverContext) {
    claude_turn_inner(&app, &ctx).await;
    // 回合不管怎么结束，都把驱动进程组收掉；SIGKILL 兜底由看门人负责。
    ctx.cancel.stop();
    // 给看门人一点时间把子进程带走，再让 child 句柄析构。
    tokio::time::sleep(Duration::from_millis(300)).await;
}

async fn claude_turn_inner(app: &Arc<App>, ctx: &DriverContext) {
    let Some(binary) = crate::discovery::claude_binary() else {
        settle_claude(
            app,
            ctx,
            TurnOutcome::Failed,
            "没找到 claude 命令；先安装并登录。",
            &TurnUsage::default(),
        );
        return;
    };
    // 边界值由回合开始时一次性建好；没有它就没有这一回合（不猜、不裸跑）。
    let Some(sandbox) = ctx.sandbox.as_ref() else {
        settle_claude(
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
        settle_claude(
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

    command
        .arg("-p")
        .args(["--output-format", "stream-json"])
        .arg("--verbose")
        // v1 只做聊天：能力面在装配期关掉，不靠提示词请求模型别用工具。
        .args(["--tools", ""]);
    // 空 model 不传参数：让 CLI 用自己的 ~/.claude 配置，基座不猜厂商模型名。
    if !ctx.model.is_empty() {
        command.arg("--model").arg(&ctx.model);
    }
    // 追加而不是替换：CLI 自己的纪律要留着，成员 soul 与技能清单只加角色和语气。
    let system = format!("{}{}", ctx.system, crate::drivers::skill_catalog(&ctx.skills));
    if !system.is_empty() {
        command.arg("--append-system-prompt").arg(&system);
    }
    // 技能正文按需读：只给一个 use_skill 的 MCP 服务器，`--strict-mcp-config` 不读别的配置。
    // 不走原生 skill 机制：那会把用户级和项目级技能也带进来，成员看到的会比房间给的多。
    if !ctx.skills.is_empty() {
        let skills_dir = sandbox.scratch().join("skills");
        let _ = crate::drivers::write_skill_files(&skills_dir, &ctx.skills);
        let script = sandbox.scratch().join("skill-mcp.mjs");
        if std::fs::write(&script, crate::drivers::SKILL_MCP_SCRIPT).is_ok() {
            let config = sandbox.scratch().join("skill-mcp.json");
            let json = crate::drivers::skill_mcp_json(&script, &skills_dir);
            if std::fs::write(&config, json).is_ok() {
                // 这两个选项都是可变参数，用 `=` 传值才不会被后面的 `--` 一起吃掉。
                command.arg(format!("--mcp-config={}", config.display()));
                command.arg("--strict-mcp-config");
                command.arg("--allowedTools=mcp__lodge_skills__use_skill");
            }
        }
    }
    // 房间最近的对话随提示词一起给：每回合新会话，记忆由基座的线程持有。
    let context = thread_context(app, &ctx.thread_id);
    let prompt = if context.is_empty() {
        ctx.prompt.clone()
    } else {
        format!("【房间最近的对话】\n{context}\n\n【这一轮】\n{}", ctx.prompt)
    };
    // `--tools` 是可变参数，会把后面的裸参数一起吃掉；`--` 把提示词留给位置参数。
    // 少了它，真实 CLI 会报「没有 stdin 也没有提示词」，回合在拿到 result 前就退出。
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
    // ~/.claude/settings.json 里的 ANTHROPIC endpoint 由 CLI 自己读，不走环境。
    crate::sandbox::scrub_env(&mut command);
    // 边界落到命令上：代理环境、平台包装。落不下来就不跑，不静默降级。
    let mut command = match sandbox.apply(command) {
        Ok(command) => command,
        Err(reason) => {
            settle_claude(
                app,
                ctx,
                TurnOutcome::Failed,
                &format!("这一回合需要沙箱，但{reason}；先修好再跑。"),
                &TurnUsage::default(),
            );
            return;
        }
    };
    #[cfg(windows)]
    crate::platform::hide_window(&mut command);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            settle_claude(
                app,
                ctx,
                TurnOutcome::Failed,
                &format!("claude 启动失败：{error}"),
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
        settle_claude(
            app,
            ctx,
            TurnOutcome::Failed,
            "claude 没有可读的 stdout",
            &TurnUsage::default(),
        );
        return;
    };
    let mut lines = BufReader::new(stdout).lines();
    let mut text = String::new();
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
                let reason = format!("claude 输出中断：{error}");
                settle_claude(app, ctx, TurnOutcome::Failed, &reason, &TurnUsage::default());
                return;
            }
            Err(_) => {
                let reason = format!(
                    "这一回合超过时间上限（{}）；停在半路。",
                    time_limit_text(ctx.budget.max_ms)
                );
                settle_claude(app, ctx, TurnOutcome::Stopped, &reason, &TurnUsage::default());
                return;
            }
        };
        let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
        match frame.get("type").and_then(Value::as_str).unwrap_or("") {
            "system" => {
                // 初始化帧只用来记会话号；它不参与终态判断。
                if frame.get("subtype").and_then(Value::as_str) == Some("init") {
                    if let Some(session) = frame.get("session_id").and_then(Value::as_str) {
                        eprintln!("lodge-base-slice: claude session {session}");
                    }
                }
            }
            "assistant" => {
                text.push_str(&assistant_text(&frame));
            }
            "result" => {
                let usage = usage_of(&frame);
                match failure_of(&frame) {
                    Some(reason) => {
                        settle_claude(app, ctx, TurnOutcome::Failed, &reason, &usage);
                    }
                    None => {
                        // 大多时候 assistant 帧已经给全了文本；没有才回退到 result 字段。
                        let reply = if text.is_empty() {
                            frame
                                .get("result")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string()
                        } else {
                            text.clone()
                        };
                        settle_claude(app, ctx, TurnOutcome::Completed, &reply, &usage);
                    }
                }
                return;
            }
            _ => {}
        }
    }

    if ctx.cancel.is_cancelled() {
        return;
    }
    let reason = stderr_reason(&stderr_tail, "claude 没有给出终态就退出了");
    settle_claude(app, ctx, TurnOutcome::Failed, &reason, &TurnUsage::default());
}

fn settle_claude(
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

/// assistant 帧里的正文；thinking 是中间推理，不进房间。
fn assistant_text(frame: &Value) -> String {
    frame
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|item| item.get("text").and_then(Value::as_str))
                .collect::<String>()
        })
        .unwrap_or_default()
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
        cache_read: count("cache_read_input_tokens"),
        tool_calls: 0,
    }
}

/// result 帧的失败判定：CLI 自己说 is_error、subtype 以 error 开头，或 stop_reason=error。
/// 失败原因优先取 result 里的文字，取不到再退到 subtype。
fn failure_of(frame: &Value) -> Option<String> {
    let subtype = frame.get("subtype").and_then(Value::as_str).unwrap_or("");
    let stop = frame.get("stop_reason").and_then(Value::as_str).unwrap_or("");
    let failed = frame.get("is_error").and_then(Value::as_bool) == Some(true)
        || subtype.starts_with("error")
        || stop == "error";
    if !failed {
        return None;
    }
    let detail = ["result", "error", "subtype"]
        .iter()
        .find_map(|key| {
            frame
                .get(*key)
                .and_then(Value::as_str)
                .filter(|text| !text.trim().is_empty())
        })
        .unwrap_or("claude 报告失败，没有给出原因");
    Some(format!(
        "claude 报告失败：{}",
        detail.chars().take(300).collect::<String>()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn assistant_text_keeps_only_text_blocks() {
        let frame = json!({
            "type": "assistant",
            "message": {
                "content": [
                    { "type": "thinking", "thinking": "不要进房间" },
                    { "type": "text", "text": "你好" },
                    { "type": "text", "text": "，世界" }
                ]
            }
        });
        assert_eq!(assistant_text(&frame), "你好，世界");
    }

    #[test]
    fn result_usage_and_failure_are_read_from_the_cli_frame() {
        let ok = json!({
            "type": "result",
            "is_error": false,
            "usage": { "input_tokens": 3, "output_tokens": 5, "cache_read_input_tokens": 7 }
        });
        let usage = usage_of(&ok);
        assert_eq!((usage.input, usage.output, usage.cache_read), (3, 5, 7));
        assert!(failure_of(&ok).is_none());

        let failed = json!({ "type": "result", "is_error": true, "result": "boom" });
        assert!(failure_of(&failed).unwrap().contains("boom"));
        let by_subtype = json!({ "type": "result", "subtype": "error_max_turns" });
        assert!(failure_of(&by_subtype).unwrap().contains("error_max_turns"));
    }
}
