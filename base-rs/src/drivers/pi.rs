//! 真实 pi 驱动：外部 CLI + NDJSON 事件 + JSON-RPC 写入。
//! 只实现最小 runtime 契约；不认识房型，也不替 Lodge 做判定。

use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::{emit_question, prepare_ask, wait_ask, DriverContext};
use crate::events::runtime_frame;
use crate::model::{TurnOutcome, TurnUsage};
use crate::state::App;
use crate::turns::settle;

enum PiAsk {
    Decision(crate::turns::Decision),
    Interrupted,
    StorageFailed,
}

const PI_DENY_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "DEEPSEEK_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "XAI_API_KEY",
    "OPENROUTER_API_KEY",
];

pub(crate) async fn run(app: Arc<App>, ctx: DriverContext) {
    pi_turn_inner(&app, &ctx).await;
    // 回合不管怎么结束，都把驱动进程组收掉；SIGKILL 兜底由看门人负责。
    ctx.cancel.stop();
    // 给看门人一点时间把子进程带走，再让 child 句柄析构。
    tokio::time::sleep(Duration::from_millis(300)).await;
}

async fn pi_turn_inner(app: &Arc<App>, ctx: &DriverContext) {
    let binary = std::env::var_os("LODGE_PI_BIN")
        .map(std::path::PathBuf::from)
        .or_else(|| crate::discovery::find_in(&crate::discovery::search_dirs(), "pi"));
    let Some(binary) = binary else {
        settle(
            &app.turns,
            &app.store,
            &app.events,
            &ctx.thread_id,
            &ctx.bot_id,
            &ctx.turn_id,
            TurnOutcome::Failed,
            "没找到 pi 命令；先安装并登录。",
            &TurnUsage::default(),
        );
        return;
    };

    // 外面套一层看门人：基座被 SIGKILL 时它会把整组子进程带走。
    let mut command = match std::env::current_exe() {
        Ok(exe) => {
            let mut command = Command::new(exe);
            command.arg("--supervise").arg(&binary);
            command
        }
        Err(_) => Command::new(&binary),
    };
    command
        .args(["--mode", "rpc", "--no-session", "--no-context-files", "--no-mcp", "--no-tools"])
        .current_dir(if ctx.cwd.is_empty() { "/tmp" } else { &ctx.cwd })
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0);
    if !ctx.model.is_empty() {
        command.arg("--model").arg(&ctx.model);
    }
    // 追加而不是替换：pi 自己的工具与安全纪律要留着，成员 soul 只加角色和语气。
    if !ctx.system.is_empty() {
        command.arg("--append-system-prompt").arg(&ctx.system);
    }
    for key in PI_DENY_ENV {
        command.env_remove(key);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            settle(
                &app.turns,
                &app.store,
                &app.events,
                &ctx.thread_id,
                &ctx.bot_id,
                &ctx.turn_id,
                TurnOutcome::Failed,
                &format!("pi 启动失败：{error}"),
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

    let Some(mut stdin) = child.stdin.take() else {
        settle(
            &app.turns, &app.store, &app.events, &ctx.thread_id, &ctx.bot_id, &ctx.turn_id,
            TurnOutcome::Failed, "pi 没有可写的 stdin", &TurnUsage::default(),
        );
        return;
    };
    // pi 用 --no-session：每轮都得把房间最近的对话一起给它，否则它只看见这一条提示。
    let context = thread_context(&app, &ctx.thread_id);
    let prompt = if context.is_empty() {
        ctx.prompt.clone()
    } else {
        format!("【房间最近的对话】\n{context}\n\n【这一轮】\n{}", ctx.prompt)
    };
    if stdin
        .write_all(format!("{}\n", json!({ "type": "prompt", "message": prompt })).as_bytes())
        .await
        .is_err()
    {
        settle(
            &app.turns, &app.store, &app.events, &ctx.thread_id, &ctx.bot_id, &ctx.turn_id,
            TurnOutcome::Failed, "pi 没有接住提示词", &TurnUsage::default(),
        );
        return;
    }
    let _ = stdin.flush().await;

    let Some(stdout) = child.stdout.take() else {
        settle(
            &app.turns, &app.store, &app.events, &ctx.thread_id, &ctx.bot_id, &ctx.turn_id,
            TurnOutcome::Failed, "pi 没有可读的 stdout", &TurnUsage::default(),
        );
        return;
    };
    let mut lines = BufReader::new(stdout).lines();
    let mut text = String::new();
    let mut usage = TurnUsage::default();
    let mut settled = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(600);

    loop {
        if ctx.cancel.is_cancelled() {
            return;
        }
        let next = tokio::time::timeout_at(deadline, lines.next_line()).await;
        let line = match next {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                let reason = format!("pi 输出中断：{error}");
                settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, &reason, &usage);
                return;
            }
            Err(_) => {
                settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, "pi 回合超时", &usage);
                return;
            }
        };
        let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
        match frame.get("type").and_then(Value::as_str).unwrap_or("") {
            // pi 会先回执 prompt；被拒说明回合根本没开始，不能等到超时。
            "response" => {
                if frame.get("success").and_then(Value::as_bool) == Some(false) {
                    let error = frame
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("pi 拒绝了这次请求");
                    let reason = format!("pi 拒绝了提示词：{error}");
                    settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, &reason, &usage);
                    return;
                }
            }
            "message_update" => {
                let event = frame.get("assistantMessageEvent");
                let kind = event.and_then(|event| event.get("type")).and_then(Value::as_str);
                let delta = event.and_then(|event| event.get("delta")).and_then(Value::as_str);
                if kind == Some("text_delta") {
                    if let Some(delta) = delta {
                        text.push_str(delta);
                        app.events.emit(runtime_frame(
                            &ctx.thread_id,
                            json!({
                                "threadId": ctx.thread_id,
                                "botId": ctx.bot_id,
                                "turnId": ctx.turn_id,
                                "type": "content.delta",
                                "streamKind": "assistant_text",
                                "delta": delta,
                            }),
                        ));
                    }
                }
            }
            "message_end" => {
                let message = frame.get("message");
                if message.and_then(|message| message.get("role")).and_then(Value::as_str) == Some("assistant") {
                    if let Some(item) = message.and_then(|message| message.get("usage")) {
                        let next = TurnUsage {
                            input: item.get("input").and_then(Value::as_u64).unwrap_or(0),
                            output: item.get("output").and_then(Value::as_u64).unwrap_or(0),
                            cache_read: item.get("cacheRead").and_then(Value::as_u64).unwrap_or(0),
                        };
                        usage.merge(&next);
                    }
                }
            }
            "extension_ui_request" => {
                // pi 会大量推 setWidget/setStatus；它们不是提问，不能因此收掉回合。
                let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
                if method != "confirm" && method != "select" && method != "input" {
                    continue;
                }
                match pi_ask(app, ctx, &frame).await {
                PiAsk::Decision(decision) => {
                    let request_id = frame.get("id").and_then(Value::as_str).unwrap_or("");
                    let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
                    let response = if decision.behavior == "deny" {
                        json!({ "type": "extension_ui_response", "id": request_id, "cancelled": true })
                    } else if method == "confirm" {
                        json!({ "type": "extension_ui_response", "id": request_id, "confirmed": true })
                    } else {
                        json!({
                            "type": "extension_ui_response",
                            "id": request_id,
                            "value": decision.message.clone().unwrap_or_default(),
                        })
                    };
                    let _ = stdin.write_all(format!("{response}\n").as_bytes()).await;
                    let _ = stdin.flush().await;
                }
                PiAsk::Interrupted => {
                    if !ctx.cancel.is_cancelled() {
                        settle_pi(app, ctx, &mut settled, TurnOutcome::Expired, "审批超时：这一回合没有继续。", &usage);
                    }
                    return;
                }
                PiAsk::StorageFailed => {
                    settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, "审批卡没能保存；这一回合没有继续。", &usage);
                    return;
                }
                }
            }
            "agent_settled" => {
                settle_pi(app, ctx, &mut settled, TurnOutcome::Completed, &text, &usage);
                return;
            }
            "agent_end" => {
                let terminal = frame.get("isTerminal").and_then(Value::as_bool).unwrap_or(true);
                let retry = frame.get("willRetry").and_then(Value::as_bool).unwrap_or(false);
                if terminal && !retry {
                    settle_pi(app, ctx, &mut settled, TurnOutcome::Completed, &text, &usage);
                    return;
                }
            }
            "turn_end" => {
                let stop = frame
                    .get("message")
                    .and_then(|message| message.get("stopReason"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if stop == "toolUse" || stop == "tool_use" || stop == "tool_calls" {
                    text.clear();
                }
            }
            _ => {}
        }
    }

    if ctx.cancel.is_cancelled() {
        return;
    }
    let reason = stderr_reason(&stderr_tail, "pi 没有给出终态就退出了");
    settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, &reason, &usage);
}

