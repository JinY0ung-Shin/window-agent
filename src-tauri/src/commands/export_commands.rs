use crate::commands::vault_commands::VaultState;
use crate::db::agent_operations;
use crate::db::models::*;
use crate::db::operations::*;
use crate::db::Database;
use crate::error::AppError;
use crate::utils::config_helpers::agents_dir as get_agents_base_dir;
use crate::utils::path_security::validate_zip_entry;
use crate::vault::note::parse_frontmatter;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    pub warnings: Vec<String>,
}

// ── Export agent ──

#[tauri::command]
pub fn export_agent(
    app: AppHandle,
    db: State<'_, Database>,
    agent_id: String,
    include_conversations: bool,
) -> Result<Vec<u8>, AppError> {
    let agent = agent_operations::get_agent_impl(&db, agent_id.clone())?;

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
            .map_err(|e| AppError::Io(format!("JSON error: {e}")))?;
        zip.start_file("agent.json", options)
            .map_err(|e| AppError::Io(format!("ZIP error: {e}")))?;
        zip.write_all(meta_json.as_bytes())
            .map_err(|e| AppError::Io(format!("ZIP write error: {e}")))?;

        // persona files
        let agents_dir = get_agents_base_dir(&app)
            .map_err(AppError::Io)?
            .join(&agent.folder_name);

        let persona_files = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOL_CONFIG.json"];
        for fname in &persona_files {
            let path = agents_dir.join(fname);
            if path.exists() {
                let content = std::fs::read_to_string(&path)
                    .map_err(|e| AppError::Io(format!("Failed to read {fname}: {e}")))?;
                zip.start_file(format!("persona/{fname}"), options)
                    .map_err(|e| AppError::Io(format!("ZIP error: {e}")))?;
                zip.write_all(content.as_bytes())
                    .map_err(|e| AppError::Io(format!("ZIP write error: {e}")))?;
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
            ) -> Result<(), AppError> {
                let entries = std::fs::read_dir(dir)
                    .map_err(|e| AppError::Io(format!("Failed to read skills dir: {e}")))?;
                for entry in entries.flatten() {
                    let path = entry.path();
                    let relative = path
                        .strip_prefix(base)
                        .map_err(|e| AppError::Io(format!("Path strip error: {e}")))?;
                    let zip_path = format!("skills/{}", relative.to_string_lossy().replace('\\', "/"));
                    if path.is_dir() {
                        walk_dir_recursive(&path, base, zip, options)?;
                    } else if path.is_file() {
                        let content = std::fs::read(&path)
                            .map_err(|e| AppError::Io(format!("Failed to read skill file: {e}")))?;
                        zip.start_file(zip_path, *options)
                            .map_err(|e| AppError::Io(format!("ZIP error: {e}")))?;
                        zip.write_all(&content)
                            .map_err(|e| AppError::Io(format!("ZIP write error: {e}")))?;
                    }
                }
                Ok(())
            }
            walk_dir_recursive(&skills_dir, &skills_dir, &mut zip, &options)?;
        }

        // memory: vault files
        let vault_state = app.try_state::<VaultState>();
        if let Some(vault_state) = vault_state {
            if let Ok(vm) = vault_state.lock() {
                // Export agent's vault files under memory/
                let agent_vault_dir = vm.get_vault_path().join("agents").join(&agent_id);
                if agent_vault_dir.is_dir() {
                    export_dir_recursive(&agent_vault_dir, &agent_vault_dir, "memory", &mut zip, &options)?;
                }

                // Export referenced shared notes under shared_refs/
                let shared_ids = collect_shared_references(&agent_id, &vm);
                for shared_id in &shared_ids {
                    if vm.read_note(shared_id).is_ok() {
                        if let Some(path) = vm.registry.id_to_path.get(shared_id) {
                            if let Ok(content) = std::fs::read_to_string(path) {
                                // Derive relative path from shared/ root
                                let shared_root = vm.get_vault_path().join("shared");
                                if let Ok(relative) = path.strip_prefix(&shared_root) {
                                    let zip_path = format!("shared_refs/{}", relative.to_string_lossy().replace('\\', "/"));
                                    zip.start_file(zip_path, options)
                                        .map_err(|e| AppError::Io(format!("ZIP error: {e}")))?;
                                    zip.write_all(content.as_bytes())
                                        .map_err(|e| AppError::Io(format!("ZIP write error: {e}")))?;
                                }
                            }
                        }
                    }
                }

            }
        }

        // conversations
        if include_conversations {
            let all_convs = get_conversations_impl(&db)?;
            let agent_convs: Vec<_> = all_convs
                .into_iter()
                .filter(|c| c.agent_id == agent_id)
                .collect();

            for conv in &agent_convs {
                let detail = get_conversation_detail_impl(&db, conv.id.clone())?;
                let messages = get_messages_impl(&db, conv.id.clone())?;

                let conv_export = ConversationExport {
                    version: "1.0".to_string(),
                    export_type: "conversation".to_string(),
                    exported_at: chrono::Utc::now().to_rfc3339(),
                    conversation: detail,
                    messages,
                };
                let conv_json = serde_json::to_string_pretty(&conv_export)
                    .map_err(|e| AppError::Io(format!("JSON error: {e}")))?;

                zip.start_file(format!("conversations/{}.json", conv.id), options)
                    .map_err(|e| AppError::Io(format!("ZIP error: {e}")))?;
                zip.write_all(conv_json.as_bytes())
                    .map_err(|e| AppError::Io(format!("ZIP write error: {e}")))?;
            }
        }

        zip.finish().map_err(|e| AppError::Io(format!("ZIP finalize error: {e}")))?;
    }

    Ok(buf.into_inner())
}

