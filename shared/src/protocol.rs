//! WebSocket relay protocol message types (v1).

use serde::{Deserialize, Serialize};

// ── Server → Client ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Authentication challenge (sent on connect)
    Challenge {
        nonce: String,
        server_time: String,
    },
    /// Authentication success
    AuthOk {
        peer_id: String,
    },
    /// Incoming encrypted envelope from another peer
    Envelope {
        sender_peer_id: String,
        envelope: serde_json::Value,
    },
    /// Server acknowledged receipt of a message
    ServerAck {
        message_id: String,
        status: AckStatus,
    },
    /// Peer acknowledged receipt of a message
    PeerAck {
        message_id: String,
    },
    /// Error
    Error {
        code: String,
        message: String,
    },
    /// Presence change for a subscribed peer
    Presence {
        peer_id: String,
        status: PresenceStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        last_seen: Option<String>,
    },
    /// Bulk presence snapshot (response to subscribe_presence)
    PresenceSnapshot {
        peers: Vec<PeerPresenceInfo>,
    },
    /// Profile update acknowledged
    ProfileUpdated {
        discoverable: bool,
    },
    /// Directory search results
    DirectoryResult {
        query: String,
        peers: Vec<DirectoryPeer>,
        total: u64,
        offset: u32,
    },
    /// Single peer profile response
    PeerProfileResult {
        peer: Option<DirectoryPeer>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AckStatus {
    Delivered,
    Queued,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceStatus {
    Online,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerPresenceInfo {
    pub peer_id: String,
    pub status: PresenceStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<String>,
}

/// A peer entry from the server directory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryPeer {
    pub peer_id: String,
    pub public_key: String,
    pub agent_name: String,
    pub agent_description: String,
    pub is_online: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen: Option<String>,
    /// List of agents this peer has published for network access.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agents: Option<Vec<PublishedAgent>>,
}

/// An agent published by a peer for network visitors to select.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishedAgent {
    pub agent_id: String,
    pub name: String,
    pub description: String,
}

// ── Client → Server ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Authentication response
    Auth {
        peer_id: String,
        public_key: String,
        signature: String,
    },
    /// Send an encrypted envelope to another peer
    Envelope {
        target_peer_id: String,
        envelope: serde_json::Value,
    },
    /// Acknowledge receipt of a message (peer ACK)
    PeerAck {
        message_id: String,
        sender_peer_id: String,
    },
    /// Subscribe to presence updates for specific peers
    SubscribePresence {
        peer_ids: Vec<String>,
    },
    /// Register/update profile in the server directory
    UpdateProfile {
        agent_name: String,
        agent_description: String,
        discoverable: bool,
        /// List of agents published for network visitors.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agents: Option<Vec<PublishedAgent>>,
    },
    /// Search peers in the directory
    SearchDirectory {
        query: String,
        limit: u32,
        offset: u32,
    },
    /// Get a specific peer's profile
    GetPeerProfile {
        peer_id: String,
    },
}
