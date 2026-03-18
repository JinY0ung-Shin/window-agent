use super::error::DbError;
use super::models::{BrowserArtifact, ConversationDetail, ConversationListItem, DeleteMessagesResult, Message, SaveMessageRequest, ToolCallLog};
use super::Database;
use chrono::Utc;
use uuid::Uuid;

pub fn with_transaction<F, T>(db: &Database, f: F) -> Result<T, DbError>
where
    F: FnOnce(&rusqlite::Transaction) -> Result<T, rusqlite::Error>,
{
    let mut conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let tx = conn.transaction()?;
    let result = f(&tx)?;
    tx.commit()?;
    Ok(result)
}

pub fn create_conversation_impl(
    db: &Database,
    title: Option<String>,
    agent_id: String,
) -> Result<ConversationListItem, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let conv = ConversationListItem {
            id: Uuid::new_v4().to_string(),
            title: title.unwrap_or_else(|| "새 대화".to_string()),
            agent_id: agent_id.clone(),
            created_at: now.clone(),
            updated_at: now,
        };

        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![conv.id, conv.title, conv.agent_id, conv.created_at, conv.updated_at],
        )?;

        Ok(conv)
    })
}

pub fn get_conversations_impl(db: &Database) -> Result<Vec<ConversationListItem>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, title, agent_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC")?;

        let rows = stmt.query_map([], |row| {
            Ok(ConversationListItem {
                id: row.get(0)?,
                title: row.get(1)?,
                agent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })?;

        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn get_conversation_detail_impl(
    db: &Database,
    id: String,
) -> Result<ConversationDetail, DbError> {
    db.with_conn(|conn| {
        let detail = conn.query_row(
            "SELECT id, title, agent_id, summary, summary_up_to_message_id, active_skills, learning_mode, created_at, updated_at FROM conversations WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                let active_skills_raw: Option<String> = row.get(5)?;
                let active_skills: Option<Vec<String>> = active_skills_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                let learning_mode_raw: i64 = row.get::<_, Option<i64>>(6)?.unwrap_or(0);
                Ok(ConversationDetail {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    agent_id: row.get(2)?,
                    summary: row.get(3)?,
                    summary_up_to_message_id: row.get(4)?,
                    active_skills,
                    learning_mode: learning_mode_raw != 0,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )?;
        Ok(detail)
    })
}

pub fn get_messages_impl(
    db: &Database,
    conversation_id: String,
) -> Result<Vec<Message>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, tool_call_id, tool_name, tool_input, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC, id ASC",
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
                created_at: row.get(7)?,
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
            created_at: now.clone(),
        };

        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, tool_input, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![msg.id, msg.conversation_id, msg.role, msg.content, msg.tool_call_id, msg.tool_name, msg.tool_input, msg.created_at],
        )?;

        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![now, request.conversation_id],
        )?;

        Ok(msg)
    })
}

pub fn delete_conversation_impl(
    db: &Database,
    conversation_id: String,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            rusqlite::params![conversation_id],
        )?;
        Ok(())
    })
}

pub fn update_conversation_title_impl(
    db: &Database,
    id: String,
    title: String,
    expected_current: Option<String>,
) -> Result<i32, DbError> {
    let trimmed = title.trim();
    let clamped: String = trimmed.chars().take(50).collect();
    let final_title = if clamped.is_empty() { "새 대화".to_string() } else { clamped };

    db.with_conn(|conn| {
        let affected = if let Some(expected) = expected_current {
            // Only update if title still matches expected (guard against overwrite)
            conn.execute(
                "UPDATE conversations SET title = ?1 WHERE id = ?2 AND title = ?3",
                rusqlite::params![final_title, id, expected],
            )?
        } else {
            conn.execute(
                "UPDATE conversations SET title = ?1 WHERE id = ?2",
                rusqlite::params![final_title, id],
            )?
        };
        Ok(affected as i32)
    })
}

