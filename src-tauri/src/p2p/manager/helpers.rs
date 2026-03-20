use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use libp2p::PeerId;
use tauri::{Emitter, Manager};

use super::super::envelope::Envelope;
use super::{IncomingMessageEvent, PeerConnectedEvent};

// -----------------------------------------------------------------------
// Auto-registration of unknown peers after successful handshake
// -----------------------------------------------------------------------

/// Auto-register a peer that completed a valid handshake but wasn't in known_peers.
/// This handles the case where someone accepted our invite and connected to us.
pub(crate) fn auto_register_peer(
    app_handle: &tauri::AppHandle,
    peer_str: &str,
    known_peers: &Arc<Mutex<HashSet<String>>>,
) {
    // Check if already known
    let already_known = known_peers.lock().map(|g| g.contains(peer_str)).unwrap_or(true);
    if already_known {
        return;
    }

    // Add to known_peers
    if let Ok(mut kp) = known_peers.lock() {
        kp.insert(peer_str.to_string());
    }

    // Create contact in DB
    let db = app_handle.state::<crate::db::Database>();
    if crate::p2p::db::get_contact_by_peer_id(&db, peer_str).ok().flatten().is_some() {
        return; // already in DB
    }

    let now = chrono::Utc::now().to_rfc3339();
    let contact = crate::p2p::db::ContactRow {
        id: uuid::Uuid::new_v4().to_string(),
        peer_id: peer_str.to_string(),
        public_key: String::new(), // filled from handshake data if available
        display_name: format!("Peer {}", &peer_str[..8.min(peer_str.len())]),
        agent_name: String::new(),
        agent_description: String::new(),
        local_agent_id: None,
        mode: "secretary".to_string(),
        capabilities_json: serde_json::to_string(&crate::p2p::capability::CapabilitySet::default_phase1())
            .unwrap_or_default(),
        status: "accepted".to_string(),
        invite_card_raw: None,
        addresses_json: None,
        created_at: now.clone(),
        updated_at: now,
    };

    if let Err(e) = crate::p2p::db::insert_contact(&db, &contact) {
        tracing::warn!(error = %e, "Failed to auto-register peer contact");
    } else {
        tracing::info!(peer = %peer_str, "Auto-registered peer after handshake");
    }
}

// -----------------------------------------------------------------------
// Handshake / message helpers
// -----------------------------------------------------------------------

/// Emit `p2p:peer-connected` and look up the contact display name.
pub(crate) fn emit_peer_connected(
    swarm: &mut libp2p::Swarm<super::super::protocol::AgentBehaviour>,
    app_handle: &tauri::AppHandle,
    peer_str: &str,
) {
    let _ = swarm; // used only for consistency in call-sites
    let contact_name = {
        let db = app_handle.state::<crate::db::Database>();
        crate::p2p::db::get_contact_by_peer_id(&db, peer_str)
            .ok()
            .flatten()
            .map(|c| c.display_name)
            .unwrap_or_default()
    };
    let _ = app_handle.emit(
        "p2p:peer-connected",
        PeerConnectedEvent {
            peer_id: peer_str.to_string(),
            contact_name,
        },
    );
}

/// Persist an incoming `MessageResponse` as a peer message and emit event.
pub(crate) fn persist_incoming_response(
    app_handle: &tauri::AppHandle,
    db: &crate::db::Database,
    peer_str: &str,
    envelope: &Envelope,
    content: &str,
) {
    // Look up contact to find thread
    let contact = match crate::p2p::db::get_contact_by_peer_id(db, peer_str) {
        Ok(Some(c)) => c,
        _ => {
            tracing::warn!(peer = %peer_str, "P2P MessageResponse from unknown contact");
            return;
        }
    };

    // Find existing thread (there should be one if we sent a request)
    let threads = match crate::p2p::db::list_threads_for_contact(db, &contact.id) {
        Ok(t) => t,
        Err(_) => return,
    };
    let thread_id = match threads.first() {
        Some(t) => t.id.clone(),
        None => {
            tracing::warn!(contact_id = %contact.id, "P2P no thread found for contact");
            return;
        }
    };

    let now = chrono::Utc::now().to_rfc3339();
    let msg_id = uuid::Uuid::new_v4().to_string();
    let raw_envelope = serde_json::to_string(envelope).ok();

    let msg = crate::p2p::db::PeerMessageRow {
        id: msg_id.clone(),
        thread_id,
        message_id_unique: envelope.message_id.clone(),
        correlation_id: envelope.correlation_id.clone(),
        direction: "incoming".to_string(),
        sender_agent: envelope.sender_agent.clone(),
        content: content.to_string(),
        approval_state: "none".to_string(),
        delivery_state: "received".to_string(),
        retry_count: 0,
        raw_envelope,
        created_at: now,
    };

    if let Err(e) = crate::p2p::db::insert_peer_message(db, &msg) {
        tracing::error!(error = %e, "P2P failed to persist MessageResponse");
        return;
    }

    let _ = app_handle.emit(
        "p2p:incoming-message",
        IncomingMessageEvent {
            peer_id: peer_str.to_string(),
            envelope: envelope.clone(),
        },
    );
}

// -----------------------------------------------------------------------
// Retry helpers
// -----------------------------------------------------------------------

