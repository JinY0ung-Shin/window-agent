use sqlx::SqlitePool;

// ── Table initialization ──

pub async fn init_hub_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id              TEXT PRIMARY KEY,
            email           TEXT NOT NULL UNIQUE,
            password_hash   TEXT NOT NULL,
            display_name    TEXT NOT NULL DEFAULT '',
            peer_id         TEXT,
            email_verified  INTEGER NOT NULL DEFAULT 0,
            created_at      TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS shared_agents (
            id                TEXT PRIMARY KEY,
            user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name              TEXT NOT NULL,
            description       TEXT NOT NULL DEFAULT '',
            original_agent_id TEXT,
            persona_json      TEXT,
            created_at        TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_user_original ON shared_agents (user_id, original_agent_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sa_user ON shared_agents (user_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS shared_skills (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent_id    TEXT REFERENCES shared_agents(id) ON DELETE SET NULL,
            skill_name  TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            body        TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ss_user ON shared_skills (user_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_ss_agent ON shared_skills (agent_id)")
        .execute(pool)
        .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS shared_notes (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            agent_id    TEXT REFERENCES shared_agents(id) ON DELETE SET NULL,
            title       TEXT NOT NULL,
            note_type   TEXT NOT NULL DEFAULT '',
            tags_json   TEXT NOT NULL DEFAULT '[]',
            body        TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sn_user ON shared_notes (user_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sn_agent ON shared_notes (agent_id)")
        .execute(pool)
        .await?;

    // Migration: add persona_json column if not exists
    let _ = sqlx::query("ALTER TABLE shared_agents ADD COLUMN persona_json TEXT")
        .execute(pool)
        .await;

    Ok(())
}

// ── User CRUD ──

#[derive(Debug, sqlx::FromRow)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub password_hash: String,
    pub display_name: String,
    pub peer_id: Option<String>,
    pub created_at: String,
}

pub async fn create_user(
    pool: &SqlitePool,
    id: &str,
    email: &str,
    password_hash: &str,
    display_name: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(email)
    .bind(password_hash)
    .bind(display_name)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_user_by_email(pool: &SqlitePool, email: &str) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, email, password_hash, display_name, peer_id, created_at FROM users WHERE email = ?",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
}

pub async fn get_user_by_id(pool: &SqlitePool, id: &str) -> Result<Option<UserRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT id, email, password_hash, display_name, peer_id, created_at FROM users WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn update_user(
    pool: &SqlitePool,
    id: &str,
    display_name: Option<&str>,
    peer_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    let mut sets = Vec::new();
    if display_name.is_some() {
        sets.push("display_name = ?");
    }
    if peer_id.is_some() {
        sets.push("peer_id = ?");
    }
    if sets.is_empty() {
        return Ok(());
    }
    sets.push("updated_at = datetime('now')");

    let sql = format!("UPDATE users SET {} WHERE id = ?", sets.join(", "));
    let mut q = sqlx::query(&sql);
    if let Some(name) = display_name {
        q = q.bind(name);
    }
    if let Some(pid) = peer_id {
        q = q.bind(pid);
    }
    q = q.bind(id);
    q.execute(pool).await?;
    Ok(())
}

// ── Shared agents ──

#[derive(Debug, sqlx::FromRow)]
pub struct SharedAgentRow {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub name: String,
    pub description: String,
    pub original_agent_id: Option<String>,
    pub persona_json: Option<String>,
    pub skills_count: i64,
    pub notes_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn upsert_shared_agent(
    pool: &SqlitePool,
    id: &str,
    user_id: &str,
    name: &str,
    description: &str,
    original_agent_id: Option<&str>,
    persona_json: Option<&str>,
) -> Result<String, sqlx::Error> {
    // Try upsert on (user_id, original_agent_id) if original_agent_id provided.
    if let Some(orig_id) = original_agent_id {
        let existing: Option<(String,)> = sqlx::query_as(
            "SELECT id FROM shared_agents WHERE user_id = ? AND original_agent_id = ?",
        )
        .bind(user_id)
        .bind(orig_id)
        .fetch_optional(pool)
        .await?;

        if let Some((existing_id,)) = existing {
            sqlx::query(
                "UPDATE shared_agents SET name = ?, description = ?, persona_json = ?, updated_at = datetime('now') WHERE id = ?",
            )
            .bind(name)
            .bind(description)
            .bind(persona_json)
            .bind(&existing_id)
            .execute(pool)
            .await?;
            return Ok(existing_id);
        }
    }

    sqlx::query(
        "INSERT INTO shared_agents (id, user_id, name, description, original_agent_id, persona_json) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user_id)
    .bind(name)
    .bind(description)
    .bind(original_agent_id)
    .bind(persona_json)
    .execute(pool)
    .await?;
    Ok(id.to_string())
}

pub async fn list_shared_agents(
    pool: &SqlitePool,
    query: Option<&str>,
    user_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<(Vec<SharedAgentRow>, u64), sqlx::Error> {
    let pattern = query.filter(|q| !q.is_empty()).map(|q| format!("%{q}%"));

    let mut conditions = Vec::new();
    if pattern.is_some() {
        conditions.push("(sa.name LIKE ? OR sa.description LIKE ? OR u.display_name LIKE ?)");
    }
    if user_id.is_some() {
        conditions.push("sa.user_id = ?");
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM shared_agents sa JOIN users u ON u.id = sa.user_id {where_clause}"
    );
    let mut count_q = sqlx::query_as(&count_sql);
    if let Some(ref p) = pattern {
        count_q = count_q.bind(p).bind(p).bind(p);
    }
    if let Some(uid) = user_id {
        count_q = count_q.bind(uid);
    }
    let total: (i64,) = count_q.fetch_one(pool).await?;

    let list_sql = format!(
        r#"
        SELECT sa.id, sa.user_id, u.display_name, sa.name, sa.description,
               sa.original_agent_id, sa.persona_json, sa.created_at, sa.updated_at,
               (SELECT COUNT(*) FROM shared_skills WHERE agent_id = sa.id) as skills_count,
               (SELECT COUNT(*) FROM shared_notes WHERE agent_id = sa.id) as notes_count
        FROM shared_agents sa
        JOIN users u ON u.id = sa.user_id
        {where_clause}
        ORDER BY sa.updated_at DESC
        LIMIT ? OFFSET ?
        "#
    );
    let mut list_q = sqlx::query_as(&list_sql);
    if let Some(ref p) = pattern {
        list_q = list_q.bind(p).bind(p).bind(p);
    }
    if let Some(uid) = user_id {
        list_q = list_q.bind(uid);
    }
    list_q = list_q.bind(limit).bind(offset);
    let rows: Vec<SharedAgentRow> = list_q.fetch_all(pool).await?;

    Ok((rows, total.0 as u64))
}

pub async fn get_shared_agent(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<SharedAgentRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sa.id, sa.user_id, u.display_name, sa.name, sa.description,
               sa.original_agent_id, sa.persona_json, sa.created_at, sa.updated_at,
               (SELECT COUNT(*) FROM shared_skills WHERE agent_id = sa.id) as skills_count,
               (SELECT COUNT(*) FROM shared_notes WHERE agent_id = sa.id) as notes_count
        FROM shared_agents sa
        JOIN users u ON u.id = sa.user_id
        WHERE sa.id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn list_agents_by_user(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<SharedAgentRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sa.id, sa.user_id, u.display_name, sa.name, sa.description,
               sa.original_agent_id, sa.persona_json, sa.created_at, sa.updated_at,
               (SELECT COUNT(*) FROM shared_skills WHERE agent_id = sa.id) as skills_count,
               (SELECT COUNT(*) FROM shared_notes WHERE agent_id = sa.id) as notes_count
        FROM shared_agents sa
        JOIN users u ON u.id = sa.user_id
        WHERE sa.user_id = ?
        ORDER BY sa.updated_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn delete_shared_agent(pool: &SqlitePool, id: &str, user_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM shared_agents WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Shared skills ──

#[derive(Debug, sqlx::FromRow)]
pub struct SharedSkillRow {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub skill_name: String,
    pub description: String,
    pub body: String,
    pub created_at: String,
}

pub async fn create_shared_skill(
    pool: &SqlitePool,
    id: &str,
    user_id: &str,
    agent_id: Option<&str>,
    skill_name: &str,
    description: &str,
    body: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO shared_skills (id, user_id, agent_id, skill_name, description, body) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user_id)
    .bind(agent_id)
    .bind(skill_name)
    .bind(description)
    .bind(body)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_shared_skills(
    pool: &SqlitePool,
    query: Option<&str>,
    agent_id: Option<&str>,
    user_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<(Vec<SharedSkillRow>, u64), sqlx::Error> {
    let pattern = query.filter(|q| !q.is_empty()).map(|q| format!("%{q}%"));

    let mut conditions = Vec::new();
    if pattern.is_some() {
        conditions.push("(ss.skill_name LIKE ? OR ss.description LIKE ?)");
    }
    if agent_id.is_some() {
        conditions.push("ss.agent_id = ?");
    }
    if user_id.is_some() {
        conditions.push("ss.user_id = ?");
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM shared_skills ss JOIN users u ON u.id = ss.user_id {where_clause}"
    );
    let mut count_q = sqlx::query_as(&count_sql);
    if let Some(ref p) = pattern {
        count_q = count_q.bind(p).bind(p);
    }
    if let Some(aid) = agent_id {
        count_q = count_q.bind(aid);
    }
    if let Some(uid) = user_id {
        count_q = count_q.bind(uid);
    }
    let total: (i64,) = count_q.fetch_one(pool).await?;

    let list_sql = format!(
        r#"
        SELECT ss.id, ss.user_id, u.display_name, ss.agent_id,
               sa.name as agent_name, ss.skill_name, ss.description, ss.body, ss.created_at
        FROM shared_skills ss
        JOIN users u ON u.id = ss.user_id
        LEFT JOIN shared_agents sa ON sa.id = ss.agent_id
        {where_clause}
        ORDER BY ss.created_at DESC
        LIMIT ? OFFSET ?
        "#
    );
    let mut list_q = sqlx::query_as(&list_sql);
    if let Some(ref p) = pattern {
        list_q = list_q.bind(p).bind(p);
    }
    if let Some(aid) = agent_id {
        list_q = list_q.bind(aid);
    }
    if let Some(uid) = user_id {
        list_q = list_q.bind(uid);
    }
    list_q = list_q.bind(limit).bind(offset);
    let rows: Vec<SharedSkillRow> = list_q.fetch_all(pool).await?;

    Ok((rows, total.0 as u64))
}

pub async fn get_shared_skill(pool: &SqlitePool, id: &str) -> Result<Option<SharedSkillRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT ss.id, ss.user_id, u.display_name, ss.agent_id,
               sa.name as agent_name, ss.skill_name, ss.description, ss.body, ss.created_at
        FROM shared_skills ss
        JOIN users u ON u.id = ss.user_id
        LEFT JOIN shared_agents sa ON sa.id = ss.agent_id
        WHERE ss.id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_shared_skill(pool: &SqlitePool, id: &str, user_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM shared_skills WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

// ── Shared notes ──

#[derive(Debug, sqlx::FromRow)]
pub struct SharedNoteRow {
    pub id: String,
    pub user_id: String,
    pub display_name: String,
    pub agent_id: Option<String>,
    pub agent_name: Option<String>,
    pub title: String,
    pub note_type: String,
    pub tags_json: String,
    pub body: String,
    pub created_at: String,
}

pub async fn create_shared_note(
    pool: &SqlitePool,
    id: &str,
    user_id: &str,
    agent_id: Option<&str>,
    title: &str,
    note_type: &str,
    tags_json: &str,
    body: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO shared_notes (id, user_id, agent_id, title, note_type, tags_json, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user_id)
    .bind(agent_id)
    .bind(title)
    .bind(note_type)
    .bind(tags_json)
    .bind(body)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_shared_notes(
    pool: &SqlitePool,
    query: Option<&str>,
    agent_id: Option<&str>,
    user_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> Result<(Vec<SharedNoteRow>, u64), sqlx::Error> {
    let pattern = query.filter(|q| !q.is_empty()).map(|q| format!("%{q}%"));

    let mut conditions = Vec::new();
    if pattern.is_some() {
        conditions.push("(sn.title LIKE ? OR sn.body LIKE ?)");
    }
    if agent_id.is_some() {
        conditions.push("sn.agent_id = ?");
    }
    if user_id.is_some() {
        conditions.push("sn.user_id = ?");
    }
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM shared_notes sn JOIN users u ON u.id = sn.user_id {where_clause}"
    );
    let mut count_q = sqlx::query_as(&count_sql);
    if let Some(ref p) = pattern {
        count_q = count_q.bind(p).bind(p);
    }
    if let Some(aid) = agent_id {
        count_q = count_q.bind(aid);
    }
    if let Some(uid) = user_id {
        count_q = count_q.bind(uid);
    }
    let total: (i64,) = count_q.fetch_one(pool).await?;

    let list_sql = format!(
        r#"
        SELECT sn.id, sn.user_id, u.display_name, sn.agent_id,
               sa.name as agent_name, sn.title, sn.note_type, sn.tags_json, sn.body, sn.created_at
        FROM shared_notes sn
        JOIN users u ON u.id = sn.user_id
        LEFT JOIN shared_agents sa ON sa.id = sn.agent_id
        {where_clause}
        ORDER BY sn.created_at DESC
        LIMIT ? OFFSET ?
        "#
    );
    let mut list_q = sqlx::query_as(&list_sql);
    if let Some(ref p) = pattern {
        list_q = list_q.bind(p).bind(p);
    }
    if let Some(aid) = agent_id {
        list_q = list_q.bind(aid);
    }
    if let Some(uid) = user_id {
        list_q = list_q.bind(uid);
    }
    list_q = list_q.bind(limit).bind(offset);
    let rows: Vec<SharedNoteRow> = list_q.fetch_all(pool).await?;

    Ok((rows, total.0 as u64))
}

pub async fn get_shared_note(pool: &SqlitePool, id: &str) -> Result<Option<SharedNoteRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sn.id, sn.user_id, u.display_name, sn.agent_id,
               sa.name as agent_name, sn.title, sn.note_type, sn.tags_json, sn.body, sn.created_at
        FROM shared_notes sn
        JOIN users u ON u.id = sn.user_id
        LEFT JOIN shared_agents sa ON sa.id = sn.agent_id
        WHERE sn.id = ?
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub async fn delete_shared_note(pool: &SqlitePool, id: &str, user_id: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM shared_notes WHERE id = ? AND user_id = ?")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

/// Get skills belonging to a specific agent.
pub async fn get_skills_by_agent(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<Vec<SharedSkillRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT ss.id, ss.user_id, u.display_name, ss.agent_id,
               sa.name as agent_name, ss.skill_name, ss.description, ss.body, ss.created_at
        FROM shared_skills ss
        JOIN users u ON u.id = ss.user_id
        LEFT JOIN shared_agents sa ON sa.id = ss.agent_id
        WHERE ss.agent_id = ?
        ORDER BY ss.skill_name ASC
        "#,
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
}

/// Get notes belonging to a specific agent.
pub async fn get_notes_by_agent(
    pool: &SqlitePool,
    agent_id: &str,
) -> Result<Vec<SharedNoteRow>, sqlx::Error> {
    sqlx::query_as(
        r#"
        SELECT sn.id, sn.user_id, u.display_name, sn.agent_id,
               sa.name as agent_name, sn.title, sn.note_type, sn.tags_json, sn.body, sn.created_at
        FROM shared_notes sn
        JOIN users u ON u.id = sn.user_id
        LEFT JOIN shared_agents sa ON sa.id = sn.agent_id
        WHERE sn.agent_id = ?
        ORDER BY sn.created_at DESC
        "#,
    )
    .bind(agent_id)
    .fetch_all(pool)
    .await
}
