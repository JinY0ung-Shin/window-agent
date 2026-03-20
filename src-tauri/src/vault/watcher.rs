use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// Events emitted by the vault watcher to the frontend.
pub const EVENT_NOTE_CHANGED: &str = "vault:note-changed";
pub const EVENT_NOTE_MOVED: &str = "vault:note-moved";
pub const EVENT_NOTE_REMOVED: &str = "vault:note-removed";

/// Watches the vault directory for file changes and emits Tauri events.
pub struct VaultWatcher {
    pub vault_path: PathBuf,
    pub debounce_ms: u64,
}

/// Payload emitted with vault change events.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VaultChangePayload {
    pub path: String,
    pub note_id: Option<String>,
}

impl VaultWatcher {
    pub fn new(vault_path: PathBuf, debounce_ms: u64) -> Self {
        Self {
            vault_path,
            debounce_ms,
        }
    }

    /// Start watching the vault directory. This should be called on a background thread.
    ///
    /// Returns a shutdown handle (drop it to stop watching).
    pub fn start<R: tauri::Runtime>(
        &self,
        app_handle: tauri::AppHandle<R>,
    ) -> Result<RecommendedWatcher, String> {
        let vault_path = self.vault_path.clone();
        let debounce_ms = self.debounce_ms;

        let (tx, rx) = mpsc::channel::<Event>();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            Config::default(),
        )
        .map_err(|e| format!("Failed to create watcher: {e}"))?;

        watcher
            .watch(&vault_path, RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch vault: {e}"))?;

        // Spawn debounce processing thread
        let app = app_handle.clone();
        std::thread::spawn(move || {
            let debounce = Duration::from_millis(debounce_ms);
            let mut last_event_time = Instant::now();
            let mut pending_paths: std::collections::HashSet<PathBuf> =
                std::collections::HashSet::new();
            let mut pending_kinds: std::collections::HashMap<PathBuf, EventKind> =
                std::collections::HashMap::new();

            loop {
                match rx.recv_timeout(debounce) {
                    Ok(event) => {
                        for path in &event.paths {
                            // Only track .md files
                            if path.extension().and_then(|e| e.to_str()) == Some("md") {
                                pending_paths.insert(path.clone());
                                pending_kinds.insert(path.clone(), event.kind);
                            }
                        }
                        last_event_time = Instant::now();
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if !pending_paths.is_empty()
                            && last_event_time.elapsed() >= debounce
                        {
                            process_events(&app, &pending_paths, &pending_kinds);
                            pending_paths.clear();
                            pending_kinds.clear();
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }
        });

        Ok(watcher)
    }
}

/// Process debounced file events: update VaultManager indexes AND emit Tauri events.
fn process_events<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &std::collections::HashSet<PathBuf>,
    kinds: &std::collections::HashMap<PathBuf, EventKind>,
) {
    // Update VaultManager registry/link_index for each changed file
    if let Some(vault_state) = app.try_state::<crate::commands::vault_commands::VaultState>() {
        if let Ok(mut vm) = vault_state.inner().lock() {
            if !paths.is_empty() {
                // Any file change — rebuild full index for correctness.
                // This is simpler and avoids borrow checker issues with
                // incremental updates in the watcher context. Since external
                // edits are infrequent, full rebuild is acceptable here.
                let _ = vm.rebuild_index();
            }
        }
    }

    // Emit Tauri events to frontend
    for path in paths {
        let kind = kinds.get(path).copied();
        let path_str = path.to_string_lossy().to_string();
        let note_id = extract_note_id(path);

        let payload = VaultChangePayload {
            path: path_str,
            note_id: note_id.clone(),
        };

        match kind {
            Some(EventKind::Create(_)) | Some(EventKind::Modify(_)) => {
                let _ = app.emit(EVENT_NOTE_CHANGED, &payload);
            }
            Some(EventKind::Remove(_)) => {
                let _ = app.emit(EVENT_NOTE_REMOVED, &payload);
            }
            _ => {
                let _ = app.emit(EVENT_NOTE_CHANGED, &payload);
            }
        }
    }
}

/// Try to read the note_id from the frontmatter of a file.
fn extract_note_id(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let (fm, _) = super::note::parse_frontmatter(&content).ok()?;
    Some(fm.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_watcher_new() {
        let w = VaultWatcher::new(PathBuf::from("/tmp/vault"), 300);
        assert_eq!(w.vault_path, PathBuf::from("/tmp/vault"));
        assert_eq!(w.debounce_ms, 300);
    }

    #[test]
    fn test_extract_note_id_from_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("test.md");
        std::fs::write(
            &path,
            r#"---
id: "test-uuid-123"
agent: "manager"
type: "knowledge"
tags: []
confidence: 0.5
created: "2026-01-01T00:00:00Z"
updated: "2026-01-01T00:00:00Z"
revision: "abcd1234"
---
# Test note
"#,
        )
        .unwrap();

        let id = extract_note_id(&path);
        assert_eq!(id.as_deref(), Some("test-uuid-123"));
    }
}
