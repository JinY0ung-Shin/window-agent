//! Peer management: known-peer tracking, key registration, status queries.

use std::collections::HashSet;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tauri::Manager;

use super::{lock_err, NetworkStatus, RelayError, RelayManager};
use crate::relay::db as relay_db;
use crate::relay::relay_client::{derive_relay_peer_id, RelayHandle};

impl RelayManager {
    // ── Known-peers management ──

    pub fn set_known_peers(&self, peers: HashSet<String>) -> Result<(), RelayError> {
        *self.known_peers.lock().map_err(|_| lock_err())? = peers;
        Ok(())
    }

    pub fn add_known_peer(&self, peer_id: String) -> Result<(), RelayError> {
        self.known_peers.lock().map_err(|_| lock_err())?.insert(peer_id);
        Ok(())
    }

    /// Register a peer's Ed25519 public key (base64). Builds internal indexes.
    pub fn register_peer_key(&self, db_peer_id: &str, public_key_b64: &str) -> Result<(), RelayError> {
        let pk_bytes = B64.decode(public_key_b64)
            .map_err(|e| RelayError::Transport(format!("bad base64 key: {e}")))?;
        if pk_bytes.len() != 32 {
            return Err(RelayError::Transport("public key must be 32 bytes".into()));
        }
        let pk: [u8; 32] = pk_bytes.try_into().unwrap();
        let relay_pid = derive_relay_peer_id(&pk);

        self.relay_id_index.lock().map_err(|_| lock_err())?
            .insert(relay_pid.clone(), db_peer_id.to_string());
        self.peer_keys.lock().map_err(|_| lock_err())?
            .insert(db_peer_id.to_string(), (pk, relay_pid));
        self.known_peers.lock().map_err(|_| lock_err())?
            .insert(db_peer_id.to_string());
        Ok(())
    }

    pub fn remove_known_peer(&self, peer_id: &str) -> Result<(), RelayError> {
        self.known_peers.lock().map_err(|_| lock_err())?.remove(peer_id);
        if let Ok(mut keys) = self.peer_keys.lock() {
            if let Some((_, relay_id)) = keys.remove(peer_id) {
                if let Ok(mut idx) = self.relay_id_index.lock() {
                    idx.remove(&relay_id);
                }
            }
        }
        Ok(())
    }

    // ── Status queries ──

    /// Always true when relay is active (no per-peer auth gating in relay mode).
    pub fn is_peer_authenticated(&self, _peer_id: &str) -> Result<bool, RelayError> {
        Ok(*self.status.lock().map_err(|_| lock_err())? == NetworkStatus::Active)
    }

    pub fn status(&self) -> Result<NetworkStatus, RelayError> {
        Ok(*self.status.lock().map_err(|_| lock_err())?)
    }

    /// Returns the relay-compatible peer_id (hex string).
    pub fn peer_id(&self) -> Result<String, RelayError> {
        let public = self.identity.public_key_bytes();
        Ok(derive_relay_peer_id(&public))
    }

    /// Look up the relay_peer_id for a given DB peer_id.
    pub fn peer_id_to_relay_id(&self, db_peer_id: &str) -> Result<String, RelayError> {
        self.peer_keys.lock().map_err(|_| lock_err())?
            .get(db_peer_id)
            .map(|(_, relay_id)| relay_id.clone())
            .ok_or_else(|| RelayError::Transport(format!("No key for peer: {db_peer_id}")))
    }

    /// Get a clone of the current relay handle (if connected).
    pub fn get_relay_handle(&self) -> Option<RelayHandle> {
        self.relay_handle.lock().ok().and_then(|h| h.clone())
    }

    // ── Internal: peer index ──

    pub(crate) fn rebuild_peer_index(&self, app_handle: &tauri::AppHandle) -> Result<(), RelayError> {
        let db = app_handle.state::<crate::db::Database>();
        let contacts = relay_db::list_contacts(&db)
            .map_err(|e| RelayError::Transport(e.to_string()))?;

        let mut relay_idx = self.relay_id_index.lock().map_err(|_| lock_err())?;
        let mut keys = self.peer_keys.lock().map_err(|_| lock_err())?;
        relay_idx.clear();
        keys.clear();

        for contact in contacts {
            if contact.public_key.is_empty() { continue; }
            if let Ok(pk_bytes) = B64.decode(&contact.public_key) {
                if let Ok(pk) = <[u8; 32]>::try_from(pk_bytes.as_slice()) {
                    let relay_pid = derive_relay_peer_id(&pk);
                    relay_idx.insert(relay_pid.clone(), contact.peer_id.clone());
                    keys.insert(contact.peer_id, (pk, relay_pid));
                }
            }
        }
        Ok(())
    }
}
