use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use directories::ProjectDirs;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use voyalier_core::{
    ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, AddManualFactInput, AppError, AssistActivityEntry,
    AssistReply, AssistRequestPreview, CandidateFact, CandidateStatus, ConfirmCandidateInput,
    ConfirmationParser, ConfirmedFact, CreateTripInput, DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_OLLAMA_MODEL, DEFAULT_OPENAI_MODEL, DocumentKind, DownloadedPack, ErrorCode,
    ExtractionMethod, FCDO_COUNTRIES, FcdoCountry, HealthResponse, ImportDocumentInput,
    ImportResult, IntelligenceMode, JsonLdParser, LocalAiStatus, NormalizedDocument,
    OLLAMA_CHAT_URL, OLLAMA_TAGS_URL, OPENAI_CHAT_URL, PROVIDERS, PackContent, PackInfo,
    ParsedCandidate, PersonaWeights, PlaintextParser, ProviderConfig, ProviderId, Recommendation,
    RedactionPolicy, SearchHit, SearchableDocument, SourceDocument, TodayView,
    TravelAdviceSnapshot, Trip, TripBrief, TripDetail, TripStatus, TripSummary, UpdateTripInput,
    WeatherSnapshot, assess_readiness, build_anthropic_messages_body, build_assist_preview,
    build_ollama_chat_body, build_openai_chat_body, build_today_view, build_trip_brief,
    changed_payload_fields, detect_itinerary_conflicts, new_id, now_rfc3339, pack_catalog,
    pack_download_url, parse_anthropic_reply, parse_fcdo_content, parse_forecast_response,
    parse_geocoding_response, parse_ollama_chat_reply, parse_openai_chat_reply, parse_pack_content,
    provider_info, recommend_places, search_trip_corpus, validate_api_key, validate_country_slug,
    validate_create_trip, validate_document_content, validate_fact_payload, validate_model_name,
    validate_pack_id, validate_provider_id, validate_search_query, validate_update_trip,
};
use voyalier_core::{
    VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN, VaultStatus, derive_key as vault_derive_key,
    open as vault_open, seal as vault_seal,
};

const DATABASE_FILE: &str = "voyalier.sqlite3";

/// Fetches a URL's body as text. The only network seam in the application
/// layer — injectable so every test runs without touching the network.
pub trait AdviceFetcher: Send + Sync {
    fn fetch_text(&self, url: &str) -> Result<String, AppError>;

    /// POST a JSON body (with any extra request headers, e.g. an auth header)
    /// and return the response text. Defaults to an error so only fetchers that
    /// need it (the inference path) implement it; the many GET-only test stubs
    /// are unaffected.
    fn post_json(
        &self,
        _url: &str,
        _body: &str,
        _headers: &[(&str, &str)],
    ) -> Result<String, AppError> {
        Err(AppError::new(
            ErrorCode::AssistFailed,
            "this fetcher does not support POST",
        ))
    }
}

/// Production fetcher: ureq with a global timeout and an identifying
/// User-Agent, per API-citizenship norms for keyless government endpoints.
struct UreqFetcher;

impl AdviceFetcher for UreqFetcher {
    fn fetch_text(&self, url: &str) -> Result<String, AppError> {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(15)))
            .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
            .build();
        let agent: ureq::Agent = config.into();
        let mut response = agent.get(url).call().map_err(fetch_failure)?;
        response.body_mut().read_to_string().map_err(fetch_failure)
    }

    fn post_json(
        &self,
        url: &str,
        body: &str,
        headers: &[(&str, &str)],
    ) -> Result<String, AppError> {
        // Model inference can be slow; allow a generous timeout. Do NOT treat a
        // non-2xx status as a transport error — providers put the real cause
        // (bad key, rate limit, unknown model) in the JSON body, which the
        // per-provider reply parser surfaces. Otherwise that body is discarded.
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(120)))
            .http_status_as_error(false)
            .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
            .build();
        let agent: ureq::Agent = config.into();
        let mut request = agent.post(url).header("Content-Type", "application/json");
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let mut response = request.send(body).map_err(assist_transport_failure)?;
        response
            .body_mut()
            .read_to_string()
            .map_err(assist_transport_failure)
    }
}

fn assist_transport_failure(cause: ureq::Error) -> AppError {
    AppError::new(
        ErrorCode::AssistFailed,
        format!("could not reach the AI provider: {cause}"),
    )
}

fn fetch_failure(cause: ureq::Error) -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        format!("could not reach the official source: {cause}"),
    )
}

/// Stores BYOK secrets outside the database and outside any contract payload.
/// Injectable so tests never touch the real OS keychain. Account names are
/// opaque keys chosen by the caller; the secret value is never returned by any
/// method other than `get`, which is reserved for the (later) inference path.
pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> Result<(), AppError>;
    fn has(&self, account: &str) -> bool;
    fn delete(&self, account: &str) -> Result<(), AppError>;
    /// Read a stored secret, or `None` if absent. Used only on the inference
    /// path to place the key in an outgoing request header — never logged,
    /// returned to the UI, or written anywhere else.
    fn get(&self, account: &str) -> Result<Option<String>, AppError>;
}

const KEYRING_SERVICE: &str = "com.voyalier.keys";

/// The most recommendations returned for a trip.
const RECOMMENDATION_LIMIT: usize = 24;

/// Production secret store: the OS keychain via the `keyring` crate.
struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry(account: &str) -> Result<keyring::Entry, AppError> {
        keyring::Entry::new(KEYRING_SERVICE, account).map_err(keyring_failure)
    }
}

impl SecretStore for KeyringSecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), AppError> {
        Self::entry(account)?
            .set_password(secret)
            .map_err(keyring_failure)
    }

    fn has(&self, account: &str) -> bool {
        Self::entry(account)
            .and_then(|entry| entry.get_password().map_err(keyring_failure))
            .is_ok()
    }

    fn delete(&self, account: &str) -> Result<(), AppError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keyring_failure(error)),
        }
    }

    fn get(&self, account: &str) -> Result<Option<String>, AppError> {
        match Self::entry(account)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keyring_failure(error)),
        }
    }
}

/// In-memory secret store for tests and embedding contexts without a keychain.
#[derive(Default)]
pub struct MemorySecretStore {
    entries: Mutex<std::collections::HashMap<String, String>>,
}

impl SecretStore for MemorySecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), AppError> {
        self.entries
            .lock()
            .map_err(|_| storage_error(PoisonError))?
            .insert(account.to_owned(), secret.to_owned());
        Ok(())
    }

    fn has(&self, account: &str) -> bool {
        self.entries
            .lock()
            .map(|entries| entries.contains_key(account))
            .unwrap_or(false)
    }

    fn delete(&self, account: &str) -> Result<(), AppError> {
        self.entries
            .lock()
            .map_err(|_| storage_error(PoisonError))?
            .remove(account);
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, AppError> {
        Ok(self
            .entries
            .lock()
            .map_err(|_| storage_error(PoisonError))?
            .get(account)
            .cloned())
    }
}

fn keyring_failure(error: keyring::Error) -> AppError {
    AppError::new(
        ErrorCode::StorageFailure,
        format!("the OS keychain could not be reached: {error}"),
    )
}

/// The keychain account holding the vault's data key. Present in keychain-only
/// mode; absent once a passphrase guards the key instead.
const VAULT_KEY_ACCOUNT: &str = "vault.data_key";
/// Tag marking a stored field as sealed; anything without it is legacy plaintext.
const VAULT_PREFIX: &str = "v1:";
/// Minimum passphrase length. Deliberately low friction — this is a second
/// factor on an already-encrypted store, not the sole secret.
const MIN_PASSPHRASE_LEN: usize = 8;

/// In-memory vault state, shared behind interior mutability so an unlock or a
/// passphrase change (through `&self`) is visible to every reader for the
/// lifetime of the process.
#[derive(Clone, Copy, Default)]
struct VaultState {
    /// The data key. Present when the vault is usable (keychain mode, or once a
    /// passphrase-protected vault has been unlocked this session).
    key: Option<[u8; VAULT_KEY_LEN]>,
    /// True when a passphrase wraps the key. With `protected` set and no `key`,
    /// the vault is **locked**: sealed fields cannot be read or written.
    protected: bool,
}

/// At-rest encryption for sensitive stored fields (confirmed-fact payloads).
///
/// Three states:
/// - **active** (`key` present): fields are sealed/opened transparently. This is
///   keychain-only mode, or a passphrase vault after unlock.
/// - **locked** (`protected`, no `key`): a passphrase is set but not yet entered
///   this session; reads and writes of sealed fields error until unlock.
/// - **inactive** (neither): no keychain and no passphrase — e.g. a headless CI
///   runner — so fields are stored as plaintext and the app still works.
///
/// Sealed values are tagged, so plaintext and sealed values coexist during
/// migration.
#[derive(Clone)]
pub struct Vault {
    state: Arc<Mutex<VaultState>>,
}

impl Vault {
    fn new(state: VaultState) -> Self {
        Self {
            state: Arc::new(Mutex::new(state)),
        }
    }

    /// Resolve the vault's state at open time. When a passphrase is set (a
    /// `vault_meta` row exists) the vault opens **locked** and the data key stays
    /// wrapped until unlock. Otherwise the raw data key is read from — or, on
    /// first run, generated into — the OS keychain. Any keychain error leaves the
    /// vault inactive (plaintext), which keeps CI and keychain-less hosts working.
    fn load_or_init(secrets: &dyn SecretStore, connection: &Connection) -> Result<Self, AppError> {
        if read_vault_wrap(connection)?.is_some() {
            // A passphrase guards the key, so the raw key must not linger in the
            // keychain — best-effort clean up in case a crash interrupted
            // set_vault_passphrase between writing the wrap and deleting the key.
            let _ = secrets.delete(VAULT_KEY_ACCOUNT);
            return Ok(Self::new(VaultState {
                key: None,
                protected: true,
            }));
        }
        let state = match secrets.get(VAULT_KEY_ACCOUNT) {
            Ok(Some(encoded)) => VaultState {
                key: decode_key(&encoded),
                protected: false,
            },
            Ok(None) => {
                let mut key = [0u8; VAULT_KEY_LEN];
                if getrandom::getrandom(&mut key).is_err() {
                    VaultState::default()
                } else if secrets.set(VAULT_KEY_ACCOUNT, &BASE64.encode(key)).is_ok() {
                    VaultState {
                        key: Some(key),
                        protected: false,
                    }
                } else {
                    // Couldn't persist the key — never encrypt with a key we
                    // can't recover, or the data would be unreadable next run.
                    VaultState::default()
                }
            }
            Err(_) => VaultState::default(),
        };
        Ok(Self::new(state))
    }

    fn snapshot(&self) -> VaultState {
        self.state.lock().map(|guard| *guard).unwrap_or_default()
    }

    fn set_state(&self, next: VaultState) {
        if let Ok(mut guard) = self.state.lock() {
            *guard = next;
        }
    }

    fn is_active(&self) -> bool {
        self.snapshot().key.is_some()
    }

    fn status(&self) -> VaultStatus {
        let state = self.snapshot();
        VaultStatus {
            active: state.key.is_some(),
            protected: state.protected,
            locked: state.protected && state.key.is_none(),
        }
    }

    /// Seal a plaintext field. Inactive → plaintext passthrough; locked → error.
    fn seal_field(&self, plaintext: &str) -> Result<String, AppError> {
        let state = self.snapshot();
        let Some(key) = state.key else {
            return if state.protected {
                Err(vault_locked_error())
            } else {
                Ok(plaintext.to_owned())
            };
        };
        let mut nonce = [0u8; VAULT_NONCE_LEN];
        getrandom::getrandom(&mut nonce).map_err(|_| nonce_error())?;
        let sealed = vault_seal(&key, &nonce, plaintext.as_bytes())?;
        Ok(format!("{VAULT_PREFIX}{}", BASE64.encode(sealed)))
    }

    /// Open a stored field. Untagged (legacy plaintext) values pass through;
    /// tagged values require the key (locked → error until unlock).
    fn open_field(&self, stored: &str) -> Result<String, AppError> {
        let Some(encoded) = stored.strip_prefix(VAULT_PREFIX) else {
            return Ok(stored.to_owned());
        };
        let state = self.snapshot();
        let Some(key) = state.key else {
            return Err(if state.protected {
                vault_locked_error()
            } else {
                AppError::new(
                    ErrorCode::StorageFailure,
                    "this data is encrypted but the vault key is unavailable",
                )
            });
        };
        let bytes = BASE64
            .decode(encoded)
            .map_err(|_| AppError::new(ErrorCode::StorageFailure, "corrupt encrypted field"))?;
        let opened = vault_open(&key, &bytes)?;
        String::from_utf8(opened).map_err(|_| {
            AppError::new(
                ErrorCode::StorageFailure,
                "decrypted data was not valid text",
            )
        })
    }
}

fn decode_key(encoded: &str) -> Option<[u8; VAULT_KEY_LEN]> {
    let bytes = BASE64.decode(encoded).ok()?;
    <[u8; VAULT_KEY_LEN]>::try_from(bytes.as_slice()).ok()
}

