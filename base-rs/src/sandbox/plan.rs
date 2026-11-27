//! 沙箱的唯一构造函数：一份边界值只从这里出生。
//!
//! 输入全部显式给出，不从进程环境里猜。这里只做判断——可写哪里、读不到哪里、怎么出网——
//! 不碰任何平台；渲染规则和包装命令在 `seatbelt.rs`。

use std::path::{Path, PathBuf};

/// 单文件上限：默认 512 MiB；声明可以收窄，但不能放开到无上限。
pub const DEFAULT_FILE_BYTES: u64 = 512 * 1024 * 1024;
pub const MIN_FILE_BYTES: u64 = 1024 * 1024;
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024 * 1024;
/// 进程数上限：默认 128；声明可以收窄，不能放开到无上限。
pub const DEFAULT_PROCESSES: u32 = 128;
pub const MIN_PROCESSES: u32 = 4;
pub const MAX_PROCESSES: u32 = 4096;

/// 用户凭据目录（相对 HOME）。默认读不到；要用就在声明里放开。
/// 这张表是唯一一份，改它就必须同步基准的探针与文档。
const SECRET_PATHS: &[&str] = &[
    // 密钥与云凭据
    ".ssh",
    ".aws",
    ".gnupg",
    ".config/gh",
    ".config/gcloud",
    ".config/op",
    ".config/sops",
    ".config/age",
    // 包管理器与仓库令牌
    ".npmrc",
    ".netrc",
    ".pypirc",
    ".git-credentials",
    ".vault-token",
    ".cargo/credentials",
    ".cargo/credentials.toml",
    ".docker/config.json",
    ".kube/config",
    // 浏览器配置：cookies、历史、密码库
    "Library/Application Support/Google/Chrome",
    "Library/Application Support/Firefox",
    "Library/Application Support/BraveSoftware",
    "Library/Application Support/Microsoft Edge",
    "Library/Safari",
];

/// 这一回合怎么出网。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Network {
    /// 没有出口代理（显式 `LODGE_EGRESS=off`）：网络不限。
    Open,
    /// 只允许连基座的出口代理，代理再按白名单决定去哪里。
    Proxy { port: u16 },
    /// 整轮不出网（证明/反例这种平台重跑的命令）。
    None,
}

/// 建立一份边界需要的事实。
pub struct TurnInputs {
    pub turn_id: String,
    /// 成员自己的工作副本。
    pub work: String,
    /// 别人的工作副本：同房和其他房间都要挡。
    pub other_worktrees: Vec<String>,
    /// 基座自己的数据目录。
    pub base_dir: String,
    /// 用户 HOME；只用来挡密钥目录、找引擎配置。
    pub home: Option<PathBuf>,
    pub network: Network,
    /// 单文件上限（字节）；缺声明用默认值。
    pub file_bytes: Option<u64>,
    /// 进程数上限；缺声明用默认值。
    pub processes: Option<u32>,
    /// 严格档：假 HOME + 读白名单（系统、工作副本、临时目录、钥匙串）。
    pub strict: bool,
    /// 引擎入口；严格档要放行它的安装目录，否则引擎起不来。
    pub engine_binary: Option<PathBuf>,
    /// 这回合要连的本机端口（MCP 提供方，比如电脑操作桥）；只在这些端口上放行回环。
    pub local_ports: Vec<u16>,
}

