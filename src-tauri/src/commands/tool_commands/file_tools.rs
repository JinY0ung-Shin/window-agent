use crate::commands::vault_commands::VaultState;
use crate::vault::note::{compute_revision, parse_frontmatter, serialize_note, Frontmatter};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use super::scope::validate_path;

// ── Individual file tool implementations ──

pub(super) fn tool_read_file(
    path: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    let content =
        std::fs::read_to_string(&validated).map_err(|e| format!("read_file failed: {}", e))?;
    Ok(serde_json::json!({ "content": content }))
}

pub(super) fn tool_write_file(
    path: &str,
    content: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;

    // Ensure parent directory exists
    if let Some(parent) = validated.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    std::fs::write(&validated, content).map_err(|e| format!("write_file failed: {}", e))?;
    Ok(serde_json::json!({ "success": true, "path": validated.to_string_lossy() }))
}

pub(super) fn tool_delete_file(
    path: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    if !validated.is_file() {
        return Err(format!(
            "delete_file: '{}' is not a file or does not exist",
            path
        ));
    }
    std::fs::remove_file(&validated).map_err(|e| format!("delete_file failed: {}", e))?;
    Ok(serde_json::json!({ "success": true, "path": validated.to_string_lossy() }))
}

pub(super) fn tool_list_directory(
    path: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    let entries: Vec<serde_json::Value> = std::fs::read_dir(&validated)
        .map_err(|e| format!("list_directory failed: {}", e))?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().ok()?.is_dir();
            Some(serde_json::json!({ "name": name, "is_dir": is_dir }))
        })
        .collect();
    Ok(serde_json::json!({ "entries": entries }))
}

pub(super) fn tool_list_directory_recursive(
    path: &str,
    allowed: &[PathBuf],
) -> Result<serde_json::Value, String> {
    let validated = validate_path(path, allowed)?;
    let mut entries = Vec::new();
    collect_entries_recursive(&validated, &validated, &mut entries)?;
    Ok(serde_json::json!({ "entries": entries }))
}

fn collect_entries_recursive(
    base: &Path,
    current: &Path,
    entries: &mut Vec<serde_json::Value>,
) -> Result<(), String> {
    let dir_entries =
        std::fs::read_dir(current).map_err(|e| format!("list_directory failed: {}", e))?;

    for entry in dir_entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let full_path = entry.path();
        let relative = full_path
            .strip_prefix(base)
            .unwrap_or(&full_path)
            .to_string_lossy()
            .to_string();
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
        entries.push(serde_json::json!({ "name": relative, "is_dir": is_dir }));

        if is_dir {
            collect_entries_recursive(base, &full_path, entries)?;
        }
    }
    Ok(())
}

// ── Vault helpers ──

/// Infer note category from the vault-relative path.
/// e.g. "decision/auth-flow.md" -> "decision", "knowledge/topic.md" -> "knowledge"
fn infer_vault_category(path: &str) -> String {
    // Use the first path component as the category (free-form, LLM-assigned).
    Path::new(path)
        .components()
        .next()
        .and_then(|c| c.as_os_str().to_str())
        .unwrap_or("general")
        .to_string()
}

/// Strip YAML frontmatter from content if present (read-modify-write support).
/// Allows agents to read a vault file, modify the body, and write it back
/// without having to manually strip the frontmatter.
pub(super) fn strip_frontmatter_if_present(content: &str) -> String {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        // Find the closing --- delimiter
        if let Some(end_idx) = trimmed[3..].find("\n---") {
            let after_fm = &trimmed[3 + end_idx + 4..]; // skip past closing ---
            return after_fm.trim_start_matches('\n').to_string();
        }
    }
    content.to_string()
}

// ── Vault-specific write_file with frontmatter management ──

