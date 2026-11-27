//! Windows 沙箱后端：专用账户 + ACL + WFP + Job Object。
//!
//! 分工和 macOS 一样：`win_plan` 算出边界（谁、可写哪里、只放行哪个回环端口），
//! 这里只执行。安装一次（需要管理员）：建账户、存 DPAPI 保护的密码、装 WFP 过滤。
//!
//! 启动分两层，绕开 `CreateProcessWithLogonW` 的 1024 字符命令行上限：
//! 1. `--sandbox-exec` 读回合的参数包，用 `CreateProcessWithLogonW` 起一个短的
//!    引导进程（还是本二进制，`--sandbox-child`），放进 `KILL_ON_JOB_CLOSE` 的 Job；
//! 2. 引导进程已经以专用账户运行，再用普通的 `CreateProcessW` 起真正的命令，
//!    完整参数（最长 32K）从这里走，标准流用可继承的管道句柄接回基座。
//! Job 会把引导进程的子进程一起收进去；关闭 Job 句柄整棵树一起走。
//!
//! 不借 Claude Code 的整份 profile 读授权：这里只给成员副本、回合临时目录、
//! 祖先的 traverse 和引擎入口的读执行；别的工作副本与基座数据目录靠默认 ACL 拒绝。

use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};

use tokio::process::Command;
use windows_sys::Win32::Foundation::{
    CloseHandle, DuplicateHandle, GetLastError, LocalFree, DUPLICATE_SAME_ACCESS, HANDLE,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::{
    FwpmEngineClose0, FwpmEngineOpen0, FwpmFilterAdd0, FwpmFilterCreateEnumHandle0,
    FwpmFilterDeleteById0, FwpmFilterDestroyEnumHandle0, FwpmFilterEnum0, FwpmFreeMemory0,
    FwpmSubLayerAdd0, FwpmSubLayerDeleteByKey0, FwpmSubLayerGetByKey0, FWPM_ACTION0,
    FWPM_CONDITION_ALE_USER_ID, FWPM_CONDITION_IP_REMOTE_ADDRESS, FWPM_CONDITION_IP_REMOTE_PORT,
    FWPM_DISPLAY_DATA0, FWPM_FILTER0, FWPM_FILTER_CONDITION0, FWPM_FILTER_ENUM_TEMPLATE0,
    FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT, FWPM_FILTER_FLAG_PERSISTENT,
    FWPM_LAYER_ALE_AUTH_CONNECT_V4, FWPM_LAYER_ALE_AUTH_CONNECT_V6,
    FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4, FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6, FWPM_SUBLAYER0,
    FWPM_SUBLAYER_FLAG_PERSISTENT, FWP_ACTION_BLOCK, FWP_ACTION_PERMIT, FWP_ACTION_TYPE,
    FWP_BYTE_BLOB, FWP_CONDITION_VALUE0, FWP_FILTER_ENUM_FULLY_CONTAINED, FWP_MATCH_EQUAL,
    FWP_SECURITY_DESCRIPTOR_TYPE, FWP_UINT16, FWP_UINT64, FWP_VALUE0, FWP_V4_ADDR_AND_MASK,
    FWP_V4_ADDR_MASK, FWP_V6_ADDR_AND_MASK, FWP_V6_ADDR_MASK,
};
use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};
use windows_sys::Win32::Security::{LookupAccountNameW, SID_NAME_USE};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, CreateProcessWithLogonW, GetCurrentProcess, GetExitCodeProcess, ResumeThread,
    TerminateProcess, WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED,
    CREATE_UNICODE_ENVIRONMENT, LOGON_WITH_PROFILE, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
    STARTUPINFOW,
};

use super::win_plan::{Boundary, LOCAL_PORTS};

const ERROR_SUCCESS: u32 = 0;
const INFINITE: u32 = 0xFFFF_FFFF;
const FWP_E_FILTER_NOT_FOUND: u32 = 0x8032_0003;
const FWP_E_SUBLAYER_NOT_FOUND: u32 = 0x8032_0007;
/// 专用子层的固定 GUID：卸载和重装都靠它找到自己装的东西。
const SUBLAYER: windows_sys::core::GUID =
    windows_sys::core::GUID::from_u128(0x6b7f2f5e_1c3a_4e8b_9d2a_5f4c6e7a8b91);

#[derive(Clone, Copy, PartialEq, Eq)]
enum Action {
    Block,
    Permit,
}

#[derive(Clone, Copy)]
enum Layer {
    ConnectV4,
    ConnectV6,
    AcceptV4,
    AcceptV6,
}

/// 安装期固定的 WFP 规则：连接只放行回环代理端口，其余出网全拒；入站也全拒。
#[derive(Clone, Copy)]
struct Rule {
    layer: Layer,
    action: Action,
    port: Option<u16>,
}

