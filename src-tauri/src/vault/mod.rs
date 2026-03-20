pub mod graph;
pub mod links;
pub mod manager;
pub mod note;
pub mod note_registry;
pub mod search;
pub mod security;
pub mod watcher;

use serde::{Deserialize, Serialize};

pub use manager::VaultManager;
pub use note_registry::NoteRegistry;

// ── Public types ──

/// Full vault note with frontmatter and body.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNote {
    pub id: String,
    pub agent: String,
    pub note_type: String,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub created: String,
    pub updated: String,
    pub revision: String,
    pub source: Option<String>,
    pub aliases: Vec<String>,
    pub legacy_id: Option<String>,
    pub scope: Option<String>,
    pub last_edited_by: Option<String>,
    pub source_conversation: Option<String>,
    pub title: String,
    pub content: String,
    pub path: String,
}

/// Summary of a vault note (without full body content).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNoteSummary {
    pub id: String,
    pub agent: String,
    pub note_type: String,
    pub title: String,
    pub body_preview: String,
    pub tags: Vec<String>,
    pub confidence: f64,
    pub scope: Option<String>,
    pub source_conversation: Option<String>,
    pub created: String,
    pub updated: String,
}

/// Stats returned after rebuilding the index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub total_notes: usize,
    pub total_links: usize,
    pub broken_links: usize,
    pub total_tags: usize,
}

