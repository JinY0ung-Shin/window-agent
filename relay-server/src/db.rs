use sqlx::SqlitePool;

/// Initialize the offline queue table.
pub async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS offline_queue (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            target_peer_id  TEXT    NOT NULL,
            sender_peer_id  TEXT    NOT NULL,
            message_id      TEXT    NOT NULL,
            envelope_json   TEXT    NOT NULL,
            created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_oq_target ON offline_queue (target_peer_id, created_at)",
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// Enqueue a message for an offline peer.
/// Enforces per-peer cap of 1000 rows (oldest evicted).
pub async fn enqueue(
    pool: &SqlitePool,
    target_peer_id: &str,
    sender_peer_id: &str,
    message_id: &str,
    envelope_json: &str,
) -> Result<(), sqlx::Error> {
    // Insert the new message.
    sqlx::query(
        "INSERT INTO offline_queue (target_peer_id, sender_peer_id, message_id, envelope_json) VALUES (?, ?, ?, ?)",
    )
    .bind(target_peer_id)
    .bind(sender_peer_id)
    .bind(message_id)
    .bind(envelope_json)
    .execute(pool)
    .await?;

    // Enforce per-peer cap: keep the newest 1000 rows.
    sqlx::query(
        r#"
        DELETE FROM offline_queue
        WHERE target_peer_id = ?
          AND id NOT IN (
              SELECT id FROM offline_queue
              WHERE target_peer_id = ?
              ORDER BY created_at DESC
              LIMIT 1000
          )
        "#,
    )
    .bind(target_peer_id)
    .bind(target_peer_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Row returned when draining the offline queue.
#[derive(Debug, sqlx::FromRow)]
pub struct QueuedMessage {
    pub id: i64,
    pub sender_peer_id: String,
    pub message_id: String,
    pub envelope_json: String,
}

/// Drain all queued messages for a peer (time-ordered, oldest first).
/// Also prunes messages older than 7 days.
pub async fn drain(pool: &SqlitePool, target_peer_id: &str) -> Result<Vec<QueuedMessage>, sqlx::Error> {
    // Prune expired entries (TTL 7 days).
    sqlx::query(
        "DELETE FROM offline_queue WHERE created_at < datetime('now', '-7 days')",
    )
    .execute(pool)
    .await?;

    let rows: Vec<QueuedMessage> = sqlx::query_as(
        r#"
        SELECT id, sender_peer_id, message_id, envelope_json
        FROM offline_queue
        WHERE target_peer_id = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(target_peer_id)
    .fetch_all(pool)
    .await?;

    // NOTE: Do NOT delete here. Messages are removed individually via
    // remove_by_message_id() when the receiver sends a PeerAck.

    Ok(rows)
}

/// Remove a specific message from the offline queue (called on PeerAck).
pub async fn remove_by_message_id(
    pool: &SqlitePool,
    message_id: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query("DELETE FROM offline_queue WHERE message_id = ?")
        .bind(message_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