// ── Import agent ──

#[tauri::command]
pub fn import_agent(
    app: AppHandle,
    db: State<'_, Database>,
    zip_bytes: Vec<u8>,
) -> Result<ImportResult, AppError> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::Io(format!("Invalid ZIP file: {e}")))?;

    let mut warnings: Vec<String> = Vec::new();

    // 1. Read agent.json
    let agent_meta: AgentExportMeta = {
        let mut file = archive.by_name("agent.json")
            .map_err(|_| AppError::Validation("ZIP missing agent.json".to_string()))?;
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| AppError::Io(format!("Failed to read agent.json: {e}")))?;
        serde_json::from_str(&content)
            .map_err(|e| AppError::Validation(format!("Invalid agent.json: {e}")))?
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
                return Err(AppError::Validation("Too many folder name collisions".to_string()));
            }
        }
        warnings.push(format!(
            "folder_name '{}' 중복 → '{}' 로 변경",
            old_agent.folder_name, new_folder
        ));
    }

    // 3. Read persona files from ZIP
    let persona_files_list = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOL_CONFIG.json"];
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

    // 4. Read memory notes (check for vault format first, then legacy)
    let has_vault_memory = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .any(|name| name.starts_with("memory/") && name.ends_with(".md"));

    let has_shared_refs = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .any(|name| name.starts_with("shared_refs/") && name.ends_with(".md"));

    // Collect vault memory files from ZIP
    let mut vault_memory_files: Vec<(String, Vec<u8>)> = Vec::new();
    let mut vault_shared_files: Vec<(String, Vec<u8>)> = Vec::new();
    if has_vault_memory || has_shared_refs {
        let vault_file_names: Vec<String> = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
            .filter(|name| {
                (name.starts_with("memory/") || name.starts_with("shared_refs/"))
                    && !name.ends_with('/')
            })
            .collect();
        for name in &vault_file_names {
            if let Ok(mut file) = archive.by_name(name) {
                let mut buf = Vec::new();
                if std::io::Read::read_to_end(&mut file, &mut buf).is_ok() {
                    if name.starts_with("memory/") {
                        vault_memory_files.push((name.clone(), buf));
                    } else {
                        vault_shared_files.push((name.clone(), buf));
                    }
                }
            }
        }
    }

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

    // 6. Execute import in a single transaction via operations layer
    let now = chrono::Utc::now().to_rfc3339();

    let db_result = crate::db::operations::import_ops::import_agent_to_db(
        &db,
        &new_agent_id,
        &new_folder,
        &old_agent,
        &now,
        &conversations,
    )?;

    let conversations_imported = db_result.conversations_imported;
    let messages_imported = db_result.messages_imported;

    // Helper closure: clean up DB on filesystem failure (FK cascades handle conversations/messages)
    let cleanup_db = |db: &Database, agent_id: &str| {
        let _ = crate::db::operations::import_ops::delete_imported_agent(db, agent_id);
    };

    // Import memory notes — vault format or legacy
    // Track ALL vault files written for cleanup on failure
    let mut imported_vault_paths: Vec<std::path::PathBuf> = Vec::new();

    if has_vault_memory {
        // Vault format: 2-phase import with UUID dedup + body link rewriting
        let vault_state = app.try_state::<VaultState>();
        if let Some(vault_state) = &vault_state {
            if let Ok(vm) = vault_state.lock() {
                let agent_vault_dir = vm.get_vault_path().join("agents").join(&new_agent_id);

                // Phase 1: Build UUID remap table for vault-colliding IDs.
                // Each unique original ID that collides with existing vault gets ONE new UUID.
                // Intra-archive duplicates (same ID appearing multiple times) are skipped.
                let mut id_remap: std::collections::HashMap<String, String> = std::collections::HashMap::new();
                let mut seen_ids: HashSet<String> = HashSet::new();

                for (_zip_path, content) in &vault_memory_files {
                    let content_str = String::from_utf8_lossy(content);
                    if let Ok((fm, _)) = parse_frontmatter(&content_str) {
                        if seen_ids.contains(&fm.id) {
                            // Intra-archive duplicate — will be skipped in Phase 2
                            continue;
                        }
                        seen_ids.insert(fm.id.clone());
                        if vm.registry.id_to_path.contains_key(&fm.id) {
                            // Vault collision — assign a new UUID
                            id_remap.insert(fm.id.clone(), Uuid::new_v4().to_string());
                        }
                    }
                }

                // Phase 2: Write files with rewritten frontmatter + body links.
                // Skip intra-archive duplicate IDs (malformed archive).
                let mut written_ids: HashSet<String> = HashSet::new();

                for (zip_path, content) in &vault_memory_files {
                    let relative = zip_path.strip_prefix("memory/").unwrap_or(zip_path);
                    if validate_zip_entry(relative).is_err() {
                        warnings.push(format!("Skipping invalid vault path: {zip_path}"));
                        continue;
                    }

                    let content_str = String::from_utf8_lossy(content);
                    let rewritten = match parse_frontmatter(&content_str) {
                        Ok((mut fm, mut body)) => {
                            // Skip intra-archive duplicate UUIDs
                            if written_ids.contains(&fm.id) {
                                warnings.push(format!("Skipping duplicate note ID in archive: {}", fm.id));
                                continue;
                            }
                            written_ids.insert(fm.id.clone());

                            fm.agent = new_agent_id.clone();

                            // Remap this note's own ID if it collides with existing vault
                            if let Some(new_id) = id_remap.get(&fm.id) {
                                fm.legacy_id = Some(fm.id.clone());
                                fm.id = new_id.clone();
                            }

                            // Rewrite UUID-based wikilinks in body to use remapped IDs
                            for (old_id, new_id) in &id_remap {
                                body = body.replace(
                                    &format!("[[{old_id}]]"),
                                    &format!("[[{new_id}]]"),
                                );
                                let old_prefix = format!("[[{old_id}|");
                                let new_prefix = format!("[[{new_id}|");
                                body = body.replace(&old_prefix, &new_prefix);
                            }

                            crate::vault::note::serialize_note(&fm, &body)
                        }
                        Err(_) => content_str.to_string(),
                    };

                    let target_path = agent_vault_dir.join(relative);
                    if let Some(parent) = target_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Err(e) = std::fs::write(&target_path, &rewritten) {
                        warnings.push(format!("Failed to write vault file '{}': {e}", zip_path));
                    } else {
                        imported_vault_paths.push(target_path);
                    }
                }

                // Import shared_refs: id-based dedup
                for (zip_path, content) in &vault_shared_files {
                    let relative = zip_path.strip_prefix("shared_refs/").unwrap_or(zip_path);
                    if validate_zip_entry(relative).is_err() {
                        warnings.push(format!("Skipping invalid shared ref path: {zip_path}"));
                        continue;
                    }

                    let content_str = String::from_utf8_lossy(content);
                    if let Ok((fm, _)) = parse_frontmatter(&content_str) {
                        if vm.registry.id_to_path.contains_key(&fm.id) {
                            continue; // already exists in vault
                        }
                    }

                    let target_path = vm.get_vault_path().join("shared").join(relative);
                    if target_path.exists() { continue; }
                    if let Some(parent) = target_path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    if let Err(e) = std::fs::write(&target_path, content) {
                        warnings.push(format!("Failed to write shared ref '{}': {e}", zip_path));
                    } else {
                        imported_vault_paths.push(target_path); // track for cleanup
                    }
                }
            }
        }
    }

    // 7. Write persona files to disk BEFORE DB commit (atomic import)
    let agents_dir = get_agents_base_dir(&app)
        .map_err(AppError::Io)?
        .join(&new_folder);

    if let Err(e) = std::fs::create_dir_all(&agents_dir) {
        for vp in &imported_vault_paths { let _ = std::fs::remove_file(vp); }
        cleanup_db(&db, &new_agent_id);
        return Err(AppError::Io(format!("Failed to create agent directory: {e}")));
    }

    for (fname, content) in &persona_contents {
        let path = agents_dir.join(fname);
        if let Err(e) = std::fs::write(&path, content) {
            for vp in &imported_vault_paths { let _ = std::fs::remove_file(vp); }
            let _ = std::fs::remove_dir_all(&agents_dir);
            cleanup_db(&db, &new_agent_id);
            return Err(AppError::Io(format!("Failed to write {fname}: {e}")));
        }
    }

    // Write skills files to disk
    for (zip_path, content) in &skill_files {
        let relative = zip_path.strip_prefix("skills/").unwrap_or(zip_path);

        // Security: reject path traversal attempts (absolute paths, ".." components)
        if validate_zip_entry(relative).is_err() {
            for vp in &imported_vault_paths { let _ = std::fs::remove_file(vp); }
            let _ = std::fs::remove_dir_all(&agents_dir);
            cleanup_db(&db, &new_agent_id);
            return Err(AppError::Validation(format!("Invalid skill path in ZIP: {}", zip_path)));
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
                for vp in &imported_vault_paths { let _ = std::fs::remove_file(vp); }
                let _ = std::fs::remove_dir_all(&agents_dir);
                cleanup_db(&db, &new_agent_id);
                return Err(AppError::Validation(format!("Skill path escapes agent directory: {}", zip_path)));
            }
        }
        if let Some(parent) = target_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                for vp in &imported_vault_paths { let _ = std::fs::remove_file(vp); }
                let _ = std::fs::remove_dir_all(&agents_dir);
                cleanup_db(&db, &new_agent_id);
                return Err(AppError::Io(format!("Failed to create skill dir: {e}")));
            }
        }
        if let Err(e) = std::fs::write(&target_path, content) {
            for vp in &imported_vault_paths { let _ = std::fs::remove_file(vp); }
            let _ = std::fs::remove_dir_all(&agents_dir);
            cleanup_db(&db, &new_agent_id);
            return Err(AppError::Io(format!("Failed to write skill file '{}': {e}", zip_path)));
        }
    }

    // Rebuild vault index after import to pick up new files
    if has_vault_memory {
        if let Some(vault_state) = app.try_state::<VaultState>() {
            if let Ok(mut vm) = vault_state.lock() {
                let _ = vm.rebuild_index();
            }
        }
    }

    Ok(ImportResult {
        agents_imported: 1,
        conversations_imported,
        messages_imported,
        warnings,
    })
}

