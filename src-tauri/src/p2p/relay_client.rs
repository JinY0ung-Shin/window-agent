//! WebSocket relay client — connection lifecycle, challenge/response auth,
//! message send/receive, and auto-reconnect with exponential backoff.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey};
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tracing::{info, warn};
use wa_shared::protocol::*;

use crate::p2p::identity::NodeIdentity;

/// Derive the relay-compatible peer_id from an Ed25519 public key.
/// Matches the server's derivation: hex-encoded first 16 bytes.
pub fn derive_relay_peer_id(public_key: &[u8; 32]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(32);
    for b in &public_key[..16] {
        let _ = write!(s, "{:02x}", b);
    }
    s
}

// ── Events ──

#[derive(Debug, Clone)]
pub enum RelayEvent {
    Connected,
    Disconnected { will_reconnect: bool },
    Envelope {
        sender_peer_id: String,
        envelope: serde_json::Value,
    },
    ServerAck {
        message_id: String,
        status: AckStatus,
    },
    PeerAck {
        message_id: String,
    },
    Presence {
        peer_id: String,
        status: PresenceStatus,
        last_seen: Option<String>,
    },
    PresenceSnapshot {
        peers: Vec<PeerPresenceInfo>,
    },
    Error {
        code: String,
        message: String,
    },
}

// ── Commands ──

enum Command {
    SendEnvelope {
        target_peer_id: String,
        envelope: serde_json::Value,
    },
    SendPeerAck {
        message_id: String,
        sender_peer_id: String,
    },
    SubscribePresence {
        peer_ids: Vec<String>,
    },
    Shutdown,
}

// ── Handle ──

/// Handle for sending commands to the relay client task.
#[derive(Clone)]
pub struct RelayHandle {
    cmd_tx: mpsc::UnboundedSender<Command>,
    peer_id: String,
}

impl RelayHandle {
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }

    pub fn send_envelope(
        &self,
        target_peer_id: &str,
        envelope: serde_json::Value,
    ) -> Result<(), RelayClientError> {
        self.cmd_tx
            .send(Command::SendEnvelope {
                target_peer_id: target_peer_id.to_string(),
                envelope,
            })
            .map_err(|_| RelayClientError::Closed)
    }

    pub fn send_peer_ack(
        &self,
        message_id: &str,
        sender_peer_id: &str,
    ) -> Result<(), RelayClientError> {
        self.cmd_tx
            .send(Command::SendPeerAck {
                message_id: message_id.to_string(),
                sender_peer_id: sender_peer_id.to_string(),
            })
            .map_err(|_| RelayClientError::Closed)
    }

    pub fn subscribe_presence(&self, peer_ids: Vec<String>) -> Result<(), RelayClientError> {
        self.cmd_tx
            .send(Command::SubscribePresence { peer_ids })
            .map_err(|_| RelayClientError::Closed)
    }

    pub fn shutdown(&self) {
        let _ = self.cmd_tx.send(Command::Shutdown);
    }
}

// ── Error ──

#[derive(Debug, thiserror::Error)]
pub enum RelayClientError {
    #[error("connection error: {0}")]
    Connection(String),
    #[error("auth error: {0}")]
    Auth(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("identity error: {0}")]
    Identity(String),
    #[error("relay client closed")]
    Closed,
}

// ── Public entry point ──

/// Start the relay client. Returns a handle and an event receiver.
/// Spawns an async task that manages the WS connection with auto-reconnect.
pub fn start(
    relay_url: String,
    identity: &NodeIdentity,
) -> Result<(RelayHandle, mpsc::UnboundedReceiver<RelayEvent>), RelayClientError> {
    let signing_key = identity.signing_key().clone();
    let public_key = identity.public_key_bytes();
    let peer_id = derive_relay_peer_id(&public_key);
    let public_key_b64 = B64.encode(public_key);

    let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
    let (event_tx, event_rx) = mpsc::unbounded_channel();

    let handle = RelayHandle {
        cmd_tx,
        peer_id: peer_id.clone(),
    };

    tokio::spawn(connection_loop(
        relay_url,
        signing_key,
        peer_id,
        public_key_b64,
        cmd_rx,
        event_tx,
    ));

    Ok((handle, event_rx))
}

// ── Connection loop with auto-reconnect ──