/// 一个回合的参数包：真正的命令和参数太长，塞不进沙箱启动器的命令行。
#[derive(serde::Serialize, serde::Deserialize)]
struct Package {
    program: String,
    args: Vec<String>,
    cwd: String,
}

/// `/api/health` 的 box 字段：装好了才算 on；装了一半、或显式要求沙箱时也报 on，
/// 让回合 fail closed，而不是悄悄裸跑。
pub fn state() -> &'static str {
    match std::env::var("LODGE_SANDBOX").as_deref() {
        Ok("on") => "on",
        Ok("off") => "off",
        _ => {
            if installed() || partial_file().is_file() {
                "on"
            } else {
                "off"
            }
        }
    }
}

/// 普通用户读不到 WFP 状态（打开引擎要管理员），所以按安装标记判断：
/// 账户在、密码在、安装时写的过滤记录在，就算装好。`--sandbox-status`（管理员）
/// 才去核对子层是否真的还在；删除过滤属于管理员越权，不在这一层的威胁模型里。
pub fn installed() -> bool {
    secret_file().is_file()
        && filters_file().is_file()
        && !partial_file().is_file()
        && account_exists(&super::win_plan::user_name())
}

fn install_dir() -> PathBuf {
    local_appdata().join("lodge").join("sandbox")
}

fn secret_file() -> PathBuf {
    install_dir().join("secret.bin")
}

fn filters_file() -> PathBuf {
    install_dir().join("filters.txt")
}

fn owned_file() -> PathBuf {
    install_dir().join("owned")
}

fn partial_file() -> PathBuf {
    install_dir().join("install.partial")
}

fn local_appdata() -> PathBuf {
    if let Some(value) = std::env::var_os("LOCALAPPDATA") {
        return PathBuf::from(value);
    }
    crate::platform::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AppData")
        .join("Local")
}

/// 把边界落到命令上：给副本授权、写参数包，再交给 `--sandbox-exec` 以专用账户启动。
pub fn apply(boundary: &Boundary, engine_binary: Option<&Path>, command: Command) -> Result<Command, String> {
    if !installed() {
        return Err("Windows 沙箱还没装好：先运行 lodge-base-slice --sandbox-install（需要管理员）。".to_string());
    }
    for path in boundary.traverse() {
        if path.as_os_str().is_empty() || !path.exists() {
            continue;
        }
        // 祖先只给 traverse；失败不致命（权限可能本来就有），真挡路时下面的授权会报错。
        let _ = grant(&path, &boundary.user, "(X)");
    }
    for path in &boundary.writable {
        if !path.exists() {
            continue;
        }
        grant(path, &boundary.user, "(OI)(CI)M")?;
    }
    // 引擎常常装在当前用户的目录里（%APPDATA%\npm 之类），专用账户默认读不到；
    // 只给引擎入口的读执行，不给整个用户目录的写。
    if let Some(binary) = engine_binary {
        if let Some(dir) = binary.parent() {
            let _ = grant(dir, &boundary.user, "(OI)(CI)RX");
        }
        let _ = grant(binary, &boundary.user, "RX");
    }
    let home = boundary.scratch.join("home");
    let temp = boundary.scratch.join("tmp");
    let roaming = home.join("AppData").join("Roaming");
    let local = home.join("AppData").join("Local");
    for dir in [&home, &temp, &roaming, &local] {
        std::fs::create_dir_all(dir).map_err(|error| format!("沙箱里的目录建不起来：{error}"))?;
    }
    for dir in [&home, &temp] {
        grant(dir, &boundary.user, "(OI)(CI)M")?;
    }

    let package = Package {
        program: command.as_std().get_program().to_string_lossy().to_string(),
        args: command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect(),
        cwd: command
            .as_std()
            .get_current_dir()
            .unwrap_or(boundary.work.as_path())
            .to_string_lossy()
            .to_string(),
    };
    let package_path = boundary.scratch.join("exec.json");
    std::fs::write(&package_path, serde_json::to_vec(&package).map_err(|error| error.to_string())?)
        .map_err(|error| format!("回合的参数包写不出来：{error}"))?;

    let exe = std::env::current_exe().map_err(|error| format!("找不到基座自己：{error}"))?;
    let mut wrapped = Command::new(exe);
    wrapped
        .arg("--sandbox-exec")
        .arg("--user")
        .arg(&boundary.user)
        .arg("--package")
        .arg(&package_path)
        .current_dir(&boundary.work)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    // 包装层默认继承基座的全部环境；先清掉，再只带原命令显式声明的那几样。
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
        .env("TEMP", &temp)
        .env("TMP", &temp)
        .env("HOME", &home)
        .env("USERPROFILE", &home)
        .env("APPDATA", &roaming)
        .env("LOCALAPPDATA", &local);
    Ok(wrapped)
}

