//! 真实 pi 驱动：外部 CLI + NDJSON 事件 + JSON-RPC 写入。
//! 只实现最小 runtime 契约；不认识房型，也不替 Lodge 做判定。

use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::process::Command;

use super::{
    emit_question, prepare_ask, stderr_reason, thread_context, time_limit_text, wait_ask,
    AskOutcome, DriverContext,
};
use crate::events::{message_frame, runtime_frame};
use crate::model::{TurnOutcome, TurnUsage};
use crate::state::App;
use crate::turns::settle;

enum PiAsk {
    Exited,
    Decision(crate::turns::Decision),
    Interrupted,
    StorageFailed,
}


pub(crate) async fn run(app: Arc<App>, ctx: DriverContext) {
    // 无副作用重试：模型服务一个字都没给出就断了（进程没起来、流断了、空转到窗口），
    // 这一回合什么都还没发生——重发一次。已经有输出或工具调用的回合不重试，
    // 重跑会重复写文件。重试策略对齐 Codex：200ms 起、翻倍、±10% 抖动。
    let mut attempt = 0u32;
    loop {
        let retry = pi_turn_inner(&app, &ctx).await;
        let Some(reason) = retry else { break };
        if ctx.cancel.is_cancelled() {
            break;
        }
        if attempt >= 1 {
            // 走正常的 settle：它会把回合从登记表里摘掉，线程才不会一直“还在跑”。
            crate::turns::settle(
                &app.turns,
                &app.store,
                &app.events,
                &ctx.thread_id,
                &ctx.bot_id,
                &ctx.turn_id,
                TurnOutcome::Failed,
                &reason,
                &TurnUsage::default(),
            );
            break;
        }
        attempt += 1;
        // 重试要看得见：房间的时间线上会多一行“重试”，不是悄悄重发。
        app.events.emit(message_frame(
            &ctx.thread_id,
            json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "at": crate::store::now(),
                "role": "agent",
                "kind": "activity",
                "turnId": ctx.turn_id,
                "from": { "botId": ctx.bot_id },
                "tool": {
                    "name": "retry",
                    "label": "重试",
                    "input": format!("模型服务没有响应，重发第 {attempt}/1 次"),
                    "ok": true,
                },
            }),
        ));
        eprintln!("lodge-base-slice: 模型服务没有响应，重发第 {attempt}/1 次：{reason}");
        let delay = retry_delay_ms(attempt);
        tokio::time::sleep(Duration::from_millis(delay)).await;
    }
    // 回合不管怎么结束，都把驱动进程组收掉；SIGKILL 兜底由看门人负责。
    ctx.cancel.stop();
    // 给看门人一点时间把子进程带走，再让 child 句柄析构。
    tokio::time::sleep(Duration::from_millis(300)).await;
}

async fn pi_turn_inner(app: &Arc<App>, ctx: &DriverContext) -> Option<String> {
    let retry = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    pi_turn_body(app, ctx, &retry).await;
    retry.lock().ok().and_then(|slot| slot.clone())
}

/// 什么都不算发生：没有正文、没有工具调用。只有这种回合才允许无副作用重试。
fn nothing_happened(text: &str, tool_calls: u64) -> bool {
    text.trim().is_empty() && tool_calls == 0
}

fn request_retry(retry: &std::sync::Arc<std::sync::Mutex<Option<String>>>, reason: &str) {
    if let Ok(mut slot) = retry.lock() {
        *slot = Some(reason.to_string());
    }
}