// ── Vault export helpers ──

/// Recursively add a directory's files into a ZIP under a given prefix.
fn export_dir_recursive(
    dir: &std::path::Path,
    base: &std::path::Path,
    prefix: &str,
    zip: &mut zip::ZipWriter<&mut Cursor<Vec<u8>>>,
    options: &FileOptions<()>,
) -> Result<(), AppError> {
    if !dir.is_dir() {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|e| AppError::Io(format!("Failed to read dir '{}': {e}", dir.display())))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let relative = path
            .strip_prefix(base)
            .map_err(|e| AppError::Io(format!("Path strip error: {e}")))?;
        let zip_path = format!("{}/{}", prefix, relative.to_string_lossy().replace('\\', "/"));
        if path.is_dir() {
            export_dir_recursive(&path, base, prefix, zip, options)?;
        } else if path.is_file() {
            let content = std::fs::read(&path)
                .map_err(|e| AppError::Io(format!("Failed to read file: {e}")))?;
            zip.start_file(zip_path, *options)
                .map_err(|e| AppError::Io(format!("ZIP error: {e}")))?;
            zip.write_all(&content)
                .map_err(|e| AppError::Io(format!("ZIP write error: {e}")))?;
        }
    }
    Ok(())
}

/// Collect shared note IDs referenced by an agent's notes (depth 1).
fn collect_shared_references(
    agent_id: &str,
    vm: &crate::vault::VaultManager,
) -> Vec<String> {
    let all_notes = vm.list_notes(Some(agent_id), None, None);
    // Only start from agent-owned notes, not shared notes included by the filter
    let agent_notes: Vec<_> = all_notes.into_iter()
        .filter(|n| n.scope.as_deref() != Some("shared"))
        .collect();
    let mut shared_ids = HashSet::new();

    // Step 1: direct references from agent-owned notes to shared notes
    for note in &agent_notes {
        for link in vm.get_outgoing_links(&note.id) {
            if link.resolved && vm.is_shared_note(&link.target_id) {
                shared_ids.insert(link.target_id.clone());
            }
        }
    }

    // Step 2: shared notes referencing other shared notes (depth 1)
    let direct_shared: Vec<String> = shared_ids.iter().cloned().collect();
    for shared_id in &direct_shared {
        for link in vm.get_outgoing_links(shared_id) {
            if link.resolved && vm.is_shared_note(&link.target_id) {
                shared_ids.insert(link.target_id.clone());
            }
        }
    }

    shared_ids.into_iter().collect()
}
