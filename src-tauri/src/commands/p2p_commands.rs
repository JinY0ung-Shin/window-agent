use crate::db::Database;
use crate::error::AppError;
use crate::p2p::capability::CapabilitySet;
use crate::p2p::db as p2p_db;
use crate::p2p::envelope::{Envelope, Payload};
use crate::p2p::identity::NodeIdentity;
use crate::p2p::invite;
use crate::p2p::manager::P2PManager;
use crate::p2p::secretary;
use tauri::State;

// ── Lifecycle commands ──

#[tauri::command]
pub async fn p2p_start(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
) -> Result<(), AppError> {
    // Load known peers from contacts DB before starting
    let contacts = p2p_db::list_contacts(&db).map_err(|e| AppError::P2p(e.to_string()))?;
    let peer_ids: std::collections::HashSet<String> =
        contacts.into_iter().map(|c| c.peer_id).collect();
    manager.set_known_peers(peer_ids).map_err(|e| AppError::P2p(e.to_string()))?;

    manager
        .start(app.clone())
        .await
        .map_err(|e| AppError::P2p(e.to_string()))?;

    // Process pending outbox entries on startup
    process_pending_outbox(&db, &manager).await;

    Ok(())
}

#[tauri::command]
pub async fn p2p_stop(manager: State<'_, P2PManager>) -> Result<(), AppError> {
    manager.stop().await.map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub fn p2p_status(manager: State<'_, P2PManager>) -> Result<String, AppError> {
    Ok(format!("{:?}", manager.status().map_err(|e| AppError::P2p(e.to_string()))?).to_lowercase())
}

#[tauri::command]
pub fn p2p_get_peer_id(manager: State<'_, P2PManager>) -> Result<String, AppError> {
    Ok(manager.peer_id().map_err(|e| AppError::P2p(e.to_string()))?.to_string())
}

// ── Invite commands ──

/// Validate and sanitize multiaddr strings, stripping only a trailing /p2p/ suffix.
fn validate_multiaddrs(addresses: Vec<String>) -> Result<Vec<String>, AppError> {
    addresses
        .into_iter()
        .map(|raw| {
            let addr: libp2p::Multiaddr = raw
                .parse()
                .map_err(|_| AppError::Validation(format!("Invalid multiaddr: {}", raw)))?;
            // Strip only a trailing /p2p/<peer_id> suffix
            let protos: Vec<libp2p::multiaddr::Protocol> = addr.iter().collect();
            let stripped: libp2p::Multiaddr = if protos.last().is_some_and(|p| matches!(p, libp2p::multiaddr::Protocol::P2p(_))) {
                protos[..protos.len() - 1].iter().cloned().collect()
            } else {
                addr
            };
            if stripped.iter().next().is_none() {
                return Err(AppError::Validation(format!("Address is empty after stripping /p2p/: {}", raw)));
            }
            Ok(stripped.to_string())
        })
        .collect()
}

#[tauri::command]
pub fn p2p_generate_invite(
    identity: State<'_, NodeIdentity>,
    agent_name: String,
    agent_description: String,
    addresses: Vec<String>,
    expiry_hours: Option<u64>,
) -> Result<String, AppError> {
    let validated = validate_multiaddrs(addresses)?;
    invite::generate_invite(&identity, validated, agent_name, agent_description, expiry_hours)
        .map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub async fn p2p_accept_invite(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    code: String,
    local_agent_id: Option<String>,
) -> Result<p2p_db::ContactRow, AppError> {
    let card = invite::parse_invite(&code).map_err(|e| AppError::P2p(e.to_string()))?;

    // Serialize addresses from ContactCard as JSON array
    let addresses_json = if card.addresses.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&card.addresses).unwrap_or_default())
    };

    // Check if a contact with this peer_id already exists
    let contact = if let Some(existing) =
        p2p_db::get_contact_by_peer_id(&db, &card.peer_id).map_err(|e| AppError::P2p(e.to_string()))?
    {
        // Update existing contact — always set addresses_json (Some(None) clears it)
        let mut update = p2p_db::ContactUpdate {
            agent_name: Some(card.agent_name.clone()),
            agent_description: Some(card.agent_description.clone()),
            addresses_json: Some(addresses_json.clone()),
            ..Default::default()
        };
        if let Some(ref aid) = local_agent_id {
            update.local_agent_id = Some(Some(aid.clone()));
        }
        p2p_db::update_contact(&db, &existing.id, update).map_err(|e| AppError::P2p(e.to_string()))?;
        // Update invite_card_raw directly (not in ContactUpdate)
        db.with_conn(|conn| {
            conn.execute(
                "UPDATE contacts SET invite_card_raw = ?1 WHERE id = ?2",
                rusqlite::params![code, existing.id],
            )?;
            Ok(())
        })
        .map_err(|e| AppError::P2p(e.to_string()))?;
        // Re-fetch to return fresh data
        p2p_db::get_contact(&db, &existing.id)
            .map_err(|e| AppError::P2p(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("Contact disappeared after update".into()))?
    } else {
        // Insert new contact
        let now = chrono::Utc::now().to_rfc3339();
        let contact = p2p_db::ContactRow {
            id: uuid::Uuid::new_v4().to_string(),
            peer_id: card.peer_id.clone(),
            public_key: base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                &card.public_key,
            ),
            display_name: card.agent_name.clone(),
            agent_name: card.agent_name.clone(),
            agent_description: card.agent_description.clone(),
            local_agent_id,
            mode: "secretary".to_string(),
            capabilities_json: serde_json::to_string(&CapabilitySet::default_phase1())
                .unwrap_or_default(),
            status: "pending".to_string(),
            invite_card_raw: Some(code),
            addresses_json,
            created_at: now.clone(),
            updated_at: now,
        };
        p2p_db::insert_contact(&db, &contact).map_err(|e| AppError::P2p(e.to_string()))?;
        contact
    };

    // Update known peers set so the new contact can communicate immediately
    manager.add_known_peer(contact.peer_id.clone()).map_err(|e| AppError::P2p(e.to_string()))?;

    // Best-effort dial if addresses are available
    if !card.addresses.is_empty() {
        let addrs: Vec<libp2p::Multiaddr> = card
            .addresses
            .iter()
            .filter_map(|a| a.parse().ok())
            .collect();
        if !addrs.is_empty() {
            if let Ok(peer_id) = contact.peer_id.parse::<libp2p::PeerId>() {
                let _ = manager.dial(peer_id, addrs).await;
            }
        }
    }

    Ok(contact)
}

