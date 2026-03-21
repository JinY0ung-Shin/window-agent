//! EncryptedEnvelope — wire format for E2E encrypted messages.

use serde::{Deserialize, Serialize};

/// Plaintext header fields used for routing & deduplication.
/// Also used as AEAD Associated Data (canonical JSON serialization).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeHeader {
    pub version: u32,
    pub message_id: String,
    pub sender_agent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    pub timestamp: String,
}

/// E2E encrypted envelope: plaintext header + encrypted payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    #[serde(flatten)]
    pub header: EnvelopeHeader,

    /// ChaCha20-Poly1305 ciphertext of the Payload JSON.
    /// AAD = canonical JSON of `header`.
    pub encrypted_payload: Vec<u8>,

    /// AEAD nonce (12 bytes).
    pub nonce: Vec<u8>,

    /// Sender's X25519 public key (32 bytes) for receiver to perform DH.
    pub sender_x25519_public: Vec<u8>,
}

impl EnvelopeHeader {
    /// Produce canonical JSON bytes for use as AEAD Associated Data.
    pub fn to_aad(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("header serialization should not fail")
    }
}
