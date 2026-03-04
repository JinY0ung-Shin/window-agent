mod commands;
mod db;

use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

            let db_path = app_dir.join("chat.db");
            let database = Database::new(
                db_path.to_str().expect("invalid db path"),
            )
            .expect("failed to initialize database");

            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_conversation,
            commands::get_conversations,
            commands::get_messages,
            commands::save_message,
            commands::delete_conversation,
            commands::create_agent,
            commands::get_agent,
            commands::list_agents,
            commands::update_agent,
            commands::delete_agent,
            commands::write_agent_file,
            commands::read_agent_file,
            commands::sync_agents_from_fs,
            commands::seed_manager_agent,
            commands::resize_avatar,
            commands::get_bootstrap_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
