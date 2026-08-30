//! The stored form of a sealed column, and the only two doors through it.
//!
//! [`SEALED_COLUMNS`](crate::records::SEALED_COLUMNS) says *which* columns the
//! vault encrypts. This module makes forgetting to *open* one a compile error
//! rather than a test failure: a sealed column arrives as [`Sealed`], every
//! domain type it feeds wants a `String`, and [`Vault::open`] is the only way
//! across — so ciphertext can no longer reach the interface.
//!
//! It does not close the other direction. See [`Vault::seal`] and ADR-0007.
//!
//! The enforcement rests on where this module sits, not on discipline. Rust
//! privacy is "the defining module and its descendants", so a `Sealed` declared
//! beside `Vault` in `lib.rs` would still be constructible from `records` —
//! `records` is a descendant of the crate root. Declared here, in a *sibling*
//! of `records`, the field is genuinely out of reach: `records` can hold a
//! `Sealed`, pass it to rusqlite, and hand it back to the vault, and it cannot
//! build one out of a traveler's plaintext or read the ciphertext out of one.
//!
//! `Vault` itself stays in `lib.rs`. Only the two field operations live here,
//! as an inherent impl on it — which Rust allows from any module in the crate —
//! so the type's reach is the smallest thing that still closes the hole.

use base64::Engine;
use rusqlite::{
    ToSql,
    types::{FromSql, FromSqlResult, ToSqlOutput, ValueRef},
};
use voyalier_core::{AppError, ErrorCode, open as vault_open, seal as vault_seal};

use crate::{BASE64, VAULT_NONCE_LEN, VAULT_PREFIX, Vault, nonce_error, vault_locked_error};

/// A sealed column's value exactly as the database holds it: `v1:<base64>` when
/// the vault is active, legacy plaintext when it never was.
///
/// Deliberately not generic. Every sealed column is text, and a type parameter
/// with one instantiation is scaffolding for a second one that does not exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Sealed(String);

impl FromSql for Sealed {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        String::column_result(value).map(Sealed)
    }
}

impl ToSql for Sealed {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        self.0.to_sql()
    }
}

impl Vault {
    /// Seal a plaintext field. Inactive → plaintext passthrough; locked → error.
    ///
    /// This is the only way to make a `Sealed`, but it is **not** what stops a
    /// write from skipping it: `params!` is positional and takes any `ToSql`,
    /// so binding a plaintext `&str` to a sealed column still compiles.
    /// `sealed_columns_round_trip_through_the_vault` is the guard in that
    /// direction, and ADR-0007 records why the type does not reach it.
    pub(crate) fn seal(&self, plaintext: &str) -> Result<Sealed, AppError> {
        let state = self.snapshot();
        let Some(key) = state.key else {
            return if state.protected {
                Err(vault_locked_error())
            } else {
                Ok(Sealed(plaintext.to_owned()))
            };
        };
        let mut nonce = [0u8; VAULT_NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|_| nonce_error())?;
        let sealed = vault_seal(&key, &nonce, plaintext.as_bytes())?;
        Ok(Sealed(format!("{VAULT_PREFIX}{}", BASE64.encode(sealed))))
    }

    /// Open a stored field. Untagged (legacy plaintext) values pass through;
    /// tagged values require the key (locked → error until unlock).
    ///
    /// Taking a `Sealed` is the point: a read path that skips this is holding a
    /// value it cannot render, so returning ciphertext to the interface stops
    /// being something to remember not to do.
    pub(crate) fn open(&self, stored: &Sealed) -> Result<String, AppError> {
        let Some(encoded) = stored.0.strip_prefix(VAULT_PREFIX) else {
            return Ok(stored.0.clone());
        };
        let state = self.snapshot();
        let Some(key) = state.key else {
            return Err(if state.protected {
                vault_locked_error()
            } else {
                AppError::new(
                    ErrorCode::VaultUnreadable,
                    "this data is encrypted but the vault key is unavailable",
                )
            });
        };
        // Every failure below this line is the same situation and carries the
        // same code: the row was read, and its plaintext cannot be recovered.
        // `storage/failure` said the opposite, and the interface believed it
        // (ADR-0018).
        let bytes = BASE64
            .decode(encoded)
            .map_err(|_| AppError::new(ErrorCode::VaultUnreadable, "corrupt encrypted field"))?;
        let opened = vault_open(&key, &bytes)?;
        String::from_utf8(opened).map_err(|_| {
            AppError::new(
                ErrorCode::VaultUnreadable,
                "decrypted data was not valid text",
            )
        })
    }
}