pub fn update_conversation_summary_impl(
    db: &Database,
    id: String,
    summary: Option<String>,
    up_to_message_id: Option<String>,
    expected_previous: Option<String>,
) -> Result<i32, DbError> {
    db.with_conn(|conn| {
        let affected = conn.execute(
            "UPDATE conversations SET summary = ?1, summary_up_to_message_id = ?2 WHERE id = ?3 AND ((?4 IS NULL AND summary_up_to_message_id IS NULL) OR summary_up_to_message_id = ?4)",
            rusqlite::params![summary, up_to_message_id, id, expected_previous],
        )?;
        Ok(affected as i32)
    })
}

pub fn delete_messages_and_maybe_reset_summary_impl(
    db: &Database,
    conversation_id: String,
    message_id: String,
) -> Result<DeleteMessagesResult, DbError> {
    with_transaction(db, |tx| {
        // Check if summary_up_to_message_id falls in the deletion range
        let summary_was_reset: bool = {
            let maybe_summary_msg: Option<String> = tx.query_row(
                "SELECT summary_up_to_message_id FROM conversations WHERE id = ?1",
                rusqlite::params![conversation_id],
                |row| row.get(0),
            )?;

            if let Some(ref summary_msg_id) = maybe_summary_msg {
                // Check if this message id is in the deletion range
                let in_range: bool = tx.query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM messages WHERE id = ?1 AND conversation_id = ?2 AND (
                            created_at > (SELECT created_at FROM messages WHERE id = ?3)
                            OR (created_at = (SELECT created_at FROM messages WHERE id = ?3) AND id >= ?3)
                        )
                    )",
                    rusqlite::params![summary_msg_id, conversation_id, message_id],
                    |row| row.get(0),
                )?;
                in_range
            } else {
                false
            }
        };

        // Delete messages from the given ID onwards (inclusive)
        tx.execute(
            "DELETE FROM messages WHERE conversation_id = ?1 AND (
                created_at > (SELECT created_at FROM messages WHERE id = ?2)
                OR (created_at = (SELECT created_at FROM messages WHERE id = ?2) AND id >= ?2)
            )",
            rusqlite::params![conversation_id, message_id],
        )?;

        // Reset summary if needed
        if summary_was_reset {
            tx.execute(
                "UPDATE conversations SET summary = NULL, summary_up_to_message_id = NULL WHERE id = ?1",
                rusqlite::params![conversation_id],
            )?;
        }

        Ok(DeleteMessagesResult { summary_was_reset })
    })
}

// ── Conversation Skills ──

pub fn update_conversation_skills_impl(
    db: &Database,
    id: String,
    skills_json: Option<String>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET active_skills = ?1 WHERE id = ?2",
            rusqlite::params![skills_json, id],
        )?;
        Ok(())
    })
}

// ── Learning Mode ──

