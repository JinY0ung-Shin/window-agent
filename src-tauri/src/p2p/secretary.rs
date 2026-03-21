use crate::api::ApiState;
use crate::db::Database;
use crate::p2p::db as p2p_db;
use crate::p2p::envelope::{Envelope, Payload};
use crate::services::api_service;
use serde::Serialize;
use tauri::{Emitter, Manager};

const SUMMARY_MODEL: &str = "gpt-4o-mini";

/// Event payload emitted to frontend when approval is needed.
#[derive(Debug, Clone, Serialize)]
pub struct ApprovalNeeded {
    pub thread_id: String,
    pub message_id: String,
    pub sender_agent: String,
    pub summary: String,
    pub original_content: String,
}

/// Event payload for delivery status updates.
#[derive(Debug, Clone, Serialize)]
pub struct DeliveryUpdate {
    pub message_id: String,
    pub state: String,
}

/// Result of approving a message — includes envelope for sending.
pub struct ApproveResult {
    pub response_message_id: String,
    pub envelope: Envelope,
    pub target_peer_id: String,
    pub outbox_id: String,
}

/// Process an incoming message envelope from a remote peer.
/// Called by the P2PManager event loop when a MessageRequest is received.
pub async fn handle_incoming_message(
    app_handle: &tauri::AppHandle,
    db: &Database,
    contact_peer_id: &str,
    envelope: &Envelope,
) -> Result<(), String> {
    // 1. Extract content (MessageRequest or MessageResponse)
    let content = match &envelope.payload {
        Payload::MessageRequest { content } => content.clone(),
        Payload::MessageResponse { content } => content.clone(),
        _ => return Err("Expected MessageRequest or MessageResponse payload".into()),
    };

    // 2. Look up contact by peer_id
    let contact = p2p_db::get_contact_by_peer_id(db, contact_peer_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Unknown contact peer_id: {}", contact_peer_id))?;

    // 3. Find existing thread or create a new one
    let threads = p2p_db::list_threads_for_contact(db, &contact.id)
        .map_err(|e| e.to_string())?;
    let thread_id = if let Some(thread) = threads.first() {
        thread.id.clone()
    } else {
        let now = chrono::Utc::now().to_rfc3339();
        let new_thread = p2p_db::PeerThreadRow {
            id: uuid::Uuid::new_v4().to_string(),
            contact_id: contact.id.clone(),
            local_agent_id: contact.local_agent_id.clone(),
            title: format!("Conversation with {}", contact.display_name),
            summary: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let tid = new_thread.id.clone();
        p2p_db::create_thread(db, &new_thread).map_err(|e| e.to_string())?;
        tid
    };

    // 4. Persist message with INSERT OR IGNORE (idempotent on message_id_unique)
    let now = chrono::Utc::now().to_rfc3339();
    let msg_id = uuid::Uuid::new_v4().to_string();
    let raw_envelope = serde_json::to_string(envelope).ok();

    // Accepted contacts → auto-approve (normal chat), others → pending approval
    let is_accepted = contact.status == "accepted";
    let approval_state = if is_accepted { "none" } else { "pending" };

    let msg = p2p_db::PeerMessageRow {
        id: msg_id.clone(),
        thread_id: thread_id.clone(),
        message_id_unique: envelope.message_id.clone(),
        correlation_id: envelope.correlation_id.clone(),
        direction: "incoming".to_string(),
        sender_agent: envelope.sender_agent.clone(),
        content: content.clone(),
        approval_state: approval_state.to_string(),
        delivery_state: "received".to_string(),
        retry_count: 0,
        raw_envelope,
        created_at: now,
    };

    let inserted = p2p_db::insert_peer_message(db, &msg).map_err(|e| e.to_string())?;
    if !inserted {
        return Ok(());
    }

    if is_accepted {
        // Trusted contact — just notify frontend to refresh messages
        let _ = app_handle.emit(
            "p2p:incoming-message",
            serde_json::json!({
                "peer_id": contact_peer_id,
                "thread_id": thread_id,
                "message_id": msg_id,
            }),
        );
    } else {
        // Untrusted contact — require approval
        let api_state = app_handle.state::<ApiState>();
        let summary = generate_summary(&api_state, &content).await;

        app_handle
            .emit(
                "p2p:approval-needed",
                ApprovalNeeded {
                    thread_id,
                    message_id: msg_id,
                    sender_agent: envelope.sender_agent.clone(),
                    summary,
                    original_content: content,
                },
            )
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Generate a summary of the incoming message.
/// Uses an ISOLATED LLM call — no persona, vault, tools, or credentials injected.
/// Falls back to truncated preview if LLM is unavailable.
async fn generate_summary(api_state: &ApiState, content: &str) -> String {
    // Short messages don't need summarization
    if content.len() <= 200 {
        return content.to_string();
    }

    let (api_key, base_url) = match api_state.effective() {
        Ok(v) => v,
        Err(_) => return truncate_preview(content, 200),
    };

    // If no API access, fall back immediately
    if crate::api::requires_api_key(&api_key, &base_url) {
        return truncate_preview(content, 200);
    }

    let client = match api_state.client() {
        Ok(c) => c,
        Err(_) => return truncate_preview(content, 200),
    };
    let url = api_service::completions_url(&base_url);

    let body = serde_json::json!({
        "model": SUMMARY_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "Summarize the following message in one brief sentence. Do not include any personal opinions or additional context."
            },
            {
                "role": "user",
                "content": content
            }
        ],
        "temperature": 0.3,
        "max_tokens": 150,
    });

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    match req.json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(text) = json["choices"][0]["message"]["content"].as_str() {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        return trimmed.to_string();
                    }
                }
            }
            truncate_preview(content, 200)
        }
        _ => truncate_preview(content, 200),
    }
}

