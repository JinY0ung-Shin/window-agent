use crate::db::agent_operations;
use crate::db::models::{Agent, CreateAgentRequest, UpdateAgentRequest};
use crate::db::Database;
use crate::error::AppError;
use crate::utils::path_security::{validate_agent_filename, validate_no_traversal};
use tauri::{AppHandle, Manager, State};

/// Validate a folder name to prevent path traversal and invalid directory names.
fn validate_folder_name(name: &str) -> Result<(), String> {
    validate_no_traversal(name, "folder name")
}

#[tauri::command]
pub fn create_agent(
    db: State<'_, Database>,
    request: CreateAgentRequest,
) -> Result<Agent, AppError> {
    validate_folder_name(&request.folder_name).map_err(AppError::Validation)?;
    Ok(agent_operations::create_agent_impl(&db, request)?)
}

#[tauri::command]
pub fn get_agent(db: State<'_, Database>, id: String) -> Result<Agent, AppError> {
    Ok(agent_operations::get_agent_impl(&db, id)?)
}

#[tauri::command]
pub fn list_agents(db: State<'_, Database>) -> Result<Vec<Agent>, AppError> {
    Ok(agent_operations::list_agents_impl(&db)?)
}

#[tauri::command]
pub fn update_agent(
    db: State<'_, Database>,
    id: String,
    request: UpdateAgentRequest,
) -> Result<Agent, AppError> {
    Ok(agent_operations::update_agent_impl(&db, id, request)?)
}

#[tauri::command]
pub fn delete_agent(app: AppHandle, db: State<'_, Database>, id: String) -> Result<(), AppError> {
    // Get the agent's folder_name before deleting
    let agent = agent_operations::get_agent_impl(&db, id.clone())?;
    let folder_name = &agent.folder_name;

    validate_folder_name(folder_name).map_err(AppError::Validation)?;

    // Delete folder FIRST so that if it fails, DB (and conversations) remain intact
    let agents_dir = get_agents_dir(&app).map_err(AppError::Io)?;
    let folder_path = agents_dir.join(folder_name);
    if folder_path.exists() {
        // Verify the canonical path is still within agents_dir
        let canonical = folder_path.canonicalize()
            .map_err(|e| AppError::Io(format!("Cannot resolve path: {e}")))?;
        let canonical_base = agents_dir.canonicalize()
            .map_err(|e| AppError::Io(format!("Cannot resolve agents dir: {e}")))?;
        if !canonical.starts_with(&canonical_base) {
            return Err(AppError::Validation("Folder path escapes agents directory".into()));
        }
        std::fs::remove_dir_all(&folder_path)
            .map_err(|e| AppError::Io(format!("Failed to delete agent folder: {e}")))?;
    }

    // Folder removed (or didn't exist) — now safe to delete DB row
    agent_operations::delete_agent_impl(&db, id)?;

    Ok(())
}

/// Validate agent file inputs (file name whitelist + folder name path traversal check).
/// Delegates to path_security::validate_agent_filename.
fn validate_agent_file_inputs(folder_name: &str, file_name: &str) -> Result<(), String> {
    validate_agent_filename(folder_name, file_name)
}

/// Validate and resolve an agent file path, preventing path traversal.
fn resolve_agent_file_path(
    app: &AppHandle,
    folder_name: &str,
    file_name: &str,
) -> Result<std::path::PathBuf, String> {
    validate_agent_file_inputs(folder_name, file_name)?;

    let agents_dir = get_agents_dir(app)?;
    let resolved = agents_dir.join(folder_name).join(file_name);

    // Double-check the resolved path is inside agents_dir
    let canonical_agents = agents_dir.canonicalize().unwrap_or(agents_dir);
    if let Ok(canonical_resolved) = resolved.canonicalize() {
        if !canonical_resolved.starts_with(&canonical_agents) {
            return Err("Path traversal detected".to_string());
        }
    }
    // If the file doesn't exist yet (write case), canonicalize parent
    if let Some(parent) = resolved.parent() {
        if let Ok(canonical_parent) = parent.canonicalize() {
            if !canonical_parent.starts_with(&canonical_agents) {
                return Err("Path traversal detected".to_string());
            }
        }
    }

    Ok(resolved)
}

