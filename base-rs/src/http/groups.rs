//! groups：共享线程与投递。基座只认成员和线程，不认房型。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::{json, Value};
use uuid::Uuid;

use super::{fail, internal, ApiError};
use crate::events::group_frame;
use crate::service::{self, StartError};
use crate::state::App;
use crate::store::now;

pub async fn create(
    State(app): State<Arc<App>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mut group = body;
    group["id"] = json!(Uuid::new_v4().to_string());
    group["threadId"] = json!(Uuid::new_v4().to_string());
    if group.get("name").and_then(Value::as_str).is_none() {
        group["name"] = json!("room");
    }
    if group.get("memberIds").is_none() {
        group["memberIds"] = json!([]);
    }
    if group.get("defaultResponder").is_none() {
        group["defaultResponder"] = json!({ "kind": "mentions" });
    }
    group["createdAt"] = json!(now());
    app.store.upsert_group(&group).map_err(internal)?;
    app.events.emit(group_frame(group.clone()));
    Ok(Json(json!({ "group": group })))
}

pub async fn patch(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(mut group) = app.store.group(&id).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个群"));
    };
    merge(&mut group, &body);
    app.store.upsert_group(&group).map_err(internal)?;
    app.events.emit(group_frame(group.clone()));
    Ok(Json(json!({ "group": group })))
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
    if let Some(group) = app.store.group(id).map_err(internal)? {
        if let Some(thread_id) = group.get("threadId").and_then(Value::as_str) {
            if let Some(handle) = app.turns.cancel(thread_id) {
                crate::turns::settle_forced(
                    &app.store,
                    &app.events,
                    &handle.thread_id,
                    &handle.bot_id,
                    &handle.turn_id,
                    crate::model::TurnOutcome::Stopped,
                    "房间已删除",
                    &crate::model::TurnUsage::default(),
                );
            }
        }
    }
    app.store.delete_group(id).map_err(internal)?;
    Ok(())
}

pub async fn setup(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(mut group) = app.store.group(&id).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个群"));
    };
    merge(&mut group, &body);
    group["setup"] = json!(true);
    app.store.upsert_group(&group).map_err(internal)?;
    app.events.emit(group_frame(group.clone()));
    Ok(Json(json!({ "ok": true })))
}

pub async fn task(
    State(app): State<Arc<App>>,
    Path((id, _thread)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(mut group) = app.store.group(&id).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个群"));
    };
    merge(&mut group, &body);
    app.store.upsert_group(&group).map_err(internal)?;
    app.events.emit(group_frame(group.clone()));
    Ok(Json(json!({ "ok": true })))
}

pub async fn hold(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(mut group) = app.store.group(&id).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个群"));
    };
    let bot_id = body.get("botId").and_then(Value::as_str).unwrap_or("");
    let held = body.get("held").and_then(Value::as_bool).unwrap_or(false);
    if bot_id.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "缺少成员"));
    }
    group["holds"][bot_id] = json!(held);
    app.store.upsert_group(&group).map_err(internal)?;
    app.events.emit(group_frame(group.clone()));
    Ok(Json(json!({ "ok": true })))
}

// 这个基座没有排队队列；steer/cancel 明确 404，不返回含糊的“可能成功”。
pub async fn queue_ack() -> Result<Json<Value>, ApiError> {
    Err(fail(StatusCode::NOT_FOUND, "这个基座没有排队队列"))
}

pub async fn message(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let mentions = body
        .get("mentions")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let started = service::start_turn(
        &app,
        service::StartTurn {
            group_id: id,
            text: body.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
            send_id: body.get("sendId").and_then(Value::as_str).unwrap_or("").to_string(),
            mentions,
        },
    )
    .map_err(start_error)?;
    Ok(Json(json!({
        "message": { "id": started.message_id, "sendId": started.send_id },
        "threadId": started.thread_id,
    })))
}

fn start_error(error: StartError) -> ApiError {
    match error {
        StartError::NotFound(message) => fail(StatusCode::NOT_FOUND, &message),
        StartError::Conflict(message) => fail(StatusCode::CONFLICT, &message),
        StartError::BadRequest(message) => fail(StatusCode::BAD_REQUEST, &message),
        StartError::Internal(error) => internal(error),
    }
}
fn merge(target: &mut Value, patch: &Value) {
    if let (Some(target), Some(patch)) = (target.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            // 群身份和忙碌态由基座持有，不让 patch 改走。
            if matches!(key.as_str(), "id" | "threadId" | "working" | "busyBotId" | "busyTurnId") {
                continue;
            }
            target.insert(key.clone(), value.clone());
        }
    }
}
