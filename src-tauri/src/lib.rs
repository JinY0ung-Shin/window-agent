mod api;
mod commands;
mod db;

use api::{ApiState, RunRegistry};
use db::Database;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env from project root (CWD may differ in tauri dev)
    dotenvy::dotenv().ok();
    // Also try parent directory (handles src-tauri/ as CWD)
    dotenvy::from_filename("../.env").ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
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
            app.manage(ApiState::load(app.handle()));
            app.manage(RunRegistry::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_conversation,
            commands::get_conversations,
            commands::get_messages,
            commands::save_message,
            commands::delete_conversation,
            commands::delete_messages_from,
            commands::get_conversation_detail,
            commands::update_conversation_title,
            commands::update_conversation_summary,
            commands::delete_messages_and_maybe_reset_summary,
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
            commands::get_env_config,
            commands::has_api_key,
            commands::set_api_config,
            commands::chat_completion,
            commands::chat_completion_stream,
            commands::abort_stream,
            commands::bootstrap_completion,
            commands::list_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