/// `--sandbox-exec`：以专用账户起引导进程（短命令行），Job 兜住整棵树。
pub fn exec_helper(args: &[String]) -> i32 {
    let user = flag_value(args, "--user").unwrap_or_default();
    let package = flag_value(args, "--package").unwrap_or_default();
    if user.is_empty() || package.is_empty() {
        eprintln!("lodge-base-slice: --sandbox-exec 缺少 --user 或 --package");
        return 2;
    }
    match launch_bootstrap(&user, Path::new(&package)) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("lodge-base-slice: 沙箱命令没能启动：{error}");
            1
        }
    }
}

/// `--sandbox-child`：已经以专用账户在跑，起真正的命令（完整参数走这里）。
pub fn sandbox_child(args: &[String]) -> i32 {
    let package = flag_value(args, "--package").unwrap_or_default();
    if package.is_empty() {
        eprintln!("lodge-base-slice: --sandbox-child 缺少 --package");
        return 2;
    }
    match run_package(Path::new(&package)) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("lodge-base-slice: 沙箱里的命令没能启动：{error}");
            1
        }
    }
}

fn flag_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn launch_bootstrap(user: &str, package: &Path) -> Result<i32, String> {
    let password = read_secret()?;
    let password: Vec<u16> = password.encode_utf16().chain(std::iter::once(0)).collect();
    let user_wide: Vec<u16> = user.encode_utf16().chain(std::iter::once(0)).collect();
    let domain: Vec<u16> = ".".encode_utf16().chain(std::iter::once(0)).collect();
    let exe = std::env::current_exe().map_err(|error| format!("找不到基座自己：{error}"))?;
    let program_wide = wide_path(&exe);
    let bootstrap_args = ["--sandbox-child".to_string(), package.to_string_lossy().to_string()];
    let mut command_line: Vec<u16> = quote_command_line(&exe.to_string_lossy(), &bootstrap_args)
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let cwd = std::env::current_dir().map_err(|error| format!("读不到当前目录：{error}"))?;
    let cwd_wide = wide_path(&cwd);
    let environment = environment_block();

    let mut info: STARTUPINFOW = unsafe { std::mem::zeroed() };
    info.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    info.dwFlags = STARTF_USESTDHANDLES;
    // 三个句柄任何一个失败，都要把前面复制出来的关掉，不留给进程。
    info.hStdInput = inherit_handle(STD_INPUT_HANDLE)?;
    info.hStdOutput = match inherit_handle(STD_OUTPUT_HANDLE) {
        Ok(handle) => handle,
        Err(error) => {
            close_handle(info.hStdInput);
            return Err(error);
        }
    };
    info.hStdError = match inherit_handle(STD_ERROR_HANDLE) {
        Ok(handle) => handle,
        Err(error) => {
            close_handle(info.hStdInput);
            close_handle(info.hStdOutput);
            return Err(error);
        }
    };
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let created = unsafe {
        CreateProcessWithLogonW(
            user_wide.as_ptr(),
            domain.as_ptr(),
            password.as_ptr(),
            LOGON_WITH_PROFILE,
            program_wide.as_ptr(),
            command_line.as_mut_ptr(),
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | CREATE_SUSPENDED,
            environment.as_ptr() as *const std::ffi::c_void,
            cwd_wide.as_ptr(),
            &info,
            &mut process,
        )
    };
    close_handle(info.hStdInput);
    close_handle(info.hStdOutput);
    close_handle(info.hStdError);
    if created == 0 {
        let code = unsafe { GetLastError() };
        return Err(format!(
            "CreateProcessWithLogonW 失败（错误 {code}）；确认沙箱账户可以本地登录、Secondary Logon 服务在运行"
        ));
    }

    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        unsafe {
            TerminateProcess(process.hProcess, 1);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
        }
        return Err("CreateJobObjectW 失败".to_string());
    }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let assigned = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) != 0
            && AssignProcessToJobObject(job, process.hProcess) != 0
    };
    if !assigned {
        unsafe {
            TerminateProcess(process.hProcess, 1);
            CloseHandle(job);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
        }
        return Err("把沙箱进程放进 Job Object 失败；这一回合不跑".to_string());
    }
    unsafe {
        if ResumeThread(process.hThread) == u32::MAX {
            TerminateProcess(process.hProcess, 1);
            CloseHandle(job);
            CloseHandle(process.hThread);
            CloseHandle(process.hProcess);
            return Err("恢复沙箱进程失败；这一回合不跑".to_string());
        }
        WaitForSingleObject(process.hProcess, INFINITE);
        let mut exit: u32 = 1;
        let mut code = 1;
        if GetExitCodeProcess(process.hProcess, &mut exit) != 0 {
            code = exit as i32;
        }
        // 关闭 Job 句柄会带走整棵进程树（KILL_ON_JOB_CLOSE），不留孤儿。
        CloseHandle(job);
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
        Ok(code)
    }
}

