#![allow(dead_code)]

mod db;
mod tools;
mod commands;
mod ai;
mod agents;

use db::Database;
use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Database>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Resolve app data dir for the database
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");
            let db_path = app_dir.join("window-agent.db");

            // Initialize database
            let database =
                Database::new(db_path.to_str().unwrap()).expect("failed to open database");
            database.init_tables().expect("failed to init tables");

            // Seed agents and departments
            {
                let conn = database.conn.lock().unwrap();
                agents::seed::seed_all_agents(&conn).ok();
                agents::seed::seed_default_departments(&conn).ok();

                // Migrate existing agents from claude to openai backend
                conn.execute(
                    "UPDATE agents SET ai_backend = 'openai', model = 'gpt-5.3-codex' WHERE ai_backend = 'claude'",
                    [],
                ).ok();
            }

            // Register managed state
            app.manage(AppState {
                db: Arc::new(database),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Chat
            commands::chat_commands::send_message,
            commands::chat_commands::get_messages,
            // Agent
            commands::agent_commands::get_agents,
            commands::agent_commands::get_agent_status,
            // Tools
            commands::tool_commands::execute_tool,
            // AI
            commands::ai_commands::chat_with_agent,
            // HR
            commands::hr_commands::hire_agent,
            commands::hr_commands::fire_agent,
            commands::hr_commands::update_agent,
            commands::hr_commands::get_departments,
            commands::hr_commands::create_department,
            // Tasks
            commands::task_commands::create_task,
            commands::task_commands::update_task,
            commands::task_commands::delete_task,
            commands::task_commands::get_all_tasks,
            commands::task_commands::get_tasks_by_status,
            commands::task_commands::update_task_status_cmd,
            // Permissions
            commands::permission_commands::get_permissions,
            commands::permission_commands::update_permission,
            commands::permission_commands::get_folder_whitelist,
            commands::permission_commands::add_folder_to_whitelist,
            commands::permission_commands::remove_folder_from_whitelist,
            commands::permission_commands::get_program_whitelist,
            commands::permission_commands::add_program_to_whitelist,
            commands::permission_commands::remove_program_from_whitelist,
            // Collaboration
            commands::collaboration_commands::send_agent_message,
            commands::collaboration_commands::get_agent_messages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
