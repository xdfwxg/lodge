//! macOS Seatbelt 后端：只做两件事——把边界渲染成 SBPL，把命令包进 sandbox-exec。
//! 这里不判断什么该允许；规则全部来自 `plan.rs` 构造好的值。

use std::path::{Path, PathBuf};

use std::process::Stdio;
use tokio::process::Command;

use super::plan::Network;

pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

pub fn available() -> bool {
    Path::new(SANDBOX_EXEC).exists()
}

fn escape(path: &Path) -> String {
    path.display().to_string().replace('\\', "\\\\").replace('"', "\\\"")
}

/// 规则顺序即语义：Seatbelt 最后匹配的规则生效，所以先放开、再挡读隔离、最后把 `.git` 收回只读。
/// `network-bind` 故意不写：本地监听（dev server、HTTP MCP）默认不允许，探针 `localBind` 锁住这个决定。
pub fn render(
    writable: &[PathBuf],
    read_deny: &[PathBuf],
    read_allow: &[PathBuf],
    read_ancestors: &[PathBuf],
    scratch_deny: &[PathBuf],
    scratch_allow: &[PathBuf],
    git_deny: &[PathBuf],
    network: &Network,
    local_ports: &[u16],
) -> String {
    let network_rules = match network {
        Network::Proxy { port } => {
            let mut rules = format!("(deny network-outbound)\n(allow network-outbound (remote ip \"localhost:{port}\"))");
            for local in local_ports {
                if *local != *port {
                    rules.push_str(&format!("\n(allow network-outbound (remote ip \"localhost:{local}\"))"));
                }
            }
            rules
        }
        Network::Open => "(allow network*)".to_string(),
        Network::None => "(deny network-outbound)".to_string(),
    };
    // 标准档读默认开放；严格档先整片拒绝，再放行白名单和祖先目录（只放路径查找）。
    let read_rules = if read_allow.is_empty() {
        "(allow file-read*)".to_string()
    } else {
        let allows = read_allow
            .iter()
            .map(|path| format!("(subpath \"{}\")", escape(path)))
            .collect::<Vec<_>>()
            .join(" ");
        let ancestors = read_ancestors
            .iter()
            .map(|path| format!("(literal \"{}\")", escape(path)))
            .collect::<Vec<_>>()
            .join(" ");
        format!(
            "(deny file-read*)\n(allow file-read* {allows})\n(allow file-read* {ancestors})"
        )
    };
    let writable_rules = writable
        .iter()
        .map(|path| format!("(subpath \"{}\")", escape(path)))
        .collect::<Vec<_>>()
        .join(" ");
    let deny_rules = read_deny
        .iter()
        .map(|path| format!("(deny file-read* file-write* (subpath \"{}\"))\n", escape(path)))
        .collect::<String>();
    let git_rules = git_deny
        .iter()
        .map(|path| format!("(deny file-write* (subpath \"{}\"))\n", escape(path)))
        .collect::<String>();
    let scratch_deny_rules = scratch_deny
        .iter()
        .map(|path| format!("(deny file-read* file-write* (subpath \"{}\"))\n", escape(path)))
        .collect::<String>();
    // 引擎会 lstat 自己目录的上一级；只放行公共根这个目录本身，不放行里面的任何条目。
    let scratch_root_literal = scratch_deny
        .iter()
        .map(|path| format!("(allow file-read* (literal \"{}\"))\n", escape(path)))
        .collect::<String>();
    // 公共根先整片拒绝，自己的临时目录最后重新放开（含引擎目录和扩展）。
    let scratch_allow_rules = scratch_allow
        .iter()
        .map(|path| format!("(allow file-read* file-write* (subpath \"{}\"))\n", escape(path)))
        .collect::<String>();
    format!(
        "(version 1)\n\
         (deny default)\n\
         (allow process*)\n\
         (allow signal (target same-sandbox))\n\
         (allow sysctl-read)\n\
         (allow mach-lookup)\n\
         (deny mach-lookup (global-name-prefix \"com.apple.pasteboard\"))\n\
         (allow ipc-posix*)\n\
         {network_rules}\n\
         {read_rules}\n\
         (allow file-write* {writable_rules} (literal \"/dev/null\") (literal \"/dev/stdout\") (literal \"/dev/stderr\") (literal \"/dev/fd/1\") (literal \"/dev/fd/2\"))\n\
         {deny_rules}\
         {git_rules}\
         {scratch_deny_rules}\
         {scratch_root_literal}\
         {scratch_allow_rules}",
    )
}

