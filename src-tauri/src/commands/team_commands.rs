use crate::api::RunRegistry;
use crate::db::models::{
    CreateTeamRequest, Team, TeamDetail, TeamMember, TeamRun, TeamTask, UpdateTeamRequest,
};
use crate::db::team_operations;
use crate::db::Database;
use crate::error::AppError;
use crate::services::team_orchestrator::TeamOrchestrator;
use tauri::{AppHandle, State};

// ── Team CRUD ───────────────────────────────────────────────

#[tauri::command]
pub fn create_team(
    db: State<'_, Database>,
    request: CreateTeamRequest,
) -> Result<Team, AppError> {
    Ok(team_operations::create_team_impl(&db, request)?)
}

#[tauri::command]
pub fn get_team_detail(
    db: State<'_, Database>,
    team_id: String,
) -> Result<TeamDetail, AppError> {
    Ok(team_operations::get_team_detail_impl(&db, team_id)?)
}

#[tauri::command]
pub fn list_teams(db: State<'_, Database>) -> Result<Vec<Team>, AppError> {
    Ok(team_operations::list_teams_impl(&db)?)
}

#[tauri::command]
pub fn update_team(
    db: State<'_, Database>,
    team_id: String,
    request: UpdateTeamRequest,
) -> Result<Team, AppError> {
    Ok(team_operations::update_team_impl(&db, team_id, request)?)
}

#[tauri::command]
pub fn delete_team(
    db: State<'_, Database>,
    team_id: String,
) -> Result<(), AppError> {
    Ok(team_operations::delete_team_impl(&db, team_id)?)
}

// ── Team Members ────────────────────────────────────────────

#[tauri::command]
pub fn add_team_member(
    db: State<'_, Database>,
    team_id: String,
    agent_id: String,
    role: String,
) -> Result<TeamMember, AppError> {
    Ok(team_operations::add_team_member_impl(&db, team_id, agent_id, role)?)
}

#[tauri::command]
pub fn remove_team_member(
    db: State<'_, Database>,
    team_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    Ok(team_operations::remove_team_member_impl(&db, team_id, agent_id)?)
}

// ── Team Runs ───────────────────────────────────────────────

#[tauri::command]
pub fn create_team_run(
    db: State<'_, Database>,
    team_id: String,
    conversation_id: String,
    leader_agent_id: String,
) -> Result<TeamRun, AppError> {
    Ok(team_operations::create_team_run_impl(
        &db,
        team_id,
        conversation_id,
        leader_agent_id,
    )?)
}

#[tauri::command]
pub fn update_team_run_status(
    db: State<'_, Database>,
    run_id: String,
    status: String,
    finished_at: Option<String>,
) -> Result<(), AppError> {
    Ok(team_operations::update_team_run_status_impl(
        &db,
        run_id,
        status,
        finished_at,
    )?)
}

#[tauri::command]
pub fn get_team_run(
    db: State<'_, Database>,
    run_id: String,
) -> Result<TeamRun, AppError> {
    Ok(team_operations::get_team_run_impl(&db, run_id)?)
}

#[tauri::command]
pub fn get_running_runs(
    db: State<'_, Database>,
) -> Result<Vec<TeamRun>, AppError> {
    Ok(team_operations::get_running_runs_impl(&db)?)
}

// ── Team Tasks ──────────────────────────────────────────────

#[tauri::command]
pub fn create_team_task(
    db: State<'_, Database>,
    run_id: String,
    agent_id: String,
    task_description: String,
    parent_message_id: Option<String>,
) -> Result<TeamTask, AppError> {
    Ok(team_operations::create_team_task_impl(
        &db,
        run_id,
        agent_id,
        task_description,
        parent_message_id,
    )?)
}

#[tauri::command]
pub fn update_team_task(
    db: State<'_, Database>,
    task_id: String,
    status: Option<String>,
    request_id: Option<String>,
    result_summary: Option<String>,
    finished_at: Option<String>,
) -> Result<TeamTask, AppError> {
    Ok(team_operations::update_team_task_impl(
        &db,
        task_id,
        status,
        request_id,
        result_summary,
        finished_at,
    )?)
}

#[tauri::command]
pub fn get_team_tasks(
    db: State<'_, Database>,
    run_id: String,
) -> Result<Vec<TeamTask>, AppError> {
    Ok(team_operations::get_team_tasks_impl(&db, run_id)?)
}

// ── Orchestration ────────────────────────────────────────────

#[tauri::command]
pub async fn abort_team_run(
    app: AppHandle,
    db: State<'_, Database>,
    registry: State<'_, RunRegistry>,
    run_id: String,
) -> Result<(), AppError> {
    TeamOrchestrator::abort_team_run(&app, &db, &registry, &run_id)
        .await
        .map_err(AppError::Validation)
}

#[tauri::command]
pub async fn execute_delegation(
    app: AppHandle,
    db: State<'_, Database>,
    conversation_id: String,
    run_id: String,
    agent_ids: Vec<String>,
    task: String,
    context: Option<String>,
) -> Result<Vec<String>, AppError> {
    TeamOrchestrator::execute_delegation(
        &app,
        &db,
        &conversation_id,
        &run_id,
        agent_ids,
        task,
        context,
    )
    .await
    .map_err(AppError::Validation)
}

#[tauri::command]
pub async fn handle_team_report(
    app: AppHandle,
    db: State<'_, Database>,
    run_id: String,
    task_id: String,
    summary: String,
    details: Option<String>,
) -> Result<bool, AppError> {
    TeamOrchestrator::handle_report(&app, &db, &run_id, &task_id, summary, details)
        .await
        .map_err(AppError::Validation)
}