fn run_package(path: &Path) -> Result<i32, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("读不到回合的参数包：{error}"))?;
    let package: Package =
        serde_json::from_slice(&bytes).map_err(|error| format!("参数包格式不对：{error}"))?;
    if package.program.is_empty() {
        return Err("参数包里没有要执行的程序".to_string());
    }
    let mut command_line: Vec<u16> = quote_command_line(&package.program, &package.args)
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    if command_line.len() > 32_767 {
        return Err("这一回合的命令行超过 32767 个字符；缩短参数再跑".to_string());
    }
    let cwd_wide = wide_path(Path::new(&package.cwd));
    let mut info: STARTUPINFOW = unsafe { std::mem::zeroed() };
    info.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    info.dwFlags = STARTF_USESTDHANDLES;
    info.hStdInput = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    info.hStdOutput = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    info.hStdError = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    let mut process: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let created = unsafe {
        CreateProcessW(
            std::ptr::null(),
            command_line.as_mut_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
            CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            std::ptr::null(),
            cwd_wide.as_ptr(),
            &info,
            &mut process,
        )
    };
    if created == 0 {
        return Err(format!(
            "CreateProcessW 失败（错误 {}）；确认引擎入口和它的目录对专用账户可读",
            unsafe { GetLastError() }
        ));
    }
    let mut code = 1;
    unsafe {
        WaitForSingleObject(process.hProcess, INFINITE);
        let mut exit: u32 = 1;
        if GetExitCodeProcess(process.hProcess, &mut exit) != 0 {
            code = exit as i32;
        }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    Ok(code)
}

/// 安装：建账户、存密码、装 WFP（连接只放行本机服务端口区间，其余出网与入站全拒）。
pub fn install() -> Result<String, String> {
    let user = super::win_plan::user_name();
    std::fs::create_dir_all(install_dir())
        .map_err(|error| format!("安装目录建不起来：{error}"))?;
    // 装了一半也要留痕：`state()` 看到 partial 就 fail closed，不裸跑。
    std::fs::write(partial_file(), b"installing\n")
        .map_err(|error| format!("安装标记写不出来：{error}"))?;
    let created_now = if account_exists(&user) {
        if !owned_file().is_file() {
            return Err(format!(
                "本机已经有账户 {user}，但它不是 Lodge 建的；不接管别人的账户。换一个名字（LODGE_SANDBOX_USER）再装。"
            ));
        }
        false
    } else {
        // 先记“这个账户是我们建的”，再建账户；中途失败时下一次仍能接着装。
        std::fs::write(owned_file(), b"lodge\n")
            .map_err(|error| format!("安装标记写不出来：{error}"))?;
        let password = format!("{}-{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
        run("net", &["user", &user, &password, "/add", "/expires:never", "/passwordchg:no"])?;
        write_secret(&password)?;
        true
    };
    if !secret_file().is_file() {
        return Err("沙箱账户的密码文件不在；先运行 --sandbox-uninstall，再重新安装。".to_string());
    }
    // 重装时先把自己上一轮的过滤清掉，避免同一子层叠加两套规则；
    // 清不掉就停在这里，不带着两套规则往下走。
    remove_filters().map_err(|error| format!("先清旧的网络过滤失败：{error}"))?;
    let sid = sid_string(&user)?;
    let mut rules = Vec::new();
    for v6 in [false, true] {
        for port in LOCAL_PORTS.0..=LOCAL_PORTS.1 {
            rules.push(Rule {
                layer: if v6 { Layer::ConnectV6 } else { Layer::ConnectV4 },
                action: Action::Permit,
                port: Some(port),
            });
        }
        rules.push(Rule {
            layer: if v6 { Layer::ConnectV6 } else { Layer::ConnectV4 },
            action: Action::Block,
            port: None,
        });
        rules.push(Rule {
            layer: if v6 { Layer::AcceptV6 } else { Layer::AcceptV4 },
            action: Action::Block,
            port: None,
        });
    }
    let ids = install_filters(&sid, &rules)?;
    let text = ids.iter().map(u64::to_string).collect::<Vec<_>>().join("\n");
    std::fs::write(filters_file(), text).map_err(|error| format!("过滤器记录写不出来：{error}"))?;
    let _ = std::fs::remove_file(partial_file());
    Ok(format!(
        "Windows 沙箱装好了：账户 {user}{}；本机回环只放行 {}-{}，入站不放行。\n验证：lodge-base-slice --sandbox-status",
        if created_now { "（新建）" } else { "（沿用）" },
        LOCAL_PORTS.0,
        LOCAL_PORTS.1
    ))
}

/// 卸载：先清过滤，再删标记和账户。过滤清不掉就停，避免“账户还在、网络规则没了”。
pub fn uninstall() -> Result<String, String> {
    let user = super::win_plan::user_name();
    let owned = owned_file().is_file();
    let removed = remove_filters().map_err(|error| format!("先清网络过滤失败：{error}"))?;
    // 标记先删：即使账户删不掉，下一次启动也知道边界已经不在，不再报 box=on。
    let _ = std::fs::remove_file(secret_file());
    let _ = std::fs::remove_file(filters_file());
    let _ = std::fs::remove_file(partial_file());
    let _ = std::fs::remove_file(owned_file());
    let mut notes = vec![format!("删掉 {removed} 条网络过滤")];
    if owned && account_exists(&user) {
        run("net", &["user", &user, "/delete"])?;
        notes.push(format!("删掉账户 {user}"));
    }
    let _ = std::fs::remove_dir_all(install_dir());
    Ok(notes.join("；"))
}

pub fn status() -> Result<String, String> {
    let user = super::win_plan::user_name();
    let account = account_exists(&user);
    let secret = secret_file().is_file();
    let partial = partial_file().is_file();
    // 状态命令通常以管理员运行；读不到 WFP 时如实说读不到，不假装在。
    let filters = if open_engine().is_ok() {
        if sublayer_present() { "在" } else { "不在" }
    } else {
        "读不到（这个命令需要管理员）"
    };
    Ok(format!(
        "账户：{user} {}\n密码文件：{}\n网络过滤：{filters}\n安装标记：{}\n规则：连接只放行本机回环端口 {}-{}，其余出网与入站一律拒绝",
        if account { "在" } else { "不在" },
        if secret { "在" } else { "不在" },
        if partial { "装了一半" } else { "完整" },
        LOCAL_PORTS.0,
        LOCAL_PORTS.1
    ))
}

// ---- 账户与密码 ----

fn account_exists(user: &str) -> bool {
    lookup_sid(user).is_ok()
}

fn lookup_sid(user: &str) -> Result<Vec<u8>, String> {
    let name = wide(user);
    let mut size = 0u32;
    let mut domain = 0u32;
    let mut kind: SID_NAME_USE = 0;
    unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            &mut domain,
            &mut kind,
        );
    }
    if size == 0 {
        return Err(format!("本机没有账户 {user}"));
    }
    let mut sid = vec![0u8; size as usize];
    let mut domain_buf = vec![0u16; domain.max(1) as usize];
    let found = unsafe {
        LookupAccountNameW(
            std::ptr::null(),
            name.as_ptr(),
            sid.as_mut_ptr() as *mut std::ffi::c_void,
            &mut size,
            domain_buf.as_mut_ptr(),
            &mut domain,
            &mut kind,
        )
    };
    if found == 0 {
        return Err(format!("查不到账户 {user} 的 SID（错误 {}）", unsafe { GetLastError() }));
    }
    sid.truncate(size as usize);
    Ok(sid)
}

