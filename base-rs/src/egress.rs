//! 最小出口代理：只放行白名单里的主机，其余一律 403 并记一笔。
//! 沙箱只管“能不能出网”，这里管“能去哪里”；两边一起才是完整的门。

use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{lookup_host, TcpListener, TcpStream};

pub struct Egress {
    pub port: u16,
    pub blocked: Arc<AtomicU64>,
    pub hosts: Vec<String>,
    /// 允许经代理访问的本机回环端口。默认空：回环上跑着平台自己的控制面，
    /// 不声明就不放行，否则成员可以绕过边界直接调基座和 Lodge 的 API。
    pub local_ports: Vec<u16>,
}

/// 出口白名单：远程按主机，回环按端口。
#[derive(Clone, Default)]
pub struct Policy {
    pub hosts: Vec<String>,
    pub local_ports: Vec<u16>,
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]")
}

/// 名字在任何名单里都可能解析到边界内：回环、内网、链路本地（含云元数据地址）。
fn private_addr(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_multicast()
                || v4.is_broadcast()
        }
        IpAddr::V6(v6) => {
            let segments = v6.segments();
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
        }
    }
}

/// 默认放行的模型厂商主机：用户没设 base URL 时也能开箱工作。
const PROVIDER_HOSTS: &[&str] = &[
    "api.deepseek.com",
    "api.anthropic.com",
    "api.openai.com",
    "openrouter.ai",
    "generativelanguage.googleapis.com",
    "api.x.ai",
    "api.mistral.ai",
    "api.groq.com",
    "api.cerebras.ai",
];

fn endpoint_of(url: &str) -> Option<(String, Option<u16>)> {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let hostport = rest.split('/').next()?.split('?').next()?;
    let hostport = hostport.rsplit_once('@').map(|(_, host)| host).unwrap_or(hostport);
    let (host, port) = match hostport.rsplit_once(':') {
        Some((host, port)) => (host, port.parse::<u16>().ok()),
        None => (hostport, None),
    };
    let host = host.trim().to_ascii_lowercase();
    if host.is_empty() { None } else { Some((host, port)) }
}

#[cfg(test)]
fn host_of(url: &str) -> Option<String> {
    endpoint_of(url).map(|(host, _)| host)
}

/// 模型自己的出口：各家 base URL 的主机与端口，加上常见厂商主机。
/// 不含 `LODGE_EGRESS_ALLOW` 和 `LODGE_LOCAL_PORTS`——房间选择“只连模型”时，
/// 除了模型本身哪里都不去。
pub fn provider_allowlist() -> Policy {
    let mut policy = Policy::default();
    for key in [
        "ANTHROPIC_BASE_URL",
        "OPENAI_BASE_URL",
        "DEEPSEEK_BASE_URL",
        "OPENROUTER_BASE_URL",
        "GOOGLE_BASE_URL",
    ] {
        if let Ok(url) = std::env::var(key) {
            if let Some((host, port)) = endpoint_of(&url) {
                if is_loopback(&host) {
                    policy.local_ports.push(port.unwrap_or(80));
                } else {
                    policy.hosts.push(host);
                }
            }
        }
    }
    policy.hosts.extend(PROVIDER_HOSTS.iter().map(|host| host.to_string()));
    normalize(policy)
}

/// 追加房间可以去的网站。额外主机只在默认档生效。
pub fn with_extras(policy: Policy, hosts: &str, ports: &str) -> Policy {
    let mut policy = policy;
    policy.hosts.extend(
        hosts
            .split(',')
            .map(|host| host.trim().to_ascii_lowercase())
            .filter(|host| !host.is_empty()),
    );
    policy.local_ports.extend(
        ports
            .split(',')
            .filter_map(|port| port.trim().parse::<u16>().ok()),
    );
    normalize(policy)
}

fn normalize(mut policy: Policy) -> Policy {
    policy.hosts.sort();
    policy.hosts.dedup();
    policy.local_ports.sort();
    policy.local_ports.dedup();
    policy
}

/// 默认白名单：模型主机 + `LODGE_EGRESS_ALLOW`；本机回环只按端口放行，
/// `LODGE_LOCAL_PORTS` 追加。平台自己的端口不在任何一份名单里，因此永远走不通。
pub fn allowlist() -> Policy {
    with_extras(
        provider_allowlist(),
        &std::env::var("LODGE_EGRESS_ALLOW").unwrap_or_default(),
        &std::env::var("LODGE_LOCAL_PORTS").unwrap_or_default(),
    )
}

pub fn host_allowed(host: &str, allow: &[String]) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    allow.iter().any(|rule| {
        let rule = rule.trim_end_matches('.').to_ascii_lowercase();
        host == rule || host.ends_with(&format!(".{rule}"))
    })
}

