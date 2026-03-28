mod api;
mod browser;
mod commands;
mod db;
mod error;
pub mod memory;
mod models;
pub mod relay;
mod services;
mod utils;
pub mod vault;

use api::{ApiState, RunRegistry};
use commands::vault_commands::VaultState;
use db::Database;
use memory::SystemMemoryManager;
use services::cron_scheduler::CronScheduler;
use services::team_orchestrator::TeamOrchestrator;
use tauri::Manager;
use vault::VaultManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env from project root (CWD may differ in tauri dev)
    dotenvy::dotenv().ok();
    // Also try parent directory (handles src-tauri/ as CWD)
    dotenvy::from_filename("../.env").ok();

    // Initialize tracing subscriber — respects RUST_LOG env var if set
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| {
            if cfg!(debug_assertions) {
                tracing_subscriber::EnvFilter::new("debug")
            } else {
                tracing_subscriber::EnvFilter::new("info")
            }
        });
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .compact()
        .init();

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
                Err(e) => { tracing::warn!("Vault watcher failed to start: {e}"); }
            }

            // Migrate legacy p2p store files → relay (one-time, idempotent)
            {
                use tauri_plugin_store::StoreExt;
                for (old, new_name) in [
                    ("p2p-identity.json", "relay-identity.json"),
                    ("p2p-settings.json", "relay-settings.json"),
                ] {
                    if let Ok(old_store) = app.store(old) {
                        if let Ok(new_store) = app.store(new_name) {
                            // Only migrate if new store is empty and old has data
                            let new_has_data = new_store.length() > 0;
                            let old_has_data = old_store.length() > 0;
                            if !new_has_data && old_has_data {
                                for (key, value) in old_store.entries() {
                                    new_store.set(key, value);
                                }
                                match new_store.save() {
                                    Ok(()) => tracing::info!("Migrated {old} → {new_name}"),
                                    Err(e) => tracing::warn!("Failed to save migrated store {new_name}: {e}"),
                                }
                            }
                        }
                    }
                }
            }

            // Initialize relay identity and manager (dormant until user opts in)
            let relay_identity = relay::identity::NodeIdentity::load_or_create(app.handle())
                .expect("failed to initialize relay identity");
            let relay_manager = relay::manager::RelayManager::new(&relay_identity);
            app.manage(relay_identity);
            app.manage(relay_manager);

            // Initialize SystemMemoryManager
            app.manage(SystemMemoryManager::new(&app_dir));

            // Recover stale team runs from previous sessions
            let db_ref = app.state::<Database>();
            if let Ok(recovered) = TeamOrchestrator::recover_runs(&db_ref) {
                if recovered > 0 {
                    tracing::info!(recovered, "Recovered stale team run(s) on startup");
                }
            }

            // Initialize CronScheduler
            app.manage(CronScheduler::new());
            let scheduler_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                CronScheduler::run(scheduler_app).await;
            });

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
            commands::create_team_conversation,
            commands::get_conversations,
            commands::get_messages,
            commands::save_message,
            commands::delete_conversation,
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
            commands::refresh_default_manager_persona,
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
            commands::export_agent,
            commands::import_agent,
            commands::update_conversation_skills,
            commands::set_learning_mode,
            commands::list_skills,
            commands::read_skill,
            commands::read_skill_resource,
            commands::create_skill,
            commands::update_skill,
            commands::delete_skill,
            commands::approve_browser_domain,
            commands::get_browser_artifact,
            commands::get_browser_headless,
            commands::set_browser_headless,
            commands::get_browser_proxy,
            commands::set_browser_proxy,
            commands::detect_system_proxy,
            commands::get_shell_info,
            commands::get_workspace_path,
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
            commands::vault_archive_note,
            commands::vault_list_notes_with_decay,
            commands::relay_start,
            commands::relay_stop,
            commands::relay_status,
            commands::relay_generate_invite,
            commands::relay_accept_invite,
            commands::relay_list_contacts,
            commands::relay_update_contact,
            commands::relay_remove_contact,
            commands::relay_approve_contact,
            commands::relay_reject_contact,
            commands::relay_bind_agent,
            commands::relay_send_message,
            commands::relay_list_threads,
            commands::relay_get_thread,
            commands::relay_get_thread_messages,
            commands::relay_get_peer_id,
            commands::relay_get_network_enabled,
            commands::relay_set_network_enabled,
            commands::relay_get_connection_info,
            commands::relay_get_relay_url,
            commands::relay_set_relay_url,
            commands::relay_get_allowed_tools,
            commands::relay_set_allowed_tools,
            commands::relay_search_directory,
            commands::relay_send_friend_request,
            commands::relay_update_directory_profile,
            commands::relay_get_directory_settings,
            commands::relay_set_directory_settings,
            commands::read_consolidated_memory,
            commands::list_pending_consolidations,
            commands::read_digest,
            commands::write_digest,
            commands::write_consolidated_memory,
            commands::update_conversation_digest,
            commands::update_conversation_consolidated,
            commands::archive_conversation_notes,
            // Team commands
            commands::create_team,
            commands::get_team_detail,
            commands::list_teams,
            commands::update_team,
            commands::delete_team,
            commands::add_team_member,
            commands::remove_team_member,
            commands::create_team_run,
            commands::update_team_run_status,
            commands::get_team_run,
            commands::get_running_runs,
            commands::create_team_task,
            commands::update_team_task,
            commands::get_team_tasks,
            commands::abort_team_run,
            commands::execute_delegation,
            commands::handle_team_report,
            // Cron commands
            commands::create_cron_job,
            commands::list_cron_jobs,
            commands::list_cron_jobs_for_agent,
            commands::get_cron_job,
            commands::update_cron_job,
            commands::delete_cron_job,
            commands::toggle_cron_job,
            commands::list_cron_runs,
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
