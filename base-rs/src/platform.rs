//! 平台接缝：只有这里知道 Unix 和 Windows 的差别。
//! 沙箱、驱动、发现和受限执行都从这里取路径、命令、进程和磁盘，不各写一套 cfg。

use std::path::{Path, PathBuf};

/// 用户目录：Unix 看 HOME，Windows 看 USERPROFILE（再退回 HOMEDRIVE+HOMEPATH）。
pub fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if let Some(home) = std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
            return Some(PathBuf::from(home));
        }
        let drive = std::env::var_os("HOMEDRIVE")?;
        let path = std::env::var_os("HOMEPATH")?;
        let mut home = PathBuf::from(drive);
        home.push(path);
        return Some(home);
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// PATH 之外的常见安装目录。只服务发现，不改 PATH。
pub fn fallback_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = home_dir() {
        #[cfg(windows)]
        {
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".bun").join("bin"));
            dirs.push(home.join(".cargo").join("bin"));
            if let Some(appdata) = std::env::var_os("APPDATA") {
                dirs.push(PathBuf::from(appdata).join("npm"));
            }
            if let Some(local) = std::env::var_os("LOCALAPPDATA") {
                dirs.push(PathBuf::from(local).join("Programs"));
            }
        }
        #[cfg(not(windows))]
        {
            dirs.push(home.join(".local/bin"));
            dirs.push(home.join(".npm-global/bin"));
            dirs.push(home.join(".bun/bin"));
            dirs.push(home.join(".cargo/bin"));
        }
    }
    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    dirs
}

/// 在一个目录里找命令。Windows 按 PATHEXT 补扩展名；Unix 要求可执行文件。
pub fn executable_in(dir: &Path, name: &str) -> Option<PathBuf> {
    if name.trim().is_empty() {
        return None;
    }
    #[cfg(windows)]
    {
        let has_extension = Path::new(name).extension().is_some();
        if has_extension {
            let candidate = dir.join(name);
            return candidate.is_file().then_some(candidate);
        }
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        for extension in pathext.split(';').map(str::trim).filter(|value| !value.is_empty()) {
            let candidate = dir.join(format!("{name}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        return None;
    }
    #[cfg(not(windows))]
    {
        let candidate = dir.join(name);
        let ok = std::fs::metadata(&candidate)
            .map(|meta| meta.is_file() && {
                use std::os::unix::fs::PermissionsExt;
                meta.permissions().mode() & 0o111 != 0
            })
            .unwrap_or(false);
        ok.then_some(candidate)
    }
}

/// 可执行入口。Windows 的 .cmd/.bat 必须经 cmd 启动；pi 通常是 .exe，直接起。
pub fn command_for(binary: &Path) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let extension = binary
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if extension == "cmd" || extension == "bat" {
            let mut command = tokio::process::Command::new("cmd");
            command.args(["/d", "/s", "/c"]).arg(binary);
            return command;
        }
    }
    tokio::process::Command::new(binary)
}

/// 把 `LODGE_WORK_ROOTS` 拆成根：Windows 用 `;`，Unix 用 `:`；两边都接受逗号。
pub fn split_roots(value: &str) -> Vec<PathBuf> {
    value
        .split(',')
        .flat_map(|part| std::env::split_paths(part.trim()))
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .collect()
}

/// 工作目录是否在根下。Windows 路径大小写不敏感。
pub fn path_under(path: &Path, root: &Path) -> bool {
    let path = path.to_string_lossy().to_lowercase();
    let root = root.to_string_lossy().to_lowercase();
    if path == root {
        return true;
    }
    let separator = std::path::MAIN_SEPARATOR;
    path.starts_with(&format!("{root}{separator}"))
}

/// 磁盘余量：Unix 用 statvfs，Windows 用 GetDiskFreeSpaceExW。
pub fn free_bytes(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
        if unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) } != 0 {
            return None;
        }
        Some((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let mut free = 0u64;
        let mut total = 0u64;
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut free, &mut total, std::ptr::null_mut())
        };
        (ok != 0).then_some(free)
    }
}

/// 这一回合的执行 shell：Unix 是 /bin/sh，Windows 是 cmd。
pub fn shell_command(script: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let mut command = tokio::process::Command::new("cmd");
        command.args(["/d", "/s", "/c", script]);
        hide_window(&mut command);
        command
    }
    #[cfg(not(windows))]
    {
        let mut command = tokio::process::Command::new("/bin/sh");
        command.args(["-c", script]);
        command
    }
}

/// Windows 上不弹控制台窗口；其他平台是空操作。
pub fn hide_window(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

/// 没有 Job Object 时的兜底：按进程树停掉。Unix 继续用进程组。
#[cfg(windows)]
pub fn terminate_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

/// 一回合的进程树边界：Windows 用 Job Object，句柄关闭即杀掉整棵树。
/// Unix 继续用进程组，这里是空壳，调用方按 cfg 走原有实现。
#[cfg(windows)]
pub struct Job {
    handle: windows_sys::Win32::Foundation::HANDLE,
}

// 内核句柄本身是线程安全的；Job 的创建/计数/终止都走系统调用。
#[cfg(windows)]
unsafe impl Send for Job {}
#[cfg(windows)]
unsafe impl Sync for Job {}

#[cfg(windows)]
impl Job {
    pub fn create(active_process_limit: u32) -> Result<Self, String> {
        use windows_sys::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err("CreateJobObjectW 失败".to_string());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            info.BasicLimitInformation.ActiveProcessLimit = active_process_limit.max(1);
            let ok = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                use windows_sys::Win32::Foundation::CloseHandle;
                CloseHandle(handle);
                return Err("SetInformationJobObject 失败".to_string());
            }
            Ok(Self { handle })
        }
    }

    /// 把已经启动的子进程放进 Job。失败时调用方仍可运行，但只能靠 taskkill 兜底。
    pub fn assign(&self, pid: u32) -> Result<(), String> {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };
        unsafe {
            let process = OpenProcess(
                PROCESS_SET_QUOTA | PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                pid,
            );
            if process.is_null() {
                return Err("OpenProcess 失败".to_string());
            }
            let ok = AssignProcessToJobObject(self.handle, process);
            CloseHandle(process);
            if ok == 0 {
                return Err("AssignProcessToJobObject 失败".to_string());
            }
        }
        Ok(())
    }

    pub fn kill(&self) {
        use windows_sys::Win32::System::JobObjects::TerminateJobObject;
        unsafe {
            TerminateJobObject(self.handle, 1);
        }
    }

    pub fn active_processes(&self) -> usize {
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicAccountingInformation, QueryInformationJobObject,
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
        };
        let mut info: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = unsafe { std::mem::zeroed() };
        let ok = unsafe {
            QueryInformationJobObject(
                self.handle,
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                std::ptr::null_mut(),
            )
        };
        if ok == 0 { 0 } else { info.ActiveProcesses as usize }
    }
}

#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::CloseHandle;
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_split_on_the_platform_separator_and_commas() {
        let value = if cfg!(windows) { r"C:\one;C:\two, C:\three" } else { "/one:/two, /three" };
        let roots = split_roots(value);
        assert_eq!(roots.len(), 3);
    }

    #[test]
    fn a_child_path_is_under_its_root() {
        let root = std::env::temp_dir().join("lodge-platform-root");
        assert!(path_under(&root.join("work"), &root));
        assert!(!path_under(&root.with_extension("other"), &root));
    }
}
