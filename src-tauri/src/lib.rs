mod api;
mod browser;
mod commands;
mod db;
mod error;
mod models;
mod p2p;
mod services;
mod utils;
pub mod vault;

use api::{ApiState, RunRegistry};
use commands::vault_commands::VaultState;
use db::Database;
use tauri::Manager;
use vault::VaultManager;

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

            // Initialize VaultManager
            let vault_path = app_dir.join("vault");
            let vault_manager = VaultManager::new(vault_path.clone())
                .expect("failed to initialize vault manager");
            app.manage(std::sync::Mutex::new(vault_manager) as VaultState);

            // Start VaultWatcher for external edit sync (Obsidian etc.)
            let watcher = vault::watcher::VaultWatcher::new(vault_path, 300);
            match watcher.start(app.handle().clone()) {
                Ok(w) => { app.manage(w); } // keep watcher alive via managed state
                Err(e) => { eprintln!("Warning: vault watcher failed to start: {e}"); }
            }

            // Initialize P2P identity and manager (dormant until user opts in)
            let p2p_identity = p2p::identity::NodeIdentity::load_or_create(app.handle())
                .expect("failed to initialize P2P identity");
            let p2p_manager = p2p::manager::P2PManager::new(&p2p_identity);
            app.manage(p2p_identity);
            app.manage(p2p_manager);

            let browser_manager = browser::BrowserManager::new(app_dir.clone(), Some(app.handle().clone()));
            let bm_clone = browser_manager.clone();
            app.manage(browser_manager);
            tauri::async_runtime::spawn(async move {
                browser::BrowserManager::start_idle_cleanup(bm_clone).await;
            });

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
            commands::has_stored_key,
            commands::get_no_proxy,
            commands::set_no_proxy,
            commands::set_api_config,
            commands::check_api_health,
            commands::chat_completion,
            commands::chat_completion_stream,
            commands::abort_stream,
            commands::bootstrap_completion,
            commands::list_models,
            commands::create_memory_note,
            commands::list_memory_notes,
            commands::update_memory_note,
            commands::delete_memory_note,
            commands::create_tool_call_log,
            commands::list_tool_call_logs,
            commands::update_tool_call_log_status,
            commands::execute_tool,
            commands::export_conversation,
            commands::export_agent,
            commands::import_agent,
            commands::update_conversation_skills,
            commands::list_skills,
            commands::read_skill,
            commands::read_skill_resource,
            commands::create_skill,
            commands::update_skill,
            commands::delete_skill,
            commands::approve_browser_domain,
            commands::get_browser_artifact,
            commands::get_native_tools,
            commands::get_default_tool_config,
            commands::read_tool_config,
            commands::write_tool_config,
            commands::list_credentials,
            commands::add_credential,
            commands::update_credential,
            commands::remove_credential,
            commands::vault_create_note,
            commands::vault_read_note,
            commands::vault_update_note,
            commands::vault_delete_note,
            commands::vault_list_notes,
            commands::vault_search,
            commands::vault_get_graph,
            commands::vault_get_backlinks,
            commands::vault_get_path,
            commands::vault_open_in_obsidian,
            commands::vault_rebuild_index,
            commands::vault_migrate_preview,
            commands::vault_migrate_execute,
            commands::p2p_start,
            commands::p2p_stop,
            commands::p2p_status,
            commands::p2p_generate_invite,
            commands::p2p_accept_invite,
            commands::p2p_list_contacts,
            commands::p2p_update_contact,
            commands::p2p_remove_contact,
            commands::p2p_bind_agent,
            commands::p2p_send_message,
            commands::p2p_approve_message,
            commands::p2p_reject_message,
            commands::p2p_request_draft,
            commands::p2p_list_threads,
            commands::p2p_get_thread,
            commands::p2p_get_thread_messages,
            commands::p2p_get_peer_id,
            commands::p2p_get_network_enabled,
            commands::p2p_set_network_enabled,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let browser = window.state::<browser::BrowserManager>();
                let browser = browser.inner().clone();
                tauri::async_runtime::spawn(async move {
                    browser.shutdown().await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
