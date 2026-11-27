//! MCP 服务器注册表：名字 + 启动方式。谁是外部工具、谁挂哪些，仍然是 Lodge 的决定。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::{json, Value};

use super::{fail, internal, ApiError};
use crate::state::App;

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() => {}
        _ => return false,
    }
    name.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

fn shape(server: &Value) -> Value {
    let mut out = server.clone();
    if out.get("enabled").is_none() {
        out["enabled"] = json!(true);
    }
    out
}

pub async fn list(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    let servers = app.store.mcp_servers().map_err(internal)?;
    Ok(Json(json!({
        "servers": servers.iter().map(shape).collect::<Vec<_>>()
    })))
}

pub async fn create(
    State(app): State<Arc<App>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let name = body.get("name").and_then(Value::as_str).unwrap_or("");
    if !valid_name(name) {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "名字要小写字母开头，只能用小写字母、数字、_ 和 -",
        ));
    }
    let command = body.get("command").and_then(Value::as_str).unwrap_or("");
    let has_url = body.get("url").and_then(Value::as_str).is_some_and(|url| !url.is_empty());
    if command.is_empty() && !has_url {
        return Err(fail(StatusCode::BAD_REQUEST, "MCP 服务器要有 command 或 url"));
    }
    let mut server = body.clone();
    if server.get("enabled").is_none() {
        server["enabled"] = json!(true);
    }
    app.store.put_mcp_server(&server).map_err(internal)?;
    list(State(app)).await
}

pub async fn update(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if app.store.mcp_server(&name).map_err(internal)?.is_none() {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个 MCP 服务器"));
    }
    let mut server = body.clone();
    server["name"] = json!(name);
    app.store.put_mcp_server(&server).map_err(internal)?;
    list(State(app)).await
}

/// PATCH 只改传进来的字段：停用/恢复不该把一个服务器的启动参数抹掉。
pub async fn patch(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let Some(mut server) = app.store.mcp_server(&name).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个 MCP 服务器"));
    };
    let Some(fields) = body.as_object() else {
        return Err(fail(StatusCode::BAD_REQUEST, "PATCH 要一份对象"));
    };
    for (key, value) in fields {
        if key == "name" {
            continue;
        }
        server[key] = value.clone();
    }
    app.store.put_mcp_server(&server).map_err(internal)?;
    list(State(app)).await
}

pub async fn remove(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !app.store.delete_mcp_server(&name).map_err(internal)? {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个 MCP 服务器"));
    }
    Ok(Json(json!({ "ok": true })))
}