/// 一次回合的边界。值一旦建好就不再变，反序列化不了也不需要。
pub struct TurnSandbox {
    work: PathBuf,
    scratch: Scratch,
    #[cfg_attr(windows, allow(dead_code))]
    writable: Vec<PathBuf>,
    #[cfg_attr(windows, allow(dead_code))]
    read_deny: Vec<PathBuf>,
    /// 回合临时目录的公共根：别的回合的临时目录（含引擎凭据拷贝）在这里面。
    #[cfg_attr(windows, allow(dead_code))]
    scratch_deny: Vec<PathBuf>,
    /// 本回合自己的临时目录：公共根之后重新放开。
    #[cfg_attr(windows, allow(dead_code))]
    scratch_allow: Vec<PathBuf>,
    /// 工作副本里的 `.git`：每条路径形态都只读。
    #[cfg_attr(windows, allow(dead_code))]
    git_deny: Vec<PathBuf>,
    network: Network,
    #[cfg_attr(windows, allow(dead_code))]
    file_bytes: u64,
    processes: u32,
    /// 严格档的读白名单与祖先字面量；标准档为空（读默认开放）。
    #[cfg_attr(windows, allow(dead_code))]
    read_allow: Vec<PathBuf>,
    #[cfg_attr(windows, allow(dead_code))]
    read_ancestors: Vec<PathBuf>,
    strict: bool,
    engine_home: Option<PathBuf>,
    /// 引擎入口：Windows 沙箱要按它授权读，专用账户才找得到引擎。
    #[cfg_attr(not(windows), allow(dead_code))]
    engine_binary: Option<PathBuf>,
    /// 走代理时额外放行的本机端口（MCP 提供方）；整轮不出网时不放行任何本机端口。
    local_ports: Vec<u16>,
}

impl TurnSandbox {
    pub fn plan(inputs: TurnInputs) -> Result<TurnSandbox, String> {
        let work = if inputs.work.trim().is_empty() {
            PathBuf::from("/tmp")
        } else {
            PathBuf::from(&inputs.work)
        };
        let scratch_root = std::env::temp_dir().join("lodge-turns");
        let scratch = Scratch::create(scratch_root.join(&inputs.turn_id))?;
        let writable = writable_roots(&work, scratch.path());
        let mut candidates: Vec<PathBuf> = inputs.other_worktrees.iter().map(PathBuf::from).collect();
        if !inputs.base_dir.trim().is_empty() {
            candidates.push(PathBuf::from(&inputs.base_dir));
        }
        if let Some(home) = &inputs.home {
            for relative in SECRET_PATHS {
                candidates.push(home.join(relative));
            }
        }
        let read_deny = deny_roots(candidates, &work, &writable);
        let scratch_deny = path_forms(&scratch_root);
        let scratch_allow = path_forms(scratch.path());
        let git_deny = git_deny_roots(&work);
        let file_bytes = inputs
            .file_bytes
            .unwrap_or(DEFAULT_FILE_BYTES)
            .clamp(MIN_FILE_BYTES, MAX_FILE_BYTES);
        let processes = inputs
            .processes
            .unwrap_or(DEFAULT_PROCESSES)
            .clamp(MIN_PROCESSES, MAX_PROCESSES);
        let engine_home = if super::enabled() {
            Some(prepare_engine_home(&scratch.path().join("home"), inputs.home.as_deref())?)
        } else {
            None
        };
        // 严格档：读只给声明过的根，HOME 换成一次性目录；祖先目录用 literal 放行路径查找。
        let (read_allow, read_ancestors) = if inputs.strict {
            let mut roots = vec![
                PathBuf::from("/System"),
                PathBuf::from("/usr"),
                PathBuf::from("/bin"),
                PathBuf::from("/sbin"),
                PathBuf::from("/Library"),
                PathBuf::from("/Applications"),
                PathBuf::from("/opt"),
                PathBuf::from("/private/etc"),
                PathBuf::from("/private/var/db"),
                PathBuf::from("/private/var/run"),
                PathBuf::from("/dev"),
            ];
            roots.extend(path_forms(&work));
            roots.extend(path_forms(scratch.path()));
            roots.extend(path_forms(&std::env::temp_dir()));
            if let Some(home) = &inputs.home {
                roots.extend(path_forms(&home.join("Library").join("Keychains")));
                roots.extend(path_forms(&home.join(".pi").join("agent").join("bin")));
            }
            if let Some(binary) = &inputs.engine_binary {
                roots.extend(engine_read_roots(binary));
            }
            // 基座自己的可执行文件：MCP 网关就是它的 `--mcp-gate`，引擎要能在沙箱里拉起它。
            if let Ok(exe) = std::env::current_exe() {
                roots.push(exe);
            }
            let roots = canonical_dedup(roots);
            let mut ancestors = Vec::new();
            for root in &roots {
                ancestors.extend(path_ancestors(root));
            }
            (roots, canonical_dedup(ancestors))
        } else {
            (Vec::new(), Vec::new())
        };
        let mut local_ports: Vec<u16> = if matches!(inputs.network, Network::Proxy { .. }) {
            inputs.local_ports.into_iter().filter(|port| *port != 0).collect()
        } else {
            Vec::new()
        };
        local_ports.sort();
        local_ports.dedup();
        Ok(TurnSandbox {
            work,
            scratch,
            writable,
            read_deny,
            scratch_deny,
            scratch_allow,
            git_deny,
            network: inputs.network,
            file_bytes,
            processes,
            read_allow,
            read_ancestors,
            strict: inputs.strict,
            engine_home,
            engine_binary: inputs.engine_binary.clone(),
            local_ports,
        })
    }

