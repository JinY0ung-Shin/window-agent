use super::error::DbError;
use super::models::{Agent, CreateAgentRequest, UpdateAgentRequest};
use super::Database;
use chrono::Utc;
use uuid::Uuid;

const AGENT_COLUMNS: &str = "SELECT id, folder_name, name, avatar, description, model, temperature, thinking_enabled, thinking_budget, is_default, sort_order, created_at, updated_at FROM agents";

pub fn create_agent_impl(
    db: &Database,
    request: CreateAgentRequest,
) -> Result<Agent, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let now = Utc::now().to_rfc3339();
    let agent = Agent {
        id: Uuid::new_v4().to_string(),
        folder_name: request.folder_name,
        name: request.name,
        avatar: request.avatar,
        description: request.description.unwrap_or_default(),
        model: request.model,
        temperature: request.temperature,
        thinking_enabled: request.thinking_enabled,
        thinking_budget: request.thinking_budget,
        is_default: request.is_default.unwrap_or(false),
        sort_order: request.sort_order.unwrap_or(0),
        created_at: now.clone(),
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO agents (id, folder_name, name, avatar, description, model, temperature, thinking_enabled, thinking_budget, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            agent.id,
            agent.folder_name,
            agent.name,
            agent.avatar,
            agent.description,
            agent.model,
            agent.temperature,
            agent.thinking_enabled.map(|b| b as i64),
            agent.thinking_budget,
            agent.is_default as i64,
            agent.sort_order,
            agent.created_at,
            agent.updated_at,
        ],
    )?;

    Ok(agent)
}

pub fn get_agent_impl(db: &Database, id: String) -> Result<Agent, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let agent = conn.query_row(
        &format!("{AGENT_COLUMNS} WHERE id = ?1"),
        rusqlite::params![id],
        |row| row_to_agent(row),
    )?;
    Ok(agent)
}

pub fn get_agent_by_folder_impl(
    db: &Database,
    folder_name: String,
) -> Result<Option<Agent>, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let mut stmt = conn.prepare(
        &format!("{AGENT_COLUMNS} WHERE folder_name = ?1"),
    )?;
    let mut rows = stmt.query(rusqlite::params![folder_name])?;
    match rows.next()? {
        Some(row) => Ok(Some(row_to_agent(row)?)),
        None => Ok(None),
    }
}

pub fn list_agents_impl(db: &Database) -> Result<Vec<Agent>, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let mut stmt = conn.prepare(
        &format!("{AGENT_COLUMNS} ORDER BY sort_order ASC, created_at ASC"),
    )?;

    let rows = stmt.query_map([], |row| row_to_agent(row))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn update_agent_impl(
    db: &Database,
    id: String,
    request: UpdateAgentRequest,
) -> Result<Agent, DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;
    let now = Utc::now().to_rfc3339();

    let current = conn.query_row(
        &format!("{AGENT_COLUMNS} WHERE id = ?1"),
        rusqlite::params![id],
        |row| row_to_agent(row),
    )?;

    let name = request.name.unwrap_or(current.name);
    let avatar = request.avatar.unwrap_or(current.avatar);
    let description = request.description.unwrap_or(current.description);
    let model = request.model.unwrap_or(current.model);
    let temperature = request.temperature.unwrap_or(current.temperature);
    let thinking_enabled = request.thinking_enabled.unwrap_or(current.thinking_enabled);
    let thinking_budget = request.thinking_budget.unwrap_or(current.thinking_budget);
    let sort_order = request.sort_order.unwrap_or(current.sort_order);

    conn.execute(
        "UPDATE agents SET name = ?1, avatar = ?2, description = ?3, model = ?4, temperature = ?5, thinking_enabled = ?6, thinking_budget = ?7, sort_order = ?8, updated_at = ?9 WHERE id = ?10",
        rusqlite::params![
            name,
            avatar,
            description,
            model,
            temperature,
            thinking_enabled.map(|b| b as i64),
            thinking_budget,
            sort_order,
            now,
            id,
        ],
    )?;

    // Re-read updated agent
    let updated = conn.query_row(
        &format!("{AGENT_COLUMNS} WHERE id = ?1"),
        rusqlite::params![id],
        |row| row_to_agent(row),
    )?;
    Ok(updated)
}

