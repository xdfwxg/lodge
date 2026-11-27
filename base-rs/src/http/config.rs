//! health / instances / config。instances 由发现器实时给出，不写死模型清单。

use std::sync::Arc;

use axum::extract::State;
use axum::response::Json;
use serde_json::{json, Value};

use crate::state::App;

pub async fn health(State(app): State<Arc<App>>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "version": "0.2.0-slice",
        "storage": if app.store.degraded() { "degraded" } else { "ok" },
        "box": crate::sandbox::state(),
        // 房间能选哪些上网方式：旧基座没有这一项，房间就不能设“只连模型”。
        "network_modes": ["proxy", "model", "none"],
        "egress": if app.egress.is_some() { "proxy" } else { "off" },
        // 自检结果：ok=false 时新回合会被拒绝，原因在 problems 里。
        "self_check": app.self_check.to_json(),
        "egress_blocked": app
            .egress
            .as_ref()
            .map(|proxy| proxy.blocked.load(std::sync::atomic::Ordering::Relaxed))
            .unwrap_or(0),
    }))
}

pub async fn instances(State(app): State<Arc<App>>) -> Json<Value> {
    let mut list = Vec::new();
    if app.fake {
        list.push(json!({
            "instanceId": "fake",
            "driverKind": "fake",
            "displayName": "Fake",
            "snapshot": { "state": "available" },
            "models": {
                "default": "fake/echo",
                "options": [{ "id": "fake/echo", "label": "Echo" }]
            },
            "capabilities": { "approvalReview": true, "streaming": true }
        }));
    }
    for discovered in app.discovery.list().await {
        list.push(discovered.to_instance());
    }
    Json(json!({ "instances": list }))
}

pub async fn get_config() -> Json<Value> {
    Json(json!({ "version": 1, "features": { "skillsLibrary": true } }))
}

/// 功能只有打开这一种状态；客户端按老习惯写一次 features 不算错。
pub async fn patch_config() -> Json<Value> {
    Json(json!({ "ok": true, "features": { "skillsLibrary": true } }))
}
