use super::models::{Conversation, Message, SaveMessageRequest};
use super::Database;
use chrono::Utc;
use uuid::Uuid;

pub fn create_conversation_impl(
    db: &Database,
    title: Option<String>,
) -> Result<Conversation, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let conv = Conversation {
        id: Uuid::new_v4().to_string(),
        title: title.unwrap_or_else(|| "새 대화".to_string()),
        created_at: now.clone(),
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![conv.id, conv.title, conv.created_at, conv.updated_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(conv)
}

pub fn get_conversations_impl(db: &Database) -> Result<Vec<Conversation>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut conversations = Vec::new();
    for row in rows {
        conversations.push(row.map_err(|e| e.to_string())?);
    }
    Ok(conversations)
}

pub fn get_messages_impl(
    db: &Database,
    conversation_id: String,
) -> Result<Vec<Message>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, conversation_id, role, content, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![conversation_id], |row| {
            Ok(Message {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?);
    }
    Ok(messages)
}

pub fn save_message_impl(
    db: &Database,
    request: SaveMessageRequest,
) -> Result<Message, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, request.conversation_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(msg)
}

pub fn delete_conversation_impl(
    db: &Database,
    conversation_id: String,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        rusqlite::params![conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
    }

    #[test]
    fn test_create_conversation_default_title() {
        let db = setup_db();
        let conv = create_conversation_impl(&db, None).unwrap();
        assert_eq!(conv.title, "새 대화");
        assert!(!conv.id.is_empty());
        assert!(!conv.created_at.is_empty());
    }

    #[test]
    fn test_create_conversation_custom_title() {
        let db = setup_db();
        let conv = create_conversation_impl(&db, Some("테스트 대화".into())).unwrap();
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
        let c1 = create_conversation_impl(&db, Some("First".into())).unwrap();
        let c2 = create_conversation_impl(&db, Some("Second".into())).unwrap();

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
        let conv = create_conversation_impl(&db, None).unwrap();

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
        let conv = create_conversation_impl(&db, None).unwrap();
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
        let conv = create_conversation_impl(&db, None).unwrap();
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
        let conv = create_conversation_impl(&db, None).unwrap();
        delete_conversation_impl(&db, conv.id).unwrap();
        let convs = get_conversations_impl(&db).unwrap();
        assert!(convs.is_empty());
    }

    #[test]
    fn test_delete_cascade() {
        let db = setup_db();
        let conv = create_conversation_impl(&db, None).unwrap();
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
}
