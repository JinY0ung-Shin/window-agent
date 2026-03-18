use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::StreamExt;
use libp2p::{mdns, request_response, swarm::SwarmEvent, Multiaddr, PeerId};
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::sync::{mpsc, oneshot};

use super::envelope::{Envelope, Payload};
use super::identity::NodeIdentity;
use super::protocol::AgentBehaviourEvent;
use super::security::{HandshakeMessage, HandshakeState};
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
struct PeerConnectedEvent {
    peer_id: String,
    contact_name: String,
}

#[derive(Clone, Serialize)]
struct PeerDisconnectedEvent {
    peer_id: String,
    reason: String,
}

#[derive(Clone, Serialize)]
struct IncomingMessageEvent {
    peer_id: String,
    envelope: Envelope,
}

#[derive(Clone, Serialize)]
struct ConnectionStateEvent {
    status: String,
    peer_count: usize,
}

// ---------------------------------------------------------------------------
// P2PManager
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct P2PManager {
    inner: Arc<Mutex<P2PManagerInner>>,
    /// Set of peer_id strings for contacts accepted via invite.
    /// Only peers in this set are allowed to send messages.
    known_peers: Arc<Mutex<HashSet<String>>>,
    /// Set of peer_id strings that have completed the handshake.
    /// Shared with the event loop for send-gating.
    authenticated_peers: Arc<Mutex<HashSet<String>>>,
    /// Snapshot of non-loopback listen addresses reported by the swarm.
    listen_addresses: Arc<Mutex<Vec<String>>>,
}

struct P2PManagerInner {
    keypair: libp2p::identity::Keypair,
    peer_id: PeerId,
    status: NetworkStatus,
    command_tx: Option<mpsc::Sender<P2PCommand>>,
    active_listen_port: Option<u16>,
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
    pub fn set_known_peers(&self, peers: HashSet<String>) {
        *self.known_peers.lock().unwrap() = peers;
    }

    /// Add a peer to the known set (e.g. when a new contact is accepted).
    pub fn add_known_peer(&self, peer_id: String) {
        self.known_peers.lock().unwrap().insert(peer_id);
    }

    /// Remove a peer from the known set (e.g. when a contact is deleted).
    pub fn remove_known_peer(&self, peer_id: &str) {
        self.known_peers.lock().unwrap().remove(peer_id);
        self.authenticated_peers.lock().unwrap().remove(peer_id);
    }

    /// Check if a peer has completed the handshake and is authenticated.
    pub fn is_peer_authenticated(&self, peer_id: &str) -> bool {
        self.authenticated_peers.lock().unwrap().contains(peer_id)
    }

    /// Current network status.
    pub fn status(&self) -> NetworkStatus {
        self.inner.lock().unwrap().status
    }

    /// Local PeerId.
    pub fn peer_id(&self) -> PeerId {
        self.inner.lock().unwrap().peer_id
    }

    /// Non-loopback listen addresses reported by the swarm.
    pub fn get_listen_addresses(&self) -> Vec<String> {
        self.listen_addresses.lock().unwrap().clone()
    }

    /// The port the swarm is actually listening on (extracted from first NewListenAddr).
    pub fn get_active_listen_port(&self) -> Option<u16> {
        self.inner.lock().unwrap().active_listen_port
    }

