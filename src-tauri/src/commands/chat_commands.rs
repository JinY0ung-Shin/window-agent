use crate::commands::vault_commands::VaultState;
use crate::db::models::{ConversationDetail, ConversationListItem, DeleteMessagesResult, Message, PendingConsolidation, SaveMessageRequest, ToolCallLog};
use crate::db::operations;
use crate::db::Database;
use crate::error::AppError;
use crate::memory::SystemMemoryManager;
use crate::vault::strip_title_heading;
use base64::Engine;
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
pub fn create_team_conversation(
    db: State<'_, Database>,
    team_id: String,
    leader_agent_id: String,
    title: Option<String>,
) -> Result<ConversationListItem, AppError> {
    Ok(operations::create_team_conversation_impl(&db, team_id, leader_agent_id, title)?)
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

    // Collect chat image attachment paths before DB cascade
    let chat_image_paths = operations::get_message_attachment_paths(&db, &conversation_id)
        .unwrap_or_default();

    // Delete conversation (cascades browser_artifacts rows via FK)
    operations::delete_conversation_impl(&db, conversation_id)?;

    // Clean up screenshot files after DB deletion
    for path in screenshot_paths {
        let _ = std::fs::remove_file(&path);
    }
    // Clean up chat image files
    for path in chat_image_paths {
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
) -> Result<serde_json::Value, AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    let note = vm.create_note(&agent_id, None, "knowledge", &title, &content, vec![], vec![])
        .map_err(AppError::Vault)?;
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
) -> Result<Vec<serde_json::Value>, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
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
) -> Result<serde_json::Value, AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    let note = vm.update_note(
        &id,
        "user",
        title.as_deref(),
        content.as_deref(),
        None,
        None,
        None,
    ).map_err(AppError::Vault)?;
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
) -> Result<(), AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    vm.delete_note(&id, "user").map_err(AppError::Vault)
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

#[tauri::command]
pub fn list_pending_consolidations(
    db: State<'_, Database>,
) -> Result<Vec<PendingConsolidation>, AppError> {
    Ok(operations::list_pending_consolidations_impl(&db)?)
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

// ── Image I/O ──

/// Read a file from the app data directory as base64.
/// Only allows reading from browser_screenshots and chat_images subdirectories.
#[tauri::command]
pub fn read_file_base64(app: AppHandle, path: String) -> Result<String, AppError> {
    let app_data = app.path().app_data_dir()
        .map_err(|e| AppError::Io(format!("app_data_dir: {e}")))?;
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| AppError::Io(format!("canonicalize: {e}")))?;
    let allowed_dirs = [
        app_data.join("browser_screenshots"),
        app_data.join("chat_images"),
    ];
    if !allowed_dirs.iter().any(|d| canonical.starts_with(d)) {
        return Err(AppError::Validation("Path not in allowed directory".into()));
    }
    let bytes = std::fs::read(&canonical)
        .map_err(|e| AppError::Io(format!("read file: {e}")))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// Save a user-uploaded image to disk. Returns the absolute path.
/// Resizes to max 1024px on the longest side to keep file sizes reasonable.
#[tauri::command]
pub fn save_chat_image(app: AppHandle, image_base64: String) -> Result<String, AppError> {
    use std::io::Cursor;

    let app_data = app.path().app_data_dir()
        .map_err(|e| AppError::Io(format!("app_data_dir: {e}")))?;
    let images_dir = app_data.join("chat_images");
    std::fs::create_dir_all(&images_dir)
        .map_err(|e| AppError::Io(format!("mkdir: {e}")))?;

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| AppError::Validation(format!("base64 decode: {e}")))?;

    let img = image::load_from_memory(&bytes)
        .map_err(|e| AppError::Validation(format!("load image: {e}")))?;

    // Resize if larger than 1024px on any side
    let max_dim = 1024;
    let resized = if img.width() > max_dim || img.height() > max_dim {
        img.resize(max_dim, max_dim, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };

    let id = uuid::Uuid::new_v4().to_string();
    let path = images_dir.join(format!("{id}.png"));

    let mut buf = Cursor::new(Vec::new());
    resized.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| AppError::Io(format!("encode png: {e}")))?;
    std::fs::write(&path, buf.into_inner())
        .map_err(|e| AppError::Io(format!("write file: {e}")))?;

    Ok(path.to_string_lossy().to_string())
}