/// 一个目标放不放行：回环只看端口，远程只看主机。
pub fn target_allowed(host: &str, port: u16, policy: &Policy) -> bool {
    if is_loopback(host) {
        policy.local_ports.contains(&port)
    } else {
        host_allowed(host, &policy.hosts)
    }
}

#[cfg(test)]
pub async fn start(policy: Policy) -> std::io::Result<Egress> {
    start_at(policy, 0).await
}

/// 绑定指定端口；0 表示由系统分配。Windows 沙箱的 WFP 规则只放行固定端口区间，
/// 所以代理必须落在 `win_plan::PROXY_PORTS` 里，落不进去时回合会拒绝开跑。
pub async fn start_at(policy: Policy, port: u16) -> std::io::Result<Egress> {
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let port = listener.local_addr()?.port();
    let blocked = Arc::new(AtomicU64::new(0));
    let shared = Arc::new(policy.clone());
    let counter = blocked.clone();
    let loop_policy = shared.clone();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let policy = loop_policy.clone();
            let blocked = counter.clone();
            tokio::spawn(async move {
                handle(stream, &policy, &blocked).await;
            });
        }
    });
    Ok(Egress {
        port,
        blocked,
        hosts: policy.hosts,
        local_ports: policy.local_ports,
    })
}

fn target_of(method: &str, target: &str) -> Option<(String, u16, bool)> {
    if method.eq_ignore_ascii_case("CONNECT") {
        let (host, port) = target.rsplit_once(':')?;
        return Some((host.to_string(), port.parse().ok()?, true));
    }
    let rest = target.strip_prefix("http://")?;
    let hostport = rest.split('/').next().unwrap_or("");
    let (host, port) = match hostport.rsplit_once(':') {
        Some((host, port)) => (host, port.parse().ok()?),
        None => (hostport, 80),
    };
    if host.is_empty() {
        return None;
    }
    Some((host.to_string(), port, false))
}