fn sid_string(user: &str) -> Result<String, String> {
    let sid = lookup_sid(user)?;
    let mut text: windows_sys::core::PWSTR = std::ptr::null_mut();
    let ok = unsafe { ConvertSidToStringSidW(sid.as_ptr() as *mut std::ffi::c_void, &mut text) };
    if ok == 0 {
        return Err(format!("SID 转字符串失败（错误 {}）", unsafe { GetLastError() }));
    }
    let mut len = 0usize;
    unsafe {
        while *text.add(len) != 0 {
            len += 1;
        }
    }
    let value = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, len) });
    unsafe { LocalFree(text as *mut std::ffi::c_void) };
    Ok(value)
}

fn read_secret() -> Result<String, String> {
    let bytes = std::fs::read(secret_file()).map_err(|error| format!("读不到沙箱密码：{error}"))?;
    let plain = unprotect(&bytes)?;
    String::from_utf8(plain).map_err(|error| format!("沙箱密码格式不对：{error}"))
}

fn write_secret(password: &str) -> Result<(), String> {
    let blob = protect(password.as_bytes())?;
    std::fs::write(secret_file(), blob).map_err(|error| format!("沙箱密码写不出来：{error}"))
}

fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CryptProtectData(
            &input,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!("DPAPI 加密失败（错误 {}）", unsafe { GetLastError() }));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut std::ffi::c_void) };
    Ok(bytes)
}

fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output: CRYPT_INTEGER_BLOB = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!(
            "DPAPI 解密失败（错误 {}）；密码文件要由安装它的用户读取",
            unsafe { GetLastError() }
        ));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut std::ffi::c_void) };
    Ok(bytes)
}