fn nonce_error() -> AppError {
    AppError::new(ErrorCode::InternalUnexpected, "could not generate a nonce")
}

fn vault_locked_error() -> AppError {
    AppError::new(
        ErrorCode::VaultLocked,
        "the vault is locked — unlock it with your passphrase to read or change this trip",
    )
}

fn wrong_passphrase_error() -> AppError {
    AppError::new(
        ErrorCode::VaultPassphraseIncorrect,
        "that passphrase is incorrect",
    )
}

/// Reject an empty or too-short passphrase before it is used to derive a key.
fn validate_passphrase(passphrase: &str) -> Result<(), AppError> {
    if passphrase.chars().count() < MIN_PASSPHRASE_LEN {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            format!("the passphrase must be at least {MIN_PASSPHRASE_LEN} characters"),
        ));
    }
    Ok(())
}

/// The passphrase-wrapped data key and its salt, decoded from `vault_meta`.
struct VaultWrap {
    salt: Vec<u8>,
    wrapped_key: Vec<u8>,
}

/// Read the single `vault_meta` row, decoding its base64 columns. `None` when no
/// passphrase is set. Corrupt encoding is a hard error rather than a silent
/// fallback, so a protected vault never appears unprotected.
fn read_vault_wrap(connection: &Connection) -> Result<Option<VaultWrap>, AppError> {
    let row: Option<(String, String)> = connection
        .query_row(
            "SELECT salt, wrapped_key FROM vault_meta WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(storage_error)?;
    let Some((salt, wrapped)) = row else {
        return Ok(None);
    };
    let decode = |value: &str| {
        BASE64.decode(value).map_err(|_| {
            AppError::new(
                ErrorCode::StorageFailure,
                "the vault passphrase record is corrupt",
            )
        })
    };
    Ok(Some(VaultWrap {
        salt: decode(&salt)?,
        wrapped_key: decode(&wrapped)?,
    }))
}

fn app_to_rusqlite(error: AppError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

/// The sensitive text columns the vault seals: the parsed confirmed-fact payload
/// AND the original imported document text it was extracted from — both carry
/// confirmation codes and traveler names, so both must be encrypted at rest.
const SEALED_COLUMNS: &[(&str, &str)] = &[
    ("confirmed_facts", "payload"),
    ("source_documents", "raw_content"),
    // Pending candidates hold the same parsed secrets, and their field spans
    // carry verbatim excerpts of the source text (often the code itself).
    ("candidate_facts", "payload"),
    ("candidate_facts", "field_spans"),
];

/// Seal any legacy plaintext values in the vault's sensitive columns once the
/// vault is active. Idempotent: already-sealed rows (tagged) are skipped. Safe to
/// re-run (e.g. after unlocking a passphrase vault).
fn migrate_encrypt_sensitive_columns(
    connection: &Connection,
    vault: &Vault,
) -> Result<(), AppError> {
    if !vault.is_active() {
        return Ok(());
    }
    for (table, column) in SEALED_COLUMNS {
        let legacy: Vec<(String, String)> = {
            let mut statement = connection
                .prepare(&format!("SELECT id, {column} FROM {table}"))
                .map_err(storage_error)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(storage_error)?;
            collect_rows(rows)?
        };
        for (id, value) in legacy {
            if value.starts_with(VAULT_PREFIX) {
                continue;
            }
            let sealed = vault.seal_field(&value)?;
            connection
                .execute(
                    &format!("UPDATE {table} SET {column} = ?1 WHERE id = ?2"),
                    params![sealed, id],
                )
                .map_err(storage_error)?;
        }
    }
    Ok(())
}

#[derive(Debug)]
struct PoisonError;
impl std::fmt::Display for PoisonError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "in-memory secret store lock poisoned")
    }
}
impl std::error::Error for PoisonError {}

#[derive(Clone)]
pub struct AppService {
    connection: Arc<Mutex<Connection>>,
    /// The main SQLite file path — retained so `backup_database` can copy it and
    /// derive the sibling `backups/` directory.
    database_path: PathBuf,
    fetcher: Arc<dyn AdviceFetcher>,
    secrets: Arc<dyn SecretStore>,
    vault: Vault,
}

/// Metadata for a pre-update database backup returned to the caller/UI. Holds
/// only a filesystem path and timestamps — never any trip content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub path: String,
    pub label: String,
    pub created_at: String,
}

impl AppService {
    pub fn open_default() -> Result<Self, AppError> {
        Self::open_path(default_database_path()?)
    }

    pub fn open_path(path: impl AsRef<Path>) -> Result<Self, AppError> {
        Self::open_path_with_fetcher(path, Arc::new(UreqFetcher))
    }

    /// Test/embedding constructor with an injected fetcher and the real keychain.
    pub fn open_path_with_fetcher(
        path: impl AsRef<Path>,
        fetcher: Arc<dyn AdviceFetcher>,
    ) -> Result<Self, AppError> {
        Self::open_path_with_deps(path, fetcher, Arc::new(KeyringSecretStore))
    }

