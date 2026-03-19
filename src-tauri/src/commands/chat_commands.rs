use crate::commands::vault_commands::VaultState;
use crate::db::models::{ConversationDetail, ConversationListItem, DeleteMessagesResult, Message, SaveMessageRequest, ToolCallLog};
use crate::db::operations;
use crate::db::Database;
use crate::error::AppError;
use crate::memory::SystemMemoryManager;
use crate::vault::strip_title_heading;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn create_conversation(
    db: State<'_, Database>,
    title: Option<String>,
    agent_id: String,
) -> Result<ConversationListItem, AppError> {
    Ok(operations::create_conversation_impl(&db, title, agent_id)?)
}

#[tauri::command]
pub fn get_conversations(db: State<'_, Database>) -> Result<Vec<ConversationListItem>, AppError> {
    Ok(operations::get_conversations_impl(&db)?)
}

#[tauri::command]
pub fn get_conversation_detail(
    db: State<'_, Database>,
    id: String,
) -> Result<ConversationDetail, AppError> {
    Ok(operations::get_conversation_detail_impl(&db, id)?)
}

#[tauri::command]
pub fn get_messages(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<Vec<Message>, AppError> {
    Ok(operations::get_messages_impl(&db, conversation_id)?)
}

#[tauri::command]
pub fn save_message(
    db: State<'_, Database>,
    request: SaveMessageRequest,
) -> Result<Message, AppError> {
    Ok(operations::save_message_impl(&db, request)?)
}

#[tauri::command]
pub async fn delete_conversation(
    app: AppHandle,
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<(), AppError> {
    // Clean up browser session
    let browser = app.state::<crate::browser::BrowserManager>();
    let _ = browser.close_session(&conversation_id).await;

    // Collect screenshot paths before DB cascade deletes the rows
    let screenshot_paths = operations::get_browser_artifact_screenshot_paths(&db, &conversation_id)
        .unwrap_or_default();

    // Delete conversation (cascades browser_artifacts rows via FK)
    operations::delete_conversation_impl(&db, conversation_id)?;

    // Clean up screenshot files after DB deletion
    for path in screenshot_paths {
        let _ = std::fs::remove_file(&path);
    }

    Ok(())
}

#[tauri::command]
pub fn update_conversation_title(
    db: State<'_, Database>,
    id: String,
    title: String,
    expected_current: Option<String>,
) -> Result<i32, AppError> {
    Ok(operations::update_conversation_title_impl(&db, id, title, expected_current)?)
}

#[tauri::command]
pub fn update_conversation_summary(
    db: State<'_, Database>,
    id: String,
    summary: Option<String>,
    up_to_message_id: Option<String>,
    expected_previous: Option<String>,
) -> Result<i32, AppError> {
    Ok(operations::update_conversation_summary_impl(&db, id, summary, up_to_message_id, expected_previous)?)
}

#[tauri::command]
pub fn delete_messages_and_maybe_reset_summary(
    db: State<'_, Database>,
    conversation_id: String,
    message_id: String,
) -> Result<DeleteMessagesResult, AppError> {
    Ok(operations::delete_messages_and_maybe_reset_summary_impl(&db, conversation_id, message_id)?)
}

// ── Conversation Skills ──

#[tauri::command]
pub fn update_conversation_skills(
    db: State<'_, Database>,
    id: String,
    skills_json: Option<String>,
) -> Result<(), AppError> {
    Ok(operations::update_conversation_skills_impl(&db, id, skills_json)?)
}

// ── Learning Mode ──

#[tauri::command]
pub fn set_learning_mode(
    db: State<'_, Database>,
    id: String,
    enabled: bool,
) -> Result<(), AppError> {
    Ok(operations::set_learning_mode_impl(&db, id, enabled)?)
}

// ── Memory Notes (backed by Vault) ──

#[tauri::command]
pub fn create_memory_note(
    vault: State<'_, VaultState>,
    agent_id: String,
    title: String,
    content: String,
) -> Result<serde_json::Value, String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    let note = vm.create_note(&agent_id, None, "knowledge", &title, &content, vec![], vec![])?;
    Ok(serde_json::json!({
        "id": note.id,
        "agent_id": note.agent,
        "title": note.title,
        "content": strip_title_heading(&note.content),
        "created_at": note.created,
        "updated_at": note.updated,
    }))
}

#[tauri::command]
pub fn list_memory_notes(
    vault: State<'_, VaultState>,
    agent_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    let summaries = vm.list_notes(Some(&agent_id), None, None);
    Ok(summaries
        .into_iter()
        .filter(|n| n.scope.as_deref() != Some("shared"))
        .filter_map(|n| {
            let full = vm.read_note(&n.id).ok()?;
            Some(serde_json::json!({
                "id": full.id,
                "agent_id": full.agent,
                "title": full.title,
                "content": strip_title_heading(&full.content),
                "source_conversation": full.source_conversation,
                "created_at": full.created,
                "updated_at": full.updated,
            }))
        })
        .collect())
}

#[tauri::command]
pub fn update_memory_note(
    vault: State<'_, VaultState>,
    id: String,
    title: Option<String>,
    content: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    let note = vm.update_note(
        &id,
        "user",
        title.as_deref(),
        content.as_deref(),
        None,
        None,
        None,
    )?;
    Ok(serde_json::json!({
        "id": note.id,
        "agent_id": note.agent,
        "title": note.title,
        "content": strip_title_heading(&note.content),
        "created_at": note.created,
        "updated_at": note.updated,
    }))
}

#[tauri::command]
pub fn delete_memory_note(
    vault: State<'_, VaultState>,
    id: String,
) -> Result<(), String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.delete_note(&id, "user")
}

