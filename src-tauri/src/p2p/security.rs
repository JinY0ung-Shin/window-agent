use chrono::Utc;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use super::identity::NodeIdentity;

/// Maximum age (in seconds) for a handshake timestamp to be considered valid.
const MAX_TIMESTAMP_AGE_SECS: i64 = 300; // 5 minutes

#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("Invalid signature")]
    InvalidSignature,
    #[error("Nonce mismatch")]
    NonceMismatch,
    #[error("Timestamp expired or invalid")]
    TimestampInvalid,
    #[error("Unexpected handshake message in current phase")]
    UnexpectedMessage,
    #[error("Handshake failed: {0}")]
    HandshakeFailed(String),
    #[error("Crypto error: {0}")]
    CryptoError(String),
}

/// Handshake messages for first-contact authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum HandshakeMessage {
    /// Step 1: Initiator sends challenge
    Challenge {
        nonce: String,
        peer_id: String,
        timestamp: String,
    },
    /// Step 2: Responder signs challenge and sends own challenge
    ChallengeResponse {
        initiator_nonce: String,
        responder_nonce: String,
        peer_id: String,
        signature: Vec<u8>,
        timestamp: String,
    },
    /// Step 3: Initiator signs responder's challenge
    Verify {
        responder_nonce: String,
        signature: Vec<u8>,
    },
    /// Step 4: Handshake complete acknowledgment
    Complete { success: bool },
}

/// Phases of the handshake state machine.
#[derive(Debug, PartialEq)]
pub enum HandshakePhase {
    Initial,
    ChallengeSent,
    ChallengeReceived,
    Verified,
    Complete,
    Failed(String),
}

/// Manages the handshake state machine.
pub struct HandshakeState {
    local_nonce: String,
    remote_nonce: Option<String>,
    remote_peer_id: Option<String>,
    phase: HandshakePhase,
}

impl HandshakeState {
    /// Create an initiator and produce the initial Challenge message.
    pub fn new_initiator(identity: &NodeIdentity) -> (Self, HandshakeMessage) {
        let nonce = generate_nonce();
        let msg = HandshakeMessage::Challenge {
            nonce: nonce.clone(),
            peer_id: identity.peer_id().to_string(),
            timestamp: Utc::now().to_rfc3339(),
        };
        let state = Self {
            local_nonce: nonce,
            remote_nonce: None,
            remote_peer_id: None,
            phase: HandshakePhase::ChallengeSent,
        };
        (state, msg)
    }

    /// Create a responder that waits for an incoming Challenge.
    pub fn new_responder() -> Self {
        Self {
            local_nonce: generate_nonce(),
            remote_nonce: None,
            remote_peer_id: None,
            phase: HandshakePhase::Initial,
        }
    }

