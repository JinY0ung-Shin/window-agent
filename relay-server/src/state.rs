use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

use axum::extract::ws::Message as WsMessage;
use sqlx::SqlitePool;
use tokio::sync::{Mutex, RwLock};

/// Channel sender for pushing messages to a connected peer's WebSocket.
pub type WsSender = tokio::sync::mpsc::UnboundedSender<WsMessage>;

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<Inner>,
}

struct Inner {
    /// peer_id → (WebSocket sender, session_id)
    connections: RwLock<HashMap<String, (WsSender, String)>>,
    /// peer_id → Ed25519 public key bytes (registered on first auth)
    known_keys: RwLock<HashMap<String, Vec<u8>>>,
    /// peer_id → set of peer_ids whose presence this peer subscribes to
    presence_subscriptions: RwLock<HashMap<String, HashSet<String>>>,
    /// Recently seen message IDs for deduplication (last 1 hour)
    seen_messages: Mutex<HashMap<String, Instant>>,
    /// Rate limit for directory searches: peer_id → (count, window_start)
    search_rate_limits: RwLock<HashMap<String, (u32, Instant)>>,
    /// Rate limit for auth endpoints: ip/key → (count, window_start)
    auth_rate_limits: RwLock<HashMap<String, (u32, Instant)>>,
    /// JWT signing secret for community hub
    jwt_secret: String,
    /// SQLite connection pool
    db: SqlitePool,
}

impl AppState {
    pub fn new(db: SqlitePool, jwt_secret: String) -> Self {
        Self {
            inner: Arc::new(Inner {
                connections: RwLock::new(HashMap::new()),
                known_keys: RwLock::new(HashMap::new()),
                presence_subscriptions: RwLock::new(HashMap::new()),
                seen_messages: Mutex::new(HashMap::new()),
                search_rate_limits: RwLock::new(HashMap::new()),
                auth_rate_limits: RwLock::new(HashMap::new()),
                jwt_secret,
                db,
            }),
        }
    }

    pub fn db(&self) -> &SqlitePool {
        &self.inner.db
    }

    pub fn jwt_secret(&self) -> &str {
        &self.inner.jwt_secret
    }

    // ── Connection management ──

    /// Insert or replace a peer connection. Returns the old sender if the peer
    /// was already connected (single-session policy: caller should close it).
    pub async fn insert_connection(
        &self,
        peer_id: &str,
        tx: WsSender,
        session_id: String,
    ) -> Option<WsSender> {
        self.inner
            .connections
            .write()
            .await
            .insert(peer_id.to_string(), (tx, session_id))
            .map(|(old_tx, _)| old_tx)
    }

    /// Remove connection only if the session_id matches (prevents a replaced
    /// handler from removing the newer connection).
    pub async fn remove_connection_if_session(&self, peer_id: &str, session_id: &str) -> bool {
        let mut conns = self.inner.connections.write().await;
        if let Some((_, sid)) = conns.get(peer_id) {
            if sid == session_id {
                conns.remove(peer_id);
                return true;
            }
        }
        false
    }

    pub async fn get_sender(&self, peer_id: &str) -> Option<WsSender> {
        self.inner
            .connections
            .read()
            .await
            .get(peer_id)
            .map(|(tx, _)| tx.clone())
    }

    pub async fn is_online(&self, peer_id: &str) -> bool {
        self.inner.connections.read().await.contains_key(peer_id)
    }

    // ── Key management ──

    /// Register a public key for a peer_id. Returns `Ok(())` on success,
    /// `Err(())` if a *different* key is already registered for this peer.
    pub async fn register_key(&self, peer_id: &str, public_key: &[u8]) -> Result<(), ()> {
        let mut keys = self.inner.known_keys.write().await;
        if let Some(existing) = keys.get(peer_id) {
            if existing != public_key {
                return Err(());
            }
            return Ok(());
        }
        keys.insert(peer_id.to_string(), public_key.to_vec());
        Ok(())
    }

    pub async fn get_known_key(&self, peer_id: &str) -> Option<Vec<u8>> {
        self.inner.known_keys.read().await.get(peer_id).cloned()
    }

    // ── Presence subscriptions ──

    pub async fn set_presence_subscriptions(&self, peer_id: &str, targets: HashSet<String>) {
        self.inner
            .presence_subscriptions
            .write()
            .await
            .insert(peer_id.to_string(), targets);
    }

    /// Return list of peers subscribed to `target_peer_id`'s presence.
    pub async fn subscribers_of(&self, target_peer_id: &str) -> Vec<String> {
        self.inner
            .presence_subscriptions
            .read()
            .await
            .iter()
            .filter_map(|(subscriber, targets)| {
                if targets.contains(target_peer_id) {
                    Some(subscriber.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    pub async fn remove_presence_subscriptions(&self, peer_id: &str) {
        self.inner
            .presence_subscriptions
            .write()
            .await
            .remove(peer_id);
    }

    // ── Deduplication ──

    /// Returns `true` if this message_id was already seen (duplicate).
    pub async fn check_and_mark_seen(&self, message_id: &str) -> bool {
        let mut seen = self.inner.seen_messages.lock().await;

        // Periodic cleanup: remove entries older than 1 hour
        let one_hour = std::time::Duration::from_secs(3600);
        let now = Instant::now();
        seen.retain(|_, ts| now.duration_since(*ts) < one_hour);

        if seen.contains_key(message_id) {
            true
        } else {
            seen.insert(message_id.to_string(), now);
            false
        }
    }

    // ── Directory search rate limiting ──

    /// Check and increment search rate. Returns `true` if rate limit exceeded.
    pub async fn check_search_rate(&self, peer_id: &str) -> bool {
        let mut limits = self.inner.search_rate_limits.write().await;
        let now = Instant::now();
        let window = std::time::Duration::from_secs(60);
        let max_per_window: u32 = 10;

        // Evict expired entries when map grows large
        if limits.len() > 1000 {
            limits.retain(|_, (_, start)| now.duration_since(*start) <= window);
        }

        if let Some((count, start)) = limits.get_mut(peer_id) {
            if now.duration_since(*start) > window {
                *count = 1;
                *start = now;
                false
            } else if *count >= max_per_window {
                true
            } else {
                *count += 1;
                false
            }
        } else {
            limits.insert(peer_id.to_string(), (1, now));
            false
        }
    }

    // ── Auth rate limiting ──

    /// Check auth rate limit by key (e.g. email). Returns `true` if rate limited.
    pub async fn check_auth_rate(&self, key: &str) -> bool {
        let mut limits = self.inner.auth_rate_limits.write().await;
        let now = Instant::now();
        let window = std::time::Duration::from_secs(60);
        let max_per_window: u32 = 10;

        // Evict expired entries when map grows large
        if limits.len() > 1000 {
            limits.retain(|_, (_, start)| now.duration_since(*start) <= window);
        }

        if let Some((count, start)) = limits.get_mut(key) {
            if now.duration_since(*start) > window {
                *count = 1;
                *start = now;
                false
            } else if *count >= max_per_window {
                true
            } else {
                *count += 1;
                false
            }
        } else {
            limits.insert(key.to_string(), (1, now));
            false
        }
    }
}