async fn handle(mut client: TcpStream, policy: &Policy, blocked: &AtomicU64) {
    let mut head = Vec::new();
    let mut buf = [0u8; 2048];
    loop {
        match client.read(&mut buf).await {
            Ok(0) => return,
            Ok(read) => {
                head.extend_from_slice(&buf[..read]);
                if head.windows(4).any(|window| window == b"\r\n\r\n") || head.len() > 16 * 1024 {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let text = String::from_utf8_lossy(&head).to_string();
    let first = text.lines().next().unwrap_or("").to_string();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("");
    let Some((host, port, connect)) = target_of(&method, target) else {
        blocked.fetch_add(1, Ordering::Relaxed);
        eprintln!("lodge-base-slice: egress 拦下不认识的请求 {method} {target}");
        deny(client, "只接受 CONNECT 或 http:// 代理请求").await;
        return;
    };
    if !target_allowed(&host, port, policy) {
        blocked.fetch_add(1, Ordering::Relaxed);
        if is_loopback(&host) {
            eprintln!("lodge-base-slice: egress 拦下本机回环 {host}:{port}");
            deny(
                client,
                &format!("本机回环端口 {port} 没有声明；要用本地服务就加 LODGE_LOCAL_PORTS"),
            )
            .await;
        } else {
            eprintln!("lodge-base-slice: egress 拦下 {host}:{port}");
            deny(client, &format!("{host} 不在白名单里；需要就加 LODGE_EGRESS_ALLOW")).await;
        }
        return;
    }
    // 回环只走声明过的端口；远程名字先解析，解析结果碰到边界内地址就不连，
    // 再按解析出的地址连（不做二次解析，免得 DNS 归攻击者时被带回内网）。
    let upstream = if is_loopback(&host) {
        TcpStream::connect((host.as_str(), port)).await.ok()
    } else {
        match lookup_host((host.as_str(), port)).await {
            Ok(addrs) => {
                let mut targets = Vec::new();
                for addr in addrs {
                    if private_addr(addr.ip()) {
                        blocked.fetch_add(1, Ordering::Relaxed);
                        eprintln!("lodge-base-slice: egress 拦下解析到边界内的 {host}:{port} → {}", addr.ip());
                        deny(
                            client,
                            &format!("{host} 解析到本机或内网地址；不连"),
                        )
                        .await;
                        return;
                    }
                    targets.push(addr);
                }
                let mut stream = None;
                for addr in targets {
                    if let Ok(connected) = TcpStream::connect(addr).await {
                        stream = Some(connected);
                        break;
                    }
                }
                stream
            }
            Err(_) => None,
        }
    };
    let Some(mut upstream) = upstream else {
        let _ = client
            .write_all(b"HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
            .await;
        return;
    };
    if connect {
        if client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await
            .is_err()
        {
            return;
        }
    } else if upstream.write_all(&head).await.is_err() {
        return;
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
}

async fn deny(mut client: TcpStream, reason: &str) {
    let body = format!("denied by lodge-base egress: {reason}\n");
    let _ = client
        .write_all(
            format!(
                "HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_matches_exact_and_subdomains_only() {
        let allow = vec!["deepseek.com".to_string()];
        assert!(host_allowed("deepseek.com", &allow));
        assert!(host_allowed("api.deepseek.com", &allow));
        assert!(!host_allowed("notdeepseek.com", &allow));
        assert!(!host_allowed("deepseek.com.evil.test", &allow));
        assert!(!host_allowed("", &allow));
    }

    #[test]
    fn the_model_proxy_keeps_only_the_model_hosts() {
        let provider = provider_allowlist();
        assert!(provider.hosts.iter().any(|host| host == "api.deepseek.com"));
        let extra_only = with_extras(provider.clone(), "example.com", "4567");
        assert!(extra_only.hosts.iter().any(|host| host == "example.com"));
        assert!(extra_only.local_ports.contains(&4567));
        assert!(!provider.hosts.iter().any(|host| host == "example.com"));
        assert!(!provider.local_ports.contains(&4567));
    }

    #[tokio::test]
    async fn the_proxy_relays_a_declared_loopback_port_and_refuses_others() {
        // 回环目标只有显式声明端口才放行；平台自己的端口永远不在名单里。
        let echo = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = echo.accept().await else { break };
                tokio::spawn(async move {
                    let mut buf = [0u8; 64];
                    if let Ok(read) = stream.read(&mut buf).await {
                        let _ = stream.write_all(&buf[..read]).await;
                    }
                });
            }
        });
        let proxy = start(Policy {
            hosts: Vec::new(),
            local_ports: vec![echo_port],
        })
        .await
        .unwrap();

        let mut allowed = TcpStream::connect(("127.0.0.1", proxy.port)).await.unwrap();
        allowed
            .write_all(format!("CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .await
            .unwrap();
        let mut head = vec![0u8; 64];
        let read = allowed.read(&mut head).await.unwrap();
        assert!(String::from_utf8_lossy(&head[..read]).contains("200"), "declared port gets 200");
        allowed.write_all(b"ping").await.unwrap();
        let mut echoed = [0u8; 4];
        allowed.read_exact(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"ping");

        // 平台控制面的形态：回环、但端口没有声明。以前这里会被中继，成员因此能调基座/Lodge 的 API。
        let mut platform = TcpStream::connect(("127.0.0.1", proxy.port)).await.unwrap();
        platform
            .write_all(b"CONNECT 127.0.0.1:8798 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .await
            .unwrap();
        let read = platform.read(&mut head).await.unwrap();
        assert!(
            String::from_utf8_lossy(&head[..read]).contains("403"),
            "an undeclared loopback port is refused"
        );
        assert!(proxy.blocked.load(Ordering::Relaxed) >= 1);

        let mut blocked = TcpStream::connect(("127.0.0.1", proxy.port)).await.unwrap();
        blocked
            .write_all(b"CONNECT blocked.invalid:443 HTTP/1.1\r\nHost: blocked.invalid\r\n\r\n")
            .await
            .unwrap();
        let read = blocked.read(&mut head).await.unwrap();
        assert!(String::from_utf8_lossy(&head[..read]).contains("403"), "unknown host is refused");
    }

    #[test]
    fn addresses_inside_the_boundary_are_recognized() {
        for blocked in ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "fe80::1"] {
            assert!(private_addr(blocked.parse().unwrap()), "{blocked} must be refused");
        }
        for allowed in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(!private_addr(allowed.parse().unwrap()), "{allowed} is public");
        }
    }

    #[test]
    fn loopback_is_judged_by_port_and_remote_by_host() {
        let policy = Policy {
            hosts: vec!["api.deepseek.com".to_string()],
            local_ports: vec![11434],
        };
        assert!(target_allowed("localhost", 11434, &policy));
        assert!(target_allowed("127.0.0.1", 11434, &policy));
        assert!(!target_allowed("localhost", 8787, &policy), "the platform's own port");
        assert!(!target_allowed("127.0.0.1", 8798, &policy));
        assert!(target_allowed("api.deepseek.com", 443, &policy));
        assert!(!target_allowed("example.com", 443, &policy));
    }

    #[test]
    fn base_urls_contribute_their_host_only() {
        assert_eq!(host_of("https://api.deepseek.com/anthropic").as_deref(), Some("api.deepseek.com"));
        assert_eq!(host_of("http://user:pw@host.test:8080/x").as_deref(), Some("host.test"));
        assert_eq!(host_of("host.test/v1"), Some("host.test".to_string()));
        assert_eq!(
            endpoint_of("http://127.0.0.1:11434/v1"),
            Some(("127.0.0.1".to_string(), Some(11434)))
        );
    }
}
