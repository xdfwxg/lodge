//! Lodge 的薄基座：只实现 docs/architecture.md「基座切片」里的端点。
//! 组合根在这里装配 store、事件总线、回合注册表和发现器；业务在模块里。
//!
//! 还有一个 `--supervise` 模式：驱动进程外面套一层看门人，基座被 SIGKILL 时
//! 它会被过继给 launchd，发现父进程没了就杀掉整组子进程，不留孤儿。

mod discovery;
mod drivers;
mod events;
mod http;
mod model;
mod service;
mod state;
mod store;
mod turns;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::state::App;
use crate::store::Store;

static SUPERVISE_STOP: AtomicBool = AtomicBool::new(false);

extern "C" fn supervise_signal(_: libc::c_int) {
    SUPERVISE_STOP.store(true, Ordering::SeqCst);
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn default_db() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lodge/base.db")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--supervise") {
        supervise(&args[2..]);
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
    let app = App::new(store, fake);
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

    // 正常退出（Ctrl-C / SIGTERM）清掉所有驱动进程组；SIGKILL 由看门人兜底。
    let shutdown_app = Arc::clone(&app);
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

    if let Err(error) = axum::serve(listener, router).await {
        eprintln!("lodge-base-slice: 服务退出: {error}");
    }
}

/// 看门人：子进程和自己在同一进程组；父进程没了（被过继）或被要求停止时，先 TERM 再 KILL 整组。
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
