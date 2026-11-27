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

/// 一回合的运行时预算：工具调用数、墙上时间、多久没动静算停。数字是产品默认，基座只执行。
pub const DEFAULT_TOOL_CALLS: u64 = 1000;
pub const DEFAULT_MAX_MS: u64 = 4 * 60 * 60 * 1000;
/// 模型服务可能卡住：一整回合可以长，但“一个字都不出”不能无限等。
pub const DEFAULT_IDLE_MS: u64 = 2 * 60 * 1000;

#[derive(Clone, Debug)]
pub struct TurnBudget {
    pub tool_calls: u64,
    pub max_ms: u64,
    pub idle_ms: u64,
}

/// 显式声明的预算；没声明或写了不合理的值，用基座的安全默认，不放开成无限。
pub fn budget_of(settings: &Value) -> TurnBudget {
    let declared = settings.get("budget");
    TurnBudget {
        tool_calls: declared
            .and_then(|budget| budget.get("toolCalls"))
            .and_then(Value::as_u64)
            .filter(|count| *count > 0)
            .unwrap_or(DEFAULT_TOOL_CALLS),
        max_ms: declared
            .and_then(|budget| budget.get("maxMs"))
            .and_then(Value::as_u64)
            .filter(|ms| *ms >= 1000)
            .unwrap_or(DEFAULT_MAX_MS),
        idle_ms: declared
            .and_then(|budget| budget.get("idleMs"))
            .and_then(Value::as_u64)
            .filter(|ms| *ms >= 1000)
            .unwrap_or(DEFAULT_IDLE_MS),
    }
}

/// bot 设置里的显式原生工具授权；没声明就是没有授权，不按房型猜。
/// 不在这里维护工具名白名单：pi 升级多出新工具时，Lodge 声明就能用，基座不用改。
pub fn native_tools_of(settings: &Value) -> Vec<String> {
    let mut tools: Vec<String> = string_list(settings.get("nativeTools"))
        .into_iter()
        .filter(|name| !name.trim().is_empty())
        .collect();
    tools.sort();
    tools.dedup();
    tools
}

/// Lodge 的工具选择是 `native:<name>` / `mcp:<server>:<name>`；pi 认的是 `name` / `mcp__server__name`。
/// 只翻译 deny 清单：allow 清单是基座自己的工具面前提，不在这里二次解释。
pub fn exclude_tools_of(settings: &Value) -> Vec<String> {
    let deny = string_list(settings.get("toolScope").and_then(|scope| scope.get("deny")));
    let mut tools: Vec<String> = deny
        .into_iter()
        .filter_map(|selector| {
            if let Some(name) = selector.strip_prefix("native:") {
                return Some(name.to_string());
            }
            let rest = selector.strip_prefix("mcp:")?;
            let (server, tool) = rest.split_once(':')?;
            Some(format!("mcp__{server}__{tool}"))
        })
        .collect();
    tools.sort();
    tools.dedup();
    tools
}

pub(crate) fn string_list(value: Option<&Value>) -> Vec<String> {
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
    /// 这一回合实际发生的工具调用次数；digest 如实报它，诊断和界面不再自己猜。
    pub tool_calls: u64,
}

impl TurnUsage {
    /// 一次回合可能有多条 assistant 消息（工具循环）；用量按消息累加。
    /// 工具次数由驱动自己记，不随消息重复累加。
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
    fn a_budget_falls_back_to_safe_defaults() {
        let fallback = budget_of(&json!({}));
        assert_eq!(fallback.tool_calls, DEFAULT_TOOL_CALLS);
        assert_eq!(fallback.max_ms, DEFAULT_MAX_MS);
        assert_eq!(fallback.idle_ms, DEFAULT_IDLE_MS);
        let declared = budget_of(&json!({ "budget": { "toolCalls": 12, "maxMs": 5000, "idleMs": 90_000 } }));
        assert_eq!(declared.tool_calls, 12);
        assert_eq!(declared.max_ms, 5000);
        assert_eq!(declared.idle_ms, 90_000);
        let nonsense = budget_of(&json!({ "budget": { "toolCalls": 0, "maxMs": 10, "idleMs": 1 } }));
        assert_eq!(nonsense.tool_calls, DEFAULT_TOOL_CALLS);
        assert_eq!(nonsense.max_ms, DEFAULT_MAX_MS);
        assert_eq!(nonsense.idle_ms, DEFAULT_IDLE_MS);
    }

    #[test]
    fn native_tools_come_from_the_declaration_without_a_hardcoded_list() {
        assert!(native_tools_of(&json!({})).is_empty(), "没声明就是没有工具");
        assert_eq!(
            native_tools_of(&json!({ "nativeTools": ["bash", "read", "rm", "read"] })),
            vec!["bash".to_string(), "read".to_string(), "rm".to_string()],
            "重复的丢掉；名字不靠基座白名单，pi 升级多出的工具声明就能用"
        );
    }

    #[test]
    fn denied_tools_are_translated_for_pi() {
        let settings = json!({
            "toolScope": { "deny": ["mcp:agents:*", "mcp:lodge_gate:submit_verdict", "native:bash"] }
        });
        assert_eq!(
            exclude_tools_of(&settings),
            vec![
                "bash".to_string(),
                "mcp__agents__*".to_string(),
                "mcp__lodge_gate__submit_verdict".to_string(),
            ]
        );
        assert!(exclude_tools_of(&json!({})).is_empty());
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
