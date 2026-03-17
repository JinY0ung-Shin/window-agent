use serde::{Deserialize, Serialize};

/// Defines what a remote contact is allowed to do.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CapabilitySet {
    pub can_send_messages: bool,
    pub can_read_agent_info: bool,
    pub can_request_tasks: bool,
    pub can_access_tools: bool,
    pub can_write_vault: bool,
}

impl CapabilitySet {
    /// Phase 1 default: messages and agent info only. Everything else blocked.
    pub fn default_phase1() -> Self {
        Self {
            can_send_messages: true,
            can_read_agent_info: true,
            can_request_tasks: false,
            can_access_tools: false,
            can_write_vault: false,
        }
    }

    /// Maximum restriction — block everything.
    pub fn deny_all() -> Self {
        Self {
            can_send_messages: false,
            can_read_agent_info: false,
            can_request_tasks: false,
            can_access_tools: false,
            can_write_vault: false,
        }
    }

    /// Check if a specific action is allowed.
    pub fn is_allowed(&self, action: &CapabilityAction) -> bool {
        match action {
            CapabilityAction::SendMessage => self.can_send_messages,
            CapabilityAction::ReadAgentInfo => self.can_read_agent_info,
            CapabilityAction::RequestTask => self.can_request_tasks,
            CapabilityAction::AccessTool(_) => self.can_access_tools,
            CapabilityAction::WriteVault => self.can_write_vault,
        }
    }
}

#[derive(Debug, Clone)]
pub enum CapabilityAction {
    SendMessage,
    ReadAgentInfo,
    RequestTask,
    AccessTool(String),
    WriteVault,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_phase1_allows_messages_and_agent_info() {
        let caps = CapabilitySet::default_phase1();
        assert!(caps.is_allowed(&CapabilityAction::SendMessage));
        assert!(caps.is_allowed(&CapabilityAction::ReadAgentInfo));
    }

    #[test]
    fn test_default_phase1_blocks_sensitive_actions() {
        let caps = CapabilitySet::default_phase1();
        assert!(!caps.is_allowed(&CapabilityAction::RequestTask));
        assert!(!caps.is_allowed(&CapabilityAction::AccessTool("shell".into())));
        assert!(!caps.is_allowed(&CapabilityAction::WriteVault));
    }

    #[test]
    fn test_deny_all_blocks_everything() {
        let caps = CapabilitySet::deny_all();
        assert!(!caps.is_allowed(&CapabilityAction::SendMessage));
        assert!(!caps.is_allowed(&CapabilityAction::ReadAgentInfo));
        assert!(!caps.is_allowed(&CapabilityAction::RequestTask));
        assert!(!caps.is_allowed(&CapabilityAction::AccessTool("any_tool".into())));
        assert!(!caps.is_allowed(&CapabilityAction::WriteVault));
    }

    #[test]
    fn test_access_tool_checks_can_access_tools_flag() {
        let mut caps = CapabilitySet::deny_all();
        caps.can_access_tools = true;
        assert!(caps.is_allowed(&CapabilityAction::AccessTool("browser".into())));
        assert!(caps.is_allowed(&CapabilityAction::AccessTool("editor".into())));
    }

    #[test]
    fn test_serialization_roundtrip() {
        let caps = CapabilitySet::default_phase1();
        let json = serde_json::to_string(&caps).unwrap();
        let restored: CapabilitySet = serde_json::from_str(&json).unwrap();
        assert_eq!(caps, restored);
    }

    #[test]
    fn test_individual_capability_toggle() {
        let mut caps = CapabilitySet::deny_all();

        caps.can_request_tasks = true;
        assert!(caps.is_allowed(&CapabilityAction::RequestTask));
        assert!(!caps.is_allowed(&CapabilityAction::SendMessage));

        caps.can_write_vault = true;
        assert!(caps.is_allowed(&CapabilityAction::WriteVault));
    }
}