    /// Process an incoming handshake message and optionally produce a reply.
    pub fn process_message(
        &mut self,
        msg: HandshakeMessage,
        identity: &NodeIdentity,
    ) -> Result<Option<HandshakeMessage>, SecurityError> {
        match (&self.phase, msg) {
            // Responder receives initial Challenge
            (HandshakePhase::Initial, HandshakeMessage::Challenge { nonce, peer_id, timestamp }) => {
                validate_timestamp(&timestamp, MAX_TIMESTAMP_AGE_SECS)?;

                self.remote_nonce = Some(nonce.clone());
                self.remote_peer_id = Some(peer_id);

                // Sign: initiator_nonce + responder_peer_id
                let sign_data = format!("{}{}", nonce, identity.peer_id());
                let signature = sign_bytes(identity, sign_data.as_bytes())?;

                let reply = HandshakeMessage::ChallengeResponse {
                    initiator_nonce: nonce,
                    responder_nonce: self.local_nonce.clone(),
                    peer_id: identity.peer_id().to_string(),
                    signature,
                    timestamp: Utc::now().to_rfc3339(),
                };

                self.phase = HandshakePhase::ChallengeReceived;
                Ok(Some(reply))
            }

            // Initiator receives ChallengeResponse
            (
                HandshakePhase::ChallengeSent,
                HandshakeMessage::ChallengeResponse {
                    initiator_nonce,
                    responder_nonce,
                    peer_id,
                    signature,
                    timestamp,
                },
            ) => {
                validate_timestamp(&timestamp, MAX_TIMESTAMP_AGE_SECS)?;

                // Verify nonce echo
                if initiator_nonce != self.local_nonce {
                    self.phase = HandshakePhase::Failed("Nonce mismatch".into());
                    return Err(SecurityError::NonceMismatch);
                }

                // Verify signature: initiator_nonce + responder_peer_id
                let verify_data = format!("{}{}", initiator_nonce, peer_id);
                let remote_peer_id: libp2p_identity::PeerId = peer_id
                    .parse()
                    .map_err(|e: libp2p_identity::ParseError| {
                        SecurityError::CryptoError(e.to_string())
                    })?;
                verify_signature_with_peer_id(
                    &remote_peer_id,
                    verify_data.as_bytes(),
                    &signature,
                )?;

                self.remote_nonce = Some(responder_nonce.clone());

                // Sign: responder_nonce + initiator_peer_id
                let sign_data = format!("{}{}", responder_nonce, identity.peer_id());
                let my_signature = sign_bytes(identity, sign_data.as_bytes())?;

                let reply = HandshakeMessage::Verify {
                    responder_nonce,
                    signature: my_signature,
                };

                self.phase = HandshakePhase::Verified;
                Ok(Some(reply))
            }

            // Responder receives Verify
            (
                HandshakePhase::ChallengeReceived,
                HandshakeMessage::Verify {
                    responder_nonce,
                    signature,
                },
            ) => {
                // Verify nonce echo
                if responder_nonce != self.local_nonce {
                    self.phase = HandshakePhase::Failed("Nonce mismatch".into());
                    return Err(SecurityError::NonceMismatch);
                }

                // Verify the initiator's signature using their PeerId (stored from Challenge)
                let remote_peer_id_str = self.remote_peer_id.as_ref().ok_or_else(|| {
                    SecurityError::HandshakeFailed(
                        "Missing remote peer_id from Challenge".into(),
                    )
                })?;
                let remote_peer_id: libp2p_identity::PeerId = remote_peer_id_str
                    .parse()
                    .map_err(|e: libp2p_identity::ParseError| {
                        SecurityError::CryptoError(e.to_string())
                    })?;

                // The initiator signed: responder_nonce + initiator_peer_id
                let verify_data = format!("{}{}", responder_nonce, remote_peer_id_str);
                verify_signature_with_peer_id(
                    &remote_peer_id,
                    verify_data.as_bytes(),
                    &signature,
                )?;

                self.phase = HandshakePhase::Complete;
                Ok(Some(HandshakeMessage::Complete { success: true }))
            }

            // Initiator receives Complete
            (HandshakePhase::Verified, HandshakeMessage::Complete { success }) => {
                if success {
                    self.phase = HandshakePhase::Complete;
                    Ok(None)
                } else {
                    self.phase = HandshakePhase::Failed("Remote rejected handshake".into());
                    Err(SecurityError::HandshakeFailed(
                        "Remote rejected handshake".into(),
                    ))
                }
            }

            // Any other combination is unexpected
            _ => {
                self.phase = HandshakePhase::Failed("Unexpected message".into());
                Err(SecurityError::UnexpectedMessage)
            }
        }
    }

    /// Whether the handshake completed successfully.
    pub fn is_complete(&self) -> bool {
        self.phase == HandshakePhase::Complete
    }

    /// Current phase of the handshake.
    #[allow(dead_code)]
    pub fn phase(&self) -> &HandshakePhase {
        &self.phase
    }
}

