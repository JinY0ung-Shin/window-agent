use std::collections::HashSet;

use axum::extract::ws::{Message, WebSocket};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use tracing::{info, warn};
use uuid::Uuid;
use wa_shared::protocol::*;

use crate::db;
use crate::state::{AppState, WsSender};

/// Derive the expected peer_id from an Ed25519 public key (hex-encoded first 16 bytes of the key).
fn derive_peer_id(public_key_bytes: &[u8]) -> String {
    hex::encode(&public_key_bytes[..16])
}

/// Send a `ServerMessage` over the channel.
fn send_msg(tx: &WsSender, msg: &ServerMessage) {
    let json = serde_json::to_string(msg).expect("serialize ServerMessage");
    let _ = tx.send(Message::Text(json.into()));
}

/// Handle a single WebSocket connection lifecycle.
pub async fn handle_socket(socket: WebSocket, state: AppState) {
    let (ws_sink, mut ws_stream) = socket.split();

    // Wrap sink in a channel so we can share it.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();

    // Spawn a task that forwards channel messages to the actual WebSocket sink.
    let mut sink = ws_sink;
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    // ── Step 1: Send Challenge ──
    let nonce = Uuid::new_v4().to_string();
    let challenge = ServerMessage::Challenge {
        nonce: nonce.clone(),
        server_time: chrono::Utc::now().to_rfc3339(),
    };
    send_msg(&tx, &challenge);

    // ── Step 2: Wait for Auth ──
    let peer_id = match wait_for_auth(&mut ws_stream, &tx, &state, &nonce).await {
        Some(id) => id,
        None => return, // Auth failed or connection dropped
    };

    info!(peer_id = %peer_id, "peer authenticated");

    // ── Step 3: Single-session policy — evict old connection ──
    let session_id = Uuid::new_v4().to_string();
    if let Some(old_tx) = state
        .insert_connection(&peer_id, tx.clone(), session_id.clone())
        .await
    {
        let err = ServerMessage::Error {
            code: "session_replaced".into(),
            message: "Another session connected with the same peer_id".into(),
        };
        send_msg(&old_tx, &err);
        // Dropping old_tx closes the channel → old WS sink task will end.
        drop(old_tx);
    }

    // ── Step 4: Notify presence subscribers that this peer is online ──
    notify_presence(&state, &peer_id, PresenceStatus::Online).await;

    // ── Step 5: Drain offline queue ──
    drain_offline_queue(&state, &peer_id, &tx).await;

    // ── Step 6: Message loop ──
    while let Some(Ok(msg)) = ws_stream.next().await {
        match msg {
            Message::Text(text) => {
                let Ok(client_msg) = serde_json::from_str::<ClientMessage>(&text) else {
                    send_msg(
                        &tx,
                        &ServerMessage::Error {
                            code: "bad_request".into(),
                            message: "Invalid JSON message".into(),
                        },
                    );
                    continue;
                };
                handle_client_message(&state, &peer_id, &tx, client_msg).await;
            }
            Message::Close(_) => break,
            _ => {} // Ignore ping/pong/binary
        }
    }

    // ── Cleanup ──
    // Only remove connection & notify offline if this session is still the active one.
    // A replaced session must NOT remove the newer connection.
    if state.remove_connection_if_session(&peer_id, &session_id).await {
        state.remove_presence_subscriptions(&peer_id).await;
        notify_presence(&state, &peer_id, PresenceStatus::Offline).await;
    }
    info!(peer_id = %peer_id, "peer disconnected");
}

