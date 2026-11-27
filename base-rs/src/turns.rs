//! 回合状态机：一次只有一个终态；digest 与 turn.completed 都是它的投影。
//! 取消按线程隔离；卡只属于产生它的回合。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::json;
use tokio::sync::oneshot;

use crate::events::{group_frame, message_frame, runtime_frame, EventBus};
use crate::model::{TurnOutcome, TurnUsage};
use crate::store::{now, Store};

pub struct CancelToken {
    cancelled: AtomicBool,
    pid: Mutex<Option<u32>>,
    notify: tokio::sync::Notify,
}

impl CancelToken {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            cancelled: AtomicBool::new(false),
            pid: Mutex::new(None),
            notify: tokio::sync::Notify::new(),
        })
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    pub fn set_pid(&self, pid: u32) {
        if let Ok(mut slot) = self.pid.lock() {
            *slot = Some(pid);
        }
        if self.is_cancelled() {
            self.kill();
        }
    }

    /// 先 TERM 整个进程组，再 KILL；驱动子进程不留孤儿。
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
        self.kill();
    }

    /// 回合正常收尾：只 TERM 进程组，让看门人把驱动带走；不标记取消。
    pub fn stop(&self) {
        let pid = self.pid.lock().ok().and_then(|slot| *slot);
        if let Some(pid) = pid {
            stop_tree(pid);
        }
    }

    pub async fn wait_cancelled(&self) {
        if self.is_cancelled() {
            return;
        }
        self.notify.notified().await;
    }

    fn kill(&self) {
        let pid = self.pid.lock().ok().and_then(|slot| *slot);
        if let Some(pid) = pid {
            stop_tree(pid);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                kill_tree(pid);
            });
        }
    }
}

#[cfg(unix)]
fn stop_tree(pid: u32) {
    crate::sandbox::signal_tree(pid, libc::SIGTERM);
}

#[cfg(unix)]
fn kill_tree(pid: u32) {
    crate::sandbox::signal_tree(pid, libc::SIGKILL);
}

#[cfg(windows)]
fn stop_tree(pid: u32) {
    // Windows 没有进程组信号；直接按进程树收掉，Job Object 会在句柄关闭时兜底。
    crate::platform::terminate_tree(pid);
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    crate::platform::terminate_tree(pid);
}


#[derive(Clone)]
pub struct TurnHandle {
    pub thread_id: String,
    pub bot_id: String,
    pub turn_id: String,
    pub cancel: Arc<CancelToken>,
}

#[derive(Clone, Debug)]
pub struct Decision {
    pub behavior: String,
    pub message: Option<String>,
}

#[derive(Default)]
pub struct TurnRegistry {
    turns: Mutex<HashMap<String, TurnHandle>>,
    waiters: Mutex<HashMap<String, oneshot::Sender<Decision>>>,
}

impl TurnRegistry {
    /// 检查与占用在同一把锁里完成：两个并发消息不会各起一个回合。
    pub fn try_register(&self, thread_id: &str, handle: TurnHandle) -> bool {
        let Ok(mut turns) = self.turns.lock() else { return false };
        if turns.contains_key(thread_id) {
            return false;
        }
        turns.insert(thread_id.to_string(), handle);
        true
    }

    #[cfg(test)]
    pub fn is_running(&self, thread_id: &str) -> bool {
        self.turns.lock().map(|turns| turns.contains_key(thread_id)).unwrap_or(false)
    }

    pub fn cancel(&self, thread_id: &str) -> Option<TurnHandle> {
        let handle = self.turns.lock().ok()?.remove(thread_id)?;
        handle.cancel.cancel();
        Some(handle)
    }

    /// 退出时清掉所有驱动进程组；SIGKILL 无法捕获，重启恢复会补终态。
    pub fn cancel_all(&self) {
        let handles: Vec<TurnHandle> = self
            .turns
            .lock()
            .map(|mut turns| turns.drain().map(|(_, handle)| handle).collect())
            .unwrap_or_default();
        for handle in handles {
            handle.cancel.cancel();
        }
    }

