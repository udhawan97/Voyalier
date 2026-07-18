//! The workspace backup container (`.vbk`) — a portable, passphrase-encrypted
//! snapshot of the whole workspace.
//!
//! Every sealed row in the database is encrypted under a data key that lives in
//! the OS keychain, never in the database. So a raw copy of the SQLite file is
//! worthless on another machine. This container carries the data key **re-wrapped
//! under a passphrase the user knows**, alongside the snapshot, which is what
//! makes a backup restorable anywhere.
//!
//! The whole body is sealed — not just the already-sealed rows — so plaintext
//! columns (trip names, dates, destinations) are opaque in the file too.
//!
//! Like [`crate::vault`], this module is pure and deterministic: the salt and
//! nonce are supplied by the caller, which makes it fully testable. Generating
//! them randomly, once per backup, is the application layer's job.
//!
//! ```text
//! magic          : 4 bytes  = b"VBK1"
//! format_version : u16 LE
//! salt           : 16 bytes                  (Argon2id salt for the passphrase)
//! sealed_body    : rest = seal(kek, nonce, body)   (seal prepends the nonce)
//!
//! body:
//!   key_present  : 1 byte   (1 = a data key follows, 0 = the vault was inactive)
//!   data_key     : 32 bytes (present iff key_present == 1)
//!   manifest_len : u32 LE
//!   manifest_json: manifest_len bytes
//!   snapshot     : rest     (the SQLite file bytes)
//! ```

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};
use crate::vault::{VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN, derive_key, open, seal};

/// Identifies a Voyalier backup file and its layout generation.
pub const BACKUP_MAGIC: &[u8; 4] = b"VBK1";
/// The container layout version. Bumped only for a breaking layout change.
pub const BACKUP_FORMAT_VERSION: u16 = 1;

/// Magic + layout version + salt. The sealed body follows.
const HEADER_LEN: usize = BACKUP_MAGIC.len() + 2 + VAULT_SALT_LEN;

/// What a backup says about itself. Sealed with the body, so it cannot be
/// edited without the passphrase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format_version: u16,
    /// The `PRAGMA user_version` the snapshot carries. Restoring a backup from a
    /// newer schema than the running app understands is refused.
    pub schema_version: i64,
    pub app_version: String,
    pub created_at: String,
}

/// A backup recovered with the correct passphrase.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedBackup {
    pub manifest: BackupManifest,
    /// The workspace data key, when the source vault had one. `None` means the
    /// source stored its rows in plaintext (no keychain, e.g. headless/CI).
    pub data_key: Option<[u8; VAULT_KEY_LEN]>,
    /// The SQLite file bytes.
    pub snapshot: Vec<u8>,
}

/// Build a `.vbk` container. The caller supplies a fresh random `salt` and
/// `nonce` — never reuse a pair for a given passphrase.
pub fn seal_backup(
    passphrase: &str,
    manifest: &BackupManifest,
    data_key: Option<&[u8; VAULT_KEY_LEN]>,
    snapshot: &[u8],
    salt: &[u8; VAULT_SALT_LEN],
    nonce: &[u8; VAULT_NONCE_LEN],
) -> Result<Vec<u8>, AppError> {
    let manifest_json = serde_json::to_vec(manifest).map_err(|_| {
        AppError::new(
            ErrorCode::InternalUnexpected,
            "the backup manifest could not be written",
        )
    })?;
    let manifest_len = u32::try_from(manifest_json.len()).map_err(|_| {
        AppError::new(
            ErrorCode::InternalUnexpected,
            "the backup manifest is too large",
        )
    })?;

    let mut body = Vec::with_capacity(1 + VAULT_KEY_LEN + 4 + manifest_json.len() + snapshot.len());
    match data_key {
        Some(key) => {
            body.push(1);
            body.extend_from_slice(key);
        }
        None => body.push(0),
    }
    body.extend_from_slice(&manifest_len.to_le_bytes());
    body.extend_from_slice(&manifest_json);
    body.extend_from_slice(snapshot);

    let kek = derive_key(passphrase, salt)?;
    let sealed = seal(&kek, nonce, &body)?;

    let mut container = Vec::with_capacity(HEADER_LEN + sealed.len());
    container.extend_from_slice(BACKUP_MAGIC);
    container.extend_from_slice(&BACKUP_FORMAT_VERSION.to_le_bytes());
    container.extend_from_slice(salt);
    container.extend_from_slice(&sealed);
    Ok(container)
}

