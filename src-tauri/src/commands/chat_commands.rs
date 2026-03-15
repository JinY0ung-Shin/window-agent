use crate::db::models::{ConversationDetail, ConversationListItem, DeleteMessagesResult, MemoryNote, Message, SaveMessageRequest, ToolCallLog};
use crate::db::operations;
use crate::db::Database;
use crate::error::AppError;
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
pub fn delete_messages_from(
    db: State<'_, Database>,
    conversation_id: String,
    message_id: String,
) -> Result<(), AppError> {
    Ok(operations::delete_messages_from_impl(&db, conversation_id, message_id)?)
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

// ── Memory Notes ──

#[tauri::command]
pub fn create_memory_note(
    db: State<'_, Database>,
    agent_id: String,
    title: String,
    content: String,
) -> Result<MemoryNote, AppError> {
    Ok(operations::create_memory_note_impl(&db, agent_id, title, content)?)
}

#[tauri::command]
pub fn list_memory_notes(
    db: State<'_, Database>,
    agent_id: String,
) -> Result<Vec<MemoryNote>, AppError> {
    Ok(operations::list_memory_notes_impl(&db, agent_id)?)
}

#[tauri::command]
pub fn update_memory_note(
    db: State<'_, Database>,
    id: String,
    title: Option<String>,
    content: Option<String>,
) -> Result<MemoryNote, AppError> {
    Ok(operations::update_memory_note_impl(&db, id, title, content)?)
}

#[tauri::command]
pub fn delete_memory_note(
    db: State<'_, Database>,
    id: String,
) -> Result<(), AppError> {
    Ok(operations::delete_memory_note_impl(&db, id)?)
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
