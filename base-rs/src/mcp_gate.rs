//! MCP 网关：每个外部服务器前面挂一层进程，只做三件事——裁结果、留原文、封顶工具面。
//! 协议是 MCP 的 stdio 形态：一行一个 JSON-RPC 消息。网关不改协议，只改两处响应：
//! `tools/list` 超量时截断，`tools/call` 的文本结果超预算时截断并把全文写进回合目录。
//! 这是 `--mcp-gate` 模式：由 pi 按服务器注册拉起，上游命令放在 `LODGE_MCP_UPSTREAM` 里。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::{json, Map, Value};

/// 上游服务器定义（和 mcp.json 里的一条同形：command / args / env / cwd）。
pub const UPSTREAM_ENV: &str = "LODGE_MCP_UPSTREAM";
/// 全文落在哪：回合自己的临时目录，沙箱里可读。
pub const SPILL_DIR_ENV: &str = "LODGE_MCP_SPILL_DIR";
/// 一条工具结果最多留多少字符。
pub const BUDGET_ENV: &str = "LODGE_MCP_BUDGET";
/// 一次暴露多少个工具。
pub const TOOL_CAP_ENV: &str = "LODGE_MCP_TOOL_CAP";
/// 服务器名：只用来给截断后的全文起名字。
pub const NAME_ENV: &str = "LODGE_MCP_NAME";

pub const DEFAULT_BUDGET: usize = 8_000;
pub const DEFAULT_TOOL_CAP: usize = 64;
const DESCRIPTION_LIMIT: usize = 600;
/// 截断后的全文靠它分段读回来：不依赖成员有没有原生读文件工具。
pub const READ_TOOL: &str = "lodge_mcp_read";
/// 房间契约工具：平台自己的服务器，不过外部网关（它有回执握手，也不该多出一只手）。
pub const CONTRACT_SERVER: &str = "lodge_gate";
const READ_DEFAULT: usize = 4_000;
const READ_MAX: usize = 8_000;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Kind {
    Call,
    List,
    Other,
}

/// 把库里的 stdio 服务器换成「基座网关」：pi 照旧注册，实际连的是这一层。
/// 远程（url）服务器没有本地进程可拦，原样交出去。
pub fn wrap_server(
    name: &str,
    spec: &Value,
    exe: &Path,
    spill: &Path,
    budget: usize,
    cap: usize,
) -> Value {
    if spec.get("command").and_then(Value::as_str).is_none() {
        return spec.clone();
    }
    let mut env = Map::new();
    env.insert(UPSTREAM_ENV.to_string(), Value::String(spec.to_string()));
    env.insert(NAME_ENV.to_string(), Value::String(name.to_string()));
    env.insert(
        SPILL_DIR_ENV.to_string(),
        Value::String(spill.display().to_string()),
    );
    // MCP 的 env 只收字符串：数字也写成字符串。
    env.insert(BUDGET_ENV.to_string(), Value::String(budget.to_string()));
    env.insert(TOOL_CAP_ENV.to_string(), Value::String(cap.to_string()));
    json!({
        "command": exe.display().to_string(),
        "args": ["--mcp-gate"],
        "env": env,
        "exposure": "direct",
    })
}

struct Config {
    budget: usize,
    cap: usize,
    spill: Option<PathBuf>,
    name: String,
}

fn upstream_from_env() -> Result<Value, String> {
    let raw = std::env::var(UPSTREAM_ENV).map_err(|_| "没有上游服务器定义".to_string())?;
    let parsed: Value = serde_json::from_str(&raw).map_err(|error| format!("上游定义不是 JSON：{error}"))?;
    if parsed.get("command").and_then(Value::as_str).is_none() {
        return Err("上游定义里没有 command：网关只代理 stdio 服务器".to_string());
    }
    Ok(parsed)
}

