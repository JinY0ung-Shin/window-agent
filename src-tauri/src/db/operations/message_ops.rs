use super::super::error::DbError;
use super::super::models::{BrowserArtifact, Message, SaveMessageRequest, ToolCallLog};
use super::super::Database;
use chrono::Utc;
use uuid::Uuid;

pub fn get_messages_impl(
    db: &Database,
    conversation_id: String,
) -> Result<Vec<Message>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_input, sender_agent_id, team_run_id, team_task_id, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC, id ASC",
        )?;

        let rows = stmt.query_map(rusqlite::params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                tool_call_id: row.get(4)?,
                tool_name: row.get(5)?,
                tool_input: row.get(6)?,
                sender_agent_id: row.get(7)?,
                team_run_id: row.get(8)?,
                team_task_id: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?;

        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn save_message_impl(
    db: &Database,
    request: SaveMessageRequest,
) -> Result<Message, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let msg = Message {
            id: Uuid::new_v4().to_string(),
            conversation_id: request.conversation_id.clone(),
            role: request.role,
            content: request.content,
            tool_call_id: request.tool_call_id,
            tool_name: request.tool_name,
            tool_input: request.tool_input,
            sender_agent_id: request.sender_agent_id,
            team_run_id: request.team_run_id,
            team_task_id: request.team_task_id,
            created_at: now.clone(),
        };

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, tool_input, sender_agent_id, team_run_id, team_task_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![msg.id, msg.conversation_id, msg.role, msg.content, msg.tool_call_id, msg.tool_name, msg.tool_input, msg.sender_agent_id, msg.team_run_id, msg.team_task_id, msg.created_at],
        )?;

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, request.conversation_id],
        )?;

        Ok(msg)
    })
}

// ── Tool Call Logs CRUD ──

pub fn create_tool_call_log_impl(
    db: &Database,
    conversation_id: String,
    message_id: Option<String>,
    tool_name: String,
    tool_input: String,
) -> Result<ToolCallLog, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let log = ToolCallLog {
            id: Uuid::new_v4().to_string(),
            conversation_id,
            message_id,
            tool_name,
            tool_input,
            tool_output: None,
            status: "pending".to_string(),
            duration_ms: None,
            artifact_id: None,
            agent_id: None,
            created_at: now,
        };

        conn.execute(
            "INSERT INTO tool_call_logs (id, conversation_id, message_id, tool_name, tool_input, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![log.id, log.conversation_id, log.message_id, log.tool_name, log.tool_input, log.status, log.created_at],
        )?;

        Ok(log)
    })
}

pub fn list_tool_call_logs_impl(
    db: &Database,
    conversation_id: String,
) -> Result<Vec<ToolCallLog>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, message_id, tool_name, tool_input, tool_output, status, duration_ms, artifact_id, agent_id, created_at FROM tool_call_logs WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;

        let rows = stmt.query_map(rusqlite::params![conversation_id], |row| {
            Ok(ToolCallLog {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                message_id: row.get(2)?,
                tool_name: row.get(3)?,
                tool_input: row.get(4)?,
                tool_output: row.get(5)?,
                status: row.get(6)?,
                duration_ms: row.get(7)?,
                artifact_id: row.get(8)?,
                agent_id: row.get(9)?,
                created_at: row.get(10)?,
            })
        })?;

        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_tool_call_log_status_impl(
    db: &Database,
    id: String,
    status: String,
    tool_output: Option<String>,
    duration_ms: Option<i64>,
    artifact_id: Option<String>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE tool_call_logs SET status = ?1, tool_output = ?2, duration_ms = ?3, artifact_id = ?4 WHERE id = ?5",
            rusqlite::params![status, tool_output, duration_ms, artifact_id, id],
        )?;
        Ok(())
    })
}

// ── Browser Artifacts CRUD ──

pub fn create_browser_artifact(
    db: &Database,
    artifact: &BrowserArtifact,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO browser_artifacts (id, session_id, conversation_id, snapshot_full, ref_map_json, url, title, screenshot_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                artifact.id,
                artifact.session_id,
                artifact.conversation_id,
                artifact.snapshot_full,
                artifact.ref_map_json,
                artifact.url,
                artifact.title,
                artifact.screenshot_path,
                artifact.created_at,
            ],
        )?;
        Ok(())
    })
}

pub fn get_browser_artifact(
    db: &Database,
    id: &str,
) -> Result<BrowserArtifact, DbError> {
    db.with_conn(|conn| {
        let artifact = conn.query_row(
            "SELECT id, session_id, conversation_id, snapshot_full, ref_map_json, url, title, screenshot_path, created_at FROM browser_artifacts WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                Ok(BrowserArtifact {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    conversation_id: row.get(2)?,
                    snapshot_full: row.get(3)?,
                    ref_map_json: row.get(4)?,
                    url: row.get(5)?,
                    title: row.get(6)?,
                    screenshot_path: row.get(7)?,
                    created_at: row.get(8)?,
                })
            },
        )?;
        Ok(artifact)
    })
}

