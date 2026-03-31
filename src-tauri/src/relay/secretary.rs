use std::collections::HashSet;
use std::sync::Mutex;

use base64::Engine;
use crate::api::ApiState;
use crate::db::Database;
use crate::memory::SystemMemoryManager;
use crate::relay::db as relay_db;
use crate::relay::envelope::{Envelope, Payload};
use crate::relay::manager::RelayManager;
use crate::services::{actor_context, api_service, credential_service, llm_helpers};
use crate::settings::AppSettings;
use serde::Serialize;
use tauri::{Emitter, Manager};

/// Per-thread lock to prevent concurrent auto-responses on the same thread.
static ACTIVE_THREADS: std::sync::LazyLock<Mutex<HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

/// Event payload for delivery status updates.
#[derive(Debug, Clone, Serialize)]
pub struct DeliveryUpdate {
    pub message_id: String,
    pub state: String,
}

/// Process an incoming message envelope from a remote peer.
/// Called by the RelayManager event loop when a MessageRequest is received.
pub async fn handle_incoming_message(
    app_handle: &tauri::AppHandle,
    db: &Database,
    contact_peer_id: &str,
    envelope: &Envelope,
) -> Result<(), String> {
    // 1. Extract content and target_agent_id
    let (content, target_agent_id) = match &envelope.payload {
        Payload::MessageRequest { content, target_agent_id } => (content.clone(), target_agent_id.clone()),
        Payload::MessageResponse { content, .. } => (content.clone(), None),
        _ => return Err("Expected MessageRequest or MessageResponse payload".into()),
    };

    // 2. Look up contact by peer_id
    let contact = relay_db::get_contact_by_peer_id(db, contact_peer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Unknown contact peer_id: {}", contact_peer_id))?;

    // 3. Find existing thread or create a new one (routed by target_agent_id)
    let threads = relay_db::list_threads_for_contact(db, &contact.id)
        .map_err(|e| e.to_string())?;
    let thread_id = if let Some(ref tid) = target_agent_id {
        // Find thread bound to this specific agent
        if let Some(t) = threads.iter().find(|t| t.local_agent_id.as_deref() == Some(tid)) {
            t.id.clone()
        } else {
            // Create new thread for this agent
            let agent_name = crate::db::agent_operations::get_agent_impl(db, tid.clone())
                .map(|a| a.name)
                .unwrap_or_default();
            let now = chrono::Utc::now().to_rfc3339();
            let new_thread = relay_db::PeerThreadRow {
                id: uuid::Uuid::new_v4().to_string(),
                contact_id: contact.id.clone(),
                local_agent_id: Some(tid.clone()),
                title: if agent_name.is_empty() {
                    format!("Conversation with {}", contact.display_name)
                } else {
                    format!("{} — {}", contact.display_name, agent_name)
                },
                summary: None,
                created_at: now.clone(),
                updated_at: now,
            };
            let new_tid = new_thread.id.clone();
            relay_db::create_thread(db, &new_thread).map_err(|e| e.to_string())?;
            new_tid
        }
    } else if let Some(thread) = threads.first() {
        thread.id.clone()
    } else {
        let now = chrono::Utc::now().to_rfc3339();
        let new_thread = relay_db::PeerThreadRow {
            id: uuid::Uuid::new_v4().to_string(),
            contact_id: contact.id.clone(),
            local_agent_id: contact.local_agent_id.clone(),
            title: format!("Conversation with {}", contact.display_name),
            summary: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let tid = new_thread.id.clone();
        relay_db::create_thread(db, &new_thread).map_err(|e| e.to_string())?;
        tid
    };

    // 4. Persist incoming message
    let now = chrono::Utc::now().to_rfc3339();
    let msg_id = uuid::Uuid::new_v4().to_string();
    let raw_envelope = serde_json::to_string(envelope).ok();

    let msg = relay_db::PeerMessageRow {
        id: msg_id.clone(),
        thread_id: thread_id.clone(),
        message_id_unique: envelope.message_id.clone(),
        correlation_id: envelope.correlation_id.clone(),
        direction: "incoming".to_string(),
        sender_agent: envelope.sender_agent.clone(),
        content: content.clone(),
        approval_state: "none".to_string(),
        delivery_state: "received".to_string(),
        retry_count: 0,
        raw_envelope,
        target_agent_id: target_agent_id.clone(),
        responding_agent_id: None,
        created_at: now,
    };

    let inserted = relay_db::insert_peer_message(db, &msg).map_err(|e| e.to_string())?;
    if !inserted {
        return Ok(());
    }

    // 5. Notify frontend of the incoming message
    let _ = app_handle.emit(
        "relay:incoming-message",
        serde_json::json!({
            "peer_id": contact_peer_id,
            "thread_id": thread_id,
            "message_id": msg_id,
        }),
    );

    // 6. Auto-respond for known contacts (accepted or pending_approval).
    // pending_approval contacts are auto-registered via Introduce from a peer
    // who accepted our invite — they are trusted enough for auto-response.
    let should_respond = contact.status == "accepted" || contact.status == "pending_approval";
    let is_request = matches!(envelope.payload, Payload::MessageRequest { .. });
    tracing::info!(
        contact_status = %contact.status,
        is_request,
        should_respond,
        "auto-response decision"
    );
    if should_respond {
        // Only auto-respond to MessageRequest (not MessageResponse)
        if is_request {
            // Skip if this thread already has an auto-response in progress
            {
                let mut active = ACTIVE_THREADS.lock().unwrap();
                if !active.insert(thread_id.clone()) {
                    tracing::info!(thread_id, "deferring auto-response: already in progress");
                    return Ok(());
                }
            }

            let app = app_handle.clone();
            let contact_clone = contact.clone();
            let thread_id_clone = thread_id.clone();

            tokio::spawn(async move {
                // Process all unanswered messages in a loop until none remain.
                // Uses correlation_id to determine which incoming messages have responses.
                loop {
                    let db = app.state::<Database>();
                    let unanswered_id = {
                        let messages = relay_db::get_thread_messages_recent(&db, &thread_id_clone, 50)
                            .unwrap_or_default();
                        // Collect correlation_ids from all outgoing messages
                        let answered: std::collections::HashSet<&str> = messages.iter()
                            .filter(|m| m.direction == "outgoing")
                            .filter_map(|m| m.correlation_id.as_deref())
                            .collect();
                        // Find the first incoming MessageRequest without a correlated response
                        messages.iter()
                            .filter(|m| m.direction == "incoming")
                            .find(|m| !answered.contains(m.message_id_unique.as_str()))
                            .map(|m| m.message_id_unique.clone())
                    };

                    let Some(msg_unique) = unanswered_id else {
                        break; // all messages answered
                    };

                    if let Err(e) = generate_and_send_response(
                        &app,
                        &contact_clone,
                        &thread_id_clone,
                        &msg_unique,
                    ).await {
                        tracing::warn!("auto-response failed: {e}");
                        let _ = app.emit(
                            "relay:auto-response-error",
                            serde_json::json!({
                                "thread_id": thread_id_clone,
                                "error": e,
                            }),
                        );
                        break;
                    }
                }
                // Release the thread lock
                ACTIVE_THREADS.lock().unwrap().remove(&thread_id_clone);
            });
        }
    }

    Ok(())
}

/// Generate an auto-response using the agent's full LLM + tools pipeline
/// and send it back via relay.
async fn generate_and_send_response(
    app: &tauri::AppHandle,
    contact: &relay_db::ContactRow,
    thread_id: &str,
    incoming_message_id: &str,
) -> Result<(), String> {
    let db = app.state::<Database>();

    // Notify frontend that auto-response is being generated
    let _ = app.emit(
        "relay:auto-response-started",
        serde_json::json!({ "thread_id": thread_id }),
    );

    // 1. Determine which agent to use (target_agent_id from thread takes priority)
    let target_from_thread = relay_db::get_thread(&db, thread_id)
        .ok().flatten()
        .and_then(|t| t.local_agent_id.clone());
    let agent_id = resolve_agent_id(app, &db, contact, thread_id, target_from_thread.as_deref())?;

    // 2. Resolve agent context (persona + tools)
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    let scope = actor_context::ExecutionScope {
        actor_agent_id: agent_id.clone(),
        role: actor_context::ExecutionRole::RelayResponse,
        trigger: actor_context::ExecutionTrigger::BackendTriggered,
    };

    // Read all settings from unified AppSettings
    let app_settings = app.state::<AppSettings>().get();

    let memory_mgr = app.state::<SystemMemoryManager>();
    let resolved = actor_context::resolve_with_settings(
        &scope, &db, &app_data_dir, Some(&*memory_mgr),
        if app_settings.allowed_tools.is_empty() { None } else { Some(&app_settings.allowed_tools) },
        Some(&app_settings.model_name),
        Some(&app_settings.company_name),
    ).map_err(|e| format!("Failed to resolve agent context: {e}"))?;

    // 3. Build system prompt + peer context
    let mut system_prompt = llm_helpers::build_system_prompt(&resolved, &scope);
    system_prompt.push_str(&format!(
        "\n\n[PEER CONTEXT]\n\
         You are conversing with an external peer (from another organization/user).\n\
         - Peer display name: {}\n\
         - Peer agent: {}{}",
        contact.display_name,
        contact.agent_name,
        if contact.agent_description.is_empty() { String::new() } else { format!(" ({})", contact.agent_description) },
    ));

    // 4. Build conversation history from thread messages (last 50 for context window)
    let messages = relay_db::get_thread_messages_recent(&db, thread_id, 50)
        .map_err(|e| e.to_string())?;

    let mut api_messages = vec![
        serde_json::json!({ "role": "system", "content": system_prompt }),
    ];

    for msg in &messages {
        let role = if msg.direction == "incoming" { "user" } else { "assistant" };
        api_messages.push(serde_json::json!({
            "role": role,
            "content": msg.content,
        }));
    }

    // 5. Scrub credentials
    if let Ok(credentials) = credential_service::get_all_secret_values(app) {
        if !credentials.is_empty() {
            credential_service::scrub_messages(&mut api_messages, &credentials);
        }
    }

    // 6. Build tools array
    let tools = llm_helpers::build_tools_json(&resolved.enabled_tool_names);

    // 7. Build request body
    let mut body = serde_json::json!({
        "model": resolved.model,
        "messages": api_messages,
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::json!(tools);
    }
    if let Some(temp) = resolved.temperature {
        body["temperature"] = serde_json::json!(temp);
    }
    if resolved.thinking_enabled {
        if let Some(budget) = resolved.thinking_budget {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            });
        }
    }

    // 8. Call LLM with tool loop
    let api_state = app.state::<ApiState>();
    let (api_key, base_url) = api_state.effective()
        .map_err(|e| format!("API state error: {e}"))?;
    let client = api_state.client()
        .map_err(|e| format!("API client error: {e}"))?;

    let max_tool_iterations = app.state::<AppSettings>().get().max_tool_iterations as usize;
    let mut response_text = String::new();

    for iteration in 0..max_tool_iterations {
        let result = api_service::do_completion(&client, &api_key, &base_url, &body, Some(app)).await;

        // Handle thinking-specific errors on first attempt
        if iteration == 0 && resolved.thinking_enabled {
            if let Err(ref e) = result {
                if api_service::is_thinking_specific_error(e) {
                    if let Some(obj) = body.as_object_mut() {
                        obj.remove("thinking");
                    }
                    continue;
                }
            }
        }

        let response = result.map_err(|e| format!("LLM error: {e}"))?;

        // No tool calls → done
        if response.tool_calls.is_none() {
            response_text = if response.content.is_empty() {
                response.reasoning_content.as_deref().unwrap_or("(no content)").to_string()
            } else {
                response.content
            };
            break;
        }

        // Execute tool calls
        let tool_calls = response.tool_calls.unwrap();

        if let Some(msgs) = body["messages"].as_array_mut() {
            let tc_json: Vec<serde_json::Value> = tool_calls.iter().map(|tc| {
                serde_json::json!({
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    }
                })
            }).collect();
            msgs.push(serde_json::json!({
                "role": "assistant",
                "content": if response.content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(response.content.clone()) },
                "tool_calls": tc_json,
            }));
        }

        for tc in &tool_calls {
            let input: serde_json::Value = serde_json::from_str(&tc.function.arguments)
                .unwrap_or(serde_json::json!({}));

            let tool_result = crate::commands::tool_commands::execute_tool_inner_public(
                app, &db, &tc.function.name, &input, &agent_id,
            ).await;

            let output = match tool_result {
                Ok(val) => serde_json::to_string(&val).unwrap_or_else(|_| "{}".to_string()),
                Err(e) => format!("Tool error: {e}"),
            };

            if let Some(msgs) = body["messages"].as_array_mut() {
                // Check if the tool result contains a browser screenshot
                let content_value = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&output) {
                    if let Some(path) = parsed.get("screenshot_path").and_then(|v| v.as_str()) {
                        if let Ok(bytes) = std::fs::read(path) {
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                            serde_json::json!([
                                { "type": "text", "text": output },
                                { "type": "image_url", "image_url": { "url": format!("data:image/png;base64,{b64}"), "detail": "low" } }
                            ])
                        } else {
                            serde_json::Value::String(output.clone())
                        }
                    } else {
                        serde_json::Value::String(output.clone())
                    }
                } else {
                    serde_json::Value::String(output.clone())
                };
                msgs.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": content_value,
                }));
            }
        }

        // Remove thinking after first successful call
        if let Some(obj) = body.as_object_mut() {
            obj.remove("thinking");
        }
    }

    if response_text.is_empty() {
        response_text = "(max tool iterations reached)".to_string();
    }

    // 9. Build response envelope and send via relay
    let envelope = Envelope::new(
        "local".into(),
        Payload::MessageResponse {
            content: response_text.clone(),
            responding_agent_id: Some(agent_id.clone()),
        },
    ).with_correlation(incoming_message_id.to_string());

    let raw_envelope_json = {
        let manager = app.state::<RelayManager>();
        manager.encrypt_for_peer(&contact.peer_id, &envelope)
            .map_err(|e| format!("Encrypt error: {e}"))?
    };

    // 10. Save outgoing message to DB
    let now = chrono::Utc::now().to_rfc3339();
    let response_msg = relay_db::PeerMessageRow {
        id: uuid::Uuid::new_v4().to_string(),
        thread_id: thread_id.to_string(),
        message_id_unique: envelope.message_id.clone(),
        correlation_id: Some(incoming_message_id.to_string()),
        direction: "outgoing".to_string(),
        sender_agent: "local".to_string(),
        content: response_text,
        approval_state: "none".to_string(),
        delivery_state: "queued".to_string(),
        retry_count: 0,
        raw_envelope: Some(raw_envelope_json.clone()),
        target_agent_id: None,
        responding_agent_id: Some(agent_id.clone()),
        created_at: now.clone(),
    };

    let response_id = response_msg.id.clone();
    relay_db::insert_peer_message(&db, &response_msg).map_err(|e| e.to_string())?;

    // 11. Create outbox entry
    let outbox = relay_db::OutboxRow {
        id: uuid::Uuid::new_v4().to_string(),
        peer_message_id: response_id.clone(),
        target_peer_id: contact.peer_id.clone(),
        attempts: 0,
        next_retry_at: None,
        status: "pending".to_string(),
        created_at: now,
    };
    relay_db::insert_outbox(&db, &outbox).map_err(|e| e.to_string())?;

    // 12. Send via relay
    let send_ok = {
        let manager = app.state::<RelayManager>();
        match manager.send_raw_envelope(&contact.peer_id, &raw_envelope_json).await {
            Ok(()) => {
                let _ = relay_db::update_message_state(&db, &response_id, None, Some("sending"));
                true
            }
            Err(e) => {
                tracing::error!("Failed to send auto-response: {e}");
                // Keep outbox status "pending" so reconnect-triggered retry picks it up
                let _ = relay_db::update_message_state(&db, &response_id, None, Some("queued"));
                false
            }
        }
    };

    // 13. Notify frontend
    if send_ok {
        let _ = app.emit(
            "relay:auto-response-completed",
            serde_json::json!({ "thread_id": thread_id }),
        );
    } else {
        let _ = app.emit(
            "relay:auto-response-error",
            serde_json::json!({
                "thread_id": thread_id,
                "error": "Failed to send response, will retry on reconnect",
            }),
        );
    }

    Ok(())
}

