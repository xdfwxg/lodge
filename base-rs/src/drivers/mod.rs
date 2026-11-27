//! 驱动：假驱动（契约探针）、真实 pi / claude / codex（外部 CLI，最小 runtime 契约）。
//! 基座不认识房型和角色；驱动只回答一次回合怎么跑、怎么停。
//!
//! claude v1 刻意不带内置工具（`--tools ""`），技能正文由一个只有 `use_skill` 的 MCP 服务器现取；
//! codex 用基座沙箱当边界（`--sandbox danger-full-access`），技能写进每回合的 `CODEX_HOME/skills`。
//! 两者都只用于聊天成员；工作室请用 pi。

pub mod claude;
pub mod codex;
pub mod fake;
pub mod pi;

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use tokio::sync::oneshot;

use crate::events::message_frame;
use crate::model::{Lease, TurnOutcome, TurnUsage};
use crate::state::App;
use crate::store::{now, CardRow};
use crate::turns::{settle, Decision};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DriverKind {
    Fake,
    Pi,
    Claude,
    Codex,
    Unsupported,
}

pub struct DriverContext {
    pub thread_id: String,
    pub bot_id: String,
    pub turn_id: String,
    pub prompt: String,
    /// 成员的职责与语气（Lodge 的 soul）；有就作为 pi 的 system prompt。
    pub system: String,
    /// 这个成员分到的技能（名字, 正文）。正文按需读：pi 由 use_skill 工具取，别的驱动直接拼。
    pub skills: Vec<(String, String)>,
    pub model: String,
    /// 这一回合的边界（工作目录、可写根、读隔离、出网）。只有落在进程里的驱动用得到；
    /// 建不起来时它就不存在，驱动必须让回合诚实失败。
    pub sandbox: Option<crate::sandbox::TurnSandbox>,
    /// bot 设置里声明的原生工具（read/write/edit/bash…）；空就是不给工具。
    pub native_tools: Vec<String>,
    /// 这回合挂上的 MCP 工具（按真名写的模式，如 `mcp__lodge_gate__*`）。
    pub mcp_tools: Vec<String>,
    /// 工作区已经同意的 MCP 提供方：这些服务器的工具不再逐条问。
    pub auto_mcp_servers: Vec<String>,
    /// 这次回合要挂的 MCP 服务器（mcp.json 结构）；None 表示不挂。
    pub mcp_json: Option<String>,
    /// Lodge 的 deny 选择器翻成 pi 的排除名单。
    pub exclude_tools: Vec<String>,
    /// 这一回合的工具调用数与时长上限；到点就停，终态写清原因。
    pub budget: crate::model::TurnBudget,
    /// 回合开始时刻：等审批只等到这一回合的剩余预算，不会在卡上再借一份。
    pub started_at: std::time::Instant,
    /// 审批级别：ask 时写/执行和外部工具先问人；auto 直接放行。
    pub approval_mode: String,
    pub lease: Lease,
    pub cancel: Arc<crate::turns::CancelToken>,
}

pub fn spawn(app: Arc<App>, kind: DriverKind, ctx: DriverContext) {
    tokio::spawn(async move {
        match kind {
            DriverKind::Fake => fake::run(app, ctx).await,
            DriverKind::Pi => pi::run(app, ctx).await,
            DriverKind::Claude => claude::run(app, ctx).await,
            DriverKind::Codex => codex::run(app, ctx).await,
            DriverKind::Unsupported => {
                settle(
                    &app.turns,
                    &app.store,
                    &app.events,
                    &ctx.thread_id,
                    &ctx.bot_id,
                    &ctx.turn_id,
                    TurnOutcome::Failed,
                    "这个成员用的驱动还没有接入；换一个模型或等驱动上线。",
                    &TurnUsage::default(),
                );
            }
        }
    });
}

/// 卡先落库再发事件：断线重连能看到同一张卡。落库失败返回 false，回合不能假装在等人。
/// 技能清单：名字 + 一句话。正文永远不进提示词，按需读由各引擎自己的机制负责。
pub fn skill_catalog(skills: &[(String, String)]) -> String {
    skill_catalog_in(skills, None)
}

