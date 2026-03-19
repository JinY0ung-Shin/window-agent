use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Manages consolidated memory and digests on the filesystem.
///
/// Directory layout per agent:
/// ```text
/// <base_path>/<agent_id>/
///   consolidated.md
///   snapshots/v{N}_{timestamp}.md
///   digests/<conversation_id>.md
/// ```
pub struct SystemMemoryManager {
    base_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct DigestMeta {
    pub conversation_id: String,
    pub created_at: String,
}

impl SystemMemoryManager {
    pub fn new(app_data_dir: &Path) -> Self {
        let base_path = app_data_dir.join("memory");
        SystemMemoryManager { base_path }
    }

    /// Return the agent-specific memory directory, creating it if needed.
    pub fn get_memory_path(&self, agent_id: &str) -> PathBuf {
        self.base_path.join(agent_id)
    }

    /// Read the current consolidated memory for an agent.
    pub fn read_consolidated(&self, agent_id: &str) -> Option<String> {
        let path = self.get_memory_path(agent_id).join("consolidated.md");
        fs::read_to_string(path).ok()
    }

    /// Write consolidated memory, archiving the previous version as a snapshot.
    pub fn write_consolidated(
        &self,
        agent_id: &str,
        content: &str,
        version: u32,
    ) -> Result<(), String> {
        let agent_dir = self.get_memory_path(agent_id);
        let consolidated_path = agent_dir.join("consolidated.md");
        let snapshots_dir = agent_dir.join("snapshots");

        // Ensure directories exist
        fs::create_dir_all(&snapshots_dir)
            .map_err(|e| format!("Failed to create snapshots dir: {e}"))?;

        // Archive previous version if it exists
        if consolidated_path.exists() {
            let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S");
            let snapshot_name = format!("v{}_{}.md", version, timestamp);
            let snapshot_path = snapshots_dir.join(snapshot_name);
            fs::copy(&consolidated_path, &snapshot_path)
                .map_err(|e| format!("Failed to archive snapshot: {e}"))?;
        }

        // Write new consolidated content
        fs::write(&consolidated_path, content)
            .map_err(|e| format!("Failed to write consolidated memory: {e}"))?;

        Ok(())
    }

    /// Write a digest for a specific conversation.
    pub fn write_digest(
        &self,
        agent_id: &str,
        conversation_id: &str,
        content: &str,
    ) -> Result<String, String> {
        let digests_dir = self.get_memory_path(agent_id).join("digests");
        fs::create_dir_all(&digests_dir)
            .map_err(|e| format!("Failed to create digests dir: {e}"))?;

        let digest_path = digests_dir.join(format!("{}.md", conversation_id));
        fs::write(&digest_path, content)
            .map_err(|e| format!("Failed to write digest: {e}"))?;

        Ok(conversation_id.to_string())
    }

    /// Read a specific conversation digest.
    pub fn read_digest(&self, agent_id: &str, conversation_id: &str) -> Option<String> {
        let path = self
            .get_memory_path(agent_id)
            .join("digests")
            .join(format!("{}.md", conversation_id));
        fs::read_to_string(path).ok()
    }

    /// List all digests for an agent with metadata.
    pub fn list_digests(&self, agent_id: &str) -> Vec<DigestMeta> {
        let digests_dir = self.get_memory_path(agent_id).join("digests");
        let entries = match fs::read_dir(&digests_dir) {
            Ok(entries) => entries,
            Err(_) => return Vec::new(),
        };

        let mut digests: Vec<DigestMeta> = entries
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("md") {
                    return None;
                }
                let conversation_id = path.file_stem()?.to_str()?.to_string();
                let metadata = entry.metadata().ok()?;
                let created_at = metadata
                    .modified()
                    .ok()
                    .and_then(|t| {
                        let datetime: chrono::DateTime<chrono::Utc> = t.into();
                        Some(datetime.format("%Y-%m-%dT%H:%M:%S").to_string())
                    })
                    .unwrap_or_default();
                Some(DigestMeta {
                    conversation_id,
                    created_at,
                })
            })
            .collect();

        digests.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        digests
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup() -> (TempDir, SystemMemoryManager) {
        let tmp = TempDir::new().unwrap();
        let mgr = SystemMemoryManager::new(tmp.path());
        (tmp, mgr)
    }