pub fn delete_agent_impl(db: &Database, id: String) -> Result<(), DbError> {
    let conn = db.conn.lock().map_err(|_| DbError::Lock)?;

    // Prevent deleting the default (manager) agent
    let is_default: bool = conn.query_row(
        "SELECT is_default FROM agents WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let val: i64 = row.get(0)?;
            Ok(val != 0)
        },
    )?;

    if is_default {
        return Err(DbError::Sqlite(
            "Cannot delete the default (manager) agent".to_string(),
        ));
    }

    conn.execute("DELETE FROM agents WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

fn row_to_agent(row: &rusqlite::Row) -> Result<Agent, rusqlite::Error> {
    let thinking_enabled_raw: Option<i64> = row.get(7)?;
    let is_default_raw: i64 = row.get(9)?;
    Ok(Agent {
        id: row.get(0)?,
        folder_name: row.get(1)?,
        name: row.get(2)?,
        avatar: row.get(3)?,
        description: row.get(4)?,
        model: row.get(5)?,
        temperature: row.get(6)?,
        thinking_enabled: thinking_enabled_raw.map(|v| v != 0),
        thinking_budget: row.get(8)?,
        is_default: is_default_raw != 0,
        sort_order: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Database {
        Database::new_in_memory().expect("failed to create in-memory db")
    }

    fn default_create_request(folder: &str, name: &str) -> CreateAgentRequest {
        CreateAgentRequest {
            folder_name: folder.into(),
            name: name.into(),
            avatar: None,
            description: None,
            model: None,
            temperature: None,
            thinking_enabled: None,
            thinking_budget: None,
            is_default: None,
            sort_order: None,
        }
    }

    #[test]
    fn test_create_agent() {
        let db = setup_db();
        let agent = create_agent_impl(&db, default_create_request("test", "Test Agent")).unwrap();
        assert_eq!(agent.name, "Test Agent");
        assert_eq!(agent.folder_name, "test");
        assert!(!agent.is_default);
        assert_eq!(agent.sort_order, 0);
    }

    #[test]
    fn test_create_agent_with_all_fields() {
        let db = setup_db();
        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                folder_name: "coder".into(),
                name: "Coder".into(),
                avatar: Some("base64data".into()),
                description: Some("A coding agent".into()),
                model: Some("gpt-4".into()),
                temperature: Some(0.7),
                thinking_enabled: Some(true),
                thinking_budget: Some(10000),
                is_default: Some(true),
                sort_order: Some(1),
            },
        )
        .unwrap();

        assert_eq!(agent.avatar, Some("base64data".to_string()));
        assert_eq!(agent.description, "A coding agent");
        assert_eq!(agent.model, Some("gpt-4".to_string()));
        assert_eq!(agent.temperature, Some(0.7));
        assert_eq!(agent.thinking_enabled, Some(true));
        assert_eq!(agent.thinking_budget, Some(10000));
        assert!(agent.is_default);
        assert_eq!(agent.sort_order, 1);
    }

    #[test]
    fn test_create_agent_duplicate_folder() {
        let db = setup_db();
        create_agent_impl(&db, default_create_request("test", "Agent 1")).unwrap();
        let result = create_agent_impl(&db, default_create_request("test", "Agent 2"));
        assert!(result.is_err());
    }

    #[test]
    fn test_get_agent() {
        let db = setup_db();
        let created = create_agent_impl(&db, default_create_request("test", "Test")).unwrap();
        let fetched = get_agent_impl(&db, created.id.clone()).unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.name, "Test");
    }

    #[test]
    fn test_get_agent_not_found() {
        let db = setup_db();
        let result = get_agent_impl(&db, "nonexistent".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_get_agent_by_folder() {
        let db = setup_db();
        create_agent_impl(&db, default_create_request("my-folder", "Agent")).unwrap();
        let found = get_agent_by_folder_impl(&db, "my-folder".into()).unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().folder_name, "my-folder");

        let not_found = get_agent_by_folder_impl(&db, "nope".into()).unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_list_agents_ordered() {
        let db = setup_db();
        create_agent_impl(
            &db,
            CreateAgentRequest {
                sort_order: Some(2),
                ..default_create_request("b", "B")
            },
        )
        .unwrap();
        create_agent_impl(
            &db,
            CreateAgentRequest {
                sort_order: Some(1),
                ..default_create_request("a", "A")
            },
        )
        .unwrap();

        let agents = list_agents_impl(&db).unwrap();
        assert_eq!(agents.len(), 2);
        assert_eq!(agents[0].name, "A"); // sort_order 1 first
        assert_eq!(agents[1].name, "B");
    }

    #[test]
    fn test_update_agent() {
        let db = setup_db();
        let agent = create_agent_impl(&db, default_create_request("test", "Original")).unwrap();

        let updated = update_agent_impl(
            &db,
            agent.id.clone(),
            UpdateAgentRequest {
                name: Some("Updated".into()),
                avatar: None,
                description: Some("New desc".into()),
                model: Some(Some("gpt-4o".into())),
                temperature: Some(Some(0.5)),
                thinking_enabled: Some(Some(true)),
                thinking_budget: Some(Some(5000)),
                sort_order: None,
            },
        )
        .unwrap();

        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.description, "New desc");
        assert_eq!(updated.model, Some("gpt-4o".to_string()));
        assert_eq!(updated.temperature, Some(0.5));
        assert_eq!(updated.thinking_enabled, Some(true));
        assert_eq!(updated.thinking_budget, Some(5000));
    }

    #[test]
    fn test_update_agent_partial() {
        let db = setup_db();
        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                description: Some("Original desc".into()),
                ..default_create_request("test", "Original")
            },
        )
        .unwrap();

        let updated = update_agent_impl(
            &db,
            agent.id,
            UpdateAgentRequest {
                name: Some("New Name".into()),
                avatar: None,
                description: None,
                model: None,
                temperature: None,
                thinking_enabled: None,
                thinking_budget: None,
                sort_order: None,
            },
        )
        .unwrap();

        assert_eq!(updated.name, "New Name");
        assert_eq!(updated.description, "Original desc"); // preserved
    }

    #[test]
    fn test_delete_agent() {
        let db = setup_db();
        let agent = create_agent_impl(&db, default_create_request("test", "Test")).unwrap();
        delete_agent_impl(&db, agent.id).unwrap();
        let agents = list_agents_impl(&db).unwrap();
        assert!(agents.is_empty());
    }

    #[test]
    fn test_delete_default_agent_fails() {
        let db = setup_db();
        let agent = create_agent_impl(
            &db,
            CreateAgentRequest {
                is_default: Some(true),
                ..default_create_request("manager", "Manager")
            },
        )
        .unwrap();

        let result = delete_agent_impl(&db, agent.id);
        assert!(result.is_err());
    }

    #[test]
    fn test_delete_agent_cascades_conversations() {
        let db = setup_db();
        let agent = create_agent_impl(&db, default_create_request("test", "Test")).unwrap();

        // Create a conversation tied to this agent
        use super::super::operations::create_conversation_impl;
        let conv = create_conversation_impl(&db, Some("Chat".into()), agent.id.clone()).unwrap();

        delete_agent_impl(&db, agent.id).unwrap();

        // Verify conversation is also deleted
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversations WHERE id = ?1",
                rusqlite::params![conv.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
