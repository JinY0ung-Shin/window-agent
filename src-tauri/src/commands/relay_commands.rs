use crate::db::Database;
use crate::error::AppError;
use crate::relay::capability::CapabilitySet;
use crate::relay::db as relay_db;
use crate::relay::envelope::{Envelope, Payload};
use crate::relay::identity::NodeIdentity;
use crate::relay::invite;
use crate::relay::manager::RelayManager;
use crate::settings::{AppSettings, AppSettingsPatch};
use tauri::{Manager, State};

// ── Lifecycle commands ──

#[tauri::command]
pub async fn relay_start(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    manager: State<'_, RelayManager>,
) -> Result<(), AppError> {
    // Load known peers from contacts DB before starting
    let contacts = relay_db::list_contacts(&db).map_err(|e| AppError::Relay(e.to_string()))?;
    let peer_ids: std::collections::HashSet<String> =
        contacts.into_iter().map(|c| c.peer_id).collect();
    manager.set_known_peers(peer_ids).map_err(|e| AppError::Relay(e.to_string()))?;

    manager
        .start(app.clone())
        .await
        .map_err(|e| AppError::Relay(e.to_string()))?;

    // Process pending outbox entries on startup
    process_pending_outbox(&db, &manager).await;

    Ok(())
}

#[tauri::command]
pub async fn relay_stop(manager: State<'_, RelayManager>) -> Result<(), AppError> {
    manager.stop().await.map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_status(manager: State<'_, RelayManager>) -> Result<String, AppError> {
    Ok(format!("{:?}", manager.status().map_err(|e| AppError::Relay(e.to_string()))?).to_lowercase())
}

#[tauri::command]
pub fn relay_get_peer_id(manager: State<'_, RelayManager>) -> Result<String, AppError> {
    Ok(manager.peer_id().map_err(|e| AppError::Relay(e.to_string()))?.to_string())
}

// ── Invite commands ──

#[tauri::command]
pub fn relay_generate_invite(
    identity: State<'_, NodeIdentity>,
    settings: State<'_, AppSettings>,
    agent_name: String,
    agent_description: String,
    addresses: Vec<String>,
    expiry_hours: Option<u64>,
) -> Result<String, AppError> {
    let relay_url = settings.get().relay_url;
    invite::generate_invite_with_relay(&identity, addresses, agent_name, agent_description, expiry_hours, Some(relay_url))
        .map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub async fn relay_accept_invite(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    manager: State<'_, RelayManager>,
    code: String,
    local_agent_id: Option<String>,
) -> Result<relay_db::ContactRow, AppError> {
    let card = invite::parse_invite(&code).map_err(|e| AppError::Relay(e.to_string()))?;

    // If the invite carries a relay_url, store it for next startup
    // (multi-relay reconnect is out of scope — single relay assumption)
    if let Some(ref invite_relay_url) = card.relay_url {
        if !invite_relay_url.is_empty() {
            let settings = app.state::<AppSettings>();
            let _ = settings.set(
                &AppSettingsPatch { relay_url: Some(invite_relay_url.clone()), ..Default::default() },
                &app,
            );
        }
    }

    // Serialize addresses from ContactCard as JSON array
    let addresses_json = if card.addresses.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&card.addresses).unwrap_or_default())
    };

    // Check if a contact with this peer_id already exists
    let contact = if let Some(existing) =
        relay_db::get_contact_by_peer_id(&db, &card.peer_id).map_err(|e| AppError::Relay(e.to_string()))?
    {
        // Update existing contact — fill in invite data (covers auto-registered placeholders)
        let public_key_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &card.public_key,
        );
        let mut update = relay_db::ContactUpdate {
            display_name: Some(card.agent_name.clone()),
            agent_name: Some(card.agent_name.clone()),
            agent_description: Some(card.agent_description.clone()),
            addresses_json: Some(addresses_json.clone()),
            status: Some("accepted".to_string()),
            capabilities_json: Some(
                serde_json::to_string(&CapabilitySet::default_phase1()).unwrap_or_default(),
            ),
            ..Default::default()
        };
        if let Some(ref aid) = local_agent_id {
            update.local_agent_id = Some(Some(aid.clone()));
        }
        relay_db::update_contact(&db, &existing.id, update).map_err(|e| AppError::Relay(e.to_string()))?;
        // Update invite_card_raw and public_key directly
        relay_db::update_contact_invite_and_key(&db, &existing.id, &code, &public_key_b64)
            .map_err(|e| AppError::Relay(e.to_string()))?;
        // Re-fetch to return fresh data
        relay_db::get_contact(&db, &existing.id)
            .map_err(|e| AppError::Relay(e.to_string()))?
            .ok_or_else(|| AppError::NotFound("Contact disappeared after update".into()))?
    } else {
        // Insert new contact
        let now = chrono::Utc::now().to_rfc3339();
        let contact = relay_db::ContactRow {
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
            status: "accepted".to_string(),
            invite_card_raw: Some(code),
            addresses_json,
            published_agents_json: None,
            created_at: now.clone(),
            updated_at: now,
        };
        relay_db::insert_contact(&db, &contact).map_err(|e| AppError::Relay(e.to_string()))?;
        contact
    };

    // Register peer's public key for encryption/relay routing
    manager
        .register_peer_key(&contact.peer_id, &contact.public_key)
        .map_err(|e| AppError::Relay(e.to_string()))?;

    // Update known peers set so the new contact can communicate immediately
    manager.add_known_peer(contact.peer_id.clone()).map_err(|e| AppError::Relay(e.to_string()))?;

    // Send Introduce envelope so the remote peer knows who we are (using LOCAL identity, not remote card)
    if manager.is_peer_authenticated(&contact.peer_id).unwrap_or(false) {
        let identity = app.state::<NodeIdentity>();
        let public_key_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            identity.public_key_bytes(),
        );
        // Look up actual local agent metadata from DB
        let (local_name, local_desc) = contact
            .local_agent_id
            .as_deref()
            .and_then(|aid| {
                crate::db::agent_operations::get_agent_impl(&db, aid.to_string()).ok()
            })
            .map(|agent| (agent.name, agent.description))
            .unwrap_or_else(|| ("local-agent".to_string(), String::new()));
        let published_agents = crate::db::agent_operations::list_network_visible_agents_impl(&db)
            .ok()
            .map(|agents| agents.into_iter().map(|a| wa_shared::protocol::PublishedAgent {
                agent_id: a.id, name: a.name, description: a.description,
            }).collect::<Vec<_>>());
        let introduce_envelope = Envelope::new(
            local_name.clone(),
            Payload::Introduce {
                agent_name: local_name,
                agent_description: local_desc,
                public_key: public_key_b64,
                published_agents,
            },
        );
        if let Err(e) = manager.send_message(&contact.peer_id, &introduce_envelope).await {
            tracing::warn!("Failed to send Introduce after invite accept: {e}");
        }

        // Subscribe to presence for the new contact
        if let Ok(relay_pid) = manager.peer_id_to_relay_id(&contact.peer_id) {
            if let Some(handle) = manager.get_relay_handle() {
                let _ = handle.subscribe_presence(vec![relay_pid]);
            }
        }
    }

    Ok(contact)
}

