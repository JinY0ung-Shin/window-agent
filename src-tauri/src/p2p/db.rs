use crate::db::error::DbError;
use crate::db::Database;
use serde::Serialize;

// ── Row types ──

#[derive(Debug, Clone, Serialize)]
pub struct ContactRow {
    pub id: String,
    pub peer_id: String,
    pub public_key: String,
    pub display_name: String,
    pub agent_name: String,
    pub agent_description: String,
    pub local_agent_id: Option<String>,
    pub mode: String,
    pub capabilities_json: String,
    pub status: String,
    pub invite_card_raw: Option<String>,
    pub addresses_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct ContactUpdate {
    pub display_name: Option<String>,
    pub agent_name: Option<String>,
    pub agent_description: Option<String>,
    pub local_agent_id: Option<Option<String>>,
    pub mode: Option<String>,
    pub capabilities_json: Option<String>,
    pub status: Option<String>,
    pub addresses_json: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeerThreadRow {
    pub id: String,
    pub contact_id: String,
    pub local_agent_id: Option<String>,
    pub title: String,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PeerMessageRow {
    pub id: String,
    pub thread_id: String,
    pub message_id_unique: String,
    pub correlation_id: Option<String>,
    pub direction: String,
    pub sender_agent: String,
    pub content: String,
    pub approval_state: String,
    pub delivery_state: String,
    pub retry_count: i32,
    pub raw_envelope: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct OutboxRow {
    pub id: String,
    pub peer_message_id: String,
    pub target_peer_id: String,
    pub attempts: i32,
    pub next_retry_at: Option<String>,
    pub status: String,
    pub created_at: String,
}

// ── Contact operations ──

pub fn insert_contact(db: &Database, contact: &ContactRow) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                contact.id,
                contact.peer_id,
                contact.public_key,
                contact.display_name,
                contact.agent_name,
                contact.agent_description,
                contact.local_agent_id,
                contact.mode,
                contact.capabilities_json,
                contact.status,
                contact.invite_card_raw,
                contact.addresses_json,
                contact.created_at,
                contact.updated_at,
            ],
        )?;
        Ok(())
    })
}

pub fn get_contact(db: &Database, id: &str) -> Result<Option<ContactRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at
             FROM contacts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_contact_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

pub fn get_contact_by_peer_id(
    db: &Database,
    peer_id: &str,
) -> Result<Option<ContactRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at
             FROM contacts WHERE peer_id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![peer_id], map_contact_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

