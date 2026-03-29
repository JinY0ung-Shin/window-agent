use sqlx::SqlitePool;

/// Initialize database tables.
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

    // Peer directory for discovery / friend-request flow.
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS peer_directory (
            peer_id           TEXT    PRIMARY KEY,
            public_key        TEXT    NOT NULL,
            agent_name        TEXT    NOT NULL DEFAULT '',
            agent_description TEXT    NOT NULL DEFAULT '',
            discoverable      INTEGER NOT NULL DEFAULT 1,
            last_seen         TEXT    NOT NULL DEFAULT (datetime('now')),
            registered_at     TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_pd_discoverable ON peer_directory (discoverable, agent_name)",
    )
    .execute(pool)
    .await?;

    // Add agents_json column (incremental migration)
    sqlx::query("ALTER TABLE peer_directory ADD COLUMN agents_json TEXT")
        .execute(pool)
        .await
        .ok(); // Ignore error if column already exists

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

// ── Peer directory ──

/// Row returned from the peer_directory table.
#[derive(Debug, sqlx::FromRow)]
pub struct DirectoryRow {
    pub peer_id: String,
    pub public_key: String,
    pub agent_name: String,
    pub agent_description: String,
    pub discoverable: bool,
    pub last_seen: String,
    pub agents_json: Option<String>,
}

/// Insert or update a peer's directory profile.
pub async fn upsert_profile(
    pool: &SqlitePool,
    peer_id: &str,
    public_key: &str,
    agent_name: &str,
    agent_description: &str,
    discoverable: bool,
    agents_json: Option<&str>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO peer_directory (peer_id, public_key, agent_name, agent_description, discoverable, agents_json, last_seen, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(peer_id) DO UPDATE SET
            agent_name = excluded.agent_name,
            agent_description = excluded.agent_description,
            discoverable = excluded.discoverable,
            agents_json = excluded.agents_json,
            last_seen = datetime('now'),
            updated_at = datetime('now')
        "#,
    )
    .bind(peer_id)
    .bind(public_key)
    .bind(agent_name)
    .bind(agent_description)
    .bind(discoverable)
    .bind(agents_json)
    .execute(pool)
    .await?;
    Ok(())
}

/// Update last_seen timestamp for a peer (called on authentication).
pub async fn update_last_seen(pool: &SqlitePool, peer_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE peer_directory SET last_seen = datetime('now') WHERE peer_id = ?")
        .bind(peer_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Search result with total count.
pub struct SearchResult {
    pub rows: Vec<DirectoryRow>,
    pub total: u64,
}

/// Search discoverable peers by name or peer_id prefix.
pub async fn search_directory(
    pool: &SqlitePool,
    query: &str,
    limit: u32,
    offset: u32,
) -> Result<SearchResult, sqlx::Error> {
    let pattern = format!("%{}%", query);

    let total: (i64,) = sqlx::query_as(
        r#"
        SELECT COUNT(*) FROM peer_directory
        WHERE discoverable = 1
          AND (agent_name LIKE ? OR peer_id LIKE ? OR agents_json LIKE ?)
        "#,
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .fetch_one(pool)
    .await?;

    let rows: Vec<DirectoryRow> = sqlx::query_as(
        r#"
        SELECT peer_id, public_key, agent_name, agent_description, discoverable, last_seen, agents_json
        FROM peer_directory
        WHERE discoverable = 1
          AND (agent_name LIKE ? OR peer_id LIKE ? OR agents_json LIKE ?)
        ORDER BY last_seen DESC
        LIMIT ? OFFSET ?
        "#,
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    Ok(SearchResult {
        rows,
        total: total.0 as u64,
    })
}

/// Get a single peer's directory entry (only if discoverable).
pub async fn get_peer_from_directory(
    pool: &SqlitePool,
    peer_id: &str,
) -> Result<Option<DirectoryRow>, sqlx::Error> {
    let row: Option<DirectoryRow> = sqlx::query_as(
        r#"
        SELECT peer_id, public_key, agent_name, agent_description, discoverable, last_seen, agents_json
        FROM peer_directory
        WHERE peer_id = ? AND discoverable = 1
        "#,
    )
    .bind(peer_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}