/// Wait for the client to send an Auth message. Returns authenticated peer_id.
async fn wait_for_auth(
    ws_stream: &mut futures_util::stream::SplitStream<WebSocket>,
    tx: &WsSender,
    state: &AppState,
    nonce: &str,
) -> Option<String> {
    // Give client 10 seconds to authenticate.
    let auth_timeout = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(Ok(msg)) = ws_stream.next().await {
            if let Message::Text(text) = msg {
                return serde_json::from_str::<ClientMessage>(&text).ok();
            }
        }
        None
    });

    let client_msg = match auth_timeout.await {
        Ok(Some(msg)) => msg,
        _ => {
            send_msg(
                tx,
                &ServerMessage::Error {
                    code: "auth_timeout".into(),
                    message: "Authentication timed out".into(),
                },
            );
            return None;
        }
    };

    let ClientMessage::Auth {
        peer_id,
        public_key,
        signature,
    } = client_msg
    else {
        send_msg(
            tx,
            &ServerMessage::Error {
                code: "auth_required".into(),
                message: "Expected Auth message".into(),
            },
        );
        return None;
    };

    // Decode base64 public key and signature.
    let pk_bytes = match B64.decode(&public_key) {
        Ok(b) if b.len() == 32 => b,
        _ => {
            send_msg(
                tx,
                &ServerMessage::Error {
                    code: "invalid_key".into(),
                    message: "Public key must be 32 bytes (base64)".into(),
                },
            );
            return None;
        }
    };

    let sig_bytes = match B64.decode(&signature) {
        Ok(b) if b.len() == 64 => b,
        _ => {
            send_msg(
                tx,
                &ServerMessage::Error {
                    code: "invalid_signature".into(),
                    message: "Signature must be 64 bytes (base64)".into(),
                },
            );
            return None;
        }
    };

    // Verify peer_id == derive(public_key)
    let expected_peer_id = derive_peer_id(&pk_bytes);
    if peer_id != expected_peer_id {
        send_msg(
            tx,
            &ServerMessage::Error {
                code: "peer_id_mismatch".into(),
                message: "peer_id does not match public_key".into(),
            },
        );
        return None;
    }

    // Verify Ed25519 signature over the nonce.
    let verifying_key = match VerifyingKey::from_bytes(pk_bytes.as_slice().try_into().unwrap()) {
        Ok(k) => k,
        Err(_) => {
            send_msg(
                tx,
                &ServerMessage::Error {
                    code: "invalid_key".into(),
                    message: "Invalid Ed25519 public key".into(),
                },
            );
            return None;
        }
    };

    let sig = Signature::from_bytes(sig_bytes.as_slice().try_into().unwrap());
    if verifying_key.verify(nonce.as_bytes(), &sig).is_err() {
        send_msg(
            tx,
            &ServerMessage::Error {
                code: "auth_failed".into(),
                message: "Signature verification failed".into(),
            },
        );
        return None;
    }

    // Register or verify key binding.
    if state.register_key(&peer_id, &pk_bytes).await.is_err() {
        send_msg(
            tx,
            &ServerMessage::Error {
                code: "key_mismatch".into(),
                message: "Public key does not match previously registered key for this peer_id"
                    .into(),
            },
        );
        return None;
    }

    send_msg(&tx, &ServerMessage::AuthOk { peer_id: peer_id.clone() });
    Some(peer_id)
}

/// Handle an authenticated client message.
async fn handle_client_message(
    state: &AppState,
    sender_peer_id: &str,
    sender_tx: &WsSender,
    msg: ClientMessage,
) {
    match msg {
        ClientMessage::Auth { .. } => {
            send_msg(
                sender_tx,
                &ServerMessage::Error {
                    code: "already_authenticated".into(),
                    message: "Already authenticated".into(),
                },
            );
        }

        ClientMessage::Envelope {
            target_peer_id,
            envelope,
        } => {
            handle_envelope(state, sender_peer_id, sender_tx, &target_peer_id, envelope).await;
        }

        ClientMessage::PeerAck {
            message_id,
            sender_peer_id: original_sender,
        } => {
            handle_peer_ack(state, &message_id, &original_sender).await;
        }

        ClientMessage::SubscribePresence { peer_ids } => {
            handle_subscribe_presence(state, sender_peer_id, sender_tx, peer_ids).await;
        }
    }
}

