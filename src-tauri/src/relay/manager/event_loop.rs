//! Event loop: incoming message handling, envelope decryption, presence tracking.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

use wa_shared::encrypted_envelope::EncryptedEnvelope;

use super::{ConnectionStateEvent, NetworkStatus, RelayManager};
use crate::relay::crypto;
use crate::relay::db as relay_db;
use crate::relay::envelope::{Envelope, Payload};
use crate::relay::relay_client::{derive_relay_peer_id, RelayEvent, RelayHandle};

impl RelayManager {
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

    pub(crate) async fn run_event_loop(
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
                            serde_json::to_string(&crate::relay::capability::CapabilitySet::default_phase1())
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
        if let Err(e) = crate::relay::secretary::handle_incoming_message(
            app_handle, &db, &contact_peer_id, &envelope,
        ).await {
            tracing::warn!("secretary error: {e}");
        }

        // Send peer ACK
        if let Some(h) = self.relay_handle.lock().ok().and_then(|h| h.clone()) {
            let _ = h.send_peer_ack(&encrypted.header.message_id, sender_relay_peer_id);
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
                &crate::relay::capability::CapabilitySet::deny_all(),
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
