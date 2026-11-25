//! bots：成员身体。基座只存执行配置，不认识成员在房间里的角色。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{fail, internal, ApiError};
use crate::state::App;
use crate::store::now;
use crate::turns::settle_forced;

pub async fn list(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    let bots = app.store.bots().map_err(internal)?;
    let groups = app.store.groups().map_err(internal)?;
    Ok(Json(json!({ "bots": bots, "groups": groups })))
}

pub async fn create(
    State(app): State<Arc<App>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mut bot = body;
    if bot.get("id").and_then(Value::as_str).is_none() {
        bot["id"] = json!(Uuid::new_v4().to_string());
    }
    if bot.get("threadId").and_then(Value::as_str).is_none() {
        bot["threadId"] = json!(Uuid::new_v4().to_string());
    }
    if bot.get("name").and_then(Value::as_str).is_none() {
        bot["name"] = json!("member");
    }
    bot["createdAt"] = json!(now());
    app.store.upsert_bot(&bot).map_err(internal)?;
    Ok(Json(json!({ "bot": bot })))
}

pub async fn patch(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(mut bot) = app.store.bot(&id).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个成员"));
    };
    merge(&mut bot, &body);
    app.store.upsert_bot(&bot).map_err(internal)?;
    Ok(Json(json!({ "bot": bot })))
}

pub async fn delete(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    delete_locked(&app, &id)?;
    Ok(Json(json!({ "ok": true })))
}

fn delete_locked(app: &App, id: &str) -> Result<(), ApiError> {
    let _lifecycle = app
        .lifecycle
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(handle) = app.turns.cancel_bot(id) {
        settle_forced(
            &app.store,
            &app.events,
            &handle.thread_id,
            &handle.bot_id,
            &handle.turn_id,
            crate::model::TurnOutcome::Stopped,
            "成员已删除",
            &crate::model::TurnUsage::default(),
        );
    }
    app.store.delete_bot(id).map_err(internal)?;
    Ok(())
}

pub async fn set_skills(
    State(_app): State<Arc<App>>,
    Path(_id): Path<String>,
    Json(body): Json<Value>,
) -> Json<Value> {
    Json(json!({ "assignedSkills": body.get("skills").cloned().unwrap_or(json!([])) }))
}

pub async fn interrupt(State(app): State<Arc<App>>, Path(id): Path<String>) -> Json<Value> {
    if let Some(handle) = app.turns.cancel_bot(&id) {
        settle_forced(
            &app.store,
            &app.events,
            &handle.thread_id,
            &handle.bot_id,
            &handle.turn_id,
            crate::model::TurnOutcome::Stopped,
            "已停下",
            &crate::model::TurnUsage::default(),
        );
    }
    Json(json!({ "ok": true }))
}

fn merge(target: &mut Value, patch: &Value) {
    if let (Some(target), Some(patch)) = (target.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            // 身份不能被 patch 改走；id/threadId 只由创建时决定。
            if key == "id" || key == "threadId" {
                continue;
            }
            target.insert(key.clone(), value.clone());
        }
    }
}
