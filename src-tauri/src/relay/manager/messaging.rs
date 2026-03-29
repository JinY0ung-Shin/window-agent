//! Encryption, message sending, friend requests, and outbox management.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tauri::Manager;

use wa_shared::encrypted_envelope::{EncryptedEnvelope, EnvelopeHeader};

use super::{lock_err, RelayError, RelayManager};
use crate::relay::crypto;
use crate::relay::db as relay_db;
use crate::relay::envelope::{Envelope, Payload};

impl RelayManager {
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
                &crate::relay::capability::CapabilitySet::deny_all(),
            ).unwrap_or_else(|_| "{}".into()),
            status: "pending_outgoing".to_string(),
            invite_card_raw: None,
            addresses_json: None,
            published_agents_json: None,
            created_at: now.clone(),
            updated_at: now,
        };

        relay_db::insert_contact(&db, &contact)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        // Build and send Introduce envelope
        let my_public_b64 = B64.encode(self.identity.public_key_bytes());
        let my_agent_name = {
            use tauri::Manager;
            let name = app_handle.state::<crate::settings::AppSettings>().get().directory_agent_name;
            if name.is_empty() { "Agent".to_string() } else { name }
        };

        // Include published agents list
        let published_agents = {
            let visible = crate::db::agent_operations::list_network_visible_agents_impl(&db).ok();
            visible.map(|agents| agents.into_iter().map(|a| wa_shared::protocol::PublishedAgent {
                agent_id: a.id,
                name: a.name,
                description: a.description,
            }).collect::<Vec<_>>())
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
                published_agents,
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
                    target_agent_id: None,
                    responding_agent_id: None,
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
                    target_agent_id: None,
                    responding_agent_id: None,
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

    /// Migrate legacy plaintext outbox entries to EncryptedEnvelope format.
    pub(crate) fn migrate_outbox(&self, app_handle: &tauri::AppHandle) {
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

    /// Re-process pending outbox entries (called on reconnect).
    pub(crate) async fn process_pending_outbox_internal(&self, app_handle: &tauri::AppHandle) {
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
                    let envelope: Envelope = match serde_json::from_str(raw) {
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
}