async fn connection_loop(
    relay_url: String,
    signing_key: SigningKey,
    peer_id: String,
    public_key_b64: String,
    mut cmd_rx: mpsc::UnboundedReceiver<Command>,
    event_tx: mpsc::UnboundedSender<RelayEvent>,
) {
    let mut backoff = Duration::from_secs(1);
    let max_backoff = Duration::from_secs(60);

    loop {
        match run_session(
            &relay_url,
            &signing_key,
            &peer_id,
            &public_key_b64,
            &mut cmd_rx,
            &event_tx,
        )
        .await
        {
            SessionResult::Shutdown => {
                let _ = event_tx.send(RelayEvent::Disconnected {
                    will_reconnect: false,
                });
                return;
            }
            SessionResult::Error(e) => {
                warn!(error = %e, "relay session ended");
                let _ = event_tx.send(RelayEvent::Disconnected {
                    will_reconnect: true,
                });

                // Wait with backoff; exit early on shutdown
                let sleep = tokio::time::sleep(backoff);
                tokio::pin!(sleep);
                loop {
                    tokio::select! {
                        _ = &mut sleep => break,
                        cmd = cmd_rx.recv() => match cmd {
                            Some(Command::Shutdown) | None => {
                                let _ = event_tx.send(RelayEvent::Disconnected { will_reconnect: false });
                                return;
                            }
                            _ => {} // discard queued commands during backoff
                        },
                    }
                }

                backoff = (backoff * 2).min(max_backoff);
            }
        }
    }
}

enum SessionResult {
    Shutdown,
    Error(RelayClientError),
}

/// Single WS session: connect → auth → message loop.
async fn run_session(
    relay_url: &str,
    signing_key: &SigningKey,
    peer_id: &str,
    public_key_b64: &str,
    cmd_rx: &mut mpsc::UnboundedReceiver<Command>,
    event_tx: &mpsc::UnboundedSender<RelayEvent>,
) -> SessionResult {
    let ws = match connect_and_auth(relay_url, signing_key, peer_id, public_key_b64).await {
        Ok(ws) => ws,
        Err(e) => return SessionResult::Error(e),
    };

    let _ = event_tx.send(RelayEvent::Connected);
    info!(peer_id = %peer_id, "connected to relay");

    let (mut write, mut read) = ws.split();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.tick().await; // consume immediate first tick

    loop {
        tokio::select! {
            msg = read.next() => match msg {
                Some(Ok(WsMessage::Text(text))) => {
                    dispatch_server_message(&text, event_tx);
                }
                Some(Ok(WsMessage::Ping(data))) => {
                    let _ = write.send(WsMessage::Pong(data)).await;
                }
                Some(Ok(WsMessage::Close(_))) | None => {
                    return SessionResult::Error(
                        RelayClientError::Connection("connection closed".into()),
                    );
                }
                Some(Err(e)) => {
                    return SessionResult::Error(
                        RelayClientError::Connection(e.to_string()),
                    );
                }
                _ => {}
            },

            cmd = cmd_rx.recv() => match cmd {
                Some(Command::Shutdown) | None => {
                    let _ = write.send(WsMessage::Close(None)).await;
                    return SessionResult::Shutdown;
                }
                Some(cmd) => {
                    if let Err(e) = send_command(&mut write, cmd).await {
                        return SessionResult::Error(e);
                    }
                }
            },

            _ = heartbeat.tick() => {
                if write.send(WsMessage::Ping(vec![].into())).await.is_err() {
                    return SessionResult::Error(
                        RelayClientError::Connection("heartbeat failed".into()),
                    );
                }
            }
        }
    }
}

// ── Auth handshake ──

async fn connect_and_auth(
    url: &str,
    signing_key: &SigningKey,
    peer_id: &str,
    public_key_b64: &str,
) -> Result<
    tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    RelayClientError,
> {
    let (mut ws, _) = tokio_tungstenite::connect_async(url)
        .await
        .map_err(|e| RelayClientError::Connection(e.to_string()))?;

    // Read Challenge
    let nonce = match read_text_message(&mut ws).await? {
        ServerMessage::Challenge { nonce, .. } => nonce,
        _ => return Err(RelayClientError::Protocol("expected Challenge".into())),
    };

    // Sign nonce and send Auth
    let signature = signing_key.sign(nonce.as_bytes());
    let auth = ClientMessage::Auth {
        peer_id: peer_id.to_string(),
        public_key: public_key_b64.to_string(),
        signature: B64.encode(signature.to_bytes()),
    };
    ws.send(WsMessage::Text(
        serde_json::to_string(&auth).unwrap().into(),
    ))
    .await
    .map_err(|e| RelayClientError::Connection(e.to_string()))?;

    // Read AuthOk
    match read_text_message(&mut ws).await? {
        ServerMessage::AuthOk { .. } => Ok(ws),
        ServerMessage::Error { code, message } => {
            Err(RelayClientError::Auth(format!("{code}: {message}")))
        }
        _ => Err(RelayClientError::Protocol("expected AuthOk".into())),
    }
}

