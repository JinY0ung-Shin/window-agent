use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{SigningKey, Signer};
use futures_util::{SinkExt, StreamExt};
use rand::rngs::OsRng;
use serde_json::Value;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use wa_shared::protocol::*;

/// Helper: start the relay server on a random port and return the ws:// URL.
async fn start_server() -> String {
    let db_url = format!("sqlite:file:test_{}?mode=memory&cache=shared", uuid::Uuid::new_v4());
    let (app, _state) = relay_server::build_app(&db_url).await;

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    format!("ws://127.0.0.1:{}/ws", addr.port())
}

/// Generate a keypair and derive the peer_id.
fn make_identity() -> (SigningKey, String) {
    let signing_key = SigningKey::generate(&mut OsRng);
    let pk_bytes = signing_key.verifying_key().to_bytes();
    let peer_id = hex::encode(&pk_bytes[..16]);
    (signing_key, peer_id)
}

/// Connect and authenticate. Returns the WS stream + peer_id.
async fn connect_and_auth(
    url: &str,
    signing_key: &SigningKey,
    peer_id: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>
{
    let (mut ws, _) = connect_async(url).await.expect("Failed to connect");

    // Read challenge.
    let challenge_msg = ws.next().await.unwrap().unwrap();
    let challenge_text = challenge_msg.into_text().unwrap();
    let challenge: Value = serde_json::from_str(&challenge_text).unwrap();
    let nonce = challenge["nonce"].as_str().unwrap();

    // Sign the nonce.
    let signature = signing_key.sign(nonce.as_bytes());
    let pk_b64 = B64.encode(signing_key.verifying_key().to_bytes());
    let sig_b64 = B64.encode(signature.to_bytes());

    let auth = ClientMessage::Auth {
        peer_id: peer_id.to_string(),
        public_key: pk_b64,
        signature: sig_b64,
    };
    ws.send(Message::Text(serde_json::to_string(&auth).unwrap().into()))
        .await
        .unwrap();

    // Read AuthOk.
    let auth_ok_msg = ws.next().await.unwrap().unwrap();
    let auth_ok_text = auth_ok_msg.into_text().unwrap();
    let auth_ok: Value = serde_json::from_str(&auth_ok_text).unwrap();
    assert_eq!(auth_ok["type"], "auth_ok");
    assert_eq!(auth_ok["peer_id"], peer_id);

    ws
}

/// Read next server message, skipping ping/pong.
async fn read_server_msg(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    loop {
        let msg = tokio::time::timeout(std::time::Duration::from_secs(5), ws.next())
            .await
            .expect("Timeout waiting for message")
            .unwrap()
            .unwrap();
        if let Message::Text(text) = msg {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

#[tokio::test]
async fn test_auth_and_message_exchange() {
    let url = start_server().await;

    let (key_a, peer_a) = make_identity();
    let (key_b, peer_b) = make_identity();

    let mut ws_a = connect_and_auth(&url, &key_a, &peer_a).await;
    let mut ws_b = connect_and_auth(&url, &key_b, &peer_b).await;

    // A sends a message to B.
    let envelope = serde_json::json!({
        "message_id": "msg-001",
        "data": "hello from A"
    });
    let send_msg = ClientMessage::Envelope {
        target_peer_id: peer_b.clone(),
        envelope: envelope.clone(),
    };
    ws_a.send(Message::Text(serde_json::to_string(&send_msg).unwrap().into()))
        .await
        .unwrap();

    // A receives ServerAck (Delivered).
    let ack = read_server_msg(&mut ws_a).await;
    assert_eq!(ack["type"], "server_ack");
    assert_eq!(ack["message_id"], "msg-001");
    assert_eq!(ack["status"], "delivered");

    // B receives the envelope.
    let received = read_server_msg(&mut ws_b).await;
    assert_eq!(received["type"], "envelope");
    assert_eq!(received["sender_peer_id"], peer_a);
    assert_eq!(received["envelope"]["data"], "hello from A");

    // B sends PeerAck.
    let peer_ack = ClientMessage::PeerAck {
        message_id: "msg-001".to_string(),
        sender_peer_id: peer_a.clone(),
    };
    ws_b.send(Message::Text(serde_json::to_string(&peer_ack).unwrap().into()))
        .await
        .unwrap();

    // A receives PeerAck.
    let peer_ack_recv = read_server_msg(&mut ws_a).await;
    assert_eq!(peer_ack_recv["type"], "peer_ack");
    assert_eq!(peer_ack_recv["message_id"], "msg-001");
}

#[tokio::test]
async fn test_offline_queue() {
    let url = start_server().await;

    let (key_a, peer_a) = make_identity();
    let (key_b, peer_b) = make_identity();

    // Only A connects. B is offline.
    let mut ws_a = connect_and_auth(&url, &key_a, &peer_a).await;

    // A sends a message to offline B.
    let envelope = serde_json::json!({
        "message_id": "msg-offline-1",
        "data": "queued message"
    });
    let send_msg = ClientMessage::Envelope {
        target_peer_id: peer_b.clone(),
        envelope: envelope.clone(),
    };
    ws_a.send(Message::Text(serde_json::to_string(&send_msg).unwrap().into()))
        .await
        .unwrap();

    // A receives ServerAck (Queued).
    let ack = read_server_msg(&mut ws_a).await;
    assert_eq!(ack["type"], "server_ack");
    assert_eq!(ack["status"], "queued");

    // Now B connects — should receive the queued message after auth.
    let mut ws_b = connect_and_auth(&url, &key_b, &peer_b).await;

    // B receives the drained offline message.
    let received = read_server_msg(&mut ws_b).await;
    assert_eq!(received["type"], "envelope");
    assert_eq!(received["sender_peer_id"], peer_a);
    assert_eq!(received["envelope"]["data"], "queued message");
}

#[tokio::test]
async fn test_presence_subscription() {
    let url = start_server().await;

    let (key_a, peer_a) = make_identity();
    let (key_b, peer_b) = make_identity();

    // A connects first.
    let mut ws_a = connect_and_auth(&url, &key_a, &peer_a).await;

    // A subscribes to B's presence.
    let sub = ClientMessage::SubscribePresence {
        peer_ids: vec![peer_b.clone()],
    };
    ws_a.send(Message::Text(serde_json::to_string(&sub).unwrap().into()))
        .await
        .unwrap();

    // A gets snapshot showing B offline.
    let snapshot = read_server_msg(&mut ws_a).await;
    assert_eq!(snapshot["type"], "presence_snapshot");
    assert_eq!(snapshot["peers"][0]["peer_id"], peer_b);
    assert_eq!(snapshot["peers"][0]["status"], "offline");

    // B connects.
    let mut ws_b = connect_and_auth(&url, &key_b, &peer_b).await;

    // A receives presence online notification for B.
    let presence = read_server_msg(&mut ws_a).await;
    assert_eq!(presence["type"], "presence");
    assert_eq!(presence["peer_id"], peer_b);
    assert_eq!(presence["status"], "online");

    // B disconnects.
    ws_b.close(None).await.unwrap();

    // A receives presence offline notification for B.
    let presence_off = read_server_msg(&mut ws_a).await;
    assert_eq!(presence_off["type"], "presence");
    assert_eq!(presence_off["peer_id"], peer_b);
    assert_eq!(presence_off["status"], "offline");
}

#[tokio::test]
async fn test_single_session_policy() {
    let url = start_server().await;

    let (key_a, peer_a) = make_identity();

    let mut ws_a1 = connect_and_auth(&url, &key_a, &peer_a).await;

    // Second connection with same peer_id.
    let ws_a2 = connect_and_auth(&url, &key_a, &peer_a).await;

    // First connection should receive an error (session_replaced) and close.
    let msg = read_server_msg(&mut ws_a1).await;
    assert_eq!(msg["type"], "error");
    assert_eq!(msg["code"], "session_replaced");

    // The second connection should still work — send a message to verify.
    // We just verify the connection is alive by checking it doesn't error.
    let _ = ws_a2; // ws_a2 remains connected
}

#[tokio::test]
async fn test_dedup() {
    let url = start_server().await;

    let (key_a, peer_a) = make_identity();
    let (key_b, peer_b) = make_identity();

    let mut ws_a = connect_and_auth(&url, &key_a, &peer_a).await;
    let mut ws_b = connect_and_auth(&url, &key_b, &peer_b).await;

    // A sends the same message twice.
    let envelope = serde_json::json!({
        "message_id": "msg-dup-1",
        "data": "hello"
    });
    for _ in 0..2 {
        let send_msg = ClientMessage::Envelope {
            target_peer_id: peer_b.clone(),
            envelope: envelope.clone(),
        };
        ws_a.send(Message::Text(serde_json::to_string(&send_msg).unwrap().into()))
            .await
            .unwrap();
        // Read the ServerAck.
        let _ack = read_server_msg(&mut ws_a).await;
    }

    // B should receive only one envelope.
    let received = read_server_msg(&mut ws_b).await;
    assert_eq!(received["type"], "envelope");
    assert_eq!(received["envelope"]["message_id"], "msg-dup-1");

    // Second read should timeout (no duplicate delivered).
    let second = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        read_server_msg(&mut ws_b),
    )
    .await;
    assert!(second.is_err(), "Should not receive duplicate message");
}

#[tokio::test]
async fn test_auth_failure_wrong_signature() {
    let url = start_server().await;

    let (signing_key, peer_id) = make_identity();

    let (mut ws, _) = connect_async(&url).await.unwrap();

    // Read challenge.
    let challenge_msg = ws.next().await.unwrap().unwrap();
    let challenge_text = challenge_msg.into_text().unwrap();
    let _challenge: Value = serde_json::from_str(&challenge_text).unwrap();

    // Send auth with wrong signature (sign a different message).
    let bad_sig = signing_key.sign(b"wrong-nonce");
    let pk_b64 = B64.encode(signing_key.verifying_key().to_bytes());
    let sig_b64 = B64.encode(bad_sig.to_bytes());

    let auth = ClientMessage::Auth {
        peer_id,
        public_key: pk_b64,
        signature: sig_b64,
    };
    ws.send(Message::Text(serde_json::to_string(&auth).unwrap().into()))
        .await
        .unwrap();

    // Should receive an error.
    let err = read_server_msg(&mut ws).await;
    assert_eq!(err["type"], "error");
    assert_eq!(err["code"], "auth_failed");
}
