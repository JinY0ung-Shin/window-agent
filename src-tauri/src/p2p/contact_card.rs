use base64::Engine;
use chrono::Utc;
use libp2p_identity::ed25519;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::identity::NodeIdentity;

#[derive(Debug, Error)]
pub enum ContactCardError {
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Invalid signature")]
    InvalidSignature,
    #[error("Card has expired")]
    Expired,
    #[error("Invalid public key: {0}")]
    InvalidKey(String),
    #[error("Decode error: {0}")]
    Decode(String),
}

/// A signed contact card that can be shared as an invite code.
/// Contains everything needed to establish a P2P connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactCard {
    pub peer_id: String,
    pub public_key: Vec<u8>,
    pub addresses: Vec<String>,
    pub relay_hints: Vec<String>,
    pub expiry: Option<String>,
    pub agent_name: String,
    pub agent_description: String,
    pub created_at: String,
    pub signature: Vec<u8>,
}

/// All fields except `signature`, serialized in declaration order for canonical signing.
#[derive(Serialize)]
struct SignableContent<'a> {
    peer_id: &'a str,
    public_key: &'a [u8],
    addresses: &'a [String],
    relay_hints: &'a [String],
    expiry: &'a Option<String>,
    agent_name: &'a str,
    agent_description: &'a str,
    created_at: &'a str,
}

impl ContactCard {
    /// Create and sign a new contact card.
    pub fn create(
        identity: &NodeIdentity,
        addresses: Vec<String>,
        agent_name: String,
        agent_description: String,
        expiry: Option<String>,
    ) -> Result<Self, ContactCardError> {
        let ed_keypair = identity
            .keypair()
            .clone()
            .try_into_ed25519()
            .map_err(|e| ContactCardError::InvalidKey(e.to_string()))?;

        let peer_id = identity.peer_id().to_string();
        let public_key = ed_keypair.public().to_bytes().to_vec();
        let created_at = Utc::now().to_rfc3339();

        let mut card = Self {
            peer_id,
            public_key,
            addresses,
            relay_hints: Vec::new(),
            expiry,
            agent_name,
            agent_description,
            created_at,
            signature: Vec::new(),
        };

        let signable = card.signable_bytes()?;
        card.signature = ed_keypair.sign(&signable);

        Ok(card)
    }

    /// Verify the card's signature using the embedded public key.
    pub fn verify(&self) -> Result<bool, ContactCardError> {
        let pubkey = ed25519::PublicKey::try_from_bytes(&self.public_key)
            .map_err(|e| ContactCardError::InvalidKey(e.to_string()))?;
        let signable = self.signable_bytes()?;
        Ok(pubkey.verify(&signable, &self.signature))
    }

    /// Check if the card has expired.
    pub fn is_expired(&self) -> bool {
        match &self.expiry {
            None => false,
            Some(expiry_str) => chrono::DateTime::parse_from_rfc3339(expiry_str)
                .map(|exp| Utc::now() > exp)
                .unwrap_or(true),
        }
    }