fn command_of(upstream: &Value) -> Result<Command, String> {
    let program = upstream
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| "上游定义里没有 command".to_string())?;
    let mut command = Command::new(program);
    if let Some(args) = upstream.get("args").and_then(Value::as_array) {
        for arg in args {
            match arg.as_str() {
                Some(text) => {
                    command.arg(text);
                }
                None => return Err("上游 args 里只能放字符串".to_string()),
            }
        }
    }
    if let Some(env) = upstream.get("env").and_then(Value::as_object) {
        for (key, value) in env {
            match value {
                Value::String(text) => {
                    command.env(key, text);
                }
                Value::Null => {
                    command.env_remove(key);
                }
                _ => {
                    command.env(key, value.to_string());
                }
            }
        }
    }
    if let Some(cwd) = upstream.get("cwd").and_then(Value::as_str) {
        command.current_dir(cwd);
    }
    Ok(command)
}

/// 按字符截断（预算说的就是字符数，不是字节），不把中文切成半个字。
fn clip(text: &str, limit: usize) -> &str {
    match text.char_indices().nth(limit) {
        Some((index, _)) => &text[..index],
        None => text,
    }
}

fn hint_text(path: Option<&Path>, kept: usize) -> String {
    match path {
        Some(path) => format!(
            "\n\n…（这个结果太长，只显示了前 {kept} 个字符；完整结果在 {}，用读文件工具或 {READ_TOOL} 按段读。）",
            path.display()
        ),
        None => format!("\n\n…（这个结果太长，只显示了前 {kept} 个字符，其余已省略。）"),
    }
}

fn spill_path(config: &Config, index: usize) -> Option<PathBuf> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SPILL_SEQ: AtomicUsize = AtomicUsize::new(0);
    let dir = config.spill.as_ref()?;
    std::fs::create_dir_all(dir).ok()?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|item| item.as_millis())
        .unwrap_or(0);
    // 同一毫秒里的两条结果不能抢同一个文件名：序号兜底。
    let seq = SPILL_SEQ.fetch_add(1, Ordering::Relaxed);
    Some(dir.join(format!("{}-{stamp}-{seq}-{index}.txt", config.name)))
}

/// 一条工具结果的正文：超出预算就截断，全文落盘，末了给一句去哪找。
fn trim_text(text: &str, config: &Config, index: usize, remaining: &mut usize) -> String {
    let size = text.chars().count();
    if size <= *remaining {
        *remaining -= size;
        return text.to_string();
    }
    let keep = clip(text, *remaining);
    *remaining = 0;
    let path = spill_path(config, index);
    if let Some(path) = &path {
        let _ = std::fs::write(path, text);
    }
    format!("{}{}", keep, hint_text(path.as_deref(), keep.chars().count()))
}

/// `tools/call` 的响应：只动文本块，图片和结构化数据原样放行。
fn trim_call(mut response: Value, config: &Config) -> Value {
    let Some(result) = response.get_mut("result") else {
        return response;
    };
    let Some(content) = result.get_mut("content").and_then(Value::as_array_mut) else {
        return response;
    };
    let mut remaining = config.budget;
    for (index, item) in content.iter_mut().enumerate() {
        if item.get("type").and_then(Value::as_str) != Some("text") {
            continue;
        }
        let Some(text) = item.get("text").and_then(Value::as_str) else {
            continue;
        };
        let trimmed = trim_text(text, config, index, &mut remaining);
        if let Some(object) = item.as_object_mut() {
            object.insert("text".to_string(), Value::String(trimmed));
        }
    }
    response
}

/// `tools/list` 的响应：工具条数封顶，描述按字数裁；参数表不动，裁了就没法调用。
fn cap_tools(mut response: Value, config: &Config) -> Value {
    let Some(result) = response.get_mut("result") else {
        return response;
    };
    let Some(tools) = result.get_mut("tools").and_then(Value::as_array_mut) else {
        return response;
    };
    tools.truncate(config.cap);
    for tool in tools.iter_mut() {
        let Some(object) = tool.as_object_mut() else {
            continue;
        };
        if let Some(Value::String(description)) = object.get("description") {
            if description.chars().count() > DESCRIPTION_LIMIT {
                let clipped: String = description.chars().take(DESCRIPTION_LIMIT).collect();
                object.insert("description".to_string(), Value::String(clipped));
            }
        }
    }
    // 截断后的全文要有入口：不管成员有没有原生读文件工具，都能按段读回来。
    if config.spill.is_some() {
        tools.push(read_tool());
    }
    response
}

