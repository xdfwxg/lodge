//! 驱动：假驱动（契约探针）与真实 pi（外部 CLI，最小 runtime 契约）。
//! 基座不认识房型和角色；驱动只回答一次回合怎么跑、怎么停。

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
    Unsupported,
}

pub struct DriverContext {
    pub thread_id: String,
    pub bot_id: String,
    pub turn_id: String,
    pub prompt: String,
    /// 成员的职责与语气（Lodge 的 soul）；有就作为 pi 的 system prompt。
    pub system: String,
    pub model: String,
    pub cwd: String,
    pub lease: Lease,
    pub cancel: Arc<crate::turns::CancelToken>,
}

pub fn spawn(app: Arc<App>, kind: DriverKind, ctx: DriverContext) {
    tokio::spawn(async move {
        match kind {
            DriverKind::Fake => fake::run(app, ctx).await,
            DriverKind::Pi => pi::run(app, ctx).await,
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
pub(crate) fn emit_question(
    app: &App,
    ctx: &DriverContext,
    request_id: &str,
    tool: &str,
    text: &str,
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

/// 等回答；取消或超时都返回 None，让调用方落对应的终态。
pub(crate) async fn wait_ask(
    app: &App,
    ctx: &DriverContext,
    request_id: &str,
    rx: oneshot::Receiver<Decision>,
) -> Option<Decision> {
    tokio::select! {
        _ = ctx.cancel.wait_cancelled() => {
            app.turns.drop_card(request_id);
            None
        }
        result = tokio::time::timeout(Duration::from_secs(900), rx) => match result {
            Ok(Ok(decision)) => Some(decision),
            _ => {
                app.turns.drop_card(request_id);
                None
            }
        }
    }
}
