use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::LazyLock;

/// A parsed wikilink from note content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikiLink {
    /// The target part of the link (before |)
    pub target: String,
    /// Optional display text (after |)
    pub display_text: Option<String>,
    /// Line number where the link was found (1-based)
    pub line_number: u32,
}

/// A resolved reference between two notes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    pub source_id: String,
    pub target_id: String,
    /// Original wikilink text
    pub raw_link: String,
    pub display_text: Option<String>,
    pub line_number: u32,
    /// false if the link target could not be resolved
    pub resolved: bool,
}

/// Context needed to resolve wikilinks for a specific agent.
pub struct ResolverContext {
    pub current_agent: String,
}

/// Result of resolving a single wikilink.
#[derive(Debug, Clone)]
pub enum ResolveResult {
    Resolved(String),
    Ambiguous {
        chosen: String,
        alternatives: Vec<String>,
    },
    Broken,
}

/// In-memory index of all links and tags across the vault.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LinkIndex {
    /// note_id → outgoing LinkRefs from this note
    pub outgoing: HashMap<String, Vec<LinkRef>>,
    /// note_id → incoming LinkRefs pointing to this note
    pub incoming: HashMap<String, Vec<LinkRef>>,
    /// tag → note_ids that have this tag
    pub tag_index: HashMap<String, Vec<String>>,
}

static WIKILINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").expect("WIKILINK_RE: hardcoded regex must compile"));

/// Parse all wikilinks from markdown content.
pub fn parse_wikilinks(content: &str) -> Vec<WikiLink> {
    let mut links = Vec::new();
    for (line_idx, line) in content.lines().enumerate() {
        for cap in WIKILINK_RE.captures_iter(line) {
            links.push(WikiLink {
                target: cap[1].trim().to_string(),
                display_text: cap.get(2).map(|m| m.as_str().trim().to_string()),
                line_number: (line_idx + 1) as u32,
            });
        }
    }
    links
}

/// Resolve a wikilink target to a note ID using the NoteRegistry.
///
/// Resolution order (deterministic):
/// 1. Direct UUID match in id_to_path
/// 2. Unique name match in name_to_ids (exactly one result)
/// 3. Among multiple name matches, prefer same agent
/// 4. Among remaining, pick the most recently updated
pub fn resolve_wikilink(
    target: &str,
    id_to_path: &HashMap<String, std::path::PathBuf>,
    name_to_ids: &HashMap<String, Vec<String>>,
    agent_map: &HashMap<String, String>, // note_id → agent
    updated_map: &HashMap<String, String>, // note_id → updated timestamp
    context: &ResolverContext,
) -> ResolveResult {
    // 1. Direct UUID match
    if id_to_path.contains_key(target) {
        return ResolveResult::Resolved(target.to_string());
    }

    // 2. Name-based lookup
    let name = target
        .rsplit('/')
        .next()
        .unwrap_or(target)
        .trim();

    let candidates = match name_to_ids.get(name) {
        Some(ids) if !ids.is_empty() => ids.clone(),
        _ => return ResolveResult::Broken,
    };

    if candidates.len() == 1 {
        return ResolveResult::Resolved(candidates[0].clone());
    }

    // 3. Prefer same agent
    let same_agent: Vec<_> = candidates
        .iter()
        .filter(|id| {
            agent_map
                .get(*id)
                .map(|a| a == &context.current_agent)
                .unwrap_or(false)
        })
        .cloned()
        .collect();

    if same_agent.len() == 1 {
        let chosen = same_agent[0].clone();
        let alternatives = candidates
            .into_iter()
            .filter(|id| id != &chosen)
            .collect();
        return ResolveResult::Ambiguous {
            chosen,
            alternatives,
        };
    }

    // 4. Pick most recently updated
    let pool = if same_agent.is_empty() {
        &candidates
    } else {
        &same_agent
    };

    let mut best = pool[0].clone();
    let mut best_ts = updated_map.get(&pool[0]).cloned().unwrap_or_default();
    for id in pool.iter().skip(1) {
        let ts = updated_map.get(id).cloned().unwrap_or_default();
        if ts > best_ts {
            best = id.clone();
            best_ts = ts;
        }
    }

    let alternatives = candidates
        .into_iter()
        .filter(|id| id != &best)
        .collect();

    ResolveResult::Ambiguous {
        chosen: best,
        alternatives,
    }
}