async fn pi_turn_body(app: &Arc<App>, ctx: &DriverContext, retry: &std::sync::Arc<std::sync::Mutex<Option<String>>>) {
    let binary = crate::discovery::pi_binary();
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
    // 边界值由回合开始时一次性建好；没有它就没有这一回合（不猜、不裸跑）。
    let Some(sandbox) = ctx.sandbox.as_ref() else {
        settle(
            &app.turns,
            &app.store,
            &app.events,
            &ctx.thread_id,
            &ctx.bot_id,
            &ctx.turn_id,
            TurnOutcome::Failed,
            "这一回合没有边界值；驱动不起来。",
            &TurnUsage::default(),
        );
        return;
    };
    // 磁盘快满了就不开跑：写到一半撑满盘，坏的是整台机器，不只是这一回合。
    if let Some(free) = crate::sandbox::low_disk(sandbox.work()) {
        settle(
            &app.turns,
            &app.store,
            &app.events,
            &ctx.thread_id,
            &ctx.bot_id,
            &ctx.turn_id,
            TurnOutcome::Failed,
            &format!("磁盘余量不足（只剩 {} MB）；先腾出空间再跑。", free / (1024 * 1024)),
            &TurnUsage::default(),
        );
        return;
    }

    // Unix 外面套一层看门人：基座被 SIGKILL 时它会把整组子进程带走。
    // Windows 由 Job Object 兜底：句柄随基座进程关闭，整棵树一起停。
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
    command.args(["--mode", "rpc", "--no-session", "--no-context-files"]);
    let has_mcp = ctx.mcp_json.is_some();
    // 没有 MCP 时连用户级 mcp.json 都不读；有 MCP 时由基座注入的扩展注册（用户级 mcp.json 仍会读，见诚实边界）。
    if !has_mcp {
        command.arg("--no-mcp");
    }
    // 不藏工具：pi 的全部工具都可见，成员能不能用由扩展按授权在调用时拦。
    // 藏起来会让 agent 不知道自己能申请什么，也会随 pi 升级漏掉新工具。
    let mut granted = ctx.native_tools.clone();
    granted.extend(ctx.mcp_tools.iter().cloned());

    command
        .current_dir(sandbox.work())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    // 默认继承会把自己的凭据和平台变量一起交出去；只留声明过的那几样。
    crate::sandbox::scrub_env(&mut command);
    if !ctx.model.is_empty() {
        command.arg("--model").arg(&ctx.model);
    }
    // 追加而不是替换：pi 自己的工具与安全纪律要留着，成员 soul 只加角色和语气。
    // 技能只列清单；正文写进回合目录，由扩展的 use_skill 工具按需读。
    let catalog = crate::drivers::skill_catalog(&ctx.skills);
    let system = if catalog.is_empty() {
        ctx.system.clone()
    } else if ctx.system.is_empty() {
        catalog
    } else {
        format!("{}\n\n{}", ctx.system, catalog)
    };
    if !system.is_empty() {
        command.arg("--append-system-prompt").arg(&system);
    }
    if !ctx.skills.is_empty() {
        let skills_dir = sandbox.scratch().join("skills");
        let _ = crate::drivers::write_skill_files(&skills_dir, &ctx.skills);
        command.env("LODGE_SKILLS_DIR", &skills_dir);
    }
    // 扩展每回合都挂：MCP 注册和工具审批都在里面；没有 MCP 时只做审批。
    // 写进回合自己的临时目录，沙箱把它算作可写根。
    let (config_path, extension_path) =
        match write_extension(sandbox.scratch(), ctx.mcp_json.as_deref()) {
            Ok(paths) => paths,
            Err(error) => {
                settle(
                    &app.turns,
                    &app.store,
                    &app.events,
                    &ctx.thread_id,
                    &ctx.bot_id,
                    &ctx.turn_id,
                    TurnOutcome::Failed,
                    &format!("回合的临时文件写不出来：{error}；先修好再跑。"),
                    &TurnUsage::default(),
                );
                return;
            }
        };
    if ctx.mcp_json.is_some() {
        command.env("LODGE_MCP_CONFIG", config_path);
    }
    let marker = sandbox.scratch().join("extension.ok");
    command
        .env("LODGE_EXTENSION_MARKER", &marker)
        .env("LODGE_GRANTED_TOOLS", granted.join(","))
        .env("LODGE_AUTO_SERVERS", ctx.auto_mcp_servers.join(","))
        .env("LODGE_DENIED_TOOLS", ctx.exclude_tools.join(","))
        .env("LODGE_APPROVAL", &ctx.approval_mode)
        .arg("-e")
        .arg(extension_path);
    // 边界落到命令上：代理环境、引擎目录、平台包装。落不下来就不跑，不静默降级。
    let mut command = match sandbox.apply(command) {
        Ok(command) => command,
        Err(reason) => {
            settle(
                &app.turns,
                &app.store,
                &app.events,
                &ctx.thread_id,
                &ctx.bot_id,
                &ctx.turn_id,
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
    // 进程数看门人：只数这一组的进程，超限就整组停掉；别让 fork 风暴拖垮机器。
    let over_processes = Arc::new(AtomicBool::new(false));
    let process_limit = sandbox.processes();
    #[cfg(windows)]
    let job = Arc::new(match crate::platform::Job::create(process_limit) {
        Ok(job) => Some(job),
        Err(error) => {
            eprintln!("lodge-base-slice: 进程边界没立起来（{error}）；这一回合只能按进程树兜底");
            None
        }
    });
    if let Some(pid) = child.id() {
        ctx.cancel.set_pid(pid);
        if ctx.cancel.is_cancelled() {
            ctx.cancel.cancel();
        }
        #[cfg(windows)]
        if let Some(job) = job.as_ref().as_ref() {
            if let Err(error) = job.assign(pid) {
                eprintln!("lodge-base-slice: 进程没有进 Job（{error}）；这一回合只能按进程树兜底");
            }
        }
        let over = over_processes.clone();
        let cancel = ctx.cancel.clone();
        #[cfg(windows)]
        let job_for_watch = job.clone();
        tokio::spawn(async move {
            // 连续几拍数不出来才停：进程表最满的时候连 `ps` 都 fork 不出来；
            // 偶发一次读不到不该杀掉正常回合，一直读不到就是已经满了。
            let mut unreadable = 0u32;
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if cancel.is_cancelled() {
                    break;
                }
                #[cfg(unix)]
                let too_many = match crate::sandbox::descendant_count(pid) {
                    Some(count) => {
                        unreadable = 0;
                        count > process_limit as usize
                    }
                    None => {
                        unreadable += 1;
                        unreadable >= 2
                    }
                };
                #[cfg(windows)]
                let too_many = job_for_watch
                    .as_ref()
                    .as_ref()
                    .map(|job| job.active_processes() > process_limit as usize)
                    .unwrap_or(false);
                if too_many {
                    over.store(true, Ordering::Relaxed);
                    #[cfg(unix)]
                    crate::sandbox::kill_tree(pid);
                    #[cfg(windows)]
                    if let Some(job) = job_for_watch.as_ref().as_ref() {
                        job.kill();
                    }
                    // 不停手：杀了再来一轮，漏掉的（刚 fork 出来的）下一拍继续收。
                    continue;
                }
            }
        });
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

    // 扩展没加载就没有工具边界：发提示词前等它的标记，等不到就让这一回合诚实失败。
    if !wait_for_marker(&marker, Duration::from_secs(10)).await {
        let _ = child.kill().await;
        settle(
            &app.turns, &app.store, &app.events, &ctx.thread_id, &ctx.bot_id, &ctx.turn_id,
            TurnOutcome::Failed,
            "工具边界没有建立：pi 扩展没有加载；这一回合不跑",
            &TurnUsage::default(),
        );
        return;
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
    // 工具开始时的入参预览；结束那条要带着同一份输入，界面才不是一条空调用。
    let mut tool_args: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // pi 把模型错误也走正常收尾（stopReason=error）；留着原因，终态要如实报失败。
    let mut pi_error: Option<String> = None;
    // 预算到点就停；基座只数数和看表，不解释「值不值得继续」。
    let mut tool_calls: u64 = 0;
    let deadline = tokio::time::Instant::now() + Duration::from_millis(ctx.budget.max_ms);
    // 模型服务会卡住：整回合可以长，但一直不出字就是真停了，不该等到墙上预算。
    let mut idle_deadline =
        tokio::time::Instant::now() + Duration::from_millis(ctx.budget.idle_ms);

    loop {
        if ctx.cancel.is_cancelled() {
            return;
        }
        let next = tokio::time::timeout_at(deadline.min(idle_deadline), lines.next_line()).await;
        let line = match next {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                let reason = format!("pi 输出中断：{error}");
                if nothing_happened(&text, tool_calls) {
                    request_retry(retry, &reason);
                    return;
                }
                settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, &reason, &usage);
                return;
            }
            Err(_) => {
                if tokio::time::Instant::now() < deadline {
                    let reason = format!(
                        "模型服务 {} 分钟没有动静；这一回合先停。",
                        ctx.budget.idle_ms / 60_000
                    );
                    if nothing_happened(&text, tool_calls) {
                        request_retry(retry, &reason);
                        return;
                    }
                    settle_pi(app, ctx, &mut settled, TurnOutcome::Stopped, &reason, &usage);
                    return;
                }
                let reason = format!(
                    "这一回合超过时间上限（{}）；停在半路。",
                    time_limit_text(ctx.budget.max_ms)
                );
                settle_pi(app, ctx, &mut settled, TurnOutcome::Stopped, &reason, &usage);
                return;
            }
        };
        idle_deadline = tokio::time::Instant::now() + Duration::from_millis(ctx.budget.idle_ms);
        let Ok(frame) = serde_json::from_str::<Value>(&line) else { continue };
        match frame.get("type").and_then(Value::as_str).unwrap_or("") {
            // pi 会先回执 prompt；被拒说明回合根本没开始，不能等到超时。
            "response" => {
                if frame.get("success").and_then(Value::as_bool) == Some(false) {
                    let error = frame
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("pi 拒绝了这次请求");
                    let tail = stderr_tail.lock().map(|text| text.clone()).unwrap_or_default();
                    if !tail.is_empty() {
                        eprintln!("lodge-base-slice: pi stderr: {tail}");
                    }
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
                            tool_calls: 0,
                        };
                        usage.merge(&next);
                    }
                    pi_error = message.and_then(error_of);
                }
            }
            "extension_ui_request" => {
                // pi 会大量推 setWidget/setStatus；它们不是提问，不能因此收掉回合。
                let method = frame.get("method").and_then(Value::as_str).unwrap_or("");
                if method != "confirm" && method != "select" && method != "input" {
                    continue;
                }
                match pi_ask(app, ctx, &frame, &mut child).await {
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
                PiAsk::Exited => {
                    settle_pi(app, ctx, &mut settled, TurnOutcome::Failed, "成员进程在等审批时退出了；这一回合没有继续。", &usage);
                    return;
                }
                }
            }
            "tool_execution_start" => {
                tool_calls += 1;
                usage.tool_calls = tool_calls;
                if tool_calls > ctx.budget.tool_calls {
                    let reason = format!(
                        "工具调用到上限（{} 次）；这一回合停在半路。",
                        ctx.budget.tool_calls
                    );
                    settle_pi(app, ctx, &mut settled, TurnOutcome::Stopped, &reason, &usage);
                    return;
                }
                let item = frame.get("toolCallId").and_then(Value::as_str).unwrap_or("");
                let name = frame.get("toolName").and_then(Value::as_str).unwrap_or("工具");
                let input = frame.get("args").map(Value::to_string).unwrap_or_default();
                tool_args.insert(item.to_string(), input.clone());
                app.events.emit(message_frame(
                    &ctx.thread_id,
                    activity_message(ctx, item, name, &input, None, None, None),
                ));
            }
            "tool_execution_end" => {
                let item = frame.get("toolCallId").and_then(Value::as_str).unwrap_or("");
                let name = frame.get("toolName").and_then(Value::as_str).unwrap_or("工具");
                // 判定工具把完整入参放在 structuredContent 里；房间靠这份回执取提交，
                // 只给预览会在长方案上把它截成半句。
                let output = frame
                    .get("result")
                    .map(|result| {
                        result
                            .get("structuredContent")
                            .cloned()
                            .unwrap_or_else(|| result.clone())
                    })
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                let ok = !frame
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let duration = frame.get("durationMs").and_then(Value::as_u64);
                let input = tool_args.remove(item).unwrap_or_default();
                app.events.emit(message_frame(
                    &ctx.thread_id,
                    activity_message(ctx, item, name, &input, Some(&output), Some(ok), duration),
                ));
            }
            "agent_settled" => {
                settle_with_error(app, ctx, &mut settled, &mut pi_error, &text, &usage);
                return;
            }
            "agent_end" => {
                if let Some(error) = frame.get("messages")
                    .and_then(Value::as_array)
                    .and_then(|messages| messages.iter().rev().find_map(error_of))
                {
                    pi_error = Some(error);
                }
                let terminal = frame.get("isTerminal").and_then(Value::as_bool).unwrap_or(true);
                let retry = frame.get("willRetry").and_then(Value::as_bool).unwrap_or(false);
                if terminal && !retry {
                    settle_with_error(app, ctx, &mut settled, &mut pi_error, &text, &usage);
                    return;
                }
            }
            "turn_end" => {
                let message = frame.get("message");
                let stop = message
                    .and_then(|message| message.get("stopReason"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if stop == "toolUse" || stop == "tool_use" || stop == "tool_calls" {
                    text.clear();
                }
                if let Some(error) = message.and_then(error_of) {
                    pi_error = Some(error);
                } else if !stop.is_empty() && stop != "error" {
                    pi_error = None;
                }
            }
            _ => {}
        }
    }

    if over_processes.load(Ordering::Relaxed) {
        settle_pi(
            app,
            ctx,
            &mut settled,
            TurnOutcome::Stopped,
            &format!("进程数到上限（{process_limit}）；这一回合停在半路。"),
            &usage,
        );
        return;
    }
    if ctx.cancel.is_cancelled() {
        return;
    }
    let reason = stderr_reason(&stderr_tail, "pi 没有给出终态就退出了");
    // 被信号杀死（用户中断、外部 kill、看门人）不是“模型服务抖了一下”，不重试：
    // 那是有人或系统要它停，重发等于把停下去的动作又跑起来。
    #[cfg(unix)]
    let killed = {
        use std::os::unix::process::ExitStatusExt;
        child
            .try_wait()
            .ok()
            .flatten()
            .map(|status| status.signal().is_some())
            .unwrap_or(false)
    };
    #[cfg(not(unix))]
    let killed = false;
    if !killed && nothing_happened(&text, tool_calls) {
        request_retry(retry, &reason);
        return;
    }
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

/// 确认卡的标题是唯一能带工具名的地方：扩展写「Allow <tool>?」，驱动只认这个格式。
/// 展示给用户的问题由这里用产品语言重写，标题不直接进房间。
fn tool_from_title(title: &str) -> String {
    title
        .strip_prefix("Allow ")
        .and_then(|rest| rest.strip_suffix('?'))
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("")
        .to_string()
}

async fn pi_ask(app: &App, ctx: &DriverContext, frame: &Value, child: &mut tokio::process::Child) -> PiAsk {
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
    // 扩展用机器可读的标题「Allow <tool>?」；卡上带工具本身，不带问句或某一种语言的文案。
    // 解析不出来就留空（界面显示「该工具」），绝不猜一个名字去判权限。
    let tool = tool_from_title(title);
    let options: Vec<String> = frame
        .get("options")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let question = if method == "confirm" && !tool.is_empty() {
        format!("允许 {tool} 吗？")
    } else {
        title.to_string()
    };
    // 入参摘要跟着卡走：房间要靠它判断这是不是推送、安装、删除这类外部动作。
    // 只放在标题里不够——文案会被翻译，命令和路径是数据。
    let detail = frame
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(8000)
        .collect::<String>();
    let rx = prepare_ask(app, &request_id);
    if !emit_question(app, ctx, &request_id, &tool, &question, &detail, &options) {
        app.turns.drop_card(&request_id);
        return PiAsk::StorageFailed;
    }
    match wait_ask(app, ctx, &request_id, rx, Some(child)).await {
        AskOutcome::Decision(decision) => PiAsk::Decision(decision),
        AskOutcome::Interrupted => PiAsk::Interrupted,
        AskOutcome::Exited => PiAsk::Exited,
    }
}

/// 等扩展写出「已加载」标记；等不到就不发提示词，回合诚实失败。
async fn wait_for_marker(path: &std::path::Path, limit: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        if path.is_file() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// MCP 注册扩展：只把基座写的服务器注册给 pi，不读别的目录、不改用户配置。
const MCP_EXTENSION: &str = include_str!("pi-base-extension.mjs");

/// 扩展和 MCP 配置写进回合自己的临时目录；目录归边界值所有，回合结束自动清掉。
fn write_extension(
    dir: &std::path::Path,
    config: Option<&str>,
) -> std::io::Result<(std::path::PathBuf, std::path::PathBuf)> {
    let config_path = dir.join("mcp.json");
    let extension_path = dir.join("mcp-extension.mjs");
    if let Some(config) = config {
        std::fs::write(&config_path, config)?;
    }
    std::fs::write(&extension_path, MCP_EXTENSION)?;
    Ok((config_path, extension_path))
}

/// 工具在做什么：一条命令或一个路径，给房间和界面看的短摘要。
/// 完整入参仍在 input 里；这里只回答“现在在动什么”，不替人判断它该不该动。
fn step_of(name: &str, input: &str) -> Value {
    let parsed: Value = serde_json::from_str(input).unwrap_or(Value::Null);
    let text = |key: &str| {
        parsed
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string()
    };
    let clip = |value: String, limit: usize| -> String {
        let chars: Vec<char> = value.chars().collect();
        if chars.len() <= limit {
            value
        } else {
            format!("{}…", chars[..limit].iter().collect::<String>())
        }
    };
    let command = text("command");
    if !command.is_empty() {
        let first = command.lines().next().unwrap_or("").trim().to_string();
        return json!({
            "activity": "command",
            "target": clip(first, 200),
            "detail": clip(command, 400),
        });
    }
    let path = {
        let path = text("path");
        if path.is_empty() { text("file_path") } else { path }
    };
    let pattern = text("pattern");
    match (path.is_empty(), pattern.is_empty()) {
        (false, _) => json!({ "activity": "file", "target": clip(path, 240) }),
        (true, false) => json!({ "activity": "search", "target": clip(pattern, 120), "detail": clip(name.to_string(), 40) }),
        _ => Value::Null,
    }
}

/// 工具活动的消息形状：Lodge 的房间判定靠它取回执，界面拿它显示这一回合做了什么。
fn activity_message(
    ctx: &DriverContext,
    item_id: &str,
    name: &str,
    input: &str,
    output: Option<&str>,
    ok: Option<bool>,
    duration_ms: Option<u64>,
) -> Value {
    let mut tool = json!({
        "itemId": item_id,
        "name": name,
        "label": name,
        "input": input,
    });
    // 刚开始的调用没有结论：不写 ok，房间才知道它还在跑。
    if let Some(ok) = ok {
        tool["ok"] = json!(ok);
    }
    let step = step_of(name, input);
    if !step.is_null() {
        tool["step"] = step;
    }
    if let Some(output) = output {
        tool["output"] = json!(output);
    }
    if let Some(ms) = duration_ms {
        tool["durationMs"] = json!(ms);
    }
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "at": crate::store::now(),
        "role": "agent",
        "kind": "activity",
        "turnId": ctx.turn_id,
        "from": { "botId": ctx.bot_id },
        "tool": tool,
    })
}

/// pi 的模型错误也按正常消息收尾；只有终态如实报失败，房间才不会把空回复当成完成。
fn error_of(message: &Value) -> Option<String> {
    if message.get("stopReason").and_then(Value::as_str) != Some("error") {
        return None;
    }
    Some(
        message
            .get("errorMessage")
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .unwrap_or("模型调用失败，pi 没有给出原因")
            .chars()
            .take(300)
            .collect(),
    )
}

fn settle_with_error(
    app: &Arc<App>,
    ctx: &DriverContext,
    settled: &mut bool,
    pi_error: &mut Option<String>,
    text: &str,
    usage: &TurnUsage,
) {
    match pi_error.take() {
        Some(error) => settle_pi(
            app,
            ctx,
            settled,
            TurnOutcome::Failed,
            &format!("pi 调用模型失败：{error}"),
            usage,
        ),
        None => settle_pi(app, ctx, settled, TurnOutcome::Completed, text, usage),
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_confirm_title_carries_the_tool_not_the_copy() {
        assert_eq!(tool_from_title("Allow bash?"), "bash");
        assert_eq!(
            tool_from_title("Allow mcp__lodge_gate__submit_plan?"),
            "mcp__lodge_gate__submit_plan"
        );
        // 翻译过的标题不是机器数据：解析不出来就留空，绝不拿一个猜出来的名字去判权限。
        assert_eq!(tool_from_title("允许 bash 吗？"), "");
        assert_eq!(tool_from_title("Allow ?"), "");
        assert_eq!(tool_from_title(""), "");
    }

    #[test]
    fn the_extension_speaks_the_title_format_the_driver_parses() {
        assert!(MCP_EXTENSION.contains("ctx.ui.confirm(`Allow ${name}?`"));
    }

    #[test]
    fn activity_says_what_the_tool_is_touching() {
        // 房间和界面靠这一步说“在跑什么”；只有工具名等于看不见。
        let bash = step_of("bash", r#"{"command":"cd /tmp && rm -rf vnl\nnpm test"}"#);
        assert_eq!(bash["activity"], "command");
        assert_eq!(bash["target"], "cd /tmp && rm -rf vnl");
        assert!(bash["detail"].as_str().unwrap().contains("npm test"));

        let write = step_of("write", r#"{"path":"src/export.js","content":"x"}"#);
        assert_eq!(write["target"], "src/export.js");
        let edit = step_of("edit", r#"{"file_path":"/repo/a.md"}"#);
        assert_eq!(edit["target"], "/repo/a.md");

        let grep = step_of("grep", r#"{"pattern":"TODO","path":"src"}"#);
        assert_eq!(grep["target"], "src");
        let find = step_of("find", r#"{"query":"*.mjs"}"#);
        assert!(find.is_null(), "没有可说的目标就不编一个");

        let long = step_of("bash", &format!(r#"{{"command":"{}"}}"#, "x".repeat(500)));
        assert!(long["target"].as_str().unwrap().chars().count() <= 201);
        assert!(step_of("bash", "not json").is_null());
    }
}

/// 无副作用重试的退避：200ms 起、翻倍、±10% 抖动（对齐 Codex 的 backoff）。
fn retry_delay_ms(attempt: u32) -> u64 {
    let base = 200u64.saturating_mul(1u64 << attempt.saturating_sub(1).min(6));
    let jitter = 0.9 + (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() % 200)
        .unwrap_or(0) as f64) / 1000.0;
    (base as f64 * jitter) as u64
}