/// Retry queued messages for a specific peer (called on handshake completion).
pub(crate) fn retry_queued_for_peer(
    swarm: &mut libp2p::Swarm<super::super::protocol::AgentBehaviour>,
    app_handle: &tauri::AppHandle,
    peer_id_str: &str,
) {
    let db = app_handle.state::<crate::db::Database>();
    let entries = match crate::p2p::db::get_pending_outbox(&db) {
        Ok(e) => e,
        Err(_) => return,
    };

    const MAX_RETRY_ATTEMPTS: i32 = 10;

    for entry in entries {
        if entry.target_peer_id != peer_id_str {
            continue;
        }

        // Enforce max retry limit (same as periodic retry)
        if entry.attempts >= MAX_RETRY_ATTEMPTS {
            let _ = crate::p2p::db::update_outbox_status(&db, &entry.id, "failed", entry.attempts);
            let _ = crate::p2p::db::update_message_state(&db, &entry.peer_message_id, None, Some("failed"));
            let _ = app_handle.emit(
                "p2p:delivery-update",
                super::super::secretary::DeliveryUpdate {
                    message_id: entry.peer_message_id.clone(),
                    state: "failed".to_string(),
                },
            );
            continue;
        }

        let msg = match crate::p2p::db::get_peer_message(&db, &entry.peer_message_id) {
            Ok(Some(m)) => m,
            _ => continue,
        };

        let envelope = match msg
            .raw_envelope
            .as_ref()
            .and_then(|raw| serde_json::from_str::<Envelope>(raw).ok())
        {
            Some(e) => e,
            None => continue,
        };

        let peer_id: PeerId = match entry.target_peer_id.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        swarm
            .behaviour_mut()
            .request_response
            .send_request(&peer_id, envelope);

        // Only update status to "sending" — don't increment attempts here.
        // Attempts are incremented in OutboundFailure handler (the actual failure point).
        let _ = crate::p2p::db::update_message_state(
            &db,
            &entry.peer_message_id,
            None,
            Some("sending"),
        );
        let _ =
            crate::p2p::db::update_outbox_status(&db, &entry.id, "sending", entry.attempts);
    }
}

/// Periodic retry of pending outbox entries (called every 60s).
pub(crate) fn retry_pending_outbox(
    swarm: &mut libp2p::Swarm<super::super::protocol::AgentBehaviour>,
    app_handle: &tauri::AppHandle,
    authenticated_peers: &HashSet<String>,
) {
    let db = app_handle.state::<crate::db::Database>();
    let entries = match crate::p2p::db::get_pending_outbox(&db) {
        Ok(e) => e,
        Err(_) => return,
    };

    let now = chrono::Utc::now();

    const MAX_RETRY_ATTEMPTS: i32 = 10;

    const SENDING_STALE_SECS: i64 = 60;

    for entry in entries {
        // Max retry limit — checked first for all statuses including stale "sending"
        if entry.attempts >= MAX_RETRY_ATTEMPTS {
            let _ = crate::p2p::db::update_outbox_status(&db, &entry.id, "failed", entry.attempts);
            let _ = crate::p2p::db::update_message_state(&db, &entry.peer_message_id, None, Some("failed"));
            let _ = app_handle.emit(
                "p2p:delivery-update",
                super::super::secretary::DeliveryUpdate {
                    message_id: entry.peer_message_id.clone(),
                    state: "failed".to_string(),
                },
            );
            continue;
        }

        // Requeue stale "sending" entries (e.g. error response with no ACK/failure)
        if entry.status == "sending" {
            let sent_at = entry.next_retry_at.as_deref().unwrap_or(&entry.created_at);
            if let Ok(sent_time) = chrono::DateTime::parse_from_rfc3339(sent_at) {
                let age = (now - sent_time.with_timezone(&chrono::Utc)).num_seconds();
                if age > SENDING_STALE_SECS {
                    let new_attempts = entry.attempts + 1;
                    let backoff_secs = 30i64 * (1i64 << (new_attempts - 1).min(4));
                    let next_retry = now + chrono::Duration::seconds(backoff_secs);
                    let _ = crate::p2p::db::update_outbox_retry(&db, &entry.id, new_attempts, &next_retry.to_rfc3339());
                    let _ = crate::p2p::db::update_message_state(&db, &entry.peer_message_id, None, Some("queued"));
                }
            }
            continue;
        }

        // Only retry for authenticated peers
        if !authenticated_peers.contains(&entry.target_peer_id) {
            continue;
        }

        // Check if retry time has passed
        if let Some(ref next_retry) = entry.next_retry_at {
            if let Ok(retry_time) = chrono::DateTime::parse_from_rfc3339(next_retry) {
                if retry_time > now {
                    continue;
                }
            }
        }

        let msg = match crate::p2p::db::get_peer_message(&db, &entry.peer_message_id) {
            Ok(Some(m)) => m,
            _ => continue,
        };

        let envelope = match msg
            .raw_envelope
            .as_ref()
            .and_then(|raw| serde_json::from_str::<Envelope>(raw).ok())
        {
            Some(e) => e,
            None => continue,
        };

        let peer_id: PeerId = match entry.target_peer_id.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        swarm
            .behaviour_mut()
            .request_response
            .send_request(&peer_id, envelope);

        // Only update status to "sending" — don't increment attempts here.
        // Attempts are incremented in OutboundFailure handler (the actual failure point).
        let _ = crate::p2p::db::update_message_state(
            &db,
            &entry.peer_message_id,
            None,
            Some("sending"),
        );
        let _ =
            crate::p2p::db::update_outbox_status(&db, &entry.id, "sending", entry.attempts);
    }
}
