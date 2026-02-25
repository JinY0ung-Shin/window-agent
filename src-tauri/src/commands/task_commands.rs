use crate::db::models::{self, Task};
use crate::AppState;
use chrono::Utc;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct CreateTaskRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub assignee: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: String,
    pub parent_task_id: Option<String>,
    pub creator: Option<String>,
}

fn default_priority() -> String {
    "medium".to_string()
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub assignee: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub parent_task_id: Option<String>,
}

#[tauri::command]
pub fn create_task(
    state: State<AppState>,
    request: CreateTaskRequest,
) -> Result<Task, String> {
    let now = Utc::now().to_rfc3339();
    let task = Task {
        id: models::new_id(),
        title: request.title,
        description: request.description,
        assignee: request.assignee,
        status: "pending".to_string(),
        priority: request.priority,
        created_at: now.clone(),
        completed_at: None,
        updated_at: Some(now),
        parent_task_id: request.parent_task_id,
        creator: request.creator,
    };
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::insert_task(&conn, &task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub fn update_task(
    state: State<AppState>,
    task_id: String,
    request: UpdateTaskRequest,
) -> Result<Task, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;

    let mut task = models::get_task_by_id(&conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Task not found: {}", task_id))?;

    if let Some(title) = request.title { task.title = title; }
    if let Some(description) = request.description { task.description = description; }
    if let Some(assignee) = request.assignee { task.assignee = Some(assignee); }
    if let Some(status) = request.status { task.status = status; }
    if let Some(priority) = request.priority { task.priority = priority; }
    if let Some(parent_task_id) = request.parent_task_id { task.parent_task_id = Some(parent_task_id); }

    if task.status == "completed" || task.status == "failed" {
        task.completed_at = Some(Utc::now().to_rfc3339());
    }

    models::update_task(&conn, &task).map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub fn delete_task(
    state: State<AppState>,
    task_id: String,
) -> Result<bool, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::delete_task(&conn, &task_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_all_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_all_tasks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_tasks_by_status(
    state: State<AppState>,
    status: String,
) -> Result<Vec<Task>, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::get_tasks_by_status(&conn, &status).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task_status_cmd(
    state: State<AppState>,
    task_id: String,
    status: String,
) -> Result<Task, String> {
    let conn = state.db.conn.lock().map_err(|e| e.to_string())?;
    models::update_task_status(&conn, &task_id, &status).map_err(|e| e.to_string())?;
    models::get_task_by_id(&conn, &task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Task not found: {}", task_id))
}