pub fn list_contacts(db: &Database) -> Result<Vec<ContactRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at
             FROM contacts ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], map_contact_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_contact(
    db: &Database,
    id: &str,
    updates: ContactUpdate,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        let mut sets: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref v) = updates.display_name {
            sets.push(format!("display_name = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.agent_name {
            sets.push(format!("agent_name = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.agent_description {
            sets.push(format!("agent_description = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.local_agent_id {
            sets.push(format!("local_agent_id = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.mode {
            sets.push(format!("mode = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.capabilities_json {
            sets.push(format!("capabilities_json = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.status {
            sets.push(format!("status = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.addresses_json {
            sets.push(format!("addresses_json = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }

        if sets.is_empty() {
            return Ok(());
        }

        sets.push("updated_at = datetime('now')".to_string());
        let id_param_idx = params.len() + 1;
        params.push(Box::new(id.to_string()));

        let sql = format!(
            "UPDATE contacts SET {} WHERE id = ?{}",
            sets.join(", "),
            id_param_idx
        );
        conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))?;
        Ok(())
    })
}

pub fn delete_contact(db: &Database, id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM contacts WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    })
}

fn map_contact_row(row: &rusqlite::Row) -> Result<ContactRow, rusqlite::Error> {
    Ok(ContactRow {
        id: row.get(0)?,
        peer_id: row.get(1)?,
        public_key: row.get(2)?,
        display_name: row.get(3)?,
        agent_name: row.get(4)?,
        agent_description: row.get(5)?,
        local_agent_id: row.get(6)?,
        mode: row.get(7)?,
        capabilities_json: row.get(8)?,
        status: row.get(9)?,
        invite_card_raw: row.get(10)?,
        addresses_json: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

// ── Thread operations ──

pub fn create_thread(db: &Database, thread: &PeerThreadRow) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO peer_threads (id, contact_id, local_agent_id, title, summary, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                thread.id,
                thread.contact_id,
                thread.local_agent_id,
                thread.title,
                thread.summary,
                thread.created_at,
                thread.updated_at,
            ],
        )?;
        Ok(())
    })
}

pub fn list_threads_for_contact(
    db: &Database,
    contact_id: &str,
) -> Result<Vec<PeerThreadRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, contact_id, local_agent_id, title, summary, created_at, updated_at
             FROM peer_threads WHERE contact_id = ?1 ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map(rusqlite::params![contact_id], map_thread_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn get_thread(db: &Database, id: &str) -> Result<Option<PeerThreadRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, contact_id, local_agent_id, title, summary, created_at, updated_at
             FROM peer_threads WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_thread_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

fn map_thread_row(row: &rusqlite::Row) -> Result<PeerThreadRow, rusqlite::Error> {
    Ok(PeerThreadRow {
        id: row.get(0)?,
        contact_id: row.get(1)?,
        local_agent_id: row.get(2)?,
        title: row.get(3)?,
        summary: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

// ── Message operations ──

/// Insert a peer message. Returns `false` if `message_id_unique` already exists (idempotent).
pub fn insert_peer_message(db: &Database, msg: &PeerMessageRow) -> Result<bool, DbError> {
    db.with_conn(|conn| {
        let affected = conn.execute(
            "INSERT OR IGNORE INTO peer_messages (id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                msg.id,
                msg.thread_id,
                msg.message_id_unique,
                msg.correlation_id,
                msg.direction,
                msg.sender_agent,
                msg.content,
                msg.approval_state,
                msg.delivery_state,
                msg.retry_count,
                msg.raw_envelope,
                msg.created_at,
            ],
        )?;
        Ok(affected > 0)
    })
}

pub fn get_thread_messages(
    db: &Database,
    thread_id: &str,
) -> Result<Vec<PeerMessageRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, created_at
             FROM peer_messages WHERE thread_id = ?1 ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![thread_id], map_message_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_message_state(
    db: &Database,
    id: &str,
    approval_state: Option<&str>,
    delivery_state: Option<&str>,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        if let Some(as_val) = approval_state {
            conn.execute(
                "UPDATE peer_messages SET approval_state = ?1 WHERE id = ?2",
                rusqlite::params![as_val, id],
            )?;
        }
        if let Some(ds_val) = delivery_state {
            conn.execute(
                "UPDATE peer_messages SET delivery_state = ?1 WHERE id = ?2",
                rusqlite::params![ds_val, id],
            )?;
        }
        Ok(())
    })
}

pub fn get_peer_message(db: &Database, id: &str) -> Result<Option<PeerMessageRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, created_at
             FROM peer_messages WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_message_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

pub fn get_message_by_unique_id(
    db: &Database,
    unique_id: &str,
) -> Result<Option<PeerMessageRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, created_at
             FROM peer_messages WHERE message_id_unique = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![unique_id], map_message_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

fn map_message_row(row: &rusqlite::Row) -> Result<PeerMessageRow, rusqlite::Error> {
    Ok(PeerMessageRow {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        message_id_unique: row.get(2)?,
        correlation_id: row.get(3)?,
        direction: row.get(4)?,
        sender_agent: row.get(5)?,
        content: row.get(6)?,
        approval_state: row.get(7)?,
        delivery_state: row.get(8)?,
        retry_count: row.get(9)?,
        raw_envelope: row.get(10)?,
        created_at: row.get(11)?,
    })
}

// ── Outbox operations ──

pub fn insert_outbox(db: &Database, entry: &OutboxRow) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO outbox (id, peer_message_id, target_peer_id, attempts, next_retry_at, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                entry.id,
                entry.peer_message_id,
                entry.target_peer_id,
                entry.attempts,
                entry.next_retry_at,
                entry.status,
                entry.created_at,
            ],
        )?;
        Ok(())
    })
}

pub fn get_pending_outbox(db: &Database) -> Result<Vec<OutboxRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_message_id, target_peer_id, attempts, next_retry_at, status, created_at
             FROM outbox WHERE status IN ('pending', 'sending', 'queued') ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], map_outbox_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_outbox_status(
    db: &Database,
    id: &str,
    status: &str,
    attempts: i32,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE outbox SET status = ?1, attempts = ?2 WHERE id = ?3",
            rusqlite::params![status, attempts, id],
        )?;
        Ok(())
    })
}

pub fn get_outbox_by_message_id(
    db: &Database,
    peer_message_id: &str,
) -> Result<Option<OutboxRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_message_id, target_peer_id, attempts, next_retry_at, status, created_at
             FROM outbox WHERE peer_message_id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![peer_message_id], map_outbox_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

pub fn update_outbox_retry(
    db: &Database,
    id: &str,
    attempts: i32,
    next_retry_at: &str,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE outbox SET status = 'pending', attempts = ?1, next_retry_at = ?2 WHERE id = ?3",
            rusqlite::params![attempts, next_retry_at, id],
        )?;
        Ok(())
    })
}