/// Generate a random 32-byte hex nonce (64 hex characters) using two UUID v4 values.
pub fn generate_nonce() -> String {
    let a = Uuid::new_v4();
    let b = Uuid::new_v4();
    format!("{}{}", a.as_simple(), b.as_simple())
}

/// Validate that a timestamp is within the acceptable time window.
pub fn validate_timestamp(timestamp: &str, max_age_secs: i64) -> Result<(), SecurityError> {
    let ts = chrono::DateTime::parse_from_rfc3339(timestamp)
        .map_err(|_| SecurityError::TimestampInvalid)?;
    let now = Utc::now();
    let age = (now - ts.with_timezone(&Utc))
        .num_seconds()
        .abs();
    if age > max_age_secs {
        return Err(SecurityError::TimestampInvalid);
    }
    Ok(())
}

/// Sign data using the node's Ed25519 keypair.
fn sign_bytes(identity: &NodeIdentity, data: &[u8]) -> Result<Vec<u8>, SecurityError> {
    let ed_keypair = identity
        .keypair()
        .clone()
        .try_into_ed25519()
        .map_err(|e| SecurityError::CryptoError(e.to_string()))?;
    Ok(ed_keypair.sign(data))
}

/// Verify a signature using the public key extracted from a PeerId.
/// This works because libp2p PeerIds for Ed25519 keys embed the public key.
fn verify_signature_with_peer_id(
    peer_id: &libp2p_identity::PeerId,
    data: &[u8],
    signature: &[u8],
) -> Result<(), SecurityError> {
    // Extract public key from PeerId (only works for key types that embed the key)
    let public_key = libp2p_identity::PublicKey::try_decode_protobuf(
        &peer_id_to_public_key_bytes(peer_id)?,
    )
    .map_err(|e| SecurityError::CryptoError(format!("Failed to decode public key: {e}")))?;

    let ed_public = public_key
        .try_into_ed25519()
        .map_err(|e| SecurityError::CryptoError(format!("Not an Ed25519 key: {e}")))?;

    if ed_public.verify(data, signature) {
        Ok(())
    } else {
        Err(SecurityError::InvalidSignature)
    }
}

