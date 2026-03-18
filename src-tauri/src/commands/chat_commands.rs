use crate::commands::vault_commands::VaultState;
use crate::db::models::{ConversationDetail, ConversationListItem, DeleteMessagesResult, Message, SaveMessageRequest, ToolCallLog};
use crate::db::operations;
use crate::db::Database;
use crate::error::AppError;
use crate::vault::strip_title_heading;
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
    Ok(vm.to_legacy_json(&agent_id))
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