/// Read and parse one text-frame ServerMessage from a WS stream.
async fn read_text_message<S>(ws: &mut S) -> Result<ServerMessage, RelayClientError>
where
    S: StreamExt<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let frame = ws
        .next()
        .await
        .ok_or_else(|| RelayClientError::Protocol("connection closed unexpectedly".into()))?
        .map_err(|e| RelayClientError::Connection(e.to_string()))?;

    match frame {
        WsMessage::Text(text) => serde_json::from_str(&text)
            .map_err(|e| RelayClientError::Protocol(e.to_string())),
        _ => Err(RelayClientError::Protocol("expected text frame".into())),
    }
}

// ── Message dispatch ──

fn dispatch_server_message(text: &str, event_tx: &mpsc::UnboundedSender<RelayEvent>) {
    let msg: ServerMessage = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            warn!(error = %e, "failed to parse server message");
            return;
        }
    };

    let event = match msg {
        ServerMessage::Envelope {
            sender_peer_id,
            envelope,
        } => RelayEvent::Envelope {
            sender_peer_id,
            envelope,
        },
        ServerMessage::ServerAck { message_id, status } => {
            RelayEvent::ServerAck { message_id, status }
        }
        ServerMessage::PeerAck { message_id } => RelayEvent::PeerAck { message_id },
        ServerMessage::Presence {
            peer_id,
            status,
            last_seen,
        } => RelayEvent::Presence {
            peer_id,
            status,
            last_seen,
        },
        ServerMessage::PresenceSnapshot { peers } => RelayEvent::PresenceSnapshot { peers },
        ServerMessage::Error { code, message } => RelayEvent::Error { code, message },
        ServerMessage::Challenge { .. } | ServerMessage::AuthOk { .. } => return,
    };

    let _ = event_tx.send(event);
}

