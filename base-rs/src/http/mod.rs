//! HTTP 层只做协议转换：参数校验、路由、SSE 封装；业务在 store / turns / driver。

pub mod bots;
pub mod config;
pub mod events;
pub mod files;
pub mod groups;
pub mod mcp;
pub mod sandbox;
pub mod skills;
pub mod threads;

use std::sync::Arc;

use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
use axum::response::Json;
use axum::routing::{delete, get, patch, post, put};
use axum::Router;
use serde_json::{json, Value};

use crate::state::App;

pub type ApiError = (StatusCode, Json<Value>);

pub fn fail(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({ "error": message })))
}

/// 写库失败：细节进日志，界面只看到一句能继续的话。
pub fn internal(error: impl std::fmt::Display) -> ApiError {
    eprintln!("lodge-base-slice: 存储错误: {error}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "基座这边出了点问题；稍后再试。" })),
    )
}

pub fn router(app: Arc<App>) -> Router {
    Router::new()
        .route("/api/health", get(config::health))
        .route("/api/instances", get(config::instances))
        .route("/api/config", get(config::get_config).patch(config::patch_config))
        .route("/api/bots", get(bots::list).post(bots::create))
        .route("/api/bots/:id", patch(bots::patch).delete(bots::delete))
        .route("/api/bots/:id/skills-library", put(bots::set_skills))
        .route("/api/bots/:id/interrupt", post(bots::interrupt))
        .route("/api/skills-library", get(skills::list).post(skills::import))
        .route(
            "/api/skills-library/:name",
            get(skills::read)
                .patch(skills::set_enabled)
                .delete(skills::delete),
        )
        .route("/api/groups", post(groups::create))
        .route("/api/groups/:id", patch(groups::patch).delete(groups::delete))
        .route("/api/groups/:id/setup", patch(groups::setup))
        .route("/api/groups/:id/tasks/:thread", patch(groups::task))
        .route("/api/groups/:id/messages", post(groups::message))
        .route("/api/groups/:id/holds", post(groups::hold))
        .route("/api/groups/:id/queue/:queue/steer", post(groups::queue_ack))
        .route("/api/groups/:id/queue/:queue", delete(groups::queue_ack))
        .route("/api/threads/:thread/respond", post(threads::respond))
        .route("/api/threads/:thread/messages", get(threads::messages))
        .route("/api/sandbox/run", post(sandbox::run))
        .route("/api/mcp/servers", get(mcp::list).post(mcp::create))
        .route(
            "/api/mcp/servers/:name",
            put(mcp::update).patch(mcp::patch).delete(mcp::remove),
        )
        .route(
            "/api/attachments",
            post(files::upload_image).layer(DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        .route("/api/attachments/:name", get(files::read))
        .route(
            "/api/files",
            post(files::upload_file).layer(DefaultBodyLimit::max(12 * 1024 * 1024)),
        )
        .route("/api/events", get(events::stream))
        .with_state(app)
}
