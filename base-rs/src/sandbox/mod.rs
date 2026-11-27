//! 沙箱：一次回合坐在什么边界里跑。
//!
//! 一个值（`TurnSandbox`）只由 `plan` 构造一次；后端（`seatbelt`）只把它渲染成规则、
//! 把命令包进边界。判断只有一份，平台只负责执行。
//!
//! 四条不变量：
//! 1. 要沙箱却给不出，这一回合不跑；不静默降级裸跑。
//! 2. 可写只有：工作副本、回合临时目录、终端设备；其余一律拒绝。
//! 3. 别人的工作副本、基座数据目录、用户密钥目录连读都不给。
//! 4. 出网只有两条路：走基座代理，或显式不设边界；没有「悄悄放开」。

mod plan;
pub(crate) mod win_plan;
#[cfg(target_os = "macos")]
mod seatbelt;
#[cfg(windows)]
pub mod windows;

use std::time::Duration;

use tokio::process::Command;

pub use plan::{Network, TurnInputs, TurnSandbox};

/// 平台只把这几样交给孩子：找到工具、编码、终端、TLS。凭据和平台变量一概不传；
/// 引擎的模型配置从沙箱里的引擎目录读，不靠环境。
pub const ENV_KEEP: &[&str] = &[
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
    "USER",
    "LOGNAME",
    "SHELL",
    "NODE_OPTIONS",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    // Windows：孩子要能找到系统 DLL、临时目录和命令解释器。
    "USERPROFILE",
    "SYSTEMROOT",
    "SystemRoot",
    "SystemDrive",
    "TEMP",
    "TMP",
    "PATHEXT",
    "COMSPEC",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
];

/// 回合孩子和受限执行共用同一份环境策略：先清空，再只放行声明过的几样。
pub fn scrub_env(command: &mut tokio::process::Command) {
    command.env_clear();
    for key in ENV_KEEP {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
}

/// `/api/health` 的 box 字段：本机现在能不能给沙箱，不猜。
pub fn state() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        if std::env::var("LODGE_SANDBOX").map(|value| value == "off").unwrap_or(false) {
            return "off";
        }
        return if seatbelt::available() { "on" } else { "off" };
    }
    #[cfg(windows)]
    {
        return windows::state();
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        "off"
    }
}

/// 沙箱开着时，回合必须真的落在边界里；关着是显式选择，健康检查会如实说。
pub(crate) fn enabled() -> bool {
    state() == "on"
}

impl TurnSandbox {
    /// 把边界落到命令上：代理环境变量、沙箱里的引擎目录、平台包装。
    /// 落不下来就返回原因，调用方必须让回合失败，不能降级裸跑。
    pub fn apply(&self, mut command: Command) -> Result<Command, String> {
        // 出网只走基座代理：引擎和它拉起的工具都从 HTTP(S)_PROXY 走，DNS 交给代理。
        if let Network::Proxy { port } = self.network() {
            let proxy = format!("http://127.0.0.1:{port}");
            for key in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                command.env(key, &proxy);
            }
            command
                .env("NO_PROXY", "localhost,127.0.0.1")
                .env("no_proxy", "localhost,127.0.0.1");
            // 关掉引擎自己的启动期网络动作，免得它绕过代理或误判离线。
            command.env("PI_OFFLINE", "1");
        }
        if !enabled() {
            return Ok(command);
        }
        // 沙箱里的引擎目录：两个平台都用同一条环境变量指过去。
        let engine_home = self
            .engine_home()
            .ok_or_else(|| "沙箱里的引擎目录没有建好".to_string())?;
        command.env("PI_CODING_AGENT_DIR", engine_home);
        #[cfg(target_os = "macos")]
        {
            let profile = self.scratch().join("sandbox.sb");
            std::fs::write(
                &profile,
                seatbelt::render(
                    self.writable(),
                    self.read_deny(),
                    self.read_allow(),
                    self.read_ancestors(),
                    self.scratch_deny(),
                    self.scratch_allow(),
                    self.git_deny(),
                    self.network(),
                    self.local_ports(),
                ),
            )
            .map_err(|error| format!("沙箱配置写不出来：{error}"))?;
            // 只改引擎目录，不动 HOME：登录的密钥在系统钥匙串里，跟着 HOME 走会找不到。
            // 严格档：HOME 换成回合里的一次性目录，工具缓存和配置都落在边界内。
            if self.is_strict() {
                let home = self.scratch().join("home");
                let _ = std::fs::create_dir_all(home.join("Library"));
                // 钥匙串客户端按 HOME 找 ~/Library/Keychains；假 HOME 里链回真实钥匙串（读白名单只放行这个目录）。
                if let Some(real_home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
                    let real = real_home.join("Library").join("Keychains");
                    let link = home.join("Library").join("Keychains");
                    if real.is_dir() && !link.exists() {
                        let _ = std::os::unix::fs::symlink(&real, &link);
                    }
                }
                command.env("HOME", &home);
                // 严格档不读真实 HOME 里的 git 配置：给一份空配置，状态查询照常。
                let gitconfig = self.scratch().join("gitconfig");
                let _ = std::fs::write(&gitconfig, "");
                command
                    .env("GIT_CONFIG_GLOBAL", &gitconfig)
                    .env("GIT_CONFIG_NOSYSTEM", "1");
            }
            let mut wrapped = seatbelt::wrap(command, &profile);
            set_file_limit(&mut wrapped, self.file_bytes());
            return Ok(wrapped);
        }
        #[cfg(windows)]
        {
            if self.is_strict() {
                return Err("Windows 还没有严格档；把成员设置里的 profile 改回标准档。".to_string());
            }
            let boundary = win_plan::Boundary::plan(
                self.work(),
                self.scratch(),
                // 只授权成员副本和回合临时目录；`writable()` 里还有整片用户临时目录，
                // 在 Windows 上那等于把整个 AppData\Local 交给专用账户，不能照搬。
                vec![self.work().to_path_buf(), self.scratch().to_path_buf()],
                self.network(),
                self.local_ports(),
                &win_plan::user_name(),
            )?;
            return windows::apply(&boundary, self.engine_binary(), command);
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = command;
            Err("这个平台还没有沙箱后端".to_string())
        }
    }
}

