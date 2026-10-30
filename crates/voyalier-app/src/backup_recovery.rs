//! Bounded local recovery metadata and SecretStore custody (ADR-0026).
use super::*;

const INDEX_FILE: &str = "backup-recovery.json";
const INDEX_BYTES: u64 = 64 * 1024;
const INDEX_ENTRIES: usize = 32;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Index {
    version: u16,
    workspace_account: String,
    snapshots: Vec<Snapshot>,
    credentials: Vec<Credential>,
    protection_transition: Option<ProtectionTransition>,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    file: String,
    sha256: String,
    deleting: bool,
    credential: SnapshotCredential,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum SnapshotCredential {
    Keyless,
    EmbeddedWrap,
    Retained { account: String },
    Unavailable,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Credential {
    account: String,
    key_sha256: String,
    wrap_sha256: Option<String>,
    deleting: bool,
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProtectionTransition {
    key_sha256: String,
    wrap_sha256: String,
}

/// This value is serialized ONLY into SecretStore, never the index or reports.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WrappedCredential {
    salt: String,
    wrapped_key: String,
}

fn failure(message: &str) -> AppError {
    AppError::new(ErrorCode::StorageFailure, message)
}

fn directory(database: &Path) -> Result<&Path, AppError> {
    database
        .parent()
        .ok_or_else(|| failure("workspace has no recovery directory"))
}

fn index_path(database: &Path) -> Result<PathBuf, AppError> {
    Ok(directory(database)?.join(INDEX_FILE))
}

fn digest_valid(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn name_valid(name: &str) -> bool {
    name.len() <= 255
        && is_backup_snapshot(name)
        && Path::new(name).components().count() == 1
        && !name.contains(['/', '\\'])
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
}

fn account(database: &Path, key: &str, wrap: Option<&str>) -> String {
    let live = vault_key_account(database);
    let suffix = live.strip_prefix(VAULT_KEY_ACCOUNT).unwrap_or_default();
    match wrap {
        None => format!("vault.snapshot_data_key{suffix}.raw.{key}"),
        Some(wrap) => format!("vault.snapshot_data_key{suffix}.wrapped.{key}.{wrap}"),
    }
}

fn empty(database: &Path) -> Index {
    Index {
        version: 1,
        workspace_account: vault_key_account(database),
        snapshots: Vec::new(),
        credentials: Vec::new(),
        protection_transition: None,
    }
}

fn validate(index: &Index, database: &Path) -> Result<(), AppError> {
    if index.version != 1
        || index.workspace_account != vault_key_account(database)
        || index.snapshots.len() + index.credentials.len() > INDEX_ENTRIES
    {
        return Err(failure(
            "the local recovery index is invalid; evidence was preserved",
        ));
    }
    let mut names = std::collections::HashSet::new();
    for snapshot in &index.snapshots {
        if !name_valid(&snapshot.file)
            || !digest_valid(&snapshot.sha256)
            || !names.insert(&snapshot.file)
        {
            return Err(failure("the local recovery snapshot binding is invalid"));
        }
        if let SnapshotCredential::Retained { account } = &snapshot.credential {
            if !index
                .credentials
                .iter()
                .any(|c| &c.account == account && !c.deleting)
            {
                return Err(failure("a local recovery credential reference is invalid"));
            }
        }
    }
    let mut accounts = std::collections::HashSet::new();
    for credential in &index.credentials {
        if !digest_valid(&credential.key_sha256)
            || credential
                .wrap_sha256
                .as_deref()
                .is_some_and(|d| !digest_valid(d))
            || credential.account
                != account(
                    database,
                    &credential.key_sha256,
                    credential.wrap_sha256.as_deref(),
                )
            || !accounts.insert(&credential.account)
        {
            return Err(failure("the local recovery account binding is invalid"));
        }
    }
    if index
        .protection_transition
        .as_ref()
        .is_some_and(|t| !digest_valid(&t.key_sha256) || !digest_valid(&t.wrap_sha256))
    {
        return Err(failure("the local protection transition is invalid"));
    }
    Ok(())
}

fn regular_size(path: &Path, limit: u64) -> Result<u64, AppError> {
    let metadata = fs::symlink_metadata(path).map_err(storage_error)?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(failure("the recovery file is not a bounded regular file"));
    }
    Ok(metadata.len())
}

fn read_index(database: &Path) -> Result<Index, AppError> {
    let path = index_path(database)?;
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(empty(database)),
        Err(error) => return Err(storage_error(error)),
        Ok(_) => {}
    }
    regular_size(&path, INDEX_BYTES)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(storage_error)?
        .take(INDEX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(storage_error)?;
    if bytes.len() as u64 > INDEX_BYTES {
        return Err(failure("the recovery index exceeded its bound"));
    }
    let index: Index = serde_json::from_slice(&bytes)
        .map_err(|_| failure("the local recovery index is corrupt; evidence was preserved"))?;
    validate(&index, database)?;
    Ok(index)
}

fn save_index(database: &Path, index: &Index) -> Result<(), AppError> {
    validate(index, database)?;
    let bytes = serde_json::to_vec(index)
        .map_err(|_| failure("the local recovery index could not be encoded"))?;
    if bytes.len() as u64 > INDEX_BYTES {
        return Err(failure("the local recovery index exceeded its bound"));
    }
    atomic_write_file(&index_path(database)?, &bytes)
}

fn snapshots(database: &Path) -> Result<Vec<PathBuf>, AppError> {
    let backups = directory(database)?.join("backups");
    let metadata = match fs::symlink_metadata(&backups) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(storage_error(error)),
        Ok(metadata) => metadata,
    };
    if !metadata.file_type().is_dir() {
        return Err(failure("the recovery directory is not a direct directory"));
    }
    let mut paths = Vec::new();
    for entry in fs::read_dir(backups).map_err(storage_error)? {
        let entry = entry.map_err(storage_error)?;
        if entry.file_name().to_str().is_some_and(name_valid) {
            regular_size(
                &entry.path(),
                voyalier_core::MAX_BACKUP_CONTAINER_BYTES as u64,
            )?;
            paths.push(entry.path());
            if paths.len() > INDEX_ENTRIES / 2 {
                return Err(failure(
                    "too many local recovery copies; no evidence was removed",
                ));
            }
        }
    }
    Ok(paths)
}

fn readonly(path: &Path) -> Result<Connection, AppError> {
    regular_size(path, voyalier_core::MAX_BACKUP_CONTAINER_BYTES as u64)?;
    validate_sqlite_header(path)?;
    let mut uri = url::Url::from_file_path(path.canonicalize().map_err(storage_error)?)
        .map_err(|_| failure("the snapshot path could not be represented"))?;
    uri.query_pairs_mut().append_pair("immutable", "1");
    let connection = Connection::open_with_flags(
        uri.as_str(),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(storage_error)?;
    validate_sqlite_integrity(&connection)?;
    Ok(connection)
}

fn snapshot_wrap(connection: &Connection) -> Result<Option<VaultWrap>, AppError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'vault_meta')",
            [],
            |r| r.get(0),
        )
        .map_err(storage_error)?;
    if exists {
        read_vault_wrap(connection)
    } else {
        Ok(None)
    }
}

