use crate::db::models;
use crate::AppState;
use chrono::Utc;
use rusqlite;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn evaluate_agent(
    state: State<AppState>,
    agent_id: String,
    period: String,
) -> Result<models::Evaluation, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;

    // Get task counts for this agent
    let mut stmt = conn
        .prepare(
            "SELECT status, COUNT(*) FROM tasks
             WHERE assignee = ?1
             GROUP BY status",
        )
        .map_err(|e| e.to_string())?;

    let mut completed = 0i32;
    let mut failed = 0i32;
    let mut total = 0i32;

    let rows = stmt
        .query_map(rusqlite::params![agent_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (status, count) = row.map_err(|e| e.to_string())?;
        total += count;
        match status.as_str() {
            "completed" => completed = count,
            "failed" => failed = count,
            _ => {}
        }
    }

    let success_rate = if total > 0 {
        completed as f64 / total as f64
    } else {
        0.0
    };

    // Calculate average completion time from completed tasks
    let avg_time: f64 = conn
        .query_row(
            "SELECT COALESCE(AVG(
                (julianday(completed_at) - julianday(created_at)) * 86400
             ), 0.0)
             FROM tasks
             WHERE assignee = ?1 AND status = 'completed' AND completed_at IS NOT NULL",
            rusqlite::params![agent_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    // Speed score: faster = higher. Baseline: 3600s (1hr) = 100, scale inversely
    let speed_score = if avg_time > 0.0 {
        (3600.0 / avg_time).min(1.0)
    } else {
        0.5 // neutral if no data
    };

    let score = (success_rate * 0.6 + speed_score * 0.4) * 100.0;

    let notes = format!(
        "Period: {}. Tasks: {} total, {} completed, {} failed. Success rate: {:.1}%. Avg completion time: {:.0}s. Score: {:.1}",
        period, total, completed, failed, success_rate * 100.0, avg_time, score
    );

    let now = Utc::now().to_rfc3339();
    let evaluation = models::Evaluation {
        id: models::new_id(),
        agent_id,
        period,
        task_success_rate: success_rate * 100.0,
        avg_completion_time_secs: avg_time,
        total_tasks: total,
        completed_tasks: completed,
        failed_tasks: failed,
        total_cost_usd: 0.0,
        score,
        evaluation_notes: notes,
        created_at: now,
    };

    models::insert_evaluation(&conn, &evaluation).map_err(|e| e.to_string())?;
    Ok(evaluation)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_evaluations(
    state: State<AppState>,
    agent_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<models::Evaluation>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_evaluations(&conn, agent_id.as_deref(), limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_agent_performance_summary(
    state: State<AppState>,
    agent_id: String,
) -> Result<models::PerformanceSummary, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_agent_performance_summary(&conn, &agent_id).map_err(|e| e.to_string())
}