pub(super) fn tool_vault_write_file(
    resolved_path: &str,
    relative_path: &str,
    body_content: &str,
    allowed: &[PathBuf],
    agent_id: &str,
    conversation_id: &str,
) -> Result<serde_json::Value, String> {
    // Strip frontmatter if the model echoed it back from a read-modify-write loop.
    // This allows the natural pattern: read -> modify -> write back.
    let clean_content = strip_frontmatter_if_present(body_content);

    let validated = validate_path(resolved_path, allowed)?;

    // Ensure parent directory exists
    if let Some(parent) = validated.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    // Infer category from the relative path (knowledge/decision/conversation/reflection)
    let note_type = infer_vault_category(relative_path);

    let now = chrono::Utc::now().to_rfc3339();
    let revision = compute_revision(&clean_content);

    let file_content = if validated.is_file() {
        // Existing file: preserve id, agent, created from existing frontmatter
        let existing = std::fs::read_to_string(&validated)
            .map_err(|e| format!("Failed to read existing vault file: {}", e))?;
        let (mut fm, _old_body) = parse_frontmatter(&existing)?;
        fm.updated = now;
        fm.revision = revision;
        // Do NOT update source_conversation on edits — it would make long-lived notes
        // eligible for archival at end of conversation. Modified notes are already
        // tracked via tool call logs in the digest's "VAULT FILE ACTIVITY" section.
        serialize_note(&fm, &clean_content)
    } else {
        // New file: generate frontmatter
        let fm = Frontmatter {
            id: uuid::Uuid::new_v4().to_string(),
            agent: agent_id.to_string(),
            note_type,
            tags: Vec::new(),
            confidence: 0.5,
            created: now.clone(),
            updated: now,
            revision,
            source: None,
            aliases: Vec::new(),
            legacy_id: None,
            scope: None,
            last_edited_by: None,
            source_conversation: Some(conversation_id.to_string()),
        };
        serialize_note(&fm, &clean_content)
    };

    std::fs::write(&validated, &file_content).map_err(|e| format!("write_file failed: {}", e))?;

    Ok(serde_json::json!({ "success": true, "path": validated.to_string_lossy() }))
}

/// Incremental index: re-index a single note instead of the entire vault.
pub(super) fn index_single_vault_note(app: &AppHandle, path: &str) -> Result<(), String> {
    let vault = app.state::<VaultState>();
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.index_single_note(Path::new(path))
        .map_err(|e| format!("Failed to index single note: {}", e))?;
    Ok(())
}

/// Remove a deleted note from the vault index by its file path.
pub(super) fn remove_vault_note_by_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let vault = app.state::<VaultState>();
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    let path_buf = PathBuf::from(path);
    if let Some(note_id) = vm.registry.path_to_id.get(&path_buf).cloned() {
        vm.link_index.remove_note(&note_id);
        vm.registry.unregister(&note_id);
    }
    Ok(())
}

// ── Web search ──

