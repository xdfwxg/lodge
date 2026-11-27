//! Lodge 的薄基座：只实现 docs/architecture.md「基座切片」里的端点。
//! 组合根在这里装配 store、事件总线、回合注册表和发现器；业务在模块里。
//!
//! 还有一个 `--supervise` 模式：驱动进程外面套一层看门人，基座被 SIGKILL 时
//! 它会被过继给 launchd，发现父进程没了就杀掉整组子进程，不留孤儿。

mod discovery;
mod drivers;
mod egress;
mod events;
mod http;
mod mcp_gate;
mod model;
mod platform;
mod sandbox;
mod selfcheck;
mod service;
mod state;
mod store;
mod turns;

use std::path::PathBuf;
#[cfg(unix)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::state::App;
use crate::store::Store;

#[cfg(unix)]
static SUPERVISE_STOP: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
extern "C" fn supervise_signal(_: libc::c_int) {
    SUPERVISE_STOP.store(true, Ordering::SeqCst);
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

#[cfg(windows)]
fn sandbox_exit(result: Result<String, String>) -> ! {
    match result {
        Ok(message) => {
            println!("{message}");
            std::process::exit(0);
        }
        Err(error) => {
            eprintln!("lodge-base-slice: {error}");
            std::process::exit(1);
        }
    }
}

fn default_db() -> PathBuf {
    platform::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lodge/base.db")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // MCP 网关是基座的第二种身份：由引擎按服务器拉起，只转发一个 stdio 服务器。
    // 它不碰 HTTP、不开存储，也不进 tokio 运行时。
    if args.get(1).map(String::as_str) == Some("--mcp-gate") {
        std::process::exit(mcp_gate::run());
    }
    #[cfg(unix)]
    if args.get(1).map(String::as_str) == Some("--supervise") {
        supervise(&args[2..]);
    }
    // 看门人是 Unix 的进程组兜底；Windows 用 Job Object，句柄关闭就杀掉整棵树。
    #[cfg(windows)]
    if args.get(1).map(String::as_str) == Some("--supervise") {
        eprintln!("lodge-base-slice: Windows 不用 --supervise；回合由 Job Object 兜底");
        std::process::exit(2);
    }
    // 沙箱管理命令和沙箱启动助手都不需要 HTTP 服务，也不进 tokio 运行时。
    #[cfg(windows)]
    if let Some(command) = args.get(1).map(String::as_str) {
        match command {
            "--sandbox-install" => sandbox_exit(sandbox::windows::install()),
            "--sandbox-uninstall" => sandbox_exit(sandbox::windows::uninstall()),
            "--sandbox-status" => sandbox_exit(sandbox::windows::status()),
            "--sandbox-exec" => std::process::exit(sandbox::windows::exec_helper(&args[2..])),
            "--sandbox-child" => std::process::exit(sandbox::windows::sandbox_child(&args[2..])),
            _ => {}
        }
    }
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("lodge-base-slice: 运行时启动失败: {error}");
            std::process::exit(1);
        }
    };
    runtime.block_on(server(args));
}