    /// 成员的工作副本：回合的当前目录。
    pub fn work(&self) -> &Path {
        &self.work
    }

    /// 回合自己的临时目录（扩展、MCP 配置、沙箱规则、引擎目录）；回合结束随值销毁。
    pub fn scratch(&self) -> &Path {
        self.scratch.path()
    }

    /// 可写根：工作副本、临时目录、终端设备之外的写一律拒绝。
    #[cfg_attr(windows, allow(dead_code))]
    pub fn writable(&self) -> &[PathBuf] {
        &self.writable
    }

    /// 连读都不给的目录；对每条路径的原样形式和 realpath 形式都生效。
    #[cfg_attr(windows, allow(dead_code))]
    pub fn read_deny(&self) -> &[PathBuf] {
        &self.read_deny
    }

    /// 回合临时目录的公共根：先整片拒绝（别的回合的引擎凭据拷贝在这里）。
    #[cfg_attr(windows, allow(dead_code))]
    pub fn scratch_deny(&self) -> &[PathBuf] {
        &self.scratch_deny
    }

    /// 本回合自己的临时目录：在公共根的拒绝之后重新放开。
    #[cfg_attr(windows, allow(dead_code))]
    pub fn scratch_allow(&self) -> &[PathBuf] {
        &self.scratch_allow
    }

    /// 工作副本里的 `.git` 只读，原样和 realpath 两种形态都收。
    #[cfg_attr(windows, allow(dead_code))]
    pub fn git_deny(&self) -> &[PathBuf] {
        &self.git_deny
    }

    pub fn network(&self) -> &Network {
        &self.network
    }

    /// 单文件上限（字节）：由包装层用 setrlimit 落下去。
    #[cfg_attr(windows, allow(dead_code))]
    pub fn file_bytes(&self) -> u64 {
        self.file_bytes
    }

    /// 进程数上限：由看门人按进程组计数执行。
    pub fn processes(&self) -> u32 {
        self.processes
    }

    /// 严格档：有读白名单，HOME 指向一次性目录。
    pub fn is_strict(&self) -> bool {
        self.strict
    }

    #[cfg_attr(windows, allow(dead_code))]
    pub fn read_allow(&self) -> &[PathBuf] {
        &self.read_allow
    }

    #[cfg_attr(windows, allow(dead_code))]
    pub fn read_ancestors(&self) -> &[PathBuf] {
        &self.read_ancestors
    }

    /// 沙箱里引擎自己的目录；沙箱关着时没有，引擎用真实的 ~/.pi。
    pub fn engine_home(&self) -> Option<&Path> {
        self.engine_home.as_deref()
    }

    /// 引擎入口：Windows 沙箱按它给专用账户授权读。
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn engine_binary(&self) -> Option<&Path> {
        self.engine_binary.as_deref()
    }

    /// 走代理时额外放行的本机端口（MCP 提供方）。
    pub fn local_ports(&self) -> &[u16] {
        &self.local_ports
    }
}

/// 回合临时目录：建出来就归这个值，值没了目录也清掉，崩了由启动时的清扫兜底。
struct Scratch(PathBuf);

