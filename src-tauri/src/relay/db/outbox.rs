use crate::db::error::DbError;
use crate::db::Database;

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
            "UPDATE outbox SET status = ?1, attempts = ?2, next_retry_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?3",
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