// ── Tool Call Logs ──

#[tauri::command]
pub fn create_tool_call_log(
    db: State<'_, Database>,
    conversation_id: String,
    message_id: Option<String>,
    tool_name: String,
    tool_input: String,
) -> Result<ToolCallLog, AppError> {
    Ok(operations::create_tool_call_log_impl(&db, conversation_id, message_id, tool_name, tool_input)?)
}

#[tauri::command]
pub fn list_tool_call_logs(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<Vec<ToolCallLog>, AppError> {
    Ok(operations::list_tool_call_logs_impl(&db, conversation_id)?)
}

#[tauri::command]
pub fn update_tool_call_log_status(
    db: State<'_, Database>,
    id: String,
    status: String,
    tool_output: Option<String>,
    duration_ms: Option<i64>,
) -> Result<(), AppError> {
    Ok(operations::update_tool_call_log_status_impl(&db, id, status, tool_output, duration_ms, None)?)
}

// ── System Memory (Consolidated) ──

#[tauri::command]
pub fn read_consolidated_memory(
    memory: State<'_, SystemMemoryManager>,
    agent_id: String,
) -> Option<String> {
    memory.read_consolidated(&agent_id)
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingConsolidation {
    pub conversation_id: String,
    pub agent_id: String,
}

#[tauri::command]
pub fn list_pending_consolidations(
    db: State<'_, Database>,
) -> Result<Vec<PendingConsolidation>, AppError> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT c.id, c.agent_id
                 FROM conversations c
                 WHERE (c.digest_id IS NULL OR c.consolidated_at IS NULL)
                   AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 3
                 ORDER BY c.updated_at DESC",
            )
            .map_err(|e| crate::db::error::DbError::Sqlite(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(PendingConsolidation {
                    conversation_id: row.get(0)?,
                    agent_id: row.get(1)?,
                })
            })
            .map_err(|e| crate::db::error::DbError::Sqlite(e.to_string()))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| crate::db::error::DbError::Sqlite(e.to_string()))?);
        }
        Ok(result)
    })
    .map_err(AppError::from)
}

#[tauri::command]
pub fn read_digest(
    memory: State<'_, SystemMemoryManager>,
    agent_id: String,
    conversation_id: String,
) -> Option<String> {
    memory.read_digest(&agent_id, &conversation_id)
}

#[tauri::command]
pub fn write_digest(
    memory: State<'_, SystemMemoryManager>,
    agent_id: String,
    conversation_id: String,
    content: String,
) -> Result<String, AppError> {
    memory.write_digest(&agent_id, &conversation_id, &content)
        .map_err(AppError::Io)
}

#[tauri::command]
pub fn write_consolidated_memory(
    memory: State<'_, SystemMemoryManager>,
    agent_id: String,
    content: String,
    version: u32,
) -> Result<(), AppError> {
    memory.write_consolidated(&agent_id, &content, version)
        .map_err(AppError::Io)
}

#[tauri::command]
pub fn update_conversation_digest(
    db: State<'_, Database>,
    conversation_id: String,
    digest_id: Option<String>,
) -> Result<(), AppError> {
    Ok(operations::update_conversation_digest_impl(&db, conversation_id, digest_id)?)
}

#[tauri::command]
pub fn update_conversation_consolidated(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    Ok(operations::update_conversation_consolidated_at_impl(&db, conversation_id, Some(now))?)
}

#[tauri::command]
pub fn archive_conversation_notes(
    vault: State<'_, VaultState>,
    conversation_id: String,
    agent_id: String,
) -> Result<u32, AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Io("Vault lock failed".to_string()))?;
    let notes = vm.list_notes(Some(&agent_id), None, None);
    let mut archived = 0u32;
    for note in &notes {
        if note.source_conversation.as_deref() == Some(&conversation_id) {
            if let Ok(()) = vm.archive_note(&note.id, &agent_id) {
                archived += 1;
            }
        }
    }
    Ok(archived)
}
