use crate::db::models;
use crate::AppState;
use chrono::Utc;
use rusqlite;
use tauri::State;

#[tauri::command]
pub fn generate_report(
    state: State<AppState>,
    report_type: String,
    period_start: String,
    period_end: String,
) -> Result<models::Report, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;

    // Gather task stats for the period
    let mut stmt = conn
        .prepare(
            "SELECT status, COUNT(*) FROM tasks
             WHERE created_at >= ?1 AND created_at <= ?2
             GROUP BY status",
        )
        .map_err(|e| e.to_string())?;

    let mut completed = 0i64;
    let mut failed = 0i64;
    let mut pending = 0i64;
    let mut in_progress = 0i64;

    let rows = stmt
        .query_map(rusqlite::params![period_start, period_end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (status, count) = row.map_err(|e| e.to_string())?;
        match status.as_str() {
            "completed" => completed = count,
            "failed" => failed = count,
            "pending" => pending = count,
            "in_progress" => in_progress = count,
            _ => {}
        }
    }

    let total_tasks = completed + failed + pending + in_progress;

    // Per-agent stats
    let mut agent_stmt = conn
        .prepare(
            "SELECT a.name, t.status, COUNT(*)
             FROM tasks t
             JOIN agents a ON t.assignee = a.id
             WHERE t.created_at >= ?1 AND t.created_at <= ?2
             GROUP BY a.name, t.status
             ORDER BY a.name",
        )
        .map_err(|e| e.to_string())?;

    let agent_rows = agent_stmt
        .query_map(rusqlite::params![period_start, period_end], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut agent_lines: Vec<String> = Vec::new();
    let mut current_agent = String::new();
    let mut agent_completed = 0i64;
    let mut agent_failed = 0i64;
    let mut agent_total = 0i64;

    let flush_agent =
        |name: &str, total: i64, comp: i64, fail: i64, lines: &mut Vec<String>| {
            if !name.is_empty() {
                let rate = if total > 0 {
                    (comp as f64 / total as f64 * 100.0) as i64
                } else {
                    0
                };
                lines.push(format!(
                    "  - {}: {} tasks (completed: {}, failed: {}, success rate: {}%)",
                    name, total, comp, fail, rate
                ));
            }
        };

    for row in agent_rows {
        let (name, status, count) = row.map_err(|e| e.to_string())?;
        if name != current_agent {
            flush_agent(
                &current_agent,
                agent_total,
                agent_completed,
                agent_failed,
                &mut agent_lines,
            );
            current_agent = name;
            agent_completed = 0;
            agent_failed = 0;
            agent_total = 0;
        }
        agent_total += count;
        match status.as_str() {
            "completed" => agent_completed = count,
            "failed" => agent_failed = count,
            _ => {}
        }
    }
    flush_agent(
        &current_agent,
        agent_total,
        agent_completed,
        agent_failed,
        &mut agent_lines,
    );

    // Tool execution stats
    let mut tool_stmt = conn
        .prepare(
            "SELECT status, COUNT(*) FROM tool_executions
             WHERE timestamp >= ?1 AND timestamp <= ?2
             GROUP BY status",
        )
        .map_err(|e| e.to_string())?;

    let mut tool_success = 0i64;
    let mut tool_error = 0i64;
    let mut tool_total = 0i64;

    let tool_rows = tool_stmt
        .query_map(rusqlite::params![period_start, period_end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for row in tool_rows {
        let (status, count) = row.map_err(|e| e.to_string())?;
        tool_total += count;
        match status.as_str() {
            "success" => tool_success = count,
            "error" => tool_error = count,
            _ => {}
        }
    }

    let tool_rate = if tool_total > 0 {
        (tool_success as f64 / tool_total as f64 * 100.0) as i64
    } else {
        0
    };

    // Build markdown content
    let type_label = match report_type.as_str() {
        "daily" => "Daily",
        "weekly" => "Weekly",
        "monthly" => "Monthly",
        _ => "Custom",
    };

    let title = format!(
        "{} Report ({} ~ {})",
        type_label, period_start, period_end
    );

    let agent_section = if agent_lines.is_empty() {
        "  No agent activity in this period.".to_string()
    } else {
        agent_lines.join("\n")
    };

    let content = format!(
        "# {}\n\n## Task Summary\n- Total: {}\n- Completed: {}\n- Failed: {}\n- In Progress: {}\n- Pending: {}\n\n## Agent Performance\n{}\n\n## Tool Executions\n- Total: {}\n- Success: {} ({}%)\n- Error: {}\n",
        title, total_tasks, completed, failed, in_progress, pending,
        agent_section,
        tool_total, tool_success, tool_rate, tool_error
    );

    let now = Utc::now().to_rfc3339();
    let report = models::Report {
        id: models::new_id(),
        report_type,
        title,
        content,
        generated_at: now,
        period_start,
        period_end,
        metadata: "{}".to_string(),
    };

    models::insert_report(&conn, &report).map_err(|e| e.to_string())?;
    Ok(report)
}

#[tauri::command]
pub fn get_reports(
    state: State<AppState>,
    report_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<models::Report>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_reports(&conn, report_type.as_deref(), limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_report_by_id(
    state: State<AppState>,
    report_id: String,
) -> Result<models::Report, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_report_by_id(&conn, &report_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Report not found: {}", report_id))
}

#[tauri::command]
pub fn delete_report(
    state: State<AppState>,
    report_id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::delete_report(&conn, &report_id).map_err(|e| e.to_string())
}
