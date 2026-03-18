use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

use super::note::parse_frontmatter;

/// A search result returned from vault full-text search.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub note_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f64,
}

/// Search the vault for notes matching a query string.
///
/// - `query`: search terms (case-insensitive substring match)
/// - `vault_path`: root path of the vault
/// - `agent_id`: if Some, restrict to `agents/<agent_id>/`
/// - `scope`: "self" (agent only), "shared" (shared only), "all" (both) — defaults to "all"
pub fn search(
    query: &str,
    vault_path: &Path,
    agent_id: Option<&str>,
    scope: Option<&str>,
) -> Vec<SearchResult> {
    let query_lower = query.to_lowercase();
    let terms: Vec<&str> = query_lower.split_whitespace().collect();
    if terms.is_empty() {
        return Vec::new();
    }

    let search_scope = scope.unwrap_or("all");

    let mut search_dirs: Vec<PathBuf> = Vec::new();
    match search_scope {
        "self" => {
            if let Some(aid) = agent_id {
                search_dirs.push(vault_path.join("agents").join(aid));
            }
        }
        "shared" => {
            search_dirs.push(vault_path.join("shared"));
        }
        _ => {
            // "all"
            if let Some(aid) = agent_id {
                search_dirs.push(vault_path.join("agents").join(aid));
            } else {
                search_dirs.push(vault_path.join("agents"));
            }
            search_dirs.push(vault_path.join("shared"));
        }
    }

    let mut results = Vec::new();

    for dir in &search_dirs {
        if !dir.exists() {
            continue;
        }

        for entry in WalkDir::new(dir)
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
            // Skip _index.md files
            if path.file_name().and_then(|n| n.to_str()) == Some("_index.md") {
                continue;
            }
            // Skip agent workspace directories (agents/*/workspace/**)
            if let Ok(rel) = path.strip_prefix(vault_path) {
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

            if let Some(result) = match_note(path, &terms) {
                results.push(result);
            }
        }
    }

    // Sort by score descending
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    results
}

/// Check if a note matches the search terms and compute a relevance score.
fn match_note(path: &Path, terms: &[&str]) -> Option<SearchResult> {
    let content = std::fs::read_to_string(path).ok()?;
    let content_lower = content.to_lowercase();

    // All terms must appear somewhere in the content (title, tags, or body)
    if !terms.iter().all(|t| content_lower.contains(t)) {
        return None;
    }

    let (frontmatter, body) = parse_frontmatter(&content).ok()?;

    let title_lower = extract_title(&body).to_lowercase();
    let tags_lower: String = frontmatter.tags.join(" ").to_lowercase();

    // Scoring: title match > tag match > body match
    let mut score = 0.0;
    for term in terms {
        if title_lower.contains(term) {
            score += 10.0;
        }
        if tags_lower.contains(term) {
            score += 5.0;
        }
        if body.to_lowercase().contains(term) {
            score += 1.0;
        }
    }

    // Confidence boost
    score *= frontmatter.confidence;

    let snippet = generate_snippet(&body, terms);

    Some(SearchResult {
        note_id: frontmatter.id,
        title: extract_title(&body),
        snippet,
        score,
    })
}

/// Extract the title from the body: first # heading, or first non-empty line.
fn extract_title(body: &str) -> String {
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

/// Generate a snippet around the first matching term in the body.
fn generate_snippet(body: &str, terms: &[&str]) -> String {
    let body_lower = body.to_lowercase();

    // Find the first occurrence of any term
    let mut earliest_pos = None;
    for term in terms {
        if let Some(pos) = body_lower.find(term) {
            match earliest_pos {
                None => earliest_pos = Some(pos),
                Some(prev) if pos < prev => earliest_pos = Some(pos),
                _ => {}
            }
        }
    }

    let pos = earliest_pos.unwrap_or(0);

    // Extract context around the match: ~50 chars before, ~100 chars after
    let chars: Vec<char> = body.chars().collect();
    let start = pos.saturating_sub(50);
    let end = (pos + 100).min(chars.len());

    let mut snippet: String = chars[start..end].iter().collect();
    snippet = snippet.replace('\n', " ");

    if start > 0 {
        snippet = format!("...{snippet}");
    }
    if end < chars.len() {
        snippet = format!("{snippet}...");
    }

    snippet
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn create_test_vault() -> TempDir {
        let tmp = TempDir::new().unwrap();
        let vault = tmp.path();

        // Create agent note
        let agent_dir = vault.join("agents/manager/knowledge");
        fs::create_dir_all(&agent_dir).unwrap();
        fs::write(
            agent_dir.join("auth-note.md"),
            r#"---
id: "note-1"
agent: "manager"
type: "knowledge"
tags: ["auth", "security"]
confidence: 0.9
created: "2026-03-17T14:00:00+09:00"
updated: "2026-03-17T14:00:00+09:00"
revision: "abcd1234"
---
# Authentication Middleware

This note covers auth middleware design.
"#,
        )
        .unwrap();

        // Create shared note
        let shared_dir = vault.join("shared/project");
        fs::create_dir_all(&shared_dir).unwrap();
        fs::write(
            shared_dir.join("project-plan.md"),
            r#"---
id: "note-2"
agent: "manager"
type: "knowledge"
tags: ["project", "planning"]
confidence: 0.8
created: "2026-03-17T14:00:00+09:00"
updated: "2026-03-17T14:00:00+09:00"
revision: "efgh5678"
scope: "shared"
---
# Project Plan

The project involves building an auth system.
"#,
        )
        .unwrap();

        tmp
    }

    #[test]
    fn test_search_all_scope() {
        let tmp = create_test_vault();
        let results = search("auth", tmp.path(), Some("manager"), Some("all"));
        assert!(!results.is_empty());
        // Both notes mention "auth"
        assert!(results.len() >= 1);
    }

    #[test]
    fn test_search_self_scope() {
        let tmp = create_test_vault();
        let results = search("auth", tmp.path(), Some("manager"), Some("self"));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "note-1");
    }

    #[test]
    fn test_search_shared_scope() {
        let tmp = create_test_vault();
        let results = search("project", tmp.path(), Some("manager"), Some("shared"));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "note-2");
    }

    #[test]
    fn test_search_no_match() {
        let tmp = create_test_vault();
        let results = search("nonexistent_term", tmp.path(), None, None);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_empty_query() {
        let tmp = create_test_vault();
        let results = search("", tmp.path(), None, None);
        assert!(results.is_empty());
    }

    #[test]
    fn test_search_excludes_workspace_files() {
        let tmp = create_test_vault();
        let vault = tmp.path();

        // Create a workspace file with content matching "auth"
        let ws_dir = vault.join("agents/manager/workspace");
        fs::create_dir_all(&ws_dir).unwrap();
        fs::write(
            ws_dir.join("draft.md"),
            r#"---
id: "ws-note"
agent: "manager"
type: "knowledge"
tags: ["auth"]
confidence: 0.9
created: "2026-03-17T14:00:00+09:00"
updated: "2026-03-17T14:00:00+09:00"
revision: "ws123"
---
# Auth Draft
Workspace draft about auth.
"#,
        )
        .unwrap();

        let results = search("auth", vault, Some("manager"), Some("self"));
        // Only the regular note should match, not the workspace file
        for r in &results {
            assert_ne!(r.note_id, "ws-note", "Workspace files should be excluded from search");
        }
    }
}
