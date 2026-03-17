use crate::db::Database;
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
) -> Result<(), String> {
    // Load known peers from contacts DB before starting
    let contacts = p2p_db::list_contacts(&db).map_err(|e| e.to_string())?;
    let peer_ids: std::collections::HashSet<String> =
        contacts.into_iter().map(|c| c.peer_id).collect();
    manager.set_known_peers(peer_ids);

    manager
        .start(app.clone())
        .await
        .map_err(|e| e.to_string())?;

    // Process pending outbox entries on startup
    process_pending_outbox(&db, &manager).await;

    Ok(())
}

#[tauri::command]
pub async fn p2p_stop(manager: State<'_, P2PManager>) -> Result<(), String> {
    manager.stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_status(manager: State<'_, P2PManager>) -> String {
    format!("{:?}", manager.status()).to_lowercase()
}

#[tauri::command]
pub fn p2p_get_peer_id(manager: State<'_, P2PManager>) -> String {
    manager.peer_id().to_string()
}

// ── Invite commands ──

#[tauri::command]
pub fn p2p_generate_invite(
    identity: State<'_, NodeIdentity>,
    agent_name: String,
    agent_description: String,
    expiry_hours: Option<u64>,
) -> Result<String, String> {
    // Phase 1: empty addresses (mDNS handles local discovery)
    let addresses = vec![];
    invite::generate_invite(&identity, addresses, agent_name, agent_description, expiry_hours)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_accept_invite(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    code: String,
    local_agent_id: Option<String>,
) -> Result<p2p_db::ContactRow, String> {
    let card = invite::parse_invite(&code).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let contact = p2p_db::ContactRow {
        id: uuid::Uuid::new_v4().to_string(),
        peer_id: card.peer_id.clone(),
        public_key: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &card.public_key,
        ),
        display_name: card.agent_name.clone(),
        agent_name: card.agent_name,
        agent_description: card.agent_description,
        local_agent_id,
        mode: "secretary".to_string(),
        capabilities_json: serde_json::to_string(&CapabilitySet::default_phase1())
            .unwrap_or_default(),
        status: "pending".to_string(),
        invite_card_raw: Some(code),
        created_at: now.clone(),
        updated_at: now,
    };
    p2p_db::insert_contact(&db, &contact).map_err(|e| e.to_string())?;

    // Update known peers set so the new contact can communicate immediately
    manager.add_known_peer(contact.peer_id.clone());

    Ok(contact)
}

// ── Contact commands ──

#[tauri::command]
pub fn p2p_list_contacts(db: State<'_, Database>) -> Result<Vec<p2p_db::ContactRow>, String> {
    p2p_db::list_contacts(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_update_contact(
    db: State<'_, Database>,
    id: String,
    display_name: Option<String>,
    local_agent_id: Option<String>,
    mode: Option<String>,
) -> Result<(), String> {
    let update = p2p_db::ContactUpdate {
        display_name,
        local_agent_id: local_agent_id.map(Some),
        mode,
        ..Default::default()
    };
    p2p_db::update_contact(&db, &id, update).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_remove_contact(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    id: String,
) -> Result<(), String> {
    // Look up contact to get peer_id before deleting
    if let Ok(Some(contact)) = p2p_db::get_contact(&db, &id) {
        manager.remove_known_peer(&contact.peer_id);
    }
    p2p_db::delete_contact(&db, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_bind_agent(
    db: State<'_, Database>,
    contact_id: String,
    agent_id: String,
) -> Result<(), String> {
    let update = p2p_db::ContactUpdate {
        local_agent_id: Some(Some(agent_id)),
        ..Default::default()
    };
    p2p_db::update_contact(&db, &contact_id, update).map_err(|e| e.to_string())
}

// ── Messaging commands ──

#[tauri::command]
pub async fn p2p_send_message(
    db: State<'_, Database>,
    manager: State<'_, P2PManager>,
    contact_id: String,
    content: String,
) -> Result<(), String> {
    // 1. Look up contact
    let contact = p2p_db::get_contact(&db, &contact_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Contact not found: {}", contact_id))?;

    // 2. Find or create thread
    let threads =
        p2p_db::list_threads_for_contact(&db, &contact_id).map_err(|e| e.to_string())?;
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
        p2p_db::create_thread(&db, &thread).map_err(|e| e.to_string())?;
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
    p2p_db::insert_peer_message(&db, &msg).map_err(|e| e.to_string())?;

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
    p2p_db::insert_outbox(&db, &outbox).map_err(|e| e.to_string())?;

    // 6. Attempt send (only if peer is authenticated, otherwise leave queued for handshake completion)
    if !manager.is_peer_authenticated(&contact.peer_id) {
        // Peer not yet authenticated — leave in outbox as queued, handshake completion will retry
        p2p_db::update_message_state(&db, &msg_id, None, Some("queued"))
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let peer_id: libp2p::PeerId = contact
        .peer_id
        .parse()
        .map_err(|_| format!("Invalid peer_id: {}", contact.peer_id))?;

    match manager.send_message(peer_id, envelope).await {
        Ok(()) => {
            // Keep delivery_state as "sending" — transitions to "delivered" on ACK
            p2p_db::update_outbox_status(&db, &outbox_id, "sending", 1)
                .map_err(|e| e.to_string())?;
        }
        Err(e) => {
            // Mark as queued for retry with exponential backoff
            p2p_db::update_message_state(&db, &msg_id, None, Some("queued"))
                .map_err(|e| e.to_string())?;
            let backoff_secs = 30i64; // First retry: 30s
            let next_retry =
                chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
            p2p_db::update_outbox_retry(&db, &outbox_id, 1, &next_retry.to_rfc3339())
                .map_err(|e| e.to_string())?;
            return Err(format!("Failed to send (queued for retry): {}", e));
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
) -> Result<String, String> {
    let result = secretary::approve_message(&db, &message_id, &response_content)?;

    // Attempt to send the response envelope (only if peer is authenticated)
    if !manager.is_peer_authenticated(&result.target_peer_id) {
        // Peer not authenticated — response stays in outbox, will be sent after handshake
        return Ok(result.response_message_id);
    }

    let peer_id: libp2p::PeerId = result
        .target_peer_id
        .parse()
        .map_err(|_| format!("Invalid peer_id: {}", result.target_peer_id))?;

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
                1,
            );
        }
        Err(e) => {
            // Message stays queued in outbox for retry
            eprintln!("Failed to send approved response: {e}");
        }
    }

    Ok(result.response_message_id)
}

#[tauri::command]
pub fn p2p_reject_message(db: State<'_, Database>, message_id: String) -> Result<(), String> {
    secretary::reject_message(&db, &message_id)
}

#[tauri::command]
pub async fn p2p_request_draft(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    message_id: String,
    agent_id: String,
) -> Result<String, String> {
    secretary::generate_draft_response(&app, &db, &message_id, &agent_id).await
}

// ── Thread commands ──

#[tauri::command]
pub fn p2p_list_threads(
    db: State<'_, Database>,
    contact_id: String,
) -> Result<Vec<p2p_db::PeerThreadRow>, String> {
    p2p_db::list_threads_for_contact(&db, &contact_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_get_thread(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<Option<p2p_db::PeerThreadRow>, String> {
    p2p_db::get_thread(&db, &thread_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn p2p_get_thread_messages(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<Vec<p2p_db::PeerMessageRow>, String> {
    p2p_db::get_thread_messages(&db, &thread_id).map_err(|e| e.to_string())
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
pub fn p2p_set_network_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_store::StoreExt;
    let store = app
        .store("p2p-settings.json")
        .map_err(|e| e.to_string())?;
    store.set("network_enabled", serde_json::json!(enabled));
    store.save().map_err(|e| e.to_string())
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
        if !manager.is_peer_authenticated(&entry.target_peer_id) {
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

        let attempts = entry.attempts + 1;
        match manager.send_message(peer_id, envelope).await {
            Ok(()) => {
                let _ =
                    p2p_db::update_message_state(db, &entry.peer_message_id, None, Some("sending"));
                let _ = p2p_db::update_outbox_status(db, &entry.id, "sending", attempts);
            }
            Err(_) => {
                let _ =
                    p2p_db::update_message_state(db, &entry.peer_message_id, None, Some("queued"));
                // Exponential backoff: 30s, 60s, 120s, 240s, 480s (capped at 4 doublings)
                let backoff_secs = 30i64 * (1i64 << (attempts - 1).min(4));
                let next_retry =
                    chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
                let _ = p2p_db::update_outbox_retry(
                    db,
                    &entry.id,
                    attempts,
                    &next_retry.to_rfc3339(),
                );
            }
        }
    }
}
