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
    #[allow(dead_code)] // TODO: wire into P2P message handler for untrusted peers
    pub fn deny_all() -> Self {
        Self {
            can_send_messages: false,
            can_read_agent_info: false,
            can_request_tasks: false,
            can_access_tools: false,
            can_write_vault: false,
        }
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialization_roundtrip() {
        let caps = CapabilitySet::default_phase1();
        let json = serde_json::to_string(&caps).unwrap();
        let restored: CapabilitySet = serde_json::from_str(&json).unwrap();
        assert_eq!(caps, restored);
    }
}
