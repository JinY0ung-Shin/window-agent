use super::super::error::DbError;
use super::super::models::DeleteMessagesResult;
use super::super::Database;
use super::with_transaction;

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