fn read_tool() -> Value {
    json!({
        "name": READ_TOOL,
        "description": "读取被截断的工具结果全文：path 用结果末尾给出的路径，按 offset/limit 分段读。只读本回合落盘的结果。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "结果末尾给出的完整路径" },
                "offset": { "type": "integer", "minimum": 0, "description": "从第几个字符开始，默认 0" },
                "limit": { "type": "integer", "minimum": 1, "description": "最多读多少个字符，默认 4000，上限 8000" }
            },
            "required": ["path"],
            "additionalProperties": false
        }
    })
}

/// 网关自己回答的调用：读回落盘结果。别的请求一律交给上游。
fn local_response(request: &Value, config: &Config) -> Option<Value> {
    if request.get("method").and_then(Value::as_str) != Some("tools/call") {
        return None;
    }
    let params = request.get("params")?;
    if params.get("name").and_then(Value::as_str) != Some(READ_TOOL) {
        return None;
    }
    let id = request.get("id").cloned()?;
    let args = params.get("arguments").unwrap_or(params);
    Some(json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": read_result(args, config),
    }))
}

fn read_error(text: &str) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": true })
}

/// `lodge_mcp_read` 的回答：只认本回合落盘目录里的文件，按字符切片，末尾说清还能往哪读。
fn read_result(params: &Value, config: &Config) -> Value {
    let Some(dir) = config.spill.as_ref() else {
        return read_error("这一回合没有留下落盘结果。");
    };
    let path = params.get("path").and_then(Value::as_str).unwrap_or("").trim();
    if path.is_empty() {
        return read_error("缺少 path：用结果末尾给出的路径。");
    }
    let (Ok(file), Ok(root)) = (std::fs::canonicalize(path), std::fs::canonicalize(dir)) else {
        return read_error("读不到这个文件；用结果末尾给出的路径。");
    };
    if !file.starts_with(&root) {
        return read_error("只能读本回合落盘的结果。");
    }
    let Ok(text) = std::fs::read_to_string(&file) else {
        return read_error("这个结果读不出来。");
    };
    let total = text.chars().count();
    let offset = params.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
    let limit = params
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(READ_DEFAULT)
        .clamp(1, READ_MAX);
    let slice: String = text.chars().skip(offset).take(limit).collect();
    let next = offset + slice.chars().count();
    let note = if next < total {
        format!("\n\n…（共 {total} 个字符，接着用 offset={next} 读）")
    } else {
        String::new()
    };
    json!({ "content": [{ "type": "text", "text": format!("{slice}{note}") }], "isError": false })
}

fn id_key(value: &Value) -> Option<String> {
    match value {
        Value::Number(_) | Value::String(_) => Some(value.to_string()),
        _ => None,
    }
}