// ── Contact commands ──

#[tauri::command]
pub fn p2p_list_contacts(db: State<'_, Database>) -> Result<Vec<p2p_db::ContactRow>, AppError> {
    p2p_db::list_contacts(&db).map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub fn p2p_update_contact(
    db: State<'_, Database>,
    id: String,
    display_name: Option<String>,
    local_agent_id: Option<String>,
    mode: Option<String>,
) -> Result<(), AppError> {
    let update = p2p_db::ContactUpdate {
        display_name,
        local_agent_id: local_agent_id.map(Some),
        mode,
        ..Default::default()
    };
    p2p_db::update_contact(&db, &id, update).map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub fn p2p_remove_contact(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    id: String,
) -> Result<(), AppError> {
    // Look up contact to get peer_id before deleting
    if let Ok(Some(contact)) = p2p_db::get_contact(&db, &id) {
        manager.remove_known_peer(&contact.peer_id).map_err(|e| AppError::P2p(e.to_string()))?;
    }
    p2p_db::delete_contact(&db, &id).map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub fn p2p_bind_agent(
    db: State<'_, Database>,
    contact_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    let update = p2p_db::ContactUpdate {
        local_agent_id: Some(Some(agent_id)),
        ..Default::default()
    };
    p2p_db::update_contact(&db, &contact_id, update).map_err(|e| AppError::P2p(e.to_string()))
}

// ── Messaging commands ──

#[tauri::command]
pub async fn p2p_send_message(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    contact_id: String,
    content: String,
) -> Result<(), AppError> {
    // 1. Look up contact
    let contact = p2p_db::get_contact(&db, &contact_id)
        .map_err(|e| AppError::P2p(e.to_string()))?
        .ok_or_else(|| AppError::NotFound(format!("Contact not found: {}", contact_id)))?;

    // 2. Find or create thread
    let threads =
        p2p_db::list_threads_for_contact(&db, &contact_id).map_err(|e| AppError::P2p(e.to_string()))?;
    let thread_id = if let Some(thread) = threads.first() {
        thread.id.clone()
    } else {
        let now = chrono::Utc::now().to_rfc3339();
        let thread = p2p_db::PeerThreadRow {
            id: uuid::Uuid::new_v4().to_string(),
            contact_id: contact_id.clone(),
            local_agent_id: contact.local_agent_id.clone(),
            title: format!("Conversation with {}", contact.display_name),
            summary: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let tid = thread.id.clone();
        p2p_db::create_thread(&db, &thread).map_err(|e| AppError::P2p(e.to_string()))?;
        tid
    };

    // 3. Create envelope
    let envelope = Envelope::new(
        "local".into(),
        Payload::MessageRequest {
            content: content.clone(),
        },
    );

    // 4. Persist message (outgoing, auto-approved)
    let now = chrono::Utc::now().to_rfc3339();
    let msg_id = uuid::Uuid::new_v4().to_string();
    let msg = p2p_db::PeerMessageRow {
        id: msg_id.clone(),
        thread_id,
        message_id_unique: envelope.message_id.clone(),
        correlation_id: None,
        direction: "outgoing".to_string(),
        sender_agent: "local".to_string(),
        content,
        approval_state: "approved".to_string(),
        delivery_state: "sending".to_string(),
        retry_count: 0,
        raw_envelope: serde_json::to_string(&envelope).ok(),
        created_at: now.clone(),
    };
    p2p_db::insert_peer_message(&db, &msg).map_err(|e| AppError::P2p(e.to_string()))?;

    // 5. Persist to outbox
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let outbox = p2p_db::OutboxRow {
        id: outbox_id.clone(),
        peer_message_id: msg_id.clone(),
        target_peer_id: contact.peer_id.clone(),
        attempts: 0,
        next_retry_at: None,
        status: "pending".to_string(),
        created_at: now,
    };
    p2p_db::insert_outbox(&db, &outbox).map_err(|e| AppError::P2p(e.to_string()))?;

    // 6. Attempt send (only if peer is authenticated, otherwise leave queued for handshake completion)
    if !manager.is_peer_authenticated(&contact.peer_id).map_err(|e| AppError::P2p(e.to_string()))? {
        // Peer not yet authenticated — leave in outbox as queued, handshake completion will retry
        p2p_db::update_message_state(&db, &msg_id, None, Some("queued"))
            .map_err(|e| AppError::P2p(e.to_string()))?;
        return Ok(());
    }

    let peer_id: libp2p::PeerId = contact
        .peer_id
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid peer_id: {}", contact.peer_id)))?;

    match manager.send_message(peer_id, envelope).await {
        Ok(()) => {
            // Keep delivery_state as "sending" — transitions to "delivered" on ACK.
            // Don't increment attempts here; only OutboundFailure increments.
            p2p_db::update_outbox_status(&db, &outbox_id, "sending", 0)
                .map_err(|e| AppError::P2p(e.to_string()))?;
        }
        Err(e) => {
            // Mark as queued for retry with exponential backoff
            p2p_db::update_message_state(&db, &msg_id, None, Some("queued"))
                .map_err(|e| AppError::P2p(e.to_string()))?;
            let attempts = 1i32;
            let backoff_secs = 30i64 * (1i64 << (attempts - 1).min(4));
            let next_retry =
                chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
            p2p_db::update_outbox_retry(&db, &outbox_id, 1, &next_retry.to_rfc3339())
                .map_err(|e2| AppError::P2p(e2.to_string()))?;
            return Err(AppError::P2p(format!("Failed to send (queued for retry): {}", e)));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn p2p_approve_message(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    message_id: String,
    response_content: String,
) -> Result<String, AppError> {
    let result = secretary::approve_message(&db, &message_id, &response_content)
        .map_err(AppError::P2p)?;

    // Attempt to send the response envelope (only if peer is authenticated)
    if !manager.is_peer_authenticated(&result.target_peer_id).map_err(|e| AppError::P2p(e.to_string()))? {
        // Peer not authenticated — response stays in outbox, will be sent after handshake
        return Ok(result.response_message_id);
    }

    let peer_id: libp2p::PeerId = result
        .target_peer_id
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid peer_id: {}", result.target_peer_id)))?;

    match manager.send_message(peer_id, result.envelope).await {
        Ok(()) => {
            let _ = p2p_db::update_message_state(
                &db,
                &result.response_message_id,
                None,
                Some("sending"),
            );
            let _ = p2p_db::update_outbox_status(
                &db,
                &result.outbox_id,
                "sending",
                0,
            );
        }
        Err(e) => {
            // Message stays queued in outbox for retry
            tracing::error!("Failed to send approved response: {e}");
        }
    }

    Ok(result.response_message_id)
}

#[tauri::command]
pub fn p2p_reject_message(db: State<'_, Database>, message_id: String) -> Result<(), AppError> {
    secretary::reject_message(&db, &message_id).map_err(AppError::P2p)
}

#[tauri::command]
pub async fn p2p_request_draft(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    message_id: String,
    agent_id: String,
) -> Result<String, AppError> {
    secretary::generate_draft_response(&app, &db, &message_id, &agent_id)
        .await
        .map_err(AppError::P2p)
}

// ── Thread commands ──

#[tauri::command]
pub fn p2p_list_threads(
    db: State<'_, Database>,
    contact_id: String,
) -> Result<Vec<p2p_db::PeerThreadRow>, AppError> {
    p2p_db::list_threads_for_contact(&db, &contact_id).map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub fn p2p_get_thread(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<Option<p2p_db::PeerThreadRow>, AppError> {
    p2p_db::get_thread(&db, &thread_id).map_err(|e| AppError::P2p(e.to_string()))
}

#[tauri::command]
pub fn p2p_get_thread_messages(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<Vec<p2p_db::PeerMessageRow>, AppError> {
    p2p_db::get_thread_messages(&db, &thread_id).map_err(|e| AppError::P2p(e.to_string()))
}

// ── Network settings commands ──

#[tauri::command]
pub fn p2p_get_network_enabled(app: tauri::AppHandle) -> bool {
    use tauri_plugin_store::StoreExt;
    app.store("p2p-settings.json")
        .ok()
        .and_then(|s| s.get("network_enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

#[tauri::command]
pub fn p2p_set_network_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), AppError> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("p2p-settings.json")
        .map_err(|e| AppError::Config(e.to_string()))?;
    store.set("network_enabled", serde_json::json!(enabled));
    store.save().map_err(|e| AppError::Config(e.to_string()))
}

// ── Connection info ──

#[derive(Clone, serde::Serialize)]
pub struct ConnectionInfo {
    pub peer_id: String,
    pub configured_listen_port: Option<u16>,
    pub active_listen_port: Option<u16>,
    pub listen_addresses: Vec<String>,
    pub status: String,
}

#[tauri::command]
pub fn p2p_get_connection_info(
    app: tauri::AppHandle,
    manager: State<'_, P2PManager>,
) -> Result<ConnectionInfo, AppError> {
    use tauri_plugin_store::StoreExt;
    let configured_listen_port = app
        .store("p2p-settings.json")
        .ok()
        .and_then(|s| s.get("listen_port"))
        .and_then(|v| v.as_u64())
        .and_then(|p| u16::try_from(p).ok());

    Ok(ConnectionInfo {
        peer_id: manager.peer_id().map_err(|e| AppError::P2p(e.to_string()))?.to_string(),
        configured_listen_port,
        active_listen_port: manager.get_active_listen_port().map_err(|e| AppError::P2p(e.to_string()))?,
        listen_addresses: manager.get_listen_addresses().map_err(|e| AppError::P2p(e.to_string()))?,
        status: format!("{:?}", manager.status().map_err(|e| AppError::P2p(e.to_string()))?).to_lowercase(),
    })
}

// ── Listen port commands ──

#[tauri::command]
pub fn p2p_get_listen_port(app: tauri::AppHandle) -> Option<u16> {
    use tauri_plugin_store::StoreExt;
    app.store("p2p-settings.json")
        .ok()
        .and_then(|s| s.get("listen_port"))
        .and_then(|v| v.as_u64())
        .and_then(|p| u16::try_from(p).ok())
}

#[tauri::command]
pub fn p2p_set_listen_port(app: tauri::AppHandle, port: Option<u16>) -> Result<(), AppError> {
    use tauri_plugin_store::StoreExt;
    if let Some(p) = port {
        if p == 0 {
            return Err(AppError::Validation("Port 0 is not allowed; use null for automatic port".into()));
        }
    }
    let store = app
        .store("p2p-settings.json")
        .map_err(|e| AppError::Config(e.to_string()))?;
    match port {
        Some(p) => store.set("listen_port", serde_json::json!(p)),
        None => { store.delete("listen_port"); }
    }
    store.save().map_err(|e| AppError::Config(e.to_string()))
}

// ── Dial command ──

#[tauri::command]
pub async fn p2p_dial_peer(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    contact_id: String,
) -> Result<(), AppError> {
    let contact = p2p_db::get_contact(&db, &contact_id)
        .map_err(|e| AppError::P2p(e.to_string()))?
        .ok_or_else(|| AppError::NotFound(format!("Contact not found: {}", contact_id)))?;

    // Parse addresses from addresses_json
    let addr_strings: Vec<String> = match &contact.addresses_json {
        Some(json) => serde_json::from_str(json)
            .map_err(|e| AppError::Json(format!("Invalid addresses_json: {}", e)))?,
        None => {
            return Err(AppError::Validation("No addresses available for this contact".into()));
        }
    };

    if addr_strings.is_empty() {
        return Err(AppError::Validation("No addresses available for this contact".into()));
    }

    // Parse each string as Multiaddr, skip invalid ones
    let addrs: Vec<libp2p::Multiaddr> = addr_strings
        .iter()
        .filter_map(|s| s.parse::<libp2p::Multiaddr>().ok())
        .collect();

    if addrs.is_empty() {
        return Err(AppError::Validation("No valid addresses after parsing".into()));
    }

    let peer_id: libp2p::PeerId = contact
        .peer_id
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid peer_id: {}", contact.peer_id)))?;

    manager.dial(peer_id, addrs).await.map_err(|e| AppError::P2p(e.to_string()))
}

// ── Outbox processor ──

/// Process pending outbox entries — retries queued messages with exponential backoff.
async fn process_pending_outbox(db: &Database, manager: &P2PManager) {
    let pending = match p2p_db::get_pending_outbox(db) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in pending {
        // Skip entries whose peer is not yet authenticated (handshake-driven retry will flush later)
        if !manager.is_peer_authenticated(&entry.target_peer_id).unwrap_or(false) {
            continue;
        }

        // Skip entries whose retry time hasn't arrived yet
        if let Some(ref next_retry) = entry.next_retry_at {
            if let Ok(retry_time) = chrono::DateTime::parse_from_rfc3339(next_retry) {
                if retry_time > chrono::Utc::now() {
                    continue;
                }
            }
        }

        let peer_id: libp2p::PeerId = match entry.target_peer_id.parse() {
            Ok(pid) => pid,
            Err(_) => continue,
        };

        // Reconstruct envelope from stored raw_envelope
        let msg = match p2p_db::get_peer_message(db, &entry.peer_message_id) {
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

        match manager.send_message(peer_id, envelope).await {
            Ok(()) => {
                // Don't increment attempts here; only OutboundFailure increments.
                let _ =
                    p2p_db::update_message_state(db, &entry.peer_message_id, None, Some("sending"));
                let _ = p2p_db::update_outbox_status(db, &entry.id, "sending", entry.attempts);
            }
            Err(_) => {
                let new_attempts = entry.attempts + 1;
                let _ =
                    p2p_db::update_message_state(db, &entry.peer_message_id, None, Some("queued"));
                // Exponential backoff: 30s, 60s, 120s, 240s, 480s (capped at 4 doublings)
                let backoff_secs = 30i64 * (1i64 << (new_attempts - 1).min(4));
                let next_retry =
                    chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
                let _ = p2p_db::update_outbox_retry(
                    db,
                    &entry.id,
                    new_attempts,
                    &next_retry.to_rfc3339(),
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_multiaddrs_valid_ipv4() {
        let result = validate_multiaddrs(vec!["/ip4/1.2.3.4/tcp/4001".to_string()]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec!["/ip4/1.2.3.4/tcp/4001"]);
    }

    #[test]
    fn test_validate_multiaddrs_valid_ipv6() {
        let result = validate_multiaddrs(vec!["/ip6/::1/tcp/4001".to_string()]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec!["/ip6/::1/tcp/4001"]);
    }

    #[test]
    fn test_validate_multiaddrs_invalid() {
        let result = validate_multiaddrs(vec!["not-a-multiaddr".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_multiaddrs_strips_p2p_suffix() {
        let addr = "/ip4/1.2.3.4/tcp/4001/p2p/12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN"
            .to_string();
        let result = validate_multiaddrs(vec![addr]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec!["/ip4/1.2.3.4/tcp/4001"]);
    }

    #[test]
    fn test_validate_multiaddrs_empty_list() {
        let result = validate_multiaddrs(vec![]);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_validate_multiaddrs_mixed_valid_and_invalid() {
        let result = validate_multiaddrs(vec![
            "/ip4/1.2.3.4/tcp/4001".to_string(),
            "garbage".to_string(),
        ]);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_multiaddrs_multiple_valid() {
        let result = validate_multiaddrs(vec![
            "/ip4/1.2.3.4/tcp/4001".to_string(),
            "/ip6/2001:db8::1/tcp/5000".to_string(),
        ]);
        assert!(result.is_ok());
        let addrs = result.unwrap();
        assert_eq!(addrs.len(), 2);
    }

    #[test]
    fn test_validate_multiaddrs_bare_p2p_rejected() {
        let result = validate_multiaddrs(vec![
            "/p2p/12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN".to_string(),
        ]);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_multiaddrs_non_trailing_p2p_preserved() {
        // Non-trailing /p2p/ (e.g. relay-style) should be preserved
        let addr = "/ip4/1.2.3.4/tcp/4001".to_string();
        let result = validate_multiaddrs(vec![addr]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), vec!["/ip4/1.2.3.4/tcp/4001"]);
    }
}
