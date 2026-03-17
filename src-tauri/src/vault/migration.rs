use chrono::Utc;
use serde::{Deserialize, Serialize};

use super::note::{compute_revision, sanitize_title_to_filename, serialize_note, Frontmatter};
use super::VaultManager;
use crate::db::Database;

/// Preview information about what a migration would do.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPreview {
    pub note_count: usize,
    pub estimated_files: usize,
    pub agents: Vec<String>,
}

/// Results of a completed migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationResult {
    pub migrated: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

/// A row from the legacy memory_notes table.
#[derive(Debug, Clone)]
struct LegacyNote {
    id: String,
    agent_id: String,
    title: String,
    content: String,
    created_at: String,
    updated_at: String,
}

/// Preview what a migration from SQLite to vault would look like.
pub fn preview(db: &Database) -> Result<MigrationPreview, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM memory_notes")?;
        let count: usize = stmt.query_row([], |row| row.get(0))?;

        let mut agent_stmt = conn.prepare("SELECT DISTINCT agent_id FROM memory_notes")?;
        let agents: Vec<String> = agent_stmt
            .query_map([], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(MigrationPreview {
            note_count: count,
            estimated_files: count,
            agents,
        })
    })
    .map_err(|e| format!("Database error: {e}"))
}

/// Execute migration: convert SQLite memory_notes into vault markdown files.
///
/// Each note becomes a markdown file with frontmatter in `agents/<agent_id>/knowledge/`.
/// The `legacy_id` frontmatter field preserves the original SQLite ID.
pub fn execute(db: &Database, vault_manager: &mut VaultManager) -> Result<MigrationResult, String> {
    let notes = db
        .with_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT id, agent_id, title, content, created_at, updated_at FROM memory_notes ORDER BY agent_id, created_at",
            )?;

            let rows: Vec<LegacyNote> = stmt
                .query_map([], |row| {
                    Ok(LegacyNote {
                        id: row.get(0)?,
                        agent_id: row.get(1)?,
                        title: row.get(2)?,
                        content: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();

            Ok(rows)
        })
        .map_err(|e| format!("Database error: {e}"))?;

    let mut migrated = 0;
    let mut skipped = 0;
    let mut errors = Vec::new();

    for note in &notes {
        // Check if this note has already been migrated (by legacy_id)
        if vault_manager.find_by_legacy_id(&note.id).is_some() {
            skipped += 1;
            continue;
        }

        let new_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let revision = compute_revision(&note.content);

        let frontmatter = Frontmatter {
            id: new_id.clone(),
            agent: note.agent_id.clone(),
            note_type: "knowledge".to_string(),
            tags: Vec::new(),
            confidence: 0.5,
            created: note.created_at.clone(),
            updated: note.updated_at.clone(),
            revision,
            source: Some(format!("migration:{now}")),
            aliases: Vec::new(),
            legacy_id: Some(note.id.clone()),
            scope: None,
            last_edited_by: None,
        };

        let body = format!("# {}\n\n{}\n", note.title, note.content);
        let file_content = serialize_note(&frontmatter, &body);

        // Determine file path
        let filename = sanitize_title_to_filename(&note.title);
        let agent_dir = vault_manager
            .vault_path
            .join("agents")
            .join(&note.agent_id)
            .join("knowledge");

        if let Err(e) = std::fs::create_dir_all(&agent_dir) {
            errors.push(format!(
                "Failed to create dir for agent '{}': {e}",
                note.agent_id
            ));
            continue;
        }

        let file_path = agent_dir.join(format!("{filename}.md"));

        // Handle name collisions: append a counter suffix
        let final_path = if file_path.exists() {
            let mut counter = 1;
            loop {
                let candidate = agent_dir.join(format!("{filename}-{counter}.md"));
                if !candidate.exists() {
                    break candidate;
                }
                counter += 1;
            }
        } else {
            file_path
        };

        match std::fs::write(&final_path, &file_content) {
            Ok(_) => {
                // Register in the vault index
                vault_manager
                    .registry
                    .register(new_id, final_path, &note.agent_id, &filename, &frontmatter.updated);
                migrated += 1;
            }
            Err(e) => {
                errors.push(format!(
                    "Failed to write '{}': {e}",
                    final_path.display()
                ));
            }
        }
    }

    Ok(MigrationResult {
        migrated,
        skipped,
        errors,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migration_preview_struct() {
        let preview = MigrationPreview {
            note_count: 5,
            estimated_files: 5,
            agents: vec!["manager".into(), "researcher".into()],
        };
        assert_eq!(preview.note_count, 5);
        assert_eq!(preview.agents.len(), 2);
    }

    #[test]
    fn test_migration_result_struct() {
        let result = MigrationResult {
            migrated: 3,
            skipped: 1,
            errors: vec!["some error".into()],
        };
        assert_eq!(result.migrated, 3);
        assert_eq!(result.skipped, 1);
        assert_eq!(result.errors.len(), 1);
    }
}