/// Write a .md file to the agent's directory under app_data_dir/agents/{folder_name}/
#[tauri::command]
pub fn write_agent_file(
    app: AppHandle,
    folder_name: String,
    file_name: String,
    content: String,
) -> Result<(), AppError> {
    let file_path = resolve_agent_file_path(&app, &folder_name, &file_name)
        .map_err(AppError::Validation)?;

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Io(format!("Failed to create agent directory: {}", e)))?;
    }

    std::fs::write(&file_path, &content)
        .map_err(|e| AppError::Io(format!("Failed to write file: {}", e)))?;

    Ok(())
}

/// Read a .md file from the agent's directory under app_data_dir/agents/{folder_name}/
#[tauri::command]
pub fn read_agent_file(
    app: AppHandle,
    folder_name: String,
    file_name: String,
) -> Result<String, AppError> {
    let file_path = resolve_agent_file_path(&app, &folder_name, &file_name)
        .map_err(AppError::Validation)?;

    std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Io(format!("Failed to read file: {}", e)))
}

/// Sync .md files from filesystem to DB on app startup.
/// For each folder in agents/, if not in DB, create a DB entry.
/// For folders in DB that no longer exist on disk, remove from DB.
#[tauri::command]
pub fn sync_agents_from_fs(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Vec<Agent>, AppError> {
    let agents_dir = get_agents_dir(&app).map_err(AppError::Io)?;

    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| AppError::Io(format!("Failed to create agents dir: {}", e)))?;

    let existing_agents = agent_operations::list_agents_impl(&db)?;

    let existing_folders: std::collections::HashSet<String> = existing_agents
        .iter()
        .map(|a| a.folder_name.clone())
        .collect();

    // Scan filesystem for agent folders
    let fs_entries = std::fs::read_dir(&agents_dir)
        .map_err(|e| AppError::Io(format!("Failed to read agents directory: {}", e)))?;

    let mut fs_folders = std::collections::HashSet::new();
    for entry in fs_entries {
        let entry = entry.map_err(|e| AppError::Io(format!("Failed to read dir entry: {}", e)))?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                fs_folders.insert(name.to_string());
            }
        }
    }

    // Add folders that exist on disk but not in DB
    for folder in &fs_folders {
        if !existing_folders.contains(folder) {
            // Skip folders with invalid names (e.g. hidden dirs, path traversal)
            if validate_folder_name(folder).is_err() {
                eprintln!("Warning: skipping invalid agent folder name: '{}'", folder);
                continue;
            }

            let name = folder.clone();

            let _ = agent_operations::create_agent_impl(
                &db,
                CreateAgentRequest {
                    folder_name: folder.clone(),
                    name,
                    avatar: None,
                    description: None,
                    model: None,
                    temperature: None,
                    thinking_enabled: None,
                    thinking_budget: None,
                    is_default: None,
                    sort_order: None,
                },
            );
        }
    }

    // Log warnings for DB entries whose folders no longer exist on disk.
    // We intentionally keep the DB rows to preserve conversation history;
    // the folder may have been deleted intentionally via delete_agent (which
    // already removes the DB row) or may be temporarily missing.
    for agent in &existing_agents {
        if !fs_folders.contains(&agent.folder_name) && !agent.is_default {
            eprintln!(
                "Warning: agent folder missing for '{}', keeping DB record",
                agent.folder_name
            );
        }
    }

    // Return updated list
    Ok(agent_operations::list_agents_impl(&db)?)
}

