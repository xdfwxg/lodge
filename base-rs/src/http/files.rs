//! 附件与文件：字节落盘，元数据入库。名字由基座生成（uuid + 扩展名），
//! 别人塞进来的路径一律不认；原始文件名只用于显示。

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Json, Response};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{fail, internal, ApiError};
use crate::state::App;

const MAX_BYTES: usize = 12 * 1024 * 1024;

#[derive(Deserialize)]
pub struct UploadQuery {
    name: Option<String>,
}

fn extension_for(mime: &str, original: &str) -> String {
    let by_mime = match mime {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "text/plain" => Some("txt"),
        "application/json" => Some("json"),
        _ => None,
    };
    if let Some(ext) = by_mime {
        return ext.to_string();
    }
    let ext = original
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .filter(|ext| !ext.is_empty() && ext.len() <= 10 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".to_string());
    ext
}

fn name_of(ext: &str) -> String {
    format!("{}.{ext}", uuid::Uuid::new_v4())
}

/// 只认基座生成的 uuid 文件名；路径分隔符和 `..` 进不来。
fn valid_attachment_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    if ext.is_empty() || ext.len() > 10 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    match uuid::Uuid::parse_str(stem) {
        Ok(id) => id.get_version_num() == 4,
        Err(_) => false,
    }
}

fn write_file(app: &App, name: &str, bytes: &Bytes) -> Result<(), ApiError> {
    let dir = app.store.dir().join("attachments");
    std::fs::create_dir_all(&dir).map_err(internal)?;
    std::fs::write(dir.join(name), bytes).map_err(internal)
}

pub async fn upload_image(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if !mime.starts_with("image/") {
        return Err(fail(StatusCode::BAD_REQUEST, "这里只收图片；文件走 /api/files"));
    }
    if body.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "没有收到图片"));
    }
    if body.len() > MAX_BYTES {
        return Err(fail(StatusCode::PAYLOAD_TOO_LARGE, "图片太大了"));
    }
    let name = name_of(&extension_for(&mime, ""));
    write_file(&app, &name, &body)?;
    app.store
        .save_attachment(&name, &mime, &name, body.len() as i64)
        .map_err(internal)?;
    Ok(Json(json!({
        "path": name,
        "name": name,
        "mime": mime,
        "bytes": body.len(),
    })))
}

pub async fn upload_file(
    State(app): State<Arc<App>>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    if body.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "没有收到文件"));
    }
    if body.len() > MAX_BYTES {
        return Err(fail(StatusCode::PAYLOAD_TOO_LARGE, "文件太大了"));
    }
    let original = query
        .name
        .as_deref()
        .unwrap_or("")
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_ascii_lowercase();
    let name = name_of(&extension_for(&mime, &original));
    write_file(&app, &name, &body)?;
    app.store
        .save_attachment(&name, &mime, &original, body.len() as i64)
        .map_err(internal)?;
    Ok(Json(json!({
        "path": name,
        "name": if original.is_empty() { name.clone() } else { original },
        "mime": mime,
        "bytes": body.len(),
    })))
}

pub async fn read(
    State(app): State<Arc<App>>,
    Path(name): Path<String>,
) -> Result<Response, ApiError> {
    if !valid_attachment_name(&name) {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个附件"));
    }
    let Some((mime, _original, _bytes)) = app.store.attachment(&name).map_err(internal)? else {
        return Err(fail(StatusCode::NOT_FOUND, "没有这个附件"));
    };
    let path = app.store.dir().join("attachments").join(&name);
    let bytes = std::fs::read(path).map_err(|_| fail(StatusCode::NOT_FOUND, "没有这个附件"))?;
    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, mime)],
        bytes,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_uuid_names_with_a_short_extension_are_read() {
        let id = uuid::Uuid::new_v4();
        assert!(valid_attachment_name(&format!("{id}.png")));
        assert!(!valid_attachment_name("../secret.png"));
        assert!(!valid_attachment_name(&format!("{id}")));
        assert!(!valid_attachment_name(&format!("{id}.toolongextension")));
        assert!(!valid_attachment_name("00000000-0000-0000-0000-000000000000.png"));
    }

    #[test]
    fn extensions_come_from_the_type_then_the_original_name() {
        assert_eq!(extension_for("image/png", ""), "png");
        assert_eq!(extension_for("image/jpeg", ""), "jpg");
        assert_eq!(extension_for("application/octet-stream", "notes.md"), "md");
        assert_eq!(extension_for("application/octet-stream", "no-extension"), "bin");
        assert_eq!(extension_for("application/octet-stream", "../x.sh"), "sh");
    }
}
