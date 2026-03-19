pub mod graph;
pub mod links;
pub mod note;
pub mod search;
pub mod security;
pub mod watcher;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

use links::{LinkIndex, LinkRef};
use note::{compute_revision, parse_frontmatter, sanitize_title_to_filename, serialize_note, Frontmatter};
use search::SearchResult;
use security::VaultSecurity;

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

// ── NoteRegistry ──

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

// ── VaultManager ──

/// Manages the Obsidian-style vault: file CRUD, indexing, and link resolution.
pub struct VaultManager {
    pub vault_path: PathBuf,
    pub registry: NoteRegistry,
    pub link_index: LinkIndex,
    security: VaultSecurity,
}

impl VaultManager {
    /// Create a new VaultManager and initialize the vault directory structure.
    pub fn new(vault_path: PathBuf) -> Result<Self, String> {
        // Create directory structure
        let dirs = [
            "agents",
            "shared",
            "shared/project",
            "shared/people",
            "shared/incidents",
            "shared/glossary",
            "templates",
        ];
        for dir in &dirs {
            let dir_path = vault_path.join(dir);
            std::fs::create_dir_all(&dir_path)
                .map_err(|e| format!("Failed to create vault dir '{}': {e}", dir_path.display()))?;
        }

        let security = VaultSecurity::new(vault_path.clone());

        let mut manager = Self {
            vault_path,
            registry: NoteRegistry::new(),
            link_index: LinkIndex::default(),
            security,
        };

        manager.rebuild_index()?;

        Ok(manager)
    }