    pub fn cancel_bot(&self, bot_id: &str) -> Option<TurnHandle> {
        let thread = {
            let turns = self.turns.lock().ok()?;
            turns
                .iter()
                .find(|(_, handle)| handle.bot_id == bot_id)
                .map(|(thread, _)| thread.clone())?
        };
        self.cancel(&thread)
    }

    /// 只有当前回合能声明终态；第二次调用返回 false。
    pub fn claim(&self, thread_id: &str, turn_id: &str) -> bool {
        let Ok(mut turns) = self.turns.lock() else { return false };
        match turns.get(thread_id) {
            Some(handle) if handle.turn_id == turn_id => {
                turns.remove(thread_id);
                true
            }
            _ => false,
        }
    }

    pub fn register_card(&self, request_id: &str, waiter: oneshot::Sender<Decision>) {
        if let Ok(mut waiters) = self.waiters.lock() {
            waiters.insert(request_id.to_string(), waiter);
        }
    }

    pub fn answer(&self, request_id: &str, decision: Decision) -> bool {
        let waiter = self.waiters.lock().ok().and_then(|mut waiters| waiters.remove(request_id));
        match waiter {
            Some(waiter) => waiter.send(decision).is_ok(),
            None => false,
        }
    }

    pub fn drop_card(&self, request_id: &str) {
        if let Ok(mut waiters) = self.waiters.lock() {
            waiters.remove(request_id);
        }
    }
}

/// 落终态：先 claim，再写消息与 digest；调用两次只有一次生效。
pub fn settle(
    registry: &TurnRegistry,
    store: &Store,
    events: &EventBus,
    thread_id: &str,
    bot_id: &str,
    turn_id: &str,
    outcome: TurnOutcome,
    text: &str,
    usage: &TurnUsage,
) {
    if !registry.claim(thread_id, turn_id) {
        return;
    }
    finish(store, events, thread_id, bot_id, turn_id, outcome, text, usage);
}

/// 中断/恢复时回合句柄已经被移除，直接落终态；驱动自己的 settle 会被 claim 挡住。
pub fn settle_forced(
    store: &Store,
    events: &EventBus,
    thread_id: &str,
    bot_id: &str,
    turn_id: &str,
    outcome: TurnOutcome,
    text: &str,
    usage: &TurnUsage,
) {
    finish(store, events, thread_id, bot_id, turn_id, outcome, text, usage);
}

fn finish(
    store: &Store,
    events: &EventBus,
    thread_id: &str,
    bot_id: &str,
    turn_id: &str,
    outcome: TurnOutcome,
    text: &str,
    usage: &TurnUsage,
) {
    let at = now();
    // 耗时从回合账本的起点算起；读不到起点才记 0（例如恢复时行已不在），不猜。
    let duration_ms = store
        .turn_started_at(thread_id, turn_id)
        .ok()
        .flatten()
        .map(|started| (at - started).max(0))
        .unwrap_or(0);
    let body = match outcome {
        TurnOutcome::Completed => json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "at": at,
            "role": "agent",
            "kind": "text",
            "text": text,
            "turnId": turn_id,
            "turnTerminal": true,
            "from": { "botId": bot_id },
        }),
        TurnOutcome::Stopped => json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "at": at,
            "role": "agent",
            "kind": "stopped",
            "text": if text.is_empty() { "已停下" } else { text },
            "turnId": turn_id,
            "from": { "botId": bot_id },
        }),
        TurnOutcome::Failed | TurnOutcome::Expired => json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "at": at,
            "role": "agent",
            "kind": "notice",
            "text": text,
            "turnId": turn_id,
            "from": { "botId": bot_id },
        }),
    };
    events.emit(message_frame(thread_id, body));
    events.emit(message_frame(
        thread_id,
        json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "at": at,
            "role": "agent",
            "kind": "digest",
            "digest": {
                "botId": bot_id,
                "turnId": turn_id,
                "at": at,
                "durationMs": duration_ms,
                "reply": text,
                // 终态投影：房间靠它区分“做完”和“被停下 / 失败”，不再只看有没有文字。
                "stopReason": outcome.as_str(),
                "toolCalls": usage.tool_calls,
                "usage": {
                    "input": usage.input,
                    "output": usage.output,
                    "cacheRead": usage.cache_read,
                },
            }
        }),
    ));
    events.emit(runtime_frame(
        thread_id,
        json!({
            "threadId": thread_id,
            "botId": bot_id,
            "turnId": turn_id,
            "type": "turn.completed",
            "ok": outcome == TurnOutcome::Completed,
            "stopReason": outcome.as_str(),
        }),
    ));
    log_store("记录用量", store.record_usage(turn_id, thread_id, bot_id, usage));
    log_store("结束回合", store.end_turn(thread_id, turn_id, outcome.as_str()));
    log_store("清理审批卡", store.delete_cards_for_turn(turn_id));
    clear_group_busy(store, events, thread_id, turn_id);
}