/// Strip the markdown title heading and related section for legacy compatibility.
///
/// Removes the leading `# Title\n\n` heading and trailing `## Related\n...` section,
/// returning only the user-authored content body.
pub fn strip_title_heading(body: &str) -> String {
    let mut result = body.to_string();
    // Remove "# Title\n\n" prefix
    if result.starts_with("# ") {
        if let Some(pos) = result.find("\n\n") {
            result = result[pos + 2..].to_string();
        }
    }
    // Remove "## Related\n..." suffix
    if let Some(pos) = result.find("\n## Related\n") {
        result = result[..pos].to_string();
    }
    result.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::manager::extract_title_from_body;
    use tempfile::TempDir;

    fn create_test_manager() -> (TempDir, VaultManager) {
        let tmp = TempDir::new().unwrap();
        let manager = VaultManager::new(tmp.path().to_path_buf()).unwrap();
        (tmp, manager)
    }

    #[test]
    fn test_new_creates_directory_structure() {
        let (tmp, _manager) = create_test_manager();
        assert!(tmp.path().join("agents").exists());
        assert!(tmp.path().join("shared").exists());
        assert!(tmp.path().join("shared/project").exists());
        assert!(tmp.path().join("templates").exists());
    }

    #[test]
    fn test_create_and_read_note() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note(
                "manager",
                None,
                "knowledge",
                "Test Note",
                "This is a test note.",
                vec!["test".into(), "rust".into()],
                vec![],
            )
            .unwrap();

        assert!(!note.id.is_empty());
        assert_eq!(note.agent, "manager");
        assert_eq!(note.title, "Test Note");
        assert_eq!(note.tags, vec!["test", "rust"]);

        let read_note = manager.read_note(&note.id).unwrap();
        assert_eq!(read_note.id, note.id);
        assert!(read_note.content.contains("This is a test note."));
    }

    #[test]
    fn test_create_shared_note() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note(
                "manager",
                Some("shared"),
                "project",
                "Shared Knowledge",
                "Everyone can see this.",
                vec![],
                vec![],
            )
            .unwrap();

        assert_eq!(note.scope.as_deref(), Some("shared"));
        assert_eq!(note.last_edited_by.as_deref(), Some("manager"));
        assert!(manager.is_shared_note(&note.id));
    }

    #[test]
    fn test_update_note() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", None, "knowledge", "Original", "Original content.", vec![], vec![])
            .unwrap();

        let updated = manager
            .update_note(
                &note.id,
                "manager",
                None,
                Some("Updated content."),
                Some(vec!["new-tag".into()]),
                Some(0.95),
                None,
            )
            .unwrap();

        assert!(updated.content.contains("Updated content."));
        assert_eq!(updated.tags, vec!["new-tag"]);
        assert!((updated.confidence - 0.95).abs() < f64::EPSILON);
        assert!(updated.updated > note.updated);
    }

    #[test]
    fn test_delete_note() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", None, "knowledge", "To Delete", "Bye.", vec![], vec![])
            .unwrap();

        assert!(manager.read_note(&note.id).is_ok());
        manager.delete_note(&note.id, "user").unwrap();
        assert!(manager.read_note(&note.id).is_err());
    }

    #[test]
    fn test_delete_shared_note_by_agent_forbidden() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", Some("shared"), "project", "Shared", "No delete.", vec![], vec![])
            .unwrap();

        let result = manager.delete_note(&note.id, "manager");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("SharedDeleteForbidden"));
    }

    #[test]
    fn test_delete_shared_note_by_user_ok() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", Some("shared"), "project", "Shared", "User can delete.", vec![], vec![])
            .unwrap();

        assert!(manager.delete_note(&note.id, "user").is_ok());
    }

    #[test]
    fn test_list_notes() {
        let (_tmp, mut manager) = create_test_manager();
        manager
            .create_note("manager", None, "knowledge", "Note 1", "Content 1.", vec!["tag1".into()], vec![])
            .unwrap();
        manager
            .create_note("manager", None, "decision", "Note 2", "Content 2.", vec!["tag2".into()], vec![])
            .unwrap();
        manager
            .create_note("researcher", None, "knowledge", "Note 3", "Content 3.", vec!["tag1".into()], vec![])
            .unwrap();

        // List all for manager
        let all = manager.list_notes(Some("manager"), None, None);
        assert_eq!(all.len(), 2);

        // Filter by category
        let knowledge = manager.list_notes(Some("manager"), Some("knowledge"), None);
        assert_eq!(knowledge.len(), 1);

        // Filter by tag
        let tagged = manager.list_notes(None, None, Some(&["tag1".into()]));
        assert_eq!(tagged.len(), 2);
    }

    #[test]
    fn test_rebuild_index() {
        let (_tmp, mut manager) = create_test_manager();
        manager
            .create_note("manager", None, "knowledge", "Note A", "Content.", vec!["test".into()], vec![])
            .unwrap();

        let stats = manager.rebuild_index().unwrap();
        assert_eq!(stats.total_notes, 1);
        assert_eq!(stats.total_tags, 1);
    }

    #[test]
    fn test_recall() {
        let (_tmp, mut manager) = create_test_manager();
        for i in 0..5 {
            manager
                .create_note("manager", None, "knowledge", &format!("Note {i}"), "Content.", vec![], vec![])
                .unwrap();
        }

        let recalled = manager.recall("manager", 3);
        assert_eq!(recalled.len(), 3);
    }

    #[test]
    fn test_extract_title_from_body() {
        assert_eq!(extract_title_from_body("# My Title\n\nBody"), "My Title");
        assert_eq!(extract_title_from_body("\n\n# Title\n"), "Title");
        assert_eq!(extract_title_from_body("Plain text"), "Plain text");
        assert_eq!(extract_title_from_body(""), "Untitled");
    }

    #[test]
    fn test_workspace_files_excluded_from_index() {
        let (_tmp, mut manager) = create_test_manager();

        // Create a regular note via the API (should be indexed)
        let note = manager
            .create_note("test-agent", None, "knowledge", "Regular Note", "Content.", vec![], vec![])
            .unwrap();

        // Create a workspace file directly on disk (should NOT be indexed)
        let ws_dir = manager.vault_path.join("agents").join("test-agent").join("workspace");
        std::fs::create_dir_all(&ws_dir).unwrap();
        // Write a .md file with valid frontmatter so it would normally be picked up
        let ws_file = ws_dir.join("draft.md");
        std::fs::write(&ws_file, "---\nid: ws-note-1\nagent: test-agent\ntype: knowledge\ntags: []\nconfidence: 0.5\ncreated: 2024-01-01T00:00:00Z\nupdated: 2024-01-01T00:00:00Z\nrevision: abc\n---\n# Draft\nWorkspace content\n").unwrap();

        // Also test nested workspace subdirectory
        let ws_subdir = ws_dir.join("subdir");
        std::fs::create_dir_all(&ws_subdir).unwrap();
        let ws_nested = ws_subdir.join("nested.md");
        std::fs::write(&ws_nested, "---\nid: ws-note-2\nagent: test-agent\ntype: knowledge\ntags: []\nconfidence: 0.5\ncreated: 2024-01-01T00:00:00Z\nupdated: 2024-01-01T00:00:00Z\nrevision: def\n---\n# Nested\nNested workspace content\n").unwrap();

        // Rebuild index
        let stats = manager.rebuild_index().unwrap();

        // Only the regular note should be indexed
        assert_eq!(stats.total_notes, 1, "Only regular notes should be in the index, not workspace files");
        assert!(manager.registry.id_to_path.contains_key(&note.id));
        assert!(!manager.registry.id_to_path.contains_key("ws-note-1"));
        assert!(!manager.registry.id_to_path.contains_key("ws-note-2"));
    }

    #[test]
    fn test_archive_note() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", None, "knowledge", "To Archive", "Archive me.", vec!["test".into()], vec![])
            .unwrap();

        // Archive the note
        manager.archive_note(&note.id, "manager").unwrap();

        // Note should still be readable directly
        let read = manager.read_note(&note.id).unwrap();
        assert_eq!(read.title, "To Archive");

        // Note path should now be in archive/
        let path = manager.registry.id_to_path.get(&note.id).unwrap();
        assert!(path.to_string_lossy().contains("archive"));

        // Note should NOT appear in list_notes
        let listed = manager.list_notes(Some("manager"), None, None);
        assert!(listed.iter().all(|n| n.id != note.id), "Archived note should not appear in list_notes");

        // Note should NOT appear in recall
        let recalled = manager.recall("manager", 100);
        assert!(recalled.iter().all(|n| n.id != note.id), "Archived note should not appear in recall");
    }

    #[test]
    fn test_archive_note_not_found() {
        let (_tmp, mut manager) = create_test_manager();
        let result = manager.archive_note("nonexistent", "manager");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_archive_note_already_archived() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", None, "knowledge", "Double Archive", "Test.", vec![], vec![])
            .unwrap();

        manager.archive_note(&note.id, "manager").unwrap();
        let result = manager.archive_note(&note.id, "manager");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already archived"));
    }

    #[test]
    fn test_archive_excluded_from_search() {
        let (_tmp, mut manager) = create_test_manager();
        let note = manager
            .create_note("manager", None, "knowledge", "Searchable Note", "Unique keyword xyzzy.", vec![], vec![])
            .unwrap();

        // Before archiving, search should find it
        let results = manager.search("xyzzy", Some("manager"), None);
        assert!(!results.is_empty(), "Note should be searchable before archiving");

        // Archive it
        manager.archive_note(&note.id, "manager").unwrap();

        // After archiving, search should NOT find it
        let results = manager.search("xyzzy", Some("manager"), None);
        assert!(results.iter().all(|r| r.note_id != note.id), "Archived note should not appear in search");
    }

    #[test]
    fn test_non_agent_workspace_folder_not_excluded() {
        let (_tmp, mut manager) = create_test_manager();

        // Create a folder named "workspace" that is NOT under agents/*/workspace
        // e.g., shared/workspace/note.md should still be indexed
        let other_ws = manager.vault_path.join("shared").join("workspace");
        std::fs::create_dir_all(&other_ws).unwrap();
        let other_file = other_ws.join("note.md");
        std::fs::write(&other_file, "---\nid: other-ws-note\nagent: test-agent\ntype: knowledge\ntags: []\nconfidence: 0.5\ncreated: 2024-01-01T00:00:00Z\nupdated: 2024-01-01T00:00:00Z\nrevision: ghi\n---\n# Other\nNot an agent workspace\n").unwrap();

        let stats = manager.rebuild_index().unwrap();
        assert_eq!(stats.total_notes, 1, "Non-agent workspace folders should still be indexed");
        assert!(manager.registry.id_to_path.contains_key("other-ws-note"));
    }
}