    /// Rebuild the entire index by scanning all markdown files in the vault.
    pub fn rebuild_index(&mut self) -> Result<IndexStats, String> {
        self.registry.clear();

        let mut note_data: Vec<(String, String, Vec<String>, String)> = Vec::new();

        for entry in WalkDir::new(&self.vault_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            // Skip _index.md and template files
            if path.file_name().and_then(|n| n.to_str()) == Some("_index.md") {
                continue;
            }
            // Skip .obsidian directory
            if path
                .components()
                .any(|c| c.as_os_str() == ".obsidian")
            {
                continue;
            }
            // Skip agent workspace directories (agents/*/workspace/**)
            if let Ok(rel) = path.strip_prefix(&self.vault_path) {
                let components: Vec<_> = rel.components()
                    .map(|c| c.as_os_str().to_string_lossy().to_string())
                    .collect();
                if components.len() >= 3
                    && components[0] == "agents"
                    && components[2] == "workspace"
                {
                    continue;
                }
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (fm, body) = match parse_frontmatter(&content) {
                Ok(result) => result,
                Err(_) => continue, // Skip files without valid frontmatter
            };

            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();

            self.registry.register(
                fm.id.clone(),
                path.to_path_buf(),
                &fm.agent,
                &name,
                &fm.updated,
            );

            note_data.push((fm.id, fm.agent, fm.tags, body));
        }

        // Rebuild link index
        let notes_iter = note_data
            .iter()
            .map(|(id, agent, tags, body)| (id.as_str(), agent.as_str(), tags.as_slice(), body.as_str()));

        self.link_index = LinkIndex::rebuild(
            notes_iter,
            &self.registry.id_to_path,
            &self.registry.name_to_ids,
            &self.registry.agent_map,
            &self.registry.updated_map,
        );

        let total_links: usize = self.link_index.outgoing.values().map(|v| v.len()).sum();
        let broken_links: usize = self
            .link_index
            .outgoing
            .values()
            .flat_map(|v| v.iter())
            .filter(|l| !l.resolved)
            .count();
        let total_tags = self.link_index.tag_index.len();

        Ok(IndexStats {
            total_notes: self.registry.id_to_path.len(),
            total_links,
            broken_links,
            total_tags,
        })
    }

    // ── CRUD operations ──

    /// Create a new note in the vault.
    pub fn create_note(
        &mut self,
        agent_id: &str,
        scope: Option<&str>,
        category: &str,
        title: &str,
        content: &str,
        tags: Vec<String>,
        related_ids: Vec<String>,
    ) -> Result<VaultNote, String> {
        self.create_note_with_provenance(agent_id, scope, category, title, content, tags, related_ids, None)
    }

    /// Create a new note with optional conversation provenance.
    pub fn create_note_with_provenance(
        &mut self,
        agent_id: &str,
        scope: Option<&str>,
        category: &str,
        title: &str,
        content: &str,
        tags: Vec<String>,
        related_ids: Vec<String>,
        source_conversation: Option<&str>,
    ) -> Result<VaultNote, String> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let is_shared = scope == Some("shared");

        // Build body with title and wikilinks to related notes
        let mut body = format!("# {title}\n\n{content}\n");
        if !related_ids.is_empty() {
            body.push_str("\n## Related\n");
            for rid in &related_ids {
                body.push_str(&format!("- [[{rid}]]\n"));
            }
        }

        let revision = compute_revision(&body);

        let frontmatter = Frontmatter {
            id: id.clone(),
            agent: agent_id.to_string(),
            note_type: category.to_string(),
            tags: tags.clone(),
            confidence: 0.5,
            created: now.clone(),
            updated: now.clone(),
            revision,
            source: None,
            aliases: Vec::new(),
            legacy_id: None,
            scope: if is_shared {
                Some("shared".to_string())
            } else {
                None
            },
            last_edited_by: if is_shared {
                Some(agent_id.to_string())
            } else {
                None
            },
            source_conversation: source_conversation.map(|s| s.to_string()),
        };

        let file_content = serialize_note(&frontmatter, &body);

        // Determine path
        let dir = if is_shared {
            self.vault_path.join("shared").join(category)
        } else {
            self.vault_path
                .join("agents")
                .join(agent_id)
                .join(category)
        };

        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create category dir: {e}"))?;

        let filename = sanitize_title_to_filename(title);
        VaultSecurity::sanitize_filename(&format!("{filename}.md"))?;

        let file_path = dir.join(format!("{filename}.md"));

        // Handle collision
        let final_path = if file_path.exists() {
            let mut counter = 1;
            loop {
                let candidate = dir.join(format!("{filename}-{counter}.md"));
                if !candidate.exists() {
                    break candidate;
                }
                counter += 1;
            }
        } else {
            file_path
        };

        // Validate path is within vault
        self.security.validate_within_vault(&final_path)?;

        std::fs::write(&final_path, &file_content)
            .map_err(|e| format!("Failed to write note: {e}"))?;

        // Register
        self.registry
            .register(id.clone(), final_path.clone(), agent_id, &filename, &now);

        // Refresh link_index + tag_index for this note
        let wikilinks = links::parse_wikilinks(&body);
        self.link_index.update_note_with_tags(&id, &wikilinks, &tags, &self.registry, agent_id);

        // Re-resolve any previously broken links that might now point to this new note
        self.link_index.try_resolve_broken_links(&filename, &id, &self.registry);

        Ok(VaultNote {
            id,
            agent: agent_id.to_string(),
            note_type: category.to_string(),
            tags,
            confidence: 0.5,
            created: now.clone(),
            updated: now,
            revision: frontmatter.revision,
            source: None,
            aliases: Vec::new(),
            legacy_id: None,
            scope: frontmatter.scope,
            last_edited_by: frontmatter.last_edited_by,
            source_conversation: frontmatter.source_conversation,
            title: title.to_string(),
            content: content.to_string(),
            path: final_path.to_string_lossy().to_string(),
        })
    }

    /// Read a note by its UUID.
    pub fn read_note(&self, note_id: &str) -> Result<VaultNote, String> {
        let path = self
            .registry
            .id_to_path
            .get(note_id)
            .ok_or_else(|| format!("Note not found: {note_id}"))?;

        let content =
            std::fs::read_to_string(path).map_err(|e| format!("Failed to read note: {e}"))?;

        let (fm, body) = parse_frontmatter(&content)?;

        let title = extract_title_from_body(&body);

        Ok(VaultNote {
            id: fm.id,
            agent: fm.agent,
            note_type: fm.note_type,
            tags: fm.tags,
            confidence: fm.confidence,
            created: fm.created,
            updated: fm.updated,
            revision: fm.revision,
            source: fm.source,
            aliases: fm.aliases,
            legacy_id: fm.legacy_id,
            scope: fm.scope,
            last_edited_by: fm.last_edited_by,
            source_conversation: fm.source_conversation,
            title,
            content: body,
            path: path.to_string_lossy().to_string(),
        })
    }