pub(super) async fn tool_web_search(input: &str, client: &reqwest::Client) -> Result<serde_json::Value, String> {
    // If input doesn't look like a URL, treat it as a search query
    let url = if input.starts_with("http://") || input.starts_with("https://") {
        input.to_string()
    } else {
        format!(
            "https://html.duckduckgo.com/html/?q={}",
            urlencoding::encode(input)
        )
    };

    const MAX_BODY_BYTES: usize = 50_000;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("web_search request failed: {}", e))?;

    let status = resp.status().as_u16();

    // Reject obviously huge responses early via content-length
    if let Some(len) = resp.content_length() {
        if len > (MAX_BODY_BYTES as u64) * 2 {
            return Ok(serde_json::json!({
                "status": status,
                "body": format!("[Response too large: {} bytes, limit {}]", len, MAX_BODY_BYTES)
            }));
        }
    }

    // Stream body in chunks with a hard 50KB cap
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut body = Vec::with_capacity(MAX_BODY_BYTES.min(65536));
    let mut truncated_flag = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e: reqwest::Error| format!("Failed to read response body: {}", e))?;
        let remaining = MAX_BODY_BYTES.saturating_sub(body.len());
        if remaining == 0 {
            truncated_flag = true;
            break;
        }
        let take = chunk.len().min(remaining);
        body.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            truncated_flag = true;
            break;
        }
    }

    let body_str = String::from_utf8_lossy(&body).to_string();
    let result = if truncated_flag {
        format!("{}... [truncated at {} bytes]", body_str, MAX_BODY_BYTES)
    } else {
        body_str
    };

    Ok(serde_json::json!({ "status": status, "body": result }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::TempDir;

    fn make_allowed(dir: &Path) -> Vec<PathBuf> {
        vec![dir.to_path_buf()]
    }

    #[test]
    fn test_validate_path_inside_allowed() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("test.txt");
        fs::write(&file_path, "hello").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = validate_path(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_path_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = validate_path("/etc/passwd", &allowed);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("outside allowed"));
    }

    #[test]
    fn test_validate_path_traversal_blocked() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let evil = format!("{}/../../../etc/passwd", tmp.path().display());
        let result = validate_path(&evil, &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_path_nonexistent_file_parent_valid() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let new_file = tmp.path().join("newfile.txt");
        let result = validate_path(new_file.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
    }

    #[test]
    fn test_read_file_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("readme.txt");
        fs::write(&file_path, "Hello, world!").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_read_file(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
        assert_eq!(result.unwrap()["content"], "Hello, world!");
    }

    #[test]
    fn test_read_file_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_read_file("/etc/hostname", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_write_file_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("output.txt");
        let allowed = make_allowed(tmp.path());

        let result = tool_write_file(file_path.to_str().unwrap(), "written content", &allowed);
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "written content");
    }

    #[test]
    fn test_write_file_creates_subdirectories() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("sub").join("dir").join("file.txt");
        let allowed = make_allowed(tmp.path());

        // Parent doesn't exist yet — validate_path for write resolves parent only if it exists.
        // Create the parent first for this test.
        fs::create_dir_all(file_path.parent().unwrap()).unwrap();
        let result = tool_write_file(file_path.to_str().unwrap(), "nested", &allowed);
        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(&file_path).unwrap(), "nested");
    }

    #[test]
    fn test_write_file_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_write_file("/tmp/evil.txt", "bad", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_file_success() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("to_delete.txt");
        fs::write(&file_path, "bye").unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_delete_file(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_ok());
        assert!(!file_path.exists());
    }

    #[test]
    fn test_delete_file_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_delete_file("/etc/hostname", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_file_nonexistent() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("ghost.txt");
        let allowed = make_allowed(tmp.path());
        let result = tool_delete_file(file_path.to_str().unwrap(), &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_list_directory_success() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("a.txt"), "").unwrap();
        fs::create_dir(tmp.path().join("subdir")).unwrap();

        let allowed = make_allowed(tmp.path());
        let result = tool_list_directory(tmp.path().to_str().unwrap(), &allowed).unwrap();
        let entries = result["entries"].as_array().unwrap();
        assert!(entries.len() >= 2);

        let names: Vec<&str> = entries.iter().filter_map(|e| e["name"].as_str()).collect();
        assert!(names.contains(&"a.txt"));
        assert!(names.contains(&"subdir"));
    }

    #[test]
    fn test_list_directory_outside_allowed() {
        let tmp = TempDir::new().unwrap();
        let allowed = make_allowed(tmp.path());
        let result = tool_list_directory("/etc", &allowed);
        assert!(result.is_err());
    }

    #[test]
    fn test_list_directory_recursive() {
        let tmp = TempDir::new().unwrap();
        fs::write(tmp.path().join("root.txt"), "").unwrap();
        let sub = tmp.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(sub.join("nested.txt"), "").unwrap();

        let allowed = make_allowed(tmp.path());
        let result =
            tool_list_directory_recursive(tmp.path().to_str().unwrap(), &allowed).unwrap();
        let entries = result["entries"].as_array().unwrap();

        let names: Vec<&str> = entries.iter().filter_map(|e| e["name"].as_str()).collect();
        assert!(names.contains(&"root.txt"));
        assert!(names.contains(&"sub"));
        assert!(names.iter().any(|n| n.contains("nested.txt")));
    }

    #[test]
    fn test_vault_write_file_new() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("note.md");
        let allowed = make_allowed(tmp.path());

        let result = tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/note.md",
            "# My Note\n\nSome content.\n",
            &allowed,
            "test-agent",
            "conv-123",
        );
        assert!(result.is_ok());

        // Verify frontmatter was auto-generated
        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.starts_with("---\n"));
        let (fm, body) = parse_frontmatter(&content).unwrap();
        assert_eq!(fm.agent, "test-agent");
        assert!(!fm.id.is_empty());
        assert!((fm.confidence - 0.5).abs() < f64::EPSILON);
        assert_eq!(fm.source_conversation, Some("conv-123".to_string()));
        assert_eq!(fm.note_type, "knowledge");
        assert!(body.contains("My Note"));
    }

    #[test]
    fn test_vault_write_file_infers_category_from_path() {
        let tmp = TempDir::new().unwrap();
        let decision_dir = tmp.path().join("decision");
        fs::create_dir_all(&decision_dir).unwrap();
        let file_path = decision_dir.join("auth.md");
        let allowed = make_allowed(tmp.path());

        tool_vault_write_file(
            file_path.to_str().unwrap(),
            "decision/auth.md",
            "# Auth Decision\n\nWe chose JWT.\n",
            &allowed,
            "test-agent",
            "conv-123",
        )
        .unwrap();

        let content = fs::read_to_string(&file_path).unwrap();
        let (fm, _) = parse_frontmatter(&content).unwrap();
        assert_eq!(fm.note_type, "decision");
    }

    #[test]
    fn test_vault_write_file_update_preserves_metadata_including_source_conversation() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("existing.md");
        let allowed = make_allowed(tmp.path());

        // Create initial file
        tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/existing.md",
            "# Initial\n\nFirst content.\n",
            &allowed,
            "test-agent",
            "conv-123",
        )
        .unwrap();

        let initial_content = fs::read_to_string(&file_path).unwrap();
        let (initial_fm, _) = parse_frontmatter(&initial_content).unwrap();
        let original_id = initial_fm.id.clone();
        let original_created = initial_fm.created.clone();
        assert_eq!(initial_fm.source_conversation, Some("conv-123".to_string()));

        // Update the file from a different conversation
        tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/existing.md",
            "# Updated\n\nNew content.\n",
            &allowed,
            "test-agent",
            "conv-456",
        )
        .unwrap();

        let updated_content = fs::read_to_string(&file_path).unwrap();
        let (updated_fm, body) = parse_frontmatter(&updated_content).unwrap();

        // id, created, and source_conversation should all be preserved
        assert_eq!(updated_fm.id, original_id);
        assert_eq!(updated_fm.created, original_created);
        assert_eq!(
            updated_fm.source_conversation,
            Some("conv-123".to_string())
        );
        // updated should change
        assert!(updated_fm.updated >= original_created);
        assert!(body.contains("New content"));
    }

    #[test]
    fn test_vault_write_file_strips_frontmatter_from_content() {
        let tmp = TempDir::new().unwrap();
        let file_path = tmp.path().join("readback.md");
        let allowed = make_allowed(tmp.path());

        // Simulate read-modify-write: content includes frontmatter from a previous read
        let result = tool_vault_write_file(
            file_path.to_str().unwrap(),
            "knowledge/readback.md",
            "---\nid: fake\n---\n# Real Content\n\nBody here.\n",
            &allowed,
            "test-agent",
            "conv-123",
        );
        assert!(result.is_ok());

        // Verify frontmatter was auto-generated (not the fake one)
        let content = fs::read_to_string(&file_path).unwrap();
        let (fm, body) = parse_frontmatter(&content).unwrap();
        assert_ne!(fm.id, "fake");
        assert_eq!(fm.agent, "test-agent");
        assert!(body.contains("Real Content"));
    }

    #[test]
    fn test_strip_frontmatter_if_present() {
        // With frontmatter
        let input = "---\nid: abc\ntags: []\n---\n# Title\n\nBody content";
        let result = strip_frontmatter_if_present(input);
        assert!(result.starts_with("# Title"));
        assert!(result.contains("Body content"));

        // Without frontmatter
        let input2 = "# Just Content\n\nNo frontmatter here.";
        let result2 = strip_frontmatter_if_present(input2);
        assert_eq!(result2, input2);
    }
}
