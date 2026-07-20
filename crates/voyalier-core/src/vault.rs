//! Authenticated encryption primitive for the encrypted vault (data at rest).
//!
//! XChaCha20-Poly1305 seal/open. This module is pure and deterministic: the
//! nonce is supplied by the caller, so given the same key, nonce, and plaintext
//! it always produces the same bytes (which makes it fully testable). Generating
//! a unique random nonce per message, and storing the data key in the OS
//! keychain, is the application layer's job — never reuse a nonce with a key.
//!
//! [`derive_key`] turns a passphrase into a key-encryption key (Argon2id) so the
//! data key can optionally be wrapped under a passphrase the user knows. It is
//! pure too — the salt is supplied by the caller.

use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

use crate::types::{AppError, ErrorCode};

/// The vault data-key length (bytes).
pub const VAULT_KEY_LEN: usize = 32;
/// The XChaCha20-Poly1305 nonce length (bytes).
pub const VAULT_NONCE_LEN: usize = 24;
/// The passphrase-salt length (bytes) — comfortably above Argon2's minimum.
pub const VAULT_SALT_LEN: usize = 16;

/// Derive a 32-byte key-encryption key from a passphrase and salt using Argon2id.
///
/// Pure and deterministic: the same passphrase and salt always produce the same
/// key, which is what lets the vault unwrap its data key when the user re-enters
/// their passphrase. Generating and storing the random salt — and never using
/// the derived key for anything but wrapping the data key — is the application
/// layer's job.
pub fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; VAULT_KEY_LEN], AppError> {
    let mut key = [0u8; VAULT_KEY_LEN];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|_| {
            AppError::new(
                ErrorCode::InternalUnexpected,
                "the vault could not derive a key from the passphrase",
            )
        })?;
    Ok(key)
}

/// Encrypt `plaintext` under `key` with `nonce`. The nonce is prepended to the
/// returned bytes so [`open`] needs only the key. The caller MUST pass a unique
/// random nonce for every message sealed with a given key.
pub fn seal(
    key: &[u8; VAULT_KEY_LEN],
    nonce: &[u8; VAULT_NONCE_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>, AppError> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let ciphertext = cipher.encrypt(nonce.into(), plaintext).map_err(|_| {
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
    let nonce = <&XNonce>::try_from(nonce).map_err(|_| vault_open_error())?;
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(nonce, ciphertext)
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
    fn ciphertext_stays_compatible_with_chacha20poly1305_0_10() {
        // Captured with chacha20poly1305 0.10.1 before the 0.11 API migration.
        // Existing vault rows and portable backups carry exactly these bytes,
        // so the dependency may change its interface but never this format.
        const PRE_UPGRADE_SEALED: [u8; 44] = [
            3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 247, 103, 38,
            126, 46, 141, 128, 66, 235, 189, 134, 138, 61, 40, 76, 167, 203, 27, 200, 121,
        ];

        let sealed = seal(&key(), &nonce(), b"same").expect("seal");
        assert_eq!(sealed, PRE_UPGRADE_SEALED);
        assert_eq!(
            open(&key(), &PRE_UPGRADE_SEALED).expect("open pre-upgrade bytes"),
            b"same"
        );
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

    #[test]
    fn derives_the_same_key_for_the_same_passphrase_and_salt() {
        let salt = [9u8; VAULT_SALT_LEN];
        let a = derive_key("correct horse battery staple", &salt).expect("derive");
        let b = derive_key("correct horse battery staple", &salt).expect("derive");
        assert_eq!(a, b);
        assert_ne!(a, [0u8; VAULT_KEY_LEN]);
    }

    #[test]
    fn derives_a_different_key_for_a_different_passphrase_or_salt() {
        let salt = [9u8; VAULT_SALT_LEN];
        let base = derive_key("passphrase-one", &salt).expect("derive");
        assert_ne!(base, derive_key("passphrase-two", &salt).expect("derive"));
        assert_ne!(
            base,
            derive_key("passphrase-one", &[1u8; VAULT_SALT_LEN]).expect("derive")
        );
    }

    #[test]
    fn wraps_and_unwraps_a_data_key_under_a_passphrase() {
        // The real flow: derive a KEK, seal the data key under it, then recover
        // the data key only with the correct passphrase.
        let data_key = [42u8; VAULT_KEY_LEN];
        let salt = [5u8; VAULT_SALT_LEN];
        let kek = derive_key("open sesame", &salt).expect("derive");
        let wrapped = seal(&kek, &nonce(), &data_key).expect("wrap");

        let right = derive_key("open sesame", &salt).expect("derive");
        assert_eq!(open(&right, &wrapped).expect("unwrap"), data_key);

        let wrong = derive_key("not it", &salt).expect("derive");
        assert!(open(&wrong, &wrapped).is_err());
    }
}