/// Get screenshot file paths for a conversation's browser artifacts (for file cleanup before DB cascade).
pub fn get_browser_artifact_screenshot_paths(
    db: &Database,
    conversation_id: &str,
) -> Result<Vec<String>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT screenshot_path FROM browser_artifacts WHERE conversation_id = ?1 AND screenshot_path IS NOT NULL",
        )?;
        let paths: Vec<String> = stmt
            .query_map(rusqlite::params![conversation_id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::conversation_ops::*;
    use crate::db::agent_operations;
    use crate::db::models::CreateAgentRequest;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
    }

    fn create_test_agent(db: &Database) -> crate::db::models::Agent {
        agent_operations::create_agent_impl(
            db,
            CreateAgentRequest {
                folder_name: "test-agent".into(),
                name: "Test Agent".into(),
                avatar: None,
                description: None,
                model: None,
                temperature: None,
                thinking_enabled: None,
                thinking_budget: None,
                is_default: None,
                sort_order: None,
            },
        )
        .unwrap()
    }

    fn create_test_conversation(db: &Database) -> (crate::db::models::Agent, crate::db::models::ConversationListItem) {
        let agent = create_test_agent(db);
        let conv = create_conversation_impl(db, Some("Test".into()), agent.id.clone()).unwrap();
        (agent, conv)
    }

    fn make_test_artifact(conversation_id: &str) -> BrowserArtifact {
        BrowserArtifact {
            id: Uuid::new_v4().to_string(),
            session_id: "session_abc123".to_string(),
            conversation_id: conversation_id.to_string(),
            snapshot_full: "<snapshot>".to_string(),
            ref_map_json: "{}".to_string(),
            url: "https://example.com".to_string(),
            title: "Example".to_string(),
            screenshot_path: None,
            created_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn test_create_and_get_browser_artifact() {
        let db = setup_db();
        let (_agent, conv) = create_test_conversation(&db);
        let artifact = make_test_artifact(&conv.id);

        create_browser_artifact(&db, &artifact).unwrap();

        let fetched = get_browser_artifact(&db, &artifact.id).unwrap();
        assert_eq!(fetched.id, artifact.id);
        assert_eq!(fetched.url, "https://example.com");
        assert_eq!(fetched.session_id, "session_abc123");
        assert!(fetched.screenshot_path.is_none());
    }

    #[test]
    fn test_create_browser_artifact_with_screenshot() {
        let db = setup_db();
        let (_agent, conv) = create_test_conversation(&db);
        let mut artifact = make_test_artifact(&conv.id);
        artifact.screenshot_path = Some("/tmp/screenshots/test.png".to_string());

        create_browser_artifact(&db, &artifact).unwrap();

        let fetched = get_browser_artifact(&db, &artifact.id).unwrap();
        assert_eq!(fetched.screenshot_path.as_deref(), Some("/tmp/screenshots/test.png"));
    }

    #[test]
    fn test_get_browser_artifact_not_found() {
        let db = setup_db();
        let result = get_browser_artifact(&db, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_get_browser_artifact_screenshot_paths() {
        let db = setup_db();
        let (_agent, conv) = create_test_conversation(&db);

        let mut a1 = make_test_artifact(&conv.id);
        a1.screenshot_path = Some("/tmp/s1.png".to_string());
        let a2 = make_test_artifact(&conv.id);
        let mut a3 = make_test_artifact(&conv.id);
        a3.screenshot_path = Some("/tmp/s3.png".to_string());

        create_browser_artifact(&db, &a1).unwrap();
        create_browser_artifact(&db, &a2).unwrap();
        create_browser_artifact(&db, &a3).unwrap();

        let paths = get_browser_artifact_screenshot_paths(&db, &conv.id).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(&"/tmp/s1.png".to_string()));
        assert!(paths.contains(&"/tmp/s3.png".to_string()));
    }

    #[test]
    fn test_get_browser_artifact_screenshot_paths_empty() {
        let db = setup_db();
        let (_agent, conv) = create_test_conversation(&db);
        let paths = get_browser_artifact_screenshot_paths(&db, &conv.id).unwrap();
        assert!(paths.is_empty());
    }

    #[test]
    fn test_browser_artifacts_cascade_on_conversation_delete() {
        let db = setup_db();
        let (_agent, conv) = create_test_conversation(&db);
        let artifact = make_test_artifact(&conv.id);
        create_browser_artifact(&db, &artifact).unwrap();

        // Delete conversation — FK cascade should remove artifacts
        delete_conversation_impl(&db, conv.id).unwrap();
        assert!(get_browser_artifact(&db, &artifact.id).is_err());
    }
}
