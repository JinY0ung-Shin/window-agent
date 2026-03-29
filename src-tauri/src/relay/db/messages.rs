use crate::db::error::DbError;
use crate::db::Database;
use serde::Serialize;

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
    pub target_agent_id: Option<String>,
    pub responding_agent_id: Option<String>,
    pub created_at: String,
}

// ── Message operations ──

/// Insert a peer message. Returns `false` if `message_id_unique` already exists (idempotent).
pub fn insert_peer_message(db: &Database, msg: &PeerMessageRow) -> Result<bool, DbError> {
    db.with_conn(|conn| {
        let affected = conn.execute(
            "INSERT OR IGNORE INTO peer_messages (id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, target_agent_id, responding_agent_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
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
                msg.target_agent_id,
                msg.responding_agent_id,
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
            "SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, target_agent_id, responding_agent_id, created_at
             FROM peer_messages WHERE thread_id = ?1 ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![thread_id], map_message_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

/// Get the most recent N messages for a thread (for LLM context window).
pub fn get_thread_messages_recent(
    db: &Database,
    thread_id: &str,
    limit: u32,
) -> Result<Vec<PeerMessageRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT * FROM (
                SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, target_agent_id, responding_agent_id, created_at
                FROM peer_messages WHERE thread_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2
             ) ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(rusqlite::params![thread_id, limit], map_message_row)?;
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
        let tx = conn.unchecked_transaction()?;
        if let Some(as_val) = approval_state {
            tx.execute(
                "UPDATE peer_messages SET approval_state = ?1 WHERE id = ?2",
                rusqlite::params![as_val, id],
            )?;
        }
        if let Some(ds_val) = delivery_state {
            tx.execute(
                "UPDATE peer_messages SET delivery_state = ?1 WHERE id = ?2",
                rusqlite::params![ds_val, id],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

pub fn get_peer_message(db: &Database, id: &str) -> Result<Option<PeerMessageRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, target_agent_id, responding_agent_id, created_at
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
            "SELECT id, thread_id, message_id_unique, correlation_id, direction, sender_agent, content, approval_state, delivery_state, retry_count, raw_envelope, target_agent_id, responding_agent_id, created_at
             FROM peer_messages WHERE message_id_unique = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![unique_id], map_message_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

/// peer_messages 테이블의 raw_envelope 컬럼을 업데이트
pub fn update_message_raw_envelope(
    db: &Database,
    message_id: &str,
    raw_envelope: &str,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE peer_messages SET raw_envelope = ?1 WHERE id = ?2",
            rusqlite::params![raw_envelope, message_id],
        )?;
        Ok(())
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
        target_agent_id: row.get(11)?,
        responding_agent_id: row.get(12)?,
        created_at: row.get(13)?,
    })
}
