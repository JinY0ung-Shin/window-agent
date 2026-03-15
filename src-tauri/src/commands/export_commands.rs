use crate::db::agent_operations;
use crate::db::models::*;
use crate::db::operations::*;
use crate::db::Database;
use crate::utils::path_security::validate_zip_entry;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read as _, Write as _};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use zip::write::FileOptions;

// ── Export types ──

#[derive(Serialize)]
struct ConversationExport {
    version: String,
    #[serde(rename = "type")]
    export_type: String,
    exported_at: String,
    conversation: ConversationDetail,
    messages: Vec<Message>,
}

#[derive(Serialize, Deserialize)]
struct AgentExportMeta {
    version: String,
    #[serde(rename = "type")]
    export_type: String,
    exported_at: String,
    agent: Agent,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub agents_imported: usize,
    pub conversations_imported: usize,
    pub messages_imported: usize,
    pub memory_notes_imported: usize,
    pub warnings: Vec<String>,
}

// ── Export conversation ──

#[tauri::command]
pub fn export_conversation(
    db: State<'_, Database>,
    conversation_id: String,
) -> Result<String, String> {
    let detail = get_conversation_detail_impl(&db, conversation_id.clone())
        .map_err(|e| format!("Failed to load conversation: {e}"))?;
    let messages = get_messages_impl(&db, conversation_id)
        .map_err(|e| format!("Failed to load messages: {e}"))?;

    let export = ConversationExport {
        version: "1.0".to_string(),
        export_type: "conversation".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        conversation: detail,
        messages,
    };

    serde_json::to_string_pretty(&export)
        .map_err(|e| format!("JSON serialization failed: {e}"))
}

// ── Export agent ──

