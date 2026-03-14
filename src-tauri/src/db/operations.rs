use super::error::DbError;
use super::models::{Conversation, Message, SaveMessageRequest};
use super::Database;
use chrono::Utc;
use uuid::Uuid;

pub fn create_conversation_impl(
    db: &Database,
    title: Option<String>,
    agent_id: String,
) -> Result<Conversation, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let now = Utc::now().to_rfc3339();
    let conv = Conversation {
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
}

pub fn get_conversations_impl(db: &Database) -> Result<Vec<Conversation>, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let mut stmt = conn
        .prepare("SELECT id, title, agent_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC")?;

    let rows = stmt.query_map([], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            agent_id: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_messages_impl(
    db: &Database,
    conversation_id: String,
) -> Result<Vec<Message>, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(rusqlite::params![conversation_id], |row| {
        Ok(Message {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn save_message_impl(
    db: &Database,
    request: SaveMessageRequest,
) -> Result<Message, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let now = Utc::now().to_rfc3339();
    let msg = Message {
        id: Uuid::new_v4().to_string(),
        conversation_id: request.conversation_id.clone(),
        role: request.role,
        content: request.content,
        created_at: now.clone(),
    };

    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at],
    )?;

    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, request.conversation_id],
    )?;

    Ok(msg)
}

pub fn delete_messages_from_impl(
    db: &Database,
    conversation_id: String,
    message_id: String,
) -> Result<(), DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    conn.execute(
        "DELETE FROM messages WHERE conversation_id = ?1 AND (
            created_at > (SELECT created_at FROM messages WHERE id = ?2)
            OR (created_at = (SELECT created_at FROM messages WHERE id = ?2) AND id >= ?2)
        )",
        rusqlite::params![conversation_id, message_id],
    )?;
    Ok(())
}

pub fn delete_conversation_impl(
    db: &Database,
    conversation_id: String,
) -> Result<(), DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        rusqlite::params![conversation_id],
    )?;
    Ok(())
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
            },
        )
        .unwrap();
        save_message_impl(
            &db,
            SaveMessageRequest {
                conversation_id: conv.id.clone(),
                role: "assistant".into(),
                content: "hi there".into(),
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
    fn test_delete_messages_from() {
        let db = setup_db();
        let agent = create_test_agent(&db);
        let conv = create_conversation_impl(&db, None, agent.id).unwrap();

        // Insert messages with explicit timestamps
        {
            let conn = db.conn.lock().unwrap();
            for (i, ts) in ["2024-01-01", "2024-01-02", "2024-01-03"].iter().enumerate() {
                conn.execute(
                    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    rusqlite::params![format!("msg-{}", i), conv.id, "user", format!("message {}", i), ts],
                ).unwrap();
            }
        }

        // Delete from msg-1 (inclusive) onwards
        delete_messages_from_impl(&db, conv.id.clone(), "msg-1".into()).unwrap();

        let msgs = get_messages_impl(&db, conv.id).unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].id, "msg-0");
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
            },
        );
        assert!(result.is_err(), "FK constraint should reject nonexistent conversation_id");
    }
}
