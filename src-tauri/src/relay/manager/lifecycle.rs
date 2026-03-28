//! Connection lifecycle: start, stop, directory registration.

use tauri::Emitter;

use super::{lock_err, ConnectionStateEvent, NetworkStatus, RelayError, RelayManager};
use crate::relay::relay_client;

impl RelayManager {
    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<(), RelayError> {
        {
            let mut st = self.status.lock().map_err(|_| lock_err())?;
            if *st != NetworkStatus::Dormant {
                return Err(RelayError::Transport("Already running".into()));
            }
            *st = NetworkStatus::Starting;
        }

        let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
            status: "starting".into(), peer_count: 0,
        });

        // Read relay URL from settings
        let relay_url = {
            use tauri_plugin_store::StoreExt;
            app_handle.store("relay-settings.json").ok()
                .and_then(|s| s.get("relay_url"))
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "wss://relay.windowagent.io/ws".to_string())
        };

        // Build peer indexes from contacts DB
        self.rebuild_peer_index(&app_handle)?;

        // Migrate legacy plaintext outbox entries
        self.migrate_outbox(&app_handle);

        // Start relay client
        let (handle, event_rx) = relay_client::start(relay_url, &self.identity)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        *self.relay_handle.lock().map_err(|_| lock_err())? = Some(handle.clone());
        *self.status.lock().map_err(|_| lock_err())? = NetworkStatus::Active;

        // Subscribe to presence for known peers
        let relay_ids: Vec<String> = self.relay_id_index.lock()
            .map(|idx| idx.keys().cloned().collect())
            .unwrap_or_default();
        if !relay_ids.is_empty() {
            let _ = handle.subscribe_presence(relay_ids);
        }

        // Spawn event processing loop
        let mgr = self.clone();
        let app = app_handle.clone();
        tokio::spawn(async move {
            mgr.run_event_loop(event_rx, &app).await;
        });

        let _ = app_handle.emit("relay:connection-state", ConnectionStateEvent {
            status: "active".into(), peer_count: 0,
        });

        Ok(())
    }

    pub async fn stop(&self) -> Result<(), RelayError> {
        let handle = {
            let mut st = self.status.lock().map_err(|_| lock_err())?;
            if *st != NetworkStatus::Active && *st != NetworkStatus::Reconnecting {
                return Err(RelayError::NotActive);
            }
            *st = NetworkStatus::Stopping;
            self.relay_handle.lock().map_err(|_| lock_err())?.take()
        };

        if let Some(h) = handle {
            h.shutdown();
        }

        *self.status.lock().map_err(|_| lock_err())? = NetworkStatus::Dormant;
        Ok(())
    }

    /// Update directory profile on the relay server.
    pub fn update_directory_profile(
        &self,
        agent_name: &str,
        agent_description: &str,
        discoverable: bool,
    ) -> Result<(), RelayError> {
        let handle = self.relay_handle.lock().map_err(|_| lock_err())?
            .clone().ok_or(RelayError::NotActive)?;
        handle.update_profile(agent_name.to_string(), agent_description.to_string(), discoverable)
            .map_err(|e| RelayError::Transport(e.to_string()))
    }

    /// Search peers in the relay server directory.
    pub fn search_directory(
        &self,
        query: &str,
        limit: u32,
        offset: u32,
    ) -> Result<(), RelayError> {
        let handle = self.relay_handle.lock().map_err(|_| lock_err())?
            .clone().ok_or(RelayError::NotActive)?;
        handle.search_directory(query.to_string(), limit, offset)
            .map_err(|e| RelayError::Transport(e.to_string()))
    }
}
