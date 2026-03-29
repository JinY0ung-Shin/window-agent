use crate::db::error::DbError;
use crate::db::Database;
use serde::Serialize;

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

pub fn delete_thread(db: &Database, id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM peer_threads WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    })
}

pub fn clear_thread_messages(db: &Database, thread_id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM peer_messages WHERE thread_id = ?1",
            rusqlite::params![thread_id],
        )?;
        Ok(())
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