fn clear_group_busy(store: &Store, events: &EventBus, thread_id: &str, turn_id: &str) {
    // 群的 busy 状态也是基座执行事实；只清自己这一次回合留下的标记。
    match store.group_by_thread(thread_id) {
        Ok(Some(mut group)) => {
            if group.get("busyTurnId").and_then(serde_json::Value::as_str) == Some(turn_id) {
                group["working"] = json!(false);
                group["busyBotId"] = json!(null);
                group["busyTurnId"] = json!(null);
                if let Err(error) = store.upsert_group(&group) {
                    eprintln!("lodge-base-slice: 清理群状态失败: {error}");
                }
                events.emit(group_frame(group));
            }
        }
        Ok(None) => {}
        Err(error) => eprintln!("lodge-base-slice: 读群状态失败: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_turn_can_only_claim_one_terminal_state() {
        let registry = TurnRegistry::default();
        assert!(registry.try_register(
            "t1",
            TurnHandle {
                thread_id: "t1".into(),
                bot_id: "b1".into(),
                turn_id: "turn-1".into(),
                cancel: CancelToken::new(),
            },
        ));
        assert!(registry.claim("t1", "turn-1"));
        assert!(!registry.claim("t1", "turn-1"));
    }

    #[test]
    fn recovery_does_not_write_a_second_terminal_when_a_digest_exists() {
        let path = std::env::temp_dir().join(format!("lodge-recover-{}.db", uuid::Uuid::new_v4()));
        let store = std::sync::Arc::new(crate::store::Store::open(&path).unwrap());
        store.start_turn("t1", "b1", "turn-1").unwrap();
        store
            .append_event(
                "d1",
                "t1",
                1,
                1,
                "message",
                &json!({
                    "kind": "message",
                    "threadId": "t1",
                    "message": { "id": "d1", "kind": "digest", "digest": { "turnId": "turn-1", "reply": "done" } }
                }),
            )
            .unwrap();
        let events = crate::events::EventBus::new(store.clone());
        recover(&TurnRegistry::default(), &store, &events);
        let messages = store.thread_messages("t1", 1000).unwrap();
        assert_eq!(messages.len(), 1, "no duplicate terminal after recovery");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn digest_reports_the_real_turn_duration() {
        let path = std::env::temp_dir().join(format!("lodge-duration-{}.db", uuid::Uuid::new_v4()));
        let store = std::sync::Arc::new(crate::store::Store::open(&path).unwrap());
        store.start_turn("t1", "b1", "turn-1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        let events = crate::events::EventBus::new(store.clone());
        let registry = TurnRegistry::default();
        assert!(registry.try_register("t1", TurnHandle {
            thread_id: "t1".into(),
            bot_id: "b1".into(),
            turn_id: "turn-1".into(),
            cancel: CancelToken::new(),
        }));
        settle(
            &registry,
            &store,
            &events,
            "t1",
            "b1",
            "turn-1",
            TurnOutcome::Completed,
            "done",
            &TurnUsage::default(),
        );
        let messages = store.thread_messages("t1", 100).unwrap();
        let digest = messages
            .iter()
            .find(|message| message.get("kind").and_then(serde_json::Value::as_str) == Some("digest"))
            .and_then(|message| message.get("digest"))
            .expect("a terminal digest");
        let duration = digest
            .get("durationMs")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        assert!(duration >= 25, "durationMs 应来自回合起点，实际 {duration}");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn the_digest_reports_the_real_tool_call_count() {
        let path = std::env::temp_dir().join(format!("lodge-tools-{}.db", uuid::Uuid::new_v4()));
        let store = std::sync::Arc::new(crate::store::Store::open(&path).unwrap());
        store.start_turn("t1", "b1", "turn-1").unwrap();
        let events = crate::events::EventBus::new(store.clone());
        let registry = TurnRegistry::default();
        assert!(registry.try_register("t1", TurnHandle {
            thread_id: "t1".into(),
            bot_id: "b1".into(),
            turn_id: "turn-1".into(),
            cancel: CancelToken::new(),
        }));
        settle(
            &registry,
            &store,
            &events,
            "t1",
            "b1",
            "turn-1",
            TurnOutcome::Completed,
            "done",
            &TurnUsage { input: 1, output: 1, cache_read: 0, tool_calls: 7 },
        );
        let messages = store.thread_messages("t1", 100).unwrap();
        let digest = messages
            .iter()
            .find(|message| message.get("kind").and_then(serde_json::Value::as_str) == Some("digest"))
            .and_then(|message| message.get("digest"))
            .expect("a terminal digest");
        assert_eq!(
            digest.get("toolCalls").and_then(serde_json::Value::as_u64),
            Some(7),
            "工具次数是回合事实，不能写死成 0"
        );
        assert_eq!(
            digest.get("stopReason").and_then(serde_json::Value::as_str),
            Some("completed"),
            "终态要进 digest：房间靠它区分做完和被停下"
        );
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let _ = std::fs::remove_file(path.with_extension("db-shm"));
    }

    #[test]
    fn two_messages_cannot_start_two_turns_on_one_thread() {
        let registry = TurnRegistry::default();
        let handle = || TurnHandle {
            thread_id: "t1".into(),
            bot_id: "b1".into(),
            turn_id: uuid::Uuid::new_v4().to_string(),
            cancel: CancelToken::new(),
        };
        assert!(registry.try_register("t1", handle()));
        assert!(!registry.try_register("t1", handle()));
    }

    #[test]
    fn cancelling_one_turn_does_not_touch_another() {
        let registry = TurnRegistry::default();
        let first = CancelToken::new();
        let second = CancelToken::new();
        assert!(registry.try_register("t1", TurnHandle {
            thread_id: "t1".into(), bot_id: "b1".into(), turn_id: "x".into(), cancel: first.clone(),
        }));
        assert!(registry.try_register("t2", TurnHandle {
            thread_id: "t2".into(), bot_id: "b2".into(), turn_id: "y".into(), cancel: second.clone(),
        }));
        assert!(registry.cancel_bot("b1").is_some());
        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
        assert!(registry.is_running("t2"));
    }
}

fn log_store<T>(what: &str, result: crate::store::StoreResult<T>) {
    if let Err(error) = result {
        eprintln!("lodge-base-slice: {what}失败: {error}");
    }
}

/// 启动恢复：running 回合补一条失败的终态，卡作废；不假装还能回答。
pub fn recover(
    registry: &TurnRegistry,
    store: &Store,
    events: &EventBus,
) {
    let _ = registry;
    for turn in store.recover_running() {
        // digest 已落库、turns 行没来得及更新：只补状态，不再写第二条终态。
        match store.turn_has_digest(&turn.thread_id, &turn.turn_id) {
            Ok(true) => {
                log_store(
                    "补齐回合状态",
                    store.end_turn(&turn.thread_id, &turn.turn_id, "completed"),
                );
                log_store("清理审批卡", store.delete_cards_for_turn(&turn.turn_id));
                clear_group_busy(store, events, &turn.thread_id, &turn.turn_id);
            }
            Ok(false) => finish(
                store,
                events,
                &turn.thread_id,
                &turn.bot_id,
                &turn.turn_id,
                TurnOutcome::Failed,
                "基座重启：这一回合没有完成。",
                &TurnUsage::default(),
            ),
            Err(error) => {
                eprintln!("lodge-base-slice: 读回合账本失败: {error}");
                finish(
                    store,
                    events,
                    &turn.thread_id,
                    &turn.bot_id,
                    &turn.turn_id,
                    TurnOutcome::Failed,
                    "基座重启：这一回合没有完成。",
                    &TurnUsage::default(),
                );
            }
        }
    }
}