#[allow(dead_code)] // TODO: call from outbox GC or manual message cancellation
pub fn delete_outbox_entry(db: &Database, id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM outbox WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    })
}

fn map_outbox_row(row: &rusqlite::Row) -> Result<OutboxRow, rusqlite::Error> {
    Ok(OutboxRow {
        id: row.get(0)?,
        peer_message_id: row.get(1)?,
        target_peer_id: row.get(2)?,
        attempts: row.get(3)?,
        next_retry_at: row.get(4)?,
        status: row.get(5)?,
        created_at: row.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
    }

    fn make_contact(id: &str, peer_id: &str) -> ContactRow {
        ContactRow {
            id: id.to_string(),
            peer_id: peer_id.to_string(),
            public_key: format!("pk_{}", peer_id),
            display_name: format!("User {}", id),
            agent_name: String::new(),
            agent_description: String::new(),
            local_agent_id: None,
            mode: "secretary".to_string(),
            capabilities_json: r#"{"can_send_messages":true}"#.to_string(),
            status: "pending".to_string(),
            invite_card_raw: None,
            addresses_json: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_thread(id: &str, contact_id: &str) -> PeerThreadRow {
        PeerThreadRow {
            id: id.to_string(),
            contact_id: contact_id.to_string(),
            local_agent_id: None,
            title: String::new(),
            summary: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_message(id: &str, thread_id: &str, unique_id: &str) -> PeerMessageRow {
        PeerMessageRow {
            id: id.to_string(),
            thread_id: thread_id.to_string(),
            message_id_unique: unique_id.to_string(),
            correlation_id: None,
            direction: "outbound".to_string(),
            sender_agent: String::new(),
            content: "hello".to_string(),
            approval_state: "none".to_string(),
            delivery_state: "pending".to_string(),
            retry_count: 0,
            raw_envelope: None,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    fn make_outbox(id: &str, msg_id: &str, target: &str) -> OutboxRow {
        OutboxRow {
            id: id.to_string(),
            peer_message_id: msg_id.to_string(),
            target_peer_id: target.to_string(),
            attempts: 0,
            next_retry_at: None,
            status: "pending".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
        }
    }

    // ── Contact tests ──

    #[test]
    fn test_insert_and_list_contacts() {
        let db = setup_db();
        let c1 = make_contact("c1", "peer1");
        let c2 = make_contact("c2", "peer2");

        insert_contact(&db, &c1).unwrap();
        insert_contact(&db, &c2).unwrap();

        let contacts = list_contacts(&db).unwrap();
        assert_eq!(contacts.len(), 2);
    }

    #[test]
    fn test_get_contact_by_peer_id() {
        let db = setup_db();
        let c = make_contact("c1", "peer-abc");
        insert_contact(&db, &c).unwrap();

        let found = get_contact_by_peer_id(&db, "peer-abc").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().display_name, "User c1");

        let not_found = get_contact_by_peer_id(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_update_contact() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        update_contact(
            &db,
            "c1",
            ContactUpdate {
                display_name: Some("New Name".to_string()),
                status: Some("accepted".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact_by_peer_id(&db, "peer1").unwrap().unwrap();
        assert_eq!(found.display_name, "New Name");
        assert_eq!(found.status, "accepted");
    }

    #[test]
    fn test_delete_contact() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        delete_contact(&db, "c1").unwrap();

        let contacts = list_contacts(&db).unwrap();
        assert!(contacts.is_empty());
    }

    #[test]
    fn test_duplicate_peer_id_rejected() {
        let db = setup_db();
        let c1 = make_contact("c1", "same-peer");
        let mut c2 = make_contact("c2", "same-peer");
        c2.public_key = "pk_other".to_string();

        insert_contact(&db, &c1).unwrap();
        let result = insert_contact(&db, &c2);
        assert!(result.is_err(), "duplicate peer_id should be rejected");
    }

    // ── Thread tests ──

    #[test]
    fn test_create_and_list_threads() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        let t1 = make_thread("t1", "c1");
        let t2 = make_thread("t2", "c1");
        create_thread(&db, &t1).unwrap();
        create_thread(&db, &t2).unwrap();

        let threads = list_threads_for_contact(&db, "c1").unwrap();
        assert_eq!(threads.len(), 2);
    }

    #[test]
    fn test_get_thread() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let found = get_thread(&db, "t1").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().contact_id, "c1");

        let not_found = get_thread(&db, "nonexistent").unwrap();
        assert!(not_found.is_none());
    }

    // ── Message tests ──

    #[test]
    fn test_insert_and_get_messages() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let m = make_message("m1", "t1", "uniq-1");
        let inserted = insert_peer_message(&db, &m).unwrap();
        assert!(inserted);

        let msgs = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "hello");
    }

    #[test]
    fn test_duplicate_message_idempotent() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();

        let m = make_message("m1", "t1", "uniq-1");
        assert!(insert_peer_message(&db, &m).unwrap());

        // Same message_id_unique — should return false (not inserted)
        let m2 = make_message("m2", "t1", "uniq-1");
        assert!(!insert_peer_message(&db, &m2).unwrap());

        let msgs = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs.len(), 1);
    }

    #[test]
    fn test_update_message_state() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        update_message_state(&db, "m1", Some("approved"), Some("sent")).unwrap();

        let msgs = get_thread_messages(&db, "t1").unwrap();
        assert_eq!(msgs[0].approval_state, "approved");
        assert_eq!(msgs[0].delivery_state, "sent");
    }

    // ── Outbox tests ──

    #[test]
    fn test_outbox_crud() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();

        let o = make_outbox("o1", "m1", "peer1");
        insert_outbox(&db, &o).unwrap();

        let pending = get_pending_outbox(&db).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].target_peer_id, "peer1");

        // Update status to sent
        update_outbox_status(&db, "o1", "sent", 1).unwrap();
        let pending = get_pending_outbox(&db).unwrap();
        assert!(pending.is_empty());

        // Delete
        delete_outbox_entry(&db, "o1").unwrap();
        // Verify deleted
        let all: i64 = db
            .with_conn(|conn| {
                Ok(conn.query_row("SELECT COUNT(*) FROM outbox", [], |row| row.get(0))?)
            })
            .unwrap();
        assert_eq!(all, 0);
    }

    #[test]
    fn test_outbox_cascades_on_message_delete() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();
        let t = make_thread("t1", "c1");
        create_thread(&db, &t).unwrap();
        let m = make_message("m1", "t1", "uniq-1");
        insert_peer_message(&db, &m).unwrap();
        let o = make_outbox("o1", "m1", "peer1");
        insert_outbox(&db, &o).unwrap();

        // Delete the contact — cascades through threads → messages → outbox
        delete_contact(&db, "c1").unwrap();

        let pending = get_pending_outbox(&db).unwrap();
        assert!(pending.is_empty());
    }

    // ── addresses_json tests ──

    #[test]
    fn test_insert_contact_with_addresses_json() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(r#"["/ip4/1.2.3.4/tcp/4001"]"#.to_string());
        insert_contact(&db, &c).unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/1.2.3.4/tcp/4001"]"#)
        );
    }

    #[test]
    fn test_insert_contact_without_addresses_json() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert!(found.addresses_json.is_none());
    }

    #[test]
    fn test_update_contact_addresses_json() {
        let db = setup_db();
        let c = make_contact("c1", "peer1");
        insert_contact(&db, &c).unwrap();

        update_contact(
            &db,
            "c1",
            ContactUpdate {
                addresses_json: Some(Some(r#"["/ip4/5.6.7.8/tcp/9000"]"#.to_string())),
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/5.6.7.8/tcp/9000"]"#)
        );
    }

    #[test]
    fn test_addresses_json_roundtrip_multiple() {
        let db = setup_db();
        let addrs = r#"["/ip4/1.2.3.4/tcp/4001","/ip6/::1/tcp/4001"]"#;
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(addrs.to_string());
        insert_contact(&db, &c).unwrap();

        let found = get_contact_by_peer_id(&db, "peer1").unwrap().unwrap();
        assert_eq!(found.addresses_json.as_deref(), Some(addrs));

        // Verify JSON parsing roundtrip
        let parsed: Vec<String> = serde_json::from_str(found.addresses_json.as_ref().unwrap()).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0], "/ip4/1.2.3.4/tcp/4001");
        assert_eq!(parsed[1], "/ip6/::1/tcp/4001");
    }

    #[test]
    fn test_duplicate_peer_id_update_addresses() {
        let db = setup_db();
        let mut c1 = make_contact("c1", "peer1");
        c1.addresses_json = Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#.to_string());
        c1.agent_name = "OldAgent".to_string();
        insert_contact(&db, &c1).unwrap();

        // Simulate updating existing contact when re-invited with new addresses
        update_contact(
            &db,
            "c1",
            ContactUpdate {
                addresses_json: Some(Some(r#"["/ip4/2.2.2.2/tcp/5000"]"#.to_string())),
                agent_name: Some("NewAgent".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/2.2.2.2/tcp/5000"]"#)
        );
        assert_eq!(found.agent_name, "NewAgent");
    }

    #[test]
    fn test_clear_addresses_json_with_none() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#.to_string());
        insert_contact(&db, &c).unwrap();

        // Re-accept with empty addresses should clear stored addresses
        update_contact(
            &db,
            "c1",
            ContactUpdate {
                addresses_json: Some(None), // tri-state: explicitly set to NULL
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert!(
            found.addresses_json.is_none(),
            "addresses_json should be cleared to NULL"
        );
    }

    #[test]
    fn test_dial_peer_no_address_scenarios() {
        let db = setup_db();

        // Scenario 1: addresses_json is None
        let c1 = make_contact("c1", "peer1");
        insert_contact(&db, &c1).unwrap();
        let contact = get_contact(&db, "c1").unwrap().unwrap();
        assert!(contact.addresses_json.is_none(), "new contact has no addresses");

        // Scenario 2: addresses_json is empty array
        let mut c2 = make_contact("c2", "peer2");
        c2.addresses_json = Some("[]".to_string());
        insert_contact(&db, &c2).unwrap();
        let contact2 = get_contact(&db, "c2").unwrap().unwrap();
        let addrs: Vec<String> =
            serde_json::from_str(contact2.addresses_json.as_ref().unwrap()).unwrap();
        assert!(addrs.is_empty(), "empty array should have no addresses");

        // Scenario 3: addresses_json has valid addresses
        let mut c3 = make_contact("c3", "peer3");
        c3.addresses_json = Some(r#"["/ip4/1.2.3.4/tcp/4001"]"#.to_string());
        insert_contact(&db, &c3).unwrap();
        let contact3 = get_contact(&db, "c3").unwrap().unwrap();
        let addrs3: Vec<String> =
            serde_json::from_str(contact3.addresses_json.as_ref().unwrap()).unwrap();
        assert_eq!(addrs3.len(), 1, "should have one address");
    }

    #[test]
    fn test_addresses_json_not_updated_when_outer_none() {
        let db = setup_db();
        let mut c = make_contact("c1", "peer1");
        c.addresses_json = Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#.to_string());
        insert_contact(&db, &c).unwrap();

        // Update with None (outer) — should NOT touch addresses_json
        update_contact(
            &db,
            "c1",
            ContactUpdate {
                display_name: Some("New Name".to_string()),
                addresses_json: None, // don't update
                ..Default::default()
            },
        )
        .unwrap();

        let found = get_contact(&db, "c1").unwrap().unwrap();
        assert_eq!(
            found.addresses_json.as_deref(),
            Some(r#"["/ip4/1.1.1.1/tcp/4001"]"#),
            "addresses_json should be unchanged"
        );
    }
}