    /// Test/embedding constructor with both the fetcher and the secret store
    /// injected, so provider-key tests never touch the OS keychain.
    pub fn open_path_with_deps(
        path: impl AsRef<Path>,
        fetcher: Arc<dyn AdviceFetcher>,
        secrets: Arc<dyn SecretStore>,
    ) -> Result<Self, AppError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(path).map_err(storage_error)?;
        init_connection(&connection)?;
        let vault = Vault::load_or_init(secrets.as_ref(), &connection)?;
        // Encrypt any pre-existing plaintext payloads now the vault is available.
        migrate_encrypt_sensitive_columns(&connection, &vault)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            database_path: path.to_path_buf(),
            fetcher,
            secrets,
            vault,
        })
    }

    pub fn health(&self) -> Result<HealthResponse, AppError> {
        Ok(HealthResponse {
            status: "ok".to_owned(),
            service: "voyalier-app".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            intelligence_mode: IntelligenceMode::Local,
        })
    }

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
        getrandom::getrandom(&mut salt).map_err(|_| nonce_error())?;
        let kek = vault_derive_key(passphrase, &salt)?;
        let mut nonce = [0u8; VAULT_NONCE_LEN];
        getrandom::getrandom(&mut nonce).map_err(|_| nonce_error())?;
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

    pub fn create_trip(&self, input: CreateTripInput) -> Result<Trip, AppError> {
        let input = validate_create_trip(input)?;
        let trip = Trip {
            id: new_id("trip"),
            title: input.title,
            origin: input.origin,
            destination: input.destination,
            start_date: input.start_date,
            end_date: input.end_date,
            status: TripStatus::Draft,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };

        self.connection()?.execute(
            "INSERT INTO trips (id, title, origin, destination, start_date, end_date, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                trip.id,
                trip.title,
                trip.origin,
                trip.destination,
                trip.start_date,
                trip.end_date,
                enum_to_sql(trip.status)?,
                trip.created_at,
                trip.updated_at
            ],
        ).map_err(storage_error)?;

        Ok(trip)
    }

    pub fn list_trips(&self) -> Result<Vec<TripSummary>, AppError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    trips.id,
                    trips.title,
                    trips.origin,
                    trips.destination,
                    trips.start_date,
                    trips.end_date,
                    trips.status,
                    trips.created_at,
                    trips.updated_at,
                    (SELECT COUNT(*) FROM confirmed_facts WHERE confirmed_facts.trip_id = trips.id),
                    (SELECT COUNT(*) FROM candidate_facts WHERE candidate_facts.trip_id = trips.id AND candidate_facts.status = 'pending')
                 FROM trips
                 ORDER BY trips.created_at ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], row_to_trip_summary)
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    pub fn get_trip(&self, trip_id: &str) -> Result<TripDetail, AppError> {
        let connection = self.connection()?;
        let trip = fetch_trip(&connection, trip_id)?;
        let confirmed_facts = fetch_confirmed_facts(&connection, trip_id, &self.vault)?;
        let pending_candidate_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM candidate_facts WHERE trip_id = ?1 AND status = 'pending'",
                params![trip_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(storage_error)?;
        let pending_candidate_count = pending_candidate_count as u32;
        let itinerary_conflicts = detect_itinerary_conflicts(&trip, &confirmed_facts);
        let readiness = assess_readiness(
            &trip,
            &confirmed_facts,
            pending_candidate_count,
            &itinerary_conflicts,
        );
        let travel_advice = fetch_travel_advice_snapshot(&connection, trip_id)?;
        let weather = fetch_weather_snapshot(&connection, trip_id)?;
        Ok(TripDetail {
            trip,
            confirmed_facts,
            pending_candidate_count,
            itinerary_conflicts,
            readiness,
            travel_advice,
            weather,
        })
    }

    /// The curated list of fetchable FCDO country pages.
    pub fn list_advice_countries(&self) -> Vec<FcdoCountry> {
        FCDO_COUNTRIES.to_vec()
    }

    /// The catalog of downloadable city packs. Static curated metadata — no
    /// network and no pack contents; downloading a pack is a separate consented
    /// step.
    pub fn list_packs(&self) -> Vec<PackInfo> {
        pack_catalog()
    }

    /// Download a city pack's contents for a trip. Called only from an explicit
    /// user action — the click is the consent for this single, named fetch. The
    /// download pulls place data and travel notes *in* from GitHub; nothing
    /// about the trip is sent. Contents are stored locally and replace any
    /// earlier copy of the same pack for this trip.
    pub fn download_pack(&self, trip_id: &str, pack_id: &str) -> Result<DownloadedPack, AppError> {
        let info = validate_pack_id(pack_id)?;
        {
            let connection = self.connection()?;
            fetch_trip(&connection, trip_id)?;
        }
        let url = pack_download_url(pack_id);
        let body = self
            .fetcher
            .fetch_text(&url)
            .map_err(|error| AppError::new(ErrorCode::PackDownloadFailed, error.message))?;
        let content = parse_pack_content(pack_id, &body)?;
        let place_count = content.places.len() as u32;
        let article_count = content.articles.len() as u32;
        // Store the re-serialized parsed content, not the raw body — so only
        // known fields are kept and the stored size can't diverge from what we
        // counted.
        let stored = serde_json::to_string(&content).map_err(|_| {
            AppError::new(
                ErrorCode::InternalUnexpected,
                "could not store the downloaded pack",
            )
        })?;
        let downloaded_at = now_rfc3339();

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO downloaded_packs
                 (trip_id, pack_id, name, region, place_count, article_count, content, downloaded_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(trip_id, pack_id) DO UPDATE SET
                   name = excluded.name,
                   region = excluded.region,
                   place_count = excluded.place_count,
                   article_count = excluded.article_count,
                   content = excluded.content,
                   downloaded_at = excluded.downloaded_at",
                params![
                    trip_id,
                    pack_id,
                    info.name,
                    info.region,
                    place_count,
                    article_count,
                    stored,
                    downloaded_at
                ],
            )
            .map_err(storage_error)?;

        Ok(DownloadedPack {
            pack_id: pack_id.to_owned(),
            name: info.name,
            region: info.region,
            place_count,
            article_count,
            downloaded_at,
        })
    }

    /// The packs downloaded for a trip, most recent first.
    pub fn list_downloaded_packs(&self, trip_id: &str) -> Result<Vec<DownloadedPack>, AppError> {
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT pack_id, name, region, place_count, article_count, downloaded_at
                 FROM downloaded_packs
                 WHERE trip_id = ?1
                 ORDER BY downloaded_at DESC, pack_id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok(DownloadedPack {
                    pack_id: row.get(0)?,
                    name: row.get(1)?,
                    region: row.get(2)?,
                    place_count: row.get(3)?,
                    article_count: row.get(4)?,
                    downloaded_at: row.get(5)?,
                })
            })
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    /// Remove a downloaded pack from a trip.
    pub fn delete_downloaded_pack(&self, trip_id: &str, pack_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        connection
            .execute(
                "DELETE FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    /// Rank the places in this trip's downloaded packs against the persona
    /// `weights`. Deterministic and transparent — no model, no network — and
    /// grounded only in already-downloaded open place data. Empty until a pack
    /// with places has been downloaded for the trip.
    pub fn get_recommendations(
        &self,
        trip_id: &str,
        weights: PersonaWeights,
    ) -> Result<Vec<Recommendation>, AppError> {
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;
        let mut statement = connection
            .prepare("SELECT content FROM downloaded_packs WHERE trip_id = ?1")
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| row.get::<_, String>(0))
            .map_err(storage_error)?;

        let mut places = Vec::new();
        for row in rows {
            let content = row.map_err(storage_error)?;
            // Stored content is our own re-serialized PackContent; skip anything
            // unreadable rather than failing the whole request.
            if let Ok(pack) = serde_json::from_str::<PackContent>(&content) {
                places.extend(pack.places);
            }
        }
        Ok(recommend_places(&places, &weights, RECOMMENDATION_LIMIT))
    }

    /// The configured state of every supported AI provider. Reports only whether
    /// a key is stored (`has_key`) plus the chosen model — never the key itself.
    pub fn list_providers(&self) -> Result<Vec<ProviderConfig>, AppError> {
        let connection = self.connection()?;
        PROVIDERS
            .iter()
            .map(|info| self.build_provider_config(&connection, info.id))
            .collect()
    }

    /// Store a BYOK API key for a cloud provider in the OS keychain. The key is
    /// consumed here and never returned, logged, or written to the database.
    pub fn set_provider_key(&self, provider: &str, key: &str) -> Result<ProviderConfig, AppError> {
        let id = validate_provider_id(provider)?;
        if !provider_info(id).key_required {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "this provider runs locally and does not use an API key",
                "field",
                "provider",
            ));
        }
        let key = validate_api_key(key)?;
        self.secrets.set(&key_account(id), &key)?;
        let connection = self.connection()?;
        self.build_provider_config(&connection, id)
    }

    /// Remove a provider's stored API key from the keychain.
    pub fn clear_provider_key(&self, provider: &str) -> Result<ProviderConfig, AppError> {
        let id = validate_provider_id(provider)?;
        self.secrets.delete(&key_account(id))?;
        let connection = self.connection()?;
        self.build_provider_config(&connection, id)
    }

    /// Set a provider's chosen model (stored locally in the database).
    pub fn set_provider_model(
        &self,
        provider: &str,
        model: &str,
    ) -> Result<ProviderConfig, AppError> {
        let id = validate_provider_id(provider)?;
        let model = validate_model_name(model)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO provider_settings (provider, model) VALUES (?1, ?2)
                 ON CONFLICT(provider) DO UPDATE SET model = excluded.model",
                params![id.as_str(), model],
            )
            .map_err(storage_error)?;
        self.build_provider_config(&connection, id)
    }

    fn build_provider_config(
        &self,
        connection: &Connection,
        id: ProviderId,
    ) -> Result<ProviderConfig, AppError> {
        let info = provider_info(id);
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        let has_key = info.key_required && self.secrets.has(&key_account(id));
        Ok(ProviderConfig {
            id,
            label: info.label.to_owned(),
            key_required: info.key_required,
            has_key,
            model,
        })
    }

    /// Read a durable app-level setting from the KV store, or `None` if unset.
    /// Values are opaque strings; callers own any JSON encoding. Used for the
    /// updater's one-time auto-check consent and skipped/staged/last-seen
    /// versions — never trip content or secrets.
    pub fn get_app_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let key = validate_setting_key(key)?;
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)
    }

    /// Write a durable app-level setting to the KV store (upsert). The value is
    /// stored verbatim and its `updated_at` refreshed on every write.
    pub fn set_app_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let key = validate_setting_key(key)?;
        let value = validate_setting_value(value)?;
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, value, now_rfc3339()],
            )
            .map_err(storage_error)?;
        Ok(())
    }

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
            if name.starts_with("pre-update-")
                && fs::remove_file(entry.path()).is_ok()
                && name.ends_with(".sqlite3")
            {
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Detect an optional on-device AI runtime (Ollama) by probing its localhost
    /// `/api/tags` endpoint. Best-effort and infallible: an unreachable runtime
    /// reports `available: false`. No inference runs and nothing leaves the
    /// device — Voyalier stays fully usable whatever this returns.
    pub fn detect_local_ai(&self) -> LocalAiStatus {
        match self.fetcher.fetch_text(OLLAMA_TAGS_URL) {
            Ok(body) => LocalAiStatus::from_tags_body(&body),
            Err(_) => LocalAiStatus::unavailable(),
        }
    }

    /// Fetch and store a dated snapshot of official FCDO travel advice for a
    /// curated country. Called only from an explicit user action — the click
    /// is the consent for this single, named, keyless fetch. The snapshot is
    /// stored verbatim with its retrieval time and replaces the trip's
    /// previous snapshot.
    pub fn fetch_travel_advice(
        &self,
        trip_id: &str,
        country_slug: &str,
    ) -> Result<TravelAdviceSnapshot, AppError> {
        let country = validate_country_slug(country_slug)?;
        // Validate the trip before any network call.
        {
            let connection = self.connection()?;
            fetch_trip(&connection, trip_id)?;
        }
        let url = format!(
            "https://www.gov.uk/api/content/foreign-travel-advice/{}",
            country.slug
        );
        let body = self.fetcher.fetch_text(&url)?;
        let snapshot = parse_fcdo_content(country, &body, &now_rfc3339())?;

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO travel_advice_snapshots
                 (trip_id, country_slug, country_name, source_url, summary, alert_status,
                  source_updated_at, change_description, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   country_slug = excluded.country_slug,
                   country_name = excluded.country_name,
                   source_url = excluded.source_url,
                   summary = excluded.summary,
                   alert_status = excluded.alert_status,
                   source_updated_at = excluded.source_updated_at,
                   change_description = excluded.change_description,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.country_slug,
                    snapshot.country_name,
                    snapshot.source_url,
                    snapshot.summary,
                    json_to_sql(&snapshot.alert_status)?,
                    snapshot.source_updated_at,
                    snapshot.change_description,
                    snapshot.retrieved_at
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Deterministic search over this trip's stored documents and confirmed
    /// facts. Purely local; ranking is transparent occurrence counting.
    pub fn search_trip(&self, trip_id: &str, query: &str) -> Result<Vec<SearchHit>, AppError> {
        let query = validate_search_query(query)?;
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;

        let mut statement = connection
            .prepare(
                "SELECT id, label, raw_content FROM source_documents
                 WHERE trip_id = ?1 ORDER BY imported_at ASC, id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    // Decrypt the sealed raw content (locked → vault/locked).
                    self.vault
                        .open_field(&row.get::<_, String>(2)?)
                        .map_err(app_to_rusqlite)?,
                ))
            })
            .map_err(storage_error)?;
        let documents: Vec<(String, String, String)> = collect_rows(rows)?;
        let searchable: Vec<SearchableDocument<'_>> = documents
            .iter()
            .map(|(id, label, content)| SearchableDocument { id, label, content })
            .collect();
        let facts = fetch_confirmed_facts(&connection, trip_id, &self.vault)?;

        Ok(search_trip_corpus(&query, &searchable, &facts))
    }

    /// Fetch and store a dated weather outlook for the trip's destination.
    /// Called only from an explicit user action — the click is the consent for
    /// two keyless requests to open-meteo.com (geocode the destination name,
    /// then the daily forecast). The snapshot replaces the trip's previous one.
    pub fn fetch_weather(&self, trip_id: &str) -> Result<WeatherSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            fetch_trip(&connection, trip_id)?
        };

        let geocode_url = format!(
            "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=en&format=json",
            percent_encode(&trip.destination)
        );
        let place = parse_geocoding_response(&self.fetcher.fetch_text(&geocode_url)?)?;

        let forecast_url = format!(
            "https://api.open-meteo.com/v1/forecast?latitude={:.5}&longitude={:.5}\
             &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max\
             &timezone=auto&forecast_days=16",
            place.latitude, place.longitude
        );
        let snapshot = parse_forecast_response(
            &place,
            &self.fetcher.fetch_text(&forecast_url)?,
            &trip.start_date,
            &trip.end_date,
            &now_rfc3339(),
        )?;

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO weather_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, days, coverage,
                  source_url, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   place_name = excluded.place_name,
                   place_region = excluded.place_region,
                   latitude = excluded.latitude,
                   longitude = excluded.longitude,
                   days = excluded.days,
                   coverage = excluded.coverage,
                   source_url = excluded.source_url,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.place_name,
                    snapshot.place_region,
                    snapshot.latitude,
                    snapshot.longitude,
                    json_to_sql(&snapshot.days)?,
                    enum_to_sql(snapshot.coverage)?,
                    snapshot.source_url,
                    snapshot.retrieved_at
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Build a redacted, shareable brief from the confirmed plan. The brief is
    /// produced by generation-time exclusion in the core, so secrets never
    /// enter the returned structure.
    pub fn get_trip_brief(&self, trip_id: &str) -> Result<TripBrief, AppError> {
        let connection = self.connection()?;
        let trip = fetch_trip(&connection, trip_id)?;
        let confirmed_facts = fetch_confirmed_facts(&connection, trip_id, &self.vault)?;
        Ok(build_trip_brief(
            &trip,
            &confirmed_facts,
            &RedactionPolicy::for_sharing(),
            &now_rfc3339(),
        ))
    }

    /// The Today view for a trip against the current date: where the trip
    /// stands, what happens today, and what's next. Deterministic and offline.
    pub fn get_today(&self, trip_id: &str) -> Result<TodayView, AppError> {
        let connection = self.connection()?;
        let trip = fetch_trip(&connection, trip_id)?;
        let facts = fetch_confirmed_facts(&connection, trip_id, &self.vault)?;
        let now = now_rfc3339();
        let today = now.get(..10).unwrap_or(now.as_str());
        Ok(build_today_view(&trip, &facts, today))
    }

    /// Build a deterministic, redacted preview of the request Voyalier would
    /// send to `provider` for this trip — the consent step before any assist
    /// call exists. Grounded only in confirmed facts, with secrets excluded by
    /// construction. No network happens here and nothing is transmitted.
    pub fn preview_assist(
        &self,
        trip_id: &str,
        provider: &str,
    ) -> Result<AssistRequestPreview, AppError> {
        let id = validate_provider_id(provider)?;
        let connection = self.connection()?;
        let trip = fetch_trip(&connection, trip_id)?;
        let confirmed_facts = fetch_confirmed_facts(&connection, trip_id, &self.vault)?;
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        Ok(build_assist_preview(
            &trip,
            &confirmed_facts,
            id,
            model.as_deref(),
            &now_rfc3339(),
        ))
    }

    /// Run assist for a trip: build the same redacted request the preview shows
    /// and send it to the chosen provider. The explicit call is the consent. For
    /// Ollama nothing leaves the device; for a cloud provider the redacted
    /// request goes to that provider using the key stored in the OS keychain —
    /// which is placed only in the outgoing auth header and is never logged,
    /// returned, or stored anywhere else. Every successful call is logged
    /// (metadata only).
    pub fn run_assist(&self, trip_id: &str, provider: &str) -> Result<AssistReply, AppError> {
        let id = validate_provider_id(provider)?;
        // Reuse the preview: identical redaction, grounding, and system prompt.
        let preview = self.preview_assist(trip_id, provider)?;
        let (model, text) = self.dispatch_assist(id, &preview)?;
        let generated_at = now_rfc3339();
        // Log that a call happened — metadata only, never the prompt or reply.
        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO assist_activity (id, trip_id, provider, model, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id("act"), trip_id, id.as_str(), model, generated_at],
            )
            .map_err(storage_error)?;
        Ok(AssistReply {
            provider: id,
            model,
            text,
            generated_at,
        })
    }

    /// Send a previewed request to `id`'s runtime and return `(model, reply)`.
    /// The BYOK key, when needed, is read from the keychain and used only here.
    fn dispatch_assist(
        &self,
        id: ProviderId,
        preview: &AssistRequestPreview,
    ) -> Result<(String, String), AppError> {
        let system = &preview.system_prompt;
        let user = &preview.user_content;
        match id {
            ProviderId::Ollama => {
                let model = preview
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_owned());
                let body = build_ollama_chat_body(&model, system, user);
                let response = self.fetcher.post_json(OLLAMA_CHAT_URL, &body, &[])?;
                Ok((model.clone(), parse_ollama_chat_reply(&response)?))
            }
            ProviderId::OpenAi => {
                let key = self.require_provider_key(id)?;
                let model = preview
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_OPENAI_MODEL.to_owned());
                let body = build_openai_chat_body(&model, system, user);
                let auth = format!("Bearer {key}");
                let response = self.fetcher.post_json(
                    OPENAI_CHAT_URL,
                    &body,
                    &[("Authorization", auth.as_str())],
                )?;
                Ok((model.clone(), parse_openai_chat_reply(&response)?))
            }
            ProviderId::Anthropic => {
                let key = self.require_provider_key(id)?;
                let model = preview
                    .model
                    .clone()
                    .unwrap_or_else(|| DEFAULT_ANTHROPIC_MODEL.to_owned());
                let body = build_anthropic_messages_body(&model, system, user);
                let response = self.fetcher.post_json(
                    ANTHROPIC_MESSAGES_URL,
                    &body,
                    &[
                        ("x-api-key", key.as_str()),
                        ("anthropic-version", ANTHROPIC_VERSION),
                    ],
                )?;
                Ok((model.clone(), parse_anthropic_reply(&response)?))
            }
        }
    }

    /// Read the BYOK key for a cloud provider, or a clear "add a key" error.
    fn require_provider_key(&self, id: ProviderId) -> Result<String, AppError> {
        self.secrets.get(&key_account(id))?.ok_or_else(|| {
            AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "add an API key for this provider under AI providers, then try again",
                "field",
                "provider",
            )
        })
    }

    /// The visible per-trip log of assist calls, most recent first. Metadata
    /// only — prompts and replies are never stored.
    pub fn list_assist_activity(
        &self,
        trip_id: &str,
    ) -> Result<Vec<AssistActivityEntry>, AppError> {
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT id, provider, model, created_at
                 FROM assist_activity
                 WHERE trip_id = ?1
                 ORDER BY created_at DESC, id DESC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(storage_error)?;
        let mut entries = Vec::new();
        for row in rows {
            let (id, provider, model, created_at) = row.map_err(storage_error)?;
            entries.push(AssistActivityEntry {
                id,
                provider: validate_provider_id(&provider)?,
                model,
                created_at,
            });
        }
        Ok(entries)
    }

    pub fn update_trip(&self, trip_id: &str, input: UpdateTripInput) -> Result<Trip, AppError> {
        let mut connection = self.connection()?;
        let current = fetch_trip(&connection, trip_id)?;
        let input = validate_update_trip(&current, input)?;
        let destination_changed = current.destination != input.destination;
        let invalidates_weather = destination_changed
            || current.start_date != input.start_date
            || current.end_date != input.end_date;
        let updated_at = now_rfc3339();
        let transaction = connection.transaction().map_err(storage_error)?;
        transaction
            .execute(
                "UPDATE trips
                 SET title = ?1, origin = ?2, destination = ?3, start_date = ?4, end_date = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![
                    input.title,
                    input.origin,
                    input.destination,
                    input.start_date,
                    input.end_date,
                    updated_at,
                    trip_id
                ],
            )
            .map_err(storage_error)?;
        if invalidates_weather {
            transaction
                .execute(
                    "DELETE FROM weather_snapshots WHERE trip_id = ?1",
                    params![trip_id],
                )
                .map_err(storage_error)?;
        }
        if destination_changed {
            transaction
                .execute(
                    "DELETE FROM travel_advice_snapshots WHERE trip_id = ?1",
                    params![trip_id],
                )
                .map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;
        fetch_trip(&connection, trip_id)
    }

    pub fn archive_trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.set_trip_status(trip_id, TripStatus::Archived)
    }

    pub fn delete_trip(&self, trip_id: &str) -> Result<(), AppError> {
        let changed = self
            .connection()?
            .execute("DELETE FROM trips WHERE id = ?1", params![trip_id])
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::TripNotFound, "trip not found"));
        }
        Ok(())
    }

    pub fn import_document(&self, input: ImportDocumentInput) -> Result<ImportResult, AppError> {
        let char_count = validate_document_content(&input.content)?;
        let hash = sha256_hex(input.content.as_bytes());
        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .unwrap_or(match input.kind {
                DocumentKind::Html => "Imported HTML",
                DocumentKind::PastedText => "Pasted text",
            })
            .to_owned();
        let document = NormalizedDocument::new(input.kind, input.content.clone());
        let (parser_id, parser_version, parsed_candidates) = parse_document(&document);
        let now = now_rfc3339();
        let document_id = new_id("doc");
        let parser_run_id = new_id("run");

        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        fetch_trip(&transaction, &input.trip_id)?;

        if let Some(existing_id) = transaction
            .query_row(
                "SELECT id FROM source_documents WHERE trip_id = ?1 AND content_hash = ?2",
                params![input.trip_id, hash],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
        {
            return Err(AppError::with_detail(
                ErrorCode::DocumentDuplicate,
                "document was already imported for this trip",
                "existingDocumentId",
                existing_id,
            ));
        }

        // The raw imported text carries the same confirmation codes and traveler
        // names as the parsed facts, so it is sealed at rest too.
        let sealed_content = self.vault.seal_field(&input.content)?;
        transaction
            .execute(
                "INSERT INTO source_documents (id, trip_id, kind, label, content_hash, char_count, imported_at, raw_content)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    document_id,
                    input.trip_id,
                    enum_to_sql(input.kind)?,
                    label,
                    hash,
                    char_count,
                    now,
                    sealed_content
                ],
            )
            .map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO parser_runs (id, trip_id, document_id, parser_id, parser_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    parser_run_id,
                    input.trip_id,
                    document_id,
                    parser_id,
                    parser_version,
                    now
                ],
            )
            .map_err(storage_error)?;

        let mut candidates = Vec::new();
        for parsed in parsed_candidates {
            let candidate = CandidateFact {
                id: new_id("cand"),
                trip_id: input.trip_id.clone(),
                document_id: document_id.clone(),
                parser_run_id: parser_run_id.clone(),
                fact_type: parsed.fact_type,
                payload: parsed.payload,
                method: parsed.method,
                field_spans: parsed.field_spans,
                warnings: parsed.warnings,
                status: CandidateStatus::Pending,
                created_at: now.clone(),
                resolved_at: None,
            };
            insert_candidate(&transaction, &candidate, &self.vault)?;
            candidates.push(candidate);
        }

        transaction.commit().map_err(storage_error)?;

        Ok(ImportResult {
            document: SourceDocument {
                id: document_id,
                trip_id: input.trip_id,
                kind: input.kind,
                label,
                content_hash: hash,
                char_count,
                imported_at: now,
            },
            parser_run_id,
            candidates,
        })
    }

    pub fn list_candidates(
        &self,
        trip_id: &str,
        status: Option<CandidateStatus>,
    ) -> Result<Vec<CandidateFact>, AppError> {
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;
        if let Some(status) = status {
            let mut statement = connection
                .prepare(
                    "SELECT id, trip_id, document_id, parser_run_id, fact_type, payload, method,
                            field_spans, warnings, status, created_at, resolved_at
                     FROM candidate_facts
                     WHERE trip_id = ?1 AND status = ?2
                     ORDER BY created_at ASC, id ASC",
                )
                .map_err(storage_error)?;
            let rows = statement
                .query_map(params![trip_id, enum_to_sql(status)?], |row| {
                    row_to_candidate(row, &self.vault)
                })
                .map_err(storage_error)?;
            collect_rows(rows)
        } else {
            let mut statement = connection
                .prepare(
                    "SELECT id, trip_id, document_id, parser_run_id, fact_type, payload, method,
                            field_spans, warnings, status, created_at, resolved_at
                     FROM candidate_facts
                     WHERE trip_id = ?1
                     ORDER BY created_at ASC, id ASC",
                )
                .map_err(storage_error)?;
            let rows = statement
                .query_map(params![trip_id], |row| row_to_candidate(row, &self.vault))
                .map_err(storage_error)?;
            collect_rows(rows)
        }
    }

    pub fn confirm_candidate(
        &self,
        input: ConfirmCandidateInput,
    ) -> Result<(CandidateFact, ConfirmedFact), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = fetch_candidate(&transaction, &input.candidate_id, &self.vault)?;
        ensure_candidate_pending(&candidate)?;

        let payload = input
            .edited_payload
            .unwrap_or_else(|| candidate.payload.clone());
        validate_fact_payload(candidate.fact_type, &payload)?;
        let corrected_fields = changed_payload_fields(&candidate.payload, &payload);
        let confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: candidate.trip_id.clone(),
            fact_type: candidate.fact_type,
            payload,
            method: candidate.method,
            candidate_id: Some(candidate.id.clone()),
            corrected_fields,
            confirmed_at: now_rfc3339(),
        };
        insert_confirmed_fact(&transaction, &confirmed, &self.vault)?;

        candidate.status = CandidateStatus::Confirmed;
        candidate.resolved_at = Some(confirmed.confirmed_at.clone());
        update_candidate_resolution(&transaction, &candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok((candidate, confirmed))
    }

    pub fn reject_candidate(&self, candidate_id: &str) -> Result<CandidateFact, AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = fetch_candidate(&transaction, candidate_id, &self.vault)?;
        ensure_candidate_pending(&candidate)?;
        candidate.status = CandidateStatus::Rejected;
        candidate.resolved_at = Some(now_rfc3339());
        update_candidate_resolution(&transaction, &candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok(candidate)
    }

    pub fn add_manual_fact(&self, input: AddManualFactInput) -> Result<ConfirmedFact, AppError> {
        validate_fact_payload(input.fact_type, &input.payload)?;
        let connection = self.connection()?;
        fetch_trip(&connection, &input.trip_id)?;
        let confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: input.trip_id,
            fact_type: input.fact_type,
            payload: input.payload,
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: now_rfc3339(),
        };
        insert_confirmed_fact(&connection, &confirmed, &self.vault)?;
        Ok(confirmed)
    }

    pub fn unconfirm_fact(&self, fact_id: &str) -> Result<(), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let candidate_id = transaction
            .query_row(
                "SELECT candidate_id FROM confirmed_facts WHERE id = ?1",
                params![fact_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::FactNotFound, "fact not found"))?;
        transaction
            .execute(
                "DELETE FROM confirmed_facts WHERE id = ?1",
                params![fact_id],
            )
            .map_err(storage_error)?;
        if let Some(candidate_id) = candidate_id {
            transaction
                .execute(
                    "UPDATE candidate_facts SET status = 'pending', resolved_at = NULL WHERE id = ?1",
                    params![candidate_id],
                )
                .map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    fn set_trip_status(&self, trip_id: &str, status: TripStatus) -> Result<Trip, AppError> {
        let connection = self.connection()?;
        let changed = connection
            .execute(
                "UPDATE trips SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![enum_to_sql(status)?, now_rfc3339(), trip_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::TripNotFound, "trip not found"));
        }
        fetch_trip(&connection, trip_id)
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.connection
            .lock()
            .map_err(|_| AppError::new(ErrorCode::StorageFailure, "storage lock poisoned"))
    }
}