/// Recover a `.vbk` container. Fails cleanly on a wrong passphrase, a tampered
/// or truncated file, or an unrecognised layout — never panics, never returns
/// partial state.
pub fn open_backup(passphrase: &str, container: &[u8]) -> Result<OpenedBackup, AppError> {
    // Identify the file before doing any expensive key derivation.
    if container.get(..BACKUP_MAGIC.len()) != Some(&BACKUP_MAGIC[..]) {
        return Err(unreadable_backup());
    }
    let version = container
        .get(4..6)
        .and_then(|bytes| <[u8; 2]>::try_from(bytes).ok())
        .map(u16::from_le_bytes)
        .ok_or_else(unreadable_backup)?;
    if version != BACKUP_FORMAT_VERSION {
        return Err(unreadable_backup());
    }
    let salt = container.get(6..HEADER_LEN).ok_or_else(unreadable_backup)?;
    let sealed = container.get(HEADER_LEN..).ok_or_else(unreadable_backup)?;

    let kek = derive_key(passphrase, salt)?;
    // A wrong passphrase and a tampered body are the same failure to the caller.
    let body = open(&kek, sealed).map_err(|_| unreadable_backup())?;

    // Past this point the body is authenticated, so its lengths are trustworthy;
    // they are still read with checked slicing so a malformed one cannot panic.
    let mut cursor = 0usize;
    let key_present = *body.get(cursor).ok_or_else(unreadable_backup)?;
    cursor += 1;
    let data_key = match key_present {
        0 => None,
        1 => {
            let bytes = body
                .get(cursor..cursor + VAULT_KEY_LEN)
                .ok_or_else(unreadable_backup)?;
            cursor += VAULT_KEY_LEN;
            let mut key = [0u8; VAULT_KEY_LEN];
            key.copy_from_slice(bytes);
            Some(key)
        }
        _ => return Err(unreadable_backup()),
    };

    let manifest_len = body
        .get(cursor..cursor + 4)
        .and_then(|bytes| <[u8; 4]>::try_from(bytes).ok())
        .map(u32::from_le_bytes)
        .ok_or_else(unreadable_backup)? as usize;
    cursor += 4;
    let manifest_end = cursor
        .checked_add(manifest_len)
        .ok_or_else(unreadable_backup)?;
    let manifest_json = body
        .get(cursor..manifest_end)
        .ok_or_else(unreadable_backup)?;
    let manifest: BackupManifest =
        serde_json::from_slice(manifest_json).map_err(|_| unreadable_backup())?;
    // The sealed manifest is the authority; a header edited to a version the
    // body disagrees with is not a backup we understand.
    if manifest.format_version != version {
        return Err(unreadable_backup());
    }

    let snapshot = body
        .get(manifest_end..)
        .ok_or_else(unreadable_backup)?
        .to_vec();

    Ok(OpenedBackup {
        manifest,
        data_key,
        snapshot,
    })
}

/// The one error shape for an unreadable container, so a caller cannot
/// distinguish "wrong passphrase" from "tampered" and probe the file.
fn unreadable_backup() -> AppError {
    AppError::new(
        ErrorCode::ValidationInvalidInput,
        "this file is not a readable Voyalier backup (wrong passphrase, or the file is damaged)",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> BackupManifest {
        BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            schema_version: 9,
            app_version: "0.4.0".to_owned(),
            created_at: "2026-07-18T10:00:00Z".to_owned(),
        }
    }

    fn salt() -> [u8; VAULT_SALT_LEN] {
        [5u8; VAULT_SALT_LEN]
    }

    fn nonce() -> [u8; VAULT_NONCE_LEN] {
        [3u8; VAULT_NONCE_LEN]
    }

    fn data_key() -> [u8; VAULT_KEY_LEN] {
        [42u8; VAULT_KEY_LEN]
    }

    /// A snapshot stands in for the SQLite file; the container is bytes-agnostic.
    const SNAPSHOT: &[u8] = b"SQLite format 3\0...trip rows...";

    #[test]
    fn round_trips_a_backup_carrying_the_data_key() {
        let container = seal_backup(
            "correct horse battery staple",
            &manifest(),
            Some(&data_key()),
            SNAPSHOT,
            &salt(),
            &nonce(),
        )
        .expect("seal");

        // The header identifies the file before any passphrase work happens.
        assert_eq!(&container[..4], BACKUP_MAGIC);
        // The snapshot must not be readable in the file.
        assert!(
            container
                .windows(SNAPSHOT.len())
                .all(|window| window != SNAPSHOT),
            "the snapshot leaked into the container in the clear"
        );

        let opened = open_backup("correct horse battery staple", &container).expect("open");
        assert_eq!(opened.manifest, manifest());
        assert_eq!(opened.data_key, Some(data_key()));
        assert_eq!(opened.snapshot, SNAPSHOT);
    }

    #[test]
    fn round_trips_a_backup_from_a_vault_with_no_data_key() {
        let container = seal_backup(
            "open sesame",
            &manifest(),
            None,
            SNAPSHOT,
            &salt(),
            &nonce(),
        )
        .expect("seal");

        let opened = open_backup("open sesame", &container).expect("open");
        assert_eq!(opened.data_key, None);
        assert_eq!(opened.snapshot, SNAPSHOT);
    }

    #[test]
    fn a_wrong_passphrase_cannot_open_the_backup() {
        let container = seal_backup(
            "the real one",
            &manifest(),
            Some(&data_key()),
            SNAPSHOT,
            &salt(),
            &nonce(),
        )
        .expect("seal");

        assert_eq!(
            open_backup("not it", &container)
                .expect_err("wrong passphrase")
                .code,
            ErrorCode::ValidationInvalidInput
        );
    }

    #[test]
    fn a_tampered_body_is_rejected() {
        let mut container = seal_backup(
            "passphrase",
            &manifest(),
            Some(&data_key()),
            SNAPSHOT,
            &salt(),
            &nonce(),
        )
        .expect("seal");

        let last = container.len() - 1;
        container[last] ^= 0x01;
        assert!(open_backup("passphrase", &container).is_err());
    }

    #[test]
    fn a_file_that_is_not_a_backup_is_rejected() {
        // Rejected on the magic, before any expensive key derivation.
        assert!(open_backup("passphrase", b"not a backup file at all").is_err());
        // Truncated inputs must error, never panic on a slice index.
        assert!(open_backup("passphrase", b"").is_err());
        assert!(open_backup("passphrase", BACKUP_MAGIC).is_err());
        assert!(open_backup("passphrase", b"VBK1\x01\x00\x05\x05").is_err());
    }

    #[test]
    fn refuses_a_container_from_an_unknown_layout_version() {
        let mut container = seal_backup(
            "passphrase",
            &manifest(),
            Some(&data_key()),
            SNAPSHOT,
            &salt(),
            &nonce(),
        )
        .expect("seal");

        // Bump the header's layout version to one this build does not know.
        container[4] = 0xff;
        container[5] = 0xff;
        assert!(open_backup("passphrase", &container).is_err());
    }
}