#[tauri::command]
pub fn export_agent(
    app: AppHandle,
    db: State<'_, Database>,
    agent_id: String,
    include_conversations: bool,
) -> Result<Vec<u8>, String> {
    let agent = agent_operations::get_agent_impl(&db, agent_id.clone())
        .map_err(|e| format!("Failed to load agent: {e}"))?;

    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buf);
        let options = FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // agent.json
        let meta = AgentExportMeta {
            version: "1.0".to_string(),
            export_type: "agent".to_string(),
            exported_at: chrono::Utc::now().to_rfc3339(),
            agent: agent.clone(),
        };
        let meta_json = serde_json::to_string_pretty(&meta)
            .map_err(|e| format!("JSON error: {e}"))?;
        zip.start_file("agent.json", options.clone())
            .map_err(|e| format!("ZIP error: {e}"))?;
        zip.write_all(meta_json.as_bytes())
            .map_err(|e| format!("ZIP write error: {e}"))?;

        // persona files
        let agents_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to resolve app dir: {e}"))?
            .join("agents")
            .join(&agent.folder_name);

        let persona_files = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md"];
        for fname in &persona_files {
            let path = agents_dir.join(fname);
            if path.exists() {
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| format!("Failed to read {fname}: {e}"))?;
                zip.start_file(format!("persona/{fname}"), options.clone())
                    .map_err(|e| format!("ZIP error: {e}"))?;
                zip.write_all(content.as_bytes())
                    .map_err(|e| format!("ZIP write error: {e}"))?;
            }
        }

        // skills directory
        let skills_dir = agents_dir.join("skills");
        if skills_dir.is_dir() {
            fn walk_dir_recursive(
                dir: &std::path::Path,
                base: &std::path::Path,
                zip: &mut zip::ZipWriter<&mut Cursor<Vec<u8>>>,
                options: &FileOptions<()>,
            ) -> Result<(), String> {
                let entries = std::fs::read_dir(dir)
                    .map_err(|e| format!("Failed to read skills dir: {e}"))?;
                for entry in entries.flatten() {
                    let path = entry.path();
                    let relative = path
                        .strip_prefix(base)
                        .map_err(|e| format!("Path strip error: {e}"))?;
                    let zip_path = format!("skills/{}", relative.to_string_lossy().replace('\\', "/"));
                    if path.is_dir() {
                        walk_dir_recursive(&path, base, zip, options)?;
                    } else if path.is_file() {
                        let content = std::fs::read(&path)
                            .map_err(|e| format!("Failed to read skill file: {e}"))?;
                        zip.start_file(zip_path, options.clone())
                            .map_err(|e| format!("ZIP error: {e}"))?;
                        zip.write_all(&content)
                            .map_err(|e| format!("ZIP write error: {e}"))?;
                    }
                }
                Ok(())
            }
            walk_dir_recursive(&skills_dir, &skills_dir, &mut zip, &options)?;
        }

        // memory notes
        let notes = list_memory_notes_impl(&db, agent_id.clone())
            .map_err(|e| format!("Failed to load memory notes: {e}"))?;
        if !notes.is_empty() {
            let notes_json = serde_json::to_string_pretty(&notes)
                .map_err(|e| format!("JSON error: {e}"))?;
            zip.start_file("memory_notes.json", options.clone())
                .map_err(|e| format!("ZIP error: {e}"))?;
            zip.write_all(notes_json.as_bytes())
                .map_err(|e| format!("ZIP write error: {e}"))?;
        }

        // conversations
        if include_conversations {
            let all_convs = get_conversations_impl(&db)
                .map_err(|e| format!("Failed to load conversations: {e}"))?;
            let agent_convs: Vec<_> = all_convs
                .into_iter()
                .filter(|c| c.agent_id == agent_id)
                .collect();

            for conv in &agent_convs {
                let detail = get_conversation_detail_impl(&db, conv.id.clone())
                    .map_err(|e| format!("Failed to load conversation detail: {e}"))?;
                let messages = get_messages_impl(&db, conv.id.clone())
                    .map_err(|e| format!("Failed to load messages: {e}"))?;

                let conv_export = ConversationExport {
                    version: "1.0".to_string(),
                    export_type: "conversation".to_string(),
                    exported_at: chrono::Utc::now().to_rfc3339(),
                    conversation: detail,
                    messages,
                };
                let conv_json = serde_json::to_string_pretty(&conv_export)
                    .map_err(|e| format!("JSON error: {e}"))?;

                zip.start_file(format!("conversations/{}.json", conv.id), options.clone())
                    .map_err(|e| format!("ZIP error: {e}"))?;
                zip.write_all(conv_json.as_bytes())
                    .map_err(|e| format!("ZIP write error: {e}"))?;
            }
        }

        zip.finish().map_err(|e| format!("ZIP finalize error: {e}"))?;
    }

    Ok(buf.into_inner())
}

// ── Import agent ──

