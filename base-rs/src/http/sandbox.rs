//! 受限执行：agent 写的命令（证明、反例）在同一个沙箱里跑。
//! 入口是窄的：work 必须在声明过的根下、整轮不出网、超时杀进程组、输出原样带回。

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;

use super::{fail, ApiError};
use crate::sandbox::{self, Network, TurnInputs, TurnSandbox};
use crate::state::App;

#[derive(Deserialize)]
pub struct RunRequest {
    pub work: String,
    pub command: String,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_processes: Option<u32>,
}

/// 可执行的工作根由启动方声明；没声明就不执行，不猜。
fn declared_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = crate::platform::split_roots(
        &std::env::var("LODGE_WORK_ROOTS").unwrap_or_default(),
    )
    .iter()
    .filter_map(|path| std::fs::canonicalize(path).ok())
    .collect();
    // 证明在一次性副本里跑，副本在系统临时目录下；那份根由平台自己给出。
    if let Ok(temp) = std::fs::canonicalize(std::env::temp_dir()) {
        roots.push(temp);
    }
    // 工作副本默认在产品的 workspace 根下；显式环境变量优先，其次与 Lodge 同一条默认。
    if let Ok(root) = std::env::var("CREW_WORKSPACE_ROOT") {
        if let Ok(real) = std::fs::canonicalize(root) {
            roots.push(real);
        }
    }
    if let Some(home) = crate::platform::home_dir() {
        let workspace = home.join("CrewWorkspaces");
        if workspace.is_dir() {
            if let Ok(real) = std::fs::canonicalize(workspace) {
                roots.push(real);
            }
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

pub async fn run(
    State(app): State<Arc<App>>,
    Json(body): Json<RunRequest>,
) -> Result<Json<Value>, ApiError> {
    if body.command.trim().is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "命令不能为空"));
    }
    let roots = declared_roots();
    if roots.is_empty() {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "没有声明可执行的工作根；先设 LODGE_WORK_ROOTS",
        ));
    }
    let work = std::fs::canonicalize(&body.work)
        .map_err(|_| fail(StatusCode::BAD_REQUEST, "工作目录不存在"))?;
    if !work.is_dir() {
        return Err(fail(StatusCode::BAD_REQUEST, "工作目录不是一个目录"));
    }
    if !roots.iter().any(|root| crate::platform::path_under(&work, root)) {
        return Err(fail(StatusCode::FORBIDDEN, "工作目录不在声明范围内"));
    }
    let timeout = Duration::from_millis(body.timeout_ms.unwrap_or(120_000).clamp(1_000, 600_000));

    let other_worktrees = app
        .store
        .bots()
        .map_err(|error| fail(StatusCode::INTERNAL_SERVER_ERROR, &format!("读成员目录失败：{error}")))?
        .iter()
        .filter_map(|bot| {
            bot.get("settings")
                .and_then(|settings| settings.get("cwd"))
                .and_then(Value::as_str)
                .filter(|path| !path.is_empty())
                .map(str::to_string)
        })
        .collect();
    let boundary = TurnSandbox::plan(TurnInputs {
        turn_id: uuid::Uuid::new_v4().to_string(),
        work: work.display().to_string(),
        other_worktrees,
        base_dir: app.store.dir().display().to_string(),
        home: crate::platform::home_dir(),
        network: Network::None,
        file_bytes: None,
        processes: body.max_processes,
        strict: false,
        engine_binary: None,
        local_ports: Vec::new(),
    })
    .map_err(|reason| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("沙箱建立不起来：{reason}"),
        )
    })?;

    if let Some(free) = crate::sandbox::low_disk(boundary.work()) {
        return Err(fail(
            StatusCode::INSUFFICIENT_STORAGE,
            &format!("磁盘余量不足（只剩 {} MB）", free / (1024 * 1024)),
        ));
    }

    let mut command = crate::platform::shell_command(&body.command);
    command
        .current_dir(&work)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::platform::hide_window(&mut command);
    sandbox::scrub_env(&mut command);
    command.env("CI", "1").env("LODGE_PROOF", "1");
    let mut command = boundary.apply(command).map_err(|reason| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("这一条命令需要沙箱，但{reason}"),
        )
    })?;

    let started = Instant::now();
    let mut child = command
        .spawn()
        .map_err(|error| fail(StatusCode::INTERNAL_SERVER_ERROR, &format!("命令启动失败：{error}")))?;
    let pid = child.id().unwrap_or(0);
    // 进程数看门人：只数这一组；超限整组停掉。Windows 用 Job Object 计数和收树。
    let over_processes = Arc::new(AtomicBool::new(false));
    let finished = Arc::new(AtomicBool::new(false));
    #[cfg(windows)]
    let job = Arc::new(match crate::platform::Job::create(boundary.processes()) {
        Ok(job) => Some(job),
        Err(error) => {
            eprintln!("lodge-base-slice: 受限执行没有 Job（{error}）；只能按进程树兜底");
            None
        }
    });
    if pid > 0 {
        #[cfg(windows)]
        if let Some(job) = job.as_ref().as_ref() {
            if let Err(error) = job.assign(pid) {
                eprintln!("lodge-base-slice: 受限执行没有进 Job（{error}）；只能按进程树兜底");
            }
        }
        let over = over_processes.clone();
        let finished = finished.clone();
        let limit = boundary.processes() as usize;
        #[cfg(windows)]
        let job_for_watch = job.clone();
        tokio::spawn(async move {
            // 连续几拍数不出来才停：进程表最满的时候连 `ps` 都 fork 不出来；
            // 偶发一次读不到不该杀掉正常命令，一直读不到就是已经满了。
            let mut unreadable = 0u32;
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if finished.load(Ordering::Relaxed) {
                    break;
                }
                #[cfg(unix)]
                let too_many = match crate::sandbox::descendant_count(pid) {
                    Some(count) => {
                        unreadable = 0;
                        count > limit
                    }
                    None => {
                        unreadable += 1;
                        unreadable >= 2
                    }
                };
                #[cfg(windows)]
                let too_many = job_for_watch
                    .as_ref()
                    .as_ref()
                    .map(|job| job.active_processes() > limit)
                    .unwrap_or(false);
                if too_many {
                    over.store(true, Ordering::Relaxed);
                    #[cfg(unix)]
                    crate::sandbox::kill_tree(pid);
                    #[cfg(windows)]
                    if let Some(job) = job_for_watch.as_ref().as_ref() {
                        job.kill();
                    }
                    // 不停手：杀了再来一轮，漏掉的（刚 fork 出来的）下一拍继续收。
                    continue;
                }
            }
        });
    }
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(stream) = stdout.as_mut() {
            let _ = stream.read_to_end(&mut buffer).await;
        }
        buffer
    });
    let err_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(stream) = stderr.as_mut() {
            let _ = stream.read_to_end(&mut buffer).await;
        }
        buffer
    });
    // 超时连整个进程组一起杀：只杀 shell 会留下它拉起的子进程。
    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => Some(status),
        _ => {
            if pid > 0 {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
                #[cfg(windows)]
                if let Some(job) = job.as_ref().as_ref() {
                    job.kill();
                }
            }
            let _ = child.wait().await;
            None
        }
    };
    finished.store(true, Ordering::Relaxed);
    let stdout = out_task.await.unwrap_or_default();
    let stderr = err_task.await.unwrap_or_default();
    let killed = if over_processes.load(Ordering::Relaxed) {
        Some("processes")
    } else {
        None
    };
    Ok(Json(json!({
        "code": status.and_then(|status| status.code()),
        "timedOut": status.is_none(),
        "killed": killed,
        "stdout": String::from_utf8_lossy(&stdout).to_string(),
        "stderr": String::from_utf8_lossy(&stderr).to_string(),
        "durationMs": started.elapsed().as_millis(),
    })))
}
