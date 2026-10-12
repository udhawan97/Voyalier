//! `AppService` — backup, export, and the staged restore.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// Read and authenticate a selected backup without writing a candidate,
    /// keychain entry, or pending marker. The desktop bridge uses this for the
    /// inspect step; the encrypted bytes remain in its process-local session
    /// until the traveler explicitly confirms or cancels.
    pub fn inspect_restore(
        &self,
        passphrase: &str,
        container: &[u8],
    ) -> Result<RestorePreview, AppError> {
        validate_passphrase(passphrase)?;
        let opened = open_backup(passphrase, container)?;
        if opened.manifest.schema_version > target_schema_version() {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "this backup was made by a newer version of Voyalier — update the app, then restore",
            ));
        }
        Ok(RestorePreview {
            created_at: opened.manifest.created_at,
            app_version: opened.manifest.app_version,
            schema_version: opened.manifest.schema_version,
        })
    }

    /// Snapshot the SQLite database to `<data-dir>/backups/` before a risky
    /// operation (a pre-update safety net). SQLite VACUUM INTO owns a consistent
    /// read view even while sibling connections write; the published copy does
    /// not depend on `-wal`/`-shm` files. Keeps the most recent `MAX_BACKUPS`,
    /// refusing rotation that would discard unavailable recovery evidence.
    ///
    /// Privacy note: backups preserve rows even after a trip is deleted, so the
    /// backups directory is part of "where data lives" and is excluded from any
    /// export/share (documented in privacy.mdx).
    pub fn backup_database(&self, label: &str) -> Result<BackupInfo, AppError> {
        let _operation = self._workspace_lock.operation()?;
        require_direct_restore_path(&self.database_path)?;
        backup_recovery::resume(
            &self.database_path,
            &*self.connection()?,
            self.secrets.as_ref(),
        )?;
        let label = validate_backup_label(label)?;
        let backups_dir = self
            .database_path
            .parent()
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::StorageFailure,
                    "database has no parent directory for backups",
                )
            })?
            .join("backups");
        fs::create_dir_all(&backups_dir).map_err(storage_error)?;

        let created_at = now_rfc3339();
        let stamp = filesystem_stamp(&created_at);
        // The clock can resolve coarser than back-to-back backups take, so two
        // in the same tick would share a name; disambiguate with a counter so
        // every snapshot is a distinct file (and none is silently overwritten).
        let mut dest = backups_dir.join(format!("pre-update-{label}-{stamp}.sqlite3"));
        let mut collision = 1;
        while dest.exists() {
            dest = backups_dir.join(format!("pre-update-{label}-{stamp}-{collision}.sqlite3"));
            collision += 1;
        }

        {
            let connection = self.connection()?;
            backup_recovery::adopt(
                &self.database_path,
                self.secrets.as_ref(),
                self.vault.active_data_key(),
                read_vault_wrap(&connection)?.as_ref(),
            )?;
            consistent_sqlite_snapshot(&connection, &dest)?;
        }
        backup_recovery::retain_known(
            &self.database_path,
            &dest,
            self.secrets.as_ref(),
            self.vault.active_data_key(),
        )?;
        backup_recovery::prune(&self.database_path, self.secrets.as_ref(), MAX_BACKUPS)?;

        Ok(BackupInfo {
            path: dest.to_string_lossy().into_owned(),
            label,
            created_at,
        })
    }

    /// Export the whole workspace as a portable, passphrase-encrypted `.vbk`
    /// container the user can restore on any machine.
    ///
    /// The sealed rows are encrypted under a data key that lives in the OS
    /// keychain, so the container carries that key re-wrapped under the
    /// passphrase — without it the snapshot would be undecryptable elsewhere.
    /// Returns the bytes; writing them to a chosen path is the caller's job.
    pub fn export_backup(&self, passphrase: &str) -> Result<Vec<u8>, AppError> {
        let _operation = self._workspace_lock.operation()?;
        backup_recovery::resume(
            &self.database_path,
            &*self.connection()?,
            self.secrets.as_ref(),
        )?;
        validate_passphrase(passphrase)?;
        // A locked vault holds its key wrapped and unreachable, so the backup
        // could not carry one and every sealed row would restore as garbage.
        // Refuse rather than write a backup that silently loses the data.
        if self.vault.status().locked {
            return Err(vault_locked_error());
        }
        let data_key = self.vault.active_data_key();

        // A consistent point-in-time snapshot of just the main `.sqlite3`: the
        // write lock is held across the TRUNCATE checkpoint and the read, so no
        // `-wal`/`-shm` strays are needed (same technique as `backup_database`).
        let snapshot = {
            let connection = self.connection()?;
            let path = self
                .database_path
                .with_file_name(format!(".export-snapshot-{}.tmp", new_id("copy")));
            let result = (|| {
                consistent_sqlite_snapshot(&connection, &path)?;
                let metadata = fs::metadata(&path).map_err(storage_error)?;
                if metadata.len() > voyalier_core::MAX_BACKUP_CONTAINER_BYTES as u64 {
                    return Err(AppError::new(
                        ErrorCode::StorageFailure,
                        "the workspace exceeds the portable backup size bound",
                    ));
                }
                fs::read(&path).map_err(storage_error)
            })();
            let _ = fs::remove_file(path);
            result?
        };

        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            schema_version: target_schema_version(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            created_at: now_rfc3339(),
        };

        let mut salt = [0u8; VAULT_SALT_LEN];
        getrandom::fill(&mut salt).map_err(|_| nonce_error())?;
        let mut nonce = [0u8; VAULT_NONCE_LEN];
        getrandom::fill(&mut nonce).map_err(|_| nonce_error())?;

        seal_backup(
            passphrase,
            &manifest,
            data_key.as_ref(),
            &snapshot,
            &salt,
            &nonce,
        )
    }

    /// Validate a `.vbk` container and stage it to be restored at the next
    /// launch. Nothing in the live workspace is touched here: the decrypted
    /// snapshot and the carried key are parked, and the swap happens in
    /// [`apply_pending_restore`] before the database is opened. A crash between
    /// the two loses nothing.
    pub fn stage_restore(
        &self,
        passphrase: &str,
        container: &[u8],
    ) -> Result<RestorePreview, AppError> {
        let _operation = self._workspace_lock.operation()?;
        require_direct_restore_path(&self.database_path)?;
        backup_recovery::resume(
            &self.database_path,
            &*self.connection()?,
            self.secrets.as_ref(),
        )?;
        let dir = self
            .database_path
            .parent()
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::StorageFailure,
                    "database has no parent directory for a staged restore",
                )
            })?
            .to_path_buf();
        let marker_path = dir.join(PENDING_RESTORE_MARKER);
        if marker_path.exists() {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "a restore is already waiting; finish or cancel it before choosing another",
            ));
        }
        // Decrypting is what proves the passphrase; a wrong one stops here,
        // before anything is written.
        let opened = open_backup(passphrase, container)?;
        if opened.manifest.schema_version > target_schema_version() {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "this backup was made by a newer version of Voyalier — update the app, then restore",
            ));
        }
        stage_restore_source(
            &self.database_path,
            self.secrets.as_ref(),
            RestoreSource::Bytes(&opened.snapshot),
            &opened.manifest,
            opened.data_key,
        )
    }

    /// Whether a staged restore is waiting for the next launch, so the UI can
    /// prompt for the restart that finishes it.
    pub fn has_pending_restore(&self) -> bool {
        self.database_path
            .parent()
            .is_some_and(|dir| dir.join(PENDING_RESTORE_MARKER).exists())
    }

    /// Cancel the exact staged generation without touching the live database.
    /// The marker is removed last, so an interruption leaves retryable state;
    /// a restart can finish the same cleanup rather than guessing which files
    /// belong to the restore. Activated recovery generations are deliberately
    /// not cancellable here — they must complete or roll back under the
    /// generation protocol before their safety copy can be discarded.
    pub fn unstage_restore(&self) -> Result<bool, AppError> {
        let _operation = self._workspace_lock.operation()?;
        let Some(dir) = self.database_path.parent() else {
            return Ok(false);
        };
        let marker_path = dir.join(PENDING_RESTORE_MARKER);
        if !marker_path.exists() {
            return Ok(false);
        }
        let marker = read_restore_marker(&marker_path)?;
        validate_restore_marker(&marker)?;
        if !matches!(
            marker.phase,
            RestorePhase::Staged | RestorePhase::Cancelling
        ) {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "this restore is already being recovered and cannot be cancelled",
            ));
        }
        cancel_restore(self.secrets.as_ref(), &self.database_path, &marker)?;
        Ok(true)
    }

    /// Delete every pre-update backup (and any `-wal`/`-shm` strays a reader
    /// left behind), returning the number of `.sqlite3` snapshots removed. The
    /// backups directory itself is left in place. This is the "clear backups"
    /// affordance — backups outlive deleted trips, so the user needs a way to
    /// erase them.
    pub fn clear_backups(&self) -> Result<usize, AppError> {
        let _operation = self._workspace_lock.operation()?;
        require_direct_restore_path(&self.database_path)?;
        let backups_dir = self
            .database_path
            .parent()
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::StorageFailure,
                    "database has no parent directory for backups",
                )
            })?
            .join("backups");
        if !backups_dir.exists() {
            return Ok(0);
        }
        let connection = self.connection()?;
        backup_recovery::adopt(
            &self.database_path,
            self.secrets.as_ref(),
            self.vault.active_data_key(),
            read_vault_wrap(&connection)?.as_ref(),
        )?;
        backup_recovery::prune(&self.database_path, self.secrets.as_ref(), 0)
    }
}