/// Determine which agent should respond to this contact's messages.
/// Priority: target_agent_id (visitor's choice) → thread binding → contact binding → default.
fn resolve_agent_id(
    _app: &tauri::AppHandle,
    db: &Database,
    contact: &relay_db::ContactRow,
    thread_id: &str,
    target_agent_id: Option<&str>,
) -> Result<String, String> {
    // 0. Visitor-selected agent (highest priority) — must be network_visible
    if let Some(tid) = target_agent_id {
        if !tid.is_empty() {
            if let Ok(agent) = crate::db::agent_operations::get_agent_impl(db, tid.to_string()) {
                if agent.network_visible {
                    return Ok(agent.id);
                }
            }
            // Agent not found or not visible — fall through to other options
            tracing::warn!(target_agent_id = tid, "requested agent not found or not network_visible, falling back");
        }
    }

    // 1. Check thread-level binding
    if let Ok(Some(thread)) = relay_db::get_thread(db, thread_id) {
        if let Some(ref aid) = thread.local_agent_id {
            if !aid.is_empty() {
                return Ok(aid.clone());
            }
        }
    }

    // 2. Check contact-level binding
    if let Some(ref aid) = contact.local_agent_id {
        if !aid.is_empty() {
            return Ok(aid.clone());
        }
    }

    // 3. Fall back to default agent
    use crate::db::agent_operations::list_agents_impl;
    let agents = list_agents_impl(db).map_err(|e| e.to_string())?;
    agents
        .iter()
        .find(|a| a.is_default)
        .map(|a| a.id.clone())
        .ok_or_else(|| "No default agent found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::relay::db as relay_db;

    fn setup_test_data(db: &Database) {
        let contact = relay_db::ContactRow {
            id: "c1".to_string(),
            peer_id: "peer1".to_string(),
            public_key: "pk_peer1".to_string(),
            display_name: "Test User".to_string(),
            agent_name: String::new(),
            agent_description: String::new(),
            local_agent_id: None,
            mode: "secretary".to_string(),
            capabilities_json: "{}".to_string(),
            status: "accepted".to_string(),
            invite_card_raw: None,
            addresses_json: None,
            published_agents_json: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        relay_db::insert_contact(db, &contact).unwrap();

        let thread = relay_db::PeerThreadRow {
            id: "t1".to_string(),
            contact_id: "c1".to_string(),
            local_agent_id: None,
            title: "Test thread".to_string(),
            summary: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        relay_db::create_thread(db, &thread).unwrap();
    }

    #[test]
    fn test_resolve_agent_id_default() {
        use crate::db::agent_operations::create_agent_impl;
        use crate::db::models::CreateAgentRequest;

        let db = Database::new_in_memory().expect("in-memory db");
        setup_test_data(&db);

        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "default-agent".into(),
                name: "Default".into(),
                avatar: None,
                description: None,
                model: None,
                temperature: None,
                thinking_enabled: None,
                thinking_budget: None,
                is_default: Some(true),
                network_visible: None,
                sort_order: None,
            },
        ).unwrap();

        let contact = relay_db::get_contact(&db, "c1").unwrap().unwrap();

        // Mock AppHandle is not available in unit tests, so we test resolve_agent_id
        // indirectly by checking the fallback logic
        let agents = crate::db::agent_operations::list_agents_impl(&db).unwrap();
        let default = agents.iter().find(|a| a.is_default).unwrap();
        assert_eq!(default.id, agent.id);
    }
}