/// Serialize a Command into a ClientMessage and send it over the WS.
async fn send_command<S>(write: &mut S, cmd: Command) -> Result<(), RelayClientError>
where
    S: SinkExt<WsMessage> + Unpin,
    S::Error: std::fmt::Display,
{
    let client_msg = match cmd {
        Command::SendEnvelope {
            target_peer_id,
            envelope,
        } => ClientMessage::Envelope {
            target_peer_id,
            envelope,
        },
        Command::SendPeerAck {
            message_id,
            sender_peer_id,
        } => ClientMessage::PeerAck {
            message_id,
            sender_peer_id,
        },
        Command::SubscribePresence { peer_ids } => ClientMessage::SubscribePresence { peer_ids },
        Command::Shutdown => unreachable!(),
    };

    let json = serde_json::to_string(&client_msg).unwrap();
    write
        .send(WsMessage::Text(json.into()))
        .await
        .map_err(|e| RelayClientError::Connection(e.to_string()))
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Verifier;
    use tokio::net::TcpListener;

    async fn mock_server_listener() -> (String, TcpListener) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        (format!("ws://127.0.0.1:{port}"), listener)
    }

    /// Run a mock relay server that authenticates one client and processes messages.
    async fn mock_server_session(
        listener: TcpListener,
    ) -> (
        String, // authenticated peer_id
        futures_util::stream::SplitStream<
            tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
        >,
        futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
            WsMessage,
        >,
    ) {
        let (stream, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();

        // Send Challenge
        let nonce = "test-nonce-42";
        let challenge = ServerMessage::Challenge {
            nonce: nonce.to_string(),
            server_time: "2026-03-21T00:00:00Z".to_string(),
        };
        ws.send(WsMessage::Text(
            serde_json::to_string(&challenge).unwrap().into(),
        ))
        .await
        .unwrap();

        // Read Auth
        let msg = ws.next().await.unwrap().unwrap();
        let text = match msg {
            WsMessage::Text(t) => t,
            other => panic!("expected text, got {other:?}"),
        };
        let auth: ClientMessage = serde_json::from_str(&text).unwrap();
        let (peer_id, pk_bytes) = match auth {
            ClientMessage::Auth {
                peer_id,
                public_key,
                signature,
            } => {
                let pk = B64.decode(&public_key).unwrap();
                let sig = B64.decode(&signature).unwrap();
                let vk = ed25519_dalek::VerifyingKey::from_bytes(
                    pk.as_slice().try_into().unwrap(),
                )
                .unwrap();
                let sig =
                    ed25519_dalek::Signature::from_bytes(sig.as_slice().try_into().unwrap());
                vk.verify(nonce.as_bytes(), &sig).unwrap();

                let expected = derive_relay_peer_id(pk.as_slice().try_into().unwrap());
                assert_eq!(peer_id, expected);
                (peer_id, pk)
            }
            _ => panic!("expected Auth"),
        };

        // Send AuthOk
        ws.send(WsMessage::Text(
            serde_json::to_string(&ServerMessage::AuthOk {
                peer_id: peer_id.clone(),
            })
            .unwrap()
            .into(),
        ))
        .await
        .unwrap();

        let _ = pk_bytes;
        let (write, read) = ws.split();
        (peer_id, read, write)
    }

    #[test]
    fn test_derive_relay_peer_id() {
        let key = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a,
            0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
        ];
        assert_eq!(
            derive_relay_peer_id(&key),
            "0102030405060708090a0b0c0d0e0f10"
        );
    }

    #[tokio::test]
    async fn test_connect_auth_and_receive_event() {
        let (url, listener) = mock_server_listener().await;
        let identity = NodeIdentity::generate();

        // Spawn mock server
        let server = tokio::spawn(async move {
            let (peer_id, _read, mut write) = mock_server_session(listener).await;
            // Send a presence event
            let presence = ServerMessage::Presence {
                peer_id: "some-peer".into(),
                status: PresenceStatus::Online,
                last_seen: None,
            };
            write
                .send(WsMessage::Text(
                    serde_json::to_string(&presence).unwrap().into(),
                ))
                .await
                .unwrap();
            peer_id
        });

        let (handle, mut events) = start(url, &identity).unwrap();

        // Should get Connected
        let ev = events.recv().await.unwrap();
        assert!(matches!(ev, RelayEvent::Connected));

        // Should get Presence
        let ev = events.recv().await.unwrap();
        assert!(matches!(
            ev,
            RelayEvent::Presence {
                ref peer_id,
                ..
            } if peer_id == "some-peer"
        ));

        handle.shutdown();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_send_envelope_and_ack() {
        let (url, listener) = mock_server_listener().await;
        let identity = NodeIdentity::generate();

        let server = tokio::spawn(async move {
            let (_peer_id, mut read, mut write) = mock_server_session(listener).await;

            // Wait for client to send an envelope
            while let Some(Ok(msg)) = read.next().await {
                if let WsMessage::Text(text) = msg {
                    let client_msg: ClientMessage = serde_json::from_str(&text).unwrap();
                    if let ClientMessage::Envelope {
                        target_peer_id: _,
                        envelope,
                    } = client_msg
                    {
                        let mid = envelope
                            .get("message_id")
                            .unwrap()
                            .as_str()
                            .unwrap()
                            .to_string();
                        // Reply with ServerAck
                        let ack = ServerMessage::ServerAck {
                            message_id: mid,
                            status: AckStatus::Delivered,
                        };
                        write
                            .send(WsMessage::Text(
                                serde_json::to_string(&ack).unwrap().into(),
                            ))
                            .await
                            .unwrap();
                        break;
                    }
                }
            }
        });

        let (handle, mut events) = start(url, &identity).unwrap();

        // Wait for Connected
        let ev = events.recv().await.unwrap();
        assert!(matches!(ev, RelayEvent::Connected));

        // Send an envelope
        let envelope = serde_json::json!({
            "message_id": "msg-001",
            "version": 1,
            "sender_agent": "test",
            "timestamp": "2026-03-21T00:00:00Z",
            "encrypted_payload": [],
            "nonce": [],
            "sender_x25519_public": []
        });
        handle
            .send_envelope("target-peer", envelope)
            .unwrap();

        // Should get ServerAck
        let ev = events.recv().await.unwrap();
        assert!(matches!(
            ev,
            RelayEvent::ServerAck {
                ref message_id,
                ..
            } if message_id == "msg-001"
        ));

        handle.shutdown();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_presence_subscription() {
        let (url, listener) = mock_server_listener().await;
        let identity = NodeIdentity::generate();

        let server = tokio::spawn(async move {
            let (_peer_id, mut read, mut write) = mock_server_session(listener).await;

            // Wait for subscribe_presence
            while let Some(Ok(msg)) = read.next().await {
                if let WsMessage::Text(text) = msg {
                    let client_msg: ClientMessage = serde_json::from_str(&text).unwrap();
                    if let ClientMessage::SubscribePresence { peer_ids } = client_msg {
                        // Reply with snapshot
                        let snapshot = ServerMessage::PresenceSnapshot {
                            peers: peer_ids
                                .into_iter()
                                .map(|pid| PeerPresenceInfo {
                                    peer_id: pid,
                                    status: PresenceStatus::Offline,
                                    last_seen: None,
                                })
                                .collect(),
                        };
                        write
                            .send(WsMessage::Text(
                                serde_json::to_string(&snapshot).unwrap().into(),
                            ))
                            .await
                            .unwrap();
                        break;
                    }
                }
            }
        });

        let (handle, mut events) = start(url, &identity).unwrap();
        let _ = events.recv().await; // Connected

        handle
            .subscribe_presence(vec!["peer-a".into(), "peer-b".into()])
            .unwrap();

        let ev = events.recv().await.unwrap();
        match ev {
            RelayEvent::PresenceSnapshot { peers } => {
                assert_eq!(peers.len(), 2);
            }
            other => panic!("expected PresenceSnapshot, got {other:?}"),
        }

        handle.shutdown();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn test_auth_failure() {
        let (url, listener) = mock_server_listener().await;
        let identity = NodeIdentity::generate();

        // Server that rejects auth
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();

            // Send Challenge
            ws.send(WsMessage::Text(
                serde_json::to_string(&ServerMessage::Challenge {
                    nonce: "nonce".into(),
                    server_time: "t".into(),
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

            // Read auth (ignore content)
            let _ = ws.next().await;

            // Send Error
            ws.send(WsMessage::Text(
                serde_json::to_string(&ServerMessage::Error {
                    code: "auth_failed".into(),
                    message: "bad sig".into(),
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();
        });

        let (handle, mut events) = start(url, &identity).unwrap();

        // Auth failure → Disconnected with will_reconnect=true (it will retry)
        let ev = events.recv().await.unwrap();
        assert!(matches!(
            ev,
            RelayEvent::Disconnected {
                will_reconnect: true
            }
        ));

        handle.shutdown();
    }

    #[tokio::test]
    async fn test_reconnect_on_server_close() {
        let (url, listener) = mock_server_listener().await;
        let identity = NodeIdentity::generate();

        tokio::spawn(async move {
            // First connection: auth then close immediately
            let (stream, _) = listener.accept().await.unwrap();
            let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
            let nonce = "n1";
            ws.send(WsMessage::Text(
                serde_json::to_string(&ServerMessage::Challenge {
                    nonce: nonce.into(),
                    server_time: "t".into(),
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();
            let _ = ws.next().await; // auth
            ws.send(WsMessage::Text(
                serde_json::to_string(&ServerMessage::AuthOk {
                    peer_id: "p".into(),
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();
            // Close
            let _ = ws.close(None).await;

            // Second connection: auth and stay alive
            let (stream2, _) = listener.accept().await.unwrap();
            let mut ws2 = tokio_tungstenite::accept_async(stream2).await.unwrap();
            ws2.send(WsMessage::Text(
                serde_json::to_string(&ServerMessage::Challenge {
                    nonce: "n2".into(),
                    server_time: "t".into(),
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();
            let _ = ws2.next().await;
            ws2.send(WsMessage::Text(
                serde_json::to_string(&ServerMessage::AuthOk {
                    peer_id: "p".into(),
                })
                .unwrap()
                .into(),
            ))
            .await
            .unwrap();

            // Keep alive for a bit
            tokio::time::sleep(Duration::from_millis(500)).await;
        });

        let (handle, mut events) = start(url, &identity).unwrap();

        // First: Connected
        assert!(matches!(events.recv().await.unwrap(), RelayEvent::Connected));
        // Then: Disconnected (will reconnect)
        assert!(matches!(
            events.recv().await.unwrap(),
            RelayEvent::Disconnected {
                will_reconnect: true
            }
        ));
        // Then: Connected again (after reconnect)
        assert!(matches!(events.recv().await.unwrap(), RelayEvent::Connected));

        handle.shutdown();
    }
}
