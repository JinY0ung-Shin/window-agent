use super::super::error::DbError;
use super::super::models::PendingConsolidation;
use super::super::Database;

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

pub fn list_pending_consolidations_impl(
    db: &Database,
) -> Result<Vec<PendingConsolidation>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.agent_id
             FROM conversations c
             WHERE (c.digest_id IS NULL OR c.consolidated_at IS NULL)
               AND (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) >= 3
             ORDER BY c.updated_at DESC",
        )?;

        let rows = stmt.query_map([], |row| {
            Ok(PendingConsolidation {
                conversation_id: row.get(0)?,
                agent_id: row.get(1)?,
            })
        })?;

        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}
