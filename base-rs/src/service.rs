//! 回合开始的用例：选人、校验租约、占用线程、起驱动。
//! HTTP 只负责解析与错误映射；这条流程不属于「房间」也不属于「路由」。

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::drivers::{self, DriverContext, DriverKind};
use crate::events::{group_frame, runtime_frame};
use crate::model::{native_tools_of, Lease, TurnOutcome, TurnUsage};
use crate::sandbox::{Network, TurnInputs, TurnSandbox};
use crate::state::{driver_kind_of, App};
use crate::turns::{settle, CancelToken, TurnHandle};

pub struct StartTurn {
    pub group_id: String,
    pub text: String,
    pub send_id: String,
    pub mentions: Vec<String>,
}

pub struct Started {
    pub thread_id: String,
    pub message_id: String,
    pub send_id: String,
}

#[derive(Debug)]
pub enum StartError {
    NotFound(String),
    Conflict(String),
    BadRequest(String),
    Internal(String),
}

pub fn start_turn(app: &Arc<App>, request: StartTurn) -> Result<Started, StartError> {
    // 边界立不起来就不开回合：宁可拒绝并说清，也不让成员带着全部工具裸奔。
    if !app.self_check.ok() {
        return Err(StartError::Conflict(app.self_check.refusal()));
    }
    if request.text.trim().is_empty() {
        return Err(StartError::BadRequest("消息不能为空".to_string()));
    }
    // 与删除互斥：删除先拿到锁，就不会有一个开局穿过删除把群重新写回来。
    let _lifecycle = app
        .lifecycle
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let group = app
        .store
        .group(&request.group_id)
        .map_err(StartError::Internal)?
        .ok_or_else(|| StartError::NotFound("没有这个群".to_string()))?;
    let thread_id = group
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let member_ids: Vec<String> = group
        .get("memberIds")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let mut mentioned: Option<String> = None;
    for id in &request.mentions {
        if !member_ids.is_empty() && !member_ids.iter().any(|member| member == id) {
            continue;
        }
        if app.store.bot(id).map_err(StartError::Internal)?.is_some() {
            mentioned = Some(id.clone());
            break;
        }
    }
    let bot_id = mentioned
        .or_else(|| {
            group
                .get("defaultResponder")
                .and_then(|value| value.get("botId"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| member_ids.first().cloned())
        .unwrap_or_default();
    let bot = app
        .store
        .bot(&bot_id)
        .map_err(StartError::Internal)?
        .ok_or_else(|| StartError::NotFound("这个群没有可用的成员身体".to_string()))?;

    // 叫停是投递边界：被 hold 的成员不能被一条消息重新叫起来。
    let held = group
        .get("holds")
        .and_then(|holds| holds.get(&bot_id))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if held {
        return Err(StartError::Conflict("这个成员被叫停了；先继续，再派任务".to_string()));
    }

    let settings = bot.get("settings").cloned().unwrap_or(Value::Null);
    let lease = Lease::from_settings(&settings);
    if let Some(parent_id) = lease.parent_id.clone() {
        match app.store.lease(&parent_id).map_err(StartError::Internal)? {
            Some(parent) if lease.covers(&parent) => {}
            Some(_) => return Err(StartError::BadRequest("租约不能比父租约更宽".to_string())),
            None => return Err(StartError::BadRequest("父租约不存在".to_string())),
        }
    }
    app.store.save_lease(&lease).map_err(StartError::Internal)?;

    let turn_id = Uuid::new_v4().to_string();
    let cancel = CancelToken::new();
    let started = app.turns.try_register(
        &thread_id,
        TurnHandle {
            thread_id: thread_id.clone(),
            bot_id: bot_id.clone(),
            turn_id: turn_id.clone(),
            cancel: cancel.clone(),
        },
    );
    if !started {
        return Err(StartError::Conflict("这一轮还在跑；先等它结束".to_string()));
    }
    if let Err(error) = app.store.start_turn(&thread_id, &bot_id, &turn_id) {
        app.turns.cancel(&thread_id);
        return Err(StartError::Internal(error));
    }

    app.events.emit(runtime_frame(
        &thread_id,
        json!({
            "threadId": thread_id,
            "botId": bot_id,
            "turnId": turn_id,
            "type": "turn.started",
        }),
    ));
    let mut busy = group.clone();
    busy["working"] = json!(true);
    busy["busyBotId"] = json!(bot_id);
    busy["busyTurnId"] = json!(turn_id);
    if let Err(error) = app.store.upsert_group(&busy) {
        // 群忙碌态是派生状态；写失败要可见，但不该把一个已经开始的回合判死。
        eprintln!("lodge-base-slice: 记录群忙碌失败: {error}");
    }
    app.events.emit(group_frame(busy));

    let model = bot
        .get("modelSelection")
        .and_then(|selection| selection.get("model"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let system = settings
        .get("soul")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    // 技能按需读：提示词里只放清单，正文随上下文交给驱动（pi 由 use_skill 工具取）。
    let skills = match app.store.bot_skill_pairs(&bot_id) {
        Ok(pairs) => pairs,
        Err(error) => {
            eprintln!("lodge-base-slice: 读技能失败: {error}");
            Vec::new()
        }
    };
    let native_tools = native_tools_of(&settings);
    let auto_mcp_servers: Vec<String> = crate::model::string_list(settings.get("autoMcpServers"))
        .into_iter()
        .filter(|name| name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-'))
        .collect();
    let exclude_tools = crate::model::exclude_tools_of(&settings);
    let budget = crate::model::budget_of(&settings);
    // 工作目录属于成员身体：同一个群里可能同时有彼此不同的工作副本。
    // 成员没有声明才退回群目录；都没有就 /tmp（不猜）。
    let cwd = settings
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            group
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().into_owned());
    // 别人的工作副本：同房和其他房间一视同仁——房间边界不是读边界。
    // 这里只指出路径，读隔离连同基座数据目录、凭据表一起由边界值自己算。
    let mut other_worktrees = Vec::new();
    match app.store.bots() {
        Ok(bots) => {
            for other in bots {
                let id = other.get("id").and_then(Value::as_str).unwrap_or("");
                if id.is_empty() || id == bot_id {
                    continue;
                }
                if let Some(path) = other
                    .get("settings")
                    .and_then(|settings| settings.get("cwd"))
                    .and_then(Value::as_str)
                    .filter(|path| !path.is_empty() && *path != cwd)
                {
                    other_worktrees.push(path.to_string());
                }
            }
        }
        Err(error) => eprintln!("lodge-base-slice: 读成员工作目录失败: {error}"),
    }
    // 成员的声明优先：none 整轮不出网；model 只走“只放行模型厂商”的代理；
    // 没声明才走默认白名单。要代理却没有代理就失败，不在沙箱里静默放开。
    let declared = settings.get("network").and_then(Value::as_str).unwrap_or("");
    let network = match network_for(
        declared,
        app.egress.as_ref().map(|proxy| proxy.port),
        app.egress_model.as_ref().map(|proxy| proxy.port),
        crate::sandbox::enabled(),
    ) {
        Ok(network) => network,
        Err(reason) => {
            settle(
                &app.turns,
                &app.store,
                &app.events,
                &thread_id,
                &bot_id,
                &turn_id,
                TurnOutcome::Failed,
                reason,
                &TurnUsage::default(),
            );
            return Ok(Started {
                thread_id,
                message_id: Uuid::new_v4().to_string(),
                send_id: request.send_id,
            });
        }
    };
    let strict = settings.get("profile").and_then(Value::as_str) == Some("strict");
    let file_bytes = settings
        .get("limits")
        .and_then(|limits| limits.get("fileBytes"))
        .and_then(Value::as_u64);
    let processes = settings
        .get("limits")
        .and_then(|limits| limits.get("processes"))
        .and_then(Value::as_u64)
        .map(|value| value as u32);
    let approval_mode = settings
        .get("approvalMode")
        .and_then(Value::as_str)
        .filter(|mode| *mode == "ask" || *mode == "auto")
        .unwrap_or("ask")
        .to_string();
    // 只挂这个 bot 声明的、库里有且启用的服务器；名字不对就跳过并记一笔。
    // MCP 工具按真名声明和审批，不经过 codemode 这层壳：
    // 壳会把所有工具变成同一个名字，审批看不到真实工具，角色规则也失准。
    let mut servers = serde_json::Map::new();
    let mut mcp_tools = Vec::new();
    for name in crate::model::string_list(settings.get("mcpServers")) {
        match app.store.mcp_server(&name) {
            Ok(Some(mut server)) => {
                if server.get("enabled").and_then(Value::as_bool) == Some(false) {
                    continue;
                }
                if let Some(object) = server.as_object_mut() {
                    object.remove("name");
                    object.insert("exposure".to_string(), json!("direct"));
                }
                // 只有声明过的工具进这一回合的工具面；没声明的不出现。
                mcp_tools.push(format!("mcp__{name}__*"));
                servers.insert(name, server);
            }
            Ok(None) => eprintln!("lodge-base-slice: 成员要挂的 MCP 服务器不在库里: {name}"),
            Err(error) => eprintln!("lodge-base-slice: 读 MCP 服务器失败: {error}"),
        }
    }
    // MCP 提供方（比如电脑操作桥）如果在本机回环上，沙箱只放行它的端口；
    // 端口是声明的一部分，不是另开一个网络。
    let mut local_ports: Vec<u16> = servers
        .values()
        .filter_map(|server| server.get("url").and_then(Value::as_str))
        .filter_map(loopback_port)
        .collect();
    local_ports.sort();
    local_ports.dedup();

    let kind = driver_kind_of(&bot);
    // 严格档的读白名单要知道引擎装在哪：pi / claude / codex 各用各的入口。
    let engine_binary = match kind {
        DriverKind::Claude => crate::discovery::claude_binary(),
        DriverKind::Codex => crate::discovery::codex_binary(),
        _ => crate::discovery::pi_binary(),
    };
    // 落在进程里的驱动先立边界：立不起来就让这一回合诚实失败，不裸跑。
    let sandbox = if matches!(kind, DriverKind::Pi | DriverKind::Claude | DriverKind::Codex) {
        match TurnSandbox::plan(TurnInputs {
            turn_id: turn_id.clone(),
            work: cwd,
            other_worktrees,
            base_dir: app.store.dir().display().to_string(),
            home: crate::platform::home_dir(),
            network,
            file_bytes,
            processes,
            strict,
            engine_binary: engine_binary.clone(),
            local_ports,
        }) {
            Ok(sandbox) => Some(sandbox),
            Err(reason) => {
                settle(
                    &app.turns,
                    &app.store,
                    &app.events,
                    &thread_id,
                    &bot_id,
                    &turn_id,
                    TurnOutcome::Failed,
                    &format!("这一回合需要沙箱，但{reason}；先修好再跑。"),
                    &TurnUsage::default(),
                );
                return Ok(Started {
                    thread_id,
                    message_id: Uuid::new_v4().to_string(),
                    send_id: request.send_id,
                });
            }
        }
    } else {
        None
    };
    // 外部服务器一律走基座网关：结果按预算裁、全文落在回合目录、工具面封顶。
    // 网关是基座自己的可执行文件，沙箱里由 pi 拉起；远程（url）服务器没有本地进程可拦，原样交出去。
    // 房间契约工具（lodge_gate）是平台自己的，不过外部网关：它有回执握手，也不该多出一只手。
    let mcp_json = if servers.is_empty() {
        None
    } else {
        let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("lodge-base-slice"));
        let spill = sandbox
            .as_ref()
            .map(|sandbox| sandbox.scratch().join("mcp"))
            .unwrap_or_else(|| std::env::temp_dir().join("lodge-mcp"));
        let wrapped = servers
            .into_iter()
            .map(|(name, server)| {
                let spec = if name == crate::mcp_gate::CONTRACT_SERVER {
                    server
                } else {
                    crate::mcp_gate::wrap_server(
                        &name,
                        &server,
                        &exe,
                        &spill,
                        crate::mcp_gate::DEFAULT_BUDGET,
                        crate::mcp_gate::DEFAULT_TOOL_CAP,
                    )
                };
                (name, spec)
            })
            .collect::<serde_json::Map<String, Value>>();
        Some(json!({ "mcpServers": wrapped }).to_string())
    };
    drivers::spawn(
        app.clone(),
        kind,
        DriverContext {
            thread_id: thread_id.clone(),
            bot_id,
            turn_id,
            prompt: request.text,
            system,
            skills,
            model,
            sandbox,
            native_tools,
            mcp_tools,
            auto_mcp_servers,
            mcp_json,
            exclude_tools,
            budget,
            started_at: std::time::Instant::now(),
            approval_mode,
            lease,
            cancel,
        },
    );

    Ok(Started {
        thread_id,
        message_id: Uuid::new_v4().to_string(),
        send_id: request.send_id,
    })
}

/// MCP 给的 URL 如果落在本机回环，返回端口；只认 127.0.0.1 / localhost / ::1。
fn loopback_port(url: &str) -> Option<u16> {
    let rest = url.split_once("://")?.1;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host_port = authority.rsplit_once('@').map(|(_, host)| host).unwrap_or(authority);
    if let Some(inner) = host_port.strip_prefix('[') {
        let (host, tail) = inner.split_once(']')?;
        return matches!(host.to_ascii_lowercase().as_str(), "::1")
            .then(|| tail.strip_prefix(':')?.parse().ok())?;
    }
    let (host, port) = host_port.rsplit_once(':')?;
    matches!(host.to_ascii_lowercase().as_str(), "127.0.0.1" | "localhost")
        .then(|| port.parse().ok())?
}

/// 这一回合的出口。声明优先；要代理却没有代理就失败，不在沙箱里静默放开。
fn network_for(
    declared: &str,
    egress: Option<u16>,
    model_egress: Option<u16>,
    sandbox: bool,
) -> Result<Network, &'static str> {
    match declared {
        "none" => Ok(Network::None),
        "model" => model_egress
            .map(|port| Network::Proxy { port })
            .ok_or("这一回合声明只连模型，但基座没有模型出口代理；先修好再跑。"),
        _ => match egress {
            Some(port) => Ok(Network::Proxy { port }),
            None if !sandbox => Ok(Network::Open),
            None => Err("出口代理关着，这一回合没有网络边界；先开代理，或关掉沙箱再跑。"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::network_for;
    use crate::sandbox::Network;

    #[test]
    fn only_loopback_mcp_urls_become_local_ports() {
        use super::loopback_port;
        assert_eq!(loopback_port("http://127.0.0.1:8897/mcp"), Some(8897));
        assert_eq!(loopback_port("http://localhost:8897/sse"), Some(8897));
        assert_eq!(loopback_port("http://[::1]:8897/mcp"), Some(8897));
        assert_eq!(loopback_port("https://example.com:8897/mcp"), None);
        assert_eq!(loopback_port("http://127.0.0.1/mcp"), None);
    }

    #[test]
    fn a_turn_without_network_gets_no_network() {
        assert!(matches!(network_for("none", Some(1), Some(2), true), Ok(Network::None)));
    }

    #[test]
    fn model_only_uses_the_model_proxy_and_fails_without_it() {
        assert!(matches!(
            network_for("model", Some(1), Some(2), true),
            Ok(Network::Proxy { port: 2 })
        ));
        assert!(network_for("model", Some(1), None, true).is_err());
    }

    #[test]
    fn the_default_goes_through_the_proxy_and_fails_closed_without_it() {
        assert!(matches!(
            network_for("", Some(1), Some(2), true),
            Ok(Network::Proxy { port: 1 })
        ));
        // 沙箱开着却没有出口代理：不能悄悄变成 Open。
        assert!(network_for("", None, Some(2), true).is_err());
        // 沙箱明确关掉时才允许 Open，这是开发退路。
        assert!(matches!(network_for("", None, Some(2), false), Ok(Network::Open)));
    }
}