/// Seed the default manager agent on first run.
/// Creates the manager agent in DB and its .md files on disk.
#[tauri::command]
pub fn seed_manager_agent(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Agent, AppError> {
    // Check if manager already exists
    if let Ok(Some(agent)) =
        agent_operations::get_agent_by_folder_impl(&db, "매니저".into())
    {
        return Ok(agent);
    }

    let agent = agent_operations::create_agent_impl(
        &db,
        CreateAgentRequest {
            folder_name: "매니저".into(),
            name: "팀장".into(),
            avatar: None,
            description: Some("다른 직원을 안내하고 사용자의 질문에 답하는 팀장".into()),
            model: None,
            temperature: None,
            thinking_enabled: None,
            thinking_budget: None,
            is_default: Some(true),
            sort_order: Some(0),
        },
    )?;

    // Create .md files from bundled resources
    let agents_dir = get_agents_dir(&app).map_err(AppError::Io)?;
    let manager_dir = agents_dir.join("매니저");
    std::fs::create_dir_all(&manager_dir)
        .map_err(|e| AppError::Io(format!("Failed to create manager directory: {}", e)))?;

    let files = [
        ("IDENTITY.md", include_str!("../../resources/default-agent/IDENTITY.md")),
        ("SOUL.md", include_str!("../../resources/default-agent/SOUL.md")),
        ("USER.md", include_str!("../../resources/default-agent/USER.md")),
        ("AGENTS.md", include_str!("../../resources/default-agent/AGENTS.md")),
    ];

    for (filename, content) in &files {
        std::fs::write(manager_dir.join(filename), content)
            .map_err(|e| AppError::Io(format!("Failed to write {}: {}", filename, e)))?;
    }

    Ok(agent)
}

/// Resize avatar image to 128x128 and return as Base64 string.
/// Input: Base64-encoded image data (without data URI prefix).
#[tauri::command]
pub fn resize_avatar(image_base64: String) -> Result<String, AppError> {
    use std::io::Cursor;

    // Decode base64
    let image_bytes = base64_decode(&image_base64).map_err(AppError::Validation)?;

    // Load image
    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| AppError::Validation(format!("Failed to load image: {}", e)))?;

    // Resize to 128x128
    let resized = img.resize_exact(128, 128, image::imageops::FilterType::Lanczos3);

    // Encode as PNG to base64
    let mut buf = Cursor::new(Vec::new());
    resized
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| AppError::Io(format!("Failed to encode image: {}", e)))?;

    let encoded = base64_encode(&buf.into_inner());
    Ok(encoded)
}

/// Return the bootstrap prompt content (bundled at compile time).
#[tauri::command]
pub fn get_bootstrap_prompt() -> String {
    include_str!("../../resources/bootstrap.md").to_string()
}

fn get_agents_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join("agents"))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Simple base64 decode using a lookup table
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

fn base64_encode(input: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_accepts_identity_md() {
        assert!(validate_agent_file_inputs("my-agent", "IDENTITY.md").is_ok());
    }

    #[test]
    fn validate_accepts_all_allowed_file_names() {
        for name in &["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md"] {
            assert!(
                validate_agent_file_inputs("my-agent", name).is_ok(),
                "expected Ok for {name}"
            );
        }
    }

    #[test]
    fn validate_rejects_invalid_file_name() {
        let result = validate_agent_file_inputs("my-agent", "hack.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid file name"));
    }

    #[test]
    fn validate_rejects_empty_file_name() {
        let result = validate_agent_file_inputs("my-agent", "");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid file name"));
    }

    #[test]
    fn validate_rejects_folder_with_forward_slash() {
        let result = validate_agent_file_inputs("../../etc", "IDENTITY.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid folder name"));
    }

    #[test]
    fn validate_rejects_folder_with_backslash() {
        let result = validate_agent_file_inputs("..\\etc", "IDENTITY.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid folder name"));
    }

    #[test]
    fn validate_rejects_folder_with_double_dots() {
        let result = validate_agent_file_inputs("..", "IDENTITY.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid folder name"));
    }

    #[test]
    fn validate_accepts_valid_folder_name() {
        assert!(validate_agent_file_inputs("my-agent", "IDENTITY.md").is_ok());
    }
}