    /// Update a note's title, content, tags, or confidence.
    pub fn update_note(
        &mut self,
        note_id: &str,
        caller_agent_id: &str,
        title: Option<&str>,
        content: Option<&str>,
        tags: Option<Vec<String>>,
        confidence: Option<f64>,
        add_links: Option<Vec<String>>,
    ) -> Result<VaultNote, String> {
        let path = self
            .registry
            .id_to_path
            .get(note_id)
            .ok_or_else(|| format!("Note not found: {note_id}"))?
            .clone();

        let file_content =
            std::fs::read_to_string(&path).map_err(|e| format!("Failed to read note: {e}"))?;

        let (mut fm, mut body) = parse_frontmatter(&file_content)?;

        // Update title heading if provided
        if let Some(new_title) = title {
            let current_title = extract_title_from_body(&body);
            body = body.replacen(&format!("# {current_title}"), &format!("# {new_title}"), 1);
        }

        if let Some(new_content) = content {
            // Preserve the title heading (possibly already updated above), replace body
            let current_title = extract_title_from_body(&body);
            body = format!("# {current_title}\n\n{new_content}\n");
        }

        if let Some(new_tags) = &tags {
            fm.tags = new_tags.clone();
        }

        if let Some(new_confidence) = confidence {
            fm.confidence = new_confidence;
        }

        if let Some(links) = &add_links {
            if !links.is_empty() {
                if !body.contains("## Related") {
                    body.push_str("\n## Related\n");
                }
                for link_id in links {
                    body.push_str(&format!("- [[{link_id}]]\n"));
                }
            }
        }

        let now = Utc::now().to_rfc3339();
        fm.updated = now.clone();
        fm.revision = compute_revision(&body);

        // If it's a shared note, record who edited
        if fm.scope.as_deref() == Some("shared") {
            fm.last_edited_by = Some(caller_agent_id.to_string());
        }

        let new_content = serialize_note(&fm, &body);

        // If title changed, rename the file
        let final_path = if title.is_some() {
            let new_title = extract_title_from_body(&body);
            let new_filename = sanitize_title_to_filename(&new_title);
            let dir = path.parent().ok_or("Note has no parent directory")?;
            let new_path = dir.join(format!("{new_filename}.md"));

            if new_path != path {
                // Handle collision
                let target = if new_path.exists() {
                    let mut counter = 1;
                    loop {
                        let candidate = dir.join(format!("{new_filename}-{counter}.md"));
                        if !candidate.exists() {
                            break candidate;
                        }
                        counter += 1;
                    }
                } else {
                    new_path
                };

                self.security.validate_within_vault(&target)?;
                std::fs::write(&target, &new_content)
                    .map_err(|e| format!("Failed to write note: {e}"))?;
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove old note file: {e}"))?;

                // Update registry with new path
                self.registry.id_to_path.insert(note_id.to_string(), target.clone());
                self.registry.path_to_id.remove(&path);
                self.registry.path_to_id.insert(target.clone(), note_id.to_string());

                target
            } else {
                std::fs::write(&path, &new_content)
                    .map_err(|e| format!("Failed to write note: {e}"))?;
                path
            }
        } else {
            std::fs::write(&path, &new_content)
                .map_err(|e| format!("Failed to write note: {e}"))?;
            path
        };

        // Update registry timestamp
        self.registry.updated_map.insert(note_id.to_string(), now);

        // Refresh link_index + tag_index for this note
        let wikilinks = links::parse_wikilinks(&body);
        self.link_index.update_note_with_tags(note_id, &wikilinks, &fm.tags, &self.registry, caller_agent_id);

        // If title/filename changed, update name_to_ids and rebuild link_index
        // so that other notes referencing the old filename get re-resolved immediately.
        if title.is_some() {
            let new_title = extract_title_from_body(&body);
            let new_filename = sanitize_title_to_filename(&new_title);
            self.registry.update_name(note_id, &new_filename);
            // Full rebuild to re-resolve all cross-references after rename
            let _ = self.rebuild_index();
        }

        let resolved_title = extract_title_from_body(&body);

        Ok(VaultNote {
            id: fm.id,
            agent: fm.agent,
            note_type: fm.note_type,
            tags: fm.tags,
            confidence: fm.confidence,
            created: fm.created,
            updated: fm.updated,
            revision: fm.revision,
            source: fm.source,
            aliases: fm.aliases,
            legacy_id: fm.legacy_id,
            scope: fm.scope,
            last_edited_by: fm.last_edited_by,
            source_conversation: fm.source_conversation,
            title: resolved_title,
            content: body,
            path: final_path.to_string_lossy().to_string(),
        })
    }