fn settle_pi(
    app: &App,
    ctx: &DriverContext,
    settled: &mut bool,
    outcome: TurnOutcome,
    text: &str,
    usage: &TurnUsage,
) {
    if *settled {
        return;
    }
    *settled = true;
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

async fn pi_ask(app: &App, ctx: &DriverContext, frame: &Value) -> PiAsk {
    let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
    if method != "confirm" && method != "select" && method != "input" {
        return PiAsk::Interrupted;
    }
    let request_id = frame
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let title = frame.get("title").and_then(Value::as_str).unwrap_or("pi 在问你");
    // pi 的确认问句是「Allow server:tool?」；卡上带工具本身，不带问句。
    let tool = title
        .strip_prefix("Allow ")
        .and_then(|rest| rest.strip_suffix('?'))
        .unwrap_or("pi")
        .trim()
        .to_string();
    let options: Vec<String> = frame
        .get("options")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let rx = prepare_ask(app, &request_id);
    if !emit_question(app, ctx, &request_id, &tool, title, &options) {
        app.turns.drop_card(&request_id);
        return PiAsk::StorageFailed;
    }
    match wait_ask(app, ctx, &request_id, rx).await {
        Some(decision) => PiAsk::Decision(decision),
        None => PiAsk::Interrupted,
    }
}

/// 房间最近 12 条成员文本；pi 每轮拿它当上下文，不依赖 pi 自己的会话。
fn thread_context(app: &App, thread_id: &str) -> String {
    let Ok(messages) = app.store.thread_messages(thread_id, 12) else {
        return String::new();
    };
    let names: std::collections::HashMap<String, String> = app
        .store
        .bots()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|bot| {
            Some((
                bot.get("id")?.as_str()?.to_string(),
                bot.get("name")?.as_str()?.to_string(),
            ))
        })
        .collect();
    let mut lines = Vec::new();
    for message in messages {
        if message.get("kind").and_then(Value::as_str) != Some("text") {
            continue;
        }
        let text = message.get("text").and_then(Value::as_str).unwrap_or("").trim();
        if text.is_empty() {
            continue;
        }
        let bot_id = message
            .get("from")
            .and_then(|from| from.get("botId"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let name = names.get(bot_id).map(String::as_str).unwrap_or("成员");
        let text: String = text.chars().take(400).collect();
        lines.push(format!("{name}：{text}"));
    }
    lines.join("\n")
}

fn stderr_reason(tail: &Arc<std::sync::Mutex<String>>, fallback: &str) -> String {
    let text = tail.lock().map(|text| text.trim().to_string()).unwrap_or_default();
    if text.is_empty() {
        fallback.to_string()
    } else {
        let lines: Vec<&str> = text.lines().collect();
        let start = lines.len().saturating_sub(8);
        format!("{fallback}：{}", lines[start..].join(" / "))
    }
}