// ── Contact commands ──

#[tauri::command]
pub fn relay_list_contacts(db: State<'_, Database>) -> Result<Vec<relay_db::ContactRow>, AppError> {
    relay_db::list_contacts(&db).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_update_contact(
    db: State<'_, Database>,
    id: String,
    display_name: Option<String>,
    local_agent_id: Option<String>,
    mode: Option<String>,
) -> Result<(), AppError> {
    let update = relay_db::ContactUpdate {
        display_name,
        local_agent_id: local_agent_id.map(Some),
        mode,
        ..Default::default()
    };
    relay_db::update_contact(&db, &id, update).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_remove_contact(
    db: State<'_, Database>,
    manager: State<'_, RelayManager>,
    id: String,
) -> Result<(), AppError> {
    // Look up contact to get peer_id before deleting
    if let Ok(Some(contact)) = relay_db::get_contact(&db, &id) {
        manager.remove_known_peer(&contact.peer_id).map_err(|e| AppError::Relay(e.to_string()))?;
    }
    relay_db::delete_contact(&db, &id).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_bind_agent(
    db: State<'_, Database>,
    contact_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    let update = relay_db::ContactUpdate {
        local_agent_id: Some(Some(agent_id)),
        ..Default::default()
    };
    relay_db::update_contact(&db, &contact_id, update).map_err(|e| AppError::Relay(e.to_string()))
}

// ── Contact approval commands ──

#[tauri::command]
pub async fn relay_approve_contact(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    manager: State<'_, RelayManager>,
    contact_id: String,
) -> Result<(), AppError> {
    let contact = relay_db::get_contact(&db, &contact_id)
        .map_err(|e| AppError::Relay(e.to_string()))?
        .ok_or_else(|| AppError::NotFound(format!("Contact not found: {}", contact_id)))?;

    if contact.status != "pending_approval" {
        return Err(AppError::Validation(format!(
            "Contact status is '{}', expected 'pending_approval'",
            contact.status,
        )));
    }

    // Update status to accepted with default Phase 1 capabilities
    let update = relay_db::ContactUpdate {
        status: Some("accepted".to_string()),
        capabilities_json: Some(
            serde_json::to_string(&CapabilitySet::default_phase1()).unwrap_or_default(),
        ),
        ..Default::default()
    };
    relay_db::update_contact(&db, &contact_id, update).map_err(|e| AppError::Relay(e.to_string()))?;

    // Ensure peer is in known_peers and key indexes
    if !contact.public_key.is_empty() {
        let _ = manager.register_peer_key(&contact.peer_id, &contact.public_key);
    }
    manager.add_known_peer(contact.peer_id.clone()).map_err(|e| AppError::Relay(e.to_string()))?;

    // Subscribe to presence for the newly approved contact
    if let Ok(relay_pid) = manager.peer_id_to_relay_id(&contact.peer_id) {
        if let Some(handle) = manager.get_relay_handle() {
            let _ = handle.subscribe_presence(vec![relay_pid]);
        }
    }

    // Send Introduce back so the requester knows we approved and gets our published_agents
    let identity = app.state::<NodeIdentity>();
    let public_key_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        identity.public_key_bytes(),
    );
    let settings = app.state::<crate::settings::AppSettings>();
    let s = settings.get();
    let local_name = if s.directory_agent_name.is_empty() { "Agent".to_string() } else { s.directory_agent_name.clone() };
    let local_desc = s.directory_agent_description.clone();
    let published_agents = crate::db::agent_operations::list_network_visible_agents_impl(&db)
        .ok()
        .map(|agents| agents.into_iter().map(|a| wa_shared::protocol::PublishedAgent {
            agent_id: a.id, name: a.name, description: a.description,
        }).collect::<Vec<_>>());
    let introduce_envelope = Envelope::new(
        local_name.clone(),
        Payload::Introduce {
            agent_name: local_name,
            agent_description: local_desc,
            public_key: public_key_b64,
            published_agents,
        },
    );
    if let Err(e) = manager.send_message(&contact.peer_id, &introduce_envelope).await {
        tracing::warn!("Failed to send Introduce after approval: {e}");
    }

    Ok(())
}

#[tauri::command]
pub fn relay_reject_contact(
    db: State<'_, Database>,
    manager: State<'_, RelayManager>,
    contact_id: String,
) -> Result<(), AppError> {
    let contact = relay_db::get_contact(&db, &contact_id)
        .map_err(|e| AppError::Relay(e.to_string()))?
        .ok_or_else(|| AppError::NotFound(format!("Contact not found: {}", contact_id)))?;

    // Remove from peer indexes
    manager.remove_known_peer(&contact.peer_id).map_err(|e| AppError::Relay(e.to_string()))?;

    // Delete the contact
    relay_db::delete_contact(&db, &contact_id).map_err(|e| AppError::Relay(e.to_string()))
}

// ── Messaging commands ──

#[tauri::command]
pub async fn relay_send_message(
    db: State<'_, Database>,
    manager: State<'_, RelayManager>,
    contact_id: String,
    content: String,
    target_agent_id: Option<String>,
) -> Result<(), AppError> {
    // 1. Look up contact
    let contact = relay_db::get_contact(&db, &contact_id)
        .map_err(|e| AppError::Relay(e.to_string()))?
        .ok_or_else(|| AppError::NotFound(format!("Contact not found: {}", contact_id)))?;

    // 1b. Auto-approve pending contacts when user explicitly sends a message
    if contact.status == "pending_approval" {
        let update = relay_db::ContactUpdate {
            status: Some("accepted".to_string()),
            capabilities_json: Some(
                serde_json::to_string(&CapabilitySet::default_phase1()).unwrap_or_default(),
            ),
            ..Default::default()
        };
        let _ = relay_db::update_contact(&db, &contact_id, update);
        if !contact.public_key.is_empty() {
            let _ = manager.register_peer_key(&contact.peer_id, &contact.public_key);
        }
        let _ = manager.add_known_peer(contact.peer_id.clone());
    }

    // 2. Find or create thread
    let threads =
        relay_db::list_threads_for_contact(&db, &contact_id).map_err(|e| AppError::Relay(e.to_string()))?;
    let thread_id = if let Some(thread) = threads.first() {
        thread.id.clone()
    } else {
        let now = chrono::Utc::now().to_rfc3339();
        let thread = relay_db::PeerThreadRow {
            id: uuid::Uuid::new_v4().to_string(),
            contact_id: contact_id.clone(),
            local_agent_id: contact.local_agent_id.clone(),
            title: format!("Conversation with {}", contact.display_name),
            summary: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let tid = thread.id.clone();
        relay_db::create_thread(&db, &thread).map_err(|e| AppError::Relay(e.to_string()))?;
        tid
    };

    // 3. Create envelope
    let envelope = Envelope::new(
        "local".into(),
        Payload::MessageRequest {
            content: content.clone(),
            target_agent_id: target_agent_id.clone(),
        },
    );

    // 4. Persist message (outgoing, auto-approved)
    let now = chrono::Utc::now().to_rfc3339();
    let msg_id = uuid::Uuid::new_v4().to_string();
    let msg = relay_db::PeerMessageRow {
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
        target_agent_id,
        responding_agent_id: None,
        created_at: now.clone(),
    };
    relay_db::insert_peer_message(&db, &msg).map_err(|e| AppError::Relay(e.to_string()))?;

    // 5. Persist to outbox
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let outbox = relay_db::OutboxRow {
        id: outbox_id.clone(),
        peer_message_id: msg_id.clone(),
        target_peer_id: contact.peer_id.clone(),
        attempts: 0,
        next_retry_at: None,
        status: "pending".to_string(),
        created_at: now,
    };
    relay_db::insert_outbox(&db, &outbox).map_err(|e| AppError::Relay(e.to_string()))?;

    // 6. Skip if relay is not active
    if !manager.is_peer_authenticated(&contact.peer_id).map_err(|e| AppError::Relay(e.to_string()))? {
        relay_db::update_message_state(&db, &msg_id, None, Some("queued"))
            .map_err(|e| AppError::Relay(e.to_string()))?;
        return Ok(());
    }

    // 7. Encrypt first, then send
    let encrypted_json = manager.encrypt_for_peer(&contact.peer_id, &envelope)
        .map_err(|e| AppError::Relay(e.to_string()))?;

    // Store encrypted version in raw_envelope
    let _ = relay_db::update_message_raw_envelope(&db, &msg_id, &encrypted_json);

    match manager.send_raw_envelope(&contact.peer_id, &encrypted_json).await {
        Ok(()) => {
            relay_db::update_outbox_status(&db, &outbox_id, "sending", 0)
                .map_err(|e| AppError::Relay(e.to_string()))?;
        }
        Err(e) => {
            relay_db::update_message_state(&db, &msg_id, None, Some("queued"))
                .map_err(|e| AppError::Relay(e.to_string()))?;
            let attempts = 1i32;
            let backoff_secs = 30i64 * (1i64 << (attempts - 1).min(4));
            let next_retry =
                chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
            relay_db::update_outbox_retry(&db, &outbox_id, 1, &next_retry.to_rfc3339())
                .map_err(|e2| AppError::Relay(e2.to_string()))?;
            return Err(AppError::Relay(format!("Failed to send (queued for retry): {}", e)));
        }
    }

    Ok(())
}

// ── Thread commands ──

#[tauri::command]
pub fn relay_list_threads(
    db: State<'_, Database>,
    contact_id: String,
) -> Result<Vec<relay_db::PeerThreadRow>, AppError> {
    relay_db::list_threads_for_contact(&db, &contact_id).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_get_thread(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<Option<relay_db::PeerThreadRow>, AppError> {
    relay_db::get_thread(&db, &thread_id).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_get_thread_messages(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<Vec<relay_db::PeerMessageRow>, AppError> {
    relay_db::get_thread_messages(&db, &thread_id).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_delete_thread(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<(), AppError> {
    relay_db::delete_thread(&db, &thread_id).map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_clear_thread_messages(
    db: State<'_, Database>,
    thread_id: String,
) -> Result<(), AppError> {
    relay_db::clear_thread_messages(&db, &thread_id).map_err(|e| AppError::Relay(e.to_string()))
}

// ── Network settings commands ──

#[tauri::command]
pub fn relay_get_network_enabled(settings: State<'_, AppSettings>) -> bool {
    settings.get().network_enabled
}

#[tauri::command]
pub fn relay_set_network_enabled(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    enabled: bool,
) -> Result<(), AppError> {
    settings.set(&AppSettingsPatch { network_enabled: Some(enabled), ..Default::default() }, &app)
}

// ── Connection info ──

#[derive(Clone, serde::Serialize)]
pub struct ConnectionInfo {
    pub peer_id: String,
    pub relay_url: String,
    pub status: String,
}

#[tauri::command]
pub fn relay_get_connection_info(
    settings: State<'_, AppSettings>,
    manager: State<'_, RelayManager>,
) -> Result<ConnectionInfo, AppError> {
    Ok(ConnectionInfo {
        peer_id: manager.peer_id().map_err(|e| AppError::Relay(e.to_string()))?.to_string(),
        relay_url: settings.get().relay_url,
        status: format!("{:?}", manager.status().map_err(|e| AppError::Relay(e.to_string()))?).to_lowercase(),
    })
}

// ── Relay allowed tools commands ──

/// Get the list of tools allowed for relay auto-response.
/// Returns tool names that are explicitly allowed. Empty = use default (read-only).
#[tauri::command]
pub fn relay_get_allowed_tools(settings: State<'_, AppSettings>) -> Vec<String> {
    settings.get().allowed_tools
}

/// Set the list of tools allowed for relay auto-response.
#[tauri::command]
pub fn relay_set_allowed_tools(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    tools: Vec<String>,
) -> Result<(), AppError> {
    settings.set(&AppSettingsPatch { allowed_tools: Some(tools), ..Default::default() }, &app)
}

// ── Relay URL commands ──

#[tauri::command]
pub fn relay_get_relay_url(settings: State<'_, AppSettings>) -> String {
    settings.get().relay_url
}

#[tauri::command]
pub fn relay_set_relay_url(
    app: tauri::AppHandle,
    settings: State<'_, AppSettings>,
    url: String,
) -> Result<(), AppError> {
    if url.trim().is_empty() {
        return Err(AppError::Validation("Relay URL cannot be empty".into()));
    }
    settings.set(&AppSettingsPatch { relay_url: Some(url), ..Default::default() }, &app)
}

// ── Directory commands ──

#[tauri::command]
pub fn relay_search_directory(
    manager: State<'_, RelayManager>,
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<(), AppError> {
    manager
        .search_directory(&query, limit.unwrap_or(20), offset.unwrap_or(0))
        .map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub async fn relay_send_friend_request(
    app: tauri::AppHandle,
    manager: State<'_, RelayManager>,
    target_peer_id: String,
    target_public_key: String,
    target_agent_name: String,
    target_agent_description: String,
    local_agent_id: Option<String>,
) -> Result<relay_db::ContactRow, AppError> {
    manager
        .send_friend_request(
            &app,
            &target_peer_id,
            &target_public_key,
            &target_agent_name,
            &target_agent_description,
            local_agent_id.as_deref(),
        )
        .await
        .map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_update_directory_profile(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    settings: State<'_, AppSettings>,
    manager: State<'_, RelayManager>,
    agent_name: String,
    agent_description: String,
    discoverable: bool,
) -> Result<(), AppError> {
    settings.set(&AppSettingsPatch {
        discoverable: Some(discoverable),
        directory_agent_name: Some(agent_name.clone()),
        directory_agent_description: Some(agent_description.clone()),
        ..Default::default()
    }, &app)?;

    let published_agents = crate::db::agent_operations::list_network_visible_agents_impl(&db)
        .ok()
        .map(|agents| agents.into_iter().map(|a| wa_shared::protocol::PublishedAgent {
            agent_id: a.id, name: a.name, description: a.description,
        }).collect::<Vec<_>>());

    manager
        .update_directory_profile(&agent_name, &agent_description, discoverable, published_agents)
        .map_err(|e| AppError::Relay(e.to_string()))
}

#[tauri::command]
pub fn relay_get_directory_settings(settings: State<'_, AppSettings>) -> Result<serde_json::Value, AppError> {
    let s = settings.get();
    Ok(serde_json::json!({
        "discoverable": s.discoverable,
        "agent_name": s.directory_agent_name,
        "agent_description": s.directory_agent_description,
    }))
}

#[tauri::command]
pub fn relay_set_directory_settings(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    settings: State<'_, AppSettings>,
    manager: State<'_, RelayManager>,
    discoverable: bool,
) -> Result<(), AppError> {
    settings.set(&AppSettingsPatch { discoverable: Some(discoverable), ..Default::default() }, &app)?;

    // Update on relay server if connected
    if manager.status().map(|s| s == crate::relay::manager::NetworkStatus::Active).unwrap_or(false) {
        let s = settings.get();
        let published_agents = crate::db::agent_operations::list_network_visible_agents_impl(&db)
            .ok()
            .map(|agents| agents.into_iter().map(|a| wa_shared::protocol::PublishedAgent {
                agent_id: a.id, name: a.name, description: a.description,
            }).collect::<Vec<_>>());
        let _ = manager.update_directory_profile(&s.directory_agent_name, &s.directory_agent_description, discoverable, published_agents);
    }

    Ok(())
}

// ── Outbox processor ──

/// Process pending outbox entries — retries queued messages.
async fn process_pending_outbox(db: &Database, manager: &RelayManager) {
    let pending = match relay_db::get_pending_outbox(db) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in pending {
        // Skip entries whose peer is not yet reachable
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

        // Get stored message
        let msg = match relay_db::get_peer_message(db, &entry.peer_message_id) {
            Ok(Some(m)) => m,
            _ => continue,
        };

        let raw = match msg.raw_envelope.as_deref() {
            Some(r) if !r.is_empty() => r,
            _ => continue,
        };

        // Check if raw_envelope is already encrypted
        let encrypted_json = if let Ok(val) = serde_json::from_str::<serde_json::Value>(raw) {
            if val.get("encrypted_payload").is_some() {
                // Already encrypted — send directly
                raw.to_string()
            } else {
                // Plaintext envelope — encrypt it
                let envelope: Envelope = match serde_json::from_str(raw) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                match manager.encrypt_for_peer(&entry.target_peer_id, &envelope) {
                    Ok(enc) => {
                        let _ = relay_db::update_message_raw_envelope(db, &entry.peer_message_id, &enc);
                        enc
                    }
                    Err(_) => continue,
                }
            }
        } else {
            continue;
        };

        match manager.send_raw_envelope(&entry.target_peer_id, &encrypted_json).await {
            Ok(()) => {
                let _ =
                    relay_db::update_message_state(db, &entry.peer_message_id, None, Some("sending"));
                let _ = relay_db::update_outbox_status(db, &entry.id, "sending", entry.attempts);
            }
            Err(_) => {
                let new_attempts = entry.attempts + 1;
                let _ =
                    relay_db::update_message_state(db, &entry.peer_message_id, None, Some("queued"));
                let backoff_secs = 30i64 * (1i64 << (new_attempts - 1).min(4));
                let next_retry =
                    chrono::Utc::now() + chrono::Duration::seconds(backoff_secs);
                let _ = relay_db::update_outbox_retry(
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
    // Note: validate_multiaddrs tests removed — no longer applicable in relay mode.
    // Remaining tests require Tauri app context and are tested via integration tests.
}