/// 有目录时把正文文件也写进清单：没有 use_skill 工具的引擎自己读这份文件。
pub fn skill_catalog_in(skills: &[(String, String)], dir: Option<&std::path::Path>) -> String {
    if skills.is_empty() {
        return String::new();
    }
    let mut out = match dir {
        Some(_) => "可用的技能（需要时读对应的正文文件）：".to_string(),
        None => "可用的技能（需要时用 use_skill 读全文）：".to_string(),
    };
    for (name, text) in skills {
        match dir {
            Some(dir) => out.push_str(&format!(
                "\n- {}：{}（正文：{}）",
                name,
                skill_summary(text),
                dir.join(format!("{name}.md")).display()
            )),
            None => out.push_str(&format!("\n- {}：{}", name, skill_summary(text))),
        }
    }
    out
}

/// 技能正文写进回合目录：pi 的扩展、claude 的 use_skill 服务器都从这里读。
pub fn write_skill_files(dir: &std::path::Path, skills: &[(String, String)]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    for (name, text) in skills {
        std::fs::write(dir.join(format!("{name}.md")), text)?;
    }
    Ok(())
}

/// 技能文件夹形态（`<root>/<name>/SKILL.md`）：给按目录发现技能的引擎（codex）。
pub fn write_skill_dirs(root: &std::path::Path, skills: &[(String, String)]) -> std::io::Result<()> {
    for (name, text) in skills {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("SKILL.md"), text)?;
    }
    Ok(())
}

/// 不会自己读技能的引擎（claude、codex）用它：一个只暴露 use_skill 的 stdio MCP 服务器。
pub const SKILL_MCP_SCRIPT: &str = include_str!("skill-mcp.mjs");

/// 给引擎的 MCP 配置：只有这一个服务器，正文从本回合的技能目录读。
pub fn skill_mcp_json(script: &std::path::Path, dir: &std::path::Path) -> String {
    serde_json::json!({
        "mcpServers": {
            "lodge_skills": {
                "command": "node",
                "args": [script.display().to_string(), dir.display().to_string()],
            }
        }
    })
    .to_string()
}

// 一句话摘要：跳过 frontmatter 和空行，取第一行正文，去掉标题符，最多 80 字。
fn skill_summary(text: &str) -> String {
    let mut in_front = false;
    let mut seen_front = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if !seen_front {
                in_front = true;
                seen_front = true;
                continue;
            }
            if in_front {
                in_front = false;
                continue;
            }
        }
        if in_front || trimmed.is_empty() {
            continue;
        }
        let body = trimmed.trim_start_matches('#').trim();
        if body.is_empty() {
            continue;
        }
        let mut summary: String = body.chars().take(80).collect();
        if body.chars().count() > 80 {
            summary.push('…');
        }
        return summary;
    }
    String::new()
}

pub(crate) fn emit_question(
    app: &App,
    ctx: &DriverContext,
    request_id: &str,
    tool: &str,
    text: &str,
    detail: &str,
    options: &[String],
) -> bool {
    if let Err(error) = app.store.save_card(&CardRow {
        request_id: request_id.to_string(),
        thread_id: ctx.thread_id.clone(),
        bot_id: ctx.bot_id.clone(),
        turn_id: ctx.turn_id.clone(),
        tool: tool.to_string(),
        lease_id: Some(ctx.lease.id.clone()),
        payload: json!({
            "requestId": request_id,
            "requestType": "permission",
            "tool": tool,
            "subtitle": detail,
            "options": options,
        }),
    }) {
        eprintln!("lodge-base-slice: 保存审批卡失败: {error}");
        return false;
    }
    let mut card = json!({
        "requestId": request_id,
        "requestType": "permission",
        "tool": tool,
        "subtitle": detail,
    });
    if !options.is_empty() {
        card["options"] = json!(options);
    }
    app.events.emit(message_frame(
        &ctx.thread_id,
        json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "at": now(),
            "role": "agent",
            "kind": "question",
            "text": text,
            "turnId": ctx.turn_id,
            "from": { "botId": ctx.bot_id },
            "card": card,
        }),
    ));
    true
}