/// Max lengths for the app_settings KV store. Keys are app-controlled and
/// short; values hold small metadata (consent flags, version strings), so the
/// caps are generous but bounded to keep a wayward caller from bloating the DB.
const MAX_SETTING_KEY_LEN: usize = 128;
const MAX_SETTING_VALUE_LEN: usize = 8 * 1024;

/// Validate an app_settings key: non-empty, length-bounded, and restricted to a
/// safe namespaced identifier charset so keys stay predictable and greppable.
fn validate_setting_key(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "setting key is required",
            "field",
            "key",
        ));
    }
    if trimmed.chars().count() > MAX_SETTING_KEY_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "setting key is too long",
            "field",
            "key",
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "setting key has invalid characters",
            "field",
            "key",
        ));
    }
    Ok(trimmed.to_owned())
}

/// Validate an app_settings value: length-bounded only. Content is opaque.
fn validate_setting_value(raw: &str) -> Result<String, AppError> {
    if raw.len() > MAX_SETTING_VALUE_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "setting value is too long",
            "field",
            "value",
        ));
    }
    Ok(raw.to_owned())
}

/// How many pre-update database backups to retain; older ones are pruned.
const MAX_BACKUPS: usize = 5;

/// Validate a backup label: it becomes part of the backup filename, so the same
/// safe, bounded identifier charset as setting keys applies (e.g. "v0.3.0").
fn validate_backup_label(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "backup label is required",
            "field",
            "label",
        ));
    }
    if trimmed.chars().count() > MAX_SETTING_KEY_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "backup label is too long",
            "field",
            "label",
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "backup label has invalid characters",
            "field",
            "label",
        ));
    }
    Ok(trimmed.to_owned())
}

/// Make an RFC3339 timestamp safe for a filename on every platform by replacing
/// the reserved `:` and `.` characters (Windows rejects `:` in file names).
fn filesystem_stamp(rfc3339: &str) -> String {
    rfc3339.replace([':', '.'], "-")
}

/// Delete all but the `keep` most-recent `pre-update-*.sqlite3` backups in `dir`,
/// ordered by file modification time. Best-effort: a file that can't be removed
/// is left in place rather than failing the backup.
fn prune_backups(dir: &Path, keep: usize) -> Result<(), AppError> {
    let mut backups: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(dir)
        .map_err(storage_error)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("pre-update-") && name.ends_with(".sqlite3"))
        })
        .filter_map(|path| {
            let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok()?;
            Some((modified, path))
        })
        .collect();
    // Newest first, then drop everything past the retention count.
    backups.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
    for (_, path) in backups.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn default_database_path() -> Result<PathBuf, AppError> {
    if let Ok(path) = env::var("VOYALIER_DATA_DIR") {
        return Ok(PathBuf::from(path).join(DATABASE_FILE));
    }
    let project_dirs = ProjectDirs::from("com", "voyalier", "Voyalier").ok_or_else(|| {
        AppError::new(
            ErrorCode::StorageFailure,
            "could not resolve application data directory",
        )
    })?;
    Ok(project_dirs.data_dir().join(DATABASE_FILE))
}

