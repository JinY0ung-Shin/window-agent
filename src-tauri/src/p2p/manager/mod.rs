mod event_loop;
mod helpers;

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use libp2p::{Multiaddr, PeerId};
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use super::envelope::Envelope;
use super::identity::NodeIdentity;
use super::transport;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum NetworkStatus {
    Dormant,
    Starting,
    Active,
    Stopping,
}

pub enum P2PCommand {
    SendMessage {
        peer_id: PeerId,
        envelope: Envelope,
        reply: oneshot::Sender<Result<(), P2PError>>,
    },
    Dial {
        peer_id: PeerId,
        addrs: Vec<Multiaddr>,
    },
    Stop,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum P2PError {
    #[error("Network not active")]
    NotActive,
    #[error("Command channel closed")]
    ChannelClosed,
    #[error("Transport error: {0}")]
    Transport(String),
}

// ---------------------------------------------------------------------------
// Tauri event payloads
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
pub(crate) struct PeerConnectedEvent {
    pub(crate) peer_id: String,
    pub(crate) contact_name: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct PeerDisconnectedEvent {
    pub(crate) peer_id: String,
    pub(crate) reason: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct IncomingMessageEvent {
    pub(crate) peer_id: String,
    pub(crate) envelope: Envelope,
}

#[derive(Clone, Serialize)]
pub(crate) struct ConnectionStateEvent {
    pub(crate) status: String,
    pub(crate) peer_count: usize,
}

// ---------------------------------------------------------------------------
// P2PManager
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct P2PManager {
    pub(crate) inner: Arc<Mutex<P2PManagerInner>>,
    /// Set of peer_id strings for contacts accepted via invite.
    /// Only peers in this set are allowed to send messages.
    pub(crate) known_peers: Arc<Mutex<HashSet<String>>>,
    /// Set of peer_id strings that have completed the handshake.
    /// Shared with the event loop for send-gating.
    pub(crate) authenticated_peers: Arc<Mutex<HashSet<String>>>,
    /// Snapshot of non-loopback listen addresses reported by the swarm.
    pub(crate) listen_addresses: Arc<Mutex<Vec<String>>>,
}

pub(crate) struct P2PManagerInner {
    pub(crate) keypair: libp2p::identity::Keypair,
    pub(crate) peer_id: PeerId,
    pub(crate) status: NetworkStatus,
    pub(crate) command_tx: Option<mpsc::Sender<P2PCommand>>,
    pub(crate) active_listen_port: Option<u16>,
}

impl P2PManager {
    /// Create a new manager in dormant state.
    pub fn new(identity: &NodeIdentity) -> Self {
        let inner = P2PManagerInner {
            keypair: identity.keypair().clone(),
            peer_id: *identity.peer_id(),
            status: NetworkStatus::Dormant,
            command_tx: None,
            active_listen_port: None,
        };
        Self {
            inner: Arc::new(Mutex::new(inner)),
            known_peers: Arc::new(Mutex::new(HashSet::new())),
            authenticated_peers: Arc::new(Mutex::new(HashSet::new())),
            listen_addresses: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Replace the known peers set (e.g. loaded from contacts DB on start).
    pub fn set_known_peers(&self, peers: HashSet<String>) -> Result<(), P2PError> {
        *self.known_peers.lock().map_err(|_| P2PError::Transport("known_peers lock poisoned".into()))? = peers;
        Ok(())
    }

    /// Add a peer to the known set (e.g. when a new contact is accepted).
    pub fn add_known_peer(&self, peer_id: String) -> Result<(), P2PError> {
        self.known_peers.lock().map_err(|_| P2PError::Transport("known_peers lock poisoned".into()))?.insert(peer_id);
        Ok(())
    }

    /// Remove a peer from the known set (e.g. when a contact is deleted).
    pub fn remove_known_peer(&self, peer_id: &str) -> Result<(), P2PError> {
        self.known_peers.lock().map_err(|_| P2PError::Transport("known_peers lock poisoned".into()))?.remove(peer_id);
        self.authenticated_peers.lock().map_err(|_| P2PError::Transport("authenticated_peers lock poisoned".into()))?.remove(peer_id);
        Ok(())
    }

    /// Check if a peer has completed the handshake and is authenticated.
    pub fn is_peer_authenticated(&self, peer_id: &str) -> Result<bool, P2PError> {
        Ok(self.authenticated_peers.lock().map_err(|_| P2PError::Transport("authenticated_peers lock poisoned".into()))?.contains(peer_id))
    }

    /// Current network status.
    pub fn status(&self) -> Result<NetworkStatus, P2PError> {
        Ok(self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?.status)
    }

    /// Local PeerId.
    pub fn peer_id(&self) -> Result<PeerId, P2PError> {
        Ok(self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?.peer_id)
    }

    /// Non-loopback listen addresses reported by the swarm.
    pub fn get_listen_addresses(&self) -> Result<Vec<String>, P2PError> {
        Ok(self.listen_addresses.lock().map_err(|_| P2PError::Transport("listen_addresses lock poisoned".into()))?.clone())
    }

    /// The port the swarm is actually listening on (extracted from first NewListenAddr).
    pub fn get_active_listen_port(&self) -> Result<Option<u16>, P2PError> {
        Ok(self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?.active_listen_port)
    }

    /// Start the P2P swarm event loop. Transitions from Dormant → Active.
    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<(), P2PError> {
        let keypair = {
            let mut inner = self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?;
            if inner.status != NetworkStatus::Dormant {
                return Err(P2PError::Transport("Already running".into()));
            }
            inner.status = NetworkStatus::Starting;
            inner.keypair.clone()
        };

        let _ = app_handle.emit(
            "p2p:connection-state",
            ConnectionStateEvent {
                status: "starting".into(),
                peer_count: 0,
            },
        );

        let mut swarm = transport::build_swarm(keypair)
            .map_err(|e| P2PError::Transport(e.to_string()))?;

        // Read configured listen port from store (None or 0 → random ephemeral port)
        let port: u16 = {
            use tauri_plugin_store::StoreExt;
            app_handle
                .store("p2p-settings.json")
                .ok()
                .and_then(|s| s.get("listen_port"))
                .and_then(|v| v.as_u64())
                .and_then(|p| u16::try_from(p).ok())
                .unwrap_or(0)
        };

        let listen_addr_v4: Multiaddr = format!("/ip4/0.0.0.0/tcp/{port}")
            .parse()
            .map_err(|e: libp2p::multiaddr::Error| P2PError::Transport(e.to_string()))?;

        swarm
            .listen_on(listen_addr_v4)
            .map_err(|e| P2PError::Transport(e.to_string()))?;

        // Also listen on IPv6 (best-effort — may fail on systems without IPv6)
        let listen_addr_v6: Multiaddr = format!("/ip6/::/tcp/{port}")
            .parse()
            .map_err(|e: libp2p::multiaddr::Error| P2PError::Transport(e.to_string()))?;

        if let Err(e) = swarm.listen_on(listen_addr_v6) {
            tracing::warn!("P2P IPv6 listen failed (non-fatal): {e}");
        }

        let (cmd_tx, cmd_rx) = mpsc::channel::<P2PCommand>(64);

        {
            let mut inner = self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?;
            inner.command_tx = Some(cmd_tx);
            inner.status = NetworkStatus::Active;
        }

        let _ = app_handle.emit(
            "p2p:connection-state",
            ConnectionStateEvent {
                status: "active".into(),
                peer_count: 0,
            },
        );

        let inner_clone = self.inner.clone();
        let known_peers = self.known_peers.clone();
        let shared_authenticated = self.authenticated_peers.clone();
        let listen_addrs = self.listen_addresses.clone();
        // Clear authenticated set and listen addresses on (re)start
        shared_authenticated.lock().map_err(|_| P2PError::Transport("authenticated_peers lock poisoned".into()))?.clear();
        listen_addrs.lock().map_err(|_| P2PError::Transport("listen_addresses lock poisoned".into()))?.clear();
        let identity = app_handle.state::<NodeIdentity>().inner().clone();
        tokio::spawn(async move {
            event_loop::run_event_loop(swarm, cmd_rx, &app_handle, &known_peers, &shared_authenticated, &listen_addrs, &identity).await;

            // Cleanup after event loop exits
            if let Ok(mut inner) = inner_clone.lock() {
                inner.status = NetworkStatus::Dormant;
                inner.command_tx = None;
                inner.active_listen_port = None;
            } else {
                tracing::error!("P2P: inner lock poisoned during event loop cleanup");
            }
            if let Ok(mut addrs) = listen_addrs.lock() {
                addrs.clear();
            }
            let _ = app_handle.emit(
                "p2p:connection-state",
                ConnectionStateEvent {
                    status: "dormant".into(),
                    peer_count: 0,
                },
            );
        });

        Ok(())
    }

    /// Stop the P2P swarm gracefully.
    pub async fn stop(&self) -> Result<(), P2PError> {
        let cmd_tx = {
            let mut inner = self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?;
            if inner.status != NetworkStatus::Active {
                return Err(P2PError::NotActive);
            }
            inner.status = NetworkStatus::Stopping;
            inner.command_tx.take()
        };

        self.listen_addresses.lock().map_err(|_| P2PError::Transport("listen_addresses lock poisoned".into()))?.clear();

        if let Some(tx) = cmd_tx {
            let _ = tx.send(P2PCommand::Stop).await;
        }

        Ok(())
    }

    /// Send a message to a remote peer.
    pub async fn send_message(
        &self,
        peer_id: PeerId,
        envelope: Envelope,
    ) -> Result<(), P2PError> {
        let cmd_tx = {
            let inner = self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?;
            inner.command_tx.clone().ok_or(P2PError::NotActive)?
        };

        let (reply_tx, reply_rx) = oneshot::channel();
        cmd_tx
            .send(P2PCommand::SendMessage {
                peer_id,
                envelope,
                reply: reply_tx,
            })
            .await
            .map_err(|_| P2PError::ChannelClosed)?;

        reply_rx.await.map_err(|_| P2PError::ChannelClosed)?
    }

    /// Dial a remote peer by PeerId and known addresses.
    pub async fn dial(&self, peer_id: PeerId, addrs: Vec<Multiaddr>) -> Result<(), P2PError> {
        let cmd_tx = {
            let inner = self.inner.lock().map_err(|_| P2PError::Transport("P2P inner lock poisoned".into()))?;
            inner.command_tx.clone().ok_or(P2PError::NotActive)?
        };

        cmd_tx
            .send(P2PCommand::Dial { peer_id, addrs })
            .await
            .map_err(|_| P2PError::ChannelClosed)?;

        Ok(())
    }
}