    /// Serialize to base64 invite string.
    pub fn to_invite_code(&self) -> Result<String, ContactCardError> {
        let json = serde_json::to_vec(self)
            .map_err(|e| ContactCardError::Serialization(e.to_string()))?;
        Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&json))
    }

    /// Deserialize from base64 invite string.
    pub fn from_invite_code(code: &str) -> Result<Self, ContactCardError> {
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(code)
            .map_err(|e| ContactCardError::Decode(e.to_string()))?;
        serde_json::from_slice(&bytes).map_err(|e| ContactCardError::Serialization(e.to_string()))
    }

    /// Canonical JSON bytes for signing/verification.
    fn signable_bytes(&self) -> Result<Vec<u8>, ContactCardError> {
        let content = SignableContent {
            peer_id: &self.peer_id,
            public_key: &self.public_key,
            addresses: &self.addresses,
            relay_hints: &self.relay_hints,
            expiry: &self.expiry,
            agent_name: &self.agent_name,
            agent_description: &self.agent_description,
            created_at: &self.created_at,
        };
        serde_json::to_vec(&content).map_err(|e| ContactCardError::Serialization(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_identity() -> NodeIdentity {
        NodeIdentity::generate()
    }

    fn create_test_card(identity: &NodeIdentity) -> ContactCard {
        ContactCard::create(
            identity,
            vec!["/ip4/127.0.0.1/tcp/4001".to_string()],
            "TestAgent".to_string(),
            "A test agent".to_string(),
            None,
        )
        .unwrap()
    }

    #[test]
    fn test_create_and_sign() {
        let id = test_identity();
        let card = create_test_card(&id);

        assert_eq!(card.peer_id, id.peer_id().to_string());
        assert_eq!(card.public_key.len(), 32);
        assert!(!card.signature.is_empty());
        assert_eq!(card.agent_name, "TestAgent");
        assert_eq!(card.addresses.len(), 1);
        assert!(card.relay_hints.is_empty());
        assert!(card.expiry.is_none());
    }

    #[test]
    fn test_verify_valid_signature() {
        let id = test_identity();
        let card = create_test_card(&id);
        assert!(card.verify().unwrap());
    }

    #[test]
    fn test_verify_tampered_signature() {
        let id = test_identity();
        let mut card = create_test_card(&id);
        card.signature[0] ^= 0xFF;
        assert!(!card.verify().unwrap());
    }

    #[test]
    fn test_verify_tampered_content() {
        let id = test_identity();
        let mut card = create_test_card(&id);
        card.agent_name = "TamperedAgent".to_string();
        assert!(!card.verify().unwrap());
    }

    #[test]
    fn test_verify_wrong_public_key() {
        let id1 = test_identity();
        let id2 = test_identity();
        let mut card = create_test_card(&id1);
        let ed2 = id2.keypair().clone().try_into_ed25519().unwrap();
        card.public_key = ed2.public().to_bytes().to_vec();
        assert!(!card.verify().unwrap());
    }

    #[test]
    fn test_verify_invalid_public_key_bytes() {
        let id = test_identity();
        let mut card = create_test_card(&id);
        card.public_key = vec![0u8; 16]; // wrong length
        assert!(card.verify().is_err());
    }

    #[test]
    fn test_not_expired_no_expiry() {
        let id = test_identity();
        let card = create_test_card(&id);
        assert!(!card.is_expired());
    }

    #[test]
    fn test_not_expired_future() {
        let id = test_identity();
        let expiry = (Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        let card = ContactCard::create(
            &id,
            vec![],
            "Agent".into(),
            "Desc".into(),
            Some(expiry),
        )
        .unwrap();
        assert!(!card.is_expired());
    }

    #[test]
    fn test_expired_past() {
        let id = test_identity();
        let expiry = (Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        let card = ContactCard::create(
            &id,
            vec![],
            "Agent".into(),
            "Desc".into(),
            Some(expiry),
        )
        .unwrap();
        assert!(card.is_expired());
    }

    #[test]
    fn test_expired_invalid_format() {
        let id = test_identity();
        let mut card = create_test_card(&id);
        card.expiry = Some("not-a-date".to_string());
        assert!(card.is_expired());
    }

    #[test]
    fn test_invite_code_roundtrip() {
        let id = test_identity();
        let card = create_test_card(&id);
        let code = card.to_invite_code().unwrap();
        let restored = ContactCard::from_invite_code(&code).unwrap();

        assert_eq!(card.peer_id, restored.peer_id);
        assert_eq!(card.public_key, restored.public_key);
        assert_eq!(card.addresses, restored.addresses);
        assert_eq!(card.agent_name, restored.agent_name);
        assert_eq!(card.signature, restored.signature);
        assert!(restored.verify().unwrap());
    }

    #[test]
    fn test_invite_code_invalid_base64() {
        let result = ContactCard::from_invite_code("!!!invalid!!!");
        assert!(result.is_err());
    }

    #[test]
    fn test_invite_code_invalid_json() {
        let code = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"not json");
        let result = ContactCard::from_invite_code(&code);
        assert!(result.is_err());
    }

    #[test]
    fn test_create_with_multiple_addresses() {
        let id = test_identity();
        let addrs = vec![
            "/ip4/127.0.0.1/tcp/4001".to_string(),
            "/ip4/192.168.1.1/tcp/4001".to_string(),
            "/ip6/::1/tcp/4001".to_string(),
        ];
        let card = ContactCard::create(
            &id,
            addrs.clone(),
            "MultiAddr".into(),
            "Multiple addresses".into(),
            None,
        )
        .unwrap();
        assert_eq!(card.addresses, addrs);
        assert!(card.verify().unwrap());
    }

    #[test]
    fn test_different_identities_produce_different_cards() {
        let id1 = test_identity();
        let id2 = test_identity();
        let card1 = create_test_card(&id1);
        let card2 = create_test_card(&id2);
        assert_ne!(card1.peer_id, card2.peer_id);
        assert_ne!(card1.public_key, card2.public_key);
    }
}
