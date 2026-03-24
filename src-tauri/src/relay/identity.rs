use ed25519_dalek::SigningKey;
use tauri_plugin_store::StoreExt;
use thiserror::Error;

const STORE_FILE: &str = "relay-identity.json";
const STORE_KEY_PRIVATE: &str = "ed25519_private_key";

#[derive(Debug, Error)]
pub enum IdentityError {
    #[error("Failed to open identity store: {0}")]
    StoreOpen(String),
    #[error("Failed to save identity store: {0}")]
    StoreSave(String),
    #[error("Invalid stored key data: {0}")]
    InvalidKey(String),
    #[error("Key decoding error: {0}")]
    Decode(String),
}

/// Node identity backed by an Ed25519 keypair.
/// The keypair is persisted via tauri-plugin-store and auto-generated on first access.
pub struct NodeIdentity {
    signing_key: SigningKey,
}

impl Clone for NodeIdentity {
    fn clone(&self) -> Self {
        Self {
            signing_key: SigningKey::from_bytes(&self.signing_key.to_bytes()),
        }
    }
}

impl NodeIdentity {
    /// Load identity from store, or generate and persist a new one.
    pub fn load_or_create(app: &tauri::AppHandle) -> Result<Self, IdentityError> {
        if let Some(identity) = Self::load_from_store(app)? {
            return Ok(identity);
        }
        let identity = Self::generate();
        identity.save_to_store(app)?;
        Ok(identity)
    }