fn wrap_digest(wrap: &VaultWrap) -> String {
    let mut bytes = wrap.salt.clone();
    bytes.extend_from_slice(&wrap.wrapped_key);
    sha256_hex(&bytes)
}

fn encode_wrap(wrap: &VaultWrap) -> Result<String, AppError> {
    serde_json::to_string(&WrappedCredential {
        salt: BASE64.encode(&wrap.salt),
        wrapped_key: BASE64.encode(&wrap.wrapped_key),
    })
    .map_err(|_| failure("the recovery credential could not be encoded"))
}

fn decode_wrap(value: &str) -> Result<VaultWrap, AppError> {
    let value: WrappedCredential =
        serde_json::from_str(value).map_err(|_| failure("the recovery credential is corrupt"))?;
    let salt = BASE64
        .decode(value.salt)
        .map_err(|_| failure("the recovery salt is corrupt"))?;
    let wrapped_key = BASE64
        .decode(value.wrapped_key)
        .map_err(|_| failure("the recovery wrap is corrupt"))?;
    if salt.len() != VAULT_SALT_LEN || wrapped_key.len() != VAULT_NONCE_LEN + VAULT_KEY_LEN + 16 {
        return Err(failure("the recovery wrap has invalid dimensions"));
    }
    Ok(VaultWrap { salt, wrapped_key })
}

fn unwrap(wrap: &VaultWrap, passphrase: &str) -> Result<[u8; VAULT_KEY_LEN], AppError> {
    let kek = vault_derive_key(passphrase, &wrap.salt)?;
    let bytes = vault_open(&kek, &wrap.wrapped_key).map_err(|_| wrong_passphrase_error())?;
    bytes
        .try_into()
        .map_err(|_| failure("the recovery data key has invalid dimensions"))
}

fn authenticate(connection: &Connection, key: Option<[u8; VAULT_KEY_LEN]>) -> Result<(), AppError> {
    let current = connection
        .query_row(
            "SELECT format_version FROM vault_storage_format WHERE id = 1",
            [],
            |r| r.get::<_, i64>(0),
        )
        .optional();
    let current = match current {
        Ok(value) => value.is_some_and(|v| v >= 1),
        Err(_) => false,
    };
    let vault = Vault::new(VaultState {
        key,
        protected: false,
        escaped_plaintext: current,
    });
    // Older snapshots may precede some declared columns; staging still runs
    // every append-only migration and then validates the full current schema.
    for (table, column) in SEALED_COLUMNS {
        let mut schema = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(storage_error)?;
        let columns = schema
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(storage_error)?;
        if !collect_rows(columns)?.iter().any(|c| c == column) {
            continue;
        }
        let mut statement = connection
            .prepare(&format!("SELECT {column} FROM {table}"))
            .map_err(storage_error)?;
        for value in collect_rows(
            statement
                .query_map([], |r| r.get::<_, Option<String>>(0))
                .map_err(storage_error)?,
        )?
        .into_iter()
        .flatten()
        {
            vault.validate_stored(value)?;
        }
    }
    Ok(())
}

fn retain_credential(
    index: &mut Index,
    database: &Path,
    secrets: &dyn SecretStore,
    key: &[u8; VAULT_KEY_LEN],
    wrap: Option<&VaultWrap>,
) -> Result<String, AppError> {
    let key_sha256 = sha256_hex(key);
    let wrap_sha256 = wrap.map(wrap_digest);
    let account = account(database, &key_sha256, wrap_sha256.as_deref());
    let value = match wrap {
        Some(wrap) => encode_wrap(wrap)?,
        None => BASE64.encode(key),
    };
    if let Some(existing) = secrets.get(&account)? {
        if existing != value {
            return Err(failure("the retained recovery credential changed"));
        }
    } else {
        // Record custody before setting a key so interruption never loses the
        // only bounded enumeration of an orphaned recovery account.
        if !index.credentials.iter().any(|c| c.account == account) {
            index.credentials.push(Credential {
                account: account.clone(),
                key_sha256,
                wrap_sha256,
                deleting: false,
            });
            save_index(database, index)?;
        }
        secrets.set(&account, &value)?;
        restore_fault("snapshot_key_set");
    }
    if let Some(credential) = index.credentials.iter_mut().find(|c| c.account == account) {
        credential.deleting = false;
    }
    if !index.credentials.iter().any(|c| c.account == account) {
        index.credentials.push(Credential {
            account: account.clone(),
            key_sha256: sha256_hex(key),
            wrap_sha256: wrap.map(wrap_digest),
            deleting: false,
        });
    }
    Ok(account)
}

