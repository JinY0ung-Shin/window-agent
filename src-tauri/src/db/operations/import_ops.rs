use super::super::error::DbError;
use super::super::models::{Agent, ConversationDetail, Message};
use super::super::Database;
use uuid::Uuid;

/// Result of a successful agent import at the DB level.
pub struct ImportDbResult {
    pub conversations_imported: usize,
    pub messages_imported: usize,
}

/// Insert an imported agent and its conversations/messages into the database.
///
/// Uses a savepoint so the caller can coordinate with filesystem writes.
/// Returns the result counts and the held MutexGuard (connection) so the
/// caller can drop it when ready.
///
/// The savepoint is committed before returning. If the caller needs to
/// roll back due to subsequent filesystem failures, the DB state will
/// already be committed — so the caller should clean up via DELETE.
/// However, since the caller creates the agent directory *after* this
/// call, a simpler pattern is used: the caller just deletes the agent
/// row on filesystem failure, which cascades.
pub fn import_agent_to_db(
    db: &Database,
    new_agent_id: &str,
    new_folder: &str,
    old_agent: &Agent,
    now: &str,
    conversations: &[(ConversationDetail, Vec<Message>)],
) -> Result<ImportDbResult, DbError> {
    let mut conn = db.conn.lock().map_err(|_| DbError::lock())?;
    let tx = conn.savepoint()?;

    tx.execute(
        "INSERT INTO agents (id, folder_name, name, avatar, description, model, temperature, thinking_enabled, thinking_budget, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            new_agent_id,
            new_folder,
            old_agent.name,
            old_agent.avatar,
            old_agent.description,
            old_agent.model,
            old_agent.temperature,
            old_agent.thinking_enabled,
            old_agent.thinking_budget,
            false, // never import as default
            old_agent.sort_order,
            now,
            now,
        ],
    )?;

    let mut conversations_imported = 0usize;
    let mut messages_imported = 0usize;

    for (conv_detail, msgs) in conversations {
        let new_conv_id = Uuid::new_v4().to_string();

        let active_skills_json: Option<String> = conv_detail
            .active_skills
            .as_ref()
            .map(|skills| serde_json::to_string(skills).unwrap_or_default());
        tx.execute(
            "INSERT INTO conversations (id, title, agent_id, summary, summary_up_to_message_id, active_skills, learning_mode, digest_id, consolidated_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, NULL, NULL, ?7, ?8)",
            rusqlite::params![
                new_conv_id,
                conv_detail.title,
                new_agent_id,
                conv_detail.summary,
                active_skills_json,
                conv_detail.learning_mode as i64,
                conv_detail.created_at,
                conv_detail.updated_at,
            ],
        )?;
        conversations_imported += 1;

        for msg in msgs {
            let new_msg_id = Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO messages (id, conversation_id, role, content, tool_call_id, tool_name, tool_input, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    new_msg_id,
                    new_conv_id,
                    msg.role,
                    msg.content,
                    msg.tool_call_id,
                    msg.tool_name,
                    msg.tool_input,
                    msg.created_at,
                ],
            )?;
            messages_imported += 1;
        }
    }

    tx.commit()?;
    drop(conn);

    Ok(ImportDbResult {
        conversations_imported,
        messages_imported,
    })
}

/// Delete an imported agent (used for cleanup when filesystem writes fail
/// after a successful DB import). FK cascades handle conversations/messages.
pub fn delete_imported_agent(db: &Database, agent_id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM agents WHERE id = ?1",
            rusqlite::params![agent_id],
        )?;
        Ok(())
    })
}