impl Scratch {
    fn create(dir: PathBuf) -> Result<Scratch, String> {
        std::fs::create_dir_all(&dir).map_err(|error| format!("回合的临时目录建不起来：{error}"))?;
        Ok(Scratch(dir))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// 可写：工作副本、回合临时目录、系统临时目录和用户临时根（钥匙串的模块缓存写在上一级）。
/// Seatbelt 按打开时的路径匹配，软链两边各算一次，所以每条根都收原样和 realpath。
fn writable_roots(work: &Path, scratch: &Path) -> Vec<PathBuf> {
    let temp = std::env::temp_dir();
    let mut roots = vec![
        work.to_path_buf(),
        scratch.to_path_buf(),
        temp.clone(),
        PathBuf::from("/tmp"),
    ];
    if let Some(parent) = temp.parent() {
        roots.push(parent.to_path_buf());
    }
    let resolved: Vec<PathBuf> = roots
        .iter()
        .filter_map(|path| std::fs::canonicalize(path).ok())
        .collect();
    roots.extend(resolved);
    canonical_dedup(roots)
}

/// 读不到：别人的工作副本、基座数据目录、用户密钥目录。
/// 一条规则如果会挡住自己（目标包含某个可写根，或者就是工作副本本身），不成立也不收：
/// 它挡不住别人，只会弄坏自己的回合。
fn deny_roots(candidates: Vec<PathBuf>, work: &Path, writable: &[PathBuf]) -> Vec<PathBuf> {
    let mut deny = Vec::new();
    for candidate in candidates {
        if candidate.as_os_str().is_empty() {
            continue;
        }
        // 原样和 realpath 两种形态都要比：工作目录可能以 realpath 给进来，而基座目录是字面路径。
        let forms = path_forms(&candidate);
        if forms.iter().all(|form| form == work) {
            continue;
        }
        if forms
            .iter()
            .any(|form| writable.iter().any(|root| root.starts_with(form)))
        {
            continue;
        }
        deny.extend(forms);
    }
    canonical_dedup(deny)
}

/// `.git` 在每条路径形态下都只读。Seatbelt 按打开时的路径匹配，工作副本常是软链
/// （`/var` → `/private/var`）；只写一种形态，等于留了一条能改仓库元数据的路。
fn git_deny_roots(work: &Path) -> Vec<PathBuf> {
    let mut roots = vec![work.join(".git")];
    if let Ok(real) = std::fs::canonicalize(work) {
        let real = real.join(".git");
        if !roots.contains(&real) {
            roots.push(real);
        }
    }
    canonical_dedup(roots)
}

/// 一条路径的原样形态和 realpath 形态：Seatbelt 按打开时的路径匹配，两种都要。
fn path_forms(path: &Path) -> Vec<PathBuf> {
    let mut forms = vec![path.to_path_buf()];
    if let Ok(real) = std::fs::canonicalize(path) {
        if real != path {
            forms.push(real);
        }
    }
    canonical_dedup(forms)
}

/// 引擎的安装目录：严格档只放行引擎自己的东西（入口、包根或脚本所在目录）。
fn engine_read_roots(binary: &Path) -> Vec<PathBuf> {
    let mut roots = path_forms(binary);
    if let Some(parent) = binary.parent() {
        roots.extend(path_forms(parent));
    }
    if let Ok(real) = std::fs::canonicalize(binary) {
        roots.extend(path_forms(&real));
        let mut package = None;
        let mut current = real.parent();
        while let Some(dir) = current {
            if dir.file_name().map(|name| name == "node_modules").unwrap_or(false) {
                package = Some(dir.to_path_buf());
                break;
            }
            current = dir.parent();
        }
        if let Some(package) = package {
            roots.extend(path_forms(&package));
        } else if let Some(parent) = real.parent() {
            roots.extend(path_forms(parent));
        }
    }
    roots
}

/// 一条路径的所有祖先（不含自己，含 `/`）：严格档用它放行路径查找。
fn path_ancestors(path: &Path) -> Vec<PathBuf> {
    let mut ancestors = Vec::new();
    let mut current = path.parent();
    while let Some(parent) = current {
        ancestors.push(parent.to_path_buf());
        if parent == Path::new("/") {
            break;
        }
        current = parent.parent();
    }
    ancestors
}

fn canonical_dedup(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort();
    paths.dedup();
    paths
}

/// 沙箱里的引擎目录：登录与模型配置拷进去，锁文件、信任文件写在里面，不碰真实的 ~/.pi。
/// 拷而不是链，免得引擎刷新令牌时写到沙箱外的真文件。建不起来就让回合失败，不裸跑。
fn prepare_engine_home(dir: &Path, home: Option<&Path>) -> Result<PathBuf, String> {
    let agent = dir.join(".pi").join("agent");
    std::fs::create_dir_all(&agent).map_err(|error| format!("沙箱里的引擎目录建不起来：{error}"))?;
    if let Some(home) = home {
        let source = home.join(".pi").join("agent");
        for name in ["auth.json", "models.json", "models-store.json", "settings.json"] {
            let from = source.join(name);
            if from.is_file() {
                std::fs::copy(&from, agent.join(name))
                    .map_err(|error| format!("引擎配置 {name} 拷不进沙箱：{error}"))?;
            }
        }
        let bin = source.join("bin");
        if bin.is_dir() {
            #[cfg(unix)]
            std::os::unix::fs::symlink(&bin, agent.join("bin"))
                .map_err(|error| format!("引擎 bin 链不进沙箱：{error}"))?;
        }
        // claude 按 HOME 找配置；严格档 HOME 是假的，所以把它的设置和登录一起带进来。
        let claude = dir.join(".claude");
        std::fs::create_dir_all(&claude).map_err(|error| format!("claude 配置目录建不起来：{error}"))?;
        for name in ["settings.json", ".credentials.json"] {
            let from = home.join(".claude").join(name);
            if from.is_file() {
                std::fs::copy(&from, claude.join(name))
                    .map_err(|error| format!("claude 配置 {name} 拷不进沙箱：{error}"))?;
            }
        }
        let global = home.join(".claude.json");
        if global.is_file() {
            std::fs::copy(&global, dir.join(".claude.json"))
                .map_err(|error| format!("claude 全局配置拷不进沙箱：{error}"))?;
        }
    }
    std::fs::create_dir_all(agent.join("sessions"))
        .map_err(|error| format!("引擎会话目录建不起来：{error}"))?;
    Ok(agent)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("lodge-plan-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn writable_covers_work_scratch_and_both_forms_of_temp() {
        let root = temp_root("writable");
        let work = root.join("work");
        std::fs::create_dir_all(&work).unwrap();
        let scratch = root.join("scratch");
        let roots = writable_roots(&work, &scratch);
        assert!(roots.contains(&work), "the work copy is writable");
        assert!(roots.contains(&scratch), "the turn scratch is writable");
        assert!(
            roots.contains(&std::fs::canonicalize(&work).unwrap()),
            "the resolved form is writable too"
        );
        assert!(roots.iter().any(|path| path == Path::new("/tmp")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_deny_rule_that_would_block_the_work_copy_is_dropped() {
        let writable = vec![PathBuf::from("/tmp/work")];
        let denied = deny_roots(
            vec![
                PathBuf::from("/tmp/work"),
                PathBuf::from("/tmp"),
                PathBuf::from("/tmp/sibling"),
            ],
            Path::new("/tmp/work"),
            &writable,
        );
        assert!(!denied.contains(&PathBuf::from("/tmp/work")), "the work copy itself");
        assert!(!denied.contains(&PathBuf::from("/tmp")), "an ancestor of the work copy");
        assert!(denied.contains(&PathBuf::from("/tmp/sibling")), "a sibling stays denied");
    }

    #[test]
    fn the_base_dir_and_secrets_are_denied_but_never_the_work_copy_inside_them() {
        let home = PathBuf::from("/Users/someone");
        let writable = vec![home.join("repo")];
        let denied = deny_roots(
            vec![home.join(".ssh"), PathBuf::from("/Users/someone")],
            &home.join("repo"),
            &writable,
        );
        assert!(denied.contains(&home.join(".ssh")));
        assert!(!denied.iter().any(|path| home.join("repo").starts_with(path)));
    }

    #[test]
    fn engine_home_copies_config_and_keeps_the_real_agent_dir_untouched() {
        let root = temp_root("engine");
        let home = root.join("home");
        std::fs::create_dir_all(home.join(".pi").join("agent").join("bin")).unwrap();
        std::fs::write(home.join(".pi").join("agent").join("auth.json"), "{}").unwrap();
        let agent = prepare_engine_home(&root.join("sandbox"), Some(&home)).unwrap();
        assert!(agent.join("auth.json").is_file(), "auth is copied, not linked");
        assert!(agent.join("sessions").is_dir());
        assert!(agent.join("bin").exists(), "the engine bin is linked in");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn engine_home_carries_claude_settings_into_the_fake_home() {
        // 严格档的 HOME 是一次性目录；claude 的登录和端点只在这里找得到。
        let root = temp_root("engine-claude");
        let home = root.join("home");
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::write(home.join(".claude").join("settings.json"), "{}").unwrap();
        std::fs::write(home.join(".claude").join(".credentials.json"), "{}").unwrap();
        std::fs::write(home.join(".claude.json"), "{}").unwrap();
        let sandbox = root.join("sandbox");
        prepare_engine_home(&sandbox, Some(&home)).unwrap();
        assert!(sandbox.join(".claude").join("settings.json").is_file());
        assert!(sandbox.join(".claude").join(".credentials.json").is_file());
        assert!(sandbox.join(".claude.json").is_file(), "global config sits at HOME root");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_deny_rule_is_dropped_when_only_the_realpath_form_contains_the_work_copy() {
        // 工作目录以 realpath 给进来，基座目录是 /var 字面路径：不能把自己挡死。
        let root = temp_root("deny-forms");
        let work = root.join("work");
        std::fs::create_dir_all(&work).unwrap();
        let real_work = std::fs::canonicalize(&work).unwrap();
        let writable = writable_roots(&real_work, &root.join("scratch"));
        let denied = deny_roots(vec![root.clone()], &real_work, &writable);
        assert!(denied.is_empty(), "an ancestor of the real work copy must not be denied");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn git_is_read_only_under_both_forms_of_the_work_path() {
        let root = temp_root("git-deny");
        let work = root.join("work");
        std::fs::create_dir_all(work.join(".git")).unwrap();
        let roots = git_deny_roots(&work);
        assert!(roots.contains(&work.join(".git")));
        assert!(roots.contains(&std::fs::canonicalize(&work).unwrap().join(".git")));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn every_credential_path_is_denied_in_both_forms() {
        let root = temp_root("credentials");
        let home = root.join("home");
        let work = root.join("work");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&work).unwrap();
        let plan = TurnSandbox::plan(TurnInputs {
            turn_id: format!("creds-{}", std::process::id()),
            work: work.display().to_string(),
            other_worktrees: Vec::new(),
            base_dir: String::new(),
            home: Some(home.clone()),
            network: Network::Open,
            file_bytes: None,
            processes: None,
            strict: false,
            engine_binary: None,
            local_ports: Vec::new(),
        })
        .unwrap();
        for relative in SECRET_PATHS {
            let path = home.join(relative);
            assert!(
                plan.read_deny().contains(&path),
                "{relative} must be readable-denied"
            );
        }
        drop(plan);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_plan_owns_its_scratch_and_takes_it_with_it() {
        let plan = TurnSandbox::plan(TurnInputs {
            turn_id: format!("plan-test-{}", std::process::id()),
            work: std::env::temp_dir().display().to_string(),
            other_worktrees: Vec::new(),
            base_dir: String::new(),
            home: None,
            network: Network::Open,
            file_bytes: None,
            processes: None,
            strict: false,
            engine_binary: None,
            local_ports: Vec::new(),
        })
        .unwrap();
        let scratch = plan.scratch().to_path_buf();
        assert!(scratch.is_dir());
        assert!(plan.writable().contains(&scratch), "the scratch is inside the boundary");
        assert_eq!(
            plan.engine_home().is_some(),
            crate::sandbox::enabled(),
            "an engine home exists exactly when the sandbox does"
        );
        drop(plan);
        assert!(!scratch.exists(), "the scratch goes away with the turn");
    }
}