fn run(program: &str, args: &[&str]) -> Result<(), String> {
    let output = StdCommand::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("{program} 起不来：{error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Err(format!("{program} 失败：{stderr} {stdout}").trim().to_string())
}

fn grant(path: &Path, user: &str, rights: &str) -> Result<(), String> {
    let value = format!("{user}:{rights}");
    run("icacls", &[path.to_string_lossy().as_ref(), "/grant", &value, "/C", "/Q"])
        .map_err(|error| format!("授权 {} 给 {user} 失败：{error}", path.display()))
}

// ---- WFP ----

fn install_filters(sid: &str, rules: &[Rule]) -> Result<Vec<u64>, String> {
    let engine = open_engine()?;
    let name = wide("Lodge sandbox");
    let sublayer = FWPM_SUBLAYER0 {
        subLayerKey: SUBLAYER,
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_ptr() as *mut u16,
            description: std::ptr::null_mut(),
        },
        flags: FWPM_SUBLAYER_FLAG_PERSISTENT,
        providerKey: std::ptr::null_mut(),
        providerData: unsafe { std::mem::zeroed() },
        weight: 0x100,
    };
    let code = unsafe { FwpmSubLayerAdd0(engine, &sublayer, std::ptr::null_mut()) };
    if code != ERROR_SUCCESS {
        unsafe { FwpmEngineClose0(engine) };
        return Err(format!("装 WFP 子层失败（错误 {code}）"));
    }
    let mut ids = Vec::new();
    for rule in rules {
        match add_filter(engine, sid, *rule) {
            Ok(id) => ids.push(id),
            Err(error) => {
                for id in &ids {
                    unsafe { FwpmFilterDeleteById0(engine, *id) };
                }
                unsafe {
                    FwpmSubLayerDeleteByKey0(engine, &SUBLAYER);
                    FwpmEngineClose0(engine);
                }
                return Err(error);
            }
        }
    }
    unsafe { FwpmEngineClose0(engine) };
    Ok(ids)
}

fn add_filter(engine: HANDLE, sid: &str, rule: Rule) -> Result<u64, String> {
    // ALE_USER_ID 的条件值是一个安全描述符（SDDL），不是裸 SID：
    // 把账户 SID 放进 DACL，让过滤引擎按“这个用户”匹配。
    let sddl = format!("O:SYG:SYD:(A;;CCRC;;;{sid})");
    let mut sddl: Vec<u16> = sddl.encode_utf16().chain(std::iter::once(0)).collect();
    let mut sd_blob = FWP_BYTE_BLOB {
        size: (sddl.len() * 2) as u32,
        data: sddl.as_mut_ptr() as *mut u8,
    };
    let sid_condition = FWPM_FILTER_CONDITION0 {
        fieldKey: FWPM_CONDITION_ALE_USER_ID,
        matchType: FWP_MATCH_EQUAL,
        conditionValue: FWP_CONDITION_VALUE0 {
            r#type: FWP_SECURITY_DESCRIPTOR_TYPE,
            Anonymous: windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWP_CONDITION_VALUE0_0 {
                sd: &mut sd_blob,
            },
        },
    };
    let mut conditions: Vec<FWPM_FILTER_CONDITION0> = vec![sid_condition];
    let loopback = matches!(rule.layer, Layer::ConnectV4 | Layer::ConnectV6);
    let mut v4 = FWP_V4_ADDR_AND_MASK { addr: 0x7F00_0001, mask: 0xFF00_0000 };
    let mut v6 = FWP_V6_ADDR_AND_MASK { addr: [0u8; 16], prefixLength: 128 };
    v6.addr[15] = 1;
    if let (Some(port), true) = (rule.port, loopback) {
        conditions.push(FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_IP_REMOTE_ADDRESS,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: if matches!(rule.layer, Layer::ConnectV6) {
                    FWP_V6_ADDR_MASK
                } else {
                    FWP_V4_ADDR_MASK
                },
                Anonymous: if matches!(rule.layer, Layer::ConnectV6) {
                    windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWP_CONDITION_VALUE0_0 {
                        v6AddrMask: &mut v6,
                    }
                } else {
                    windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWP_CONDITION_VALUE0_0 {
                        v4AddrMask: &mut v4,
                    }
                },
            },
        });
        conditions.push(FWPM_FILTER_CONDITION0 {
            fieldKey: FWPM_CONDITION_IP_REMOTE_PORT,
            matchType: FWP_MATCH_EQUAL,
            conditionValue: FWP_CONDITION_VALUE0 {
                r#type: FWP_UINT16,
                Anonymous: windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWP_CONDITION_VALUE0_0 {
                    uint16: port,
                },
            },
        });
    }
    let mut weight: u64 = if rule.action == Action::Permit { 0x100 } else { 0x1 };
    let mut name = wide(if rule.action == Action::Permit {
        "Lodge sandbox proxy"
    } else {
        "Lodge sandbox block"
    });
    let layer_key = match rule.layer {
        Layer::ConnectV4 => FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        Layer::ConnectV6 => FWPM_LAYER_ALE_AUTH_CONNECT_V6,
        Layer::AcceptV4 => FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
        Layer::AcceptV6 => FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    };
    // 放行必须是硬放行：不加 CLEAR_ACTION_RIGHT 的话，系统里的 block 仍能盖过它。
    let flags = FWPM_FILTER_FLAG_PERSISTENT
        | if rule.action == Action::Permit {
            FWPM_FILTER_FLAG_CLEAR_ACTION_RIGHT
        } else {
            0
        };
    let filter = FWPM_FILTER0 {
        filterKey: windows_sys::core::GUID::from_u128(uuid::Uuid::new_v4().as_u128()),
        displayData: FWPM_DISPLAY_DATA0 {
            name: name.as_mut_ptr(),
            description: std::ptr::null_mut(),
        },
        flags,
        providerKey: std::ptr::null_mut(),
        providerData: unsafe { std::mem::zeroed() },
        layerKey: layer_key,
        subLayerKey: SUBLAYER,
        weight: FWP_VALUE0 {
            r#type: FWP_UINT64,
            Anonymous: windows_sys::Win32::NetworkManagement::WindowsFilteringPlatform::FWP_VALUE0_0 {
                uint64: &mut weight,
            },
        },
        numFilterConditions: conditions.len() as u32,
        filterCondition: conditions.as_mut_ptr(),
        action: FWPM_ACTION0 {
            r#type: if rule.action == Action::Permit { FWP_ACTION_PERMIT } else { FWP_ACTION_BLOCK }
                as FWP_ACTION_TYPE,
            Anonymous: unsafe { std::mem::zeroed() },
        },
        Anonymous: unsafe { std::mem::zeroed() },
        reserved: std::ptr::null_mut(),
        filterId: 0,
        effectiveWeight: unsafe { std::mem::zeroed() },
    };
    let mut id = 0u64;
    let code = unsafe { FwpmFilterAdd0(engine, &filter, std::ptr::null_mut(), &mut id) };
    if code != ERROR_SUCCESS {
        return Err(format!("装 WFP 过滤失败（错误 {code}）"));
    }
    Ok(id)
}

