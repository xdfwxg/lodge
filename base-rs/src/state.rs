//! 组合根：store、事件总线、回合注册表、发现器在这里装配一次。
//! 入口只拿装配好的 App，不自己连数据库或创建驱动。

use std::sync::Arc;

use crate::discovery::Discovery;
use crate::drivers::DriverKind;
use crate::events::EventBus;
use crate::selfcheck::SelfCheck;
use crate::store::Store;
use crate::turns::{recover, TurnRegistry};

pub struct App {
    pub store: Arc<Store>,
    pub events: Arc<EventBus>,
    pub turns: Arc<TurnRegistry>,
    pub discovery: Arc<Discovery>,
    /// 群/成员的生命周期与开局互斥：删除和开始不能同时穿过。
    pub lifecycle: std::sync::Mutex<()>,
    /// 出口代理：None 表示显式关闭（LODGE_EGRESS=off）。
    pub egress: Option<crate::egress::Egress>,
    /// 只放行模型厂商的第二个出口：房间声明“只连模型”时用它。
    pub egress_model: Option<crate::egress::Egress>,
    pub fake: bool,
    /// 启动自检的结果：不过就拒绝开新回合，并把原因说清。
    pub self_check: SelfCheck,
}

impl App {
    pub fn new(
        store: Store,
        fake: bool,
        egress: Option<crate::egress::Egress>,
        egress_model: Option<crate::egress::Egress>,
        self_check: SelfCheck,
    ) -> Arc<Self> {
        let store = Arc::new(store);
        let events = EventBus::new(store.clone());
        let turns = Arc::new(TurnRegistry::default());
        recover(&turns, &store, &events);
        crate::sandbox::clean_stale_scratch();
        if !self_check.ok() {
            eprintln!("lodge-base-slice: 自检没通过：{}", self_check.problems.join("；"));
        }
        Arc::new(Self {
            store,
            events,
            turns,
            discovery: Arc::new(Discovery::new()),
            lifecycle: std::sync::Mutex::new(()),
            egress,
            egress_model,
            fake,
            self_check,
        })
    }
}

/// 驱动由 bot 的实例决定；没有实现的驱动诚实失败，不静默换成别的。
pub fn driver_kind_of(bot: &serde_json::Value) -> DriverKind {
    let instance = bot
        .get("modelSelection")
        .and_then(|selection| selection.get("instanceId"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    match instance {
        "pi" => DriverKind::Pi,
        "claude" => DriverKind::Claude,
        "codex" => DriverKind::Codex,
        "fake" => DriverKind::Fake,
        _ => DriverKind::Unsupported,
    }
}
