//! RelayManager — WebSocket relay-based peer communication.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;
use wa_shared::encrypted_envelope::{EncryptedEnvelope, EnvelopeHeader};
use wa_shared::protocol::PresenceStatus;

use super::crypto;
use super::db as relay_db;
use super::envelope::{Envelope, Payload};
use super::identity::NodeIdentity;
use super::relay_client::{self, derive_relay_peer_id, RelayEvent, RelayHandle};

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

    // ── Known-peers management ──

    pub fn set_known_peers(&self, peers: HashSet<String>) -> Result<(), RelayError> {
        *self.known_peers.lock().map_err(|_| lock_err())? = peers;
        Ok(())
    }

    pub fn add_known_peer(&self, peer_id: String) -> Result<(), RelayError> {
        self.known_peers.lock().map_err(|_| lock_err())?.insert(peer_id);
        Ok(())
    }

    /// Register a peer's Ed25519 public key (base64). Builds internal indexes.
    pub fn register_peer_key(&self, db_peer_id: &str, public_key_b64: &str) -> Result<(), RelayError> {
        let pk_bytes = B64.decode(public_key_b64)
            .map_err(|e| RelayError::Transport(format!("bad base64 key: {e}")))?;
        if pk_bytes.len() != 32 {
            return Err(RelayError::Transport("public key must be 32 bytes".into()));
        }
        let pk: [u8; 32] = pk_bytes.try_into().unwrap();
        let relay_pid = derive_relay_peer_id(&pk);

        self.relay_id_index.lock().map_err(|_| lock_err())?
            .insert(relay_pid.clone(), db_peer_id.to_string());
        self.peer_keys.lock().map_err(|_| lock_err())?
            .insert(db_peer_id.to_string(), (pk, relay_pid));
        self.known_peers.lock().map_err(|_| lock_err())?
            .insert(db_peer_id.to_string());
        Ok(())
    }

    pub fn remove_known_peer(&self, peer_id: &str) -> Result<(), RelayError> {
        self.known_peers.lock().map_err(|_| lock_err())?.remove(peer_id);
        if let Ok(mut keys) = self.peer_keys.lock() {
            if let Some((_, relay_id)) = keys.remove(peer_id) {
                if let Ok(mut idx) = self.relay_id_index.lock() {
                    idx.remove(&relay_id);
                }
            }
        }
        Ok(())
    }

    // ── Status queries ──

    /// Always true when relay is active (no per-peer auth gating in relay mode).
    pub fn is_peer_authenticated(&self, _peer_id: &str) -> Result<bool, RelayError> {
        Ok(*self.status.lock().map_err(|_| lock_err())? == NetworkStatus::Active)
    }

    pub fn status(&self) -> Result<NetworkStatus, RelayError> {
        Ok(*self.status.lock().map_err(|_| lock_err())?)
    }

    /// Returns the relay-compatible peer_id (hex string).
    pub fn peer_id(&self) -> Result<String, RelayError> {
        let public = self.identity.public_key_bytes();
        Ok(derive_relay_peer_id(&public))
    }

    /// Look up the relay_peer_id for a given DB peer_id.
    pub fn peer_id_to_relay_id(&self, db_peer_id: &str) -> Result<String, RelayError> {
        self.peer_keys.lock().map_err(|_| lock_err())?
            .get(db_peer_id)
            .map(|(_, relay_id)| relay_id.clone())
            .ok_or_else(|| RelayError::Transport(format!("No key for peer: {db_peer_id}")))
    }

    /// Get a clone of the current relay handle (if connected).
    pub fn get_relay_handle(&self) -> Option<RelayHandle> {
        self.relay_handle.lock().ok().and_then(|h| h.clone())
    }

    // ── Lifecycle ──

    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<(), RelayError> {
        {
            let mut st = self.status.lock().map_err(|_| lock_err())?;
            if *st != NetworkStatus::Dormant {
                return Err(RelayError::Transport("Already running".into()));
            }
            *st = NetworkStatus::Starting;
        }

        let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
            status: "starting".into(), peer_count: 0,
        });

        // Read relay URL from settings
        let relay_url = {
            use tauri_plugin_store::StoreExt;
            app_handle.store("relay-settings.json").ok()
                .and_then(|s| s.get("relay_url"))
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "wss://relay.windowagent.io/ws".to_string())
        };

        // Build peer indexes from contacts DB
        self.rebuild_peer_index(&app_handle)?;

        // Migrate legacy plaintext outbox entries
        self.migrate_outbox(&app_handle);

        // Start relay client
        let (handle, event_rx) = relay_client::start(relay_url, &self.identity)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        *self.relay_handle.lock().map_err(|_| lock_err())? = Some(handle.clone());
        *self.status.lock().map_err(|_| lock_err())? = NetworkStatus::Active;

        // Subscribe to presence for known peers
        let relay_ids: Vec<String> = self.relay_id_index.lock()
            .map(|idx| idx.keys().cloned().collect())
            .unwrap_or_default();
        if !relay_ids.is_empty() {
            let _ = handle.subscribe_presence(relay_ids);
        }

        // Spawn event processing loop
        let mgr = self.clone();
        let app = app_handle.clone();
        tokio::spawn(async move {
            mgr.run_event_loop(event_rx, &app).await;
        });

        let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
            status: "active".into(), peer_count: 0,
        });

        Ok(())
    }

    pub async fn stop(&self) -> Result<(), RelayError> {
        let handle = {
            let mut st = self.status.lock().map_err(|_| lock_err())?;
            if *st != NetworkStatus::Active && *st != NetworkStatus::Reconnecting {
                return Err(RelayError::NotActive);
            }
            *st = NetworkStatus::Stopping;
            self.relay_handle.lock().map_err(|_| lock_err())?.take()
        };

        if let Some(h) = handle {
            h.shutdown();
        }

        *self.status.lock().map_err(|_| lock_err())? = NetworkStatus::Dormant;
        Ok(())
    }

    // ── Messaging ──

    /// Encrypt a plaintext Envelope for a target peer.
    /// Returns the EncryptedEnvelope as a JSON string (for storage in raw_envelope).
    pub fn encrypt_for_peer(
        &self,
        target_db_peer_id: &str,
        envelope: &Envelope,
    ) -> Result<String, RelayError> {
        let (public_key, _relay_pid) = self.peer_keys.lock().map_err(|_| lock_err())?
            .get(target_db_peer_id)
            .cloned()
            .ok_or_else(|| RelayError::Transport(format!("No key for peer: {target_db_peer_id}")))?;

        let sender_secret: [u8; 32] = self.identity.secret_bytes()
            .try_into()
            .map_err(|_| RelayError::Transport("bad key length".into()))?;

        let payload_json = serde_json::to_vec(envelope)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        let header = EnvelopeHeader {
            version: 1,
            message_id: envelope.message_id.clone(),
            sender_agent: envelope.sender_agent.clone(),
            correlation_id: envelope.correlation_id.clone(),
            timestamp: envelope.timestamp.clone(),
        };

        let (ciphertext, nonce, sender_x25519_pub) = crypto::encrypt_payload(
            &sender_secret, &public_key, &header, &payload_json,
        ).map_err(|e| RelayError::Transport(e.to_string()))?;

        let encrypted = EncryptedEnvelope {
            header,
            encrypted_payload: ciphertext,
            nonce: nonce.to_vec(),
            sender_x25519_public: sender_x25519_pub.to_vec(),
        };

        serde_json::to_string(&encrypted)
            .map_err(|e| RelayError::Transport(e.to_string()))
    }

    /// Send an already-encrypted envelope JSON via relay.
    pub async fn send_raw_envelope(
        &self,
        target_db_peer_id: &str,
        encrypted_json: &str,
    ) -> Result<(), RelayError> {
        let handle = self.relay_handle.lock().map_err(|_| lock_err())?
            .clone().ok_or(RelayError::NotActive)?;

        let relay_pid = self.peer_keys.lock().map_err(|_| lock_err())?
            .get(target_db_peer_id)
            .map(|(_, rid)| rid.clone())
            .ok_or_else(|| RelayError::Transport(format!("No key for peer: {target_db_peer_id}")))?;

        let envelope_value: serde_json::Value = serde_json::from_str(encrypted_json)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        handle.send_envelope(&relay_pid, envelope_value)
            .map_err(|e| RelayError::Transport(e.to_string()))
    }

    /// Convenience: encrypt + send. Returns encrypted JSON for storage.
    pub async fn send_message(
        &self,
        target_db_peer_id: &str,
        envelope: &Envelope,
    ) -> Result<String, RelayError> {
        let encrypted = self.encrypt_for_peer(target_db_peer_id, envelope)?;
        self.send_raw_envelope(target_db_peer_id, &encrypted).await?;
        Ok(encrypted)
    }

    // ── Directory ──

    /// Auto-register profile on the relay server directory after connecting.
    fn auto_register_profile(&self, app_handle: &tauri::AppHandle, handle: &RelayHandle) {
        use tauri_plugin_store::StoreExt;
        let store = app_handle.store("relay-settings.json").ok();
        let discoverable = store.as_ref()
            .and_then(|s| s.get("discoverable"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let agent_name = store.as_ref()
            .and_then(|s| s.get("directory_agent_name"))
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        let agent_description = store.as_ref()
            .and_then(|s| s.get("directory_agent_description"))
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();

        let _ = handle.update_profile(agent_name, agent_description, discoverable);
    }

    /// Update directory profile on the relay server.
    pub fn update_directory_profile(
        &self,
        agent_name: &str,
        agent_description: &str,
        discoverable: bool,
    ) -> Result<(), RelayError> {
        let handle = self.relay_handle.lock().map_err(|_| lock_err())?
            .clone().ok_or(RelayError::NotActive)?;
        handle.update_profile(agent_name.to_string(), agent_description.to_string(), discoverable)
            .map_err(|e| RelayError::Transport(e.to_string()))
    }

    /// Search peers in the relay server directory.
    pub fn search_directory(
        &self,
        query: &str,
        limit: u32,
        offset: u32,
    ) -> Result<(), RelayError> {
        let handle = self.relay_handle.lock().map_err(|_| lock_err())?
            .clone().ok_or(RelayError::NotActive)?;
        handle.search_directory(query.to_string(), limit, offset)
            .map_err(|e| RelayError::Transport(e.to_string()))
    }

    /// Send a friend request (Introduce) to a peer from the directory.
    /// Creates a local contact with "pending_outgoing" status.
    pub async fn send_friend_request(
        &self,
        app_handle: &tauri::AppHandle,
        target_peer_id: &str,
        target_public_key_b64: &str,
        target_agent_name: &str,
        target_agent_description: &str,
        local_agent_id: Option<&str>,
    ) -> Result<relay_db::ContactRow, RelayError> {
        let db = app_handle.state::<crate::db::Database>();

        // Check if contact already exists
        if let Ok(Some(existing)) = relay_db::get_contact_by_peer_id(&db, target_peer_id) {
            return Ok(existing);
        }

        // Register peer key (indexed by peer_id, not contact UUID)
        let contact_id = uuid::Uuid::new_v4().to_string();
        self.register_peer_key(target_peer_id, target_public_key_b64)?;

        // Create contact with pending_outgoing status
        let now = chrono::Utc::now().to_rfc3339();
        let contact = relay_db::ContactRow {
            id: contact_id.clone(),
            peer_id: target_peer_id.to_string(),
            public_key: target_public_key_b64.to_string(),
            display_name: if target_agent_name.is_empty() {
                format!("Peer {}", &target_peer_id[..8.min(target_peer_id.len())])
            } else {
                target_agent_name.to_string()
            },
            agent_name: target_agent_name.to_string(),
            agent_description: target_agent_description.to_string(),
            local_agent_id: local_agent_id.map(String::from),
            mode: "secretary".to_string(),
            capabilities_json: serde_json::to_string(
                &super::capability::CapabilitySet::deny_all(),
            ).unwrap_or_else(|_| "{}".into()),
            status: "pending_outgoing".to_string(),
            invite_card_raw: None,
            addresses_json: None,
            created_at: now.clone(),
            updated_at: now,
        };

        relay_db::insert_contact(&db, &contact)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        // Build and send Introduce envelope
        let my_public_b64 = B64.encode(self.identity.public_key_bytes());
        let my_agent_name = {
            use tauri_plugin_store::StoreExt;
            app_handle.store("relay-settings.json").ok()
                .and_then(|s| s.get("directory_agent_name"))
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "Agent".to_string())
        };

        let introduce_envelope = Envelope {
            version: 1,
            message_id: uuid::Uuid::new_v4().to_string(),
            correlation_id: None,
            timestamp: chrono::Utc::now().to_rfc3339(),
            sender_agent: my_agent_name.clone(),
            payload: Payload::Introduce {
                agent_name: my_agent_name,
                agent_description: String::new(),
                public_key: my_public_b64,
            },
        };

        // Encrypt and send (use target_peer_id for peer_keys lookup, not contact UUID)
        let msg_id = uuid::Uuid::new_v4().to_string();
        let now_msg = chrono::Utc::now().to_rfc3339();

        match self.send_message(target_peer_id, &introduce_envelope).await {
            Ok(encrypted_json) => {
                // Save outgoing message
                let msg = relay_db::PeerMessageRow {
                    id: msg_id.clone(),
                    thread_id: String::new(),
                    message_id_unique: introduce_envelope.message_id.clone(),
                    correlation_id: None,
                    direction: "outgoing".to_string(),
                    sender_agent: introduce_envelope.sender_agent.clone(),
                    content: "[Introduce]".to_string(),
                    approval_state: "approved".to_string(),
                    delivery_state: "sending".to_string(),
                    retry_count: 0,
                    raw_envelope: Some(encrypted_json),
                    created_at: now_msg.clone(),
                };
                let _ = relay_db::insert_peer_message(&db, &msg);

                // Create outbox entry for retry on failure
                let outbox = relay_db::OutboxRow {
                    id: uuid::Uuid::new_v4().to_string(),
                    peer_message_id: msg_id,
                    target_peer_id: target_peer_id.to_string(),
                    attempts: 0,
                    next_retry_at: None,
                    status: "sending".to_string(),
                    created_at: now_msg,
                };
                let _ = relay_db::insert_outbox(&db, &outbox);
            }
            Err(e) => {
                tracing::warn!("failed to send friend request Introduce: {e}");
                // Save message as queued with outbox for retry
                let encrypted = self.encrypt_for_peer(target_peer_id, &introduce_envelope).ok();
                let msg = relay_db::PeerMessageRow {
                    id: msg_id.clone(),
                    thread_id: String::new(),
                    message_id_unique: introduce_envelope.message_id.clone(),
                    correlation_id: None,
                    direction: "outgoing".to_string(),
                    sender_agent: introduce_envelope.sender_agent.clone(),
                    content: "[Introduce]".to_string(),
                    approval_state: "approved".to_string(),
                    delivery_state: "queued".to_string(),
                    retry_count: 0,
                    raw_envelope: encrypted,
                    created_at: now_msg.clone(),
                };
                let _ = relay_db::insert_peer_message(&db, &msg);
                let outbox = relay_db::OutboxRow {
                    id: uuid::Uuid::new_v4().to_string(),
                    peer_message_id: msg_id,
                    target_peer_id: target_peer_id.to_string(),
                    attempts: 1,
                    next_retry_at: Some((chrono::Utc::now() + chrono::Duration::seconds(30)).to_rfc3339()),
                    status: "pending".to_string(),
                    created_at: now_msg,
                };
                let _ = relay_db::insert_outbox(&db, &outbox);
                tracing::info!("friend request queued for retry: {e}");
            }
        }

        // Subscribe to presence (use target_peer_id, not contact UUID)
        if let Some(h) = self.relay_handle.lock().ok().and_then(|h| h.clone()) {
            if let Ok(relay_pid) = self.peer_id_to_relay_id(target_peer_id) {
                let _ = h.subscribe_presence(vec![relay_pid]);
            }
        }

        Ok(contact)
    }

    // ── Internal: peer index ──

    fn rebuild_peer_index(&self, app_handle: &tauri::AppHandle) -> Result<(), RelayError> {
        let db = app_handle.state::<crate::db::Database>();
        let contacts = relay_db::list_contacts(&db)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        let mut relay_idx = self.relay_id_index.lock().map_err(|_| lock_err())?;
        let mut keys = self.peer_keys.lock().map_err(|_| lock_err())?;
        relay_idx.clear();
        keys.clear();

        for contact in contacts {
            if contact.public_key.is_empty() { continue; }
            if let Ok(pk_bytes) = B64.decode(&contact.public_key) {
                if let Ok(pk) = <[u8; 32]>::try_from(pk_bytes.as_slice()) {
                    let relay_pid = derive_relay_peer_id(&pk);
                    relay_idx.insert(relay_pid.clone(), contact.peer_id.clone());
                    keys.insert(contact.peer_id, (pk, relay_pid));
                }
            }
        }
        Ok(())
    }

    /// Migrate legacy plaintext outbox entries to EncryptedEnvelope format.
    fn migrate_outbox(&self, app_handle: &tauri::AppHandle) {
        let db = app_handle.state::<crate::db::Database>();
        let pending = match relay_db::get_pending_outbox(&db) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in pending {
            let msg = match relay_db::get_peer_message(&db, &entry.peer_message_id) {
                Ok(Some(m)) => m,
                _ => continue,
            };

            let raw = match msg.raw_envelope.as_deref() {
                Some(r) if !r.is_empty() => r,
                _ => continue,
            };

            // Skip if already encrypted (has encrypted_payload field)
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
                if val.get("encrypted_payload").is_some() {
                    continue; // Already encrypted
                }
            }

            // Try to re-encrypt the plaintext envelope
            let envelope: Envelope = match serde_json::from_str(raw) {
                Ok(e) => e,
                Err(_) => {
                    let _ = relay_db::update_outbox_status(&db, &entry.id, "failed", entry.attempts);
                    continue;
                }
            };

            match self.encrypt_for_peer(&entry.target_peer_id, &envelope) {
                Ok(encrypted_json) => {
                    // Update raw_envelope with encrypted version
                    let _ = relay_db::update_message_state(&db, &entry.peer_message_id, None, None);
                    let _ = relay_db::update_message_raw_envelope(&db, &entry.peer_message_id, &encrypted_json);
                }
                Err(_) => {
                    let _ = relay_db::update_outbox_status(&db, &entry.id, "failed", entry.attempts);
                }
            }
        }
    }

    // ── Internal: event loop ──

    async fn run_event_loop(
        &self,
        mut event_rx: mpsc::UnboundedReceiver<RelayEvent>,
        app_handle: &tauri::AppHandle,
    ) {
        while let Some(event) = event_rx.recv().await {
            match event {
                RelayEvent::Envelope { sender_peer_id, envelope } => {
                    self.handle_incoming_envelope(app_handle, &sender_peer_id, envelope).await;
                }
                RelayEvent::ServerAck { message_id, status } => {
                    let state = match status {
                        wa_shared::protocol::AckStatus::Delivered => "sent",
                        wa_shared::protocol::AckStatus::Queued => "queued",
                    };
                    // Update outbox/message state in DB
                    let db = app_handle.state::<crate::db::Database>();
                    if let Ok(Some(msg)) = relay_db::get_message_by_unique_id(&db, &message_id) {
                        if let Ok(Some(outbox)) = relay_db::get_outbox_by_message_id(&db, &msg.id) {
                            let _ = relay_db::update_outbox_status(&db, &outbox.id, state, outbox.attempts);
                        }
                        let _ = relay_db::update_message_state(&db, &msg.id, None, Some(state));
                    }
                    let _ = app_handle.emit("relay:delivery-update", serde_json::json!({
                        "message_id": message_id, "state": state,
                    }));
                }
                RelayEvent::PeerAck { message_id } => {
                    // Update delivery_state in DB
                    let db = app_handle.state::<crate::db::Database>();
                    if let Ok(Some(msg)) = relay_db::get_message_by_unique_id(&db, &message_id) {
                        let _ = relay_db::update_message_state(&db, &msg.id, None, Some("delivered"));
                        if let Ok(Some(outbox)) = relay_db::get_outbox_by_message_id(&db, &msg.id) {
                            let _ = relay_db::update_outbox_status(&db, &outbox.id, "delivered", outbox.attempts);
                        }
                    }
                    let _ = app_handle.emit("relay:delivery-update", serde_json::json!({
                        "message_id": message_id, "state": "delivered",
                    }));
                }
                RelayEvent::Presence { peer_id: relay_pid, status, .. } => {
                    // Map relay ID back to DB peer_id for UI compatibility
                    let db_pid = self.relay_id_index.lock().ok()
                        .and_then(|idx| idx.get(&relay_pid).cloned())
                        .unwrap_or_else(|| relay_pid.clone());
                    self.peer_presence.write().await.insert(db_pid.clone(), status.clone());
                    let _ = app_handle.emit("relay:presence", serde_json::json!({
                        "peer_id": db_pid,
                        "status": format!("{status:?}").to_lowercase(),
                    }));
                }
                RelayEvent::PresenceSnapshot { peers } => {
                    let mut presence = self.peer_presence.write().await;
                    let idx = self.relay_id_index.lock().ok();
                    for p in &peers {
                        let db_pid = idx.as_ref()
                            .and_then(|i| i.get(&p.peer_id).cloned())
                            .unwrap_or_else(|| p.peer_id.clone());
                        presence.insert(db_pid.clone(), p.status.clone());
                        let _ = app_handle.emit("relay:presence", serde_json::json!({
                            "peer_id": db_pid,
                            "status": format!("{:?}", p.status).to_lowercase(),
                        }));
                    }
                }
                RelayEvent::Connected => {
                    // Restore Active status (may have been Reconnecting)
                    if let Ok(mut st) = self.status.lock() {
                        *st = NetworkStatus::Active;
                    }
                    let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
                        status: "active".into(), peer_count: 0,
                    });
                    // Re-subscribe presence for known peers
                    if let Some(h) = self.relay_handle.lock().ok().and_then(|h| h.clone()) {
                        let relay_ids: Vec<String> = self.relay_id_index.lock()
                            .map(|idx| idx.keys().cloned().collect())
                            .unwrap_or_default();
                        if !relay_ids.is_empty() {
                            let _ = h.subscribe_presence(relay_ids);
                        }
                        // Auto-register directory profile
                        self.auto_register_profile(app_handle, &h);
                    }
                    // Retry pending outbox on reconnect (includes any pending Introduce messages)
                    self.process_pending_outbox_internal(app_handle).await;
                }
                RelayEvent::Disconnected { will_reconnect } => {
                    // Clear all peer presence on any disconnect
                    {
                        let peers: Vec<String> = self.peer_presence.read().await.keys().cloned().collect();
                        self.peer_presence.write().await.clear();
                        for pid in peers {
                            let _ = app_handle.emit("relay:presence", serde_json::json!({
                                "peer_id": pid, "status": "offline",
                            }));
                        }
                    }
                    if will_reconnect {
                        if let Ok(mut st) = self.status.lock() {
                            *st = NetworkStatus::Reconnecting;
                        }
                        let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
                            status: "reconnecting".into(), peer_count: 0,
                        });
                    } else {
                        if let Ok(mut st) = self.status.lock() {
                            *st = NetworkStatus::Dormant;
                        }
                        let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
                            status: "dormant".into(), peer_count: 0,
                        });
                        break;
                    }
                }
                RelayEvent::ProfileUpdated { discoverable } => {
                    let _ = app_handle.emit("relay:profile-updated", serde_json::json!({
                        "discoverable": discoverable,
                    }));
                }
                RelayEvent::DirectoryResult { query, peers, total, offset } => {
                    let _ = app_handle.emit("relay:directory-result", serde_json::json!({
                        "query": query,
                        "peers": peers,
                        "total": total,
                        "offset": offset,
                    }));
                }
                RelayEvent::PeerProfileResult { peer } => {
                    let _ = app_handle.emit("relay:peer-profile", serde_json::json!({
                        "peer": peer,
                    }));
                }
                RelayEvent::Error { code, message } => {
                    tracing::warn!(code = %code, message = %message, "relay error");
                    let _ = app_handle.emit("relay:error", serde_json::json!({
                        "code": code,
                        "message": message,
                    }));
                }
            }
        }
    }

    async fn handle_incoming_envelope(
        &self,
        app_handle: &tauri::AppHandle,
        sender_relay_peer_id: &str,
        envelope_json: serde_json::Value,
    ) {
        // Parse EncryptedEnvelope
        let encrypted: EncryptedEnvelope = match serde_json::from_value(envelope_json) {
            Ok(e) => e,
            Err(e) => { tracing::warn!("bad encrypted envelope: {e}"); return; }
        };

        // Get receiver's secret key
        let secret_vec = self.identity.secret_bytes();
        let secret: [u8; 32] = match secret_vec.try_into() {
            Ok(arr) => arr,
            Err(_) => { tracing::error!("failed to get identity secret"); return; }
        };

        // Sender's X25519 public key from envelope
        let sender_x25519: [u8; 32] = match encrypted.sender_x25519_public.as_slice().try_into() {
            Ok(arr) => arr,
            Err(_) => { tracing::warn!("invalid sender_x25519_public"); return; }
        };
        let nonce: [u8; 12] = match encrypted.nonce.as_slice().try_into() {
            Ok(arr) => arr,
            Err(_) => { tracing::warn!("invalid nonce"); return; }
        };

        // Decrypt
        let plaintext = match crypto::decrypt_payload(
            &secret, &sender_x25519, &encrypted.header, &encrypted.encrypted_payload, &nonce,
        ) {
            Ok(pt) => pt,
            Err(e) => { tracing::warn!("decryption failed: {e}"); return; }
        };

        // Parse plaintext Envelope
        let envelope: Envelope = match serde_json::from_slice(&plaintext) {
            Ok(e) => e,
            Err(e) => { tracing::warn!("bad decrypted envelope: {e}"); return; }
        };

        // Resolve DB peer_id
        let db_peer_id = self.relay_id_index.lock().ok()
            .and_then(|idx| idx.get(sender_relay_peer_id).cloned());

        let db = app_handle.state::<crate::db::Database>();

        // Handle Introduce from unknown peer
        if db_peer_id.is_none() {
            if let Payload::Introduce { ref agent_name, ref agent_description, ref public_key } = envelope.payload {
                self.handle_introduce(
                    app_handle, &db, sender_relay_peer_id, agent_name, agent_description, public_key, &encrypted,
                );
                // Send peer ACK
                if let Some(h) = self.relay_handle.lock().ok().and_then(|h| h.clone()) {
                    let _ = h.send_peer_ack(&encrypted.header.message_id, sender_relay_peer_id);
                }
                return;
            }
            tracing::warn!("message from unknown peer {sender_relay_peer_id}");
            return;
        }

        let contact_peer_id = db_peer_id.unwrap();

        // Introduce from already-known peer: if we sent a friend request (pending_outgoing),
        // auto-transition to accepted.
        if matches!(envelope.payload, Payload::Introduce { .. }) {
            if let Ok(Some(contact)) = relay_db::get_contact_by_peer_id(&db, &contact_peer_id) {
                if contact.status == "pending_outgoing" {
                    let _ = relay_db::update_contact(&db, &contact.id, relay_db::ContactUpdate {
                        status: Some("accepted".to_string()),
                        capabilities_json: Some(
                            serde_json::to_string(&super::capability::CapabilitySet::default_phase1())
                                .unwrap_or_else(|_| "{}".into()),
                        ),
                        ..Default::default()
                    });
                    let _ = app_handle.emit("relay:contact-accepted", serde_json::json!({
                        "contact_id": contact.id,
                        "peer_id": contact_peer_id,
                    }));
                    tracing::info!(peer_id = %contact_peer_id, "friend request accepted (pending_outgoing → accepted)");
                }
            }
            if let Some(h) = self.relay_handle.lock().ok().and_then(|h| h.clone()) {
                let _ = h.send_peer_ack(&encrypted.header.message_id, sender_relay_peer_id);
            }
            return;
        }

        // Verify sender's X25519 public key matches their registered Ed25519 key
        if let Some((ed25519_pub, _)) = self.peer_keys.lock().ok()
            .and_then(|keys| keys.get(&contact_peer_id).cloned())
        {
            let expected_x25519 = crypto::ed25519_public_to_x25519(&ed25519_pub);
            if sender_x25519 != expected_x25519 {
                tracing::warn!(
                    peer_id = %contact_peer_id,
                    "X25519 public key mismatch — rejecting message"
                );
                return;
            }
        }

        // Delegate to secretary for MessageRequest handling
        if let Err(e) = super::secretary::handle_incoming_message(
            app_handle, &db, &contact_peer_id, &envelope,
        ).await {
            tracing::warn!("secretary error: {e}");
        }

        // Send peer ACK
        if let Some(h) = self.relay_handle.lock().ok().and_then(|h| h.clone()) {
            let _ = h.send_peer_ack(&encrypted.header.message_id, sender_relay_peer_id);
        }
    }

    /// Resend Introduce to accepted contacts that have invite_card_raw set
    /// (i.e., contacts whose invite we accepted). This ensures the remote peer
    /// Re-process pending outbox entries (called on reconnect).
    async fn process_pending_outbox_internal(&self, app_handle: &tauri::AppHandle) {
        let db = app_handle.state::<crate::db::Database>();
        let pending = match relay_db::get_pending_outbox(&db) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in pending {
            if let Some(ref next_retry) = entry.next_retry_at {
                if let Ok(retry_time) = chrono::DateTime::parse_from_rfc3339(next_retry) {
                    if retry_time > chrono::Utc::now() {
                        continue;
                    }
                }
            }

            let msg = match relay_db::get_peer_message(&db, &entry.peer_message_id) {
                Ok(Some(m)) => m,
                _ => continue,
            };

            let raw = match msg.raw_envelope.as_deref() {
                Some(r) if !r.is_empty() => r,
                _ => continue,
            };

            // Ensure we have encrypted JSON
            let encrypted_json = if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
                if val.get("encrypted_payload").is_some() {
                    raw.to_string()
                } else {
                    let envelope: super::envelope::Envelope = match serde_json::from_str(raw) {
                        Ok(e) => e,
                        Err(_) => continue,
                    };
                    match self.encrypt_for_peer(&entry.target_peer_id, &envelope) {
                        Ok(enc) => {
                            let _ = relay_db::update_message_raw_envelope(&db, &entry.peer_message_id, &enc);
                            enc
                        }
                        Err(_) => continue,
                    }
                }
            } else {
                continue;
            };

            match self.send_raw_envelope(&entry.target_peer_id, &encrypted_json).await {
                Ok(()) => {
                    let _ = relay_db::update_message_state(&db, &entry.peer_message_id, None, Some("sending"));
                    let _ = relay_db::update_outbox_status(&db, &entry.id, "sending", entry.attempts);
                }
                Err(_) => {
                    let new_attempts = entry.attempts + 1;
                    let _ = relay_db::update_message_state(&db, &entry.peer_message_id, None, Some("queued"));
                    let backoff_secs = 30i64 * (1i64 << (new_attempts - 1).min(4));
                    let next_retry = chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
                    let _ = relay_db::update_outbox_retry(&db, &entry.id, new_attempts, &next_retry.to_rfc3339());
                }
            }
        }
    }

    fn handle_introduce(
        &self,
        app_handle: &tauri::AppHandle,
        db: &crate::db::Database,
        sender_relay_peer_id: &str,
        agent_name: &str,
        agent_description: &str,
        public_key_b64: &str,
        _encrypted: &EncryptedEnvelope,
    ) {
        // Verify: derive relay_peer_id from provided public_key and check it matches
        let pk_bytes = match B64.decode(public_key_b64) {
            Ok(b) if b.len() == 32 => b,
            _ => {
                tracing::warn!("Introduce: invalid public key");
                return;
            }
        };
        let pk: [u8; 32] = pk_bytes.try_into().unwrap();
        let derived_relay_pid = derive_relay_peer_id(&pk);
        if derived_relay_pid != sender_relay_peer_id {
            tracing::warn!("Introduce: peer_id/public_key mismatch");
            return;
        }

        // Check if contact already exists
        if relay_db::get_contact_by_peer_id(db, sender_relay_peer_id).ok().flatten().is_some() {
            return; // Already known
        }

        // Create contact with pending_approval status
        let now = chrono::Utc::now().to_rfc3339();
        let contact = relay_db::ContactRow {
            id: uuid::Uuid::new_v4().to_string(),
            peer_id: sender_relay_peer_id.to_string(),
            public_key: public_key_b64.to_string(),
            display_name: if agent_name.is_empty() {
                format!("Peer {}", &sender_relay_peer_id[..8.min(sender_relay_peer_id.len())])
            } else {
                agent_name.to_string()
            },
            agent_name: agent_name.to_string(),
            agent_description: agent_description.to_string(),
            local_agent_id: None,
            mode: "secretary".to_string(),
            capabilities_json: serde_json::to_string(
                &super::capability::CapabilitySet::deny_all(),
            ).unwrap_or_else(|_| "{}".into()),
            status: "pending_approval".to_string(),
            invite_card_raw: None,
            addresses_json: None,
            created_at: now.clone(),
            updated_at: now,
        };

        if let Err(e) = relay_db::insert_contact(db, &contact) {
            tracing::warn!("failed to auto-register peer: {e}");
            return;
        }

        // Update indexes
        let _ = self.register_peer_key(sender_relay_peer_id, public_key_b64);

        // Notify frontend
        let _ = app_handle.emit("relay:approval-needed", serde_json::json!({
            "peer_id": sender_relay_peer_id,
            "agent_name": agent_name,
            "agent_description": agent_description,
            "type": "introduce",
        }));

        tracing::info!(peer_id = sender_relay_peer_id, "auto-registered peer via Introduce");
    }
}

fn lock_err() -> RelayError {
    RelayError::Transport("lock poisoned".into())
}