fn remove_filters() -> Result<usize, String> {
    let engine = open_engine()?;
    let mut removed = 0usize;
    let ids: Vec<u64> = std::fs::read_to_string(filters_file())
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.trim().parse::<u64>().ok())
        .collect();
    for id in ids {
        let code = unsafe { FwpmFilterDeleteById0(engine, id) };
        if code == ERROR_SUCCESS || code == FWP_E_FILTER_NOT_FOUND {
            removed += 1;
        }
    }
    // 记录可能缺项（上一次装了一半）：再按子层枚举一遍，清掉所有还挂在上面的。
    removed += remove_filters_by_sublayer(engine)?;
    let code = unsafe { FwpmSubLayerDeleteByKey0(engine, &SUBLAYER) };
    if code != ERROR_SUCCESS && code != FWP_E_SUBLAYER_NOT_FOUND {
        unsafe { FwpmEngineClose0(engine) };
        return Err(format!("删 WFP 子层失败（错误 {code}）"));
    }
    unsafe { FwpmEngineClose0(engine) };
    Ok(removed)
}

/// 按四个连接层枚举，先收集属于本子层的 ID，再统一删（边枚举边删会让枚举失效）。
fn remove_filters_by_sublayer(engine: HANDLE) -> Result<usize, String> {
    let mut doomed: Vec<u64> = Vec::new();
    for layer in [
        FWPM_LAYER_ALE_AUTH_CONNECT_V4,
        FWPM_LAYER_ALE_AUTH_CONNECT_V6,
        FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4,
        FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V6,
    ] {
        let template = FWPM_FILTER_ENUM_TEMPLATE0 {
            providerKey: std::ptr::null_mut(),
            layerKey: layer,
            enumType: FWP_FILTER_ENUM_FULLY_CONTAINED,
            flags: 0,
            providerContextTemplate: std::ptr::null_mut(),
            numFilterConditions: 0,
            filterCondition: std::ptr::null_mut(),
            actionMask: u32::MAX,
            calloutKey: std::ptr::null_mut(),
        };
        let mut handle: HANDLE = std::ptr::null_mut();
        let code = unsafe { FwpmFilterCreateEnumHandle0(engine, &template, &mut handle) };
        if code != ERROR_SUCCESS {
            return Err(format!("枚举 WFP 过滤失败（错误 {code}）"));
        }
        loop {
            let mut entries: *mut *mut FWPM_FILTER0 = std::ptr::null_mut();
            let mut count = 0u32;
            let code = unsafe { FwpmFilterEnum0(engine, handle, 32, &mut entries, &mut count) };
            if code != ERROR_SUCCESS || count == 0 {
                if !entries.is_null() {
                    unsafe {
                        FwpmFreeMemory0(&mut entries as *mut _ as *mut *mut std::ffi::c_void)
                    };
                }
                break;
            }
            for index in 0..count as usize {
                let filter = unsafe { *entries.add(index) };
                if filter.is_null() {
                    continue;
                }
                if same_guid(unsafe { (*filter).subLayerKey }, SUBLAYER) {
                    doomed.push(unsafe { (*filter).filterId });
                }
            }
            unsafe {
                FwpmFreeMemory0(&mut entries as *mut _ as *mut *mut std::ffi::c_void)
            };
        }
        unsafe { FwpmFilterDestroyEnumHandle0(engine, handle) };
    }
    let mut removed = 0usize;
    for id in doomed {
        let code = unsafe { FwpmFilterDeleteById0(engine, id) };
        if code == ERROR_SUCCESS || code == FWP_E_FILTER_NOT_FOUND {
            removed += 1;
        }
    }
    Ok(removed)
}