#[tauri::command]
pub fn import_agent(
    app: AppHandle,
    db: State<'_, Database>,
    zip_bytes: Vec<u8>,
) -> Result<ImportResult, String> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| format!("Invalid ZIP file: {e}"))?;

    let mut warnings: Vec<String> = Vec::new();

    // 1. Read agent.json
    let agent_meta: AgentExportMeta = {
        let mut file = archive.by_name("agent.json")
            .map_err(|_| "ZIP missing agent.json".to_string())?;
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| format!("Failed to read agent.json: {e}"))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Invalid agent.json: {e}"))?
    };

    let old_agent = agent_meta.agent;

    // 2. Determine new IDs and folder name
    let new_agent_id = Uuid::new_v4().to_string();
    let mut new_folder = old_agent.folder_name.clone();

    // Check folder_name collision
    if let Ok(Some(_)) = agent_operations::get_agent_by_folder_impl(&db, new_folder.clone()) {
        let mut suffix = 1;
        loop {
            let candidate = format!("{}-imported-{}", old_agent.folder_name, suffix);
            if agent_operations::get_agent_by_folder_impl(&db, candidate.clone())
                .map(|o| o.is_none())
                .unwrap_or(true)
            {
                new_folder = candidate;
                break;
            }
            suffix += 1;
            if suffix > 100 {
                return Err("Too many folder name collisions".to_string());
            }
        }
        warnings.push(format!(
            "folder_name '{}' 중복 → '{}' 로 변경",
            old_agent.folder_name, new_folder
        ));
    }

    // 3. Read persona files from ZIP
    let persona_files_list = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOLS.md"];
    let mut persona_contents: Vec<(String, String)> = Vec::new();
    for fname in &persona_files_list {
        let zip_path = format!("persona/{fname}");
        if let Ok(mut file) = archive.by_name(&zip_path) {
            let mut content = String::new();
            if file.read_to_string(&mut content).is_ok() {
                persona_contents.push((fname.to_string(), content));
            }
        }
    }

    // 4. Read memory notes
    let memory_notes: Vec<MemoryNote> = if let Ok(mut file) = archive.by_name("memory_notes.json") {
        let mut content = String::new();
        if file.read_to_string(&mut content).is_ok() {
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // 4b. Collect skills file entries from ZIP
    let mut skill_files: Vec<(String, Vec<u8>)> = Vec::new();
    {
        let skill_file_names: Vec<String> = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
            .filter(|name| name.starts_with("skills/") && !name.ends_with('/'))
            .collect();
        for name in &skill_file_names {
            if let Ok(mut file) = archive.by_name(name) {
                let mut buf = Vec::new();
                if std::io::Read::read_to_end(&mut file, &mut buf).is_ok() {
                    skill_files.push((name.clone(), buf));
                }
            }
        }
    }

    // 5. Read conversations
    let mut conversations: Vec<(ConversationDetail, Vec<Message>)> = Vec::new();
    let file_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    for name in &file_names {
        if name.starts_with("conversations/") && name.ends_with(".json") {
            if let Ok(mut file) = archive.by_name(name) {
                let mut content = String::new();
                if file.read_to_string(&mut content).is_ok() {
                    if let Ok(conv_export) = serde_json::from_str::<serde_json::Value>(&content) {
                        let detail: Option<ConversationDetail> =
                            serde_json::from_value(conv_export["conversation"].clone()).ok();
                        let msgs: Vec<Message> =
                            serde_json::from_value(conv_export["messages"].clone()).unwrap_or_default();
                        if let Some(d) = detail {
                            conversations.push((d, msgs));
                        }
                    }
                }
            }
        }
    }

    // 6. Execute import in a single transaction
    let mut conn = db.conn.lock().map_err(|_| "DB lock failed".to_string())?;
    let mut tx = conn.savepoint().map_err(|e| format!("Transaction start failed: {e}"))?;

    let now = chrono::Utc::now().to_rfc3339();

    // Insert agent
    tx.execute(
        "INSERT INTO agents (id, folder_name, name, avatar, description, model, temperature, thinking_enabled, thinking_budget, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            new_agent_id,
            new_folder,
            old_agent.name,
            old_agent.avatar,
            old_agent.description,
            old_agent.model,
            old_agent.temperature,
            old_agent.thinking_enabled,
            old_agent.thinking_budget,
            false, // never import as default
            old_agent.sort_order,
            now,
            now,
        ],
    ).map_err(|e| format!("Failed to insert agent: {e}"))?;

    let mut conversations_imported = 0usize;
    let mut messages_imported = 0usize;

    // Insert conversations and messages
    for (conv_detail, msgs) in &conversations {
        let new_conv_id = Uuid::new_v4().to_string();

        let active_skills_json: Option<String> = conv_detail.active_skills
            .as_ref()
            .map(|skills| serde_json::to_string(skills).unwrap_or_default());
        tx.execute(
            "INSERT INTO conversations (id, title, agent_id, summary, summary_up_to_message_id, active_skills, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7)",
            rusqlite::params![
                new_conv_id,
                conv_detail.title,
                new_agent_id,
                conv_detail.summary,
                active_skills_json,
                conv_detail.created_at,
                conv_detail.updated_at,
            ],
        ).map_err(|e| format!("Failed to insert conversation: {e}"))?;
        conversations_imported += 1;

        for msg in msgs {
            let new_msg_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, tool_input, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    new_msg_id,
                    new_conv_id,
                    msg.role,
                    msg.content,
                    msg.tool_call_id,
                    msg.tool_name,
                    msg.tool_input,
                    msg.created_at,
                ],
            ).map_err(|e| format!("Failed to insert message: {e}"))?;
            messages_imported += 1;
        }
    }

    // Insert memory notes
    let mut memory_notes_imported = 0usize;
    for note in &memory_notes {
        let new_note_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO memory_notes (id, agent_id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                new_note_id,
                new_agent_id,
                note.title,
                note.content,
                note.created_at,
                note.updated_at,
            ],
        ).map_err(|e| format!("Failed to insert memory note: {e}"))?;
        memory_notes_imported += 1;
    }

    // 7. Write persona files to disk BEFORE DB commit (atomic import)
    let agents_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app dir: {e}"))?
        .join("agents")
        .join(&new_folder);

    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create agent directory: {e}"))?;

    for (fname, content) in &persona_contents {
        let path = agents_dir.join(fname);
        if let Err(e) = std::fs::write(&path, content) {
            // Filesystem write failed — clean up and rollback DB
            let _ = std::fs::remove_dir_all(&agents_dir);
            tx.rollback().map_err(|re| format!("Rollback failed after fs error: {re}"))?;
            return Err(format!("Failed to write {fname}: {e}"));
        }
    }

    // Write skills files to disk
    for (zip_path, content) in &skill_files {
        let relative = zip_path.strip_prefix("skills/").unwrap_or(zip_path);

        // Security: reject path traversal attempts (absolute paths, ".." components)
        if let Err(_) = validate_zip_entry(relative) {
            let _ = std::fs::remove_dir_all(&agents_dir);
            tx.rollback().map_err(|re| format!("Rollback failed: {re}"))?;
            return Err(format!("Invalid skill path in ZIP: {}", zip_path));
        }

        let target_path = agents_dir.join("skills").join(relative);

        // Security: verify resolved path is within the agent's skills directory
        let skills_dir = agents_dir.join("skills");
        if let Ok(canonical_target) = target_path.canonicalize().or_else(|_| {
            // For new files, canonicalize parent
            target_path.parent()
                .ok_or(std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent"))
                .and_then(|p| p.canonicalize())
                .map(|p| p.join(target_path.file_name().unwrap_or_default()))
        }) {
            let canonical_skills = skills_dir.canonicalize().unwrap_or(skills_dir.clone());
            if !canonical_target.starts_with(&canonical_skills) {
                let _ = std::fs::remove_dir_all(&agents_dir);
                tx.rollback().map_err(|re| format!("Rollback failed: {re}"))?;
                return Err(format!("Skill path escapes agent directory: {}", zip_path));
            }
        }
        if let Some(parent) = target_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                let _ = std::fs::remove_dir_all(&agents_dir);
                tx.rollback().map_err(|re| format!("Rollback failed after fs error: {re}"))?;
                return Err(format!("Failed to create skill dir: {e}"));
            }
        }
        if let Err(e) = std::fs::write(&target_path, content) {
            let _ = std::fs::remove_dir_all(&agents_dir);
            tx.rollback().map_err(|re| format!("Rollback failed after fs error: {re}"))?;
            return Err(format!("Failed to write skill file '{}': {e}", zip_path));
        }
    }

    // Only commit DB after all filesystem writes succeed
    if let Err(e) = tx.commit() {
        // DB commit failed — clean up filesystem
        let _ = std::fs::remove_dir_all(&agents_dir);
        return Err(format!("Transaction commit failed: {e}"));
    }
    drop(conn);

    Ok(ImportResult {
        agents_imported: 1,
        conversations_imported,
        messages_imported,
        memory_notes_imported,
        warnings,
    })
}