pub(super) fn adopt(
    database: &Path,
    secrets: &dyn SecretStore,
    key: Option<[u8; VAULT_KEY_LEN]>,
    live_wrap: Option<&VaultWrap>,
) -> Result<(), AppError> {
    let mut index = read_index(database)?;
    let before = index.clone();
    for path in snapshots(database)? {
        let file = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| failure("invalid snapshot name"))?
            .to_owned();
        let digest = sha256_file(&path)?;
        if let Some(existing) = index.snapshots.iter().find(|s| s.file == file) {
            if existing.sha256 != digest {
                return Err(failure(
                    "a retained snapshot changed; evidence was preserved",
                ));
            }
            if existing.deleting || !matches!(existing.credential, SnapshotCredential::Unavailable)
            {
                continue;
            }
        }
        let credential = match readonly(&path) {
            Ok(connection) => {
                if snapshot_wrap(&connection)?.is_some() {
                    SnapshotCredential::EmbeddedWrap
                } else if authenticate(&connection, None).is_ok() {
                    SnapshotCredential::Keyless
                } else if let Some(key) = key {
                    if authenticate(&connection, Some(key)).is_ok() {
                        SnapshotCredential::Retained {
                            account: retain_credential(
                                &mut index, database, secrets, &key, live_wrap,
                            )?,
                        }
                    } else {
                        SnapshotCredential::Unavailable
                    }
                } else {
                    SnapshotCredential::Unavailable
                }
            }
            Err(_) => SnapshotCredential::Unavailable,
        };
        index.snapshots.retain(|s| s.file != file);
        index.snapshots.push(Snapshot {
            file,
            sha256: digest,
            deleting: false,
            credential,
        });
    }
    if index != before {
        save_index(database, &index)?;
    }
    Ok(())
}

pub(super) fn retain_known(
    database: &Path,
    path: &Path,
    secrets: &dyn SecretStore,
    key: Option<[u8; VAULT_KEY_LEN]>,
) -> Result<(), AppError> {
    let mut index = read_index(database)?;
    let connection = readonly(path)?;
    let file = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| name_valid(n))
        .ok_or_else(|| failure("invalid owned snapshot name"))?
        .to_owned();
    let credential = if snapshot_wrap(&connection)?.is_some() {
        SnapshotCredential::EmbeddedWrap
    } else if let Some(key) = key {
        SnapshotCredential::Retained {
            account: retain_credential(&mut index, database, secrets, &key, None)?,
        }
    } else if authenticate(&connection, None).is_ok() {
        SnapshotCredential::Keyless
    } else {
        SnapshotCredential::Unavailable
    };
    index.snapshots.retain(|s| s.file != file);
    index.snapshots.push(Snapshot {
        file,
        sha256: sha256_file(path)?,
        deleting: false,
        credential,
    });
    save_index(database, &index)?;
    restore_fault("snapshot_binding");
    Ok(())
}

fn cleanup(database: &Path, secrets: &dyn SecretStore, index: &mut Index) -> Result<(), AppError> {
    let backups = directory(database)?.join("backups");
    for snapshot in index.snapshots.iter().filter(|s| s.deleting) {
        let path = backups.join(&snapshot.file);
        if path.try_exists().map_err(storage_error)? {
            regular_size(&path, voyalier_core::MAX_BACKUP_CONTAINER_BYTES as u64)?;
            if sha256_file(&path)? != snapshot.sha256 {
                return Err(failure(
                    "a deleting snapshot changed; its credential was preserved",
                ));
            }
            fs::remove_file(&path).map_err(storage_error)?;
            remove_sqlite_sidecars(&path);
            sync_directory(&backups)?;
            restore_fault("snapshot_unlink");
        }
    }
    index.snapshots.retain(|s| !s.deleting);
    for credential in &mut index.credentials {
        credential.deleting = !index.snapshots.iter().any(|s| matches!(&s.credential, SnapshotCredential::Retained { account } if account == &credential.account));
    }
    save_index(database, index)?;
    for credential in index.credentials.iter().filter(|c| c.deleting) {
        secrets.delete(&credential.account)?;
        restore_fault("snapshot_key_delete");
    }
    index.credentials.retain(|c| !c.deleting);
    save_index(database, index)
}

pub(super) fn prune(
    database: &Path,
    secrets: &dyn SecretStore,
    keep: usize,
) -> Result<usize, AppError> {
    let mut index = read_index(database)?;
    let mut ordering = Vec::new();
    let backups = directory(database)?.join("backups");
    for snapshot in &index.snapshots {
        let modified = fs::metadata(backups.join(&snapshot.file)).and_then(|m| m.modified());
        if let Ok(modified) = modified {
            ordering.push((std::cmp::Reverse(modified), snapshot.file.clone()));
        } else if !snapshot.deleting && keep != 0 {
            return Err(failure(
                "a retained snapshot is missing; no credential was removed",
            ));
        }
    }
    ordering.sort();
    let retained: std::collections::HashSet<_> = ordering
        .into_iter()
        .take(keep)
        .map(|(_, file)| file)
        .collect();
    if keep != 0
        && index.snapshots.iter().any(|s| {
            !retained.contains(&s.file) && matches!(s.credential, SnapshotCredential::Unavailable)
        })
    {
        return Err(failure(
            "automatic pruning refused unavailable recovery evidence; inspect it or explicitly Clear backups",
        ));
    }
    let mut count = 0;
    for snapshot in &mut index.snapshots {
        if !retained.contains(&snapshot.file) {
            snapshot.deleting = true;
            count += 1;
        }
    }
    save_index(database, &index)?;
    restore_fault("snapshot_delete_intent");
    cleanup(database, secrets, &mut index)?;
    Ok(count)
}

pub(super) fn begin_protection(
    database: &Path,
    secrets: &dyn SecretStore,
    key: &[u8; VAULT_KEY_LEN],
    wrap: &VaultWrap,
) -> Result<(), AppError> {
    if directory(database)?
        .join(PENDING_RESTORE_MARKER)
        .try_exists()
        .map_err(storage_error)?
    {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "finish or cancel the pending restore before protecting this vault",
        ));
    }
    adopt(database, secrets, Some(*key), None)?;
    let mut index = read_index(database)?;
    index.protection_transition = Some(ProtectionTransition {
        key_sha256: sha256_hex(key),
        wrap_sha256: wrap_digest(wrap),
    });
    save_index(database, &index)?;
    restore_fault("protection_intent");
    Ok(())
}