/// Extract the protobuf-encoded public key bytes from a PeerId.
/// For Ed25519 keys, libp2p uses an identity multihash that directly embeds the key.
fn peer_id_to_public_key_bytes(
    peer_id: &libp2p_identity::PeerId,
) -> Result<Vec<u8>, SecurityError> {
    // PeerId::to_bytes() returns the raw multihash bytes.
    // For identity multihash: varint(0x00) + varint(length) + protobuf_encoded_pubkey
    let raw = peer_id.to_bytes();
    if raw.len() < 3 {
        return Err(SecurityError::CryptoError(
            "PeerId too short to contain a public key".into(),
        ));
    }
    // Identity multihash: first byte = 0x00, second byte = length of payload
    if raw[0] == 0x00 {
        let len = raw[1] as usize;
        if raw.len() >= 2 + len {
            return Ok(raw[2..2 + len].to_vec());
        }
    }
    Err(SecurityError::CryptoError(
        "Cannot extract public key from PeerId (not identity-hashed)".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_nonce_length() {
        let nonce = generate_nonce();
        assert_eq!(nonce.len(), 64, "Nonce should be 64 hex chars (32 bytes)");
    }

    #[test]
    fn test_generate_nonce_uniqueness() {
        let a = generate_nonce();
        let b = generate_nonce();
        assert_ne!(a, b);
    }

    #[test]
    fn test_generate_nonce_is_hex() {
        let nonce = generate_nonce();
        assert!(
            nonce.chars().all(|c| c.is_ascii_hexdigit()),
            "Nonce should only contain hex characters"
        );
    }

    #[test]
    fn test_validate_timestamp_valid() {
        let ts = Utc::now().to_rfc3339();
        assert!(validate_timestamp(&ts, 300).is_ok());
    }

    #[test]
    fn test_validate_timestamp_expired() {
        let old = (Utc::now() - chrono::Duration::seconds(600)).to_rfc3339();
        assert!(validate_timestamp(&old, 300).is_err());
    }

    #[test]
    fn test_validate_timestamp_invalid_format() {
        assert!(validate_timestamp("not-a-timestamp", 300).is_err());
    }

    #[test]
    fn test_validate_timestamp_slightly_future() {
        // A timestamp a few seconds in the future should still be valid
        let future = (Utc::now() + chrono::Duration::seconds(10)).to_rfc3339();
        assert!(validate_timestamp(&future, 300).is_ok());
    }

    #[test]
    fn test_validate_timestamp_far_future_rejected() {
        let future = (Utc::now() + chrono::Duration::seconds(600)).to_rfc3339();
        assert!(validate_timestamp(&future, 300).is_err());
    }

    #[test]
    fn test_full_handshake_flow() {
        let initiator_id = NodeIdentity::generate();
        let responder_id = NodeIdentity::generate();

        // Step 1: Initiator creates Challenge
        let (mut initiator_state, challenge_msg) =
            HandshakeState::new_initiator(&initiator_id);
        assert_eq!(initiator_state.phase, HandshakePhase::ChallengeSent);

        // Step 2: Responder processes Challenge, produces ChallengeResponse
        let mut responder_state = HandshakeState::new_responder();
        let response = responder_state
            .process_message(challenge_msg, &responder_id)
            .unwrap();
        assert!(response.is_some());
        assert_eq!(responder_state.phase, HandshakePhase::ChallengeReceived);

        // Step 3: Initiator processes ChallengeResponse, produces Verify
        let verify = initiator_state
            .process_message(response.unwrap(), &initiator_id)
            .unwrap();
        assert!(verify.is_some());
        assert_eq!(initiator_state.phase, HandshakePhase::Verified);

        // Step 4: Responder processes Verify, produces Complete
        let complete = responder_state
            .process_message(verify.unwrap(), &responder_id)
            .unwrap();
        assert!(complete.is_some());
        assert!(responder_state.is_complete());

        // Initiator processes Complete
        let final_msg = initiator_state
            .process_message(complete.unwrap(), &initiator_id)
            .unwrap();
        assert!(final_msg.is_none()); // No further messages
        assert!(initiator_state.is_complete());
    }

    #[test]
    fn test_handshake_nonce_mismatch() {
        let initiator_id = NodeIdentity::generate();
        let responder_id = NodeIdentity::generate();

        let (mut initiator_state, _challenge_msg) =
            HandshakeState::new_initiator(&initiator_id);

        // Craft a ChallengeResponse with wrong initiator_nonce
        let sign_data = format!("wrong_nonce{}", responder_id.peer_id());
        let ed_kp = responder_id.keypair().clone().try_into_ed25519().unwrap();
        let sig = ed_kp.sign(sign_data.as_bytes());

        let bad_response = HandshakeMessage::ChallengeResponse {
            initiator_nonce: "wrong_nonce".into(),
            responder_nonce: generate_nonce(),
            peer_id: responder_id.peer_id().to_string(),
            signature: sig,
            timestamp: Utc::now().to_rfc3339(),
        };

        let result = initiator_state.process_message(bad_response, &initiator_id);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), SecurityError::NonceMismatch));
    }

    #[test]
    fn test_handshake_invalid_signature() {
        let initiator_id = NodeIdentity::generate();
        let responder_id = NodeIdentity::generate();
        let impersonator_id = NodeIdentity::generate();

        let (mut initiator_state, challenge_msg) =
            HandshakeState::new_initiator(&initiator_id);

        // Extract nonce from challenge
        let nonce = match &challenge_msg {
            HandshakeMessage::Challenge { nonce, .. } => nonce.clone(),
            _ => panic!("Expected Challenge message"),
        };

        // Sign with impersonator's key but claim responder's peer_id
        let sign_data = format!("{}{}", nonce, responder_id.peer_id());
        let imp_kp = impersonator_id.keypair().clone().try_into_ed25519().unwrap();
        let bad_sig = imp_kp.sign(sign_data.as_bytes());

        let forged_response = HandshakeMessage::ChallengeResponse {
            initiator_nonce: nonce,
            responder_nonce: generate_nonce(),
            peer_id: responder_id.peer_id().to_string(),
            signature: bad_sig,
            timestamp: Utc::now().to_rfc3339(),
        };

        let result = initiator_state.process_message(forged_response, &initiator_id);
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            SecurityError::InvalidSignature
        ));
    }

    #[test]
    fn test_unexpected_message_in_wrong_phase() {
        let id = NodeIdentity::generate();
        let mut state = HandshakeState::new_responder();

        // Responder expects Challenge first, not Verify
        let result = state.process_message(
            HandshakeMessage::Verify {
                responder_nonce: "abc".into(),
                signature: vec![0u8; 64],
            },
            &id,
        );
        assert!(matches!(
            result.unwrap_err(),
            SecurityError::UnexpectedMessage
        ));
    }

    #[test]
    fn test_complete_with_failure() {
        let initiator_id = NodeIdentity::generate();
        let responder_id = NodeIdentity::generate();

        let (mut initiator_state, challenge_msg) =
            HandshakeState::new_initiator(&initiator_id);

        let mut responder_state = HandshakeState::new_responder();
        let response = responder_state
            .process_message(challenge_msg, &responder_id)
            .unwrap()
            .unwrap();

        let verify = initiator_state
            .process_message(response, &initiator_id)
            .unwrap()
            .unwrap();

        // Skip responder processing verify, manually send failure Complete
        let _ = verify;
        let result = initiator_state
            .process_message(HandshakeMessage::Complete { success: false }, &initiator_id);
        // initiator is in Verified phase, receives Complete { success: false }
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            SecurityError::HandshakeFailed(_)
        ));
    }

    #[test]
    fn test_handshake_message_serialization() {
        let msg = HandshakeMessage::Challenge {
            nonce: generate_nonce(),
            peer_id: "12D3KooWTest".into(),
            timestamp: Utc::now().to_rfc3339(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let restored: HandshakeMessage = serde_json::from_str(&json).unwrap();
        match restored {
            HandshakeMessage::Challenge { nonce, peer_id, .. } => {
                assert!(!nonce.is_empty());
                assert_eq!(peer_id, "12D3KooWTest");
            }
            _ => panic!("Expected Challenge variant"),
        }
    }

    #[test]
    fn test_responder_nonce_mismatch_in_verify() {
        let initiator_id = NodeIdentity::generate();
        let responder_id = NodeIdentity::generate();

        let (mut initiator_state, challenge_msg) =
            HandshakeState::new_initiator(&initiator_id);
        let mut responder_state = HandshakeState::new_responder();

        let response = responder_state
            .process_message(challenge_msg, &responder_id)
            .unwrap()
            .unwrap();

        let verify = initiator_state
            .process_message(response, &initiator_id)
            .unwrap()
            .unwrap();

        // Tamper with the verify message's nonce
        let tampered_verify = match verify {
            HandshakeMessage::Verify { signature, .. } => HandshakeMessage::Verify {
                responder_nonce: "tampered_nonce".into(),
                signature,
            },
            _ => panic!("Expected Verify"),
        };

        let result = responder_state.process_message(tampered_verify, &responder_id);
        assert!(matches!(
            result.unwrap_err(),
            SecurityError::NonceMismatch
        ));
    }

    #[test]
    fn test_sign_and_verify_roundtrip() {
        let id = NodeIdentity::generate();
        let data = b"test data for signing";
        let signature = sign_bytes(&id, data).unwrap();

        let peer_id = id.peer_id();
        assert!(verify_signature_with_peer_id(peer_id, data, &signature).is_ok());
        assert!(verify_signature_with_peer_id(peer_id, b"wrong data", &signature).is_err());
    }
}