    /// Delete a note by UUID.
    ///
    /// `caller` is "user" or an agent_id. Shared notes can only be deleted by "user".
    pub fn delete_note(&mut self, note_id: &str, caller: &str) -> Result<(), String> {
        let path = self
            .registry
            .id_to_path
            .get(note_id)
            .ok_or_else(|| format!("Note not found: {note_id}"))?
            .clone();

        // Check if shared note + agent caller → forbidden
        if caller != "user" {
            let content =
                std::fs::read_to_string(&path).map_err(|e| format!("Failed to read note: {e}"))?;
            if let Ok((fm, _)) = parse_frontmatter(&content) {
                if fm.scope.as_deref() == Some("shared") {
                    return Err(
                        "SharedDeleteForbidden: agents cannot delete shared notes".to_string()
                    );
                }
            }
        }

        std::fs::remove_file(&path).map_err(|e| format!("Failed to delete note: {e}"))?;

        // Remove from link_index
        self.link_index.remove_note(note_id);

        self.registry.unregister(note_id);

        Ok(())
    }

    /// List notes, optionally filtered by agent, category, and tags.
    pub fn list_notes(
        &self,
        agent_id: Option<&str>,
        category: Option<&str>,
        tags: Option<&[String]>,
    ) -> Vec<VaultNoteSummary> {
        let mut summaries = Vec::new();

        for (id, path) in &self.registry.id_to_path {
            // Skip archived notes
            if let Ok(rel) = path.strip_prefix(&self.vault_path) {
                if rel.components().any(|c| c.as_os_str() == "archive") {
                    continue;
                }
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let (fm, body) = match parse_frontmatter(&content) {
                Ok(r) => r,
                Err(_) => continue,
            };

            // Filter by agent
            if let Some(aid) = agent_id {
                let is_agent_note = fm.agent == aid;
                let is_shared = fm.scope.as_deref() == Some("shared");
                if !is_agent_note && !is_shared {
                    continue;
                }
            }

            // Filter by category
            if let Some(cat) = category {
                if fm.note_type != cat {
                    continue;
                }
            }

            // Filter by tags (all specified tags must be present)
            if let Some(filter_tags) = tags {
                if !filter_tags.iter().all(|t| fm.tags.contains(t)) {
                    continue;
                }
            }

            let title = extract_title_from_body(&body);
            let stripped = strip_title_heading(&body);
            let body_preview = if stripped.chars().count() > 200 {
                let truncated: String = stripped.chars().take(200).collect();
                format!("{truncated}...")
            } else {
                stripped
            };

            summaries.push(VaultNoteSummary {
                id: id.clone(),
                agent: fm.agent,
                note_type: fm.note_type,
                title,
                body_preview,
                tags: fm.tags,
                confidence: fm.confidence,
                scope: fm.scope,
                source_conversation: fm.source_conversation,
                created: fm.created,
                updated: fm.updated,
            });
        }

        // Sort by updated descending
        summaries.sort_by(|a, b| b.updated.cmp(&a.updated));

        summaries
    }

    /// Archive a note by moving it from knowledge/ to archive/.
    ///
    /// Archived notes are excluded from `list_notes()`, `search()`, and `recall()`,
    /// but can still be read directly via `read_note()`.
    pub fn archive_note(&mut self, note_id: &str, agent_id: &str) -> Result<(), String> {
        let path = self
            .registry
            .id_to_path
            .get(note_id)
            .ok_or_else(|| format!("Note not found: {note_id}"))?
            .clone();

        // Check if already archived
        if let Ok(rel) = path.strip_prefix(&self.vault_path) {
            if rel.components().any(|c| c.as_os_str() == "archive") {
                return Err(format!("Note already archived: {note_id}"));
            }
        }

        // Build archive destination preserving category subdirectory to avoid collisions.
        // e.g., agents/<id>/knowledge/note.md → agents/<id>/archive/knowledge/note.md
        let agent_base = self.vault_path.join("agents").join(agent_id);
        let relative = path.strip_prefix(&agent_base)
            .map_err(|_| format!("Note path not under agent directory: {}", path.display()))?;
        let archive_dest = agent_base.join("archive").join(relative);

        if let Some(parent) = archive_dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create archive dir: {e}"))?;
        }

        let dest = archive_dest;

        // Validate destination is within vault
        self.security.validate_within_vault(&dest)?;

        // Move the file
        std::fs::rename(&path, &dest)
            .map_err(|e| format!("Failed to move note to archive: {e}"))?;

        // Update registry
        self.registry.id_to_path.insert(note_id.to_string(), dest.clone());
        self.registry.path_to_id.remove(&path);
        self.registry.path_to_id.insert(dest, note_id.to_string());

        Ok(())
    }

