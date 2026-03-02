use rusqlite::Connection;

/// Check if an agent has permission for a specific action.
/// Returns the permission level: "none", "ask", or "auto".
/// If no permission is configured, defaults to "auto" so that
/// tools work out-of-the-box on fresh installs. Users can
/// explicitly restrict permissions via the UI.
pub fn check_permission(
    conn: &Connection,
    agent_id: &str,
    permission_type: &str,
) -> Result<String, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT level FROM permissions WHERE agent_id = ?1 AND permission_type = ?2",
    )?;
    let result: Option<String> = stmt
        .query_row(rusqlite::params![agent_id, permission_type], |row| {
            row.get(0)
        })
        .ok();

    Ok(result.unwrap_or_else(|| "auto".to_string()))
}
