//! RelayManager — WebSocket relay-based peer communication.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use wa_shared::protocol::PresenceStatus;

use super::identity::NodeIdentity;
use super::relay_client::RelayHandle;

mod event_loop;
mod lifecycle;
mod messaging;
mod peers;

// ── Public types ──

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum NetworkStatus {
    Dormant,
    Starting,
    Active,
    Reconnecting,
    Stopping,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum RelayError {
    #[error("Network not active")]
    NotActive,
    #[error("Command channel closed")]
    ChannelClosed,
    #[error("Transport error: {0}")]
    Transport(String),
}

// ── Tauri event payloads ──

#[derive(Clone, Serialize)]
pub(crate) struct ConnectionStateEvent {
    pub(crate) status: String,
    pub(crate) peer_count: usize,
}

// ── RelayManager ──

#[derive(Clone)]
pub struct RelayManager {
    identity: NodeIdentity,
    relay_handle: Arc<Mutex<Option<RelayHandle>>>,
    status: Arc<Mutex<NetworkStatus>>,
    /// DB peer_ids of known contacts.
    known_peers: Arc<Mutex<HashSet<String>>>,
    /// relay_peer_id → db_peer_id
    relay_id_index: Arc<Mutex<HashMap<String, String>>>,
    /// db_peer_id → (ed25519_public_key_bytes, relay_peer_id)
    peer_keys: Arc<Mutex<HashMap<String, ([u8; 32], String)>>>,
    /// relay_peer_id → online/offline
    peer_presence: Arc<tokio::sync::RwLock<HashMap<String, PresenceStatus>>>,
}

impl RelayManager {
    pub fn new(identity: &NodeIdentity) -> Self {
        Self {
            identity: identity.clone(),
            relay_handle: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(NetworkStatus::Dormant)),
            known_peers: Arc::new(Mutex::new(HashSet::new())),
            relay_id_index: Arc::new(Mutex::new(HashMap::new())),
            peer_keys: Arc::new(Mutex::new(HashMap::new())),
            peer_presence: Arc::new(tokio::sync::RwLock::new(HashMap::new())),
        }
    }
}

fn lock_err() -> RelayError {
    RelayError::Transport("lock poisoned".into())
}
