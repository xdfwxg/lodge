//! 技能库：存 SKILL.md 正文，名字只从前言里取。
//! 基座不解释技能属于谁——分配是 bot 的数据，怎么用是 agent 的事。

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Json;
use serde_json::{json, Value};

use super::{fail, internal, ApiError};
use crate::state::App;

/// 前言里的 `name:`；没有前言或没有名字就不是一份技能，不猜文件名。
pub fn skill_name_of(text: &str) -> Option<String> {
    let trimmed = text.trim_start();
    let rest = trimmed.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let header = &rest[..end];
    for line in header.lines() {
        let line = line.trim();
        let Some(value) = line.strip_prefix("name:") else { continue };
        let name = value.trim().trim_matches('"').trim_matches('\'').trim();
        if !name.is_empty() && name.len() <= 64 {
            return Some(name.to_string());
        }
    }
    None
}

pub async fn list(State(app): State<Arc<App>>) -> Result<Json<Value>, ApiError> {
    let skills = app.store.skills().map_err(internal)?;
    Ok(Json(json!({
        "skills": skills
            .into_iter()
            .map(|(name, enabled)| json!({ "name": name, "enabled": enabled }))
            .collect::<Vec<_>>()
    })))
}

pub async fn read(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    match app.store.skill(&name).map_err(internal)? {
        Some((text, enabled)) => Ok(Json(json!({ "name": name, "text": text, "enabled": enabled }))),
        None => Err(fail(StatusCode::NOT_FOUND, "技能库里没有这个名字")),
    }
}

pub async fn import(
    State(app): State<Arc<App>>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let text = body.get("text").and_then(Value::as_str).unwrap_or("").trim();
    if text.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "技能正文不能为空"));
    }
    let Some(name) = skill_name_of(text) else {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "技能正文开头要有一段 --- 前言，里面写 name:",
        ));
    };
    let created = app
        .store
        .insert_skill(&name, text)
        .map_err(internal)?;
    // 同名技能保留库里已有的版本：覆盖会让升级后的技能悄悄改掉旧会话的纪律。
    Ok(Json(json!({ "name": name, "created": created })))
}

/// 删除一份技能。同名不覆盖是默认；要换正文就删掉旧的再导入新的，不留两套真相。
pub async fn delete(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !app.store.delete_skill(&name).map_err(internal)? {
        return Err(fail(StatusCode::NOT_FOUND, "技能库里没有这个名字"));
    }
    Ok(Json(json!({ "name": name, "deleted": true })))
}

pub async fn set_enabled(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let enabled = body.get("enabled").and_then(Value::as_bool);
    let Some(enabled) = enabled else {
        return Err(fail(StatusCode::BAD_REQUEST, "enabled 要写 true 或 false"));
    };
    if !app.store.set_skill_enabled(&name, enabled).map_err(internal)? {
        return Err(fail(StatusCode::NOT_FOUND, "技能库里没有这个名字"));
    }
    Ok(Json(json!({ "name": name, "enabled": enabled })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_skill_name_comes_from_the_frontmatter() {
        assert_eq!(
            skill_name_of("---\nname: lodge-build\ndescription: x\n---\n# Build\n"),
            Some("lodge-build".to_string())
        );
        assert_eq!(skill_name_of("---\ndescription: x\n---\n"), None);
        assert_eq!(skill_name_of("# no frontmatter\n"), None);
        assert_eq!(skill_name_of(""), None);
    }
}
