//! threads：历史与审批回答。卡只能回答一次；回合不在跑就诚实拒绝。

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{fail, internal, ApiError};
use crate::state::App;
use crate::turns::Decision;

#[derive(Deserialize)]
pub struct HistoryQuery {
    limit: Option<usize>,
}

pub async fn messages(
    State(app): State<Arc<App>>,
    Path(thread): Path<String>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<Value>, ApiError> {
    let messages = app
        .store
        .thread_messages(&thread, query.limit.unwrap_or(1000))
        .map_err(internal)?;
    Ok(Json(json!({ "messages": messages })))
}

pub async fn respond(
    State(app): State<Arc<App>>,
    Path(thread): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let request_id = body
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if request_id.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "缺少 requestId"));
    }
    let behavior = body
        .get("behavior")
        .and_then(Value::as_str)
        .unwrap_or("deny")
        .to_string();
    if !matches!(behavior.as_str(), "allow" | "deny" | "answer") {
        return Err(fail(StatusCode::BAD_REQUEST, "回答只能是 allow、deny 或 answer"));
    }
    let Some(card) = app.store.take_card(&request_id).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这张卡"));
    };
    if card.thread_id != thread {
        // 误投的卡放回去，不能因为一次错线程的回答把卡吃掉。
        app.store.save_card(&card).map_err(internal)?;
        return Err(fail(StatusCode::NOT_FOUND, "这张卡不属于这个线程"));
    }
    let message = body
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string);
    let decision = Decision { behavior, message };
    if !app.turns.answer(&request_id, decision) {
        return Err(fail(StatusCode::CONFLICT, "这一回合已经不在等回答了"));
    }
    Ok(Json(json!({ "ok": true })))
}
