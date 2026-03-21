//! E2E encryption: X25519 DH key exchange + ChaCha20-Poly1305 AEAD.

use chacha20poly1305::{aead::Aead, ChaCha20Poly1305, KeyInit};
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use wa_shared::encrypted_envelope::EnvelopeHeader;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret as X25519StaticSecret};

/// Derive a 32-byte symmetric key from a shared DH secret using HKDF-SHA256.
fn derive_symmetric_key(shared_secret: &[u8]) -> [u8; 32] {
    let hkdf = Hkdf::<Sha256>::new(None, shared_secret);
    let mut key = [0u8; 32];
    hkdf.expand(b"wa-e2e-chacha20poly1305", &mut key)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    key
}

/// Convert an Ed25519 secret key (32 bytes) to an X25519 static secret.
///
/// Ed25519 seeds are clamped by X25519 internally, so we hash with SHA-512
/// (same as ed25519-dalek's expand_secret) and take the lower 32 bytes.
fn ed25519_secret_to_x25519(ed_secret: &[u8; 32]) -> X25519StaticSecret {
    use sha2::{Digest, Sha512};
    let hash = Sha512::digest(ed_secret);
    let mut x_bytes = [0u8; 32];
    x_bytes.copy_from_slice(&hash[..32]);
    X25519StaticSecret::from(x_bytes)
}

/// Convert an Ed25519 public key (32 bytes) to an X25519 public key.
///
/// Uses curve25519-dalek's `MontgomeryPoint` conversion under the hood.
pub fn ed25519_public_to_x25519(ed_public: &[u8; 32]) -> [u8; 32] {
    use ed25519_dalek::VerifyingKey;
    let verifying = VerifyingKey::from_bytes(ed_public).expect("valid ed25519 public key");
    verifying.to_montgomery().to_bytes()
}

/// Encrypt a payload using X25519 DH + ChaCha20-Poly1305.
///
/// Returns `(ciphertext, nonce, sender_x25519_public)`.
pub fn encrypt_payload(
    sender_ed25519_secret: &[u8; 32],
    receiver_ed25519_public: &[u8; 32],
    header: &EnvelopeHeader,
    payload_json: &[u8],
) -> Result<(Vec<u8>, [u8; 12], [u8; 32]), CryptoError> {
    // Convert Ed25519 keys to X25519
    let sender_x25519_secret = ed25519_secret_to_x25519(sender_ed25519_secret);
    let sender_x25519_public = X25519PublicKey::from(&sender_x25519_secret);

    let receiver_x25519_public = X25519PublicKey::from(ed25519_public_to_x25519(receiver_ed25519_public));

    // DH shared secret
    let shared_secret = sender_x25519_secret.diffie_hellman(&receiver_x25519_public);
    let sym_key = derive_symmetric_key(shared_secret.as_bytes());

    // AEAD encrypt
    let cipher = ChaCha20Poly1305::new_from_slice(&sym_key)
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;

    let mut nonce_bytes = [0u8; 12];
    OsRng.try_fill_bytes(&mut nonce_bytes)
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;
    let nonce = chacha20poly1305::Nonce::from(nonce_bytes);

    let aad = header.to_aad();
    let payload = chacha20poly1305::aead::Payload {
        msg: payload_json,
        aad: &aad,
    };

    let ciphertext = cipher
        .encrypt(&nonce, payload)
        .map_err(|e| CryptoError::Encryption(e.to_string()))?;

    Ok((ciphertext, nonce_bytes, sender_x25519_public.to_bytes()))
}

/// Decrypt a payload using X25519 DH + ChaCha20-Poly1305.
pub fn decrypt_payload(
    receiver_ed25519_secret: &[u8; 32],
    sender_x25519_public: &[u8; 32],
    header: &EnvelopeHeader,
    encrypted: &[u8],
    nonce: &[u8; 12],
) -> Result<Vec<u8>, CryptoError> {
    // Convert receiver Ed25519 secret to X25519
    let receiver_x25519_secret = ed25519_secret_to_x25519(receiver_ed25519_secret);
    let sender_pub = X25519PublicKey::from(*sender_x25519_public);

    // DH shared secret
    let shared_secret = receiver_x25519_secret.diffie_hellman(&sender_pub);
    let sym_key = derive_symmetric_key(shared_secret.as_bytes());

    // AEAD decrypt
    let cipher = ChaCha20Poly1305::new_from_slice(&sym_key)
        .map_err(|e| CryptoError::Decryption(e.to_string()))?;

    let nonce = chacha20poly1305::Nonce::from(*nonce);
    let aad = header.to_aad();
    let payload = chacha20poly1305::aead::Payload {
        msg: encrypted,
        aad: &aad,
    };

    cipher
        .decrypt(&nonce, payload)
        .map_err(|e| CryptoError::Decryption(e.to_string()))
}