/// 把已经拼好的命令搬进 sandbox-exec：`sandbox-exec -f <规则> -- <原命令...>`。
/// 环境、工作目录、管道和进程组原样带过去；少了哪样，回合就会以另一种方式坏掉。
pub fn wrap(command: Command, profile: &Path) -> Command {
    let mut wrapped = Command::new(SANDBOX_EXEC);
    wrapped
        .arg("-f")
        .arg(profile)
        .arg("--")
        .arg(command.as_std().get_program());
    for arg in command.as_std().get_args() {
        wrapped.arg(arg);
    }
    wrapped
        .current_dir(
            command
                .as_std()
                .get_current_dir()
                .unwrap_or_else(|| Path::new("/tmp")),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0);
    // 新命令默认继承基座的全部环境；先清掉，再只带原命令显式声明的那几样。
    // 少了这一步，内层 env_clear 会被包装层绕过（孩子照样能读到基座的凭据）。
    wrapped.env_clear();
    for (key, value) in command.as_std().get_envs() {
        match value {
            Some(value) => {
                wrapped.env(key, value);
            }
            None => {
                wrapped.env_remove(key);
            }
        }
    }
    wrapped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(deny: Vec<PathBuf>, network: Network) -> String {
        render(
            &[PathBuf::from("/tmp/work")],
            &deny,
            &[],
            &[],
            &[PathBuf::from("/tmp/lodge-turns")],
            &[PathBuf::from("/tmp/lodge-turns/turn-1")],
            &[PathBuf::from("/tmp/work/.git")],
            &network,
            &[],
        )
    }

    #[test]
    fn the_profile_denies_by_default_and_grants_only_the_plan() {
        let text = sample(vec![PathBuf::from("/tmp/sibling")], Network::Proxy { port: 4567 });
        assert!(text.starts_with("(version 1)\n(deny default)"));
        assert!(text.contains("(allow file-write* (subpath \"/tmp/work\")"));
        assert!(text.contains("(deny file-read* file-write* (subpath \"/tmp/sibling\"))"));
        assert!(text.contains("(deny file-write* (subpath \"/tmp/work/.git\"))"));
        // 剪贴板不在文件系统里：不单独挡，成员能读到用户刚复制的密码。
        let clipboard = text.find("(deny mach-lookup (global-name-prefix \"com.apple.pasteboard\"))").unwrap();
        assert!(clipboard > text.find("(allow mach-lookup)").unwrap(), "the pasteboard denial comes after the broad grant");
        let scratch_deny = text.find("(deny file-read* file-write* (subpath \"/tmp/lodge-turns\"))").unwrap();
        let scratch_literal = text.find("(allow file-read* (literal \"/tmp/lodge-turns\"))").unwrap();
        let scratch_allow = text.find("(subpath \"/tmp/lodge-turns/turn-1\")").unwrap();
        assert!(scratch_literal > scratch_deny, "the root itself stays lstat-able");
        assert!(scratch_allow > scratch_literal, "the turn's own scratch is re-allowed last");
    }

    #[test]
    fn the_network_rule_follows_the_plan() {
        let proxied = sample(Vec::new(), Network::Proxy { port: 4567 });
        assert!(proxied.contains("(deny network-outbound)"));
        assert!(proxied.contains("(remote ip \"localhost:4567\")"));

        let open = sample(Vec::new(), Network::Open);
        assert!(open.contains("(allow network*)"));
        assert!(!open.contains("deny network-outbound"));
    }

    #[test]
    fn declared_local_services_are_reachable_without_opening_the_network() {
        let text = render(
            &[PathBuf::from("/tmp/work")],
            &[],
            &[],
            &[],
            &[],
            &[],
            &[],
            &Network::Proxy { port: 8899 },
            &[8897],
        );
        assert!(text.contains("(deny network-outbound)"));
        assert!(text.contains("(remote ip \"localhost:8899\")"));
        assert!(text.contains("(remote ip \"localhost:8897\")"));
    }

    #[test]
    fn a_deny_rule_sits_after_every_grant() {
        let text = sample(vec![PathBuf::from("/tmp/sibling")], Network::Open);
        let grant = text.find("(allow file-write*").unwrap();
        let deny = text.find("(subpath \"/tmp/sibling\")").unwrap();
        assert!(deny > grant, "Seatbelt is last-match-wins");
    }

    #[test]
    fn quotes_and_backslashes_cannot_break_out_of_a_rule() {
        let odd = PathBuf::from("/tmp/we\"ird\\name");
        let text = render(&[odd], &[], &[], &[], &[], &[], &[], &Network::Open, &[]);
        assert!(text.contains("we\\\"ird\\\\name"));
    }
}
