use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::StreamExt;
use libp2p::{mdns, request_response, swarm::SwarmEvent};
use tauri::{Emitter, Manager};
use tokio::sync::mpsc;

use super::super::envelope::{Envelope, Payload};
use super::super::identity::NodeIdentity;
use super::super::protocol::AgentBehaviourEvent;
use super::super::security::{HandshakeMessage, HandshakeState};
use super::{
    P2PCommand, P2PManager, ConnectionStateEvent,
    PeerDisconnectedEvent,
};

pub(crate) async fn run_event_loop(
    mut swarm: libp2p::Swarm<super::super::protocol::AgentBehaviour>,
    mut cmd_rx: mpsc::Receiver<P2PCommand>,
    app_handle: &tauri::AppHandle,
    known_peers: &Arc<Mutex<HashSet<String>>>,
    shared_authenticated: &Arc<Mutex<HashSet<String>>>,
    listen_addresses: &Arc<Mutex<Vec<String>>>,
    identity: &NodeIdentity,
) {
    let mut authenticated_peers: HashSet<String> = HashSet::new();
    let mut pending_handshakes: HashMap<String, (HandshakeState, Instant)> = HashMap::new();
    let mut retry_interval = tokio::time::interval(Duration::from_secs(60));
    // Consume the first immediate tick so the retry doesn't fire at t=0
    retry_interval.tick().await;

    loop {
        tokio::select! {
            event = swarm.select_next_some() => {
                handle_swarm_event(&mut swarm, event, app_handle, known_peers, &mut authenticated_peers, &mut pending_handshakes, listen_addresses, identity);
                // Sync authenticated set to shared state for external callers
                if let Ok(mut shared) = shared_authenticated.lock() {
                    *shared = authenticated_peers.clone();
                }
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
                super::helpers::retry_pending_outbox(&mut swarm, app_handle, &authenticated_peers);
                // Reap stale pending handshakes (>30s) and re-initiate if still connected
                let stale_peers: Vec<String> = pending_handshakes
                    .iter()
                    .filter(|(_, (_, ts))| ts.elapsed() > Duration::from_secs(30))
                    .map(|(k, _)| k.clone())
                    .collect();
                for peer_str in stale_peers {
                    pending_handshakes.remove(&peer_str);
                    let is_known = known_peers.lock().map(|g| g.contains(&peer_str)).unwrap_or(false);
                    if is_known && !authenticated_peers.contains(&peer_str) {
                        if let Ok(peer_id) = peer_str.parse::<libp2p::PeerId>() {
                            if swarm.is_connected(&peer_id) {
                                let (state, challenge_msg) = HandshakeState::new_initiator(identity);
                                pending_handshakes.insert(peer_str, (state, Instant::now()));
                                let data = serde_json::to_string(&challenge_msg).unwrap_or_default();
                                let envelope = Envelope::new(
                                    swarm.local_peer_id().to_string(),
                                    Payload::Handshake { data },
                                );
                                swarm.behaviour_mut().request_response.send_request(&peer_id, envelope);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_swarm_event(
    swarm: &mut libp2p::Swarm<super::super::protocol::AgentBehaviour>,
    event: SwarmEvent<AgentBehaviourEvent>,
    app_handle: &tauri::AppHandle,
    known_peers: &Arc<Mutex<HashSet<String>>>,
    authenticated_peers: &mut HashSet<String>,
    pending_handshakes: &mut HashMap<String, (HandshakeState, Instant)>,
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
                let is_known = known_peers.lock().map(|g| g.contains(&peer_id_str)).unwrap_or(false);

                // Auto-dial known peers to trigger handshake
                if is_known && !authenticated_peers.contains(&peer_id_str) {
                    let _ = swarm.dial(peer_id);
                }
            }
        }
        SwarmEvent::Behaviour(AgentBehaviourEvent::Mdns(mdns::Event::Expired(peers))) => {
            for (peer_id, _addr) in peers {
                if !swarm.is_connected(&peer_id) {
                    let _ = app_handle.emit(
                        "p2p:peer-disconnected",
                        PeerDisconnectedEvent {
                            peer_id: peer_id.to_string(),
                            reason: "mdns_expired".into(),
                        },
                    );
                }
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
                let is_known = known_peers.lock().map(|g| g.contains(&peer_str)).unwrap_or(false);

                // Handshake requests are allowed from known (but not yet authenticated) peers
                if !is_known {
                    tracing::warn!(peer = %peer_str, "P2P rejecting message from unknown peer");
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
                                tracing::warn!(peer = %peer_str, error = %e, "P2P bad handshake data");
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
                        let (state, _) = pending_handshakes
                            .entry(peer_str.clone())
                            .or_insert_with(|| (HandshakeState::new_responder(), Instant::now()));

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
                                        super::helpers::emit_peer_connected(
                                            swarm, app_handle, &peer_str,
                                        );
                                        super::helpers::retry_queued_for_peer(
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
                                    super::helpers::emit_peer_connected(swarm, app_handle, &peer_str);
                                    super::helpers::retry_queued_for_peer(swarm, app_handle, &peer_str);
                                }
                            }
                            Err(e) => {
                                tracing::warn!(peer = %peer_str, error = %e, "P2P handshake error");
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
                            tracing::warn!(peer = %peer_str, "P2P rejecting message from unauthenticated peer");
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

                        // Capability check
                        let db = app_handle.state::<crate::db::Database>();
                        let allowed = crate::p2p::db::get_contact_by_peer_id(&db, &peer_str)
                            .ok()
                            .flatten()
                            .and_then(|c| serde_json::from_str::<crate::p2p::capability::CapabilitySet>(&c.capabilities_json).ok())
                            .map(|caps| caps.is_allowed(&crate::p2p::capability::CapabilityAction::SendMessage))
                            .unwrap_or(false);

                        if !allowed {
                            tracing::warn!(peer = %peer_str, "P2P rejecting message: capability denied");
                            let reject = Envelope::new(
                                "local".into(),
                                Payload::Error {
                                    code: "CAPABILITY_DENIED".into(),
                                    message: "SendMessage capability not granted".into(),
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
                            if let Err(e) = super::super::secretary::handle_incoming_message(
                                &app_clone, &db, &peer_str, &request,
                            )
                            .await
                            {
                                tracing::error!(error = %e, "Secretary error processing message");
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
                            tracing::warn!(peer = %peer_str, "P2P rejecting response from unauthenticated peer");
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

                        // Capability check (same as MessageRequest)
                        {
                            let db = app_handle.state::<crate::db::Database>();
                            let allowed = crate::p2p::db::get_contact_by_peer_id(&db, &peer_str)
                                .ok()
                                .flatten()
                                .and_then(|c| serde_json::from_str::<crate::p2p::capability::CapabilitySet>(&c.capabilities_json).ok())
                                .map(|caps| caps.is_allowed(&crate::p2p::capability::CapabilityAction::SendMessage))
                                .unwrap_or(false);
                            if !allowed {
                                tracing::warn!(peer = %peer_str, "P2P rejecting response: capability denied");
                                let reject = Envelope::new(
                                    "local".into(),
                                    Payload::Error {
                                        code: "CAPABILITY_DENIED".into(),
                                        message: "SendMessage capability not granted".into(),
                                    },
                                );
                                let _ = swarm.behaviour_mut().request_response.send_response(channel, reject);
                                return;
                            }
                        }

                        // Persist the response as an incoming message
                        let content_clone = content.clone();
                        let request_clone = request.clone();
                        let app_clone = app_handle.clone();
                        tokio::spawn(async move {
                            let db = app_clone.state::<crate::db::Database>();
                            super::helpers::persist_incoming_response(
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
                            tracing::warn!(peer = %peer_str, error = %e, "P2P bad handshake response");
                            pending_handshakes.remove(&peer_str);
                            return;
                        }
                    };

                    let (state, _) = match pending_handshakes.get_mut(&peer_str) {
                        Some(s) => s,
                        None => {
                            tracing::warn!(peer = %peer_str, "P2P handshake response but no pending state");
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
                                super::helpers::emit_peer_connected(swarm, app_handle, &peer_str);
                                super::helpers::retry_queued_for_peer(swarm, app_handle, &peer_str);
                            }
                        }
                        Err(e) => {
                            tracing::warn!(peer = %peer_str, error = %e, "P2P handshake error");
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
                            super::super::secretary::DeliveryUpdate {
                                message_id: msg.id,
                                state: "delivered".to_string(),
                            },
                        );
                    }
                }

                // Handle Error payloads — log for diagnostics
                if let Payload::Error { ref code, ref message } = response.payload {
                    tracing::warn!(peer = %peer_str, code = %code, message = %message, "P2P remote error response");
                    // Don't auto-fail outbox entries here — we can't correlate which
                    // specific request this error belongs to. Stale "sending" entries
                    // are handled by the periodic retry loop's timeout logic.
                }

            }
        },
        SwarmEvent::Behaviour(AgentBehaviourEvent::RequestResponse(
            request_response::Event::OutboundFailure { peer, error, .. },
        )) => {
            tracing::warn!(peer = %peer, error = %error, "P2P outbound failure");

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
                            super::super::secretary::DeliveryUpdate {
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
            tracing::warn!(peer = %peer, error = %error, "P2P inbound failure");
        }

        // -- Connection lifecycle -----------------------------------------
        SwarmEvent::ConnectionEstablished { peer_id, .. } => {
            let peer_id_str = peer_id.to_string();
            let is_known = known_peers.lock().map(|g| g.contains(&peer_id_str)).unwrap_or(false);

            // Initiate nonce/challenge handshake for known but unauthenticated peers.
            // Allow restart if existing handshake is stale (>30s — covers relay→direct handoff).
            let handshake_stale = pending_handshakes
                .get(&peer_id_str)
                .map(|(_, ts)| ts.elapsed() > Duration::from_secs(30))
                .unwrap_or(false);
            let should_handshake = is_known
                && !authenticated_peers.contains(&peer_id_str)
                && (!pending_handshakes.contains_key(&peer_id_str) || handshake_stale);
            if should_handshake {
                let (state, challenge_msg) = HandshakeState::new_initiator(identity);
                pending_handshakes.insert(peer_id_str.clone(), (state, Instant::now()));

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
            // Only deauthenticate/disconnect if no other connection to this peer remains
            // (relay→direct handoff closes the relay connection while direct stays open)
            if !swarm.is_connected(&peer_id) {
                authenticated_peers.remove(&peer_id_str);
                pending_handshakes.remove(&peer_id_str);

                let _ = app_handle.emit(
                    "p2p:peer-disconnected",
                    PeerDisconnectedEvent {
                        peer_id: peer_id_str.clone(),
                        reason: "connection_closed".into(),
                    },
                );
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

        // -- Listen address lifecycle ------------------------------------
        SwarmEvent::NewListenAddr { address, .. } => {
            let addr_str = address.to_string();
            // Filter out loopback and unspecified addresses
            let dominated_by_local = addr_str.contains("/ip4/127.")
                || addr_str.contains("/ip6/::1/")
                || addr_str.contains("/ip4/0.0.0.0/")
                || addr_str.contains("/ip6/::/");
            if !dominated_by_local {
                if let Ok(mut addrs) = listen_addresses.lock() {
                    addrs.push(addr_str);
                }
            }
            // Extract port from address (last Tcp component)
            for proto in address.iter() {
                if let libp2p::multiaddr::Protocol::Tcp(port) = proto {
                    // Store active_listen_port via app_handle state
                    if let Some(mgr) = app_handle.try_state::<P2PManager>() {
                        if let Ok(mut inner) = mgr.inner.lock() {
                            inner.active_listen_port = Some(port);
                        }
                    }
                    break;
                }
            }
        }
        SwarmEvent::ExpiredListenAddr { address, .. } => {
            let addr_str = address.to_string();
            if let Ok(mut addrs) = listen_addresses.lock() {
                addrs.retain(|a| a != &addr_str);
            }
        }
        SwarmEvent::ListenerClosed { .. } => {
            if let Ok(mut addrs) = listen_addresses.lock() {
                addrs.clear();
            }
        }

        // Ignore other events
        _ => {}
    }
}
