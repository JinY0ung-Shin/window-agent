use crate::db::models;
use crate::AppState;
use tauri::State;

#[tauri::command(rename_all = "snake_case")]
pub fn record_cost(
    state: State<AppState>,
    agent_id: String,
    model: String,
    tokens_input: i64,
    tokens_output: i64,
    cost_usd: f64,
    tool_execution_id: Option<String>,
) -> Result<models::CostRecord, String> {
    let record = models::CostRecord {
        id: models::new_id(),
        agent_id,
        tool_execution_id,
        model,
        tokens_input,
        tokens_output,
        cost_usd,
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::insert_cost_record(&conn, &record).map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_cost_summary(
    state: State<AppState>,
    period_start: Option<String>,
    period_end: Option<String>,
) -> Result<models::CostSummary, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_cost_summary(
        &conn,
        period_start.as_deref(),
        period_end.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_agent_cost_history(
    state: State<AppState>,
    agent_id: String,
    limit: Option<i64>,
) -> Result<Vec<models::CostRecord>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_agent_cost_history(&conn, &agent_id, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_cost_trend(
    state: State<AppState>,
    days: Option<i64>,
) -> Result<Vec<models::DailyCost>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_cost_trend(&conn, days.unwrap_or(30))
        .map_err(|e| e.to_string())
}