pub(super) fn resume(
    database: &Path,
    connection: &Connection,
    secrets: &dyn SecretStore,
) -> Result<(), AppError> {
    let mut index = read_index(database)?;
    if let Some(transition) = index.protection_transition.clone() {
        match read_vault_wrap(connection)? {
            None => {
                index.protection_transition = None;
                save_index(database, &index)?;
            }
            Some(wrap) => {
                if wrap_digest(&wrap) != transition.wrap_sha256 {
                    return Err(failure("the interrupted protection wrap changed"));
                }
                let matching: Vec<_> = index
                    .credentials
                    .iter()
                    .filter(|c| c.key_sha256 == transition.key_sha256 && c.wrap_sha256.is_none())
                    .cloned()
                    .collect();
                for raw in matching {
                    if raw.deleting && !index.snapshots.iter().any(|s| matches!(&s.credential, SnapshotCredential::Retained { account } if account == &raw.account)) {
                        secrets.delete(&raw.account)?;
                        index.credentials.retain(|c| c.account != raw.account);
                        save_index(database, &index)?;
                        continue;
                    }
                    let raw_value = secrets.get(&raw.account)?.ok_or_else(|| {
                        failure("the interrupted raw recovery credential is unavailable")
                    })?;
                    let key = decode_key(&raw_value)
                        .ok_or_else(|| failure("the raw recovery credential is corrupt"))?;
                    if sha256_hex(&key) != transition.key_sha256 {
                        return Err(failure("the recovery credential changed during protection"));
                    }
                    let wrapped_account =
                        retain_credential(&mut index, database, secrets, &key, Some(&wrap))?;
                    for snapshot in &mut index.snapshots {
                        if matches!(&snapshot.credential, SnapshotCredential::Retained { account } if account == &raw.account)
                        {
                            snapshot.credential = SnapshotCredential::Retained {
                                account: wrapped_account.clone(),
                            };
                        }
                    }
                    if let Some(c) = index
                        .credentials
                        .iter_mut()
                        .find(|c| c.account == raw.account)
                    {
                        c.deleting = true;
                    }
                    save_index(database, &index)?;
                    restore_fault("protection_references");
                    secrets.delete(&raw.account)?;
                    index.credentials.retain(|c| c.account != raw.account);
                    save_index(database, &index)?;
                    restore_fault("protection_shadow_delete");
                }
                if let Some(raw) = secrets.get(&vault_key_account(database))? {
                    let key = decode_key(&raw)
                        .ok_or_else(|| failure("the live protection credential is corrupt"))?;
                    if sha256_hex(&key) != transition.key_sha256 {
                        return Err(failure("the live key changed during protection"));
                    }
                    secrets.delete(&vault_key_account(database))?;
                }
                restore_fault("protection_live_delete");
                index.protection_transition = None;
                save_index(database, &index)?;
            }
        }
    }
    if index.snapshots.iter().any(|s| s.deleting) || index.credentials.iter().any(|c| c.deleting) {
        cleanup(database, secrets, &mut index)?;
    }
    Ok(())
}

pub(super) fn owned_accounts(database: &Path) -> Result<Vec<String>, AppError> {
    Ok(read_index(database)?
        .credentials
        .into_iter()
        .map(|c| c.account)
        .collect())
}

pub(super) fn has_recovery_state(database: &Path) -> Result<bool, AppError> {
    let entries = match fs::read_dir(directory(database)?) {
        Ok(entries) => Some(entries),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(storage_error(error)),
    };
    if let Some(entries) = entries {
        for entry in entries {
            let name = entry.map_err(storage_error)?.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("pending-restore")
                || name.starts_with("rollback-restore-")
                || name.starts_with("failed-restore-")
                || name.starts_with(".pending-restore")
                || name.starts_with(".rollback-restore-")
            {
                // Even an unbound or malformed generation is retained evidence.
                return Ok(true);
            }
        }
    }
    let index = read_index(database)?;
    Ok(!snapshots(database)?.is_empty()
        || !index.snapshots.is_empty()
        || !index.credentials.is_empty()
        || index.protection_transition.is_some())
}

/// Reports contain disposition metadata only; never credentials or contents.
#[derive(Debug, Serialize)]
pub struct LocalBackupRecovery {
    pub file: String,
    pub disposition: String,
    pub staged: bool,
}