/// Truncate content to a preview string.
fn truncate_preview(content: &str, max_len: usize) -> String {
    if content.chars().count() <= max_len {
        content.to_string()
    } else {
        let truncated: String = content.chars().take(max_len).collect();
        format!("{}...", truncated)
    }
}

/// Approve a pending message, build a response envelope, create outbox entry, and return
/// everything needed for the caller to attempt sending.
pub fn approve_message(
    db: &Database,
    message_id: &str,
    response_content: &str,
) -> Result<ApproveResult, String> {
    // 1. Mark the incoming message as approved
    p2p_db::update_message_state(db, message_id, Some("approved"), None)
        .map_err(|e| e.to_string())?;

    // 2. Get the original message to find thread_id and correlation info
    let original = p2p_db::get_peer_message(db, message_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Message not found: {}", message_id))?;

    // 3. Get thread → contact → target peer_id
    let thread = p2p_db::get_thread(db, &original.thread_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Thread not found: {}", original.thread_id))?;
    let contact = p2p_db::get_contact(db, &thread.contact_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Contact not found: {}", thread.contact_id))?;

    // 4. Build MessageResponse envelope with correlation_id
    let envelope = Envelope::new(
        "local".into(),
        Payload::MessageResponse {
            content: response_content.to_string(),
        },
    )
    .with_correlation(original.message_id_unique.clone());

    let raw_envelope = serde_json::to_string(&envelope).ok();

    // 5. Create outgoing response message with raw_envelope
    let now = chrono::Utc::now().to_rfc3339();
    let response_msg = p2p_db::PeerMessageRow {
        id: uuid::Uuid::new_v4().to_string(),
        thread_id: original.thread_id,
        message_id_unique: envelope.message_id.clone(),
        correlation_id: Some(original.message_id_unique),
        direction: "outgoing".to_string(),
        sender_agent: "local".to_string(),
        content: response_content.to_string(),
        approval_state: "approved".to_string(),
        delivery_state: "queued".to_string(),
        retry_count: 0,
        raw_envelope,
        created_at: now.clone(),
    };

    let response_id = response_msg.id.clone();
    p2p_db::insert_peer_message(db, &response_msg).map_err(|e| e.to_string())?;

    // 6. Create outbox entry for retry/delivery tracking
    let outbox_id = uuid::Uuid::new_v4().to_string();
    let outbox = p2p_db::OutboxRow {
        id: outbox_id.clone(),
        peer_message_id: response_id.clone(),
        target_peer_id: contact.peer_id.clone(),
        attempts: 0,
        next_retry_at: None,
        status: "pending".to_string(),
        created_at: now,
    };
    p2p_db::insert_outbox(db, &outbox).map_err(|e| e.to_string())?;

    Ok(ApproveResult {
        response_message_id: response_id,
        envelope,
        target_peer_id: contact.peer_id,
        outbox_id,
    })
}

/// Reject a pending message.
pub fn reject_message(db: &Database, message_id: &str) -> Result<(), String> {
    p2p_db::update_message_state(db, message_id, Some("rejected"), None)
        .map_err(|e| e.to_string())
}

/// Generate a draft response using the local agent's persona.
/// The result still requires user approval before sending.
/// Falls back to a basic acknowledgment if LLM is unavailable.
pub async fn generate_draft_response(
    app_handle: &tauri::AppHandle,
    _db: &Database,
    _message_id: &str,
    _agent_id: &str,
) -> Result<String, String> {
    const FALLBACK_DRAFT: &str = "감사합니다. 확인했습니다.";

    let api_state = app_handle.state::<ApiState>();
    let (api_key, base_url) = api_state.effective()?;

    // If no API access, return the basic fallback
    if crate::api::requires_api_key(&api_key, &base_url) {
        return Ok(FALLBACK_DRAFT.to_string());
    }

    // TODO: When agent persona loading is available, use LLM with persona context
    // For now, return the basic fallback
    Ok(FALLBACK_DRAFT.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── truncate_preview tests ──

    #[test]
    fn test_truncate_short_content() {
        let result = truncate_preview("hello", 200);
        assert_eq!(result, "hello");
    }

    #[test]
    fn test_truncate_exact_limit() {
        let content = "a".repeat(200);
        let result = truncate_preview(&content, 200);
        assert_eq!(result, content);
    }

    #[test]
    fn test_truncate_over_limit() {
        let content = "a".repeat(250);
        let result = truncate_preview(&content, 200);
        assert_eq!(result.len(), 203); // 200 chars + "..."
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_truncate_empty() {
        let result = truncate_preview("", 200);
        assert_eq!(result, "");
    }

    #[test]
    fn test_truncate_multibyte_chars() {
        // Korean characters are multi-byte but should be counted as single chars
        let content = "가".repeat(250);
        let result = truncate_preview(&content, 200);
        let char_count = result.chars().count();
        // 200 Korean chars + 3 dots = 203 chars
        assert_eq!(char_count, 203);
        assert!(result.ends_with("..."));
    }

    // ── approve / reject tests ──

    #[test]
    fn test_approve_message() {
        let db = Database::new_in_memory().expect("in-memory db");
        setup_test_data(&db);

        let result =
            approve_message(&db, "m1", "감사합니다. 확인했습니다.").unwrap();

        let msgs = p2p_db::get_thread_messages(&db, "t1").unwrap();
        // Original message should be approved
        assert_eq!(msgs[0].approval_state, "approved");
        assert_eq!(msgs[0].delivery_state, "received");
        // A new outgoing response message should have been created
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[1].id, result.response_message_id);
        assert_eq!(msgs[1].direction, "outgoing");
        assert_eq!(msgs[1].content, "감사합니다. 확인했습니다.");
        assert_eq!(msgs[1].delivery_state, "queued");
        // Envelope should be set
        assert!(msgs[1].raw_envelope.is_some());
        // Outbox entry should exist
        assert_eq!(result.target_peer_id, "peer1");
        assert!(!result.outbox_id.is_empty());
    }

    #[test]
    fn test_reject_message() {
        let db = Database::new_in_memory().expect("in-memory db");
        setup_test_data(&db);

        reject_message(&db, "m1").unwrap();

        let msgs = p2p_db::get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs[0].approval_state, "rejected");
    }

    #[test]
    fn test_approve_then_reject_overwrites() {
        let db = Database::new_in_memory().expect("in-memory db");
        setup_test_data(&db);

        approve_message(&db, "m1", "response text").unwrap();
        reject_message(&db, "m1").unwrap();

        let msgs = p2p_db::get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs[0].approval_state, "rejected");
    }

    // ── Helper to set up contact → thread → message ──

    fn setup_test_data(db: &Database) {
        let contact = p2p_db::ContactRow {
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
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        p2p_db::insert_contact(db, &contact).unwrap();

        let thread = p2p_db::PeerThreadRow {
            id: "t1".to_string(),
            contact_id: "c1".to_string(),
            local_agent_id: None,
            title: "Test thread".to_string(),
            summary: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };
        p2p_db::create_thread(db, &thread).unwrap();

        let msg = p2p_db::PeerMessageRow {
            id: "m1".to_string(),
            thread_id: "t1".to_string(),
            message_id_unique: "unique-1".to_string(),
            correlation_id: None,
            direction: "incoming".to_string(),
            sender_agent: "remote-agent".to_string(),
            content: "hello world".to_string(),
            approval_state: "pending".to_string(),
            delivery_state: "received".to_string(),
            retry_count: 0,
            raw_envelope: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };
        p2p_db::insert_peer_message(db, &msg).unwrap();
    }
}
