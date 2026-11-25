//! 本机 agent 自动发现：只认命令行入口与版本，不猜模型能力。
//! 发现是基座的执行能力；用哪个 agent 仍是 Lodge 的决定。

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::process::Command;

/// 主流 agent：找到就列出；没有驱动的诚实标 unsupported，不冒充可用。
const AGENTS: &[(&str, &str, bool)] = &[
    ("pi", "Pi", true),
    ("claude", "Claude Code", false),
    ("codex", "Codex CLI", false),
    ("gemini", "Gemini CLI", false),
    ("opencode", "OpenCode", false),
    ("cursor-agent", "Cursor Agent", false),
    ("aider", "Aider", false),
];

#[derive(Clone, Debug)]
pub struct Discovered {
    pub kind: String,
    pub name: String,
    pub binary: Option<PathBuf>,
    pub version: Option<String>,
    /// 能探测到登录状态就带上；探测不了保持 None，不猜。
    pub authenticated: Option<bool>,
    pub state: String,
    pub reason: Option<String>,
}

impl Discovered {
    pub fn to_instance(&self) -> Value {
        let models = if self.kind == "pi" {
            let (default, options) = pi_models();
            json!({ "default": default, "options": options })
        } else {
            json!({ "default": "", "options": [] })
        };
        let mut snapshot = json!({ "state": self.state });
        if let Some(reason) = &self.reason {
            snapshot["reason"] = json!(reason);
        }
        if let Some(authenticated) = self.authenticated {
            snapshot["authenticated"] = json!(authenticated);
        }
        json!({
            "instanceId": self.kind,
            "driverKind": self.kind,
            "displayName": self.name,
            "binary": self.binary.as_ref().map(|path| path.display().to_string()),
            "version": self.version,
            "snapshot": snapshot,
            "models": models,
            "capabilities": if self.state == "available" {
                json!({ "approvalReview": true, "streaming": true })
            } else {
                json!({})
            },
        })
    }
}

pub struct Discovery {
    cache: Mutex<Option<(Instant, Vec<Discovered>)>>,
}

impl Default for Discovery {
    fn default() -> Self {
        Self { cache: Mutex::new(None) }
    }
}

impl Discovery {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn list(&self) -> Vec<Discovered> {
        if let Ok(cache) = self.cache.lock() {
            if let Some((at, list)) = cache.as_ref() {
                if at.elapsed() < Duration::from_secs(60) {
                    return list.clone();
                }
            }
        }
        let list = discover().await;
        if let Ok(mut cache) = self.cache.lock() {
            *cache = Some((Instant::now(), list.clone()));
        }
        list
    }
}

pub async fn discover() -> Vec<Discovered> {
    let dirs = search_dirs();
    let pi_default = pi_models().0;
    // 版本与登录状态并发探测：一个慢 CLI 不能把 /api/instances 拖成二十秒。
    let mut found: Vec<(&str, &str, bool, Option<PathBuf>)> = Vec::new();
    let mut tasks = Vec::new();
    for (kind, name, supported) in AGENTS {
        let binary = find_in(&dirs, kind);
        if let Some(path) = &binary {
            let path = path.clone();
            let is_pi = *kind == "pi";
            let model = if is_pi { pi_default.clone() } else { String::new() };
            tasks.push((
                found.len(),
                tokio::spawn(async move {
                    let version = version_of(&path).await;
                    let authenticated = if is_pi { auth_of(&path, &model).await } else { None };
                    (version, authenticated)
                }),
            ));
        }
        found.push((kind, name, *supported, binary));
    }
    let mut probes: Vec<(Option<String>, Option<bool>)> = vec![(None, None); found.len()];
    for (index, task) in tasks {
        if let Ok(result) = task.await {
            probes[index] = result;
        }
    }
    found
        .into_iter()
        .enumerate()
        .map(|(index, (kind, name, supported, binary))| match binary {
            None => Discovered {
                kind: kind.to_string(),
                name: name.to_string(),
                binary: None,
                version: None,
                authenticated: None,
                state: "unavailable".to_string(),
                reason: Some(format!("没找到 {kind} 命令")),
            },
            Some(binary) => Discovered {
                kind: kind.to_string(),
                name: name.to_string(),
                binary: Some(binary),
                version: probes[index].0.take(),
                authenticated: probes[index].1,
                state: if supported { "available" } else { "unsupported" }.to_string(),
                reason: if supported { None } else { Some("驱动还没接入".to_string()) },
            },
        })
        .collect()
}

/// pi 能自己回答登录状态；其他家还没有统一的探测命令，保持 None。
async fn auth_of(binary: &Path, model: &str) -> Option<bool> {
    if model.trim().is_empty() {
        return None;
    }
    let child = Command::new(binary)
        .args(["auth", "check", "--json", "--no-refresh", "--model", model])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let output = tokio::time::timeout(Duration::from_secs(4), child.wait_with_output())
        .await
        .ok()?
        .ok()?;
    match output.status.code() {
        Some(0) => Some(true),
        Some(1) | Some(2) => Some(false),
        _ => None,
    }
}

pub fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join(".cargo/bin"));
    }
    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    let mut seen = std::collections::HashSet::new();
    dirs.into_iter().filter(|dir| seen.insert(dir.clone())).collect()
}

pub fn find_in(dirs: &[PathBuf], name: &str) -> Option<PathBuf> {
    for dir in dirs {
        let candidate = dir.join(name);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return path
            .metadata()
            .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

async fn version_of(binary: &Path) -> Option<String> {
    let child = Command::new(binary)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let output = tokio::time::timeout(Duration::from_secs(3), child.wait_with_output())
        .await
        .ok()?
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text.lines().next().unwrap_or("").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn finds_only_executables_on_the_search_path() {
        let dir = std::env::temp_dir().join(format!("lodge-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("my-agent");
        let mut handle = std::fs::File::create(&file).unwrap();
        handle.write_all(b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&file).unwrap().permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&file, permissions).unwrap();
        }
        assert_eq!(find_in(&[dir.clone()], "my-agent"), Some(file));
        assert_eq!(find_in(&[dir.clone()], "missing"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn pi_models() -> (String, Vec<Value>) {
    let settings = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".pi/agent/settings.json"));
    let Some(path) = settings else { return (String::new(), Vec::new()) };
    let Ok(text) = std::fs::read_to_string(path) else { return (String::new(), Vec::new()) };
    let Ok(value) = serde_json::from_str::<Value>(&text) else { return (String::new(), Vec::new()) };
    let provider = value.get("defaultProvider").and_then(Value::as_str).unwrap_or("");
    let model = value.get("defaultModel").and_then(Value::as_str).unwrap_or("");
    let default = if provider.is_empty() || model.is_empty() {
        model.to_string()
    } else {
        format!("{provider}/{model}")
    };
    let options = if default.is_empty() {
        Vec::new()
    } else {
        vec![json!({ "id": default, "label": default })]
    };
    (default, options)
}
