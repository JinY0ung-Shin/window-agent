use chrono::Utc;
use std::path::{Path, PathBuf};
use uuid::Uuid;
use walkdir::WalkDir;

use super::note_registry::NoteRegistry;
use super::links::{self, LinkIndex, LinkRef};
use super::note::{compute_revision, parse_frontmatter, sanitize_title_to_filename, serialize_note, Frontmatter};
use super::graph;
use super::search;
use super::security::VaultSecurity;
use super::{IndexStats, VaultNote, VaultNoteSummary, strip_title_heading};

/// Extract title from body: first `# heading` or first non-empty line.
pub(crate) fn extract_title_from_body(body: &str) -> String {
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

    // ── Incremental index helpers (for external mutations) ──

    /// Index (or re-index) a single note by its file path.
    ///
    /// Used after external writes (tool_vault_write_file, relay write_file, etc.)
    /// instead of a full rebuild_index(). Reads the file, parses frontmatter,
    /// registers/updates in NoteRegistry, and refreshes LinkIndex + tags.
    pub fn index_single_note(&mut self, path: &Path) -> Result<(), String> {
        if !path.is_file() {
            return Err(format!("Not a file: {}", path.display()));
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            return Ok(()); // Not a markdown file, nothing to index
        }

        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;

        let (fm, body) = parse_frontmatter(&content)?;

        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        // Check if this note was already registered (update case)
        let is_update = self.registry.id_to_path.contains_key(&fm.id);

        if is_update {
            // Update path mapping (file may have been renamed externally)
            let old_path = self.registry.id_to_path.get(&fm.id).cloned();
            self.registry.id_to_path.insert(fm.id.clone(), path.to_path_buf());
            if let Some(ref old) = old_path {
                self.registry.path_to_id.remove(old);
            }
            self.registry.path_to_id.insert(path.to_path_buf(), fm.id.clone());
            self.registry.agent_map.insert(fm.id.clone(), fm.agent.clone());
            self.registry.updated_map.insert(fm.id.clone(), fm.updated.clone());
            self.registry.update_name(&fm.id, &name);
        } else {
            // New note — register
            self.registry.register(
                fm.id.clone(),
                path.to_path_buf(),
                &fm.agent,
                &name,
                &fm.updated,
            );
        }

        // Refresh link_index + tag_index for this note
        let wikilinks = links::parse_wikilinks(&body);
        self.link_index
            .update_note_with_tags(&fm.id, &wikilinks, &fm.tags, &self.registry, &fm.agent);

        // Re-resolve any previously broken links that might now point to this note
        self.link_index
            .try_resolve_broken_links(&name, &fm.id, &self.registry);

        Ok(())
    }

    /// Remove a note from the index by its file path.
    ///
    /// Used after external deletes instead of a full rebuild_index().
    pub fn unindex_path(&mut self, path: &Path) {
        if let Some(note_id) = self.registry.path_to_id.get(path).cloned() {
            self.link_index.remove_note(&note_id);
            self.registry.unregister(&note_id);
        }
    }

    // ── CRUD operations ──

    /// Create a new note in the vault.
    #[allow(clippy::too_many_arguments)]
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
    #[allow(clippy::too_many_arguments)]
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
    #[allow(clippy::too_many_arguments)]
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
    ) -> Vec<search::SearchResult> {
        search::search(query, &self.vault_path, agent_id, scope)
    }

    /// Build a "recall" of memory notes for prompt injection.
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