/// 先登记等待者，再发卡：客户端可能在事件到达的同一刻就回答。
pub(crate) fn prepare_ask(app: &App, request_id: &str) -> oneshot::Receiver<Decision> {
    let (tx, rx) = oneshot::channel();
    app.turns.register_card(request_id, tx);
    rx
}

/// 等审批卡的结果。进程在等人时死了也要当场收口，不能干等到回合预算用完。
pub(crate) enum AskOutcome {
    Decision(Decision),
    Interrupted,
    /// 成员进程已经退出（被杀、崩溃）：卡作废，回合按“进程退出”收口。
    Exited,
}

async fn child_exited(child: Option<&mut tokio::process::Child>) {
    match child {
        Some(child) => {
            let _ = child.wait().await;
        }
        None => std::future::pending::<()>().await,
    }
}

pub(crate) async fn wait_ask(
    app: &App,
    ctx: &DriverContext,
    request_id: &str,
    rx: oneshot::Receiver<Decision>,
    child: Option<&mut tokio::process::Child>,
) -> AskOutcome {
    tokio::select! {
        _ = ctx.cancel.wait_cancelled() => {
            app.turns.drop_card(request_id);
            AskOutcome::Interrupted
        }
        // 进程没了，卡就没有人能回答：立刻收口，原因写“进程退出”。
        _ = child_exited(child) => {
            app.turns.drop_card(request_id);
            AskOutcome::Exited
        }
        // 等人回答可以等满这一回合的**剩余**预算；房间那边会先暂停并留卡，
        // 不能一到 15 分钟就把卡丢掉。剩余预算至少给一分钟，避免刚好到点就闪断。
        result = tokio::time::timeout(
            Duration::from_millis(
                ctx.budget
                    .max_ms
                    .saturating_sub(ctx.started_at.elapsed().as_millis() as u64)
                    .max(60_000),
            ),
            rx,
        ) => match result {
            Ok(Ok(decision)) => AskOutcome::Decision(decision),
            _ => {
                app.turns.drop_card(request_id);
                AskOutcome::Interrupted
            }
        }
    }
}

/// 驱动每轮把房间最近的对话带上：两个 CLI 驱动都靠这一条共享事实，
/// 不依赖 CLI 自己的会话，模型换代或会话结束都不影响房间记忆。
pub(crate) fn thread_context(app: &App, thread_id: &str) -> String {
    // 活动与 digest 也占行数，所以多取一些，再只留最近 12 条成员文本。
    let Ok(messages) = app.store.thread_messages(thread_id, 60) else {
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
        if message.get("kind").and_then(serde_json::Value::as_str) != Some("text") {
            continue;
        }
        let text = message
            .get("text")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .trim();
        if text.is_empty() {
            continue;
        }
        let bot_id = message
            .get("from")
            .and_then(|from| from.get("botId"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let name = names.get(bot_id).map(String::as_str).unwrap_or("成员");
        let text: String = text.chars().take(400).collect();
        lines.push(format!("{name}：{text}"));
    }
    lines.join("\n")
}

/// 进程没有给出终态就退出时的原因：优先用 stderr 尾巴，没有才用兜底句。
pub(crate) fn stderr_reason(tail: &Arc<std::sync::Mutex<String>>, fallback: &str) -> String {
    let text = tail
        .lock()
        .map(|text| text.trim().to_string())
        .unwrap_or_default();
    if text.is_empty() {
        fallback.to_string()
    } else {
        let lines: Vec<&str> = text.lines().collect();
        let start = lines.len().saturating_sub(8);
        format!("{fallback}：{}", lines[start..].join(" / "))
    }
}

/// 时间预算的写法：短预算说秒，长预算说分钟，不把 1.5 秒写成「1 分钟」。
pub(crate) fn time_limit_text(max_ms: u64) -> String {
    if max_ms >= 60_000 {
        format!("{} 分钟", max_ms / 60_000)
    } else {
        format!("{:.1} 秒", max_ms as f64 / 1000.0)
    }
}
