use std::collections::HashMap;
use std::path::PathBuf;

/// In-memory index mapping note IDs to file paths and vice versa.
#[derive(Debug, Clone, Default)]
pub struct NoteRegistry {
    pub id_to_path: HashMap<String, PathBuf>,
    pub path_to_id: HashMap<PathBuf, String>,
    pub name_to_ids: HashMap<String, Vec<String>>,
    /// note_id → agent (for link resolution)
    pub agent_map: HashMap<String, String>,
    /// note_id → updated timestamp (for link resolution tiebreaking)
    pub updated_map: HashMap<String, String>,
}

impl NoteRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a note in the index.
    pub fn register(
        &mut self,
        id: String,
        path: PathBuf,
        agent: &str,
        name: &str,
        updated: &str,
    ) {
        self.id_to_path.insert(id.clone(), path.clone());
        self.path_to_id.insert(path, id.clone());
        self.name_to_ids
            .entry(name.to_string())
            .or_default()
            .push(id.clone());
        self.agent_map.insert(id.clone(), agent.to_string());
        self.updated_map.insert(id, updated.to_string());
    }

    /// Remove a note from the index by ID.
    pub fn unregister(&mut self, id: &str) {
        if let Some(path) = self.id_to_path.remove(id) {
            self.path_to_id.remove(&path);
        }
        self.agent_map.remove(id);
        self.updated_map.remove(id);
        // Remove from name_to_ids
        for ids in self.name_to_ids.values_mut() {
            ids.retain(|i| i != id);
        }
        self.name_to_ids.retain(|_, v| !v.is_empty());
    }

    /// Update the name mapping for a note (after title/file rename).
    pub fn update_name(&mut self, id: &str, new_name: &str) {
        // Remove old name entries
        for ids in self.name_to_ids.values_mut() {
            ids.retain(|i| i != id);
        }
        self.name_to_ids.retain(|_, v| !v.is_empty());
        // Add new name
        self.name_to_ids
            .entry(new_name.to_string())
            .or_default()
            .push(id.to_string());
    }

    /// Clear all entries.
    pub fn clear(&mut self) {
        self.id_to_path.clear();
        self.path_to_id.clear();
        self.name_to_ids.clear();
        self.agent_map.clear();
        self.updated_map.clear();
    }
}
