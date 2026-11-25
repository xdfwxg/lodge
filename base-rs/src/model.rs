//! 基座共享类型：租约、回合终态、驱动上下文。
//! 业务概念（房间、阶段、证据）不在这里——它们属于 Lodge。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 一次会话的权限范围。bot 设置只是默认值；子租约只能收窄（基座只校验子集，不解释角色）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Lease {
    pub id: String,
    pub parent_id: Option<String>,
    pub read: Vec<String>,
    pub write: Vec<String>,
    pub exec: bool,
    pub network: Vec<String>,
}

impl Lease {
    pub fn deny_all() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            parent_id: None,
            read: Vec::new(),
            write: Vec::new(),
            exec: false,
            network: Vec::new(),
        }
    }

    /// 从 bot 的 settings 里取显式租约；没有声明就是拒绝，不猜。
    pub fn from_settings(settings: &Value) -> Self {
        let declared = settings
            .get("lease")
            .or_else(|| settings.get("toolScope"))
            .cloned()
            .unwrap_or(Value::Null);
        if declared.is_null() {
            return Self::deny_all();
        }
        let read = string_list(declared.get("read"));
        let write = string_list(declared.get("write"));
        let network = string_list(declared.get("network"));
        let exec = declared.get("exec").and_then(Value::as_bool).unwrap_or(false)
            || read.iter().any(|item| item == "exec");
        let parent_id = declared
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string);
        Self {
            id: declared
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            parent_id,
            read,
            write,
            exec,
            network,
        }
    }

    /// 子租约不能比父租约宽；基座只做集合校验。
    pub fn covers(&self, parent: &Lease) -> bool {
        let subset = |child: &[String], parent: &[String]| {
            child.iter().all(|item| parent.iter().any(|allowed| allowed == item))
        };
        subset(&self.read, &parent.read)
            && subset(&self.write, &parent.write)
            && subset(&self.network, &parent.network)
            && (!self.exec || parent.exec)
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        Some(Value::String(one)) => vec![one.clone()],
        _ => Vec::new(),
    }
}

/// 回合终态。digest 与 turn.completed 都是它的投影，不是第二份真相。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TurnOutcome {
    Completed,
    Stopped,
    Failed,
    Expired,
}

impl TurnOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Stopped => "stopped",
            Self::Failed => "failed",
            Self::Expired => "expired",
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct TurnUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
}

impl TurnUsage {
    /// 一次回合可能有多条 assistant 消息（工具循环）；用量按消息累加。
    pub fn merge(&mut self, other: &TurnUsage) {
        self.input = self.input.saturating_add(other.input);
        self.output = self.output.saturating_add(other.output);
        self.cache_read = self.cache_read.saturating_add(other.cache_read);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_missing_lease_means_deny() {
        let lease = Lease::from_settings(&json!({}));
        assert!(lease.read.is_empty());
        assert!(lease.write.is_empty());
        assert!(!lease.exec);
    }

    #[test]
    fn a_child_lease_cannot_widen_its_parent() {
        let parent = Lease {
            id: "p".into(),
            parent_id: None,
            read: vec!["/repo".into()],
            write: vec![],
            exec: false,
            network: vec![],
        };
        let mut child = parent.clone();
        child.id = "c".into();
        assert!(child.covers(&parent));
        child.exec = true;
        assert!(!child.covers(&parent));
        child.exec = false;
        child.read.push("/etc".into());
        assert!(!child.covers(&parent));
    }
}
