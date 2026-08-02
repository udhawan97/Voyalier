//! `AppService` — the vault's own surface: status, passphrase, unlock.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// The vault's encryption state for the UI. Never returns key material.
    pub fn get_vault_status(&self) -> Result<VaultStatus, AppError> {
        Ok(self.vault.status())
    }

    /// Turn on the optional passphrase: wrap the active data key under an
    /// Argon2-derived key, persist the wrap, and remove the raw key from the
    /// keychain — so subsequent app opens require the passphrase. Requires an
    /// active, unprotected vault. The vault stays unlocked for this session.
    pub fn set_vault_passphrase(&self, passphrase: &str) -> Result<VaultStatus, AppError> {
        validate_passphrase(passphrase)?;
        let state = self.vault.snapshot();
        if state.protected {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "a passphrase is already set; remove it before choosing a new one",
            ));
        }
        let Some(data_key) = state.key else {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "encryption is not active on this device, so there is no key to protect",
            ));
        };
        let mut salt = [0u8; VAULT_SALT_LEN];
        getrandom::fill(&mut salt).map_err(|_| nonce_error())?;
        let kek = vault_derive_key(passphrase, &salt)?;
        let mut nonce = [0u8; VAULT_NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|_| nonce_error())?;
        let wrapped = vault_seal(&kek, &nonce, &data_key)?;
        self.connection()?
            .execute(
                "INSERT OR REPLACE INTO vault_meta (id, salt, wrapped_key, updated_at)
                 VALUES (1, ?1, ?2, ?3)",
                params![BASE64.encode(salt), BASE64.encode(wrapped), now_rfc3339()],
            )
            .map_err(storage_error)?;
        // The passphrase now guards the key; the keychain no longer holds it. If
        // that removal fails, roll back the passphrase record — otherwise the raw
        // key would linger in the keychain and defeat the passphrase, while disk
        // claims the vault is protected.
        if let Err(error) = self.secrets.delete(VAULT_KEY_ACCOUNT) {
            let _ = self
                .connection()?
                .execute("DELETE FROM vault_meta WHERE id = 1", []);
            return Err(error);
        }
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: true,
        });
        Ok(self.vault.status())
    }

    /// Unlock a passphrase-protected vault for this session by unwrapping the
    /// data key. A no-op if already unlocked; an error if no passphrase is set.
    pub fn unlock_vault(&self, passphrase: &str) -> Result<VaultStatus, AppError> {
        if self.vault.snapshot().key.is_some() {
            return Ok(self.vault.status());
        }
        let data_key = self.unwrap_data_key(passphrase)?;
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: true,
        });
        // Now active: seal any plaintext rows that could not be migrated while
        // the vault was opened locked (migration is skipped for a locked vault).
        {
            let connection = self.connection()?;
            migrate_encrypt_sensitive_columns(&connection, &self.vault)?;
        }
        Ok(self.vault.status())
    }

    /// Turn the optional passphrase off after verifying it: restore the raw data
    /// key to the keychain and drop the wrap, returning to transparent unlock.
    pub fn remove_vault_passphrase(&self, passphrase: &str) -> Result<VaultStatus, AppError> {
        let data_key = self.unwrap_data_key(passphrase)?;
        self.secrets
            .set(VAULT_KEY_ACCOUNT, &BASE64.encode(data_key))?;
        self.connection()?
            .execute("DELETE FROM vault_meta WHERE id = 1", [])
            .map_err(storage_error)?;
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: false,
        });
        Ok(self.vault.status())
    }

    /// Recover the data key from the passphrase-wrapped record, verifying the
    /// passphrase in the process. Errors if no passphrase is set or it is wrong.
    fn unwrap_data_key(&self, passphrase: &str) -> Result<[u8; VAULT_KEY_LEN], AppError> {
        let connection = self.connection()?;
        let wrap = read_vault_wrap(&connection)?.ok_or_else(|| {
            AppError::new(
                ErrorCode::ValidationInvalidInput,
                "no passphrase is set on this vault",
            )
        })?;
        let kek = vault_derive_key(passphrase, &wrap.salt)?;
        let opened = vault_open(&kek, &wrap.wrapped_key).map_err(|_| wrong_passphrase_error())?;
        <[u8; VAULT_KEY_LEN]>::try_from(opened.as_slice()).map_err(|_| {
            AppError::new(
                ErrorCode::StorageFailure,
                "the stored key was the wrong size",
            )
        })
    }
}