fn init_connection(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_documents (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('pasted_text', 'html')),
                label TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                imported_at TEXT NOT NULL,
                raw_content TEXT NOT NULL,
                UNIQUE (trip_id, content_hash)
            );

            CREATE TABLE IF NOT EXISTS parser_runs (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                parser_id TEXT NOT NULL,
                parser_version TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS candidate_facts (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                field_spans TEXT NOT NULL,
                warnings TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
                created_at TEXT NOT NULL,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS travel_advice_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                country_slug TEXT NOT NULL,
                country_name TEXT NOT NULL,
                source_url TEXT NOT NULL,
                summary TEXT NOT NULL,
                alert_status TEXT NOT NULL,
                source_updated_at TEXT,
                change_description TEXT,
                retrieved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS provider_settings (
                provider TEXT PRIMARY KEY,
                model TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS weather_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                place_name TEXT NOT NULL,
                place_region TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                days TEXT NOT NULL,
                coverage TEXT NOT NULL,
                source_url TEXT NOT NULL,
                retrieved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS confirmed_facts (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                corrected_fields TEXT NOT NULL,
                confirmed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assist_activity (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                provider TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS downloaded_packs (
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                pack_id TEXT NOT NULL,
                name TEXT NOT NULL,
                region TEXT NOT NULL,
                place_count INTEGER NOT NULL,
                article_count INTEGER NOT NULL,
                content TEXT NOT NULL,
                downloaded_at TEXT NOT NULL,
                PRIMARY KEY (trip_id, pack_id)
            );

            -- Single-row store for the optional passphrase: the data key wrapped
            -- under a passphrase-derived key, plus its salt. Present exactly when
            -- a passphrase is set. Holds no plaintext key material.
            CREATE TABLE IF NOT EXISTS vault_meta (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                salt TEXT NOT NULL,
                wrapped_key TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            -- Durable, transport-agnostic key/value store for app-level settings
            -- (e.g. the updater's one-time auto-check consent, skipped/staged/
            -- last-seen versions). Values are opaque strings; callers own any
            -- JSON encoding. Never holds trip content or secret material.
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            PRAGMA user_version = 1;
            ",
        )
        .map_err(storage_error)
}

fn parse_document(
    document: &NormalizedDocument,
) -> (&'static str, &'static str, Vec<ParsedCandidate>) {
    match document.kind {
        DocumentKind::Html => {
            let parser = JsonLdParser;
            let outcome = parser.parse(document);
            (parser.id(), parser.version(), outcome.candidates)
        }
        DocumentKind::PastedText => {
            let parser = PlaintextParser;
            let outcome = parser.parse(document);
            (parser.id(), parser.version(), outcome.candidates)
        }
    }
}

fn fetch_trip(connection: &Connection, trip_id: &str) -> Result<Trip, AppError> {
    connection
        .query_row(
            "SELECT id, title, origin, destination, start_date, end_date, status, created_at, updated_at
             FROM trips WHERE id = ?1",
            params![trip_id],
            row_to_trip,
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| AppError::new(ErrorCode::TripNotFound, "trip not found"))
}

fn fetch_candidate(
    connection: &Connection,
    candidate_id: &str,
    vault: &Vault,
) -> Result<CandidateFact, AppError> {
    connection
        .query_row(
            "SELECT id, trip_id, document_id, parser_run_id, fact_type, payload, method,
                    field_spans, warnings, status, created_at, resolved_at
             FROM candidate_facts WHERE id = ?1",
            params![candidate_id],
            |row| row_to_candidate(row, vault),
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| AppError::new(ErrorCode::CandidateNotFound, "candidate not found"))
}

fn fetch_travel_advice_snapshot(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<TravelAdviceSnapshot>, AppError> {
    connection
        .query_row(
            "SELECT country_slug, country_name, source_url, summary, alert_status,
                    source_updated_at, change_description, retrieved_at
             FROM travel_advice_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(TravelAdviceSnapshot {
                    country_slug: row.get(0)?,
                    country_name: row.get(1)?,
                    source_url: row.get(2)?,
                    summary: row.get(3)?,
                    alert_status: sql_to_json(row.get::<_, String>(4)?)?,
                    source_updated_at: row.get(5)?,
                    change_description: row.get(6)?,
                    retrieved_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

fn fetch_weather_snapshot(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<WeatherSnapshot>, AppError> {
    connection
        .query_row(
            "SELECT place_name, place_region, latitude, longitude, days, coverage,
                    source_url, retrieved_at
             FROM weather_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(WeatherSnapshot {
                    place_name: row.get(0)?,
                    place_region: row.get(1)?,
                    latitude: row.get(2)?,
                    longitude: row.get(3)?,
                    days: sql_to_json(row.get::<_, String>(4)?)?,
                    coverage: sql_to_enum(row.get::<_, String>(5)?)?,
                    source_url: row.get(6)?,
                    retrieved_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

/// The keychain account name under which a provider's API key is stored.
fn key_account(id: ProviderId) -> String {
    format!("api_key.{}", id.as_str())
}

/// Minimal RFC 3986 percent-encoding for a single query value.
fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }
    encoded
}

fn fetch_confirmed_facts(
    connection: &Connection,
    trip_id: &str,
    vault: &Vault,
) -> Result<Vec<ConfirmedFact>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, trip_id, fact_type, payload, method, candidate_id, corrected_fields, confirmed_at
             FROM confirmed_facts
             WHERE trip_id = ?1
             ORDER BY confirmed_at ASC, id ASC",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![trip_id], |row| row_to_confirmed_fact(row, vault))
        .map_err(storage_error)?;
    collect_rows(rows)
}

fn insert_candidate(
    connection: &Connection,
    candidate: &CandidateFact,
    vault: &Vault,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO candidate_facts
             (id, trip_id, document_id, parser_run_id, fact_type, payload, method, field_spans, warnings, status, created_at, resolved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                candidate.id,
                candidate.trip_id,
                candidate.document_id,
                candidate.parser_run_id,
                enum_to_sql(candidate.fact_type)?,
                vault.seal_field(&json_to_sql(&candidate.payload)?)?,
                enum_to_sql(candidate.method)?,
                vault.seal_field(&json_to_sql(&candidate.field_spans)?)?,
                json_to_sql(&candidate.warnings)?,
                enum_to_sql(candidate.status)?,
                candidate.created_at,
                candidate.resolved_at
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn insert_confirmed_fact(
    connection: &Connection,
    confirmed: &ConfirmedFact,
    vault: &Vault,
) -> Result<(), AppError> {
    // The payload carries confirmation codes and traveler names — seal it at rest.
    let sealed_payload = vault.seal_field(&json_to_sql(&confirmed.payload)?)?;
    connection
        .execute(
            "INSERT INTO confirmed_facts
             (id, trip_id, fact_type, payload, method, candidate_id, corrected_fields, confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                confirmed.id,
                confirmed.trip_id,
                enum_to_sql(confirmed.fact_type)?,
                sealed_payload,
                enum_to_sql(confirmed.method)?,
                confirmed.candidate_id,
                json_to_sql(&confirmed.corrected_fields)?,
                confirmed.confirmed_at
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn update_candidate_resolution(
    connection: &Connection,
    candidate: &CandidateFact,
) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE candidate_facts SET status = ?1, resolved_at = ?2 WHERE id = ?3",
            params![
                enum_to_sql(candidate.status)?,
                candidate.resolved_at,
                candidate.id
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn ensure_candidate_pending(candidate: &CandidateFact) -> Result<(), AppError> {
    if candidate.status != CandidateStatus::Pending {
        return Err(AppError::new(
            ErrorCode::CandidateAlreadyResolved,
            "candidate has already been resolved",
        ));
    }
    Ok(())
}

fn row_to_trip(row: &rusqlite::Row<'_>) -> rusqlite::Result<Trip> {
    Ok(Trip {
        id: row.get(0)?,
        title: row.get(1)?,
        origin: row.get(2)?,
        destination: row.get(3)?,
        start_date: row.get(4)?,
        end_date: row.get(5)?,
        status: sql_to_enum(row.get::<_, String>(6)?)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_trip_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<TripSummary> {
    let confirmed_fact_count = row.get::<_, i64>(9)?;
    let pending_candidate_count = row.get::<_, i64>(10)?;
    Ok(TripSummary {
        trip: row_to_trip(row)?,
        confirmed_fact_count: confirmed_fact_count as u32,
        pending_candidate_count: pending_candidate_count as u32,
    })
}

fn row_to_candidate(row: &rusqlite::Row<'_>, vault: &Vault) -> rusqlite::Result<CandidateFact> {
    let payload = vault
        .open_field(&row.get::<_, String>(5)?)
        .map_err(app_to_rusqlite)?;
    let field_spans = vault
        .open_field(&row.get::<_, String>(7)?)
        .map_err(app_to_rusqlite)?;
    Ok(CandidateFact {
        id: row.get(0)?,
        trip_id: row.get(1)?,
        document_id: row.get(2)?,
        parser_run_id: row.get(3)?,
        fact_type: sql_to_enum(row.get::<_, String>(4)?)?,
        payload: sql_to_json(payload)?,
        method: sql_to_enum(row.get::<_, String>(6)?)?,
        field_spans: sql_to_json(field_spans)?,
        warnings: sql_to_json(row.get::<_, String>(8)?)?,
        status: sql_to_enum(row.get::<_, String>(9)?)?,
        created_at: row.get(10)?,
        resolved_at: row.get(11)?,
    })
}

fn row_to_confirmed_fact(
    row: &rusqlite::Row<'_>,
    vault: &Vault,
) -> rusqlite::Result<ConfirmedFact> {
    let payload_json = vault
        .open_field(&row.get::<_, String>(3)?)
        .map_err(app_to_rusqlite)?;
    Ok(ConfirmedFact {
        id: row.get(0)?,
        trip_id: row.get(1)?,
        fact_type: sql_to_enum(row.get::<_, String>(2)?)?,
        payload: sql_to_json(payload_json)?,
        method: sql_to_enum(row.get::<_, String>(4)?)?,
        candidate_id: row.get(5)?,
        corrected_fields: sql_to_json(row.get::<_, String>(6)?)?,
        confirmed_at: row.get(7)?,
    })
}

fn collect_rows<T, F>(rows: rusqlite::MappedRows<'_, F>) -> Result<Vec<T>, AppError>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(rusqlite_to_app)
}

/// Convert a rusqlite error to an `AppError`, recovering the original code when a
/// row mapper wrapped one via [`app_to_rusqlite`] (e.g. a locked-vault read must
/// surface as `vault/locked`, not a generic `storage/failure`).
fn rusqlite_to_app(error: rusqlite::Error) -> AppError {
    if let rusqlite::Error::FromSqlConversionFailure(_, _, source) = &error {
        if let Some(app) = source.downcast_ref::<AppError>() {
            return app.clone();
        }
    }
    storage_error(error)
}

fn enum_to_sql<T: serde::Serialize>(value: T) -> Result<String, AppError> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .ok_or_else(|| AppError::new(ErrorCode::InternalUnexpected, "enum serialization failed"))
}

fn sql_to_enum<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_value(ValueOrString::string(value).into_json()).map_err(from_json_error)
}

fn json_to_sql<T: serde::Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_string(value).map_err(|error| {
        AppError::new(
            ErrorCode::InternalUnexpected,
            format!("failed to serialize storage json: {error}"),
        )
    })
}

fn sql_to_json<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(from_json_error)
}

struct ValueOrString(String);

impl ValueOrString {
    fn string(value: String) -> Self {
        Self(value)
    }

    fn into_json(self) -> serde_json::Value {
        serde_json::Value::String(self.0)
    }
}

fn from_json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn storage_error(error: impl std::error::Error) -> AppError {
    AppError::new(ErrorCode::StorageFailure, error.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;
    use voyalier_core::{CandidateStatus, DocumentKind, FactPayload, FactType};

    #[test]
    fn persists_trips_across_restarts() {
        let database = temp_database("persistence");
        let service = open_test_service(&database).expect("service");
        let trip = service
            .create_trip(CreateTripInput {
                title: None,
                origin: "Chicago".to_owned(),
                destination: "Kyoto".to_owned(),
                start_date: "2027-04-01".to_owned(),
                end_date: "2027-04-10".to_owned(),
            })
            .expect("trip");
        drop(service);

        let reopened = open_test_service(&database).expect("reopen");
        let detail = reopened.get_trip(&trip.id).expect("read trip");
        assert_eq!(detail.trip.destination, "Kyoto");
        cleanup_database(database);
    }

    #[test]
    fn duplicate_import_returns_existing_document_id() {
        let database = temp_database("duplicate");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let input = ImportDocumentInput {
            trip_id: trip.id,
            kind: DocumentKind::PastedText,
            label: Some("Memo".to_owned()),
            content: "Confirmation CODE7\nRoute SFO-NRT\n2027-04-02T10:00".to_owned(),
        };
        let first = service
            .import_document(input.clone())
            .expect("first import");
        let error = service.import_document(input).expect_err("duplicate");

        assert_eq!(error.code, ErrorCode::DocumentDuplicate);
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|details| details.get("existingDocumentId")),
            Some(&first.document.id)
        );
        cleanup_database(database);
    }

    #[test]
    fn unconfirm_fact_returns_linked_candidate_to_pending() {
        let database = temp_database("unconfirm");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::PastedText,
                label: None,
                content: "Confirmation HOLD9\nRoute SFO-NRT\n2027-04-02T10:00".to_owned(),
            })
            .expect("import");
        let candidate = imported.candidates.first().expect("candidate").clone();
        let (_, confirmed) = service
            .confirm_candidate(ConfirmCandidateInput {
                candidate_id: candidate.id.clone(),
                edited_payload: None,
            })
            .expect("confirm");

        assert_eq!(
            service
                .list_candidates(&trip.id, Some(CandidateStatus::Pending))
                .expect("pending")
                .len(),
            0
        );

        service.unconfirm_fact(&confirmed.id).expect("unconfirm");
        let pending = service
            .list_candidates(&trip.id, Some(CandidateStatus::Pending))
            .expect("pending");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, candidate.id);
        cleanup_database(database);
    }

    #[test]
    fn delete_trip_cascades_documents_candidates_and_facts() {
        let database = temp_database("cascade");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let fact = service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    departure_airport_iata: Some("SFO".to_owned()),
                    arrival_airport_iata: Some("NRT".to_owned()),
                    departure_local: Some("2027-04-02T10:00".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual fact");
        assert_eq!(fact.trip_id, trip.id);

        service.delete_trip(&trip.id).expect("delete");
        assert_eq!(
            service.get_trip(&trip.id).expect_err("gone").code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn get_trip_reports_overlapping_flight_conflict() {
        use voyalier_core::{ConflictSeverity, ItineraryConflictKind};

        let database = temp_database("conflicts");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        for (departure, arrival) in [
            ("2027-04-02T09:00", "2027-04-02T13:00"),
            ("2027-04-02T12:00", "2027-04-02T16:00"),
        ] {
            service
                .add_manual_fact(AddManualFactInput {
                    trip_id: trip.id.clone(),
                    fact_type: FactType::FlightSegment,
                    payload: FactPayload {
                        departure_airport_iata: Some("SFO".to_owned()),
                        arrival_airport_iata: Some("NRT".to_owned()),
                        departure_local: Some(departure.to_owned()),
                        arrival_local: Some(arrival.to_owned()),
                        ..FactPayload::default()
                    },
                })
                .expect("manual flight");
        }

        let detail = service.get_trip(&trip.id).expect("detail");
        let overlap = detail
            .itinerary_conflicts
            .iter()
            .find(|conflict| conflict.kind == ItineraryConflictKind::FlightOverlap)
            .expect("flight overlap surfaced through get_trip");
        assert_eq!(overlap.severity, ConflictSeverity::Warning);
        assert_eq!(overlap.fact_ids.len(), 2);
        // The same overlap drives the readiness rollup through get_trip.
        assert_eq!(
            detail.readiness.status,
            voyalier_core::ReadinessStatus::ActionNeeded
        );
        cleanup_database(database);
    }

    #[test]
    fn search_trip_finds_documents_and_facts_with_provenance() {
        use voyalier_core::SearchHitSource;

        let database = temp_database("search");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::PastedText,
                label: Some("Hotel email".to_owned()),
                content: "The airport shuttle leaves every 30 minutes.\nConfirmation SHTL77"
                    .to_owned(),
            })
            .expect("import");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    property_name: Some("Shuttle Side Inn".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual fact");

        let hits = service.search_trip(&trip.id, "shuttle").expect("hits");
        assert_eq!(hits.len(), 2);
        assert!(
            hits.iter()
                .any(|hit| hit.source == SearchHitSource::Document
                    && hit.record_id == imported.document.id)
        );
        assert!(
            hits.iter()
                .any(|hit| hit.source == SearchHitSource::ConfirmedFact)
        );

        // Validation and unknown-trip errors are deterministic.
        assert_eq!(
            service
                .search_trip(&trip.id, "   ")
                .expect_err("empty")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            service
                .search_trip("trip_missing", "shuttle")
                .expect_err("missing trip")
                .code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn fetch_travel_advice_stores_a_dated_snapshot_without_network_in_tests() {
        struct StubFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for StubFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                Ok(r#"{
                    "description": "FCDO travel advice for Japan.",
                    "public_updated_at": "2026-06-30T11:02:00.000+01:00",
                    "details": { "alert_status": [], "change_description": "Latest update: typhoon season." }
                }"#
                .to_owned())
            }
        }

        let database = temp_database("advice");
        let fetcher = Arc::new(StubFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Unknown slug is rejected before any fetch happens.
        assert_eq!(
            service
                .fetch_travel_advice(&trip.id, "atlantis")
                .expect_err("unknown slug")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert!(fetcher.calls.lock().expect("lock").is_empty());

        let snapshot = service
            .fetch_travel_advice(&trip.id, "japan")
            .expect("snapshot");
        assert_eq!(snapshot.country_name, "Japan");
        assert!(!snapshot.retrieved_at.is_empty());
        assert_eq!(
            fetcher.calls.lock().expect("lock").as_slice(),
            ["https://www.gov.uk/api/content/foreign-travel-advice/japan"]
        );

        // The snapshot persists and surfaces on the trip detail.
        let detail = service.get_trip(&trip.id).expect("detail");
        let stored = detail.travel_advice.expect("stored snapshot");
        assert_eq!(stored.country_slug, "japan");
        assert_eq!(stored.summary, "FCDO travel advice for Japan.");
        assert_eq!(
            stored.change_description.as_deref(),
            Some("Latest update: typhoon season.")
        );

        service
            .update_trip(
                &trip.id,
                UpdateTripInput {
                    title: None,
                    origin: None,
                    destination: Some("Oslo".to_owned()),
                    start_date: None,
                    end_date: None,
                },
            )
            .expect("destination edit");
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail after destination edit")
                .travel_advice
                .is_none()
        );

        // The curated country list is exposed for the picker.
        assert!(
            service
                .list_advice_countries()
                .iter()
                .any(|country| country.slug == "japan")
        );
        cleanup_database(database);
    }

    #[test]
    fn fetch_weather_geocodes_the_destination_and_stores_the_outlook() {
        use voyalier_core::WeatherCoverage;

        struct RoutedFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for RoutedFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                if url.contains("geocoding-api.open-meteo.com") {
                    Ok(r#"{ "results": [ { "name": "Kyoto", "latitude": 35.02107,
                        "longitude": 135.75385, "country": "Japan", "admin1": "Kyoto" } ] }"#
                        .to_owned())
                } else {
                    Ok(r#"{ "daily": {
                        "time": ["2027-04-01", "2027-04-02"],
                        "weather_code": [0, 61],
                        "temperature_2m_max": [18.4, 15.1],
                        "temperature_2m_min": [9.2, 8.7],
                        "precipitation_probability_max": [5, 80]
                    } }"#
                        .to_owned())
                }
            }
        }

        let database = temp_database("weather");
        let fetcher = Arc::new(RoutedFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service.fetch_weather(&trip.id).expect("snapshot");
        assert_eq!(snapshot.place_name, "Kyoto");
        assert_eq!(snapshot.place_region, "Kyoto, Japan");
        assert_eq!(snapshot.days.len(), 2);
        // Trip runs 2027-04-01..10 but the horizon covered only two days.
        assert_eq!(snapshot.coverage, WeatherCoverage::Partial);

        let calls = fetcher.calls.lock().expect("lock").clone();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].contains("geocoding-api.open-meteo.com"));
        assert!(calls[0].contains("name=Kyoto"));
        assert!(calls[1].contains("api.open-meteo.com/v1/forecast"));
        assert!(calls[1].contains("latitude=35.02107"));

        // Persists and rides on the trip detail.
        let detail = service.get_trip(&trip.id).expect("detail");
        let stored = detail.weather.expect("stored weather");
        assert_eq!(stored.days[1].description, "Light rain");
        assert_eq!(stored.days[1].precipitation_chance_pct, Some(80.0));

        // Cosmetic edits retain the snapshot, but place/window edits must not
        // leave weather for the old trip attached to the updated trip.
        service
            .update_trip(
                &trip.id,
                UpdateTripInput {
                    title: Some("Renamed journey".to_owned()),
                    origin: None,
                    destination: None,
                    start_date: None,
                    end_date: None,
                },
            )
            .expect("rename");
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail after rename")
                .weather
                .is_some()
        );
        service
            .update_trip(
                &trip.id,
                UpdateTripInput {
                    title: None,
                    origin: None,
                    destination: Some("Oslo".to_owned()),
                    start_date: None,
                    end_date: None,
                },
            )
            .expect("destination edit");
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail after destination edit")
                .weather
                .is_none()
        );
        cleanup_database(database);
    }

    #[test]
    fn percent_encoding_covers_spaces_and_unicode() {
        assert_eq!(percent_encode("Kyoto"), "Kyoto");
        assert_eq!(percent_encode("New York"), "New%20York");
        assert_eq!(percent_encode("São Paulo"), "S%C3%A3o%20Paulo");
    }

    #[test]
    fn provider_keys_live_in_the_secret_store_never_the_config_or_db() {
        use voyalier_core::ProviderId;

        // Provider config never touches the network.
        struct NoFetcher;
        impl AdviceFetcher for NoFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("provider configuration must not fetch");
            }
        }

        let database = temp_database("providers");
        let secrets = Arc::new(MemorySecretStore::default());
        let service =
            AppService::open_path_with_deps(&database, Arc::new(NoFetcher), secrets.clone())
                .expect("service");

        // Fresh: nothing has a key.
        let providers = service.list_providers().expect("list");
        assert_eq!(providers.len(), 3);
        assert!(providers.iter().all(|config| !config.has_key));

        // Set an OpenAI key: has_key flips, and the key is in the store only.
        let config = service
            .set_provider_key("openai", "  sk-fake-123  ")
            .expect("set key");
        assert!(config.has_key);
        assert_eq!(config.id, ProviderId::OpenAi);
        assert!(secrets.has("api_key.openai"));
        // The returned config must not carry the key anywhere.
        let serialized = serde_json::to_string(&config).expect("ser");
        assert!(!serialized.contains("sk-fake-123"));

        // Model is stored in the db, surfaced on the config.
        let config = service
            .set_provider_model("openai", "some-model")
            .expect("set model");
        assert_eq!(config.model.as_deref(), Some("some-model"));

        // Ollama is local and rejects a key.
        assert_eq!(
            service
                .set_provider_key("ollama", "nope")
                .expect_err("no key for ollama")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        // Empty key and unknown provider are validation errors.
        assert_eq!(
            service
                .set_provider_key("openai", "   ")
                .expect_err("empty")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert!(service.set_provider_key("bard", "x").is_err());

        // Clearing removes the secret; model persists.
        let config = service.clear_provider_key("openai").expect("clear");
        assert!(!config.has_key);
        assert_eq!(config.model.as_deref(), Some("some-model"));
        assert!(!secrets.has("api_key.openai"));
        cleanup_database(database);
    }

    #[test]
    fn app_settings_kv_reads_writes_upserts_and_persists() {
        let database = temp_database("app-settings");
        let service = open_test_service(&database).expect("service");

        // Unset keys read as None.
        assert_eq!(
            service.get_app_setting("updater.consent").expect("get"),
            None
        );

        // Set then read back.
        service
            .set_app_setting("updater.consent", "yes")
            .expect("set");
        assert_eq!(
            service.get_app_setting("updater.consent").expect("get"),
            Some("yes".to_owned())
        );

        // Upsert overwrites in place (no duplicate rows, latest wins).
        service
            .set_app_setting("updater.consent", "no")
            .expect("upsert");
        assert_eq!(
            service.get_app_setting("updater.consent").expect("get"),
            Some("no".to_owned())
        );

        // A distinct key is independent.
        service
            .set_app_setting("updater.skipped_version", "0.3.1")
            .expect("set");
        assert_eq!(
            service
                .get_app_setting("updater.skipped_version")
                .expect("get"),
            Some("0.3.1".to_owned())
        );

        // Values survive a reopen (durable, unencrypted app metadata).
        drop(service);
        let reopened = open_test_service(&database).expect("reopen");
        assert_eq!(
            reopened.get_app_setting("updater.consent").expect("get"),
            Some("no".to_owned())
        );

        // Key validation: empty, bad charset, and over-long are rejected.
        assert_eq!(
            reopened.get_app_setting("  ").expect_err("empty key").code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            reopened
                .set_app_setting("bad key!", "x")
                .expect_err("bad charset")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        let long_key = "k".repeat(MAX_SETTING_KEY_LEN + 1);
        assert_eq!(
            reopened
                .set_app_setting(&long_key, "x")
                .expect_err("long key")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        // Value length is bounded too.
        let long_value = "v".repeat(MAX_SETTING_VALUE_LEN + 1);
        assert_eq!(
            reopened
                .set_app_setting("updater.consent", &long_value)
                .expect_err("long value")
                .code,
            ErrorCode::ValidationInvalidInput
        );

        cleanup_database(database);
    }

    #[test]
    fn backup_database_snapshots_data_and_prunes_old_backups() {
        let database = temp_database("backup");
        let service = open_test_service(&database).expect("service");

        // Seed a trip so we can prove the backup captured real committed data.
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let info = service.backup_database("v0.3.0").expect("backup");
        assert_eq!(info.label, "v0.3.0");
        assert!(!info.created_at.is_empty());
        assert!(info.path.ends_with(".sqlite3"));
        let backup_path = PathBuf::from(&info.path);
        assert!(backup_path.exists(), "backup file must exist");

        // The backup is a readable SQLite copy that holds the seeded trip. Open
        // it immutable/read-only so the read never spawns -wal/-shm sidecars
        // (the copy inherits WAL mode) that would pollute the stray check below.
        let uri = format!("file:{}?immutable=1", backup_path.display());
        let reader = Connection::open_with_flags(
            &uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .expect("open backup");
        let count: i64 = reader
            .query_row(
                "SELECT COUNT(*) FROM trips WHERE id = ?1",
                params![trip.id],
                |row| row.get(0),
            )
            .expect("query backup");
        assert_eq!(count, 1);
        drop(reader);

        let backups_dir = database.parent().expect("parent").join("backups");
        // Retention: exceeding MAX_BACKUPS prunes the oldest to the cap, and
        // backup_database itself leaves only single .sqlite3 files (no strays).
        for n in 0..(MAX_BACKUPS + 2) {
            service
                .backup_database(&format!("v0.3.{n}"))
                .expect("extra backup");
        }
        let names: Vec<String> = fs::read_dir(&backups_dir)
            .expect("read backups")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        let snapshots = names
            .iter()
            .filter(|name| name.starts_with("pre-update-") && name.ends_with(".sqlite3"))
            .count();
        assert_eq!(
            snapshots, MAX_BACKUPS,
            "prunes down to the retention cap; saw {snapshots}: {names:?}"
        );
        assert!(
            !names
                .iter()
                .any(|name| name.ends_with("-wal") || name.ends_with("-shm")),
            "backup_database leaves no WAL/SHM strays: {names:?}"
        );

        // Label validation: empty and unsafe charsets are rejected (the label is
        // interpolated into the filename).
        assert_eq!(
            service.backup_database("  ").expect_err("empty").code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            service
                .backup_database("bad label!")
                .expect_err("charset")
                .code,
            ErrorCode::ValidationInvalidInput
        );

        cleanup_database(database);
    }

    #[test]
    fn clear_backups_removes_every_snapshot() {
        let database = temp_database("clear-backups");
        let service = open_test_service(&database).expect("service");
        service.create_trip(valid_trip_input()).expect("trip");

        // No backups yet → nothing to clear.
        assert_eq!(service.clear_backups().expect("clear empty"), 0);

        service.backup_database("v0.3.0").expect("backup 1");
        service.backup_database("v0.3.1").expect("backup 2");
        assert_eq!(service.clear_backups().expect("clear"), 2);

        // The directory is emptied of snapshots and a second clear is a no-op.
        let backups_dir = database.parent().expect("parent").join("backups");
        let remaining = fs::read_dir(&backups_dir)
            .expect("read backups")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("pre-update-")
            })
            .count();
        assert_eq!(remaining, 0);
        assert_eq!(service.clear_backups().expect("clear again"), 0);

        cleanup_database(database);
    }

    #[test]
    fn storage_identity_is_stable_so_dev_and_packaged_builds_share_data() {
        // These identifiers are compiled into the binary, so a source (dev)
        // build and the packaged app resolve to the SAME SQLite file and OS
        // keychain service — a user who tries Voyalier from source and later
        // installs the packaged app keeps their trips and vault key. Changing
        // either would silently orphan every existing user's data, so pin them:
        // a deliberate change must update this test in the same commit.
        assert_eq!(DATABASE_FILE, "voyalier.sqlite3");
        assert_eq!(KEYRING_SERVICE, "com.voyalier.keys");
        let dirs = ProjectDirs::from("com", "voyalier", "Voyalier").expect("project dirs");
        assert!(
            dirs.data_dir()
                .to_string_lossy()
                .to_lowercase()
                .contains("voyalier"),
            "data dir must encode the stable app identity: {:?}",
            dirs.data_dir()
        );
    }

    #[test]
    fn detect_local_ai_reports_models_when_reachable_and_unavailable_when_not() {
        struct OllamaFetcher {
            reachable: bool,
        }
        impl AdviceFetcher for OllamaFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                assert!(url.contains("11434"));
                if self.reachable {
                    Ok(r#"{ "models": [ { "name": "llama3.2:latest" }, { "name": "qwen2.5:7b" } ] }"#
                        .to_owned())
                } else {
                    Err(AppError::new(
                        ErrorCode::AdviceFetchFailed,
                        "connection refused",
                    ))
                }
            }
        }

        let database = temp_database("local-ai-up");
        let up =
            open_test_service_with_fetcher(&database, Arc::new(OllamaFetcher { reachable: true }))
                .expect("service");
        let status = up.detect_local_ai();
        assert!(status.available);
        assert_eq!(status.provider, "ollama");
        assert_eq!(status.models.len(), 2);
        assert_eq!(status.models[0].name, "llama3.2:latest");
        cleanup_database(database);

        let database = temp_database("local-ai-down");
        let down =
            open_test_service_with_fetcher(&database, Arc::new(OllamaFetcher { reachable: false }))
                .expect("service");
        let status = down.detect_local_ai();
        assert!(!status.available);
        assert!(status.models.is_empty());
        cleanup_database(database);
    }

    #[test]
    fn trip_brief_excludes_secrets() {
        let database = temp_database("brief");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    departure_airport_iata: Some("ORD".to_owned()),
                    arrival_airport_iata: Some("HND".to_owned()),
                    departure_local: Some("2027-04-02T10:00".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual flight");

        let brief = service.get_trip_brief(&trip.id).expect("brief");
        let serialized = serde_json::to_string(&brief).expect("serialize");
        assert!(!serialized.contains("SECRET-PNR"));
        assert!(!serialized.contains("Jamie Traveler"));
        assert!(serialized.contains("FP18"));
        assert_eq!(brief.flights.len(), 1);
        cleanup_database(database);
    }

    #[test]
    fn vault_encrypts_confirmed_fact_payloads_at_rest_and_migrates_legacy_rows() {
        struct NoNet;
        impl AdviceFetcher for NoNet {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("no network");
            }
        }

        let database = temp_database("vault");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(&database, Arc::new(NoNet), secrets.clone())
            .expect("service");
        assert!(
            service.vault.is_active(),
            "memory store makes the vault active"
        );

        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual flight");

        // At rest the payload is sealed: tagged, and free of the plaintext secrets.
        let raw: String = {
            let reader = Connection::open(&database).expect("reader");
            reader
                .query_row(
                    "SELECT payload FROM confirmed_facts WHERE trip_id = ?1",
                    params![trip.id],
                    |row| row.get(0),
                )
                .expect("payload")
        };
        assert!(
            raw.starts_with("v1:"),
            "payload should be sealed, got: {raw}"
        );
        assert!(!raw.contains("SECRET-PNR"));
        assert!(!raw.contains("Jamie Traveler"));

        // Read back through the service decrypts transparently.
        let detail = service.get_trip(&trip.id).expect("detail");
        assert!(
            detail
                .confirmed_facts
                .iter()
                .any(|fact| fact.payload.confirmation_code.as_deref() == Some("SECRET-PNR"))
        );

        // The raw imported document text is sealed at rest too — it carries the
        // same secrets, so encrypting only the parsed facts would not be enough.
        service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::PastedText,
                label: Some("Booking email".to_owned()),
                content: "Reservation RAWSECRET99 for guest Morgan Rivers.".to_owned(),
            })
            .expect("import");
        let raw_doc: String = {
            let reader = Connection::open(&database).expect("reader");
            reader
                .query_row(
                    "SELECT raw_content FROM source_documents WHERE trip_id = ?1",
                    params![trip.id],
                    |row| row.get(0),
                )
                .expect("raw_content")
        };
        assert!(
            raw_doc.starts_with("v1:"),
            "raw content should be sealed, got: {raw_doc}"
        );
        assert!(!raw_doc.contains("RAWSECRET99"));
        assert!(!raw_doc.contains("Morgan Rivers"));
        // Search reads it back through the vault transparently.
        assert!(
            !service
                .search_trip(&trip.id, "RAWSECRET99")
                .expect("search")
                .is_empty()
        );

        // A legacy plaintext row is sealed by the migration on the next open.
        {
            let writer = Connection::open(&database).expect("writer");
            writer
                .execute(
                    "INSERT INTO confirmed_facts
                     (id, trip_id, fact_type, payload, method, corrected_fields, confirmed_at)
                     VALUES ('legacy', ?1, 'lodging_stay', ?2, 'manual', '[]', '2027-01-01T00:00:00Z')",
                    params![
                        trip.id,
                        r#"{"propertyName":"Old Inn","confirmationCode":"LEGACY9"}"#
                    ],
                )
                .expect("legacy insert");
        }
        let reopened = AppService::open_path_with_deps(&database, Arc::new(NoNet), secrets.clone())
            .expect("reopen");
        let migrated: String = {
            let reader = Connection::open(&database).expect("reader");
            reader
                .query_row(
                    "SELECT payload FROM confirmed_facts WHERE id = 'legacy'",
                    [],
                    |row| row.get(0),
                )
                .expect("payload")
        };
        assert!(migrated.starts_with("v1:"), "legacy row should be sealed");
        assert!(!migrated.contains("LEGACY9"));
        // And it still reads back correctly.
        assert!(
            reopened
                .get_trip(&trip.id)
                .expect("detail")
                .confirmed_facts
                .iter()
                .any(|fact| fact.payload.confirmation_code.as_deref() == Some("LEGACY9"))
        );
        cleanup_database(database);
    }

    #[test]
    fn optional_passphrase_locks_the_vault_and_unlock_restores_access() {
        struct NoNet;
        impl AdviceFetcher for NoNet {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("no network");
            }
        }

        let database = temp_database("vault-passphrase");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(&database, Arc::new(NoNet), secrets.clone())
            .expect("service");

        // Keychain mode to start: active, no passphrase.
        let status = service.get_vault_status().expect("status");
        assert!(status.active && !status.protected && !status.locked);

        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual flight");

        // A too-short passphrase is rejected before any key is derived.
        assert_eq!(
            service
                .set_vault_passphrase("short")
                .expect_err("short")
                .code,
            ErrorCode::ValidationInvalidInput
        );

        // Setting a passphrase protects the key and removes it from the keychain,
        // but the vault stays unlocked for this session.
        let status = service
            .set_vault_passphrase("correct horse battery")
            .expect("set passphrase");
        assert!(status.active && status.protected && !status.locked);
        assert!(
            !secrets.has(VAULT_KEY_ACCOUNT),
            "the raw key must leave the keychain once a passphrase guards it"
        );
        assert_eq!(
            service
                .set_vault_passphrase("another one entirely")
                .expect_err("already set")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        // Still readable this session.
        assert!(service.get_trip(&trip.id).is_ok());

        // Reopening finds the wrapped key: the vault opens LOCKED and refuses to
        // read or write sealed data until unlocked.
        let reopened = AppService::open_path_with_deps(&database, Arc::new(NoNet), secrets.clone())
            .expect("reopen");
        let status = reopened.get_vault_status().expect("status");
        assert!(status.protected && status.locked && !status.active);
        assert_eq!(
            reopened.get_trip(&trip.id).expect_err("locked read").code,
            ErrorCode::VaultLocked
        );
        assert_eq!(
            reopened
                .add_manual_fact(AddManualFactInput {
                    trip_id: trip.id.clone(),
                    fact_type: FactType::LodgingStay,
                    payload: FactPayload::default(),
                })
                .expect_err("locked write")
                .code,
            ErrorCode::VaultLocked
        );
        // list_trips only counts rows, so it still works while locked.
        assert!(reopened.list_trips().is_ok());

        // Wrong passphrase is rejected; the correct one unlocks for the session.
        assert_eq!(
            reopened
                .unlock_vault("not the passphrase")
                .expect_err("wrong")
                .code,
            ErrorCode::VaultPassphraseIncorrect
        );
        let status = reopened
            .unlock_vault("correct horse battery")
            .expect("unlock");
        assert!(status.active && status.protected && !status.locked);
        assert!(
            reopened
                .get_trip(&trip.id)
                .expect("read after unlock")
                .confirmed_facts
                .iter()
                .any(|fact| fact.payload.confirmation_code.as_deref() == Some("SECRET-PNR"))
        );

        // Removing the passphrase returns the key to the keychain (transparent
        // unlock again) and a fresh open needs no passphrase.
        let status = reopened
            .remove_vault_passphrase("correct horse battery")
            .expect("remove");
        assert!(status.active && !status.protected && !status.locked);
        assert!(secrets.has(VAULT_KEY_ACCOUNT));
        let reopened_plain =
            AppService::open_path_with_deps(&database, Arc::new(NoNet), secrets.clone())
                .expect("reopen plain");
        assert!(reopened_plain.get_vault_status().expect("status").active);
        assert!(reopened_plain.get_trip(&trip.id).is_ok());

        cleanup_database(database);
    }

    #[test]
    fn get_today_builds_a_view_for_the_current_date() {
        let database = temp_database("today");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let view = service.get_today(&trip.id).expect("today");
        // Reference date is a YYYY-MM-DD (clock-independent structural check).
        assert_eq!(view.reference_date.len(), 10);
        assert_eq!(view.reference_date.matches('-').count(), 2);

        assert_eq!(
            service.get_today("nope").expect_err("missing").code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn preview_assist_excludes_secrets_and_reflects_chosen_provider_and_model() {
        let database = temp_database("assist-preview");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    departure_airport_iata: Some("ORD".to_owned()),
                    arrival_airport_iata: Some("HND".to_owned()),
                    departure_local: Some("2027-04-02T10:00".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual flight");
        service
            .set_provider_model("openai", "gpt-x")
            .expect("set model");

        let preview = service.preview_assist(&trip.id, "openai").expect("preview");
        let serialized = serde_json::to_string(&preview).expect("serialize");
        assert!(!serialized.contains("SECRET-PNR"));
        assert!(!serialized.contains("Jamie Traveler"));
        assert!(preview.user_content.contains("FP18"));
        assert!(preview.leaves_device);
        assert_eq!(preview.model.as_deref(), Some("gpt-x"));

        // Unknown provider is a validation error; unknown trip is TripNotFound.
        assert_eq!(
            service
                .preview_assist(&trip.id, "bard")
                .expect_err("bad provider")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            service
                .preview_assist("trip_missing", "openai")
                .expect_err("missing trip")
                .code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn run_assist_posts_a_redacted_request_to_ollama_and_returns_the_reply() {
        // Captures the POST so the test never needs a running Ollama.
        struct OllamaStub {
            last_body: std::sync::Mutex<String>,
        }
        impl AdviceFetcher for OllamaStub {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("assist must POST, not GET");
            }
            fn post_json(
                &self,
                url: &str,
                body: &str,
                _headers: &[(&str, &str)],
            ) -> Result<String, AppError> {
                assert_eq!(url, "http://localhost:11434/api/chat");
                *self.last_body.lock().expect("lock") = body.to_owned();
                Ok(r#"{ "message": { "role": "assistant", "content": "Your Kyoto plans look ready." } }"#
                    .to_owned())
            }
        }

        let database = temp_database("run-assist");
        let stub = Arc::new(OllamaStub {
            last_body: std::sync::Mutex::new(String::new()),
        });
        let service = open_test_service_with_fetcher(&database, stub.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    departure_airport_iata: Some("ORD".to_owned()),
                    arrival_airport_iata: Some("HND".to_owned()),
                    departure_local: Some("2027-04-02T10:00".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual flight");

        let reply = service.run_assist(&trip.id, "ollama").expect("reply");
        assert_eq!(reply.text, "Your Kyoto plans look ready.");
        assert_eq!(reply.model, "llama3.2");
        assert!(!reply.generated_at.is_empty());

        // The posted body carried the redacted itinerary, not the secrets.
        let body = stub.last_body.lock().expect("lock").clone();
        assert!(body.contains("FP18"));
        assert!(!body.contains("SECRET-PNR"));
        assert!(!body.contains("Jamie Traveler"));

        // The successful call was logged (metadata only).
        let activity = service.list_assist_activity(&trip.id).expect("activity");
        assert_eq!(activity.len(), 1);
        assert_eq!(activity[0].provider, ProviderId::Ollama);
        assert_eq!(activity[0].model, "llama3.2");
        cleanup_database(database);
    }

    #[test]
    fn run_assist_sends_cloud_requests_with_the_key_only_in_the_auth_header() {
        // Captures the outgoing request; the key must ride only in the header.
        // (url, body, headers)
        type Captured = (String, String, Vec<(String, String)>);
        struct CloudStub {
            last: std::sync::Mutex<Captured>,
        }
        impl AdviceFetcher for CloudStub {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("cloud assist must POST, not GET");
            }
            fn post_json(
                &self,
                url: &str,
                body: &str,
                headers: &[(&str, &str)],
            ) -> Result<String, AppError> {
                *self.last.lock().expect("lock") = (
                    url.to_owned(),
                    body.to_owned(),
                    headers
                        .iter()
                        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                        .collect(),
                );
                if url.contains("openai") {
                    Ok(
                        r#"{ "choices": [{ "message": { "content": "OpenAI reply." } }] }"#
                            .to_owned(),
                    )
                } else {
                    Ok(
                        r#"{ "content": [{ "type": "text", "text": "Anthropic reply." }] }"#
                            .to_owned(),
                    )
                }
            }
        }

        let database = temp_database("run-assist-cloud");
        let stub = Arc::new(CloudStub {
            last: std::sync::Mutex::new((String::new(), String::new(), Vec::new())),
        });
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(&database, stub.clone(), secrets.clone())
            .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("flight");

        // Without a stored key, a cloud run is refused before any request.
        assert_eq!(
            service
                .run_assist(&trip.id, "openai")
                .expect_err("no key")
                .code,
            ErrorCode::ValidationInvalidInput
        );

        // OpenAI: key rides in the Authorization header, never the body.
        service
            .set_provider_key("openai", "sk-openai-live")
            .expect("set key");
        let reply = service.run_assist(&trip.id, "openai").expect("reply");
        assert_eq!(reply.text, "OpenAI reply.");
        assert_eq!(reply.provider, ProviderId::OpenAi);
        let (url, body, headers) = stub.last.lock().expect("lock").clone();
        assert!(url.contains("api.openai.com"));
        assert!(body.contains("FP18"));
        assert!(!body.contains("SECRET-PNR"));
        assert!(!body.contains("sk-openai-live"));
        assert!(headers.contains(&(
            "Authorization".to_owned(),
            "Bearer sk-openai-live".to_owned()
        )));

        // Anthropic: key in x-api-key plus the version header.
        service
            .set_provider_key("anthropic", "sk-anthropic-live")
            .expect("set key");
        let reply = service.run_assist(&trip.id, "anthropic").expect("reply");
        assert_eq!(reply.text, "Anthropic reply.");
        let (_, body, headers) = stub.last.lock().expect("lock").clone();
        assert!(!body.contains("sk-anthropic-live"));
        assert!(headers.contains(&("x-api-key".to_owned(), "sk-anthropic-live".to_owned())));
        assert!(headers.iter().any(|(name, _)| name == "anthropic-version"));

        // Both successful calls are logged, and the log never carries a key.
        let activity = service.list_assist_activity(&trip.id).expect("activity");
        assert_eq!(activity.len(), 2);
        let serialized = serde_json::to_string(&activity).expect("ser");
        assert!(!serialized.contains("sk-openai-live"));
        assert!(!serialized.contains("sk-anthropic-live"));
        cleanup_database(database);
    }

    #[test]
    fn run_assist_surfaces_provider_error_bodies() {
        // A provider returns an error JSON body (as it does on 401/429/etc.);
        // post_json passes the body through and the parser surfaces the cause.
        struct ErrorStub;
        impl AdviceFetcher for ErrorStub {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("must POST");
            }
            fn post_json(
                &self,
                _url: &str,
                _body: &str,
                _headers: &[(&str, &str)],
            ) -> Result<String, AppError> {
                Ok(r#"{ "error": { "message": "Incorrect API key provided" } }"#.to_owned())
            }
        }

        let database = temp_database("assist-provider-error");
        let secrets = Arc::new(MemorySecretStore::default());
        let service =
            AppService::open_path_with_deps(&database, Arc::new(ErrorStub), secrets.clone())
                .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service.set_provider_key("openai", "sk-bad").expect("key");

        let error = service
            .run_assist(&trip.id, "openai")
            .expect_err("provider error");
        assert_eq!(error.code, ErrorCode::AssistFailed);
        assert!(
            error.message.contains("Incorrect API key provided"),
            "provider cause should surface, got: {}",
            error.message
        );
        // A failed call is not logged (nothing completed).
        assert!(
            service
                .list_assist_activity(&trip.id)
                .expect("activity")
                .is_empty()
        );
        cleanup_database(database);
    }

    #[test]
    fn download_pack_stores_contents_and_lists_them_per_trip() {
        struct PackFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for PackFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                Ok(r#"{
                    "packId": "us-nashville",
                    "places": [
                        { "name": "Ryman Auditorium", "category": "venue", "lat": 36.16, "lon": -86.78 },
                        { "name": "Centennial Park", "category": "park", "lat": 36.15, "lon": -86.81 }
                    ],
                    "articles": [
                        { "title": "Nashville", "sourceUrl": "https://en.wikivoyage.org/wiki/Nashville", "text": "Music City." }
                    ]
                }"#
                .to_owned())
            }
        }

        let database = temp_database("packs-download");
        let fetcher = Arc::new(PackFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Unknown pack is rejected before any fetch happens.
        assert_eq!(
            service
                .download_pack(&trip.id, "atlantis")
                .expect_err("unknown pack")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert!(fetcher.calls.lock().expect("lock").is_empty());

        let pack = service
            .download_pack(&trip.id, "us-nashville")
            .expect("download");
        assert_eq!(pack.name, "Nashville");
        assert_eq!(pack.place_count, 2);
        assert_eq!(pack.article_count, 1);
        assert_eq!(
            fetcher.calls.lock().expect("lock").as_slice(),
            ["https://github.com/udhawan97/Voyalier/releases/download/packs-v1/us-nashville.json"]
        );

        let downloaded = service.list_downloaded_packs(&trip.id).expect("list");
        assert_eq!(downloaded.len(), 1);
        assert_eq!(downloaded[0].pack_id, "us-nashville");

        service
            .delete_downloaded_pack(&trip.id, "us-nashville")
            .expect("delete");
        assert!(
            service
                .list_downloaded_packs(&trip.id)
                .expect("list")
                .is_empty()
        );
        cleanup_database(database);
    }

    #[test]
    fn get_recommendations_ranks_downloaded_pack_places_by_persona() {
        struct PackFetcher;
        impl AdviceFetcher for PackFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Ok(r#"{ "packId": "us-nashville", "articles": [], "places": [
                    { "name": "Hattie B's", "category": "restaurant", "lat": 36.16, "lon": -86.79 },
                    { "name": "Frist Museum", "category": "art_museum", "lat": 36.15, "lon": -86.78 },
                    { "name": "Green Park", "category": "public_park", "lat": 36.14, "lon": -86.80 }
                ] }"#
                .to_owned())
            }
        }

        let database = temp_database("recommendations");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(PackFetcher)).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // No packs downloaded yet → no recommendations.
        assert!(
            service
                .get_recommendations(&trip.id, PersonaWeights::balanced())
                .expect("recs")
                .is_empty()
        );

        service
            .download_pack(&trip.id, "us-nashville")
            .expect("download");

        // A food-forward persona ranks the restaurant first.
        let weights = PersonaWeights {
            food: 1.0,
            culture: 0.3,
            nature: 0.0,
            nightlife: 0.0,
            shopping: 0.0,
        };
        let recs = service
            .get_recommendations(&trip.id, weights)
            .expect("recs");
        assert_eq!(recs.first().map(|r| r.name.as_str()), Some("Hattie B's"));
        // Nature weight is zero → the park is excluded.
        assert!(!recs.iter().any(|r| r.name == "Green Park"));
        assert!(recs.iter().all(|r| r.source == "Overture Maps"));
        cleanup_database(database);
    }

    #[test]
    fn download_pack_rejects_a_mismatched_body() {
        struct WrongPackFetcher;
        impl AdviceFetcher for WrongPackFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Ok(r#"{ "packId": "us-hi-maui", "places": [], "articles": [] }"#.to_owned())
            }
        }

        let database = temp_database("packs-mismatch");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(WrongPackFetcher)).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        assert_eq!(
            service
                .download_pack(&trip.id, "us-nashville")
                .expect_err("mismatch")
                .code,
            ErrorCode::PackDownloadFailed
        );
        cleanup_database(database);
    }

    fn valid_trip_input() -> CreateTripInput {
        CreateTripInput {
            title: None,
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: "2027-04-01".to_owned(),
            end_date: "2027-04-10".to_owned(),
        }
    }

    /// Open a service for tests with an in-memory secret store, so tests never
    /// touch (or mutate) the real OS keychain — which is both slow and a real
    /// side effect now that the vault reads/writes its data key there on open.
    /// The vault is active (a key is available), exercising the encrypted path.
    fn open_test_service(database: &Path) -> Result<AppService, AppError> {
        AppService::open_path_with_deps(
            database,
            Arc::new(UreqFetcher),
            Arc::new(MemorySecretStore::default()),
        )
    }

    fn open_test_service_with_fetcher(
        database: &Path,
        fetcher: Arc<dyn AdviceFetcher>,
    ) -> Result<AppService, AppError> {
        AppService::open_path_with_deps(database, fetcher, Arc::new(MemorySecretStore::default()))
    }

    fn temp_database(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("voyalier-app-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join("voyalier.sqlite3")
    }

    fn cleanup_database(database: PathBuf) {
        if let Some(parent) = database.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