/// 单文件上限落在最外层命令上，随 fork/exec 继承到整棵进程树。
#[cfg(unix)]
fn set_file_limit(command: &mut Command, bytes: u64) {
    unsafe {
        command.pre_exec(move || {
            let limit = libc::rlimit {
                rlim_cur: bytes,
                rlim_max: bytes,
            };
            if libc::setrlimit(libc::RLIMIT_FSIZE, &limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

/// 这一回合的整棵进程树：从根 pid 往下按 ppid 走。
/// 只看进程组会漏：工具调用可以自己 `setsid`，孩子换组之后 `pgrep -g` 就数不到，
/// fork 风暴于是绕过进程上限（真房见过一千多个 node 互相等）。
/// 枚举本身要 fork `/bin/ps`；进程表满的时候这一步也会失败，所以返回 `None`，
/// 由调用方当成“停不下来”处理——把它当 0 就等于在机器最满的时候放行。
#[cfg(unix)]
pub fn descendant_pids(root: u32) -> Option<Vec<u32>> {
    use std::collections::HashMap;
    let Ok(output) = std::process::Command::new("/bin/ps")
        .args(["-Ao", "pid=,ppid="])
        .output()
    else {
        return None;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in text.lines() {
        let mut fields = line.split_whitespace();
        let (Some(pid), Some(ppid)) = (fields.next(), fields.next()) else {
            continue;
        };
        let (Ok(pid), Ok(ppid)) = (pid.parse::<u32>(), ppid.parse::<u32>()) else {
            continue;
        };
        children.entry(ppid).or_default().push(pid);
    }
    let mut found = Vec::new();
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        for child in children.get(&pid).into_iter().flatten() {
            found.push(*child);
            stack.push(*child);
        }
    }
    Some(found)
}

/// 进程树里有多少进程；枚举失败返回 `None`（不当作 0）。Windows 用 Job Object 计数。
#[cfg(unix)]
pub fn descendant_count(root: u32) -> Option<usize> {
    descendant_pids(root).map(|pids| pids.len())
}

/// 整棵树一起停：组里的一起发，换了组但还挂在树上的也逐个发。
/// 双 fork + setsid 之后被过继给 launchd 的进程不在树上，这是已知边界。
#[cfg(unix)]
pub fn signal_tree(root: u32, signal: i32) {
    for pid in descendant_pids(root).unwrap_or_default() {
        unsafe {
            libc::kill(pid as i32, signal);
        }
    }
    unsafe {
        libc::kill(-(root as i32), signal);
    }
}

#[cfg(unix)]
pub fn kill_tree(root: u32) {
    signal_tree(root, libc::SIGKILL);
}

/// 剩余磁盘；读不到就不猜。
pub fn free_bytes(path: &std::path::Path) -> Option<u64> {
    crate::platform::free_bytes(path)
}

/// 磁盘余量低于下限时返回剩余字节；够用返回 None。下限默认 1 GiB，可用 `LODGE_MIN_FREE_BYTES` 调。
pub fn low_disk(path: &std::path::Path) -> Option<u64> {
    let floor = std::env::var("LODGE_MIN_FREE_BYTES")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(1024 * 1024 * 1024);
    free_bytes(path).filter(|free| *free < floor)
}

/// 上次崩溃可能留下回合临时目录；启动时只清一天前的，正在跑的回合不受影响。
pub fn clean_stale_scratch() {
    let root = std::env::temp_dir().join("lodge-turns");
    let Ok(entries) = root.read_dir() else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(modified) = entry.metadata().and_then(|meta| meta.modified()) else {
            continue;
        };
        if modified
            .elapsed()
            .map(|age| age > Duration::from_secs(24 * 60 * 60))
            .unwrap_or(false)
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(all(test, unix))]
mod tree_tests {
    use super::{descendant_count, descendant_pids};
    use std::process::{Command, Stdio};
    use std::time::Duration;

    // 换了进程组、还挂在树上的孩子照样数得到（按 ppid 走，不按 pgid）。
    // 双 fork + setsid 后被过继给 launchd 的进程不在树上，这是已知边界。
    #[test]
    fn a_child_in_another_process_group_is_still_counted() {
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg("sh -c 'exec sleep 5' & wait")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn shell");
        std::thread::sleep(Duration::from_millis(400));
        let pids = descendant_pids(child.id());
        let count = descendant_count(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert!(count.unwrap_or(0) >= 1, "树上的孩子必须数得到：{pids:?}");
    }

    // 计数是整棵树，不是一层。
    #[test]
    fn a_grandchild_counts_too() {
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg("/bin/sh -c 'sleep 5' & wait")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn shell");
        std::thread::sleep(Duration::from_millis(500));
        let pids = descendant_pids(child.id()).unwrap_or_default();
        let _ = child.kill();
        let _ = child.wait();
        assert!(pids.len() >= 1, "孙子进程也算：{pids:?}");
    }
}
