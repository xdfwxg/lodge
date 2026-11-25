//! 假驱动：契约测试的确定性探针，不调模型。
//! 三种回合：普通 echo、权限卡、可中断的慢回合。

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use super::{emit_question, prepare_ask, wait_ask, DriverContext};
use crate::events::runtime_frame;
use crate::model::{TurnOutcome, TurnUsage};
use crate::state::App;
use crate::turns::settle;

pub(crate) async fn run(app: Arc<App>, ctx: DriverContext) {
    if let Some(tool) = ctx.prompt.strip_prefix("权限:") {
        let tool = if tool.trim().is_empty() { "bash" } else { tool.trim() };
        let request_id = uuid::Uuid::new_v4().to_string();
        let rx = prepare_ask(&app, &request_id);
        if !emit_question(&app, &ctx, &request_id, tool, &format!("要用 {tool} 吗？"), &[]) {
            app.turns.drop_card(&request_id);
            settle(
                &app.turns,
                &app.store,
                &app.events,
                &ctx.thread_id,
                &ctx.bot_id,
                &ctx.turn_id,
                TurnOutcome::Failed,
                "审批卡没能保存；这一回合没有继续。",
                &TurnUsage::default(),
            );
            return;
        }
        let Some(decision) = wait_ask(&app, &ctx, &request_id, rx).await else {
            if !ctx.cancel.is_cancelled() {
                settle(
                    &app.turns,
                    &app.store,
                    &app.events,
                    &ctx.thread_id,
                    &ctx.bot_id,
                    &ctx.turn_id,
                    TurnOutcome::Expired,
                    "审批超时：这一回合没有继续。",
                    &TurnUsage::default(),
                );
            }
            return;
        };
        if ctx.cancel.is_cancelled() {
            return;
        }
        let text = if decision.behavior == "allow" {
            format!("已允许 {tool}")
        } else {
            format!("已拒绝 {tool}")
        };
        settle(
            &app.turns,
            &app.store,
            &app.events,
            &ctx.thread_id,
            &ctx.bot_id,
            &ctx.turn_id,
            TurnOutcome::Completed,
            &text,
            &TurnUsage::default(),
        );
        return;
    }

    if ctx.prompt.trim() == "慢" {
        for _ in 0..300 {
            if ctx.cancel.is_cancelled() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        settle(
            &app.turns,
            &app.store,
            &app.events,
            &ctx.thread_id,
            &ctx.bot_id,
            &ctx.turn_id,
            TurnOutcome::Completed,
            "慢回合完成",
            &TurnUsage::default(),
        );
        return;
    }

    app.events.emit(runtime_frame(
        &ctx.thread_id,
        json!({
            "threadId": ctx.thread_id,
            "botId": ctx.bot_id,
            "turnId": ctx.turn_id,
            "type": "content.delta",
            "streamKind": "assistant_text",
            "delta": "echo: ",
        }),
    ));
    tokio::time::sleep(Duration::from_millis(20)).await;
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
        TurnOutcome::Completed,
        &format!("echo: {}", ctx.prompt),
        &TurnUsage { input: 1, output: 1, cache_read: 0 },
    );
}
