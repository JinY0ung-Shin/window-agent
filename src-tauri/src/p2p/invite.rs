use chrono::{Duration, Utc};

use super::contact_card::{ContactCard, ContactCardError};
use super::identity::NodeIdentity;

/// Generate an invite code from the local identity.
pub fn generate_invite(
    identity: &NodeIdentity,
    addresses: Vec<String>,
    agent_name: String,
    agent_description: String,
    expiry_hours: Option<u64>,
) -> Result<String, ContactCardError> {
    let expiry = expiry_hours.map(|hours| (Utc::now() + Duration::hours(hours as i64)).to_rfc3339());

    let card = ContactCard::create(identity, addresses, agent_name, agent_description, expiry)?;
    card.to_invite_code()
}

/// Parse and validate an invite code.
pub fn parse_invite(code: &str) -> Result<ContactCard, ContactCardError> {
    let card = ContactCard::from_invite_code(code)?;
    if !card.verify()? {
        return Err(ContactCardError::InvalidSignature);
    }
    if card.is_expired() {
        return Err(ContactCardError::Expired);
    }
    Ok(card)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_identity() -> NodeIdentity {
        NodeIdentity::generate()
    }

    #[test]
    fn test_generate_and_parse_invite() {
        let id = test_identity();
        let code = generate_invite(
            &id,
            vec!["/ip4/127.0.0.1/tcp/4001".to_string()],
            "Agent".into(),
            "Description".into(),
            Some(24),
        )
        .unwrap();

        let card = parse_invite(&code).unwrap();
        assert_eq!(card.peer_id, id.peer_id().to_string());
        assert_eq!(card.agent_name, "Agent");
        assert!(card.expiry.is_some());
    }

    #[test]
    fn test_generate_invite_no_expiry() {
        let id = test_identity();
        let code = generate_invite(
            &id,
            vec![],
            "Agent".into(),
            "Desc".into(),
            None,
        )
        .unwrap();

        let card = parse_invite(&code).unwrap();
        assert!(card.expiry.is_none());
    }

    #[test]
    fn test_parse_invite_invalid_signature() {
        let id = test_identity();
        let mut card = ContactCard::create(
            &id,
            vec![],
            "Agent".into(),
            "Desc".into(),
            None,
        )
        .unwrap();
        card.signature[0] ^= 0xFF;
        let code = card.to_invite_code().unwrap();

        let result = parse_invite(&code);
        assert!(matches!(result, Err(ContactCardError::InvalidSignature)));
    }

    #[test]
    fn test_parse_invite_expired() {
        let id = test_identity();
        let expiry = (Utc::now() - Duration::hours(1)).to_rfc3339();
        let card = ContactCard::create(
            &id,
            vec![],
            "Agent".into(),
            "Desc".into(),
            Some(expiry),
        )
        .unwrap();
        let code = card.to_invite_code().unwrap();

        let result = parse_invite(&code);
        assert!(matches!(result, Err(ContactCardError::Expired)));
    }

    #[test]
    fn test_parse_invite_invalid_code() {
        let result = parse_invite("garbage-data!!!");
        assert!(result.is_err());
    }

    #[test]
    fn test_invite_roundtrip_preserves_all_fields() {
        let id = test_identity();
        let code = generate_invite(
            &id,
            vec![
                "/ip4/1.2.3.4/tcp/4001".to_string(),
                "/ip4/5.6.7.8/udp/4002/quic-v1".to_string(),
            ],
            "MyAgent".into(),
            "My agent description".into(),
            Some(48),
        )
        .unwrap();

        let card = parse_invite(&code).unwrap();
        assert_eq!(card.addresses.len(), 2);
        assert_eq!(card.agent_name, "MyAgent");
        assert_eq!(card.agent_description, "My agent description");
        assert!(card.verify().unwrap());
    }
}