impl LinkIndex {
    /// Build a fresh LinkIndex from all notes.
    ///
    /// Parameters:
    /// - `notes`: iterator of (note_id, agent, tags, content) tuples
    /// - `id_to_path`, `name_to_ids`, `agent_map`, `updated_map`: from NoteRegistry
    pub fn rebuild<'a>(
        notes: impl Iterator<Item = (&'a str, &'a str, &'a [String], &'a str)>,
        id_to_path: &HashMap<String, std::path::PathBuf>,
        name_to_ids: &HashMap<String, Vec<String>>,
        agent_map: &HashMap<String, String>,
        updated_map: &HashMap<String, String>,
    ) -> Self {
        let mut outgoing: HashMap<String, Vec<LinkRef>> = HashMap::new();
        let mut incoming: HashMap<String, Vec<LinkRef>> = HashMap::new();
        let mut tag_index: HashMap<String, Vec<String>> = HashMap::new();

        for (note_id, agent, tags, content) in notes {
            // Index tags
            for tag in tags {
                tag_index
                    .entry(tag.clone())
                    .or_default()
                    .push(note_id.to_string());
            }

            // Parse and resolve wikilinks
            let wikilinks = parse_wikilinks(content);
            let context = ResolverContext {
                current_agent: agent.to_string(),
            };

            for wl in wikilinks {
                let resolve_result =
                    resolve_wikilink(&wl.target, id_to_path, name_to_ids, agent_map, updated_map, &context);

                let (target_id, resolved) = match &resolve_result {
                    ResolveResult::Resolved(id) => (id.clone(), true),
                    ResolveResult::Ambiguous { chosen, .. } => (chosen.clone(), true),
                    ResolveResult::Broken => (wl.target.clone(), false),
                };

                let link_ref = LinkRef {
                    source_id: note_id.to_string(),
                    target_id: target_id.clone(),
                    raw_link: format!("[[{}]]", wl.target),
                    display_text: wl.display_text,
                    line_number: wl.line_number,
                    resolved,
                };

                outgoing
                    .entry(note_id.to_string())
                    .or_default()
                    .push(link_ref.clone());

                if resolved {
                    incoming
                        .entry(target_id)
                        .or_default()
                        .push(link_ref);
                }
            }
        }

        LinkIndex {
            outgoing,
            incoming,
            tag_index,
        }
    }

    /// Update link_index and tag_index for a single note after CRUD.
    /// Removes old entries for this note and re-indexes from the given wikilinks.
    /// Also updates tag_index with current tags from the note's frontmatter.
    pub fn update_note_with_tags(
        &mut self,
        note_id: &str,
        wikilinks: &[WikiLink],
        tags: &[String],
        registry: &super::NoteRegistry,
        agent: &str,
    ) {
        // Remove old outgoing links for this note
        if let Some(old_outgoing) = self.outgoing.remove(note_id) {
            for link in &old_outgoing {
                if let Some(incoming_list) = self.incoming.get_mut(&link.target_id) {
                    incoming_list.retain(|l| l.source_id != note_id);
                }
            }
        }

        // Update tag_index: remove old entries, add new ones
        for tag_list in self.tag_index.values_mut() {
            tag_list.retain(|id| id != note_id);
        }
        for tag in tags {
            self.tag_index
                .entry(tag.clone())
                .or_default()
                .push(note_id.to_string());
        }
        self.tag_index.retain(|_, v| !v.is_empty());

        // Re-index wikilinks
        let context = ResolverContext {
            current_agent: agent.to_string(),
        };

        let mut new_outgoing = Vec::new();
        for wl in wikilinks {
            let resolve_result = resolve_wikilink(
                &wl.target,
                &registry.id_to_path,
                &registry.name_to_ids,
                &registry.agent_map,
                &registry.updated_map,
                &context,
            );

            let (target_id, resolved) = match &resolve_result {
                ResolveResult::Resolved(id) => (id.clone(), true),
                ResolveResult::Ambiguous { chosen, .. } => (chosen.clone(), true),
                ResolveResult::Broken => (wl.target.clone(), false),
            };

            let link_ref = LinkRef {
                source_id: note_id.to_string(),
                target_id: target_id.clone(),
                raw_link: format!("[[{}]]", wl.target),
                display_text: wl.display_text.clone(),
                line_number: wl.line_number,
                resolved,
            };

            new_outgoing.push(link_ref.clone());

            if resolved {
                self.incoming
                    .entry(target_id)
                    .or_default()
                    .push(link_ref);
            }
        }

        if !new_outgoing.is_empty() {
            self.outgoing.insert(note_id.to_string(), new_outgoing);
        }
    }

    /// Convenience wrapper that only updates links (no tag changes).
    pub fn update_note(
        &mut self,
        note_id: &str,
        wikilinks: &[WikiLink],
        registry: &super::NoteRegistry,
        agent: &str,
    ) {
        self.update_note_with_tags(note_id, wikilinks, &[], registry, agent);
    }

    /// After a new note is created, re-resolve any broken links in other notes
    /// that might now point to this new note (by filename match).
    pub fn try_resolve_broken_links(
        &mut self,
        new_filename: &str,
        new_note_id: &str,
        _registry: &super::NoteRegistry,
    ) {
        // Scan all outgoing links for broken ones matching the new filename
        let mut to_update: Vec<(String, usize)> = Vec::new(); // (source_id, link_index)
        for (source_id, links) in &self.outgoing {
            for (idx, link) in links.iter().enumerate() {
                if !link.resolved {
                    // Check if the raw_link target matches the new filename
                    let target = link.raw_link
                        .trim_start_matches("[[")
                        .trim_end_matches("]]");
                    let target_name = target.rsplit('/').next().unwrap_or(target).trim();
                    if target_name == new_filename || target_name == new_note_id {
                        to_update.push((source_id.clone(), idx));
                    }
                }
            }
        }
        // Apply fixes
        for (source_id, idx) in to_update {
            if let Some(links) = self.outgoing.get_mut(&source_id) {
                if let Some(link) = links.get_mut(idx) {
                    link.target_id = new_note_id.to_string();
                    link.resolved = true;
                    // Add to incoming
                    self.incoming
                        .entry(new_note_id.to_string())
                        .or_default()
                        .push(link.clone());
                }
            }
        }
    }

    /// Invalidate all outgoing links that currently resolve to a note with the given filename.
    /// Used when a note is renamed: the old filename no longer maps to a valid note,
    /// so any link referencing it must be marked broken until re-resolved.
    pub fn invalidate_links_to_name(&mut self, old_filename: &str) {
        for outgoing_list in self.outgoing.values_mut() {
            for link in outgoing_list.iter_mut() {
                if !link.resolved {
                    continue;
                }
                // Check if the raw_link target matches the old filename
                let target = link
                    .raw_link
                    .trim_start_matches("[[")
                    .trim_end_matches("]]");
                let target_name = target.rsplit('/').next().unwrap_or(target).trim();
                if target_name == old_filename {
                    link.resolved = false;
                    // Remove from incoming index
                    if let Some(incoming_list) = self.incoming.get_mut(&link.target_id) {
                        incoming_list
                            .retain(|l| !(l.source_id == link.source_id && l.raw_link == link.raw_link));
                    }
                }
            }
        }
    }

    /// Remove all link entries for a deleted note.
    /// Also marks outgoing links from other notes that pointed at this note as broken.
    pub fn remove_note(&mut self, note_id: &str) {
        // Remove outgoing links from the deleted note and clean up incoming refs
        if let Some(old_outgoing) = self.outgoing.remove(note_id) {
            for link in &old_outgoing {
                if let Some(incoming_list) = self.incoming.get_mut(&link.target_id) {
                    incoming_list.retain(|l| l.source_id != note_id);
                }
            }
        }

        // Mark outgoing links from OTHER notes that pointed to this note as broken
        // (they referenced a now-deleted target)
        for outgoing_list in self.outgoing.values_mut() {
            for link in outgoing_list.iter_mut() {
                if link.target_id == note_id {
                    link.resolved = false;
                }
            }
        }

        // Remove incoming links TO this note
        self.incoming.remove(note_id);

        // Remove from tag_index
        for tag_list in self.tag_index.values_mut() {
            tag_list.retain(|id| id != note_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_wikilinks_basic() {
        let content = "See [[my-note]] for details.\nAlso [[uuid-123|Display Text]] here.";
        let links = parse_wikilinks(content);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "my-note");
        assert!(links[0].display_text.is_none());
        assert_eq!(links[0].line_number, 1);
        assert_eq!(links[1].target, "uuid-123");
        assert_eq!(links[1].display_text.as_deref(), Some("Display Text"));
        assert_eq!(links[1].line_number, 2);
    }

    #[test]
    fn test_parse_wikilinks_empty() {
        assert!(parse_wikilinks("no links here").is_empty());
    }

    #[test]
    fn test_resolve_direct_uuid() {
        let mut id_to_path = HashMap::new();
        id_to_path.insert("uuid-1".to_string(), std::path::PathBuf::from("test.md"));
        let name_to_ids = HashMap::new();
        let agent_map = HashMap::new();
        let updated_map = HashMap::new();
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        match resolve_wikilink("uuid-1", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Resolved(id) => assert_eq!(id, "uuid-1"),
            _ => panic!("Expected Resolved"),
        }
    }

    #[test]
    fn test_resolve_broken() {
        let id_to_path = HashMap::new();
        let name_to_ids = HashMap::new();
        let agent_map = HashMap::new();
        let updated_map = HashMap::new();
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        match resolve_wikilink("nonexistent", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Broken => {}
            _ => panic!("Expected Broken"),
        }
    }

    #[test]
    fn test_resolve_unique_name() {
        let id_to_path = HashMap::new();
        let mut name_to_ids = HashMap::new();
        name_to_ids.insert("my-note".to_string(), vec!["uuid-1".to_string()]);
        let agent_map = HashMap::new();
        let updated_map = HashMap::new();
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        match resolve_wikilink("my-note", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Resolved(id) => assert_eq!(id, "uuid-1"),
            _ => panic!("Expected Resolved"),
        }
    }

    // ── parse_wikilinks edge cases ──

    #[test]
    fn test_parse_wikilinks_multiple_on_same_line() {
        let content = "See [[note-a]] and [[note-b]] here.";
        let links = parse_wikilinks(content);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "note-a");
        assert_eq!(links[1].target, "note-b");
        assert_eq!(links[0].line_number, 1);
        assert_eq!(links[1].line_number, 1);
    }

    #[test]
    fn test_parse_wikilinks_with_path_prefix() {
        let content = "Link: [[agents/research/my-note]]";
        let links = parse_wikilinks(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "agents/research/my-note");
    }

    #[test]
    fn test_parse_wikilinks_whitespace_trimmed() {
        let content = "Link: [[ my-note | display ]]";
        let links = parse_wikilinks(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target, "my-note");
        assert_eq!(links[0].display_text.as_deref(), Some("display"));
    }

    // ── resolve_wikilink ambiguous cases ──

    #[test]
    fn test_resolve_ambiguous_same_agent_preferred() {
        let id_to_path = HashMap::new();
        let mut name_to_ids = HashMap::new();
        name_to_ids.insert(
            "shared-note".to_string(),
            vec!["uuid-a".to_string(), "uuid-b".to_string()],
        );
        let mut agent_map = HashMap::new();
        agent_map.insert("uuid-a".to_string(), "agent1".to_string());
        agent_map.insert("uuid-b".to_string(), "agent2".to_string());
        let updated_map = HashMap::new();
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        match resolve_wikilink("shared-note", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Ambiguous { chosen, alternatives } => {
                assert_eq!(chosen, "uuid-a"); // same agent preferred
                assert_eq!(alternatives, vec!["uuid-b"]);
            }
            _ => panic!("Expected Ambiguous"),
        }
    }

    #[test]
    fn test_resolve_ambiguous_most_recent_when_no_same_agent() {
        let id_to_path = HashMap::new();
        let mut name_to_ids = HashMap::new();
        name_to_ids.insert(
            "note".to_string(),
            vec!["uuid-a".to_string(), "uuid-b".to_string()],
        );
        let mut agent_map = HashMap::new();
        agent_map.insert("uuid-a".to_string(), "agent2".to_string());
        agent_map.insert("uuid-b".to_string(), "agent3".to_string());
        let mut updated_map = HashMap::new();
        updated_map.insert("uuid-a".to_string(), "2024-01-01".to_string());
        updated_map.insert("uuid-b".to_string(), "2024-06-01".to_string()); // newer
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        match resolve_wikilink("note", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Ambiguous { chosen, .. } => {
                assert_eq!(chosen, "uuid-b"); // most recently updated
            }
            _ => panic!("Expected Ambiguous"),
        }
    }

    #[test]
    fn test_resolve_name_with_path_uses_last_component() {
        let id_to_path = HashMap::new();
        let mut name_to_ids = HashMap::new();
        name_to_ids.insert("my-note".to_string(), vec!["uuid-1".to_string()]);
        let agent_map = HashMap::new();
        let updated_map = HashMap::new();
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        // Target has path prefix, but resolution uses last component
        match resolve_wikilink("agents/research/my-note", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Resolved(id) => assert_eq!(id, "uuid-1"),
            _ => panic!("Expected Resolved"),
        }
    }

    #[test]
    fn test_resolve_broken_empty_candidates() {
        let id_to_path = HashMap::new();
        let mut name_to_ids = HashMap::new();
        name_to_ids.insert("empty".to_string(), vec![]); // empty candidates
        let agent_map = HashMap::new();
        let updated_map = HashMap::new();
        let ctx = ResolverContext {
            current_agent: "agent1".into(),
        };
        match resolve_wikilink("empty", &id_to_path, &name_to_ids, &agent_map, &updated_map, &ctx) {
            ResolveResult::Broken => {}
            _ => panic!("Expected Broken for empty candidates"),
        }
    }

    // ── LinkIndex tests ──

    #[test]
    fn test_link_index_rebuild_basic() {
        let mut id_to_path = HashMap::new();
        id_to_path.insert("note-a".to_string(), std::path::PathBuf::from("a.md"));
        id_to_path.insert("note-b".to_string(), std::path::PathBuf::from("b.md"));

        let mut name_to_ids = HashMap::new();
        name_to_ids.insert("note-b".to_string(), vec!["note-b".to_string()]);

        let mut agent_map = HashMap::new();
        agent_map.insert("note-a".to_string(), "agent1".to_string());
        agent_map.insert("note-b".to_string(), "agent1".to_string());

        let updated_map = HashMap::new();

        let tags_a = vec!["tag1".to_string()];
        let tags_b: Vec<String> = vec![];
        let notes = vec![
            ("note-a", "agent1", &tags_a[..], "Link to [[note-b]]"),
            ("note-b", "agent1", &tags_b[..], "No links"),
        ];

        let index = LinkIndex::rebuild(
            notes.iter().map(|(id, agent, tags, content)| (*id, *agent, *tags, *content)),
            &id_to_path,
            &name_to_ids,
            &agent_map,
            &updated_map,
        );

        // note-a has 1 outgoing link
        assert_eq!(index.outgoing.get("note-a").map(|v| v.len()), Some(1));
        // note-b has 1 incoming link
        assert_eq!(index.incoming.get("note-b").map(|v| v.len()), Some(1));
        // tag index
        assert_eq!(index.tag_index.get("tag1").map(|v| v.len()), Some(1));
    }

    #[test]
    fn test_link_index_remove_note() {
        let mut index = LinkIndex::default();

        // Manually add outgoing/incoming links
        let link = LinkRef {
            source_id: "src".to_string(),
            target_id: "tgt".to_string(),
            raw_link: "[[tgt]]".to_string(),
            display_text: None,
            line_number: 1,
            resolved: true,
        };
        index.outgoing.insert("src".to_string(), vec![link.clone()]);
        index.incoming.insert("tgt".to_string(), vec![link]);
        index.tag_index.insert("tag1".to_string(), vec!["src".to_string()]);

        index.remove_note("src");

        assert!(!index.outgoing.contains_key("src"));
        assert!(index.incoming.get("tgt").unwrap().is_empty());
        assert!(index.tag_index.get("tag1").is_none() || index.tag_index.get("tag1").unwrap().is_empty());
    }

    #[test]
    fn test_link_index_remove_note_marks_incoming_as_broken() {
        let mut index = LinkIndex::default();

        // note-a links to note-b
        let link = LinkRef {
            source_id: "note-a".to_string(),
            target_id: "note-b".to_string(),
            raw_link: "[[note-b]]".to_string(),
            display_text: None,
            line_number: 1,
            resolved: true,
        };
        index.outgoing.insert("note-a".to_string(), vec![link.clone()]);
        index.incoming.insert("note-b".to_string(), vec![link]);

        // Delete note-b
        index.remove_note("note-b");

        // note-a's outgoing link should be marked as broken
        let out = &index.outgoing["note-a"];
        assert!(!out[0].resolved);
    }

    #[test]
    fn test_invalidate_links_to_name() {
        let mut index = LinkIndex::default();

        // note-a links to "old-name" (which is currently resolved to note-b)
        let link = LinkRef {
            source_id: "note-a".to_string(),
            target_id: "note-b".to_string(),
            raw_link: "[[old-name]]".to_string(),
            display_text: None,
            line_number: 1,
            resolved: true,
        };
        index.outgoing.insert("note-a".to_string(), vec![link.clone()]);
        index.incoming.insert("note-b".to_string(), vec![link]);

        // Invalidate links to "old-name" (simulating a rename from old-name to new-name)
        index.invalidate_links_to_name("old-name");

        // The outgoing link should now be broken
        let out = &index.outgoing["note-a"];
        assert!(!out[0].resolved, "Link to old-name should be broken after invalidation");

        // The incoming entry for note-b should be cleaned up
        let incoming = index.incoming.get("note-b");
        assert!(
            incoming.is_none() || incoming.unwrap().is_empty(),
            "Incoming link should be removed after invalidation"
        );
    }

    #[test]
    fn test_invalidate_links_to_name_does_not_affect_other_links() {
        let mut index = LinkIndex::default();

        // note-a has two links: one to "old-name" and one to "unrelated"
        let link1 = LinkRef {
            source_id: "note-a".to_string(),
            target_id: "note-b".to_string(),
            raw_link: "[[old-name]]".to_string(),
            display_text: None,
            line_number: 1,
            resolved: true,
        };
        let link2 = LinkRef {
            source_id: "note-a".to_string(),
            target_id: "note-c".to_string(),
            raw_link: "[[unrelated]]".to_string(),
            display_text: None,
            line_number: 2,
            resolved: true,
        };
        index.outgoing.insert("note-a".to_string(), vec![link1.clone(), link2.clone()]);
        index.incoming.insert("note-b".to_string(), vec![link1]);
        index.incoming.insert("note-c".to_string(), vec![link2]);

        index.invalidate_links_to_name("old-name");

        let out = &index.outgoing["note-a"];
        assert!(!out[0].resolved, "Link to old-name should be broken");
        assert!(out[1].resolved, "Link to unrelated should remain resolved");
    }
}
