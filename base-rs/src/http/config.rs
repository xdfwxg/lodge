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
    Json(json!({ "version": 1, "features": { "skillsLibrary": false } }))
}

pub async fn patch_config() -> Json<Value> {
    Json(json!({ "ok": true }))
}
