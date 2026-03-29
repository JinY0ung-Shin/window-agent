use serde::{Deserialize, Serialize};
use wa_shared::protocol::PublishedAgent;

pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Envelope {
    pub version: u32,
    pub message_id: String,
    pub correlation_id: Option<String>,
    pub timestamp: String,
    pub sender_agent: String,
    pub payload: Payload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Payload {
    Introduce {
        agent_name: String,
        agent_description: String,
        public_key: String,
        /// Agents published by the sender for network visitors.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        published_agents: Option<Vec<PublishedAgent>>,
    },
    MessageRequest {
        content: String,
        /// Which agent the sender wants to talk to (chosen by remote peer).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_agent_id: Option<String>,
    },
    MessageResponse {
        content: String,
        /// Which agent actually generated this response.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        responding_agent_id: Option<String>,
    },
    Ack {
        acked_message_id: String,
    },
    Error {
        code: String,
        message: String,
    },
}

impl Envelope {
    pub fn new(sender_agent: String, payload: Payload) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            message_id: uuid::Uuid::new_v4().to_string(),
            correlation_id: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            sender_agent,
            payload,
        }
    }

    pub fn with_correlation(mut self, correlation_id: String) -> Self {
        self.correlation_id = Some(correlation_id);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_envelope_serialize_deserialize() {
        let env = Envelope::new(
            "test-agent".into(),
            Payload::MessageRequest {
                content: "hello".into(),
                target_agent_id: None,
            },
        );
        let json = serde_json::to_string(&env).unwrap();
        let restored: Envelope = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.message_id, env.message_id);
        assert_eq!(restored.sender_agent, "test-agent");
        assert_eq!(restored.version, PROTOCOL_VERSION);
    }

    #[test]
    fn test_payload_tagged_serialization() {
        let payload = Payload::Introduce {
            agent_name: "agent1".into(),
            agent_description: "A test agent".into(),
            public_key: "AAAA".into(),
            published_agents: None,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"Introduce\""));
        assert!(json.contains("\"agent_name\":\"agent1\""));
    }

    #[test]
    fn test_all_payload_variants_roundtrip() {
        let payloads = vec![
            Payload::Introduce {
                agent_name: "a".into(),
                agent_description: "b".into(),
                public_key: "pk".into(),
                published_agents: None,
            },
            Payload::MessageRequest {
                content: "c".into(),
                target_agent_id: None,
            },
            Payload::MessageResponse {
                content: "d".into(),
                responding_agent_id: None,
            },
            Payload::Ack {
                acked_message_id: "e".into(),
            },
            Payload::Error {
                code: "f".into(),
                message: "g".into(),
            },
        ];
        for p in payloads {
            let json = serde_json::to_string(&p).unwrap();
            let restored: Payload = serde_json::from_str(&json).unwrap();
            assert_eq!(p, restored);
        }
    }

    #[test]
    fn test_envelope_with_correlation() {
        let env = Envelope::new(
            "agent".into(),
            Payload::Ack {
                acked_message_id: "123".into(),
            },
        )
        .with_correlation("corr-456".into());
        assert_eq!(env.correlation_id, Some("corr-456".into()));

        let json = serde_json::to_string(&env).unwrap();
        let restored: Envelope = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.correlation_id, Some("corr-456".into()));
    }

    #[test]
    fn test_envelope_without_correlation() {
        let env = Envelope::new(
            "agent".into(),
            Payload::MessageRequest {
                content: "hi".into(),
                target_agent_id: None,
            },
        );
        assert_eq!(env.correlation_id, None);

        let json = serde_json::to_string(&env).unwrap();
        assert!(json.contains("\"correlation_id\":null"));
    }

    #[test]
    fn test_envelope_fields() {
        let env = Envelope::new(
            "sender".into(),
            Payload::Error {
                code: "ERR_001".into(),
                message: "something broke".into(),
            },
        );
        assert!(!env.message_id.is_empty());
        assert!(!env.timestamp.is_empty());
        assert_eq!(env.sender_agent, "sender");
    }
}
