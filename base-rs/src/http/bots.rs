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
    // 技能分配写在单独的账本里；读回时投影到成员上，写入才有可核对的结果。
    // 派生字段不落库：PATCH 再写它也不会改变分配。
    let bots: Vec<Value> = bots
        .into_iter()
        .map(|mut bot| {
            if let Some(id) = bot.get("id").and_then(Value::as_str).map(str::to_string) {
                if let Ok(skills) = app.store.bot_skills(&id) {
                    bot["assignedSkills"] = json!(skills);
                }
            }
            bot
        })
        .collect();
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

/// 技能分配是 bot 的数据；库里没有的名字直接拒绝，不写一份假的回执。
pub async fn set_skills(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if app.store.bot(&id).map_err(internal)?.is_none() {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个成员"));
    }
    let Some(list) = body.get("skills").and_then(Value::as_array) else {
        return Err(fail(StatusCode::BAD_REQUEST, "skills 要是名字数组"));
    };
    let mut skills = Vec::new();
    for item in list {
        let Some(name) = item.as_str().filter(|name| !name.trim().is_empty()) else {
            return Err(fail(StatusCode::BAD_REQUEST, "技能名不能为空"));
        };
        if app.store.skill(name).map_err(internal)?.is_none() {
            return Err(fail(StatusCode::NOT_FOUND, &format!("技能库里没有 {name}")));
        }
        skills.push(name.to_string());
    }
    app.store.set_bot_skills(&id, &skills).map_err(internal)?;
    Ok(Json(json!({ "assignedSkills": skills })))
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

/// 只有身份和模型选择是 bot 的顶层字段；其余（soul、approvalMode、mcpServers、
/// nativeTools、budget、network…）都属于 `settings`。PATCH 必须落进 settings，
/// 否则服务读到的还是创建时那一份，策略更新是空操作。
fn merge(target: &mut Value, patch: &Value) {
    let Some(patch) = patch.as_object() else {
        return;
    };
    let Some(target) = target.as_object_mut() else {
        return;
    };
    let mut top: Vec<(String, Value)> = Vec::new();
    {
        let settings = target.entry("settings").or_insert_with(|| json!({}));
        if !settings.is_object() {
            *settings = json!({});
        }
        let settings = settings.as_object_mut().expect("settings is an object");
        for (key, value) in patch {
            // 身份不能被 patch 改走；id/threadId 只由创建时决定。
            if key == "id" || key == "threadId" {
                continue;
            }
            if key == "settings" {
                if let Some(value) = value.as_object() {
                    for (inner, inner_value) in value {
                        settings.insert(inner.clone(), inner_value.clone());
                    }
                }
                continue;
            }
            if key == "name" || key == "modelSelection" {
                top.push((key.clone(), value.clone()));
                continue;
            }
            settings.insert(key.clone(), value.clone());
        }
    }
    for (key, value) in top {
        target.insert(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::merge;
    use serde_json::json;

    #[test]
    fn a_patch_lands_in_settings_and_keeps_the_identity() {
        let mut bot = json!({
            "id": "bot-1",
            "threadId": "t-1",
            "name": "执行",
            "modelSelection": { "instanceId": "pi", "model": "m" },
            "settings": { "soul": "旧", "approvalMode": "ask" }
        });
        merge(&mut bot, &json!({
            "id": "hijack",
            "name": "新名字",
            "soul": "新",
            "approvalMode": "auto",
            "mcpServers": ["desktop"],
            "autoMcpServers": ["desktop"]
        }));
        assert_eq!(bot["id"], "bot-1");
        assert_eq!(bot["name"], "新名字");
        assert_eq!(bot["settings"]["soul"], "新");
        assert_eq!(bot["settings"]["approvalMode"], "auto");
        assert_eq!(bot["settings"]["mcpServers"][0], "desktop");
        assert_eq!(bot["settings"]["autoMcpServers"][0], "desktop");
        assert!(bot.get("soul").is_none(), "settings do not leak to the top level");
    }
}