    /// Generate a fresh Ed25519 identity (not persisted).
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut rand::rngs::OsRng);
        Self { signing_key }
    }

    /// Create from raw Ed25519 secret key bytes (32 bytes).
    pub fn from_secret_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
        let key_bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| IdentityError::InvalidKey("secret key must be 32 bytes".into()))?;
        let signing_key = SigningKey::from_bytes(&key_bytes);
        Ok(Self { signing_key })
    }

    /// Attempt to load from tauri-plugin-store. Returns Ok(None) if no stored key.
    fn load_from_store(app: &tauri::AppHandle) -> Result<Option<Self>, IdentityError> {
        let store = app
            .store(STORE_FILE)
            .map_err(|e| IdentityError::StoreOpen(e.to_string()))?;

        let val = match store.get(STORE_KEY_PRIVATE) {
            Some(v) => v,
            None => return Ok(None),
        };

        let b64 = val
            .as_str()
            .ok_or_else(|| IdentityError::InvalidKey("stored value is not a string".into()))?;

        if b64.is_empty() {
            return Ok(None);
        }

        let bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            b64,
        )
        .map_err(|e| IdentityError::Decode(e.to_string()))?;

        let identity = Self::from_secret_bytes(&bytes)?;
        Ok(Some(identity))
    }

    /// Persist the secret key to tauri-plugin-store (base64-encoded).
    fn save_to_store(&self, app: &tauri::AppHandle) -> Result<(), IdentityError> {
        let secret = self.secret_bytes();
        let b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &secret,
        );

        let store = app
            .store(STORE_FILE)
            .map_err(|e| IdentityError::StoreOpen(e.to_string()))?;
        store.set(STORE_KEY_PRIVATE, serde_json::json!(b64));
        store
            .save()
            .map_err(|e| IdentityError::StoreSave(e.to_string()))?;
        Ok(())
    }

    /// The Ed25519 signing key.
    pub fn signing_key(&self) -> &SigningKey {
        &self.signing_key
    }

    /// The Ed25519 public key bytes (32 bytes).
    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    /// Sign a message, returning the 64-byte signature.
    pub fn sign(&self, message: &[u8]) -> Vec<u8> {
        use ed25519_dalek::Signer;
        self.signing_key.sign(message).to_bytes().to_vec()
    }

    /// Return the X25519 public key (32 bytes) derived from this node's Ed25519 public key.
    pub fn to_x25519_public(&self) -> [u8; 32] {
        let ed_pub_bytes = self.public_key_bytes();
        crate::relay::crypto::ed25519_public_to_x25519(&ed_pub_bytes)
    }

    /// Export the secret key bytes (32 bytes).
    pub fn secret_bytes(&self) -> Vec<u8> {
        self.signing_key.to_bytes().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_creates_valid_identity() {
        let id = NodeIdentity::generate();
        let pub_bytes = id.public_key_bytes();
        assert_eq!(pub_bytes.len(), 32);
        // Verify relay peer_id derivation works
        let relay_id = crate::relay::relay_client::derive_relay_peer_id(&pub_bytes);
        assert_eq!(relay_id.len(), 32); // hex-encoded 16 bytes
    }

    #[test]
    fn test_deterministic_key_from_same_secret() {
        let id1 = NodeIdentity::generate();
        let secret = id1.secret_bytes();
        let id2 = NodeIdentity::from_secret_bytes(&secret).unwrap();
        assert_eq!(id1.public_key_bytes(), id2.public_key_bytes());
    }

    #[test]
    fn test_different_keys_produce_different_public_keys() {
        let id1 = NodeIdentity::generate();
        let id2 = NodeIdentity::generate();
        assert_ne!(id1.public_key_bytes(), id2.public_key_bytes());
    }

    #[test]
    fn test_secret_bytes_roundtrip() {
        let id = NodeIdentity::generate();
        let secret = id.secret_bytes();
        assert_eq!(secret.len(), 32);
        let restored = NodeIdentity::from_secret_bytes(&secret).unwrap();
        assert_eq!(id.public_key_bytes(), restored.public_key_bytes());
    }

    #[test]
    fn test_from_invalid_secret_bytes() {
        let result = NodeIdentity::from_secret_bytes(&[0u8; 16]);
        assert!(result.is_err());
    }

    #[test]
    fn test_signing_and_verification() {
        use ed25519_dalek::{Verifier, Signature};
        let id = NodeIdentity::generate();
        let message = b"hello relay world";
        let sig_bytes = id.sign(message);
        let sig = Signature::from_bytes(&sig_bytes.try_into().unwrap());
        let verifying_key = id.signing_key().verifying_key();
        assert!(verifying_key.verify(message, &sig).is_ok());
        assert!(verifying_key.verify(b"tampered", &sig).is_err());
    }

    #[test]
    fn test_sign_produces_64_byte_signature() {
        let id = NodeIdentity::generate();
        let sig = id.sign(b"test message");
        assert_eq!(sig.len(), 64);
    }

    #[test]
    fn test_clone_preserves_identity() {
        let id1 = NodeIdentity::generate();
        let id2 = id1.clone();
        assert_eq!(id1.public_key_bytes(), id2.public_key_bytes());
        assert_eq!(id1.secret_bytes(), id2.secret_bytes());
    }

    #[test]
    fn test_x25519_public_key_is_32_bytes() {
        let id = NodeIdentity::generate();
        let x25519_pub = id.to_x25519_public();
        assert_eq!(x25519_pub.len(), 32);
    }

    #[test]
    fn test_x25519_public_differs_from_ed25519_public() {
        let id = NodeIdentity::generate();
        let ed_pub = id.public_key_bytes();
        let x_pub = id.to_x25519_public();
        // They should (almost certainly) differ since they are different curve representations
        assert_ne!(ed_pub, x_pub);
    }

    #[test]
    fn test_from_secret_bytes_wrong_length_31() {
        let result = NodeIdentity::from_secret_bytes(&[0u8; 31]);
        assert!(result.is_err());
        match result {
            Err(IdentityError::InvalidKey(msg)) => assert!(msg.contains("32 bytes")),
            _ => panic!("expected InvalidKey error"),
        }
    }

    #[test]
    fn test_from_secret_bytes_wrong_length_33() {
        let result = NodeIdentity::from_secret_bytes(&[0u8; 33]);
        assert!(matches!(result, Err(IdentityError::InvalidKey(_))));
    }

    #[test]
    fn test_from_secret_bytes_empty() {
        let result = NodeIdentity::from_secret_bytes(&[]);
        assert!(matches!(result, Err(IdentityError::InvalidKey(_))));
    }
}
