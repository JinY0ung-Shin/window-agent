use crate::db::error::DbError;
use crate::db::Database;
use serde::Serialize;

// ── Row types ──

#[derive(Debug, Clone, Serialize)]
pub struct ContactRow {
    pub id: String,
    pub peer_id: String,
    pub public_key: String,
    pub display_name: String,
    pub agent_name: String,
    pub agent_description: String,
    pub local_agent_id: Option<String>,
    pub mode: String,
    pub capabilities_json: String,
    pub status: String,
    pub invite_card_raw: Option<String>,
    pub addresses_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default)]
pub struct ContactUpdate {
    pub display_name: Option<String>,
    pub agent_name: Option<String>,
    pub agent_description: Option<String>,
    pub local_agent_id: Option<Option<String>>,
    pub mode: Option<String>,
    pub capabilities_json: Option<String>,
    pub status: Option<String>,
    pub addresses_json: Option<Option<String>>,
}

// ── Contact operations ──

pub fn insert_contact(db: &Database, contact: &ContactRow) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO contacts (id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            rusqlite::params![
                contact.id,
                contact.peer_id,
                contact.public_key,
                contact.display_name,
                contact.agent_name,
                contact.agent_description,
                contact.local_agent_id,
                contact.mode,
                contact.capabilities_json,
                contact.status,
                contact.invite_card_raw,
                contact.addresses_json,
                contact.created_at,
                contact.updated_at,
            ],
        )?;
        Ok(())
    })
}

pub fn get_contact(db: &Database, id: &str) -> Result<Option<ContactRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at
             FROM contacts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![id], map_contact_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

pub fn get_contact_by_peer_id(
    db: &Database,
    peer_id: &str,
) -> Result<Option<ContactRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at
             FROM contacts WHERE peer_id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![peer_id], map_contact_row)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    })
}

pub fn list_contacts(db: &Database) -> Result<Vec<ContactRow>, DbError> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, peer_id, public_key, display_name, agent_name, agent_description, local_agent_id, mode, capabilities_json, status, invite_card_raw, addresses_json, created_at, updated_at
             FROM contacts ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], map_contact_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    })
}

pub fn update_contact(
    db: &Database,
    id: &str,
    updates: ContactUpdate,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        let mut sets: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(ref v) = updates.display_name {
            sets.push(format!("display_name = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.agent_name {
            sets.push(format!("agent_name = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.agent_description {
            sets.push(format!("agent_description = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.local_agent_id {
            sets.push(format!("local_agent_id = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.mode {
            sets.push(format!("mode = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.capabilities_json {
            sets.push(format!("capabilities_json = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.status {
            sets.push(format!("status = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }
        if let Some(ref v) = updates.addresses_json {
            sets.push(format!("addresses_json = ?{}", params.len() + 1));
            params.push(Box::new(v.clone()));
        }

        if sets.is_empty() {
            return Ok(());
        }

        sets.push("updated_at = datetime('now')".to_string());
        let id_param_idx = params.len() + 1;
        params.push(Box::new(id.to_string()));

        let sql = format!(
            "UPDATE contacts SET {} WHERE id = ?{}",
            sets.join(", "),
            id_param_idx
        );
        conn.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))?;
        Ok(())
    })
}

pub fn delete_contact(db: &Database, id: &str) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM contacts WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    })
}

/// contacts 테이블의 invite_card_raw, public_key 컬럼을 직접 업데이트
pub fn update_contact_invite_and_key(
    db: &Database,
    contact_id: &str,
    invite_card_raw: &str,
    public_key: &str,
) -> Result<(), DbError> {
    db.with_conn(|conn| {
        conn.execute(
            "UPDATE contacts SET invite_card_raw = ?1, public_key = ?2 WHERE id = ?3",
            rusqlite::params![invite_card_raw, public_key, contact_id],
        )?;
        Ok(())
    })
}

fn map_contact_row(row: &rusqlite::Row) -> Result<ContactRow, rusqlite::Error> {
    Ok(ContactRow {
        id: row.get(0)?,
        peer_id: row.get(1)?,
        public_key: row.get(2)?,
        display_name: row.get(3)?,
        agent_name: row.get(4)?,
        agent_description: row.get(5)?,
        local_agent_id: row.get(6)?,
        mode: row.get(7)?,
        capabilities_json: row.get(8)?,
        status: row.get(9)?,
        invite_card_raw: row.get(10)?,
        addresses_json: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}
