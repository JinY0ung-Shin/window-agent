use super::super::error::DbError;
use super::super::models::{ConversationDetail, ConversationListItem, DeleteMessagesResult};
use super::super::Database;
use super::with_transaction;
use chrono::Utc;
use uuid::Uuid;

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
            team_id: None,
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

pub fn create_team_conversation_impl(
    db: &Database,
    team_id: String,
    leader_agent_id: String,
    title: Option<String>,
) -> Result<ConversationListItem, DbError> {
    db.with_conn(|conn| {
        let now = Utc::now().to_rfc3339();
        let conv = ConversationListItem {
            id: Uuid::new_v4().to_string(),
            title: title.unwrap_or_else(|| "팀 대화".to_string()),
            agent_id: leader_agent_id,
            team_id: Some(team_id.clone()),
            created_at: now.clone(),
            updated_at: now,
        };

        conn.execute(
            "INSERT INTO conversations (id, title, agent_id, team_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![conv.id, conv.title, conv.agent_id, conv.team_id, conv.created_at, conv.updated_at],
        )?;

        Ok(conv)
    })
}

pub fn get_conversations_impl(db: &Database) -> Result<Vec<ConversationListItem>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn
            .prepare("SELECT id, title, agent_id, team_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC")?;

        let rows = stmt.query_map([], |row| {
            Ok(ConversationListItem {
                id: row.get(0)?,
                title: row.get(1)?,
                agent_id: row.get(2)?,
                team_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
            "SELECT id, title, agent_id, team_id, summary, summary_up_to_message_id, active_skills, learning_mode, digest_id, consolidated_at, created_at, updated_at FROM conversations WHERE id = ?1",
            rusqlite::params![id],
            |row| {
                let active_skills_raw: Option<String> = row.get(6)?;
                let active_skills: Option<Vec<String>> = active_skills_raw
                    .and_then(|s| serde_json::from_str(&s).ok());
                let learning_mode_raw: i64 = row.get::<_, Option<i64>>(7)?.unwrap_or(0);
                Ok(ConversationDetail {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    agent_id: row.get(2)?,
                    team_id: row.get(3)?,
                    summary: row.get(4)?,
                    summary_up_to_message_id: row.get(5)?,
                    active_skills,
                    learning_mode: learning_mode_raw != 0,
                    digest_id: row.get(8)?,
                    consolidated_at: row.get(9)?,
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )?;
        Ok(detail)
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

// ── Consolidation Checkpoint ──

pub fn update_conversation_digest_impl(
    db: &Database,
    id: String,
    digest_id: Option<String>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET digest_id = ?1 WHERE id = ?2",
            rusqlite::params![digest_id, id],
        )?;
        Ok(())
    })
}

pub fn update_conversation_consolidated_at_impl(
    db: &Database,
    id: String,
    consolidated_at: Option<String>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE conversations SET consolidated_at = ?1 WHERE id = ?2",
            rusqlite::params![consolidated_at, id],
        )?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::message_ops::*;
    use crate::db::agent_operations;
    use crate::db::models::{CreateAgentRequest, SaveMessageRequest};

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
    }

    /// Helper: create a default agent for conversation tests
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
                sender_agent_id: None,
                team_run_id: None,
                team_task_id: None,
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
            sender_agent_id: None,
            team_run_id: None,
            team_task_id: None,
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
            sender_agent_id: None,
            team_run_id: None,
            team_task_id: None,
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
