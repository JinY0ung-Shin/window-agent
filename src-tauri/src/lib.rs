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

            // Seed default agent
            {
                let conn = database.conn.lock().unwrap();
                db::models::seed_secretary_agent(&conn).ok(); // INSERT OR IGNORE
            }

            // Register managed state
            app.manage(AppState {
                db: Arc::new(database),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::chat_commands::send_message,
            commands::chat_commands::get_messages,
            commands::agent_commands::get_agents,
            commands::agent_commands::get_agent_status,
            commands::tool_commands::execute_tool,
            commands::ai_commands::chat_with_agent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