use rand::RngCore;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Encryption failed: {0}")]
    Encryption(String),
    #[error("Decryption failed: {0}")]
    Decryption(String),
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;

    fn generate_ed25519_keypair() -> (SigningKey, [u8; 32], [u8; 32]) {
        let signing = SigningKey::generate(&mut OsRng);
        let secret = signing.to_bytes();
        let public = signing.verifying_key().to_bytes();
        (signing, secret, public)
    }

    fn make_header() -> EnvelopeHeader {
        EnvelopeHeader {
            version: 1,
            message_id: "test-msg-001".to_string(),
            sender_agent: "agent-a".to_string(),
            correlation_id: None,
            timestamp: "2026-03-21T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_ed25519_to_x25519_key_conversion() {
        let (_signing, secret, public) = generate_ed25519_keypair();

        // Derived X25519 secret from Ed25519 secret should produce a valid X25519 public key
        let x_secret = ed25519_secret_to_x25519(&secret);
        let x_public_from_secret = X25519PublicKey::from(&x_secret);

        // Ed25519 public to X25519 public
        let x_public_from_ed_pub = ed25519_public_to_x25519(&public);

        // Both derivations must yield the same X25519 public key
        assert_eq!(
            x_public_from_secret.to_bytes(),
            x_public_from_ed_pub,
            "X25519 public key derived from secret must match that derived from Ed25519 public key"
        );
    }

    #[test]
    fn test_roundtrip_encrypt_decrypt() {
        let (_, alice_secret, _) = generate_ed25519_keypair();
        let (_, bob_secret, bob_public) = generate_ed25519_keypair();

        let header = make_header();
        let plaintext = b"hello, world!";

        let (ciphertext, nonce, sender_x25519_pub) =
            encrypt_payload(&alice_secret, &bob_public, &header, plaintext).unwrap();

        let decrypted = decrypt_payload(
            &bob_secret,
            &sender_x25519_pub,
            &header,
            &ciphertext,
            &nonce,
        )
        .unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_two_keypairs_cross_encrypt() {
        let (_, alice_secret, alice_public) = generate_ed25519_keypair();
        let (_, bob_secret, bob_public) = generate_ed25519_keypair();

        let header = make_header();

        // Alice → Bob
        let msg_ab = b"alice to bob";
        let (ct_ab, nonce_ab, alice_x_pub) =
            encrypt_payload(&alice_secret, &bob_public, &header, msg_ab).unwrap();
        let dec_ab = decrypt_payload(&bob_secret, &alice_x_pub, &header, &ct_ab, &nonce_ab).unwrap();
        assert_eq!(dec_ab, msg_ab);

        // Bob → Alice
        let msg_ba = b"bob to alice";
        let (ct_ba, nonce_ba, bob_x_pub) =
            encrypt_payload(&bob_secret, &alice_public, &header, msg_ba).unwrap();
        let dec_ba = decrypt_payload(&alice_secret, &bob_x_pub, &header, &ct_ba, &nonce_ba).unwrap();
        assert_eq!(dec_ba, msg_ba);
    }

    #[test]
    fn test_tampered_aad_fails_decryption() {
        let (_, alice_secret, _alice_public) = generate_ed25519_keypair();
        let (_, bob_secret, bob_public) = generate_ed25519_keypair();

        let header = make_header();
        let plaintext = b"sensitive data";

        let (ciphertext, nonce, sender_x_pub) =
            encrypt_payload(&alice_secret, &bob_public, &header, plaintext).unwrap();

        // Tamper with the header (change message_id)
        let mut tampered_header = header.clone();
        tampered_header.message_id = "tampered-id".to_string();

        let result = decrypt_payload(
            &bob_secret,
            &sender_x_pub,
            &tampered_header,
            &ciphertext,
            &nonce,
        );
        assert!(result.is_err(), "Decryption must fail when AAD is tampered");
    }

    #[test]
    fn test_wrong_receiver_fails_decryption() {
        let (_, alice_secret, _) = generate_ed25519_keypair();
        let (_, _bob_secret, bob_public) = generate_ed25519_keypair();
        let (_, eve_secret, _) = generate_ed25519_keypair();

        let header = make_header();
        let plaintext = b"for bob only";

        let (ciphertext, nonce, sender_x_pub) =
            encrypt_payload(&alice_secret, &bob_public, &header, plaintext).unwrap();

        // Eve tries to decrypt
        let result = decrypt_payload(
            &eve_secret,
            &sender_x_pub,
            &header,
            &ciphertext,
            &nonce,
        );
        assert!(result.is_err(), "Wrong receiver must not decrypt");
    }
}