async fn server(args: Vec<String>) {
    let port = arg_value(&args, "--port")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8798);
    let db = arg_value(&args, "--db")
        .map(PathBuf::from)
        .unwrap_or_else(default_db);
    let fake = args.iter().any(|arg| arg == "--fake");

    let store = match Store::open(&db) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("lodge-base-slice: 打开数据库失败 {}: {error}", db.display());
            std::process::exit(1);
        }
    };
    // 出口代理：白名单之外一律拒绝。要沙箱却起不来时同样 fail closed。
    let egress_mode = std::env::var("LODGE_EGRESS").unwrap_or_else(|_| "proxy".to_string());
    // Windows 沙箱的 WFP 只放行固定端口区间，所以 Windows 上代理默认绑 8899/8898；
    // 其他平台交给系统分配。改端口时安装态也要跟着改，否则回合会拒绝开跑。
    let default_proxy_port = if cfg!(windows) { sandbox::win_plan::PROXY_PORTS.1 } else { 0 };
    let default_model_port = if cfg!(windows) { sandbox::win_plan::PROXY_PORTS.0 } else { 0 };
    let proxy_port = std::env::var("LODGE_EGRESS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(default_proxy_port);
    let model_port = std::env::var("LODGE_MODEL_EGRESS_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(default_model_port);
    let (egress, egress_model) = if egress_mode == "off" {
        (None, None)
    } else {
        let proxy = match egress::start_at(egress::allowlist(), proxy_port).await {
            Ok(proxy) => proxy,
            Err(error) => {
                eprintln!("lodge-base-slice: 出口代理起不来，拒绝启动: {error}");
                std::process::exit(1);
            }
        };
        eprintln!(
            "lodge-base-slice: egress 代理 127.0.0.1:{} 主机 {:?} 本地端口 {:?}",
            proxy.port,
            proxy.hosts,
            proxy.local_ports
        );
        // 只连模型的房间走第二个代理：只放行模型厂商，额外网站一律不认。
        let model = match egress::start_at(egress::provider_allowlist(), model_port).await {
            Ok(proxy) => proxy,
            Err(error) => {
                eprintln!("lodge-base-slice: 模型出口代理起不来，拒绝启动: {error}");
                std::process::exit(1);
            }
        };
        eprintln!(
            "lodge-base-slice: egress 模型代理 127.0.0.1:{} 主机 {:?}",
            model.port,
            model.hosts
        );
        (Some(proxy), Some(model))
    };
    let self_check = selfcheck::run(fake).await;
    let app = App::new(store, fake, egress, egress_model, self_check);
    let router = http::router(Arc::clone(&app));
    let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("lodge-base-slice: 端口 {port} 绑定失败: {error}");
            std::process::exit(1);
        }
    };
    println!(
        "lodge-base-slice on http://127.0.0.1:{port} db={} fake={fake}",
        db.display()
    );

    // 正常退出清掉所有驱动；Unix 收 SIGTERM/SIGINT，Windows 收 Ctrl-C/关闭事件。
    let shutdown_app = Arc::clone(&app);
    #[cfg(unix)]
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut term = signal(SignalKind::terminate()).ok();
        let mut int = signal(SignalKind::interrupt()).ok();
        match (&mut term, &mut int) {
            (Some(term), Some(int)) => {
                tokio::select! {
                    _ = term.recv() => {}
                    _ = int.recv() => {}
                }
            }
            (Some(term), None) => {
                term.recv().await;
            }
            (None, Some(int)) => {
                int.recv().await;
            }
            (None, None) => return,
        }
        shutdown_app.turns.cancel_all();
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        std::process::exit(0);
    });
    #[cfg(windows)]
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        shutdown_app.turns.cancel_all();
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        std::process::exit(0);
    });

    if let Err(error) = axum::serve(listener, router).await {
        eprintln!("lodge-base-slice: 服务退出: {error}");
    }
}

/// 看门人：子进程和自己在同一进程组；父进程没了（被过继）或被要求停止时，先 TERM 再 KILL 整组。
#[cfg(unix)]
fn supervise(argv: &[String]) -> ! {
    if argv.is_empty() {
        eprintln!("lodge-base-slice --supervise 需要一个命令");
        std::process::exit(2);
    }
    let parent = unsafe { libc::getppid() };
    let handler = supervise_signal as extern "C" fn(libc::c_int);
    unsafe {
        libc::signal(libc::SIGTERM, handler as libc::sighandler_t);
        libc::signal(libc::SIGINT, handler as libc::sighandler_t);
    }
    let mut child = match std::process::Command::new(&argv[0])
        .args(&argv[1..])
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            eprintln!("lodge-base-slice: 看门人启动失败 {}: {error}", argv[0]);
            std::process::exit(2);
        }
    };
    let group = unsafe { libc::getpid() };
    let stop = |child: &mut std::process::Child| {
        unsafe {
            libc::kill(-group, libc::SIGTERM);
        }
        std::thread::sleep(std::time::Duration::from_millis(1200));
        if child.try_wait().ok().flatten().is_none() {
            unsafe {
                libc::kill(-group, libc::SIGKILL);
            }
        }
    };
    loop {
        if SUPERVISE_STOP.load(Ordering::SeqCst) || unsafe { libc::getppid() } != parent {
            stop(&mut child);
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let code = status.code().unwrap_or(0);
                unsafe {
                    libc::kill(-group, libc::SIGTERM);
                }
                std::process::exit(code);
            }
            Ok(None) => {}
            Err(_) => break,
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    let code = child.wait().ok().and_then(|status| status.code()).unwrap_or(0);
    std::process::exit(code);
}