pub(super) fn recover(
    database: &Path,
    secrets: &dyn SecretStore,
    name: &str,
    passphrase: Option<&str>,
    apply: bool,
) -> Result<LocalBackupRecovery, AppError> {
    if !name_valid(name) {
        return Err(failure("choose an exact owned snapshot basename"));
    }
    require_direct_restore_path(database)?;
    let custody = workspace_lock::WorkspaceLock::acquire(database)?;
    let _operation = custody.operation()?;
    custody.require_quiescent(database)?;
    if database.with_file_name(PENDING_RESTORE_MARKER).exists() {
        return Err(failure("finish or cancel the pending restore first"));
    }
    let index = read_index(database)?;
    let path = directory(database)?.join("backups").join(name);
    let connection = readonly(&path)?;
    let digest = sha256_file(&path)?;
    let binding = index.snapshots.iter().find(|s| s.file == name);
    if binding.is_some_and(|s| s.sha256 != digest || s.deleting) {
        return Err(failure(
            "the selected snapshot binding is unavailable or changed",
        ));
    }
    let mut key = None;
    let mut requires_passphrase = false;
    let selected_wrap = snapshot_wrap(&connection)?;
    if let Some(wrap) = selected_wrap {
        requires_passphrase = true;
        if let Some(passphrase) = passphrase {
            key = Some(unwrap(&wrap, passphrase)?);
        }
    } else if let Some(Snapshot {
        credential: SnapshotCredential::Retained { account },
        ..
    }) = binding
    {
        let credential = index
            .credentials
            .iter()
            .find(|c| &c.account == account)
            .ok_or_else(|| failure("the snapshot credential binding is missing"))?;
        let value = secrets
            .get(account)?
            .ok_or_else(|| failure("the retained snapshot credential is unavailable"))?;
        if let Some(expected) = &credential.wrap_sha256 {
            requires_passphrase = true;
            let wrap = decode_wrap(&value)?;
            if wrap_digest(&wrap) != *expected {
                return Err(failure("the retained snapshot wrap changed"));
            }
            if let Some(passphrase) = passphrase {
                key = Some(unwrap(&wrap, passphrase)?);
            }
        } else {
            key = decode_key(&value);
        }
        if key.is_some_and(|key| sha256_hex(&key) != credential.key_sha256) {
            return Err(failure("the retained snapshot key changed"));
        }
    } else if authenticate(&connection, None).is_err() {
        // An unindexed copy may still use the live key. No adoption or writes
        // happen during diagnosis, and no key is invented for encrypted rows.
        key = secrets
            .get(&vault_key_account(database))?
            .as_deref()
            .and_then(decode_key);
        if key.is_some_and(|candidate| authenticate(&connection, Some(candidate)).is_err()) {
            key = None;
        }
        if key.is_none() {
            requires_passphrase = true;
            if let Some(passphrase) = passphrase {
                for sibling in snapshots(database)? {
                    if let Ok(other) = readonly(&sibling) {
                        if let Some(wrap) = snapshot_wrap(&other)? {
                            if let Ok(candidate) = unwrap(&wrap, passphrase) {
                                if authenticate(&connection, Some(candidate)).is_ok() {
                                    key = Some(candidate);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if requires_passphrase && passphrase.is_none() {
        return Ok(LocalBackupRecovery {
            file: name.to_owned(),
            disposition: "passphrase required, or no matching surviving credential".to_owned(),
            staged: false,
        });
    }
    authenticate(&connection, key).map_err(|_| {
        failure("no matching surviving credential was found, or the snapshot is damaged")
    })?;
    let schema_version = user_version(&connection)?;
    if schema_version > target_schema_version() {
        return Err(failure("this snapshot requires a newer Voyalier version"));
    }
    drop(connection);
    if apply {
        stage_snapshot_file(
            database,
            secrets,
            &path,
            schema_version,
            key,
            "local safety snapshot",
            &now_rfc3339(),
        )?;
    }
    Ok(LocalBackupRecovery {
        file: name.to_owned(),
        disposition: "validated local snapshot; activation requires restart".to_owned(),
        staged: apply,
    })
}

pub fn recover_default_local_backup(
    name: &str,
    passphrase: Option<&str>,
    apply: bool,
) -> Result<LocalBackupRecovery, AppError> {
    recover(
        &default_database_path()?,
        &KeyringSecretStore,
        name,
        passphrase,
        apply,
    )
}

/// Both thin shells dispatch this before product startup. Diagnosis changes no
/// snapshot, index, credential or generation; apply still only stages recovery.
pub fn run_local_backup_recovery_cli(arguments: &[String]) -> Result<(), AppError> {
    if arguments.is_empty()
        || arguments.len() > 2
        || (arguments.len() == 2 && arguments[1] != "--apply")
    {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "usage: backup-recover <owned snapshot basename> [--apply]",
        ));
    }
    let apply = arguments.len() == 2;
    let mut report = recover_default_local_backup(&arguments[0], None, false)?;
    if apply {
        if report.disposition.starts_with("passphrase required") {
            let passphrase = read_recovery_passphrase()?;
            report = recover_default_local_backup(&arguments[0], Some(&passphrase), true)?;
        } else {
            report = recover_default_local_backup(&arguments[0], None, true)?;
        }
    }
    println!(
        "{}",
        serde_json::to_string(&report)
            .map_err(|_| failure("the recovery report could not be encoded"))?
    );
    Ok(())
}

fn read_recovery_passphrase() -> Result<String, AppError> {
    use std::io::{BufRead, IsTerminal};
    if !std::io::stdin().is_terminal() {
        return Err(failure(
            "protected recovery requires a non-echo terminal; no passphrase was read",
        ));
    }
    let _echo = ConsoleEcho::disable()?;
    eprint!("Original snapshot passphrase: ");
    std::io::stderr().flush().map_err(storage_error)?;
    let mut value = String::new();
    std::io::stdin()
        .lock()
        .take(4097)
        .read_line(&mut value)
        .map_err(storage_error)?;
    if value.len() > 4096 {
        return Err(failure("the passphrase exceeded its console input limit"));
    }
    eprintln!();
    Ok(value.trim_end_matches(['\r', '\n']).to_owned())
}

#[cfg(unix)]
struct ConsoleEcho(libc::termios);

#[cfg(unix)]
impl ConsoleEcho {
    fn disable() -> Result<Self, AppError> {
        let mut original: libc::termios = unsafe { std::mem::zeroed() };
        // SAFETY: initialized termios output and stdin fd are live; attributes
        // are restored by Drop on every ordinary success/error path.
        if unsafe { libc::tcgetattr(libc::STDIN_FILENO, &mut original) } != 0 {
            return Err(storage_error(std::io::Error::last_os_error()));
        }
        let mut hidden = original;
        hidden.c_lflag &= !libc::ECHO;
        if unsafe { libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &hidden) } != 0 {
            return Err(storage_error(std::io::Error::last_os_error()));
        }
        Ok(Self(original))
    }
}

#[cfg(unix)]
impl Drop for ConsoleEcho {
    fn drop(&mut self) {
        // SAFETY: restores the attributes captured for this process's stdin.
        unsafe {
            libc::tcsetattr(libc::STDIN_FILENO, libc::TCSANOW, &self.0);
        }
    }
}

#[cfg(windows)]
struct ConsoleEcho {
    handle: windows_sys::Win32::Foundation::HANDLE,
    mode: u32,
}

#[cfg(windows)]
impl ConsoleEcho {
    fn disable() -> Result<Self, AppError> {
        use windows_sys::Win32::System::Console::{
            ENABLE_ECHO_INPUT, GetConsoleMode, GetStdHandle, STD_INPUT_HANDLE, SetConsoleMode,
        };
        // SAFETY: synchronous console APIs use the process-owned standard
        // handle and a live mode output; no handle ownership is transferred.
        let handle = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
        let mut mode = 0;
        if unsafe { GetConsoleMode(handle, &mut mode) } == 0
            || unsafe { SetConsoleMode(handle, mode & !ENABLE_ECHO_INPUT) } == 0
        {
            return Err(storage_error(std::io::Error::last_os_error()));
        }
        Ok(Self { handle, mode })
    }
}

#[cfg(windows)]
impl Drop for ConsoleEcho {
    fn drop(&mut self) {
        // SAFETY: restores the mode captured from this process's console.
        unsafe {
            windows_sys::Win32::System::Console::SetConsoleMode(self.handle, self.mode);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(path: &Path, secrets: Arc<MemorySecretStore>) -> AppService {
        AppService::open_path_with_deps(path, Arc::new(FakeFetcher::offline()), secrets).unwrap()
    }

    fn trip(service: &AppService) -> String {
        service
            .create_trip(CreateTripInput {
                origin: "Chicago".to_owned(),
                destination: "Tokyo".to_owned(),
                start_date: "2027-04-01".to_owned(),
                end_date: "2027-04-10".to_owned(),
                title: None,
            })
            .unwrap()
            .id
    }

    #[test]
    fn distinct_key_restore_retains_old_notes_files_and_existing_update_copies() {
        let database = crate::tests::temp_database("snapshot-old");
        let source_database = crate::tests::temp_database("snapshot-new");
        let secrets = Arc::new(MemorySecretStore::default());
        let old = service(&database, secrets.clone());
        let old_trip = trip(&old);
        old.set_trip_notes(&old_trip, "old sealed note").unwrap();
        let bytes = b"%PDF-1.4\nsynthetic local file\n%%EOF";
        let attachment = old
            .import_attachment(ImportAttachmentInput {
                trip_id: old_trip.clone(),
                label: "synthetic.pdf".to_owned(),
                mime_type: "application/pdf".to_owned(),
                content_base64: BASE64.encode(bytes),
            })
            .unwrap();
        let previous = old.backup_database("previous-update").unwrap();
        // A pre-index copy made by an older version must also be adopted.
        let legacy = database
            .parent()
            .unwrap()
            .join("backups/pre-update-legacy.sqlite3");
        consistent_sqlite_snapshot(&old.connection().unwrap(), &legacy).unwrap();
        let source = service(&source_database, Arc::new(MemorySecretStore::default()));
        let new_trip = trip(&source);
        source.set_trip_notes(&new_trip, "new sealed note").unwrap();
        let container = source.export_backup("synthetic backup phrase").unwrap();
        old.stage_restore("synthetic backup phrase", &container)
            .unwrap();
        drop(old);
        let restored = service(&database, secrets.clone());
        assert_eq!(
            restored.get_trip_notes(&new_trip).unwrap().body,
            "new sealed note"
        );
        let index = read_index(&database).unwrap();
        for name in [
            Path::new(&previous.path)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap(),
            "pre-update-legacy.sqlite3",
        ] {
            assert!(matches!(
                index
                    .snapshots
                    .iter()
                    .find(|s| s.file == name)
                    .unwrap()
                    .credential,
                SnapshotCredential::Retained { .. }
            ));
        }
        let safety = index
            .snapshots
            .iter()
            .find(|s| s.file.starts_with("pre-restore-"))
            .unwrap()
            .file
            .clone();
        let live_key_digest = sha256_hex(
            &decode_key(&secrets.get(&vault_key_account(&database)).unwrap().unwrap()).unwrap(),
        );
        assert!(
            index
                .credentials
                .iter()
                .any(|c| c.key_sha256 != live_key_digest)
        );
        let report = recover(&database, secrets.as_ref(), &safety, None, false).unwrap();
        assert!(!report.staged && !restored.has_pending_restore());
        recover(&database, secrets.as_ref(), &safety, None, true).unwrap();
        drop(restored);
        let recovered = service(&database, secrets.clone());
        assert_eq!(
            recovered.get_trip_notes(&old_trip).unwrap().body,
            "old sealed note"
        );
        assert_eq!(
            recovered
                .get_attachment(&attachment.id)
                .unwrap()
                .content_base64,
            BASE64.encode(bytes)
        );
        assert!(recovered.get_trip(&new_trip).is_err());
        drop(recovered);
        drop(source);
        crate::tests::cleanup_database(database);
        crate::tests::cleanup_database(source_database);
    }

    #[test]
    fn later_passphrase_wraps_raw_shadows_without_rewriting_snapshot_bytes() {
        let database = crate::tests::temp_database("snapshot-protection");
        let secrets = Arc::new(MemorySecretStore::default());
        let app = service(&database, secrets.clone());
        let id = trip(&app);
        app.set_trip_notes(&id, "sealed history").unwrap();
        let backup = app.backup_database("before-protection").unwrap();
        let path = PathBuf::from(&backup.path);
        let hash = sha256_file(&path).unwrap();
        let raw = read_index(&database).unwrap().credentials[0]
            .account
            .clone();
        app.set_vault_passphrase("original protected phrase")
            .unwrap();
        assert!(!secrets.has(&raw));
        assert!(!secrets.has(&vault_key_account(&database)));
        assert_eq!(sha256_file(&path).unwrap(), hash);
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(
            recover(&database, secrets.as_ref(), name, None, false)
                .unwrap()
                .disposition
                .contains("passphrase required")
        );
        assert!(
            recover(
                &database,
                secrets.as_ref(),
                name,
                Some("incorrect protected phrase"),
                false
            )
            .is_err()
        );
        assert!(
            recover(
                &database,
                secrets.as_ref(),
                name,
                Some("original protected phrase"),
                false
            )
            .is_ok()
        );
        app.remove_vault_passphrase("original protected phrase")
            .unwrap();
        app.backup_database("after-removal").unwrap();
        app.set_vault_passphrase("new protected phrase").unwrap();
        assert!(
            recover(
                &database,
                secrets.as_ref(),
                name,
                Some("original protected phrase"),
                false
            )
            .is_ok()
        );
        assert!(
            recover(
                &database,
                secrets.as_ref(),
                name,
                Some("new protected phrase"),
                false
            )
            .is_err()
        );
        assert!(
            read_index(&database)
                .unwrap()
                .credentials
                .iter()
                .all(|c| c.wrap_sha256.is_some())
        );
        drop(app);
        crate::tests::cleanup_database(database);
    }

    #[test]
    fn protection_interruptions_resume_without_a_raw_shadow_bypass() {
        for point in [
            "protection_intent",
            "protection_wrap",
            "protection_references",
            "protection_shadow_delete",
            "protection_live_delete",
        ] {
            let database = crate::tests::temp_database(point);
            let secrets = Arc::new(MemorySecretStore::default());
            let app = service(&database, secrets.clone());
            let id = trip(&app);
            app.set_trip_notes(&id, "recoverable history").unwrap();
            app.backup_database("history").unwrap();
            set_restore_fault(point);
            assert!(
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                    || app.set_vault_passphrase("original protected phrase")
                ))
                .is_err()
            );
            drop(app);
            let reopened = service(&database, secrets.clone());
            if point != "protection_intent" {
                assert!(reopened.get_vault_status().unwrap().locked);
                assert!(!secrets.has(&vault_key_account(&database)));
                assert!(
                    read_index(&database)
                        .unwrap()
                        .credentials
                        .iter()
                        .all(|c| c.wrap_sha256.is_some())
                );
                reopened.unlock_vault("original protected phrase").unwrap();
            }
            assert_eq!(
                reopened.get_trip_notes(&id).unwrap().body,
                "recoverable history"
            );
            assert!(
                read_index(&database)
                    .unwrap()
                    .protection_transition
                    .is_none()
            );
            drop(reopened);
            crate::tests::cleanup_database(database);
        }
    }

    #[test]
    fn clear_interruptions_retire_only_last_snapshot_credentials_after_files() {
        for point in [
            "snapshot_delete_intent",
            "snapshot_unlink",
            "snapshot_key_delete",
        ] {
            let database = crate::tests::temp_database(point);
            let secrets = Arc::new(MemorySecretStore::default());
            let app = service(&database, secrets.clone());
            let id = trip(&app);
            app.set_trip_notes(&id, "live data survives clear").unwrap();
            app.backup_database("one").unwrap();
            app.backup_database("two").unwrap();
            let index = read_index(&database).unwrap();
            assert_eq!(index.credentials.len(), 1);
            let account = index.credentials[0].account.clone();
            prune(&database, secrets.as_ref(), 1).unwrap();
            assert!(
                secrets.has(&account),
                "the remaining shared-key copy still needs its credential"
            );
            set_restore_fault(point);
            assert!(
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| app.clear_backups()))
                    .is_err()
            );
            drop(app);
            let reopened = service(&database, secrets.clone());
            assert_eq!(
                reopened.get_trip_notes(&id).unwrap().body,
                "live data survives clear"
            );
            assert!(snapshots(&database).unwrap().is_empty());
            assert!(!secrets.has(&account));
            assert!(secrets.has(&vault_key_account(&database)));
            drop(reopened);
            crate::tests::cleanup_database(database);
        }
    }

    #[test]
    fn corrupt_index_and_unavailable_credentials_preserve_evidence() {
        let database = crate::tests::temp_database("snapshot-refusal");
        let secrets = Arc::new(MemorySecretStore::default());
        let app = service(&database, secrets.clone());
        let id = trip(&app);
        app.set_trip_notes(&id, "private history").unwrap();
        let backup = app.backup_database("history").unwrap();
        let path = PathBuf::from(&backup.path);
        let hash = sha256_file(&path).unwrap();
        let index_path = index_path(&database).unwrap();
        let original = fs::read(&index_path).unwrap();
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(
            recover(
                &database,
                &MemorySecretStore::unavailable(),
                name,
                None,
                true
            )
            .is_err()
        );
        assert!(!app.has_pending_restore());
        fs::write(&index_path, b"{ corrupt index").unwrap();
        assert!(app.clear_backups().is_err());
        assert_eq!(sha256_file(&path).unwrap(), hash);
        assert!(read_index(&database).is_err());
        fs::write(&index_path, original).unwrap();
        let mut foreign = read_index(&database).unwrap();
        foreign.credentials[0].account = "unrelated.account".to_owned();
        assert!(validate(&foreign, &database).is_err());
        drop(app);
        crate::tests::cleanup_database(database);
    }

    #[test]
    fn automatic_pruning_preserves_unavailable_evidence_until_explicit_clear() {
        let database = crate::tests::temp_database("snapshot-unavailable-prune");
        let secrets = Arc::new(MemorySecretStore::default());
        let app = service(&database, secrets.clone());
        let id = trip(&app);
        app.set_trip_notes(&id, "retained live note").unwrap();
        let old = app.backup_database("old").unwrap();
        let unavailable = database
            .parent()
            .unwrap()
            .join("backups/pre-update-zz-unavailable.sqlite3");
        copy_owned_snapshot(Path::new(&old.path), &unavailable).unwrap();
        let writer = Connection::open(&unavailable).unwrap();
        writer
            .execute(
                "UPDATE trip_notes SET body = 'v1:unavailable-or-damaged'",
                [],
            )
            .unwrap();
        drop(writer);
        app.backup_database("new").unwrap();
        let before_file = fs::read(&unavailable).unwrap();
        let before_index = fs::read(index_path(&database).unwrap()).unwrap();
        let before_accounts = secrets.entries.lock().unwrap().len();
        assert!(prune(&database, secrets.as_ref(), 1).is_err());
        assert_eq!(fs::read(&unavailable).unwrap(), before_file);
        assert_eq!(
            fs::read(index_path(&database).unwrap()).unwrap(),
            before_index
        );
        assert_eq!(secrets.entries.lock().unwrap().len(), before_accounts);
        assert!(
            read_index(&database)
                .unwrap()
                .credentials
                .iter()
                .all(|c| secrets.has(&c.account))
        );
        assert_eq!(app.clear_backups().unwrap(), 3);
        assert!(snapshots(&database).unwrap().is_empty());
        assert!(read_index(&database).unwrap().credentials.is_empty());
        assert_eq!(app.get_trip_notes(&id).unwrap().body, "retained live note");
        drop(app);
        crate::tests::cleanup_database(database);
    }

    #[test]
    fn snapshots_remain_readable_during_sibling_commits() {
        use std::sync::{
            Barrier,
            atomic::{AtomicUsize, Ordering},
        };
        let database = crate::tests::temp_database("snapshot-concurrent");
        let secrets = Arc::new(MemorySecretStore::default());
        let app = service(&database, secrets.clone());
        let id = trip(&app);
        app.set_trip_notes(&id, "accepted 0").unwrap();
        let sibling = service(&database, secrets);
        let barrier = Arc::new(Barrier::new(2));
        let commits = Arc::new(AtomicUsize::new(0));
        let writer_barrier = barrier.clone();
        let writer_commits = commits.clone();
        let writer_id = id.clone();
        let writer = std::thread::spawn(move || {
            writer_barrier.wait();
            for value in 1..=500 {
                sibling
                    .set_trip_notes(&writer_id, &format!("accepted {value}"))
                    .unwrap();
                writer_commits.store(value, Ordering::Release);
            }
        });
        barrier.wait();
        let mut overlap = false;
        for _ in 0..12 {
            let before = commits.load(Ordering::Acquire);
            let backup = app.backup_database("concurrent").unwrap();
            let after = commits.load(Ordering::Acquire);
            overlap |= after > before;
            let connection = readonly(Path::new(&backup.path)).unwrap();
            let note: sealed::Sealed = connection
                .query_row(
                    "SELECT body FROM trip_notes WHERE trip_id=?1",
                    params![id],
                    |r| r.get(0),
                )
                .unwrap();
            let note = app.vault.open(&note).unwrap();
            assert!(
                note.strip_prefix("accepted ")
                    .and_then(|n| n.parse::<usize>().ok())
                    .is_some_and(|n| n <= 500)
            );
            validate_sqlite_integrity(&connection).unwrap();
        }
        writer.join().unwrap();
        assert!(
            overlap,
            "fixture must observe sibling commits during at least one snapshot operation"
        );
        drop(app);
        crate::tests::cleanup_database(database);
    }

    #[test]
    fn embedded_protection_keyless_copies_and_stranded_evidence_are_truthful() {
        let database = crate::tests::temp_database("snapshot-embedded");
        let secrets = Arc::new(MemorySecretStore::default());
        let app = service(&database, secrets.clone());
        let id = trip(&app);
        app.set_trip_notes(&id, "protected snapshot").unwrap();
        app.set_vault_passphrase("original protected phrase")
            .unwrap();
        let backup = app.backup_database("protected").unwrap();
        let name = Path::new(&backup.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert!(matches!(
            read_index(&database).unwrap().snapshots[0].credential,
            SnapshotCredential::EmbeddedWrap
        ));
        assert!(
            recover(&database, secrets.as_ref(), name, None, false)
                .unwrap()
                .disposition
                .contains("passphrase required")
        );
        recover(
            &database,
            secrets.as_ref(),
            name,
            Some("original protected phrase"),
            true,
        )
        .unwrap();
        drop(app);
        let restored = service(&database, secrets);
        assert_eq!(
            restored.get_trip_notes(&id).unwrap().body,
            "protected snapshot"
        );
        drop(restored);
        crate::tests::cleanup_database(database);

        let database = crate::tests::temp_database("snapshot-keyless");
        let inactive = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            Arc::new(MemorySecretStore::unavailable()),
        )
        .unwrap();
        let id = trip(&inactive);
        inactive
            .set_trip_notes(&id, "p1:exact keyless history")
            .unwrap();
        let backup = inactive.backup_database("keyless").unwrap();
        let name = Path::new(&backup.path)
            .file_name()
            .unwrap()
            .to_str()
            .unwrap();
        assert!(matches!(
            read_index(&database).unwrap().snapshots[0].credential,
            SnapshotCredential::Keyless
        ));
        drop(inactive);
        let secrets = Arc::new(MemorySecretStore::default());
        recover(&database, secrets.as_ref(), name, None, true).unwrap();
        let restored = service(&database, secrets.clone());
        assert_eq!(
            restored.get_trip_notes(&id).unwrap().body,
            "p1:exact keyless history"
        );
        let encrypted = restored.backup_database("stranded").unwrap();
        let path = PathBuf::from(&encrypted.path);
        let hash = sha256_file(&path).unwrap();
        let mut index = read_index(&database).unwrap();
        let account = match &index
            .snapshots
            .iter()
            .find(|s| s.file == path.file_name().unwrap().to_str().unwrap())
            .unwrap()
            .credential
        {
            SnapshotCredential::Retained { account } => account.clone(),
            _ => panic!("encrypted copy needs a credential"),
        };
        secrets.delete(&account).unwrap();
        index.credentials.retain(|c| c.account != account);
        for snapshot in &mut index.snapshots {
            if matches!(&snapshot.credential, SnapshotCredential::Retained { account: value } if value == &account)
            {
                snapshot.credential = SnapshotCredential::Unavailable;
            }
        }
        save_index(&database, &index).unwrap();
        drop(restored);
        let missing = MemorySecretStore::default();
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(
            recover(
                &database,
                &missing,
                name,
                Some("original protected phrase"),
                true
            )
            .is_err()
        );
        assert_eq!(sha256_file(&path).unwrap(), hash);
        assert!(!database.with_file_name(PENDING_RESTORE_MARKER).exists());
        assert!(
            !missing.has(&vault_key_account(&database)),
            "diagnosis must never recreate a key"
        );
        crate::tests::cleanup_database(database);
    }
}
