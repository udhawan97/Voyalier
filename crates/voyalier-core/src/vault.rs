//! Authenticated encryption primitive for the encrypted vault (data at rest).
//!
//! XChaCha20-Poly1305 seal/open. This module is pure and deterministic: the
//! nonce is supplied by the caller, so given the same key, nonce, and plaintext
//! it always produces the same bytes (which makes it fully testable). Generating
//! a unique random nonce per message, and storing the data key in the OS
//! keychain, is the application layer's job — never reuse a nonce with a key.
//!
//! This is the cryptographic foundation only; wiring it into storage (and the
//! unlock experience) is a later, separate step.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};

use crate::types::{AppError, ErrorCode};

/// The vault data-key length (bytes).
pub const VAULT_KEY_LEN: usize = 32;
/// The XChaCha20-Poly1305 nonce length (bytes).
pub const VAULT_NONCE_LEN: usize = 24;

/// Encrypt `plaintext` under `key` with `nonce`. The nonce is prepended to the
/// returned bytes so [`open`] needs only the key. The caller MUST pass a unique
/// random nonce for every message sealed with a given key.
pub fn seal(
    key: &[u8; VAULT_KEY_LEN],
    nonce: &[u8; VAULT_NONCE_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(nonce), plaintext)
        .map_err(|_| {
            AppError::new(
                ErrorCode::InternalUnexpected,
                "the vault could not seal the data",
            )
        })?;
    let mut sealed = Vec::with_capacity(VAULT_NONCE_LEN + ciphertext.len());
    sealed.extend_from_slice(nonce);
    sealed.extend_from_slice(&ciphertext);
    Ok(sealed)
}

/// Decrypt bytes produced by [`seal`], verifying integrity. Fails if the key is
/// wrong, the data was tampered with, or the input is too short.
pub fn open(key: &[u8; VAULT_KEY_LEN], sealed: &[u8]) -> Result<Vec<u8>, AppError> {
    if sealed.len() < VAULT_NONCE_LEN {
        return Err(vault_open_error());
    }
    let (nonce, ciphertext) = sealed.split_at(VAULT_NONCE_LEN);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(XNonce::from_slice(nonce), ciphertext)
        .map_err(|_| vault_open_error())
}

fn vault_open_error() -> AppError {
    AppError::new(
        ErrorCode::StorageFailure,
        "the encrypted data could not be opened (wrong key or tampered)",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> [u8; VAULT_KEY_LEN] {
        [7u8; VAULT_KEY_LEN]
    }

    fn nonce() -> [u8; VAULT_NONCE_LEN] {
        [3u8; VAULT_NONCE_LEN]
    }

    #[test]
    fn seals_and_opens_round_trip() {
        let plaintext = b"River Paper Inn confirmation RPI731";
        let sealed = seal(&key(), &nonce(), plaintext).expect("seal");
        // The nonce is carried up front; ciphertext follows and differs from plain.
        assert_eq!(&sealed[..VAULT_NONCE_LEN], &nonce());
        assert!(sealed.len() > VAULT_NONCE_LEN + plaintext.len()); // + auth tag
        assert_ne!(&sealed[VAULT_NONCE_LEN..], plaintext);

        let opened = open(&key(), &sealed).expect("open");
        assert_eq!(opened, plaintext);
    }

    #[test]
    fn is_deterministic_for_a_fixed_key_and_nonce() {
        let a = seal(&key(), &nonce(), b"same").expect("seal");
        let b = seal(&key(), &nonce(), b"same").expect("seal");
        assert_eq!(a, b);
    }

    #[test]
    fn rejects_the_wrong_key() {
        let sealed = seal(&key(), &nonce(), b"secret").expect("seal");
        let mut other = key();
        other[0] ^= 0xff;
        assert_eq!(
            open(&other, &sealed).expect_err("wrong key").code,
            ErrorCode::StorageFailure
        );
    }

    #[test]
    fn rejects_tampered_ciphertext_and_short_input() {
        let mut sealed = seal(&key(), &nonce(), b"secret").expect("seal");
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01; // flip a ciphertext/tag bit
        assert!(open(&key(), &sealed).is_err());
        assert!(open(&key(), &[0u8; 4]).is_err());
    }
}
