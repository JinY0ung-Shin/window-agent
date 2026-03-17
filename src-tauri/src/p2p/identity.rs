use libp2p_identity::{Keypair, PeerId};
use tauri_plugin_store::StoreExt;
use thiserror::Error;

const STORE_FILE: &str = "p2p-identity.json";
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
    keypair: Keypair,
    peer_id: PeerId,
}

impl Clone for NodeIdentity {
    fn clone(&self) -> Self {
        Self {
            keypair: self.keypair.clone(),
            peer_id: self.peer_id,
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
        let keypair = Keypair::generate_ed25519();
        let peer_id = keypair.public().to_peer_id();
        Self { keypair, peer_id }
    }

    /// Create from raw Ed25519 secret key bytes (32 bytes).
    pub fn from_secret_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
        let mut buf = bytes.to_vec();
        let keypair = Keypair::ed25519_from_bytes(&mut buf)
            .map_err(|e| IdentityError::InvalidKey(e.to_string()))?;
        let peer_id = keypair.public().to_peer_id();
        Ok(Self { keypair, peer_id })
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
        let secret = self.secret_bytes()?;
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

    /// The libp2p Keypair (for signing, etc.).
    pub fn keypair(&self) -> &Keypair {
        &self.keypair
    }

    /// The PeerId derived from the public key.
    pub fn peer_id(&self) -> &PeerId {
        &self.peer_id
    }

    /// Export the secret key bytes (32 bytes) for backup/transfer.
    pub fn secret_bytes(&self) -> Result<Vec<u8>, IdentityError> {
        let ed_keypair = self
            .keypair
            .clone()
            .try_into_ed25519()
            .map_err(|e| IdentityError::InvalidKey(e.to_string()))?;
        let secret = ed_keypair.secret();
        Ok(secret.as_ref().to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_creates_valid_identity() {
        let id = NodeIdentity::generate();
        let peer_str = id.peer_id().to_string();
        assert!(!peer_str.is_empty());
        assert!(peer_str.starts_with("12D3KooW"), "PeerId: {peer_str}");
    }

    #[test]
    fn test_deterministic_peer_id_from_same_secret() {
        let id1 = NodeIdentity::generate();
        let secret = id1.secret_bytes().unwrap();
        let id2 = NodeIdentity::from_secret_bytes(&secret).unwrap();
        assert_eq!(id1.peer_id(), id2.peer_id());
    }

    #[test]
    fn test_different_keys_produce_different_peer_ids() {
        let id1 = NodeIdentity::generate();
        let id2 = NodeIdentity::generate();
        assert_ne!(id1.peer_id(), id2.peer_id());
    }

    #[test]
    fn test_secret_bytes_roundtrip() {
        let id = NodeIdentity::generate();
        let secret = id.secret_bytes().unwrap();
        assert_eq!(secret.len(), 32);
        let restored = NodeIdentity::from_secret_bytes(&secret).unwrap();
        assert_eq!(id.peer_id(), restored.peer_id());
    }

    #[test]
    fn test_from_invalid_secret_bytes() {
        let result = NodeIdentity::from_secret_bytes(&[0u8; 16]);
        assert!(result.is_err());
    }

    #[test]
    fn test_keypair_is_ed25519() {
        let id = NodeIdentity::generate();
        let ed = id.keypair().clone().try_into_ed25519();
        assert!(ed.is_ok());
    }

    #[test]
    fn test_signing_and_verification() {
        let id = NodeIdentity::generate();
        let message = b"hello p2p world";
        let ed_keypair = id.keypair().clone().try_into_ed25519().unwrap();
        let signature = ed_keypair.sign(message);
        assert!(ed_keypair.public().verify(message, &signature));
        assert!(!ed_keypair.public().verify(b"tampered", &signature));
    }
}
