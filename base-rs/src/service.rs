//! 回合开始的用例：选人、校验租约、占用线程、起驱动。
//! HTTP 只负责解析与错误映射；这条流程不属于「房间」也不属于「路由」。

use std::sync::Arc;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::drivers::{self, DriverContext};
use crate::events::{group_frame, runtime_frame};
use crate::model::Lease;
use crate::state::{driver_kind_of, App};
use crate::turns::{CancelToken, TurnHandle};

pub struct StartTurn {
    pub group_id: String,
    pub text: String,
    pub send_id: String,
    pub mentions: Vec<String>,
}

pub struct Started {
    pub thread_id: String,
    pub message_id: String,
    pub send_id: String,
}

#[derive(Debug)]
pub enum StartError {
    NotFound(String),
    Conflict(String),
    BadRequest(String),
    Internal(String),
}

pub fn start_turn(app: &Arc<App>, request: StartTurn) -> Result<Started, StartError> {
    if request.text.trim().is_empty() {
        return Err(StartError::BadRequest("消息不能为空".to_string()));
    }
    // 与删除互斥：删除先拿到锁，就不会有一个开局穿过删除把群重新写回来。
    let _lifecycle = app
        .lifecycle
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let group = app
        .store
        .group(&request.group_id)
        .map_err(StartError::Internal)?
        .ok_or_else(|| StartError::NotFound("没有这个群".to_string()))?;
    let thread_id = group
        .get("threadId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let member_ids: Vec<String> = group
        .get("memberIds")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    let mut mentioned: Option<String> = None;
    for id in &request.mentions {
        if !member_ids.is_empty() && !member_ids.iter().any(|member| member == id) {
            continue;
        }
        if app.store.bot(id).map_err(StartError::Internal)?.is_some() {
            mentioned = Some(id.clone());
            break;
        }
    }
    let bot_id = mentioned
        .or_else(|| {
            group
                .get("defaultResponder")
                .and_then(|value| value.get("botId"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| member_ids.first().cloned())
        .unwrap_or_default();
    let bot = app
        .store
        .bot(&bot_id)
        .map_err(StartError::Internal)?
        .ok_or_else(|| StartError::NotFound("这个群没有可用的成员身体".to_string()))?;

    // 叫停是投递边界：被 hold 的成员不能被一条消息重新叫起来。
    let held = group
        .get("holds")
        .and_then(|holds| holds.get(&bot_id))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if held {
        return Err(StartError::Conflict("这个成员被叫停了；先继续，再派任务".to_string()));
    }

    let settings = bot.get("settings").cloned().unwrap_or(Value::Null);
    let lease = Lease::from_settings(&settings);
    if let Some(parent_id) = lease.parent_id.clone() {
        match app.store.lease(&parent_id).map_err(StartError::Internal)? {
            Some(parent) if lease.covers(&parent) => {}
            Some(_) => return Err(StartError::BadRequest("租约不能比父租约更宽".to_string())),
            None => return Err(StartError::BadRequest("父租约不存在".to_string())),
        }
    }
    app.store.save_lease(&lease).map_err(StartError::Internal)?;

    let turn_id = Uuid::new_v4().to_string();
    let cancel = CancelToken::new();
    let started = app.turns.try_register(
        &thread_id,
        TurnHandle {
            thread_id: thread_id.clone(),
            bot_id: bot_id.clone(),
            turn_id: turn_id.clone(),
            cancel: cancel.clone(),
        },
    );
    if !started {
        return Err(StartError::Conflict("这一轮还在跑；先等它结束".to_string()));
    }
    if let Err(error) = app.store.start_turn(&thread_id, &bot_id, &turn_id) {
        app.turns.cancel(&thread_id);
        return Err(StartError::Internal(error));
    }

    app.events.emit(runtime_frame(
        &thread_id,
        json!({
            "threadId": thread_id,
            "botId": bot_id,
            "turnId": turn_id,
            "type": "turn.started",
        }),
    ));
    let mut busy = group.clone();
    busy["working"] = json!(true);
    busy["busyBotId"] = json!(bot_id);
    busy["busyTurnId"] = json!(turn_id);
    if let Err(error) = app.store.upsert_group(&busy) {
        // 群忙碌态是派生状态；写失败要可见，但不该把一个已经开始的回合判死。
        eprintln!("lodge-base-slice: 记录群忙碌失败: {error}");
    }
    app.events.emit(group_frame(busy));

    let model = bot
        .get("modelSelection")
        .and_then(|selection| selection.get("model"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let system = settings
        .get("soul")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let cwd = group
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("/tmp")
        .to_string();
    let kind = driver_kind_of(&bot);
    drivers::spawn(
        app.clone(),
        kind,
        DriverContext {
            thread_id: thread_id.clone(),
            bot_id,
            turn_id,
            prompt: request.text,
            system,
            model,
            cwd,
            lease,
            cancel,
        },
    );

    Ok(Started {
        thread_id,
        message_id: Uuid::new_v4().to_string(),
        send_id: request.send_id,
    })
}
