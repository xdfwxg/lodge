#![cfg_attr(not(windows), allow(dead_code))]

//! Windows 边界的唯一构造：账户、可写路径、WFP 规则都先算成值，平台后端只执行。
//!
//! 和 `plan.rs` 同一套判断，只是换一种平台说法：
//! - 可写只有成员自己的副本和回合临时目录；别的工作副本、基座数据目录靠 ACL 默认拒绝，
//!   不写 deny ACE（少一套清理机器，也少一条“挡住自己”的路）。
//! - 出网只有回环上的出口代理端口；其余一律 block。代理端口必须落在这里的区间里，
//!   落不进去就让回合失败，不静默放开。
//! - 严格档在 Windows 上还没有：要求严格档时直接失败，不假装做到了。

use std::path::{Path, PathBuf};

use super::plan::Network;

/// 专用账户名；安装时创建，之后每个沙箱命令都以它运行。
pub const DEFAULT_USER: &str = "LodgeSandbox";
/// 代理端口区间：安装时写进 WFP，会话里的代理必须落在这个区间里。
pub const PROXY_PORTS: (u16, u16) = (8898, 8899);
/// 允许的本机服务端口区间：出口代理、电脑操作桥这类提供方都落在这里。
pub const LOCAL_PORTS: (u16, u16) = (8890, 8899);

/// 一次回合在 Windows 上的边界。
#[derive(Clone, Debug)]
pub struct Boundary {
    pub user: String,
    pub work: PathBuf,
    pub scratch: PathBuf,
    pub writable: Vec<PathBuf>,
}

/// 专用账户名只有这一处解析：装和跑必须用同一个名字。
pub fn user_name() -> String {
    std::env::var("LODGE_SANDBOX_USER").unwrap_or_else(|_| DEFAULT_USER.to_string())
}

impl Boundary {
    pub fn plan(
        work: &Path,
        scratch: &Path,
        writable: Vec<PathBuf>,
        network: &Network,
        local_ports: &[u16],
        user: &str,
    ) -> Result<Boundary, String> {
        match network {
            Network::Proxy { port } => {
                if *port < PROXY_PORTS.0 || *port > PROXY_PORTS.1 {
                    return Err(format!(
                        "出口代理端口 {port} 不在沙箱允许的区间 {}-{} 里；先把代理端口固定到区间内。",
                        PROXY_PORTS.0, PROXY_PORTS.1
                    ));
                }
            }
            Network::None => {}
            Network::Open => {
                return Err("沙箱开着就必须走出口代理；不开代理、又想要网络，是两件互相矛盾的事。".to_string())
            }
        }
        for port in local_ports {
            if *port < LOCAL_PORTS.0 || *port > LOCAL_PORTS.1 {
                return Err(format!(
                    "本机服务端口 {port} 不在沙箱允许的区间 {}-{} 里；先把提供方端口固定到区间内。",
                    LOCAL_PORTS.0, LOCAL_PORTS.1
                ));
            }
        }
        Ok(Boundary {
            user: user.to_string(),
            work: work.to_path_buf(),
            scratch: scratch.to_path_buf(),
            writable,
        })
    }

    /// 只需要“穿过”的祖先目录：给 traverse，不给读。
    pub fn traverse(&self) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        for root in [&self.work, &self.scratch] {
            let mut current = root.parent();
            while let Some(parent) = current {
                if parent.as_os_str().is_empty() {
                    break;
                }
                paths.push(parent.to_path_buf());
                current = parent.parent();
            }
        }
        paths.sort();
        paths.dedup();
        paths
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn work() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join("lodge-win-plan");
        (
            root.join("CrewWorktrees").join("room").join("worker"),
            root.join("turns").join("t1"),
        )
    }

    #[test]
    fn a_proxied_turn_permits_its_port_before_blocking_everything_else() {
        let (work, scratch) = work();
        let boundary = Boundary::plan(
            &work,
            &scratch,
            vec![work.clone(), scratch.clone()],
            &Network::Proxy { port: 8899 },
            &[],
            DEFAULT_USER,
        )
        .unwrap();
        assert_eq!(boundary.writable, vec![work, scratch]);
    }

    #[test]
    fn a_turn_with_no_network_is_allowed_at_plan_time() {
        let (work, scratch) = work();
        let boundary = Boundary::plan(
            &work,
            &scratch,
            vec![work.clone()],
            &Network::None,
            &[],
            DEFAULT_USER,
        )
        .unwrap();
        assert_eq!(boundary.user, DEFAULT_USER);
    }

    #[test]
    fn a_port_outside_the_installed_range_fails_closed() {
        let (work, scratch) = work();
        let error = Boundary::plan(
            &work,
            &scratch,
            vec![work.clone()],
            &Network::Proxy { port: 4567 },
            &[],
            DEFAULT_USER,
        )
        .unwrap_err();
        assert!(error.contains("8898-8899"), "the reason names the allowed range");
    }

    #[test]
    fn an_open_network_is_refused_inside_the_sandbox() {
        let (work, scratch) = work();
        assert!(Boundary::plan(&work, &scratch, vec![work.clone()], &Network::Open, &[], DEFAULT_USER).is_err());
    }

    #[test]
    fn a_local_service_port_outside_the_installed_range_fails_closed() {
        let (work, scratch) = work();
        let error = Boundary::plan(
            &work,
            &scratch,
            vec![work.clone()],
            &Network::Proxy { port: 8899 },
            &[9999],
            DEFAULT_USER,
        )
        .unwrap_err();
        assert!(error.contains("8890-8899"), "the reason names the allowed range");
    }

    #[test]
    fn ancestors_are_traversed_but_not_granted() {
        let (work, scratch) = work();
        let boundary = Boundary::plan(
            &work,
            &scratch,
            vec![work.clone(), scratch.clone()],
            &Network::Proxy { port: 8899 },
            &[],
            DEFAULT_USER,
        )
        .unwrap();
        let traverse = boundary.traverse();
        assert!(traverse.iter().any(|path| path.ends_with("lodge-win-plan")));
        assert!(!boundary.writable.iter().any(|path| path.ends_with("lodge-win-plan")));
    }
}