pub fn set_learning_mode_impl(
    db: &Database,
    id: String,
    enabled: bool,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET learning_mode = ?1 WHERE id = ?2",
            rusqlite::params![enabled as i64, id],
        )?;
        Ok(())
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
            "SELECT id, conversation_id, message_id, tool_name, tool_input, tool_output, status, duration_ms, artifact_id, created_at FROM tool_call_logs WHERE conversation_id = ?1 ORDER BY created_at ASC",
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
                created_at: row.get(9)?,
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
    use crate::db::agent_operations;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
    }

    /// Helper: create a default agent for conversation tests
    fn create_test_agent(db: &Database) -> crate::db::models::Agent {
        use crate::db::models::CreateAgentRequest;
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

    #[test]
    fn test_create_conversation_default_title() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        assert_eq!(conv.title, "새 대화");
        assert!(!conv.id.is_empty());
        assert!(!conv.created_at.is_empty());
    }

    #[test]
    fn test_create_conversation_custom_title() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, Some("테스트 대화".into()), agent.id).unwrap();
        assert_eq!(conv.title, "테스트 대화");
    }

    #[test]
    fn test_get_conversations_empty() {
        let db = setup_db();
        let convs = get_conversations_impl(&db).unwrap();
        assert!(convs.is_empty());
    }

    #[test]
    fn test_get_conversations_ordered() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let c1 = create_conversation_impl(&db, Some("First".into()), agent.id.clone()).unwrap();
        let c2 = create_conversation_impl(&db, Some("Second".into()), agent.id).unwrap();

        // Update c1's updated_at to be newer
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE conversations SET updated_at = '9999-12-31T00:00:00+00:00' WHERE id = ?1",
                rusqlite::params![c1.id],
            )
            .unwrap();
        }

        let convs = get_conversations_impl(&db).unwrap();
        assert_eq!(convs.len(), 2);
        assert_eq!(convs[0].id, c1.id); // c1 is newer now
        assert_eq!(convs[1].id, c2.id);
    }

    #[test]
    fn test_get_messages_empty() {
        let db = setup_db();
        let msgs = get_messages_impl(&db, "nonexistent".into()).unwrap();
        assert!(msgs.is_empty());
    }

    #[test]
    fn test_get_messages_ordered() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Insert messages with explicit timestamps for ordering
        {
            let conn = db.conn.lock().unwrap();
            for (i, ts) in ["2024-01-01", "2024-01-02", "2024-01-03"].iter().enumerate() {
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![format!("msg-{}", i), conv.id, "user", format!("message {}", i), ts],
                ).unwrap();
            }
        }

        let msgs = get_messages_impl(&db, conv.id).unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].content, "message 0");
        assert_eq!(msgs[2].content, "message 2");
    }

    #[test]
    fn test_save_message() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        let msg = save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: conv.id.clone(),
                role: "user".into(),
                content: "hello".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        )
        .unwrap();

        assert_eq!(msg.conversation_id, conv.id);
        assert_eq!(msg.role, "user");
        assert_eq!(msg.content, "hello");
        assert!(!msg.id.is_empty());
    }

    #[test]
    fn test_save_message_updates_conversation() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        let old_updated = conv.updated_at.clone();

        // Force a different timestamp
        std::thread::sleep(std::time::Duration::from_millis(10));

        save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: conv.id.clone(),
                role: "user".into(),
                content: "hello".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        )
        .unwrap();

        let convs = get_conversations_impl(&db).unwrap();
        assert_ne!(convs[0].updated_at, old_updated);
    }

    #[test]
    fn test_delete_conversation() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        delete_conversation_impl(&db, conv.id).unwrap();
        let convs = get_conversations_impl(&db).unwrap();
        assert!(convs.is_empty());
    }

    #[test]
    fn test_delete_cascade() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: conv.id.clone(),
                role: "user".into(),
                content: "test".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        )
        .unwrap();

        delete_conversation_impl(&db, conv.id.clone()).unwrap();

        // Verify messages are also deleted
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
                rusqlite::params![conv.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_save_message_invalid_conversation() {
        let db = setup_db();
        let result = save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: "nonexistent".into(),
                role: "user".into(),
                content: "test".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_create_conversation_nonexistent_agent_fails() {
        let db = setup_db();
        let result = create_conversation_impl(&db, Some("Test".into()), "nonexistent-agent".into());
        assert!(result.is_err(), "FK constraint should reject nonexistent agent_id");
    }

    #[test]
    fn test_delete_agent_cascades_to_messages() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, Some("Chat".into()), agent.id.clone()).unwrap();
        save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: conv.id.clone(),
                role: "user".into(),
                content: "hello".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        )
        .unwrap();
        save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: conv.id.clone(),
                role: "assistant".into(),
                content: "hi there".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        )
        .unwrap();

        // Delete the agent — should cascade to conversations and messages
        agent_operations::delete_agent_impl(&db, agent.id).unwrap();

        let conn = db.conn.lock().unwrap();
        let msg_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
                rusqlite::params![conv.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(msg_count, 0, "messages should be cascade-deleted");
    }

    #[test]
    fn test_messages_ordered_asc_by_created_at() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Insert messages out of chronological order
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["msg-c", conv.id, "user", "third", "2024-01-03"],
            ).unwrap();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["msg-a", conv.id, "user", "first", "2024-01-01"],
            ).unwrap();
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params!["msg-b", conv.id, "user", "second", "2024-01-02"],
            ).unwrap();
        }

        let msgs = get_messages_impl(&db, conv.id).unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].content, "first");
        assert_eq!(msgs[1].content, "second");
        assert_eq!(msgs[2].content, "third");
    }

    #[test]
    fn test_conversations_empty_after_agent_deleted() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        create_conversation_impl(&db, Some("Chat 1".into()), agent.id.clone()).unwrap();
        create_conversation_impl(&db, Some("Chat 2".into()), agent.id.clone()).unwrap();

        agent_operations::delete_agent_impl(&db, agent.id).unwrap();

        let convs = get_conversations_impl(&db).unwrap();
        assert!(convs.is_empty(), "all conversations should be cascade-deleted with agent");
    }

    #[test]
    fn test_save_message_nonexistent_conversation_fails() {
        let db = setup_db();
        let result = save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: "does-not-exist".into(),
                role: "user".into(),
                content: "should fail".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
            },
        );
        assert!(result.is_err(), "FK constraint should reject nonexistent conversation_id");
    }

    #[test]
    fn test_get_conversation_detail() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, Some("Detail Test".into()), agent.id).unwrap();

        let detail = get_conversation_detail_impl(&db, conv.id.clone()).unwrap();
        assert_eq!(detail.id, conv.id);
        assert_eq!(detail.title, "Detail Test");
        assert!(detail.summary.is_none());
        assert!(detail.summary_up_to_message_id.is_none());
    }

    #[test]
    fn test_get_conversation_detail_with_summary() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, Some("Sum Test".into()), agent.id).unwrap();

        // Insert a message and set summary
        let msg = save_message_impl(&db, SaveMessageRequest {
            conversation_id: conv.id.clone(),
            role: "user".into(),
            content: "hello".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
        }).unwrap();

        let affected = update_conversation_summary_impl(
            &db, conv.id.clone(),
            Some("summary text".into()),
            Some(msg.id.clone()),
            None, // expected_previous is NULL
        ).unwrap();
        assert_eq!(affected, 1);

        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert_eq!(detail.summary.as_deref(), Some("summary text"));
        assert_eq!(detail.summary_up_to_message_id.as_deref(), Some(msg.id.as_str()));
    }

    #[test]
    fn test_update_conversation_title_basic() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        update_conversation_title_impl(&db, conv.id.clone(), "New Title".into(), None).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert_eq!(detail.title, "New Title");
    }

    #[test]
    fn test_update_conversation_title_trim_and_clamp() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Whitespace trim
        update_conversation_title_impl(&db, conv.id.clone(), "  trimmed  ".into(), None).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id.clone()).unwrap();
        assert_eq!(detail.title, "trimmed");

        // 50 char clamp
        let long_title = "a".repeat(60);
        update_conversation_title_impl(&db, conv.id.clone(), long_title, None).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id.clone()).unwrap();
        assert_eq!(detail.title.len(), 50);

        // Empty fallback
        update_conversation_title_impl(&db, conv.id.clone(), "   ".into(), None).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert_eq!(detail.title, "새 대화");
    }

    #[test]
    fn test_update_conversation_title_does_not_change_updated_at() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        let original_updated_at = conv.updated_at.clone();

        std::thread::sleep(std::time::Duration::from_millis(10));
        update_conversation_title_impl(&db, conv.id.clone(), "Changed".into(), None).unwrap();

        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert_eq!(detail.updated_at, original_updated_at);
    }

    #[test]
    fn test_update_conversation_summary_optimistic_concurrency() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();
        let msg = save_message_impl(&db, SaveMessageRequest {
            conversation_id: conv.id.clone(),
            role: "user".into(),
            content: "hello".into(),
                tool_call_id: None,
                tool_name: None,
                tool_input: None,
        }).unwrap();

        // First update: expected_previous is None (NULL)
        let affected = update_conversation_summary_impl(
            &db, conv.id.clone(),
            Some("summary v1".into()),
            Some(msg.id.clone()),
            None,
        ).unwrap();
        assert_eq!(affected, 1);

        // Second update with wrong expected_previous — should fail (0 rows)
        let affected = update_conversation_summary_impl(
            &db, conv.id.clone(),
            Some("summary v2".into()),
            Some(msg.id.clone()),
            Some("wrong-msg-id".into()),
        ).unwrap();
        assert_eq!(affected, 0);

        // Correct expected_previous
        let affected = update_conversation_summary_impl(
            &db, conv.id.clone(),
            Some("summary v2".into()),
            Some(msg.id.clone()),
            Some(msg.id.clone()),
        ).unwrap();
        assert_eq!(affected, 1);
    }

    #[test]
    fn test_delete_messages_and_maybe_reset_summary_no_reset() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Insert 3 messages
        {
            let conn = db.conn.lock().unwrap();
            for (i, ts) in ["2024-01-01", "2024-01-02", "2024-01-03"].iter().enumerate() {
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![format!("msg-{}", i), conv.id, "user", format!("message {}", i), ts],
                ).unwrap();
            }
            // Set summary to msg-0 (before deletion range)
            conn.execute(
                "UPDATE conversations SET summary = 'old summary', summary_up_to_message_id = 'msg-0' WHERE id = ?1",
                rusqlite::params![conv.id],
            ).unwrap();
        }

        // Delete from msg-2 onwards — msg-0 is not in range
        let result = delete_messages_and_maybe_reset_summary_impl(&db, conv.id.clone(), "msg-2".into()).unwrap();
        assert!(!result.summary_was_reset);

        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert_eq!(detail.summary.as_deref(), Some("old summary"));
    }

    #[test]
    fn test_delete_messages_and_maybe_reset_summary_with_reset() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Insert 3 messages
        {
            let conn = db.conn.lock().unwrap();
            for (i, ts) in ["2024-01-01", "2024-01-02", "2024-01-03"].iter().enumerate() {
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![format!("msg-{}", i), conv.id, "user", format!("message {}", i), ts],
                ).unwrap();
            }
            // Set summary to msg-2 (within deletion range)
            conn.execute(
                "UPDATE conversations SET summary = 'old summary', summary_up_to_message_id = 'msg-2' WHERE id = ?1",
                rusqlite::params![conv.id],
            ).unwrap();
        }

        // Delete from msg-1 onwards — msg-2 is in range
        let result = delete_messages_and_maybe_reset_summary_impl(&db, conv.id.clone(), "msg-1".into()).unwrap();
        assert!(result.summary_was_reset);

        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert!(detail.summary.is_none());
        assert!(detail.summary_up_to_message_id.is_none());

        // Verify only msg-0 remains
        let msgs = get_messages_impl(&db, detail.id).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "msg-0");
    }

    #[test]
    fn test_messages_stable_order_same_timestamp() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Insert messages with same timestamp but different ids
        {
            let conn = db.conn.lock().unwrap();
            for id in ["msg-c", "msg-a", "msg-b"] {
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![id, conv.id, "user", format!("content-{}", id), "2024-01-01"],
                ).unwrap();
            }
        }

        let msgs = get_messages_impl(&db, conv.id).unwrap();
        assert_eq!(msgs.len(), 3);
        // Should be sorted by id ASC as tiebreaker
        assert_eq!(msgs[0].id, "msg-a");
        assert_eq!(msgs[1].id, "msg-b");
        assert_eq!(msgs[2].id, "msg-c");
    }

    // ── Browser Artifact CRUD tests ──

    fn create_test_conversation(db: &Database) -> (crate::db::models::Agent, ConversationListItem) {
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

    // ── Learning Mode tests ──

    #[test]
    fn test_learning_mode_default_false() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, Some("Test".into()), agent.id).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert!(!detail.learning_mode);
    }

    #[test]
    fn test_set_learning_mode() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, Some("Test".into()), agent.id).unwrap();

        set_learning_mode_impl(&db, conv.id.clone(), true).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id.clone()).unwrap();
        assert!(detail.learning_mode);

        set_learning_mode_impl(&db, conv.id.clone(), false).unwrap();
        let detail = get_conversation_detail_impl(&db, conv.id).unwrap();
        assert!(!detail.learning_mode);
    }
}