/// Route an envelope to the target peer.
async fn handle_envelope(
    state: &AppState,
    sender_peer_id: &str,
    sender_tx: &WsSender,
    target_peer_id: &str,
    envelope: serde_json::Value,
) {
    // Extract message_id from the envelope for ACK/dedup.
    let message_id = envelope
        .get("message_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Dedup check.
    if !message_id.is_empty() && state.check_and_mark_seen(&message_id).await {
        // Already processed — send Delivered ACK and return.
        send_msg(
            sender_tx,
            &ServerMessage::ServerAck {
                message_id,
                status: AckStatus::Delivered,
            },
        );
        return;
    }

    // Try to deliver to online target.
    if let Some(target_tx) = state.get_sender(target_peer_id).await {
        let forward = ServerMessage::Envelope {
            sender_peer_id: sender_peer_id.to_string(),
            envelope,
        };
        send_msg(&target_tx, &forward);

        if !message_id.is_empty() {
            send_msg(
                sender_tx,
                &ServerMessage::ServerAck {
                    message_id,
                    status: AckStatus::Delivered,
                },
            );
        }
    } else {
        // Target offline — queue.
        let envelope_json = serde_json::to_string(&envelope).unwrap_or_default();
        if let Err(e) = db::enqueue(
            state.db(),
            target_peer_id,
            sender_peer_id,
            &message_id,
            &envelope_json,
        )
        .await
        {
            warn!(error = %e, "Failed to enqueue offline message");
            send_msg(
                sender_tx,
                &ServerMessage::Error {
                    code: "queue_error".into(),
                    message: "Failed to queue message".into(),
                },
            );
            return;
        }

        if !message_id.is_empty() {
            send_msg(
                sender_tx,
                &ServerMessage::ServerAck {
                    message_id,
                    status: AckStatus::Queued,
                },
            );
        }
    }
}

/// Handle a PeerAck from the receiver.
async fn handle_peer_ack(state: &AppState, message_id: &str, original_sender: &str) {
    // Remove from offline queue if present.
    let _ = db::remove_by_message_id(state.db(), message_id).await;

    // Forward PeerAck to original sender if online.
    if let Some(sender_tx) = state.get_sender(original_sender).await {
        send_msg(
            &sender_tx,
            &ServerMessage::PeerAck {
                message_id: message_id.to_string(),
            },
        );
    }
}

/// Handle a presence subscription request.
async fn handle_subscribe_presence(
    state: &AppState,
    subscriber: &str,
    subscriber_tx: &WsSender,
    peer_ids: Vec<String>,
) {
    let target_set: HashSet<String> = peer_ids.iter().cloned().collect();
    state
        .set_presence_subscriptions(subscriber, target_set)
        .await;

    // Send immediate snapshot.
    let mut peers = Vec::new();
    for pid in &peer_ids {
        let online = state.is_online(pid).await;
        peers.push(PeerPresenceInfo {
            peer_id: pid.clone(),
            status: if online {
                PresenceStatus::Online
            } else {
                PresenceStatus::Offline
            },
            last_seen: None,
        });
    }
    send_msg(subscriber_tx, &ServerMessage::PresenceSnapshot { peers });
}

/// Notify all subscribers that a peer's presence changed.
async fn notify_presence(state: &AppState, peer_id: &str, status: PresenceStatus) {
    let subscribers = state.subscribers_of(peer_id).await;
    let msg = ServerMessage::Presence {
        peer_id: peer_id.to_string(),
        status,
        last_seen: None,
    };
    for sub_id in subscribers {
        if let Some(sub_tx) = state.get_sender(&sub_id).await {
            send_msg(&sub_tx, &msg);
        }
    }
}

/// Drain the offline queue for a newly connected peer.
async fn drain_offline_queue(state: &AppState, peer_id: &str, tx: &WsSender) {
    match db::drain(state.db(), peer_id).await {
        Ok(messages) => {
            for queued in messages {
                let envelope: serde_json::Value =
                    serde_json::from_str(&queued.envelope_json).unwrap_or_default();
                let msg = ServerMessage::Envelope {
                    sender_peer_id: queued.sender_peer_id,
                    envelope,
                };
                send_msg(tx, &msg);
            }
        }
        Err(e) => {
            warn!(error = %e, "Failed to drain offline queue");
        }
    }
}