fn sublayer_present() -> bool {
    let Ok(engine) = open_engine() else {
        return false;
    };
    let mut sublayer: *mut FWPM_SUBLAYER0 = std::ptr::null_mut();
    let code = unsafe { FwpmSubLayerGetByKey0(engine, &SUBLAYER, &mut sublayer) };
    if !sublayer.is_null() {
        unsafe {
            FwpmFreeMemory0(&mut sublayer as *mut _ as *mut *mut std::ffi::c_void)
        };
    }
    unsafe { FwpmEngineClose0(engine) };
    code == ERROR_SUCCESS
}

fn same_guid(left: windows_sys::core::GUID, right: windows_sys::core::GUID) -> bool {
    left.data1 == right.data1
        && left.data2 == right.data2
        && left.data3 == right.data3
        && left.data4 == right.data4
}

fn open_engine() -> Result<HANDLE, String> {
    const RPC_C_AUTHN_WINNT: u32 = 10;
    let mut engine: HANDLE = std::ptr::null_mut();
    let code = unsafe {
        FwpmEngineOpen0(
            std::ptr::null(),
            RPC_C_AUTHN_WINNT,
            std::ptr::null(),
            std::ptr::null(),
            &mut engine,
        )
    };
    if code != ERROR_SUCCESS {
        return Err(format!("打开 WFP 引擎失败（错误 {code}）；安装与查看需要管理员"));
    }
    Ok(engine)
}

// ---- 小工具 ----

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

fn close_handle(handle: HANDLE) {
    if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
        unsafe { CloseHandle(handle) };
    }
}

fn inherit_handle(kind: u32) -> Result<HANDLE, String> {
    let source = unsafe { GetStdHandle(kind) };
    if source == INVALID_HANDLE_VALUE || source.is_null() {
        return Err("沙箱命令没有标准输入输出可以继承".to_string());
    }
    let mut duplicate: HANDLE = std::ptr::null_mut();
    let current = unsafe { GetCurrentProcess() };
    let ok = unsafe {
        DuplicateHandle(current, source, current, &mut duplicate, 0, 1, DUPLICATE_SAME_ACCESS)
    };
    if ok == 0 {
        return Err(format!("复制标准句柄失败（错误 {}）", unsafe { GetLastError() }));
    }
    Ok(duplicate)
}

fn environment_block() -> Vec<u16> {
    let mut entries: Vec<String> = std::env::vars_os()
        .map(|(key, value)| format!("{}={}", key.to_string_lossy(), value.to_string_lossy()))
        .collect();
    // Windows 按名字排序查找环境变量；按大写排序，稳定且跨平台一致。
    entries.sort_by_key(|entry| entry.to_uppercase());
    let mut block = Vec::new();
    for entry in entries {
        block.extend(entry.encode_utf16());
        block.push(0);
    }
    block.push(0);
    block
}

fn quote_command_line(program: &str, args: &[String]) -> String {
    let mut line = quote(program);
    for arg in args {
        line.push(' ');
        line.push_str(&quote(arg));
    }
    line
}

fn quote(value: &str) -> String {
    if !value.is_empty() && !value.contains(|c: char| c == ' ' || c == '\t' || c == '"') {
        return value.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0;
    for c in value.chars() {
        match c {
            '\\' => {
                backslashes += 1;
                out.push('\\');
            }
            '"' => {
                out.push_str(&"\\".repeat(backslashes + 1));
                out.push('"');
                backslashes = 0;
            }
            other => {
                backslashes = 0;
                out.push(other);
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes));
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_argument_is_not_quoted() {
        assert_eq!(quote("pi"), "pi");
    }

    #[test]
    fn spaces_and_quotes_are_escaped() {
        assert_eq!(quote("a b"), "\"a b\"");
        assert_eq!(quote("a\"b"), "\"a\\\"b\"");
        assert_eq!(quote("a b\\"), "\"a b\\\\\"");
    }

    #[test]
    fn the_package_round_trips() {
        let package = Package {
            program: "pi".into(),
            args: vec!["--mode".into(), "rpc".into()],
            cwd: "C:\\work".into(),
        };
        let bytes = serde_json::to_vec(&package).unwrap();
        let back: Package = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back.program, "pi");
        assert_eq!(back.args, vec!["--mode", "rpc"]);
    }
}