    /// Search the vault for notes matching a query.
    pub fn search(
        &self,
        query: &str,
        agent_id: Option<&str>,
        scope: Option<&str>,
    ) -> Vec<SearchResult> {
        search::search(query, &self.vault_path, agent_id, scope)
    }

    /// Build a "recall" of memory notes for prompt injection.
    ///
    /// Returns the most recent notes for an agent, formatted as a simple list.
    pub fn recall(&self, agent_id: &str, limit: usize) -> Vec<VaultNoteSummary> {
        let mut notes = self.list_notes(Some(agent_id), None, None);
        notes.truncate(limit);
        notes
    }

    /// Get the knowledge graph data.
    pub fn get_graph(
        &self,
        agent_id: Option<&str>,
        depth: Option<u32>,
        include_shared: bool,
    ) -> graph::GraphData {
        let note_infos: Vec<graph::NoteInfo> = self
            .registry
            .id_to_path
            .iter()
            .filter_map(|(id, path)| {
                let content = std::fs::read_to_string(path).ok()?;
                let (fm, body) = parse_frontmatter(&content).ok()?;
                let title = extract_title_from_body(&body);
                let is_shared = fm.scope.as_deref() == Some("shared");
                Some(graph::NoteInfo {
                    id: id.clone(),
                    label: title,
                    agent: fm.agent,
                    note_type: fm.note_type,
                    tags: fm.tags,
                    confidence: fm.confidence,
                    updated_at: fm.updated,
                    is_shared,
                })
            })
            .collect();

        graph::build_graph(&note_infos, &self.link_index, agent_id, depth, include_shared)
    }

    /// Get backlinks for a note.
    pub fn get_backlinks(&self, note_id: &str) -> Vec<LinkRef> {
        self.link_index
            .incoming
            .get(note_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Get outgoing links for a note.
    pub fn get_outgoing_links(&self, note_id: &str) -> Vec<LinkRef> {
        self.link_index
            .outgoing
            .get(note_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Check if a note is in shared/ scope.
    pub fn is_shared_note(&self, note_id: &str) -> bool {
        if let Some(path) = self.registry.id_to_path.get(note_id) {
            // Check if the path contains /shared/
            path.components().any(|c| c.as_os_str() == "shared")
        } else {
            false
        }
    }

    /// Get the vault path.
    pub fn get_vault_path(&self) -> &Path {
        &self.vault_path
    }
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

/// Extract title from body: first `# heading` or first non-empty line.
fn extract_title_from_body(body: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("# ") {
            return heading.trim().to_string();
        }
        return trimmed.to_string();
    }
    "Untitled".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
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
