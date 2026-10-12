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
        let _operation = self._workspace_lock.operation()?;
        require_direct_restore_path(&self.database_path)?;
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
        let wrap = VaultWrap {
            salt: salt.to_vec(),
            wrapped_key: wrapped.clone(),
        };
        backup_recovery::begin_protection(
            &self.database_path,
            self.secrets.as_ref(),
            &data_key,
            &wrap,
        )?;
        self.connection()?
            .execute(
                "INSERT OR REPLACE INTO vault_meta (id, salt, wrapped_key, updated_at)
                 VALUES (1, ?1, ?2, ?3)",
                params![BASE64.encode(salt), BASE64.encode(wrapped), now_rfc3339()],
            )
            .map_err(storage_error)?;
        restore_fault("protection_wrap");
        if let Err(error) = backup_recovery::resume(
            &self.database_path,
            &*self.connection()?,
            self.secrets.as_ref(),
        ) {
            self.vault.set_state(VaultState {
                key: None,
                protected: true,
                escaped_plaintext: state.escaped_plaintext,
            });
            return Err(error);
        }
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: true,
            escaped_plaintext: state.escaped_plaintext,
        });
        Ok(self.vault.status())
    }

    /// Unlock a passphrase-protected vault for this session by unwrapping the
    /// data key. A no-op if already unlocked; an error if no passphrase is set.
    pub fn unlock_vault(&self, passphrase: &str) -> Result<VaultStatus, AppError> {
        let _operation = self._workspace_lock.operation()?;
        backup_recovery::resume(
            &self.database_path,
            &*self.connection()?,
            self.secrets.as_ref(),
        )?;
        if self.vault.snapshot().key.is_some() {
            return Ok(self.vault.status());
        }
        let data_key = self.unwrap_data_key(passphrase)?;
        let escaped_plaintext = self.vault.snapshot().escaped_plaintext;
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: true,
            escaped_plaintext,
        });
        // Now active: seal any plaintext rows that could not be migrated while
        // the vault was opened locked (migration is skipped for a locked vault).
        {
            let connection = self.connection()?;
            if let Err(error) = migrate_encrypt_sensitive_columns(
                &connection,
                &self.vault,
                &self.database_path,
                self.secrets.as_ref(),
            ) {
                self.vault.set_state(VaultState {
                    key: None,
                    protected: true,
                    escaped_plaintext,
                });
                return Err(error);
            }
            backup_recovery::adopt(
                &self.database_path,
                self.secrets.as_ref(),
                Some(data_key),
                read_vault_wrap(&connection)?.as_ref(),
            )?;
        }
        Ok(self.vault.status())
    }

    /// Turn the optional passphrase off after verifying it: restore the raw data
    /// key to the keychain and drop the wrap, returning to transparent unlock.
    pub fn remove_vault_passphrase(&self, passphrase: &str) -> Result<VaultStatus, AppError> {
        let _operation = self._workspace_lock.operation()?;
        require_direct_restore_path(&self.database_path)?;
        backup_recovery::resume(
            &self.database_path,
            &*self.connection()?,
            self.secrets.as_ref(),
        )?;
        let data_key = self.unwrap_data_key(passphrase)?;
        let escaped_plaintext = self.vault.snapshot().escaped_plaintext;
        let previous_key = self.secrets.get(&self.vault_account)?;
        // Direct removal is an activation too. Keep the passphrase wrap and
        // raw-key intent untouched until every fallback cell is safely sealed.
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: true,
            escaped_plaintext,
        });
        let removed = (|| {
            let connection = self.connection()?;
            migrate_encrypt_sensitive_columns(
                &connection,
                &self.vault,
                &self.database_path,
                self.secrets.as_ref(),
            )?;
            backup_recovery::adopt(
                &self.database_path,
                self.secrets.as_ref(),
                Some(data_key),
                read_vault_wrap(&connection)?.as_ref(),
            )?;
            self.secrets
                .set(&self.vault_account, &BASE64.encode(data_key))?;
            if let Err(error) = connection.execute("DELETE FROM vault_meta WHERE id = 1", []) {
                // Keychain and SQLite cannot commit together. Compensate a
                // rejected DELETE; if compensation also fails, report that
                // failure and leave the wrap/evidence for startup cleanup.
                match previous_key.as_deref() {
                    Some(key) => self.secrets.set(&self.vault_account, key)?,
                    None => self.secrets.delete(&self.vault_account)?,
                }
                return Err(storage_error(error));
            }
            Ok(())
        })();
        if let Err(error) = removed {
            self.vault.set_state(VaultState {
                key: None,
                protected: true,
                escaped_plaintext,
            });
            return Err(error);
        }
        self.vault.set_state(VaultState {
            key: Some(data_key),
            protected: false,
            escaped_plaintext,
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