    /// Start the P2P swarm event loop. Transitions from Dormant → Active.
    pub async fn start(&self, app_handle: tauri::AppHandle) -> Result<(), P2PError> {
        let keypair = {
            let mut inner = self.inner.lock().unwrap();
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

        let listen_addr: Multiaddr = format!("/ip4/0.0.0.0/tcp/{port}")
            .parse()
            .map_err(|e: libp2p::multiaddr::Error| P2PError::Transport(e.to_string()))?;

        swarm
            .listen_on(listen_addr)
            .map_err(|e| P2PError::Transport(e.to_string()))?;

        let (cmd_tx, cmd_rx) = mpsc::channel::<P2PCommand>(64);

        {
            let mut inner = self.inner.lock().unwrap();
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
        shared_authenticated.lock().unwrap().clear();
        listen_addrs.lock().unwrap().clear();
        let identity = app_handle.state::<NodeIdentity>().inner().clone();
        tokio::spawn(async move {
            Self::run_event_loop(swarm, cmd_rx, &app_handle, &known_peers, &shared_authenticated, &listen_addrs, &identity).await;

            // Cleanup after event loop exits
            {
                let mut inner = inner_clone.lock().unwrap();
                inner.status = NetworkStatus::Dormant;
                inner.command_tx = None;
                inner.active_listen_port = None;
            }
            listen_addrs.lock().unwrap().clear();
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
            let mut inner = self.inner.lock().unwrap();
            if inner.status != NetworkStatus::Active {
                return Err(P2PError::NotActive);
            }
            inner.status = NetworkStatus::Stopping;
            inner.command_tx.take()
        };

        self.listen_addresses.lock().unwrap().clear();

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
            let inner = self.inner.lock().unwrap();
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
            let inner = self.inner.lock().unwrap();
            inner.command_tx.clone().ok_or(P2PError::NotActive)?
        };

        cmd_tx
            .send(P2PCommand::Dial { peer_id, addrs })
            .await
            .map_err(|_| P2PError::ChannelClosed)?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Event loop
    // -----------------------------------------------------------------------

    async fn run_event_loop(
        mut swarm: libp2p::Swarm<super::protocol::AgentBehaviour>,
        mut cmd_rx: mpsc::Receiver<P2PCommand>,
        app_handle: &tauri::AppHandle,
        known_peers: &Arc<Mutex<HashSet<String>>>,
        shared_authenticated: &Arc<Mutex<HashSet<String>>>,
        listen_addresses: &Arc<Mutex<Vec<String>>>,
        identity: &NodeIdentity,
    ) {
        let mut authenticated_peers: HashSet<String> = HashSet::new();
        let mut pending_handshakes: HashMap<String, HandshakeState> = HashMap::new();
        let mut retry_interval = tokio::time::interval(Duration::from_secs(60));
        // Consume the first immediate tick so the retry doesn't fire at t=0
        retry_interval.tick().await;

        loop {
            tokio::select! {
                event = swarm.select_next_some() => {
                    Self::handle_swarm_event(&mut swarm, event, app_handle, known_peers, &mut authenticated_peers, &mut pending_handshakes, listen_addresses, identity);
                    // Sync authenticated set to shared state for external callers
                    *shared_authenticated.lock().unwrap() = authenticated_peers.clone();
                }
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(P2PCommand::SendMessage { peer_id, envelope, reply }) => {
                            let _request_id = swarm
                                .behaviour_mut()
                                .request_response
                                .send_request(&peer_id, envelope);
                            let _ = reply.send(Ok(()));
                        }
                        Some(P2PCommand::Dial { peer_id, addrs }) => {
                            for addr in addrs {
                                swarm.add_peer_address(peer_id, addr);
                            }
                            let _ = swarm.dial(peer_id);
                        }
                        Some(P2PCommand::Stop) | None => {
                            break;
                        }
                    }
                }
                _ = retry_interval.tick() => {
                    Self::retry_pending_outbox(&mut swarm, app_handle, &authenticated_peers);
                }
            }
        }
    }

    fn handle_swarm_event(
        swarm: &mut libp2p::Swarm<super::protocol::AgentBehaviour>,
        event: SwarmEvent<AgentBehaviourEvent>,
        app_handle: &tauri::AppHandle,
        known_peers: &Arc<Mutex<HashSet<String>>>,
        authenticated_peers: &mut HashSet<String>,
        pending_handshakes: &mut HashMap<String, HandshakeState>,
        listen_addresses: &Arc<Mutex<Vec<String>>>,
        identity: &NodeIdentity,
    ) {
        match event {
            // -- mDNS discovery ------------------------------------------------
            SwarmEvent::Behaviour(AgentBehaviourEvent::Mdns(mdns::Event::Discovered(
                peers,
            ))) => {
                for (peer_id, addr) in peers {
                    swarm.add_peer_address(peer_id, addr);
                    let peer_id_str = peer_id.to_string();
                    let is_known = known_peers.lock().unwrap().contains(&peer_id_str);

                    // Auto-dial known peers to trigger handshake
                    if is_known && !authenticated_peers.contains(&peer_id_str) {
                        let _ = swarm.dial(peer_id);
                    }
                }
            }
            SwarmEvent::Behaviour(AgentBehaviourEvent::Mdns(mdns::Event::Expired(peers))) => {
                for (peer_id, _addr) in peers {
                    let _ = app_handle.emit(
                        "p2p:peer-disconnected",
                        PeerDisconnectedEvent {
                            peer_id: peer_id.to_string(),
                            reason: "mdns_expired".into(),
                        },
                    );
                }
            }

            // -- Request/Response messages ------------------------------------
            SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
                request_response::Event::Message { peer, message },
            )) => match message {
                request_response::Message::Request {
                    request, channel, ..
                } => {
                    let peer_str = peer.to_string();
                    let is_known = known_peers.lock().unwrap().contains(&peer_str);

                    // Handshake requests are allowed from known (but not yet authenticated) peers
                    if !is_known {
                        eprintln!("P2P rejecting message from unknown peer: {peer_str}");
                        let reject = Envelope::new(
                            "local".into(),
                            Payload::Error {
                                code: "UNAUTHORIZED".into(),
                                message: "Peer not in contacts list".into(),
                            },
                        );
                        let _ = swarm
                            .behaviour_mut()
                            .request_response
                            .send_response(channel, reject);
                        return;
                    }

                    match &request.payload {
                        // -- Handshake (nonce/challenge) ------------------
                        Payload::Handshake { data } => {
                            let hs_msg: HandshakeMessage = match serde_json::from_str(data) {
                                Ok(m) => m,
                                Err(e) => {
                                    eprintln!("P2P bad handshake data from {peer_str}: {e}");
                                    let reject = Envelope::new(
                                        "local".into(),
                                        Payload::Error {
                                            code: "BAD_HANDSHAKE".into(),
                                            message: e.to_string(),
                                        },
                                    );
                                    let _ = swarm
                                        .behaviour_mut()
                                        .request_response
                                        .send_response(channel, reject);
                                    return;
                                }
                            };

                            // Get or create responder state for this peer
                            let state = pending_handshakes
                                .entry(peer_str.clone())
                                .or_insert_with(HandshakeState::new_responder);

                            match state.process_message(hs_msg, identity) {
                                Ok(Some(reply_msg)) => {
                                    let reply_data = serde_json::to_string(&reply_msg)
                                        .unwrap_or_default();
                                    let reply = Envelope::new(
                                        swarm.local_peer_id().to_string(),
                                        Payload::Handshake { data: reply_data },
                                    );
                                    let _ = swarm
                                        .behaviour_mut()
                                        .request_response
                                        .send_response(channel, reply);

                                    // Check if handshake is now complete (responder side)
                                    if state.is_complete() {
                                        pending_handshakes.remove(&peer_str);
                                        let was_new = authenticated_peers.insert(peer_str.clone());
                                        if was_new {
                                            Self::emit_peer_connected(
                                                swarm, app_handle, &peer_str,
                                            );
                                            Self::retry_queued_for_peer(
                                                swarm, app_handle, &peer_str,
                                            );
                                        }
                                    }
                                }
                                Ok(None) => {
                                    // Handshake complete, no reply needed (shouldn't happen on responder side, but handle gracefully)
                                    pending_handshakes.remove(&peer_str);
                                    let was_new = authenticated_peers.insert(peer_str.clone());
                                    let ack = Envelope::new(
                                        "local".into(),
                                        Payload::Ack {
                                            acked_message_id: request.message_id.clone(),
                                        },
                                    );
                                    let _ = swarm
                                        .behaviour_mut()
                                        .request_response
                                        .send_response(channel, ack);
                                    if was_new {
                                        Self::emit_peer_connected(swarm, app_handle, &peer_str);
                                        Self::retry_queued_for_peer(swarm, app_handle, &peer_str);
                                    }
                                }
                                Err(e) => {
                                    eprintln!(
                                        "P2P handshake error with {peer_str}: {e}"
                                    );
                                    pending_handshakes.remove(&peer_str);
                                    let reject = Envelope::new(
                                        "local".into(),
                                        Payload::Error {
                                            code: "HANDSHAKE_FAILED".into(),
                                            message: e.to_string(),
                                        },
                                    );
                                    let _ = swarm
                                        .behaviour_mut()
                                        .request_response
                                        .send_response(channel, reject);
                                }
                            }
                        }

                        // -- Authenticated message request ----------------
                        Payload::MessageRequest { .. } => {
                            if !authenticated_peers.contains(&peer_str) {
                                eprintln!(
                                    "P2P rejecting message from unauthenticated peer: {peer_str}"
                                );
                                let reject = Envelope::new(
                                    "local".into(),
                                    Payload::Error {
                                        code: "UNAUTHORIZED".into(),
                                        message: "Handshake not completed".into(),
                                    },
                                );
                                let _ = swarm
                                    .behaviour_mut()
                                    .request_response
                                    .send_response(channel, reject);
                                return;
                            }

                            let msg_id = request.message_id.clone();

                            // Pass through secretary pipeline
                            let app_clone = app_handle.clone();
                            tokio::spawn(async move {
                                let db = app_clone.state::<crate::db::Database>();
                                if let Err(e) = super::secretary::handle_incoming_message(
                                    &app_clone, &db, &peer_str, &request,
                                )
                                .await
                                {
                                    eprintln!("Secretary error processing message: {e}");
                                }
                            });

                            // Auto-acknowledge
                            let ack = Envelope::new(
                                "local".into(),
                                Payload::Ack {
                                    acked_message_id: msg_id,
                                },
                            );
                            let _ = swarm
                                .behaviour_mut()
                                .request_response
                                .send_response(channel, ack);
                        }

                        // -- Incoming MessageResponse ---------------------
                        Payload::MessageResponse { content } => {
                            if !authenticated_peers.contains(&peer_str) {
                                eprintln!(
                                    "P2P rejecting response from unauthenticated peer: {peer_str}"
                                );
                                let reject = Envelope::new(
                                    "local".into(),
                                    Payload::Error {
                                        code: "UNAUTHORIZED".into(),
                                        message: "Handshake not completed".into(),
                                    },
                                );
                                let _ = swarm
                                    .behaviour_mut()
                                    .request_response
                                    .send_response(channel, reject);
                                return;
                            }

                            // Persist the response as an incoming message
                            let content_clone = content.clone();
                            let request_clone = request.clone();
                            let app_clone = app_handle.clone();
                            tokio::spawn(async move {
                                let db = app_clone.state::<crate::db::Database>();
                                Self::persist_incoming_response(
                                    &app_clone,
                                    &db,
                                    &peer_str,
                                    &request_clone,
                                    &content_clone,
                                );
                            });

                            // ACK the response
                            let ack = Envelope::new(
                                "local".into(),
                                Payload::Ack {
                                    acked_message_id: request.message_id.clone(),
                                },
                            );
                            let _ = swarm
                                .behaviour_mut()
                                .request_response
                                .send_response(channel, ack);
                        }

                        // -- Legacy Introduce (keep for metadata exchange) --
                        Payload::Introduce { .. } => {
                            // Introduce is no longer used for auth; just ACK it
                            let ack = Envelope::new(
                                "local".into(),
                                Payload::Ack {
                                    acked_message_id: request.message_id.clone(),
                                },
                            );
                            let _ = swarm
                                .behaviour_mut()
                                .request_response
                                .send_response(channel, ack);
                        }

                        // -- Other payload types --------------------------
                        _ => {
                            let ack = Envelope::new(
                                "local".into(),
                                Payload::Ack {
                                    acked_message_id: request.message_id.clone(),
                                },
                            );
                            let _ = swarm
                                .behaviour_mut()
                                .request_response
                                .send_response(channel, ack);
                        }
                    }
                }
                request_response::Message::Response { response, .. } => {
                    let peer_str = peer.to_string();

                    // Handle Handshake response — process through stored state
                    if let Payload::Handshake { ref data } = response.payload {
                        let hs_msg: HandshakeMessage = match serde_json::from_str(data) {
                            Ok(m) => m,
                            Err(e) => {
                                eprintln!("P2P bad handshake response from {peer_str}: {e}");
                                pending_handshakes.remove(&peer_str);
                                return;
                            }
                        };

                        let state = match pending_handshakes.get_mut(&peer_str) {
                            Some(s) => s,
                            None => {
                                eprintln!("P2P handshake response from {peer_str} but no pending state");
                                return;
                            }
                        };

                        match state.process_message(hs_msg, identity) {
                            Ok(Some(next_msg)) => {
                                // Need to send next handshake message (e.g. Verify after ChallengeResponse)
                                let next_data = serde_json::to_string(&next_msg)
                                    .unwrap_or_default();
                                let envelope = Envelope::new(
                                    swarm.local_peer_id().to_string(),
                                    Payload::Handshake { data: next_data },
                                );
                                swarm
                                    .behaviour_mut()
                                    .request_response
                                    .send_request(&peer, envelope);
                            }
                            Ok(None) => {
                                // Handshake complete on initiator side
                                pending_handshakes.remove(&peer_str);
                                let was_new = authenticated_peers.insert(peer_str.clone());
                                if was_new {
                                    Self::emit_peer_connected(swarm, app_handle, &peer_str);
                                    Self::retry_queued_for_peer(swarm, app_handle, &peer_str);
                                }
                            }
                            Err(e) => {
                                eprintln!("P2P handshake error with {peer_str}: {e}");
                                pending_handshakes.remove(&peer_str);
                            }
                        }
                        return;
                    }

                    // Handle ACK payloads — update delivery state to "delivered"
                    if let Payload::Ack { ref acked_message_id } = response.payload {
                        let db = app_handle.state::<crate::db::Database>();
                        if let Ok(Some(msg)) =
                            crate::p2p::db::get_message_by_unique_id(&db, acked_message_id)
                        {
                            let _ = crate::p2p::db::update_message_state(
                                &db, &msg.id, None, Some("delivered"),
                            );
                            if let Ok(Some(outbox)) =
                                crate::p2p::db::get_outbox_by_message_id(&db, &msg.id)
                            {
                                let _ = crate::p2p::db::update_outbox_status(
                                    &db,
                                    &outbox.id,
                                    "delivered",
                                    outbox.attempts,
                                );
                            }
                            let _ = app_handle.emit(
                                "p2p:delivery-update",
                                super::secretary::DeliveryUpdate {
                                    message_id: msg.id,
                                    state: "delivered".to_string(),
                                },
                            );
                        }
                    }

                    let _ = app_handle.emit(
                        "p2p:incoming-message",
                        IncomingMessageEvent {
                            peer_id: peer.to_string(),
                            envelope: response,
                        },
                    );
                }
            },
            SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
                request_response::Event::OutboundFailure { peer, error, .. },
            )) => {
                eprintln!("P2P outbound failure to {peer}: {error}");

                // Mark "sending" outbox entries for this peer as queued for retry
                let peer_str = peer.to_string();
                let db = app_handle.state::<crate::db::Database>();
                if let Ok(entries) = crate::p2p::db::get_pending_outbox(&db) {
                    for entry in entries {
                        if entry.target_peer_id == peer_str && entry.status == "sending" {
                            let new_attempts = entry.attempts + 1;
                            let backoff_secs = 30i64 * (1i64 << (new_attempts - 1).min(4));
                            let next_retry = chrono::Utc::now()
                                + chrono::Duration::seconds(backoff_secs);
                            let _ = crate::p2p::db::update_outbox_retry(
                                &db,
                                &entry.id,
                                new_attempts,
                                &next_retry.to_rfc3339(),
                            );
                            let _ = crate::p2p::db::update_message_state(
                                &db,
                                &entry.peer_message_id,
                                None,
                                Some("queued"),
                            );
                            let _ = app_handle.emit(
                                "p2p:delivery-update",
                                super::secretary::DeliveryUpdate {
                                    message_id: entry.peer_message_id.clone(),
                                    state: "queued".to_string(),
                                },
                            );
                        }
                    }
                }
            }
            SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
                request_response::Event::InboundFailure { peer, error, .. },
            )) => {
                eprintln!("P2P inbound failure from {peer}: {error}");
            }

            // -- Connection lifecycle -----------------------------------------
            SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                let peer_id_str = peer_id.to_string();
                let is_known = known_peers.lock().unwrap().contains(&peer_id_str);

                // Initiate nonce/challenge handshake for known but unauthenticated peers
                if is_known && !authenticated_peers.contains(&peer_id_str) {
                    let (state, challenge_msg) = HandshakeState::new_initiator(identity);
                    pending_handshakes.insert(peer_id_str.clone(), state);

                    let data = serde_json::to_string(&challenge_msg).unwrap_or_default();
                    let envelope = Envelope::new(
                        swarm.local_peer_id().to_string(),
                        Payload::Handshake { data },
                    );
                    swarm
                        .behaviour_mut()
                        .request_response
                        .send_request(&peer_id, envelope);
                }

                let peer_count = swarm.connected_peers().count();
                let _ = app_handle.emit(
                    "p2p:connection-state",
                    ConnectionStateEvent {
                        status: "active".into(),
                        peer_count,
                    },
                );
            }
            SwarmEvent::ConnectionClosed { peer_id, .. } => {
                let peer_id_str = peer_id.to_string();
                authenticated_peers.remove(&peer_id_str);
                pending_handshakes.remove(&peer_id_str);

                let _ = app_handle.emit(
                    "p2p:peer-disconnected",
                    PeerDisconnectedEvent {
                        peer_id: peer_id_str,
                        reason: "connection_closed".into(),
                    },
                );
                let peer_count = swarm.connected_peers().count();
                let _ = app_handle.emit(
                    "p2p:connection-state",
                    ConnectionStateEvent {
                        status: "active".into(),
                        peer_count,
                    },
                );
            }

            // -- Listen address lifecycle ------------------------------------
            SwarmEvent::NewListenAddr { address, .. } => {
                let addr_str = address.to_string();
                // Filter out loopback and unspecified addresses
                let dominated_by_local = addr_str.contains("/ip4/127.")
                    || addr_str.contains("/ip6/::1/")
                    || addr_str.contains("/ip4/0.0.0.0/")
                    || addr_str.contains("/ip6/::/");
                if !dominated_by_local {
                    listen_addresses.lock().unwrap().push(addr_str);
                }
                // Extract port from address (last Tcp component)
                for proto in address.iter() {
                    if let libp2p::multiaddr::Protocol::Tcp(port) = proto {
                        // Store active_listen_port via app_handle state
                        if let Some(mgr) = app_handle.try_state::<P2PManager>() {
                            mgr.inner.lock().unwrap().active_listen_port = Some(port);
                        }
                        break;
                    }
                }
            }
            SwarmEvent::ExpiredListenAddr { address, .. } => {
                let addr_str = address.to_string();
                let mut addrs = listen_addresses.lock().unwrap();
                addrs.retain(|a| a != &addr_str);
            }
            SwarmEvent::ListenerClosed { .. } => {
                listen_addresses.lock().unwrap().clear();
            }

            // Ignore other events
            _ => {}
        }
    }

    // -----------------------------------------------------------------------
    // Handshake / message helpers
    // -----------------------------------------------------------------------

    /// Emit `p2p:peer-connected` and look up the contact display name.
    fn emit_peer_connected(
        swarm: &mut libp2p::Swarm<super::protocol::AgentBehaviour>,
        app_handle: &tauri::AppHandle,
        peer_str: &str,
    ) {
        let _ = swarm; // used only for consistency in call-sites
        let contact_name = {
            let db = app_handle.state::<crate::db::Database>();
            crate::p2p::db::get_contact_by_peer_id(&db, peer_str)
                .ok()
                .flatten()
                .map(|c| c.display_name)
                .unwrap_or_default()
        };
        let _ = app_handle.emit(
            "p2p:peer-connected",
            PeerConnectedEvent {
                peer_id: peer_str.to_string(),
                contact_name,
            },
        );
    }

    /// Persist an incoming `MessageResponse` as a peer message and emit event.
    fn persist_incoming_response(
        app_handle: &tauri::AppHandle,
        db: &crate::db::Database,
        peer_str: &str,
        envelope: &Envelope,
        content: &str,
    ) {
        // Look up contact to find thread
        let contact = match crate::p2p::db::get_contact_by_peer_id(db, peer_str) {
            Ok(Some(c)) => c,
            _ => {
                eprintln!("P2P MessageResponse from unknown contact: {peer_str}");
                return;
            }
        };

        // Find existing thread (there should be one if we sent a request)
        let threads = match crate::p2p::db::list_threads_for_contact(db, &contact.id) {
            Ok(t) => t,
            Err(_) => return,
        };
        let thread_id = match threads.first() {
            Some(t) => t.id.clone(),
            None => {
                eprintln!("P2P no thread found for contact {}", contact.id);
                return;
            }
        };

        let now = chrono::Utc::now().to_rfc3339();
        let msg_id = uuid::Uuid::new_v4().to_string();
        let raw_envelope = serde_json::to_string(envelope).ok();

        let msg = crate::p2p::db::PeerMessageRow {
            id: msg_id.clone(),
            thread_id,
            message_id_unique: envelope.message_id.clone(),
            correlation_id: envelope.correlation_id.clone(),
            direction: "incoming".to_string(),
            sender_agent: envelope.sender_agent.clone(),
            content: content.to_string(),
            approval_state: "none".to_string(),
            delivery_state: "received".to_string(),
            retry_count: 0,
            raw_envelope,
            created_at: now,
        };

        if let Err(e) = crate::p2p::db::insert_peer_message(db, &msg) {
            eprintln!("P2P failed to persist MessageResponse: {e}");
            return;
        }

        let _ = app_handle.emit(
            "p2p:incoming-message",
            IncomingMessageEvent {
                peer_id: peer_str.to_string(),
                envelope: envelope.clone(),
            },
        );
    }

    // -----------------------------------------------------------------------
    // Retry helpers
    // -----------------------------------------------------------------------

    /// Retry queued messages for a specific peer (called on handshake completion).
    fn retry_queued_for_peer(
        swarm: &mut libp2p::Swarm<super::protocol::AgentBehaviour>,
        app_handle: &tauri::AppHandle,
        peer_id_str: &str,
    ) {
        let db = app_handle.state::<crate::db::Database>();
        let entries = match crate::p2p::db::get_pending_outbox(&db) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries {
            if entry.target_peer_id != peer_id_str {
                continue;
            }

            let msg = match crate::p2p::db::get_peer_message(&db, &entry.peer_message_id) {
                Ok(Some(m)) => m,
                _ => continue,
            };

            let envelope = match msg
                .raw_envelope
                .as_ref()
                .and_then(|raw| serde_json::from_str::<Envelope>(raw).ok())
            {
                Some(e) => e,
                None => continue,
            };

            let peer_id: PeerId = match entry.target_peer_id.parse() {
                Ok(p) => p,
                Err(_) => continue,
            };

            swarm
                .behaviour_mut()
                .request_response
                .send_request(&peer_id, envelope);

            let new_attempts = entry.attempts + 1;
            let _ = crate::p2p::db::update_message_state(
                &db,
                &entry.peer_message_id,
                None,
                Some("sending"),
            );
            let _ =
                crate::p2p::db::update_outbox_status(&db, &entry.id, "sending", new_attempts);
        }
    }

    /// Periodic retry of pending outbox entries (called every 60s).
    fn retry_pending_outbox(
        swarm: &mut libp2p::Swarm<super::protocol::AgentBehaviour>,
        app_handle: &tauri::AppHandle,
        authenticated_peers: &HashSet<String>,
    ) {
        let db = app_handle.state::<crate::db::Database>();
        let entries = match crate::p2p::db::get_pending_outbox(&db) {
            Ok(e) => e,
            Err(_) => return,
        };

        let now = chrono::Utc::now();

        for entry in entries {
            // Only retry for authenticated peers
            if !authenticated_peers.contains(&entry.target_peer_id) {
                continue;
            }

            // Check if retry time has passed
            if let Some(ref next_retry) = entry.next_retry_at {
                if let Ok(retry_time) = chrono::DateTime::parse_from_rfc3339(next_retry) {
                    if retry_time > now {
                        continue;
                    }
                }
            }

            let msg = match crate::p2p::db::get_peer_message(&db, &entry.peer_message_id) {
                Ok(Some(m)) => m,
                _ => continue,
            };

            let envelope = match msg
                .raw_envelope
                .as_ref()
                .and_then(|raw| serde_json::from_str::<Envelope>(raw).ok())
            {
                Some(e) => e,
                None => continue,
            };

            let peer_id: PeerId = match entry.target_peer_id.parse() {
                Ok(p) => p,
                Err(_) => continue,
            };

            swarm
                .behaviour_mut()
                .request_response
                .send_request(&peer_id, envelope);

            let new_attempts = entry.attempts + 1;
            let _ = crate::p2p::db::update_message_state(
                &db,
                &entry.peer_message_id,
                None,
                Some("sending"),
            );
            let _ =
                crate::p2p::db::update_outbox_status(&db, &entry.id, "sending", new_attempts);
        }
    }
}
