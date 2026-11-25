//! 事件总线：序号、持久化、环形缓冲与 SSE 信封。
//! 帧形状与旧基座一致；`id` 是事件身份，`seq` 只是游标。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::store::{now, Store};

const REPLAY_LIMIT: usize = 500;

pub struct EventBus {
    store: Arc<Store>,
    tx: broadcast::Sender<(u64, Value)>,
    last_seq: AtomicU64,
    stream_id: String,
    buffer: Mutex<VecDeque<(u64, Value)>>,
}

impl EventBus {
    pub fn new(store: Arc<Store>) -> Arc<Self> {
        let (tx, _) = broadcast::channel(1024);
        let last_seq = store.last_seq();
        Arc::new(Self {
            store,
            tx,
            last_seq: AtomicU64::new(last_seq),
            stream_id: uuid::Uuid::new_v4().to_string(),
            buffer: Mutex::new(VecDeque::new()),
        })
    }

    pub fn last_seq(&self) -> u64 {
        self.last_seq.load(Ordering::SeqCst)
    }

    /// 一条事件只有一次落库与一次广播；seq 在这里分配。
    pub fn emit(&self, mut frame: Value) -> u64 {
        let seq = self.last_seq.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(object) = frame.as_object_mut() {
            object.insert("seq".into(), json!(seq));
        }
        let thread_id = frame
            .get("threadId")
            .and_then(Value::as_str)
            .or_else(|| frame.get("group").and_then(|group| group.get("threadId")).and_then(Value::as_str))
            .unwrap_or("");
        let kind = frame.get("kind").and_then(Value::as_str).unwrap_or("event");
        let id = frame
            .get("message")
            .and_then(|message| message.get("id"))
            .and_then(Value::as_str)
            .or_else(|| frame.get("group").and_then(|group| group.get("id")).and_then(Value::as_str))
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let at = frame
            .get("message")
            .and_then(|message| message.get("at"))
            .and_then(Value::as_i64)
            .unwrap_or_else(now);
        if let Err(error) = self.store.append_event(&id, thread_id, seq, at, kind, &frame) {
            // 事件是真相；写失败必须可见。
            eprintln!("lodge-base-slice: 写事件失败: {error}");
        }
        if let Ok(mut buffer) = self.buffer.lock() {
            buffer.push_back((seq, frame.clone()));
            while buffer.len() > REPLAY_LIMIT {
                buffer.pop_front();
            }
        }
        let _ = self.tx.send((seq, frame));
        seq
    }

    pub fn subscribe(&self) -> broadcast::Receiver<(u64, Value)> {
        self.tx.subscribe()
    }

    pub fn replay_after(&self, seq: u64) -> Vec<(u64, Value)> {
        let buffer = self.buffer.lock().unwrap();
        buffer.iter().filter(|(item, _)| *item > seq).cloned().collect()
    }

    /// 只有同一个 streamId 的游标才能续传；换基座/重启后从头开始。
    pub fn cursor_of(&self, headers: &HeaderMap) -> Option<u64> {
        let raw = headers.get("last-event-id")?.to_str().ok()?;
        let (stream, seq) = raw.rsplit_once(':')?;
        if stream != self.stream_id {
            return None;
        }
        seq.trim().parse::<u64>().ok()
    }

    pub fn sse(
        self: Arc<Self>,
        headers: HeaderMap,
    ) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
        let cursor = self.cursor_of(&headers);
        let from = cursor.unwrap_or(0);
        let hello = json!({
            "kind": "hello",
            "cursor": format!("{}:{}", self.stream_id, self.last_seq()),
            "resumed": cursor.is_some(),
        });
        let receiver = self.subscribe();
        let replay = self.replay_after(from);
        let last = Arc::new(AtomicU64::new(from));
        let stream_id = self.stream_id.clone();
        let hello_frame = Event::default().data(hello.to_string());
        let live = BroadcastStream::new(receiver).filter_map(|item| item.ok());
        let stream = tokio_stream::iter(replay)
            .chain(live)
            .filter_map(move |(seq, frame)| {
                let previous = last.fetch_max(seq, Ordering::SeqCst);
                if seq <= previous {
                    return None;
                }
                Some(Ok(Event::default()
                    .id(format!("{}:{}", stream_id, seq))
                    .data(frame.to_string())))
            });
        let hello_stream = tokio_stream::iter(vec![Ok::<Event, std::convert::Infallible>(hello_frame)]);
        Sse::new(hello_stream.chain(stream)).keep_alive(KeepAlive::default())
    }
}

pub fn message_frame(thread_id: &str, message: Value) -> Value {
    json!({ "kind": "message", "threadId": thread_id, "message": message })
}

pub fn runtime_frame(_thread_id: &str, event: Value) -> Value {
    json!({ "kind": "runtime", "event": event })
}

pub fn group_frame(group: Value) -> Value {
    json!({ "kind": "group", "group": group })
}