/// 网关主循环：两端各读一条线程，按请求记下问的是什么，回来时只改该改的地方。
pub fn run() -> i32 {
    let upstream = match upstream_from_env() {
        Ok(upstream) => upstream,
        Err(error) => {
            eprintln!("mcp-gate: {error}");
            return 2;
        }
    };
    let config = Config {
        budget: std::env::var(BUDGET_ENV)
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_BUDGET),
        cap: std::env::var(TOOL_CAP_ENV)
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_TOOL_CAP),
        spill: std::env::var(SPILL_DIR_ENV)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from),
        name: std::env::var(NAME_ENV)
            .ok()
            .map(|value| {
                value
                    .chars()
                    .filter(|item| item.is_ascii_alphanumeric() || *item == '-' || *item == '_')
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "mcp".to_string()),
    };
    let mut command = match command_of(&upstream) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("mcp-gate: {error}");
            return 2;
        }
    };
    let mut child = match command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            eprintln!("mcp-gate: 上游起不来：{error}");
            return 1;
        }
    };
    let pending: Arc<Mutex<HashMap<String, Kind>>> = Arc::new(Mutex::new(HashMap::new()));
    let config = Arc::new(config);
    // 两端都要写 stdout：上游响应和本地回答只差一行锁，不另开通道。
    let out: Arc<Mutex<std::io::Stdout>> = Arc::new(Mutex::new(std::io::stdout()));

    let mut child_stdin = child.stdin.take();
    let pending_for_input = Arc::clone(&pending);
    let config_for_input = Arc::clone(&config);
    let out_for_input = Arc::clone(&out);
    let input = std::thread::spawn(move || {
        let stdin = std::io::stdin();
        let mut reader = BufReader::new(stdin.lock());
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = line.trim_end_matches(['\r', '\n']);
            if text.trim().is_empty() {
                continue;
            }
            if let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) {
                let request = Value::Object(object);
                // 读回落盘结果由网关自己回答：它不经过上游，也不占预算。
                if let Some(response) = local_response(&request, &config_for_input) {
                    if let Ok(mut out) = out_for_input.lock() {
                        let _ = writeln!(out, "{response}");
                        let _ = out.flush();
                    }
                    continue;
                }
                let Value::Object(object) = &request else {
                    continue;
                };
                if let (Some(id), Some(method)) = (
                    object.get("id").and_then(id_key),
                    object.get("method").and_then(Value::as_str),
                ) {
                    let kind = match method {
                        "tools/call" => Kind::Call,
                        "tools/list" => Kind::List,
                        _ => Kind::Other,
                    };
                    if let Ok(mut map) = pending_for_input.lock() {
                        map.insert(id, kind);
                    }
                }
            }
            let Some(stdin) = child_stdin.as_mut() else {
                break;
            };
            if writeln!(stdin, "{text}").is_err() || stdin.flush().is_err() {
                break;
            }
        }
        drop(child_stdin.take());
    });

    let stdout = child.stdout.take();
    if let Some(stdout) = stdout {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = line.trim_end_matches(['\r', '\n']);
            if text.trim().is_empty() {
                continue;
            }
            let mut value: Value = match serde_json::from_str(text) {
                Ok(value) => value,
                Err(_) => {
                    if let Ok(mut out) = out.lock() {
                        let _ = writeln!(out, "{text}");
                        let _ = out.flush();
                    }
                    continue;
                }
            };
            // 只有响应才改：带 method 的是请求或通知，原样转发。
            if value.get("method").is_none() {
                let kind = value
                    .get("id")
                    .and_then(id_key)
                    .and_then(|key| pending.lock().ok().and_then(|mut map| map.remove(&key)));
                value = match kind {
                    Some(Kind::Call) => trim_call(value, &config),
                    Some(Kind::List) => cap_tools(value, &config),
                    _ => value,
                };
            }
            if let Ok(mut out) = out.lock() {
                let _ = writeln!(out, "{value}");
                let _ = out.flush();
            }
        }
    }

    let _ = input.join();
    let _ = child.wait();
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(budget: usize, spill: Option<PathBuf>) -> Config {
        Config {
            budget,
            cap: 2,
            spill,
            name: "probe".to_string(),
        }
    }

    fn text(text: &str) -> Value {
        json!({ "type": "text", "text": text })
    }

    #[test]
    fn a_short_result_is_left_alone() {
        let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [text("done")] } });
        let trimmed = trim_call(response.clone(), &config(100, None));
        assert_eq!(trimmed, response);
    }

    #[test]
    fn a_long_result_keeps_the_head_and_says_where_the_rest_is() {
        let dir = std::env::temp_dir().join(format!("lodge-gate-test-{}", std::process::id()));
        let long = "x".repeat(20_000);
        let response = json!({ "jsonrpc": "2.0", "id": 7, "result": { "content": [text(&long)] } });
        let trimmed = trim_call(response, &config(1_000, Some(dir.clone())));
        let kept = trimmed["result"]["content"][0]["text"].as_str().unwrap();
        assert!(kept.starts_with(&"x".repeat(1_000)));
        assert!(kept.contains("完整结果在"));
        let spilled = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| std::fs::read_to_string(entry.path()).unwrap_or_default())
            .find(|content| content.len() == 20_000)
            .expect("全文要落盘");
        assert_eq!(spilled, long);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_budget_counts_characters_not_bytes() {
        let long = "好".repeat(300);
        let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [text(&long)] } });
        let trimmed = trim_call(response, &config(100, None));
        let kept = trimmed["result"]["content"][0]["text"].as_str().unwrap();
        assert!(kept.starts_with(&"好".repeat(100)));
        assert!(kept.contains("只显示了前 100 个字符"));
    }

    #[test]
    fn non_text_blocks_are_not_touched() {
        let long = "y".repeat(20_000);
        let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [
            { "type": "image", "data": long },
            text("ok"),
        ] } });
        let trimmed = trim_call(response.clone(), &config(10, None));
        assert_eq!(trimmed, response);
    }

    #[test]
    fn the_whole_result_shares_one_budget() {
        let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [
            text("a".repeat(80).as_str()),
            text("b".repeat(80).as_str()),
        ] } });
        let trimmed = trim_call(response, &config(100, None));
        let first = trimmed["result"]["content"][0]["text"].as_str().unwrap();
        let second = trimmed["result"]["content"][1]["text"].as_str().unwrap();
        assert!(first.len() <= 80 + 200);
        assert!(second.contains("只显示了前 20 个字符"));
    }

    #[test]
    fn tools_are_capped_and_descriptions_clipped() {
        let long = "d".repeat(2_000);
        let response = json!({ "jsonrpc": "2.0", "id": 1, "result": { "tools": [
            { "name": "a", "description": long },
            { "name": "b" },
            { "name": "c" },
        ] } });
        let capped = cap_tools(response, &config(10, None));
        let tools = capped["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0]["description"].as_str().unwrap().chars().count(), DESCRIPTION_LIMIT);
        assert_eq!(tools[1]["name"], "b");
    }

    #[test]
    fn a_spilled_result_is_read_back_in_pages() {
        let dir = std::env::temp_dir().join(format!("lodge-gate-read-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("probe-1.txt");
        std::fs::write(&file, "abcdefghij").unwrap();
        let answer = read_result(
            &json!({ "path": file.display().to_string(), "offset": 2, "limit": 3 }),
            &config(100, Some(dir.clone())),
        );
        assert_eq!(answer["isError"], false);
        let text = answer["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("cde"));
        assert!(text.contains("offset=5"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_this_turn_s_spill_can_be_read() {
        let dir = std::env::temp_dir().join(format!("lodge-gate-guard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let outside = std::env::temp_dir().join(format!("lodge-gate-outside-{}.txt", std::process::id()));
        std::fs::write(&outside, "secret").unwrap();
        let answer = read_result(
            &json!({ "path": outside.display().to_string() }),
            &config(100, Some(dir.clone())),
        );
        assert_eq!(answer["isError"], true);
        let missing = read_result(&json!({}), &config(100, Some(dir.clone())));
        assert_eq!(missing["isError"], true);
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_stdio_servers_are_wrapped() {
        let exe = PathBuf::from("/tmp/lodge-base");
        let spill = PathBuf::from("/tmp/spill");
        let stdio = json!({ "command": "npx", "args": ["-y", "server"], "env": { "KEY": "v" } });
        let wrapped = wrap_server("probe", &stdio, &exe, &spill, 8_000, 64);
        assert_eq!(wrapped["command"], "/tmp/lodge-base");
        assert_eq!(wrapped["args"][0], "--mcp-gate");
        let upstream: Value =
            serde_json::from_str(wrapped["env"][UPSTREAM_ENV].as_str().unwrap()).unwrap();
        assert_eq!(upstream, stdio);
        let remote = json!({ "url": "http://127.0.0.1:8897/mcp" });
        assert_eq!(wrap_server("remote", &remote, &exe, &spill, 8_000, 64), remote);
    }
}