    #[test]
    fn test_read_consolidated_missing() {
        let (_tmp, mgr) = setup();
        assert!(mgr.read_consolidated("agent-1").is_none());
    }

    #[test]
    fn test_write_and_read_consolidated() {
        let (_tmp, mgr) = setup();
        mgr.write_consolidated("agent-1", "# Memory v1", 1).unwrap();
        let content = mgr.read_consolidated("agent-1").unwrap();
        assert_eq!(content, "# Memory v1");
    }

    #[test]
    fn test_write_consolidated_creates_snapshot() {
        let (_tmp, mgr) = setup();
        mgr.write_consolidated("agent-1", "v1 content", 1).unwrap();
        mgr.write_consolidated("agent-1", "v2 content", 1).unwrap();

        // consolidated should be latest
        assert_eq!(mgr.read_consolidated("agent-1").unwrap(), "v2 content");

        // snapshot directory should have one file
        let snapshots_dir = mgr.get_memory_path("agent-1").join("snapshots");
        let count = fs::read_dir(&snapshots_dir).unwrap().count();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_write_and_read_digest() {
        let (_tmp, mgr) = setup();
        let id = mgr.write_digest("agent-1", "conv-123", "digest content").unwrap();
        assert_eq!(id, "conv-123");

        let content = mgr.read_digest("agent-1", "conv-123").unwrap();
        assert_eq!(content, "digest content");
    }

    #[test]
    fn test_read_digest_missing() {
        let (_tmp, mgr) = setup();
        assert!(mgr.read_digest("agent-1", "nonexistent").is_none());
    }

    #[test]
    fn test_list_digests_empty() {
        let (_tmp, mgr) = setup();
        assert!(mgr.list_digests("agent-1").is_empty());
    }

    #[test]
    fn test_list_digests() {
        let (_tmp, mgr) = setup();
        mgr.write_digest("agent-1", "conv-a", "a").unwrap();
        mgr.write_digest("agent-1", "conv-b", "b").unwrap();

        let digests = mgr.list_digests("agent-1");
        assert_eq!(digests.len(), 2);

        let ids: Vec<&str> = digests.iter().map(|d| d.conversation_id.as_str()).collect();
        assert!(ids.contains(&"conv-a"));
        assert!(ids.contains(&"conv-b"));
    }

    #[test]
    fn test_get_memory_path() {
        let (_tmp, mgr) = setup();
        let path = mgr.get_memory_path("agent-1");
        assert!(path.ends_with("memory/agent-1"));
    }

    #[test]
    fn test_multiple_agents_isolated() {
        let (_tmp, mgr) = setup();
        mgr.write_consolidated("agent-a", "memory A", 1).unwrap();
        mgr.write_consolidated("agent-b", "memory B", 1).unwrap();
        mgr.write_digest("agent-a", "conv-1", "digest A").unwrap();

        assert_eq!(mgr.read_consolidated("agent-a").unwrap(), "memory A");
        assert_eq!(mgr.read_consolidated("agent-b").unwrap(), "memory B");
        assert!(mgr.read_digest("agent-b", "conv-1").is_none());
    }

    #[test]
    fn test_snapshot_filename_format() {
        let (_tmp, mgr) = setup();
        mgr.write_consolidated("agent-1", "old", 1).unwrap();
        mgr.write_consolidated("agent-1", "new", 2).unwrap();

        let snapshots_dir = mgr.get_memory_path("agent-1").join("snapshots");
        let entries: Vec<String> = fs::read_dir(&snapshots_dir)
            .unwrap()
            .filter_map(|e| {
                e.ok()
                    .and_then(|e| e.file_name().to_str().map(String::from))
            })
            .collect();

        assert_eq!(entries.len(), 1);
        // Snapshot uses the version passed in the write call that triggers archival
        assert!(entries[0].starts_with("v2_"), "Expected v2_ prefix, got: {}", entries[0]);
        assert!(entries[0].ends_with(".md"));
    }

    #[test]
    fn test_overwrite_digest() {
        let (_tmp, mgr) = setup();
        mgr.write_digest("agent-1", "conv-1", "first").unwrap();
        mgr.write_digest("agent-1", "conv-1", "second").unwrap();

        let content = mgr.read_digest("agent-1", "conv-1").unwrap();
        assert_eq!(content, "second");

        // Should still be only one file
        let digests = mgr.list_digests("agent-1");
        assert_eq!(digests.len(), 1);
    }
}
