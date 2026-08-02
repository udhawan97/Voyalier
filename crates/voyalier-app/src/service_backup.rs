//! `AppService` — backup, export, and the staged restore.
//!
//! One of the subsystem modules ADR-0010 split `impl AppService` into. The type,
//! its constructors, and the shared helpers stay in `lib.rs`; Rust allows an
//! inherent impl to be spread across modules of the same crate, so this changes
//! where the code lives and nothing about the interface.

use super::*;

impl AppService {
    /// Snapshot the SQLite database to `<data-dir>/backups/` before a risky
    /// operation (a pre-update safety net). The write lock is held across a
    /// TRUNCATE WAL checkpoint and the file copy, so the copy is a consistent
    /// point-in-time snapshot of just the main `.sqlite3` file — no `-wal`/`-shm`
    /// strays. Keeps only the most recent `MAX_BACKUPS`.
    ///
    /// Privacy note: backups preserve rows even after a trip is deleted, so the
    /// backups directory is part of "where data lives" and is excluded from any
    /// export/share (documented in privacy.mdx).
    pub fn backup_database(&self, label: &str) -> Result<BackupInfo, AppError> {
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
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(storage_error)?;
            fs::copy(&self.database_path, &dest).map_err(storage_error)?;
        }

        prune_backups(&backups_dir, MAX_BACKUPS)?;

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
            connection
                .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .map_err(storage_error)?;
            fs::read(&self.database_path).map_err(storage_error)?
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
        // Decrypting is what proves the passphrase; a wrong one stops here,
        // before anything is written.
        let opened = open_backup(passphrase, container)?;
        if opened.manifest.schema_version > target_schema_version() {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "this backup was made by a newer version of Voyalier — update the app, then restore",
            ));
        }
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

        // Park the key, then the snapshot, then the marker. The marker is the
        // signal to apply, so writing it last means an interrupted stage is
        // inert debris rather than a half-restore.
        match opened.data_key {
            Some(key) => self
                .secrets
                .set(VAULT_PENDING_KEY_ACCOUNT, &BASE64.encode(key))?,
            None => {
                let _ = self.secrets.delete(VAULT_PENDING_KEY_ACCOUNT);
            }
        }
        fs::write(dir.join(PENDING_RESTORE_FILE), &opened.snapshot).map_err(storage_error)?;

        let preview = RestorePreview {
            created_at: opened.manifest.created_at,
            app_version: opened.manifest.app_version,
            schema_version: opened.manifest.schema_version,
        };
        let marker = PendingRestore {
            created_at: preview.created_at.clone(),
            app_version: preview.app_version.clone(),
            schema_version: preview.schema_version,
            key_present: opened.data_key.is_some(),
        };
        let encoded = serde_json::to_vec(&marker).map_err(|_| {
            AppError::new(
                ErrorCode::InternalUnexpected,
                "the pending restore could not be written",
            )
        })?;
        fs::write(dir.join(PENDING_RESTORE_MARKER), encoded).map_err(storage_error)?;

        Ok(preview)
    }

    /// Whether a staged restore is waiting for the next launch, so the UI can
    /// prompt for the restart that finishes it.
    pub fn has_pending_restore(&self) -> bool {
        self.database_path
            .parent()
            .is_some_and(|dir| dir.join(PENDING_RESTORE_MARKER).exists())
    }

    /// Delete every pre-update backup (and any `-wal`/`-shm` strays a reader
    /// left behind), returning the number of `.sqlite3` snapshots removed. The
    /// backups directory itself is left in place. This is the "clear backups"
    /// affordance — backups outlive deleted trips, so the user needs a way to
    /// erase them.
    pub fn clear_backups(&self) -> Result<usize, AppError> {
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
        let mut removed = 0;
        for entry in fs::read_dir(&backups_dir).map_err(storage_error)? {
            let entry = entry.map_err(storage_error)?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if has_backup_snapshot_prefix(&name)
                && fs::remove_file(entry.path()).is_ok()
                && name.ends_with(".sqlite3")
            {
                removed += 1;
            }
        }
        Ok(removed)
    }
}
