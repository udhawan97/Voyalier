use std::{
    env, fs,
    io::{Read, Seek, SeekFrom},
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
    ASSIST_DRAFT_LODGING_DATES, ASSIST_SYSTEM_PROMPT, AddManualFactInput, AddPackingItemInput,
    AdvisoryEntry, AdvisoryPanel, AdvisorySource, AiPrompt, AiPromptKind, AiPromptSettings,
    AirQualityDay, AppError, AssistActivityEntry, AssistDraftResult, AssistReply,
    AssistRequestPreview, AstroDay, AttributedPackPlace, CandidateFact, CandidateStatus,
    ClimateNormals, ConfirmCandidateInput, ConfirmedFact, CreateTripInput, CreateTripItemInput,
    DRAFT_LODGING_DATES_SYSTEM_PROMPT, DestinationFactsSnapshot, DocumentContent, DocumentKind,
    DocumentParse, DocumentSummary, DownloadedPack, ErrorCode, ExtractionMethod, FCDO_COUNTRIES,
    FIELD_SUGGESTION_LIMIT, FactPayload, FactType, FcdoCountry, FieldSuggestion, GeocodedPlace,
    HealthNotice, HealthResponse, ImportDocumentInput, ImportResult, IntelligenceMode,
    InterestProfile, KeyValidation, LocalAiStatus, LocalModelPullResult, LodgingDateProposal,
    MAX_AI_PROMPT_LEN, MAX_NOTES_CHARS, MAX_OFFLINE_MAP_BYTES, OLLAMA_PULL_URL, OLLAMA_TAGS_URL,
    OfflineMapArchive, OfflineMapChunk, OfflineMapDescriptor, PROVIDERS, PackContent, PackInfo,
    PackSuggestion, PackingItem, PersonaWeights, PlaceSummary, ProviderConfig, ProviderId,
    PublicHolidaysSnapshot, Recommendation, RedactionPolicy, SEARCH_SUGGESTION_LIMIT,
    SavePlaceInput, SavedPlace, SearchHit, SearchableDocument, SetInterestProfileInput,
    SourceDocument, SourceState, SourceStatus, SuggestionSource, TodayView, Trip, TripAssessment,
    TripBrief, TripDetail, TripItem, TripNotes, TripStatus, TripSummary, UpdatePackingItemInput,
    UpdateSavedPlaceInput, UpdateTripInput, UpdateTripItemInput, WarningCode, WeatherAlert,
    WeatherSnapshot, WorkspaceSearchHit, WorkspaceSearchRecord, WorkspaceSearchSource,
    advisory_country, archive_window, assess_trip, build_assist_preview, build_assist_request,
    build_draft_preview, build_key_validation_request, build_packing_list, build_pull_body,
    build_today_view, build_trip_brief, changed_payload_fields, compute_astro_day, country_facts,
    detect_planned_item_conflicts, entry_from_fcdo, estimate_tokens, geocode, holidays_within,
    interpret_key_validation, interpret_pull_response, nearest_airports, new_id,
    notices_for_country, now_rfc3339, offline_map_download_url, pack_catalog, pack_download_url,
    parse_air_quality, parse_assist_reply, parse_ca_gac, parse_cdc_notices, parse_climate_normals,
    parse_de_aa, parse_ecb_rates, parse_fcdo_content, parse_forecast_response, parse_import,
    parse_lodging_dates_reply, parse_nws_alerts, parse_pack_content, parse_us_state, place_summary,
    provider_info, public_holidays, rank_field_suggestions, recommend_attributed_places,
    search_cities, search_trip_corpus, search_workspace_corpus, suggest_packs,
    suggest_search_terms, time_difference, tipping_guidance, validate_api_key,
    validate_country_slug, validate_create_trip, validate_create_trip_item, validate_fact_payload,
    validate_model_name, validate_pack_id, validate_packing_label, validate_planning_notes,
    validate_provider_id, validate_search_query, validate_update_trip, world_heritage_near,
};
use voyalier_core::{
    BACKUP_FORMAT_VERSION, BackupManifest, VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN,
    VaultStatus, derive_key as vault_derive_key, open as vault_open, open_backup,
    seal as vault_seal, seal_backup,
};

const DATABASE_FILE: &str = "voyalier.sqlite3";
const MAX_OFFLINE_MAP_RANGE: u32 = 4 * 1024 * 1024;

/// One imported document as `(id, label, decrypted text)`.
mod records;
mod snapshots;

use records::{Records, SEALED_COLUMNS, ensure_candidate_pending};
use snapshots::invalidate_after_trip_edit;

type DocumentText = (String, String, String);

struct OwnedWorkspaceSearchRecord {
    source: WorkspaceSearchSource,
    trip_id: String,
    trip_title: String,
    record_id: String,
    label: String,
    text: String,
}

/// Fetches a URL's body as text. The only network seam in the application
/// layer — injectable so every test runs without touching the network.
pub trait AdviceFetcher: Send + Sync {
    fn fetch_text(&self, url: &str) -> Result<String, AppError>;

    /// Fetch a bounded binary response. Offline basemaps use this only after an
    /// explicit pack-download click. The default keeps text-only test fetchers
    /// source-compatible and fails closed if binary fetching was not provided.
    fn fetch_bytes(&self, _url: &str, _limit: usize) -> Result<Vec<u8>, AppError> {
        Err(AppError::new(
            ErrorCode::PackDownloadFailed,
            "this fetcher does not support binary pack assets",
        ))
    }

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

    /// Issue a GET and return only its HTTP status code, following the same
    /// default-error pattern as `post_json`. Used to validate a BYOK key against
    /// a provider's cheap read-only endpoint without reading (or logging) a body.
    fn get_status(&self, _url: &str, _headers: &[(&str, &str)]) -> Result<u16, AppError> {
        Err(AppError::new(
            ErrorCode::AssistFailed,
            "this fetcher does not support status checks",
        ))
    }

    /// POST a JSON body with no timeout ceiling, for operations that can legitimately
    /// run for many minutes — pulling a multi-gigabyte on-device model. Defaults to
    /// an error like the other optional methods so GET-only test stubs are unaffected.
    fn post_json_long(&self, _url: &str, _body: &str) -> Result<String, AppError> {
        Err(AppError::new(
            ErrorCode::AssistFailed,
            "this fetcher does not support long POST",
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

    fn fetch_bytes(&self, url: &str, limit: usize) -> Result<Vec<u8>, AppError> {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(120)))
            .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
            .build();
        let agent: ureq::Agent = config.into();
        let mut response = agent.get(url).call().map_err(pack_fetch_failure)?;
        response
            .body_mut()
            .with_config()
            .limit(limit as u64)
            .read_to_vec()
            .map_err(pack_fetch_failure)
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

    fn get_status(&self, url: &str, headers: &[(&str, &str)]) -> Result<u16, AppError> {
        // A non-2xx here is a *result* (e.g. 401 = bad key), not a transport error,
        // so map only genuine reach failures to an error and report the code as-is.
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(15)))
            .http_status_as_error(false)
            .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
            .build();
        let agent: ureq::Agent = config.into();
        let mut request = agent.get(url);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = request.call().map_err(assist_transport_failure)?;
        Ok(response.status().as_u16())
    }

    fn post_json_long(&self, url: &str, body: &str) -> Result<String, AppError> {
        // Pulling a model streams gigabytes and can take many minutes; allow a
        // generous ceiling rather than none so a truly stuck request still ends.
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(30 * 60)))
            .http_status_as_error(false)
            .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
            .build();
        let agent: ureq::Agent = config.into();
        let mut response = agent
            .post(url)
            .header("Content-Type", "application/json")
            .send(body)
            .map_err(assist_transport_failure)?;
        response
            .body_mut()
            .read_to_string()
            .map_err(assist_transport_failure)
    }
}

fn assist_transport_failure(cause: ureq::Error) -> AppError {
    // A reachability failure, distinct from a run that completed with bad output —
    // so the UI can say "is your AI running?" instead of a generic "didn't finish".
    AppError::new(
        ErrorCode::AssistUnreachable,
        format!("could not reach the AI provider: {cause}"),
    )
}

/// Re-flavor a fetch failure as a weather error so the weather panel never wears
/// travel-advice wording.
fn weather_network_failure(_cause: AppError) -> AppError {
    AppError::new(
        ErrorCode::WeatherFetchFailed,
        "Voyalier couldn't reach the weather service. Check your connection and try again.",
    )
}

fn fetch_failure(cause: ureq::Error) -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        format!("could not reach the official source: {cause}"),
    )
}

fn pack_fetch_failure(cause: ureq::Error) -> AppError {
    AppError::new(
        ErrorCode::PackDownloadFailed,
        format!("could not download the city pack asset: {cause}"),
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

/// What a [`FakeFetcher`] route answers with.
#[derive(Clone, Debug)]
pub enum Reply {
    Text(String),
    Bytes(Vec<u8>),
    Status(u16),
    Fail(ErrorCode, String),
}

/// In-memory fetcher for tests: the network seam's fake, beside the keychain's.
///
/// [`SecretStore`] has shipped [`MemorySecretStore`] since the beginning, so no
/// test hand-writes a keychain. [`AdviceFetcher`] shipped nothing, so every test
/// that needed one wrote its own — the same route-on-a-URL-substring shape, once
/// per test, under a different name each time.
///
/// Routes match on a URL substring, **first registered wins**, so a specific
/// route registered before a general one takes precedence. An unrouted URL is an
/// error naming the URL rather than an empty body: a test that reaches for a
/// source it did not declare should say so, not quietly read "".
///
/// Every request is recorded, so a test can assert what was actually fetched
/// rather than only what came back.
#[derive(Default)]
pub struct FakeFetcher {
    routes: Mutex<Vec<(String, Reply)>>,
    calls: Mutex<Vec<String>>,
    posted: Mutex<Vec<String>>,
    forbidden: bool,
}

impl FakeFetcher {
    pub fn new() -> Self {
        Self::default()
    }

    /// A fetcher that panics on any request, for the paths that must not reach
    /// the network at all.
    ///
    /// Returning an error would be the weaker claim: the code under test could
    /// swallow it and the test would still pass. Panicking names the URL that
    /// was not supposed to be requested.
    pub fn offline() -> Self {
        Self {
            forbidden: true,
            ..Self::default()
        }
    }

    /// Answer any URL containing `needle` with `body`.
    pub fn route(self, needle: &str, body: &str) -> Self {
        self.set(needle, Reply::Text(body.to_owned()));
        self
    }

    /// Answer any URL containing `needle` with a failure.
    pub fn route_fail(self, needle: &str, code: ErrorCode, message: &str) -> Self {
        self.set(needle, Reply::Fail(code, message.to_owned()));
        self
    }

    /// Answer any URL containing `needle` with a bare HTTP status.
    pub fn route_status(self, needle: &str, status: u16) -> Self {
        self.set(needle, Reply::Status(status));
        self
    }

    /// Answer any URL containing `needle` with bytes.
    pub fn route_bytes(self, needle: &str, bytes: Vec<u8>) -> Self {
        self.set(needle, Reply::Bytes(bytes));
        self
    }

    /// Add or replace a route after construction, so a test can take a source
    /// offline (or bring it back) partway through without a second fetcher.
    pub fn set(&self, needle: &str, reply: Reply) {
        let mut routes = self.routes.lock().expect("routes");
        match routes.iter_mut().find(|(known, _)| known == needle) {
            Some((_, existing)) => *existing = reply,
            None => routes.push((needle.to_owned(), reply)),
        }
    }

    /// Every URL requested, in order.
    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls").clone()
    }

    /// Whether any request's URL contained `needle`.
    pub fn called(&self, needle: &str) -> bool {
        self.calls().iter().any(|url| url.contains(needle))
    }

    /// Every JSON body posted, in order.
    pub fn posted(&self) -> Vec<String> {
        self.posted.lock().expect("posted").clone()
    }

    fn reply_for(&self, url: &str) -> Reply {
        assert!(
            !self.forbidden,
            "the code under test must not reach the network, but requested {url}"
        );
        self.calls.lock().expect("calls").push(url.to_owned());
        self.routes
            .lock()
            .expect("routes")
            .iter()
            .find(|(needle, _)| url.contains(needle.as_str()))
            .map(|(_, reply)| reply.clone())
            .unwrap_or_else(|| {
                Reply::Fail(ErrorCode::AdviceFetchFailed, format!("no route for {url}"))
            })
    }

    fn text_for(&self, url: &str) -> Result<String, AppError> {
        match self.reply_for(url) {
            Reply::Text(body) => Ok(body),
            Reply::Fail(code, message) => Err(AppError::new(code, message)),
            Reply::Bytes(_) | Reply::Status(_) => Err(AppError::new(
                ErrorCode::AdviceFetchFailed,
                format!("route for {url} does not answer with text"),
            )),
        }
    }
}

impl AdviceFetcher for FakeFetcher {
    fn fetch_text(&self, url: &str) -> Result<String, AppError> {
        self.text_for(url)
    }

    fn fetch_bytes(&self, url: &str, _limit: usize) -> Result<Vec<u8>, AppError> {
        match self.reply_for(url) {
            Reply::Bytes(bytes) => Ok(bytes),
            Reply::Text(body) => Ok(body.into_bytes()),
            Reply::Fail(code, message) => Err(AppError::new(code, message)),
            Reply::Status(_) => Err(AppError::new(
                ErrorCode::PackDownloadFailed,
                format!("route for {url} does not answer with bytes"),
            )),
        }
    }

    fn post_json(
        &self,
        url: &str,
        body: &str,
        _headers: &[(&str, &str)],
    ) -> Result<String, AppError> {
        self.posted.lock().expect("posted").push(body.to_owned());
        self.text_for(url)
    }

    fn get_status(&self, url: &str, _headers: &[(&str, &str)]) -> Result<u16, AppError> {
        match self.reply_for(url) {
            Reply::Status(status) => Ok(status),
            Reply::Fail(code, message) => Err(AppError::new(code, message)),
            Reply::Text(_) | Reply::Bytes(_) => Err(AppError::new(
                ErrorCode::AssistFailed,
                format!("route for {url} does not answer with a status"),
            )),
        }
    }

    fn post_json_long(&self, url: &str, body: &str) -> Result<String, AppError> {
        self.posted.lock().expect("posted").push(body.to_owned());
        self.text_for(url)
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

    /// The data key held in memory, so a backup can re-wrap it under the user's
    /// backup passphrase. `None` when the vault is locked **or** inactive —
    /// callers must check [`Vault::status`] to tell those apart, because a
    /// locked vault has a key it cannot reach while an inactive one has none.
    fn active_data_key(&self) -> Option<[u8; VAULT_KEY_LEN]> {
        self.snapshot().key
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

/// What a staged restore says about the backup it came from, so the UI can show
/// the traveler what they are about to replace their workspace with. Metadata
/// only — never any trip content.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestorePreview {
    /// When the backup was taken.
    pub created_at: String,
    /// The Voyalier version that wrote it.
    pub app_version: String,
    /// The schema the snapshot carries; never newer than this build understands.
    pub schema_version: i64,
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
        // A staged restore is applied before the database is opened, so the swap
        // never races an open connection.
        let restored = apply_pending_restore(secrets.as_ref(), path)?;
        let connection = Connection::open(path).map_err(storage_error)?;
        init_connection(&connection)?;
        if restored {
            // The restored database may carry the source machine's passphrase
            // wrap, which would open the vault locked against a key that lives
            // on a machine the traveler no longer has. Restore lands in keychain
            // mode against the key the backup brought; a passphrase is re-set
            // here if the traveler wants one.
            clear_vault_wrap(&connection)?;
        }
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
        self.records(&connection).trip_summaries()
    }

    pub fn get_trip(&self, trip_id: &str) -> Result<TripDetail, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let confirmed_facts = self.records(&connection).confirmed_facts(trip_id)?;
        let pending_candidate_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM candidate_facts WHERE trip_id = ?1 AND status = 'pending'",
                params![trip_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(storage_error)?;
        let pending_candidate_count = pending_candidate_count as u32;
        let trip_items = self.records(&connection).trip_items(trip_id)?;
        let TripAssessment {
            conflicts: mut itinerary_conflicts,
            readiness,
        } = assess_trip(&trip, &confirmed_facts, pending_candidate_count);
        itinerary_conflicts.extend(detect_planned_item_conflicts(&trip_items));
        let advisory_panel = load_advisory_panel(&connection, trip_id)?;
        let weather = fetch_weather_snapshot(&connection, trip_id)?;
        // Derived, not fetched: the same stored evidence, read a second way.
        let packing_list = build_packing_list(&trip, &confirmed_facts, weather.as_ref());
        let destination_facts = load_destination_facts_snapshot(&connection, trip_id)?;
        // Country facts are bundled and re-resolved from the stored country
        // code, so a corrected value is never frozen into an old row; astro is
        // computed from the stored coordinates for each day of the trip window.
        let country_facts = destination_facts
            .as_ref()
            .and_then(|snapshot| country_facts(&snapshot.country_code))
            .cloned();
        let astro = destination_facts
            .as_ref()
            .map(|snapshot| derive_astro(snapshot, &trip))
            .unwrap_or_default();
        // The nearest airports fall out of the same stored coordinates — bundled
        // data, no fetch.
        let nearest_airports = destination_facts
            .as_ref()
            .map(|snapshot| nearest_airports(snapshot.latitude, snapshot.longitude, 4))
            .unwrap_or_default();
        // World Heritage sites within 150 km of the destination — bundled data,
        // no fetch, from the same stored coordinates.
        let world_heritage = destination_facts
            .as_ref()
            .map(|snapshot| world_heritage_near(snapshot.latitude, snapshot.longitude, 150.0, 5))
            .unwrap_or_default();
        let place_summary = load_place_summary(&connection, trip_id)?;
        // A tipping note for the destination country — bundled, resolved fresh
        // from the same country code as the country facts.
        let tipping = destination_facts
            .as_ref()
            .and_then(|snapshot| tipping_guidance(&snapshot.country_code))
            .map(str::to_owned);
        // Derived on read from the snapshot's two stored offsets: present only
        // once the origin was geocoded on the last fetch.
        let time_difference = destination_facts.as_ref().and_then(|snapshot| {
            Some(time_difference(
                snapshot.origin_place.as_deref()?,
                snapshot.origin_utc_offset_minutes?,
                snapshot.utc_offset_minutes,
            ))
        });
        // Public holidays, narrowed to the trip window on read — a date edit
        // re-filters the stored snapshot without a re-fetch.
        let public_holidays =
            load_public_holidays_snapshot(&connection, trip_id)?.map(|snapshot| {
                PublicHolidaysSnapshot {
                    holidays: holidays_within(&snapshot.holidays, &trip.start_date, &trip.end_date),
                    ..snapshot
                }
            });
        let interest_profile = self.records(&connection).interest_profile(trip_id)?;
        let saved_places = self.records(&connection).saved_places(trip_id)?;
        let packing_items = self.records(&connection).packing_items(trip_id)?;
        Ok(TripDetail {
            trip,
            confirmed_facts,
            pending_candidate_count,
            itinerary_conflicts,
            readiness,
            advisory_panel,
            weather,
            packing_list,
            destination_facts,
            country_facts,
            astro,
            nearest_airports,
            time_difference,
            public_holidays,
            world_heritage,
            place_summary,
            tipping,
            interest_profile,
            saved_places,
            packing_items,
            trip_items,
        })
    }

    /// Persist the deterministic recommendation weights for this trip.
    pub fn set_interest_profile(
        &self,
        input: SetInterestProfileInput,
    ) -> Result<InterestProfile, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let weights = input.weights.validate()?;
        let profile = InterestProfile {
            trip_id: input.trip_id,
            weights,
            updated_at: Some(now_rfc3339()),
        };
        self.records(&connection)
            .upsert_interest_profile(&profile)?;
        Ok(profile)
    }

    /// Snapshot a recommendation and its provenance into the trip shortlist.
    pub fn save_place(&self, input: SavePlaceInput) -> Result<SavedPlace, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let recommendation = input.recommendation;
        if recommendation.pack_id.trim().is_empty() {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "a saved place must identify its source pack",
                "field",
                "recommendation.packId",
            ));
        }
        let source_pack_available: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM downloaded_packs WHERE trip_id=?1 AND pack_id=?2)",
                params![input.trip_id, recommendation.pack_id],
                |row| row.get(0),
            )
            .map_err(storage_error)?;
        if !source_pack_available {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "the recommendation source pack is not downloaded for this trip",
                "field",
                "recommendation.packId",
            ));
        }
        if let Some(existing) = self
            .records(&connection)
            .saved_places(&input.trip_id)?
            .into_iter()
            .find(|place| {
                place.pack_id == recommendation.pack_id
                    && place.name == recommendation.name
                    && place.lat == recommendation.lat
                    && place.lon == recommendation.lon
            })
        {
            return Ok(existing);
        }
        let now = now_rfc3339();
        let place = SavedPlace {
            id: new_id("place"),
            trip_id: input.trip_id,
            pack_id: recommendation.pack_id,
            source_pack_available,
            name: recommendation.name,
            category: recommendation.category,
            dimension: recommendation.dimension,
            lat: recommendation.lat,
            lon: recommendation.lon,
            source: recommendation.source,
            license: recommendation.license,
            reasons: recommendation.reasons,
            wildcard: recommendation.wildcard,
            notes: validate_planning_notes(&input.notes)?,
            created_at: now.clone(),
            updated_at: now,
        };
        self.records(&connection).insert_saved_place(&place)?;
        Ok(place)
    }

    pub fn update_saved_place(&self, input: UpdateSavedPlaceInput) -> Result<SavedPlace, AppError> {
        let connection = self.connection()?;
        let trip_id = record_trip_id(&connection, "saved_places", &input.saved_place_id)?;
        self.records(&connection).update_saved_place_notes(
            &input.saved_place_id,
            &validate_planning_notes(&input.notes)?,
            &now_rfc3339(),
        )?;
        self.records(&connection)
            .saved_places(&trip_id)?
            .into_iter()
            .find(|place| place.id == input.saved_place_id)
            .ok_or_else(|| AppError::new(ErrorCode::InternalUnexpected, "saved place disappeared"))
    }

    pub fn delete_saved_place(&self, saved_place_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection).delete_saved_place(saved_place_id)
    }

    pub fn add_packing_item(&self, input: AddPackingItemInput) -> Result<PackingItem, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let now = now_rfc3339();
        let item = PackingItem {
            id: new_id("packing"),
            trip_id: input.trip_id,
            label: validate_packing_label(&input.label)?,
            checked: false,
            suggestion_code: input.suggestion_code,
            created_at: now.clone(),
            updated_at: now,
        };
        self.records(&connection).insert_packing_item(&item)?;
        Ok(item)
    }

    pub fn update_packing_item(
        &self,
        input: UpdatePackingItemInput,
    ) -> Result<PackingItem, AppError> {
        let connection = self.connection()?;
        let trip_id = record_trip_id(&connection, "packing_items", &input.packing_item_id)?;
        let existing = self
            .records(&connection)
            .packing_items(&trip_id)?
            .into_iter()
            .find(|item| item.id == input.packing_item_id)
            .ok_or_else(|| {
                AppError::new(ErrorCode::ValidationInvalidInput, "packing item not found")
            })?;
        let item = PackingItem {
            label: validate_packing_label(&input.label)?,
            checked: input.checked,
            updated_at: now_rfc3339(),
            ..existing
        };
        self.records(&connection).update_packing_item(&item)?;
        Ok(item)
    }

    pub fn delete_packing_item(&self, packing_item_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection)
            .delete_packing_item(packing_item_id)
    }

    pub fn create_trip_item(&self, input: CreateTripItemInput) -> Result<TripItem, AppError> {
        let input = validate_create_trip_item(input)?;
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let now = now_rfc3339();
        let item = TripItem {
            id: new_id("item"),
            trip_id: input.trip_id,
            kind: input.kind,
            title: input.title,
            location: input.location,
            start_at: input.start_at,
            end_at: input.end_at,
            notes: input.notes,
            saved_place_id: input.saved_place_id,
            created_at: now.clone(),
            updated_at: now,
        };
        self.records(&connection).insert_trip_item(&item)?;
        Ok(item)
    }

    pub fn update_trip_item(&self, input: UpdateTripItemInput) -> Result<TripItem, AppError> {
        let connection = self.connection()?;
        let trip_id = record_trip_id(&connection, "trip_items", &input.trip_item_id)?;
        let normalized = validate_create_trip_item(CreateTripItemInput {
            trip_id: trip_id.clone(),
            kind: input.kind,
            title: input.title,
            location: input.location,
            start_at: input.start_at,
            end_at: input.end_at,
            notes: input.notes,
            saved_place_id: input.saved_place_id,
        })?;
        let existing = self
            .records(&connection)
            .trip_items(&trip_id)?
            .into_iter()
            .find(|item| item.id == input.trip_item_id)
            .ok_or_else(|| {
                AppError::new(ErrorCode::ValidationInvalidInput, "trip item not found")
            })?;
        let item = TripItem {
            kind: normalized.kind,
            title: normalized.title,
            location: normalized.location,
            start_at: normalized.start_at,
            end_at: normalized.end_at,
            notes: normalized.notes,
            saved_place_id: normalized.saved_place_id,
            updated_at: now_rfc3339(),
            ..existing
        };
        self.records(&connection).update_trip_item(&item)?;
        Ok(item)
    }

    pub fn delete_trip_item(&self, trip_item_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        self.records(&connection).delete_trip_item(trip_item_id)
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

    /// Suggest catalog packs for a trip's destination, best match first.
    ///
    /// A local, deterministic read: it matches the trip's stored destination
    /// against the compiled-in catalog and makes no network request. Downloading
    /// a suggested pack stays a separate, explicit user action.
    pub fn suggest_packs(&self, trip_id: &str) -> Result<Vec<PackSuggestion>, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        Ok(suggest_packs(&trip.destination))
    }

    /// Suggest values for a lodging form field from local data only.
    ///
    /// Sources are the trip's downloaded pack place names (for `propertyName`)
    /// and the user's previously confirmed lodging values. There is no external
    /// geocoding or per-keystroke network call. Confirmed values live in the
    /// encrypted vault; when it is locked that source is skipped rather than
    /// erroring, so the field still offers pack-based suggestions.
    pub fn suggest_field_values(
        &self,
        trip_id: &str,
        field: &str,
        query: &str,
    ) -> Result<Vec<FieldSuggestion>, AppError> {
        if !matches!(field, "address" | "propertyName") {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "suggestions are only available for lodging address and property name",
                "field",
                "field",
            ));
        }
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;

        let mut candidates: Vec<FieldSuggestion> = Vec::new();

        // Values the user already confirmed on THIS trip. Scoped to the current
        // trip so a past trip's address never surfaces while entering a new one.
        // Reading needs the vault; a locked vault simply omits this source.
        match self
            .records(&connection)
            .confirmed_lodging_values(field, trip_id)
        {
            Ok(values) => {
                for value in values {
                    candidates.push(
                        FieldSuggestion::new(value, SuggestionSource::ConfirmedFact)
                            .with_detail("from this trip"),
                    );
                }
            }
            Err(error) if error.code == ErrorCode::VaultLocked => {}
            Err(error) => return Err(error),
        }

        // Place names from this trip's downloaded packs. Pack places carry a
        // name but no address, so they only inform the property-name field.
        if field == "propertyName" {
            for name in downloaded_pack_place_names(&connection, trip_id)? {
                candidates.push(
                    FieldSuggestion::new(name, SuggestionSource::PackPlace)
                        .with_detail("from a downloaded city pack"),
                );
            }
        }

        Ok(rank_field_suggestions(query, candidates))
    }

    /// Suggest place names for the origin/destination fields, from local data
    /// only: the bundled offline gazetteer, the pack catalog, and the user's own
    /// past trips. Not trip-scoped — it works in the create-trip dialog before a
    /// trip exists — and never geocodes over the network.
    ///
    /// The user's own places (trip history, then packs) are offered before the
    /// gazetteer, so when a prefix matches both, `rank_field_suggestions`'
    /// stable dedup keeps the familiar one.
    pub fn suggest_places(&self, query: &str) -> Result<Vec<FieldSuggestion>, AppError> {
        let mut candidates: Vec<FieldSuggestion> = Vec::new();

        // The origins and destinations of the user's existing trips.
        let connection = self.connection()?;
        for trip in self.records(&connection).trip_summaries()? {
            for place in [trip.trip.origin, trip.trip.destination] {
                candidates.push(
                    FieldSuggestion::new(place, SuggestionSource::TripHistory)
                        .with_detail("from a previous trip"),
                );
            }
        }

        // The offline pack catalog (city/region names).
        for pack in pack_catalog() {
            candidates.push(FieldSuggestion::new(pack.name, SuggestionSource::Catalog));
        }

        // The bundled gazetteer — the world's cities, offline.
        for city in search_cities(query, FIELD_SUGGESTION_LIMIT) {
            candidates.push(
                FieldSuggestion::new(city.name, SuggestionSource::Gazetteer)
                    .with_detail(city.country),
            );
        }

        Ok(rank_field_suggestions(query, candidates))
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
            self.records(&connection).trip(trip_id)?;
        }
        let url = pack_download_url(pack_id);
        let body = self
            .fetcher
            .fetch_text(&url)
            .map_err(|error| AppError::new(ErrorCode::PackDownloadFailed, error.message))?;
        let content = parse_pack_content(pack_id, &body)?;
        let place_count = content.places.len() as u32;
        let article_count = content.articles.len() as u32;
        let offline_map_ready = if let Some(descriptor) = &content.offline_map {
            if !offline_map_is_ready(&self.database_path, pack_id, descriptor) {
                let url = offline_map_download_url(&descriptor.asset_name);
                let bytes = self
                    .fetcher
                    .fetch_bytes(&url, MAX_OFFLINE_MAP_BYTES as usize)?;
                store_offline_map(&self.database_path, pack_id, descriptor, &bytes)?;
            }
            true
        } else {
            false
        };
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
            offline_map_ready,
        })
    }

    /// The packs downloaded for a trip, most recent first.
    pub fn list_downloaded_packs(&self, trip_id: &str) -> Result<Vec<DownloadedPack>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT pack_id, name, region, place_count, article_count, downloaded_at, content
                 FROM downloaded_packs
                 WHERE trip_id = ?1
                 ORDER BY downloaded_at DESC, pack_id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                let pack_id: String = row.get(0)?;
                let content: String = row.get(6)?;
                let offline_map_ready = serde_json::from_str::<PackContent>(&content)
                    .ok()
                    .and_then(|content| content.offline_map)
                    .is_some_and(|descriptor| {
                        offline_map_is_ready(&self.database_path, &pack_id, &descriptor)
                    });
                Ok(DownloadedPack {
                    pack_id,
                    name: row.get(1)?,
                    region: row.get(2)?,
                    place_count: row.get(3)?,
                    article_count: row.get(4)?,
                    downloaded_at: row.get(5)?,
                    offline_map_ready,
                })
            })
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    /// Remove a downloaded pack from a trip.
    pub fn delete_downloaded_pack(&self, trip_id: &str, pack_id: &str) -> Result<(), AppError> {
        let connection = self.connection()?;
        let descriptor = connection
            .query_row(
                "SELECT content FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
            .and_then(|content| serde_json::from_str::<PackContent>(&content).ok())
            .and_then(|content| content.offline_map);
        connection
            .execute(
                "DELETE FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
            )
            .map_err(storage_error)?;
        if let Some(descriptor) = descriptor {
            let remaining: u32 = connection
                .query_row(
                    "SELECT COUNT(*) FROM downloaded_packs WHERE pack_id = ?1",
                    params![pack_id],
                    |row| row.get(0),
                )
                .map_err(storage_error)?;
            if remaining == 0 {
                let _ =
                    fs::remove_file(offline_map_path(&self.database_path, pack_id, &descriptor)?);
            }
        }
        Ok(())
    }

    /// The newest downloaded pack for this trip that has a verified local
    /// PMTiles archive. Reading this metadata is local-only and does not imply a
    /// tile request or any network consent.
    pub fn get_offline_map(&self, trip_id: &str) -> Result<Option<OfflineMapArchive>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT pack_id, name, content FROM downloaded_packs
                 WHERE trip_id = ?1 ORDER BY downloaded_at DESC, pack_id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(storage_error)?;
        for row in rows {
            let (pack_id, name, content) = row.map_err(storage_error)?;
            let Some(descriptor) = serde_json::from_str::<PackContent>(&content)
                .ok()
                .and_then(|content| content.offline_map)
            else {
                continue;
            };
            if offline_map_is_ready(&self.database_path, &pack_id, &descriptor) {
                let bbox = validate_pack_id(&pack_id)?.bbox;
                return Ok(Some(OfflineMapArchive {
                    pack_id,
                    name,
                    bbox,
                    byte_length: descriptor.byte_length,
                    sha256: descriptor.sha256,
                    source_name: descriptor.source_name,
                    source_url: descriptor.source_url,
                    license: descriptor.license,
                    attribution: descriptor.attribution,
                    fetched_at: descriptor.fetched_at,
                    min_zoom: descriptor.min_zoom,
                    max_zoom: descriptor.max_zoom,
                }));
            }
        }
        Ok(None)
    }

    /// Read one bounded range from a trip-authorized local PMTiles archive.
    /// This narrow seam avoids exposing arbitrary filesystem paths or granting
    /// the webview general filesystem capability.
    pub fn read_offline_map_range(
        &self,
        trip_id: &str,
        pack_id: &str,
        offset: u64,
        length: u32,
    ) -> Result<OfflineMapChunk, AppError> {
        validate_pack_id(pack_id)?;
        if length == 0 || length > MAX_OFFLINE_MAP_RANGE {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "offline map range length is invalid",
                "field",
                "length",
            ));
        }
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let content = connection
            .query_row(
                "SELECT content FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip_id, pack_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::PackDownloadFailed,
                    "the offline map is not downloaded for this trip",
                )
            })?;
        drop(connection);
        let descriptor = serde_json::from_str::<PackContent>(&content)
            .ok()
            .and_then(|content| content.offline_map)
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::PackDownloadFailed,
                    "the downloaded pack has no offline map",
                )
            })?;
        if offset >= descriptor.byte_length {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "offline map range starts beyond the archive",
                "field",
                "offset",
            ));
        }
        let actual_length = u64::from(length).min(descriptor.byte_length - offset) as usize;
        let path = offline_map_path(&self.database_path, pack_id, &descriptor)?;
        let mut file = fs::File::open(path).map_err(storage_error)?;
        file.seek(SeekFrom::Start(offset)).map_err(storage_error)?;
        let mut bytes = vec![0; actual_length];
        file.read_exact(&mut bytes).map_err(storage_error)?;
        Ok(OfflineMapChunk {
            data_base64: BASE64.encode(bytes),
            etag: descriptor.sha256,
        })
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
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare("SELECT pack_id, content FROM downloaded_packs WHERE trip_id = ?1")
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(storage_error)?;

        let mut places = Vec::new();
        for row in rows {
            let (pack_id, content) = row.map_err(storage_error)?;
            // Stored content is our own re-serialized PackContent; skip anything
            // unreadable rather than failing the whole request.
            if let Ok(pack) = serde_json::from_str::<PackContent>(&content) {
                places.extend(pack.places.into_iter().map(|place| AttributedPackPlace {
                    pack_id: pack_id.clone(),
                    place,
                }));
            }
        }
        Ok(recommend_attributed_places(
            &places,
            &weights,
            RECOMMENDATION_LIMIT,
        ))
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

    /// Check a BYOK key against its provider before storing it, by issuing a
    /// cheap read-only request with the key in the auth header. Nothing is stored
    /// or logged — the key is consumed here and only placed in the outgoing
    /// header. A clear rejection (401/403) is authoritative; any reach failure or
    /// odd status is reported as `unreachable` so a transient hiccup never looks
    /// like a bad key. Keyless providers (Ollama) are rejected as invalid input.
    pub fn validate_provider_key(
        &self,
        provider: &str,
        key: &str,
    ) -> Result<KeyValidation, AppError> {
        // Which endpoint, which headers, what a keyless provider means, and what
        // a reply is worth all belong to core. This adds only the fetch.
        let id = validate_provider_id(provider)?;
        let request = build_key_validation_request(id, key)?;
        let header_refs: Vec<(&str, &str)> = request
            .headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect();
        Ok(interpret_key_validation(
            self.fetcher
                .get_status(request.url, &header_refs)
                .map_err(|_| ()),
        ))
    }

    /// Download (pull) an on-device model into a running Ollama. Best-effort and
    /// self-contained: the request goes only to localhost, and a failure — Ollama
    /// not running, an unknown tag — is returned as `ok: false` with a readable
    /// message rather than an error the UI has to decode. The download can take
    /// several minutes for a multi-gigabyte model.
    pub fn pull_local_model(&self, model: &str) -> Result<LocalModelPullResult, AppError> {
        let model = validate_model_name(model)?;
        let body = build_pull_body(&model);
        match self.fetcher.post_json_long(OLLAMA_PULL_URL, &body) {
            Ok(response) => match interpret_pull_response(&response) {
                Ok(()) => Ok(LocalModelPullResult {
                    ok: true,
                    message: format!("{model} is downloaded and ready."),
                }),
                Err(reason) => Ok(LocalModelPullResult {
                    ok: false,
                    message: reason,
                }),
            },
            Err(_) => Ok(LocalModelPullResult {
                ok: false,
                message:
                    "Could not reach Ollama. Make sure it is installed and running, then try again."
                        .to_owned(),
            }),
        }
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
        getrandom::getrandom(&mut salt).map_err(|_| nonce_error())?;
        let mut nonce = [0u8; VAULT_NONCE_LEN];
        getrandom::getrandom(&mut nonce).map_err(|_| nonce_error())?;

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

    /// Fetch every government's advice for one curated country on one click.
    ///
    /// Called only from an explicit user action — the click is the consent for
    /// this named set of keyless fetches. Each source is stored verbatim with
    /// its own retrieval time; a source that fails never destroys what it
    /// stored before, and never blocks the sources that succeeded.
    pub fn fetch_advisories(
        &self,
        trip_id: &str,
        country_slug: &str,
    ) -> Result<AdvisoryPanel, AppError> {
        let country = advisory_country(country_slug)?;
        let fcdo = validate_country_slug(country_slug)?;
        // Validate the trip before any network call.
        {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?;
        }
        let retrieved_at = now_rfc3339();

        // Fetch and parse each government independently — no `?` on a fetch, or
        // one government being down would hide the other three. `Ok(None)`
        // means that government publishes nothing for this country; `Err` means
        // we could not read it this time and fall back to what is stored.
        let uk = self
            .fetcher
            .fetch_text(&format!(
                "https://www.gov.uk/api/content/foreign-travel-advice/{}",
                fcdo.slug
            ))
            .and_then(|body| parse_fcdo_content(fcdo, &body, &retrieved_at))
            .map(|snapshot| Some(entry_from_fcdo(&snapshot)));
        let us = self
            .fetcher
            .fetch_text("https://cadataapi.state.gov/api/TravelAdvisories")
            .and_then(|body| parse_us_state(country, fcdo.name, &body, &retrieved_at));
        let ca = self
            .fetcher
            .fetch_text("https://data.international.gc.ca/travel-voyage/index-alpha-eng.json")
            .and_then(|body| parse_ca_gac(country, fcdo.name, &body, &retrieved_at));
        let de = self
            .fetcher
            .fetch_text("https://www.auswaertiges-amt.de/opendata/travelwarning")
            .and_then(|body| parse_de_aa(country, fcdo.name, &body, &retrieved_at));
        let notices = self
            .fetcher
            .fetch_text("https://wwwnc.cdc.gov/travel/rss/notices.xml")
            .and_then(|body| parse_cdc_notices(&body))
            .map(|all| notices_for_country(&all, fcdo.name));

        let connection = self.connection()?;
        let previous = load_advisory_panel(&connection, trip_id)?;
        let stored_before = |source| {
            previous
                .as_ref()
                .is_some_and(|panel| panel.entries.iter().any(|entry| entry.source == source))
        };

        // Resolve every source before storing anything: a total failure must
        // leave the database exactly as it was.
        let resolved = [
            (AdvisorySource::UkFcdo, uk),
            (AdvisorySource::UsState, us),
            (AdvisorySource::CaGac, ca),
            (AdvisorySource::DeAa, de),
        ];
        if resolved
            .iter()
            .all(|(source, result)| result.is_err() && !stored_before(*source))
        {
            // Nothing fetched and nothing stored. An empty panel would read as
            // "no government has anything to say about this destination", which
            // is a different and false claim.
            return Err(AppError::new(
                ErrorCode::AdviceFetchFailed,
                "no official source could be reached",
            ));
        }

        let mut source_status = Vec::with_capacity(resolved.len());
        for (source, result) in resolved {
            let state = match result {
                Ok(Some(entry)) => {
                    store_advisory_entry(&connection, trip_id, &entry)?;
                    SourceState::Fresh
                }
                Ok(None) => {
                    delete_advisory_entry(&connection, trip_id, source)?;
                    SourceState::NotPublished
                }
                Err(_) if stored_before(source) => SourceState::Kept,
                Err(_) => SourceState::Unavailable,
            };
            source_status.push(SourceStatus { source, state });
        }

        // A CDC failure leaves the last good notices in place.
        let health_notices = notices.unwrap_or_else(|_| {
            previous
                .as_ref()
                .map(|panel| panel.health_notices.clone())
                .unwrap_or_default()
        });

        store_advisory_panel_meta(
            &connection,
            trip_id,
            country.slug,
            fcdo.name,
            &health_notices,
            &source_status,
            &retrieved_at,
        )?;

        // Return what a reload shows, not a hand-assembled value.
        load_advisory_panel(&connection, trip_id)?.ok_or_else(|| {
            AppError::new(
                ErrorCode::AdviceFetchFailed,
                "no official source could be reached",
            )
        })
    }

    /// Deterministic search over this trip's stored documents and confirmed
    /// facts. Purely local; ranking is transparent occurrence counting.
    pub fn search_trip(&self, trip_id: &str, query: &str) -> Result<Vec<SearchHit>, AppError> {
        let query = validate_search_query(query)?;
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let documents = self.records(&connection).trip_document_texts(trip_id)?;
        let searchable: Vec<SearchableDocument<'_>> = documents
            .iter()
            .map(|(id, label, content)| SearchableDocument { id, label, content })
            .collect();
        let facts = self.records(&connection).confirmed_facts(trip_id)?;
        Ok(search_trip_corpus(&query, &searchable, &facts))
    }

    /// Search traveler-visible local records across every trip. Pending parser
    /// candidates are intentionally excluded; extracted text becomes searchable
    /// only as a source document or after explicit confirmation.
    pub fn search_workspace(&self, query: &str) -> Result<Vec<WorkspaceSearchHit>, AppError> {
        let query = validate_search_query(query)?;
        let connection = self.connection()?;
        let trips = self.records(&connection).trip_summaries()?;
        let mut owned = Vec::new();
        for summary in trips {
            let trip = summary.trip;
            for (id, label, content) in self.records(&connection).trip_document_texts(&trip.id)? {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::Document,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    record_id: id,
                    label,
                    text: content,
                });
            }
            for fact in self.records(&connection).confirmed_facts(&trip.id)? {
                let label = match fact.fact_type {
                    FactType::FlightSegment => "Confirmed flight",
                    FactType::LodgingStay => "Confirmed lodging",
                };
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::ConfirmedFact,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    record_id: fact.id,
                    label: label.to_owned(),
                    text: serde_json::to_string(&fact.payload).map_err(storage_error)?,
                });
            }
            let notes = self.records(&connection).trip_notes(&trip.id)?;
            if !notes.body.is_empty() {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::Note,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    record_id: trip.id.clone(),
                    label: "Trip notes".to_owned(),
                    text: notes.body,
                });
            }
            for place in self.records(&connection).saved_places(&trip.id)? {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::SavedPlace,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    record_id: place.id,
                    label: place.name,
                    text: format!(
                        "{} {} {}",
                        place.category,
                        place.notes,
                        place.reasons.join(" ")
                    ),
                });
            }
            for item in self.records(&connection).trip_items(&trip.id)? {
                owned.push(OwnedWorkspaceSearchRecord {
                    source: WorkspaceSearchSource::TripItem,
                    trip_id: trip.id.clone(),
                    trip_title: trip.title.clone(),
                    record_id: item.id,
                    label: item.title,
                    text: [item.location, item.notes, item.start_at, item.end_at]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" "),
                });
            }
        }
        let borrowed: Vec<WorkspaceSearchRecord<'_>> = owned
            .iter()
            .map(|record| WorkspaceSearchRecord {
                source: record.source,
                trip_id: &record.trip_id,
                trip_title: &record.trip_title,
                record_id: &record.record_id,
                label: &record.label,
                text: &record.text,
            })
            .collect();
        Ok(search_workspace_corpus(&query, &borrowed))
    }

    /// Typeahead term suggestions for a search query, from this trip's corpus.
    /// Local only. An empty or over-long query yields no suggestions (never an
    /// error — this drives as-you-type autocomplete).
    pub fn suggest_search_terms(
        &self,
        trip_id: &str,
        query: &str,
    ) -> Result<Vec<String>, AppError> {
        let Ok(query) = validate_search_query(query) else {
            return Ok(Vec::new());
        };
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let documents = self.records(&connection).trip_document_texts(trip_id)?;
        let searchable: Vec<SearchableDocument<'_>> = documents
            .iter()
            .map(|(id, label, content)| SearchableDocument { id, label, content })
            .collect();
        let facts = self.records(&connection).confirmed_facts(trip_id)?;
        Ok(suggest_search_terms(
            &query,
            &searchable,
            &facts,
            SEARCH_SUGGESTION_LIMIT,
        ))
    }

    /// Fetch and store a dated weather outlook for the trip's destination.
    /// Called only from an explicit user action — the click is the consent for
    /// two keyless requests to open-meteo.com (geocode the destination name,
    /// then the daily forecast). The snapshot replaces the trip's previous one.
    pub fn fetch_weather(&self, trip_id: &str) -> Result<WeatherSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };

        let place = geocode(&trip.destination, |url| {
            self.fetcher
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        let forecast_url = format!(
            "https://api.open-meteo.com/v1/forecast?latitude={:.5}&longitude={:.5}\
             &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max\
             &timezone=auto&forecast_days=16",
            place.latitude, place.longitude
        );
        let mut snapshot = parse_forecast_response(
            &place,
            &self
                .fetcher
                .fetch_text(&forecast_url)
                .map_err(weather_network_failure)?,
            &trip.start_date,
            &trip.end_date,
            &now_rfc3339(),
        )?;

        // The forecast is what the user clicked for; the layers below are
        // extras. Each is attempted independently and a failure leaves that one
        // layer empty rather than costing the outlook — so a slow archive or a
        // down NWS never turns into "no weather".
        snapshot.normals = self.fetch_climate_normals(&place, &trip);
        snapshot.air_quality = self.fetch_air_quality(&place, &trip).unwrap_or_default();
        // The NWS only covers the United States. Elsewhere Voyalier does not
        // ask, so an empty list there means "not covered", never "all clear".
        if place.country_code == "US" {
            snapshot.alerts = self.fetch_nws_alerts(&place).unwrap_or_default();
        }

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO weather_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, days, coverage,
                  source_url, retrieved_at, normals, air_quality, alerts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   place_name = excluded.place_name,
                   place_region = excluded.place_region,
                   latitude = excluded.latitude,
                   longitude = excluded.longitude,
                   days = excluded.days,
                   coverage = excluded.coverage,
                   source_url = excluded.source_url,
                   retrieved_at = excluded.retrieved_at,
                   normals = excluded.normals,
                   air_quality = excluded.air_quality,
                   alerts = excluded.alerts",
                params![
                    trip_id,
                    snapshot.place_name,
                    snapshot.place_region,
                    snapshot.latitude,
                    snapshot.longitude,
                    json_to_sql(&snapshot.days)?,
                    enum_to_sql(snapshot.coverage)?,
                    snapshot.source_url,
                    snapshot.retrieved_at,
                    snapshot.normals.as_ref().map(json_to_sql).transpose()?,
                    json_to_sql(&snapshot.air_quality)?,
                    json_to_sql(&snapshot.alerts)?,
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
    }

    /// What the trip's dates have usually been like here, from observed
    /// history. `None` when the source is unreachable or the history is too
    /// thin to call anything typical.
    fn fetch_climate_normals(&self, place: &GeocodedPlace, trip: &Trip) -> Option<ClimateNormals> {
        let (start, end) = archive_window(&trip.start_date, &trip.end_date, NORMALS_YEARS).ok()?;
        // One request for the whole span beats one per year: the core filters
        // it down to the trip's own month-days.
        let url = format!(
            "https://archive-api.open-meteo.com/v1/archive?latitude={:.5}&longitude={:.5}\
             &start_date={start}&end_date={end}\
             &daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto",
            place.latitude, place.longitude
        );
        let body = self.fetcher.fetch_text(&url).ok()?;
        parse_climate_normals(&body, &trip.start_date, &trip.end_date).ok()?
    }

    fn fetch_air_quality(&self, place: &GeocodedPlace, trip: &Trip) -> Option<Vec<AirQualityDay>> {
        // `pm2_5_max` and `us_aqi_max` are not daily variables in this API —
        // asking for them fails the whole request. UV is daily; the rest is
        // hourly and the core folds it into days.
        let url = format!(
            "https://air-quality-api.open-meteo.com/v1/air-quality?latitude={:.5}&longitude={:.5}\
             &daily=uv_index_max&hourly=us_aqi,pm2_5&timezone=auto&forecast_days=7",
            place.latitude, place.longitude
        );
        let body = self.fetcher.fetch_text(&url).ok()?;
        parse_air_quality(&body, &trip.start_date, &trip.end_date).ok()
    }

    fn fetch_nws_alerts(&self, place: &GeocodedPlace) -> Option<Vec<WeatherAlert>> {
        let url = format!(
            "https://api.weather.gov/alerts/active?point={:.4},{:.4}",
            place.latitude, place.longitude
        );
        let body = self.fetcher.fetch_text(&url).ok()?;
        parse_nws_alerts(&body).ok()
    }

    /// Fetch the destination's practical facts on one click: a geocode (name,
    /// coordinates, country, timezone) and today's ECB reference rates.
    ///
    /// The country facts and the sun/moon days are derived from the stored
    /// snapshot on read, not fetched — so this makes exactly two requests, and
    /// a failed rate fetch still keeps the geocoded place.
    pub fn fetch_destination_facts(
        &self,
        trip_id: &str,
    ) -> Result<DestinationFactsSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };

        let place = geocode(&trip.destination, |url| {
            self.fetcher
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        // The ECB feed is a small daily file; a failure here leaves the card
        // with the place and its country facts but no rates.
        let (rate_date, currency_rates) = match self
            .fetcher
            .fetch_text("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml")
            .and_then(|body| parse_ecb_rates(&body))
        {
            Ok((date, rates)) => (date, rates),
            Err(_) => (String::new(), Vec::new()),
        };

        // Best-effort: geocode the origin too, only to learn its timezone for
        // the destination-vs-home time difference. A blank or unrecognised
        // origin (or a network hiccup) simply leaves the difference unshown —
        // it never fails the fetch the way a missing destination would.
        let (origin_place, origin_utc_offset_minutes) = if trip.origin.trim().is_empty() {
            (None, None)
        } else {
            match geocode(&trip.origin, |url| self.fetcher.fetch_text(url)).ok() {
                Some(origin) => (
                    Some(origin.name),
                    Some(offset_minutes_for(&origin.timezone, &trip.start_date)),
                ),
                None => (None, None),
            }
        };

        let snapshot = DestinationFactsSnapshot {
            place_name: place.name.clone(),
            place_region: place.region.clone(),
            latitude: place.latitude,
            longitude: place.longitude,
            utc_offset_minutes: offset_minutes_for(&place.timezone, &trip.start_date),
            country_code: place.country_code.clone(),
            rate_date,
            currency_rates,
            retrieved_at: now_rfc3339(),
            origin_place,
            origin_utc_offset_minutes,
        };

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO destination_facts_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, utc_offset_minutes,
                  country_code, rate_date, currency_rates, retrieved_at,
                  origin_place, origin_utc_offset_minutes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   place_name = excluded.place_name,
                   place_region = excluded.place_region,
                   latitude = excluded.latitude,
                   longitude = excluded.longitude,
                   utc_offset_minutes = excluded.utc_offset_minutes,
                   country_code = excluded.country_code,
                   rate_date = excluded.rate_date,
                   currency_rates = excluded.currency_rates,
                   retrieved_at = excluded.retrieved_at,
                   origin_place = excluded.origin_place,
                   origin_utc_offset_minutes = excluded.origin_utc_offset_minutes",
                params![
                    trip_id,
                    snapshot.place_name,
                    snapshot.place_region,
                    snapshot.latitude,
                    snapshot.longitude,
                    snapshot.utc_offset_minutes,
                    snapshot.country_code,
                    snapshot.rate_date,
                    json_to_sql(&snapshot.currency_rates)?,
                    snapshot.retrieved_at,
                    snapshot.origin_place,
                    snapshot.origin_utc_offset_minutes,
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Fetch the destination country's public holidays for the trip's years
    /// from Nager.Date (keyless), stored as a dated snapshot. The trip detail
    /// narrows them to the travel window on read, so a date edit re-filters
    /// without a re-fetch. A year Nager does not cover simply contributes
    /// nothing rather than failing the whole fetch.
    pub fn fetch_public_holidays(&self, trip_id: &str) -> Result<PublicHolidaysSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };

        // Geocode the destination to its country — the lookup weather and facts
        // already use; Nager keys on the ISO-3166-1 alpha-2 code.
        let place = geocode(&trip.destination, |url| {
            self.fetcher
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        let holidays = public_holidays(
            &place.country_code,
            trip_years(&trip.start_date, &trip.end_date),
            |url| self.fetcher.fetch_text(url),
        );

        let snapshot = PublicHolidaysSnapshot {
            country_code: place.country_code.clone(),
            country_name: place.country.clone(),
            holidays,
            retrieved_at: now_rfc3339(),
        };

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO public_holidays_snapshots
                 (trip_id, country_code, country_name, holidays, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   country_code = excluded.country_code,
                   country_name = excluded.country_name,
                   holidays = excluded.holidays,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.country_code,
                    snapshot.country_name,
                    json_to_sql(&snapshot.holidays)?,
                    snapshot.retrieved_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Fetch a Wikipedia summary of the destination from the Wikimedia REST API
    /// on an explicit click, stored as a dated snapshot. The text stays
    /// Wikipedia's, shown under CC BY-SA with attribution; a place with no clear
    /// article (a miss or a disambiguation page) surfaces as an error.
    pub fn fetch_place_summary(&self, trip_id: &str) -> Result<PlaceSummary, AppError> {
        let trip = {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?
        };
        let summary = place_summary(&trip.destination, &now_rfc3339(), |url| {
            self.fetcher
                .fetch_text(url)
                .map_err(weather_network_failure)
        })?;

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO place_summaries
                 (trip_id, title, description, extract, url, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   title = excluded.title,
                   description = excluded.description,
                   extract = excluded.extract,
                   url = excluded.url,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    summary.title,
                    summary.description,
                    summary.extract,
                    summary.url,
                    summary.retrieved_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(summary)
    }

    /// Build a redacted, shareable brief from the confirmed plan. The brief is
    /// produced by generation-time exclusion in the core, so secrets never
    /// enter the returned structure.
    pub fn get_trip_brief(&self, trip_id: &str) -> Result<TripBrief, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let confirmed_facts = self.records(&connection).confirmed_facts(trip_id)?;
        let trip_items = self.records(&connection).trip_items(trip_id)?;
        Ok(build_trip_brief(
            &trip,
            &confirmed_facts,
            &trip_items,
            &RedactionPolicy::for_sharing(),
            &now_rfc3339(),
        ))
    }

    /// The Today view for a trip against the current date: where the trip
    /// stands, what happens today, and what's next. Deterministic and offline.
    pub fn get_today(&self, trip_id: &str) -> Result<TodayView, AppError> {
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let facts = self.records(&connection).confirmed_facts(trip_id)?;
        let trip_items = self.records(&connection).trip_items(trip_id)?;
        let now = now_rfc3339();
        let today = now.get(..10).unwrap_or(now.as_str());
        Ok(build_today_view(&trip, &facts, &trip_items, today))
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
        let trip = self.records(&connection).trip(trip_id)?;
        let confirmed_facts = self.records(&connection).confirmed_facts(trip_id)?;
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![id.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        let mut preview = build_assist_preview(
            &trip,
            &confirmed_facts,
            id,
            model.as_deref(),
            &now_rfc3339(),
        );
        // Apply the user's custom assist instruction, if they set one. Run reuses
        // this preview, so the sent request matches exactly what is shown.
        apply_prompt_override(
            &mut preview,
            effective_ai_prompt(&connection, AiPromptKind::Assist)?,
        );
        Ok(preview)
    }

    /// The editable AI instructions with their defaults and any user overrides.
    pub fn get_ai_prompts(&self) -> Result<AiPromptSettings, AppError> {
        let connection = self.connection()?;
        let mut prompts = Vec::new();
        for kind in [AiPromptKind::Assist, AiPromptKind::DraftLodgingDates] {
            prompts.push(AiPrompt {
                kind,
                default_text: ai_prompt_default(kind).to_owned(),
                custom_text: read_app_setting(&connection, ai_prompt_key(kind))?,
            });
        }
        Ok(AiPromptSettings { prompts })
    }

    /// Set (or, with `text = None`, reset to default) one AI instruction. A blank
    /// override is rejected — resetting is the way to return to the default.
    pub fn set_ai_prompt(
        &self,
        kind: &str,
        text: Option<&str>,
    ) -> Result<AiPromptSettings, AppError> {
        let kind = validate_ai_prompt_kind(kind)?;
        match text {
            Some(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    return Err(AppError::with_detail(
                        ErrorCode::ValidationInvalidInput,
                        "the instruction can't be empty — reset it to the default instead",
                        "field",
                        "text",
                    ));
                }
                if trimmed.chars().count() > MAX_AI_PROMPT_LEN {
                    return Err(AppError::with_detail(
                        ErrorCode::ValidationInvalidInput,
                        "the instruction is too long",
                        "field",
                        "text",
                    ));
                }
                self.set_app_setting(ai_prompt_key(kind), trimmed)?;
            }
            None => {
                let connection = self.connection()?;
                connection
                    .execute(
                        "DELETE FROM app_settings WHERE key = ?1",
                        params![ai_prompt_key(kind)],
                    )
                    .map_err(storage_error)?;
            }
        }
        self.get_ai_prompts()
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

    /// Gather the inputs a lodging-dates draft needs: the trip, its imported
    /// document texts (decrypted; a locked vault surfaces as `vault/locked`), and
    /// the user's chosen on-device model, if any. Rejects an unknown draft kind.
    fn draft_inputs(
        &self,
        trip_id: &str,
        kind: &str,
    ) -> Result<(Trip, Vec<DocumentText>, Option<String>), AppError> {
        if kind != ASSIST_DRAFT_LODGING_DATES {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "unknown draft kind",
                "field",
                "kind",
            ));
        }
        let connection = self.connection()?;
        let trip = self.records(&connection).trip(trip_id)?;
        let documents = self.records(&connection).trip_document_texts(trip_id)?;
        let model = connection
            .query_row(
                "SELECT model FROM provider_settings WHERE provider = ?1",
                params![ProviderId::Ollama.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        Ok((trip, documents, model))
    }

    /// Build the exact on-device request a lodging-dates draft would send — the
    /// consent step. On-device (Ollama) only, so nothing leaves the device; it is
    /// grounded in the trip's own imported text and dates. Previewing sends
    /// nothing.
    pub fn preview_assist_draft(
        &self,
        trip_id: &str,
        kind: &str,
    ) -> Result<AssistRequestPreview, AppError> {
        let (trip, documents, model) = self.draft_inputs(trip_id, kind)?;
        let doc_pairs: Vec<(String, String)> = documents
            .into_iter()
            .map(|(_, label, text)| (label, text))
            .collect();
        let connection = self.connection()?;
        let system_prompt = effective_ai_prompt(&connection, AiPromptKind::DraftLodgingDates)?;
        Ok(build_draft_preview(
            &trip,
            &doc_pairs,
            model.as_deref(),
            &system_prompt,
        ))
    }

    /// Run a lodging-dates draft: send the previewed request to the on-device
    /// model, strictly validate the reply, and turn each surviving proposal into
    /// a *pending* candidate for review — never a confirmed fact. Ollama-only;
    /// nothing leaves the device. With no imported documents there is nothing to
    /// read, so it returns no candidates without calling the model.
    pub fn run_assist_draft(
        &self,
        trip_id: &str,
        kind: &str,
    ) -> Result<AssistDraftResult, AppError> {
        let (trip, documents, model) = self.draft_inputs(trip_id, kind)?;
        if documents.is_empty() {
            return Ok(AssistDraftResult {
                candidates: Vec::new(),
            });
        }
        let document_id = documents[0].0.clone();
        let doc_pairs: Vec<(String, String)> = documents
            .iter()
            .map(|(_, label, text)| (label.clone(), text.clone()))
            .collect();
        // Read the (possibly customized) instruction in a scoped lock so the
        // storage guard is released before the network call and the later insert.
        let system_prompt = {
            let connection = self.connection()?;
            effective_ai_prompt(&connection, AiPromptKind::DraftLodgingDates)?
        };
        // Reuse the preview, exactly as run_assist does: the consent step and
        // the bytes actually sent are then the same object, not two builds that
        // happen to agree.
        let preview = build_draft_preview(&trip, &doc_pairs, model.as_deref(), &system_prompt);
        // On-device only: Ollama is keyless, so nothing leaves this machine.
        let request = build_assist_request(
            ProviderId::Ollama,
            preview.model.as_deref(),
            &preview.system_prompt,
            &preview.user_content,
            None,
        )?;
        let response = self.fetcher.post_json(request.url, &request.body, &[])?;
        let text = parse_assist_reply(ProviderId::Ollama, &response)?;
        let proposals = parse_lodging_dates_reply(&text)?;
        if proposals.is_empty() {
            return Ok(AssistDraftResult {
                candidates: Vec::new(),
            });
        }

        let connection = self.connection()?;
        let now = now_rfc3339();
        // Record the draft as its own parser run so candidates satisfy the
        // parser_runs foreign key and the run is traceable, like an import.
        let parser_run_id = new_id("assist");
        connection
            .execute(
                "INSERT INTO parser_runs (id, trip_id, document_id, parser_id, parser_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    parser_run_id,
                    trip.id,
                    document_id,
                    "assist_draft_lodging_dates",
                    "v1",
                    now
                ],
            )
            .map_err(storage_error)?;
        let mut candidates = Vec::new();
        for proposal in proposals {
            let warnings = draft_window_warnings(&trip, &proposal);
            let candidate = CandidateFact {
                id: new_id("cand"),
                trip_id: trip.id.clone(),
                document_id: document_id.clone(),
                parser_run_id: parser_run_id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    property_name: proposal.property_name,
                    checkin_date: proposal.checkin_date,
                    checkout_date: proposal.checkout_date,
                    ..FactPayload::default()
                },
                method: ExtractionMethod::Assisted,
                field_spans: Vec::new(),
                warnings,
                status: CandidateStatus::Pending,
                created_at: now.clone(),
                resolved_at: None,
            };
            self.records(&connection).insert_candidate(&candidate)?;
            candidates.push(candidate);
        }
        Ok(AssistDraftResult { candidates })
    }

    /// Send a previewed request to `id`'s runtime and return `(model, reply)`.
    /// The BYOK key, when needed, is read from the keychain and used only here.
    /// Send the previewed request to its provider and return `(model, reply)`.
    ///
    /// The provider protocol — endpoint, model default, body shape, headers, and
    /// the matching reply parser — belongs to `voyalier_core::assist`. All this
    /// adds is the two things core cannot do: read the key from the keychain and
    /// perform the fetch.
    fn dispatch_assist(
        &self,
        id: ProviderId,
        preview: &AssistRequestPreview,
    ) -> Result<(String, String), AppError> {
        let key = if provider_info(id).key_required {
            Some(self.require_provider_key(id)?)
        } else {
            None
        };
        let request = build_assist_request(
            id,
            preview.model.as_deref(),
            &preview.system_prompt,
            &preview.user_content,
            key.as_deref(),
        )?;
        let header_refs: Vec<(&str, &str)> = request
            .headers
            .iter()
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect();
        let response = self
            .fetcher
            .post_json(request.url, &request.body, &header_refs)?;
        Ok((request.model, parse_assist_reply(id, &response)?))
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
        self.records(&connection).trip(trip_id)?;
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
        let current = self.records(&connection).trip(trip_id)?;
        let input = validate_update_trip(&current, input)?;
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
        invalidate_after_trip_edit(&transaction, trip_id, &current, &input)?;
        transaction.commit().map_err(storage_error)?;
        self.records(&connection).trip(trip_id)
    }

    pub fn archive_trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.set_trip_status(trip_id, TripStatus::Archived)
    }

    /// Bring an archived trip back into the active workspace. Restores it to
    /// draft (the state a trip starts in), the reverse of [`Self::archive_trip`].
    pub fn unarchive_trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.set_trip_status(trip_id, TripStatus::Draft)
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
        // Email is input-only. `parse_import` bounds the raw input, extracts the
        // confirmation body, bounds that, and dispatches to the parser for the
        // resulting kind — so everything downstream (dedup, sealing, field
        // spans) sees the extracted body, never the raw email.
        let DocumentParse {
            kind,
            content,
            label_hint: email_subject,
            char_count,
            parser_id,
            parser_version,
            candidates: parsed_candidates,
        } = parse_import(input.kind, &input.content)?;
        let hash = sha256_hex(content.as_bytes());
        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                email_subject
                    .map(|subject| subject.trim().to_owned())
                    .filter(|subject| !subject.is_empty())
            })
            .unwrap_or_else(|| {
                match kind {
                    DocumentKind::Html => "Imported HTML",
                    DocumentKind::PastedText => "Pasted text",
                    // Unreachable: email was normalized to a body kind above.
                    DocumentKind::Email => "Imported email",
                }
                .to_owned()
            });
        let now = now_rfc3339();
        let document_id = new_id("doc");
        let parser_run_id = new_id("run");

        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        self.records(&transaction).trip(&input.trip_id)?;

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

        // The imported body carries the same confirmation codes and traveler
        // names as the parsed facts, so records seals it at rest.
        let document = SourceDocument {
            id: document_id,
            trip_id: input.trip_id.clone(),
            // The normalized body kind that was actually stored (email input
            // becomes html/pasted_text), not the raw input kind.
            kind,
            label,
            content_hash: hash,
            char_count,
            imported_at: now.clone(),
        };
        self.records(&transaction)
            .insert_document(&document, &content)?;
        transaction
            .execute(
                "INSERT INTO parser_runs (id, trip_id, document_id, parser_id, parser_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    parser_run_id,
                    input.trip_id,
                    document.id,
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
                document_id: document.id.clone(),
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
            self.records(&transaction).insert_candidate(&candidate)?;
            candidates.push(candidate);
        }

        transaction.commit().map_err(storage_error)?;

        // The same record that was stored, so what is returned cannot describe
        // something other than what is on disk.
        Ok(ImportResult {
            document,
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
        let records = self.records(&connection);
        records.trip(trip_id)?;
        records.candidates(trip_id, status)
    }

    /// A trip's notes. Absent notes are an empty body, not an error — "nothing
    /// written yet" is the normal first state, not a failure.
    pub fn get_trip_notes(&self, trip_id: &str) -> Result<TripNotes, AppError> {
        let connection = self.connection()?;
        let records = self.records(&connection);
        records.trip(trip_id)?;
        records.trip_notes(trip_id)
    }

    /// Replace a trip's notes. Clearing them removes the row rather than storing
    /// an empty string, so "no notes" is one state and not two.
    pub fn set_trip_notes(&self, trip_id: &str, body: &str) -> Result<TripNotes, AppError> {
        if body.chars().count() > MAX_NOTES_CHARS {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidInput,
                "those notes are too long to store",
            ));
        }
        let connection = self.connection()?;
        let records = self.records(&connection);
        records.trip(trip_id)?;
        if body.is_empty() {
            records.delete_trip_notes(trip_id)?;
            return Ok(TripNotes {
                trip_id: trip_id.to_owned(),
                body: String::new(),
                updated_at: None,
            });
        }
        let updated_at = now_rfc3339();
        records.upsert_trip_notes(trip_id, body, &new_id("notes"), &updated_at)?;
        Ok(TripNotes {
            trip_id: trip_id.to_owned(),
            body: body.to_owned(),
            updated_at: Some(updated_at),
        })
    }

    /// Every document imported into a trip, newest first, each with the counts
    /// that make deleting it an informed choice. Bodies are never read here —
    /// this list must stay cheap, and an unsealed body has no business in a
    /// listing.
    pub fn list_documents(&self, trip_id: &str) -> Result<Vec<DocumentSummary>, AppError> {
        let connection = self.connection()?;
        self.records(&connection).trip(trip_id)?;
        let mut statement = connection
            .prepare(
                "SELECT d.id, d.trip_id, d.kind, d.label, d.content_hash, d.char_count, d.imported_at,
                        (SELECT COUNT(*) FROM candidate_facts c
                          WHERE c.document_id = d.id AND c.status = 'pending'),
                        (SELECT COUNT(*) FROM candidate_facts c
                          WHERE c.document_id = d.id AND c.status = 'confirmed')
                 FROM source_documents d
                 WHERE d.trip_id = ?1
                 ORDER BY d.imported_at DESC, d.id DESC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok(DocumentSummary {
                    document: SourceDocument {
                        id: row.get(0)?,
                        trip_id: row.get(1)?,
                        kind: sql_to_enum(row.get::<_, String>(2)?)?,
                        label: row.get(3)?,
                        content_hash: row.get(4)?,
                        char_count: row.get(5)?,
                        imported_at: row.get(6)?,
                    },
                    pending_count: row.get(7)?,
                    confirmed_count: row.get(8)?,
                })
            })
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    /// One document's original text, unsealed on demand. This is the only path
    /// that returns an imported body, and it exists so a traveler can see what
    /// they handed over — the same bytes the parser read.
    pub fn get_document(&self, document_id: &str) -> Result<DocumentContent, AppError> {
        let connection = self.connection()?;
        self.records(&connection).document_content(document_id)
    }

    /// Delete an imported document.
    ///
    /// Cascade rules, chosen deliberately (see the audit plan's 6a):
    /// - Still-pending candidates go too — they are unreviewed derivatives of a
    ///   body the traveler just discarded, and reviewing evidence that no longer
    ///   exists is not a flow worth keeping.
    /// - Facts already confirmed from it STAY. The traveler approved those; they
    ///   are part of the itinerary now. They are flagged `source_removed` so the
    ///   UI stops offering evidence it cannot show. The FK does the nulling of
    ///   `candidate_id`; the flag is what keeps that from reading as "manual".
    pub fn delete_document(&self, document_id: &str) -> Result<(), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        // Flag surviving facts BEFORE the delete: once the candidate rows are
        // gone the join that identifies them is gone too.
        transaction
            .execute(
                "UPDATE confirmed_facts SET source_removed = 1
                 WHERE candidate_id IN
                   (SELECT id FROM candidate_facts WHERE document_id = ?1)",
                params![document_id],
            )
            .map_err(storage_error)?;
        let deleted = transaction
            .execute(
                "DELETE FROM source_documents WHERE id = ?1",
                params![document_id],
            )
            .map_err(storage_error)?;
        if deleted == 0 {
            return Err(AppError::new(
                ErrorCode::DocumentNotFound,
                "that document no longer exists",
            ));
        }
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    pub fn confirm_candidate(
        &self,
        input: ConfirmCandidateInput,
    ) -> Result<(CandidateFact, ConfirmedFact), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = self.records(&transaction).candidate(&input.candidate_id)?;
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
            source_removed: false,
        };
        self.records(&transaction)
            .insert_confirmed_fact(&confirmed)?;

        candidate.status = CandidateStatus::Confirmed;
        candidate.resolved_at = Some(confirmed.confirmed_at.clone());
        self.records(&transaction)
            .update_candidate_resolution(&candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok((candidate, confirmed))
    }

    pub fn reject_candidate(&self, candidate_id: &str) -> Result<CandidateFact, AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = self.records(&transaction).candidate(candidate_id)?;
        ensure_candidate_pending(&candidate)?;
        candidate.status = CandidateStatus::Rejected;
        candidate.resolved_at = Some(now_rfc3339());
        self.records(&transaction)
            .update_candidate_resolution(&candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok(candidate)
    }

    pub fn add_manual_fact(&self, input: AddManualFactInput) -> Result<ConfirmedFact, AppError> {
        validate_fact_payload(input.fact_type, &input.payload)?;
        let connection = self.connection()?;
        self.records(&connection).trip(&input.trip_id)?;
        let confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: input.trip_id,
            fact_type: input.fact_type,
            payload: input.payload,
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: now_rfc3339(),
            source_removed: false,
        };
        self.records(&connection)
            .insert_confirmed_fact(&confirmed)?;
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
        self.records(&connection).trip(trip_id)
    }

    /// Reads and writes for the sealed records, over `connection` and this
    /// service's vault — so no call site threads `&Vault` alongside `&Connection`.
    fn records<'a>(&'a self, connection: &'a Connection) -> Records<'a> {
        Records::new(connection, &self.vault)
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
/// The decrypted snapshot waiting to become the workspace at the next launch.
const PENDING_RESTORE_FILE: &str = "pending-restore.sqlite3";
/// The marker that says a staged restore is ready. Written last and removed
/// first, so a crash at any point leaves no half-applied restore.
const PENDING_RESTORE_MARKER: &str = "pending-restore.json";
/// Where the backup's data key waits between staging and applying.
const VAULT_PENDING_KEY_ACCOUNT: &str = "vault.pending_data_key";

/// The marker's contents. Metadata only — the snapshot holds the trip data and
/// the keychain holds the key.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRestore {
    created_at: String,
    app_version: String,
    schema_version: i64,
    /// Whether a data key was staged. `false` means the backup came from a
    /// vault with no key at all (a keychain-less host), so the restored
    /// workspace must start a fresh one rather than keep this machine's.
    key_present: bool,
}

/// Apply a staged restore, if one is waiting, **before** the database is opened.
///
/// Doing the swap here rather than under a live connection is the whole point:
/// no open SQLite handle has to be surgically replaced, and on Windows nothing
/// holds a lock on the file being overwritten. The current workspace is
/// snapshotted first, so a mistaken restore is reversible.
fn apply_pending_restore(
    secrets: &dyn SecretStore,
    database_path: &Path,
) -> Result<bool, AppError> {
    let Some(dir) = database_path.parent() else {
        return Ok(false);
    };
    let marker_path = dir.join(PENDING_RESTORE_MARKER);
    let staged_path = dir.join(PENDING_RESTORE_FILE);
    // Both halves must be present; a lone marker or a lone snapshot is the
    // debris of an interrupted stage and is cleaned up rather than applied.
    if !marker_path.exists() || !staged_path.exists() {
        let _ = fs::remove_file(&marker_path);
        let _ = fs::remove_file(&staged_path);
        return Ok(false);
    }
    let marker: PendingRestore = fs::read(&marker_path)
        .map_err(storage_error)
        .and_then(|raw| {
            serde_json::from_slice(&raw).map_err(|_| {
                AppError::new(
                    ErrorCode::StorageFailure,
                    "the pending restore could not be read",
                )
            })
        })?;

    // Snapshot what is about to be replaced.
    if database_path.exists() {
        let backups_dir = dir.join("backups");
        fs::create_dir_all(&backups_dir).map_err(storage_error)?;
        let stamp = filesystem_stamp(&now_rfc3339());
        let mut dest = backups_dir.join(format!("pre-restore-{stamp}.sqlite3"));
        let mut collision = 1;
        while dest.exists() {
            dest = backups_dir.join(format!("pre-restore-{stamp}-{collision}.sqlite3"));
            collision += 1;
        }
        fs::copy(database_path, &dest).map_err(storage_error)?;
        prune_backups(&backups_dir, MAX_BACKUPS)?;
    }

    // Same directory, so this is an atomic swap.
    fs::rename(&staged_path, database_path).map_err(storage_error)?;
    // Any journal beside the replaced database describes the old file.
    for suffix in ["-wal", "-shm"] {
        let mut stray = database_path.as_os_str().to_owned();
        stray.push(suffix);
        let _ = fs::remove_file(PathBuf::from(stray));
    }

    // Install the key the backup carried, so its sealed rows open here. Without
    // a carried key the restored rows are plaintext and a fresh key is
    // generated on open, which then seals them.
    match (marker.key_present, secrets.get(VAULT_PENDING_KEY_ACCOUNT)?) {
        (true, Some(key)) => secrets.set(VAULT_KEY_ACCOUNT, &key)?,
        _ => {
            let _ = secrets.delete(VAULT_KEY_ACCOUNT);
        }
    }
    let _ = secrets.delete(VAULT_PENDING_KEY_ACCOUNT);
    fs::remove_file(&marker_path).map_err(storage_error)?;
    Ok(true)
}

/// Drop a passphrase wrap carried in from a restored database, so the workspace
/// opens in keychain mode against the key the backup brought with it.
fn clear_vault_wrap(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute("DELETE FROM vault_meta WHERE id = 1", [])
        .map_err(storage_error)?;
    Ok(())
}

/// Does this filename belong to one of our safety snapshots? Both kinds count:
/// the pre-update net and the pre-restore one. They are retained and erased
/// together — either sort outlives a deleted trip, so neither may escape the
/// retention cap or the "clear backups" affordance.
fn has_backup_snapshot_prefix(name: &str) -> bool {
    name.starts_with("pre-update-") || name.starts_with("pre-restore-")
}

/// A complete snapshot file, as opposed to a `-wal`/`-shm` stray beside one.
fn is_backup_snapshot(name: &str) -> bool {
    has_backup_snapshot_prefix(name) && name.ends_with(".sqlite3")
}

fn prune_backups(dir: &Path, keep: usize) -> Result<(), AppError> {
    let mut backups: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(dir)
        .map_err(storage_error)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_backup_snapshot)
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

fn offline_map_path(
    database_path: &Path,
    pack_id: &str,
    descriptor: &OfflineMapDescriptor,
) -> Result<PathBuf, AppError> {
    let data_dir = database_path.parent().ok_or_else(|| {
        AppError::new(
            ErrorCode::StorageFailure,
            "database has no parent directory for offline maps",
        )
    })?;
    Ok(data_dir
        .join("packs")
        .join(format!("{pack_id}-{}.pmtiles", descriptor.sha256)))
}

fn offline_map_is_ready(
    database_path: &Path,
    pack_id: &str,
    descriptor: &OfflineMapDescriptor,
) -> bool {
    let Ok(path) = offline_map_path(database_path, pack_id, descriptor) else {
        return false;
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != descriptor.byte_length {
        return false;
    }
    fs::read(path)
        .ok()
        .is_some_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == descriptor.sha256)
}

fn store_offline_map(
    database_path: &Path,
    pack_id: &str,
    descriptor: &OfflineMapDescriptor,
    bytes: &[u8],
) -> Result<(), AppError> {
    if bytes.len() as u64 != descriptor.byte_length
        || format!("{:x}", Sha256::digest(bytes)) != descriptor.sha256
    {
        return Err(AppError::new(
            ErrorCode::PackDownloadFailed,
            "the offline map failed its size or checksum verification",
        ));
    }
    let destination = offline_map_path(database_path, pack_id, descriptor)?;
    let directory = destination.parent().ok_or_else(|| {
        AppError::new(
            ErrorCode::StorageFailure,
            "offline map has no parent directory",
        )
    })?;
    fs::create_dir_all(directory).map_err(storage_error)?;
    let temporary = directory.join(format!(".{pack_id}-{}.part", new_id("map")));
    fs::write(&temporary, bytes).map_err(storage_error)?;
    if destination.exists() {
        fs::remove_file(&destination).map_err(storage_error)?;
    }
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(storage_error(error));
    }
    Ok(())
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

            -- Free text the traveler wrote about a trip. Sealed at rest (see
            -- SEALED_COLUMNS). It carries an `id` so the seal-on-activation
            -- migration, which keys on `id`, covers it like every other
            -- sensitive column. One row per trip, enforced by the UNIQUE.
            CREATE TABLE IF NOT EXISTS trip_notes (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
                body TEXT NOT NULL,
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
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual', 'assisted')),
                field_spans TEXT NOT NULL,
                warnings TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
                created_at TEXT NOT NULL,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS advisory_snapshots (
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                source TEXT NOT NULL CHECK (source IN ('uk-fcdo', 'us-state', 'ca-gac', 'de-aa')),
                source_name TEXT NOT NULL,
                country_name TEXT NOT NULL,
                level_label TEXT,
                level_rank INTEGER,
                summary TEXT NOT NULL,
                source_url TEXT NOT NULL,
                source_updated_at TEXT,
                change_description TEXT,
                language TEXT NOT NULL,
                attribution TEXT NOT NULL,
                retrieved_at TEXT NOT NULL,
                PRIMARY KEY (trip_id, source)
            );

            CREATE TABLE IF NOT EXISTS advisory_panels (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                country_slug TEXT NOT NULL,
                country_name TEXT NOT NULL,
                health_notices TEXT NOT NULL,
                source_status TEXT NOT NULL,
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
                retrieved_at TEXT NOT NULL,
                normals TEXT,
                air_quality TEXT NOT NULL DEFAULT '[]',
                alerts TEXT NOT NULL DEFAULT '[]'
            );

            CREATE TABLE IF NOT EXISTS destination_facts_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                place_name TEXT NOT NULL,
                place_region TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                utc_offset_minutes INTEGER NOT NULL,
                country_code TEXT NOT NULL,
                rate_date TEXT NOT NULL,
                currency_rates TEXT NOT NULL DEFAULT '[]',
                retrieved_at TEXT NOT NULL,
                origin_place TEXT,
                origin_utc_offset_minutes INTEGER
            );

            CREATE TABLE IF NOT EXISTS public_holidays_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                country_code TEXT NOT NULL,
                country_name TEXT NOT NULL,
                holidays TEXT NOT NULL DEFAULT '[]',
                retrieved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS place_summaries (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                extract TEXT NOT NULL,
                url TEXT NOT NULL,
                retrieved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS confirmed_facts (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual', 'assisted')),
                candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                corrected_fields TEXT NOT NULL,
                confirmed_at TEXT NOT NULL,
                -- Set when the document this fact came from is deleted. The fact
                -- stays (the traveler approved it); only its evidence is gone.
                source_removed INTEGER NOT NULL DEFAULT 0
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

            ",
        )
        .map_err(storage_error)?;
    migrate(connection)
}

/// How many past years of observed weather a normals claim samples.
const NORMALS_YEARS: u32 = 10;

/// One schema step. `to` is the `PRAGMA user_version` the database carries once
/// `run` succeeds.
struct Migration {
    to: i64,
    /// Named for the failure message; the version is what actually identifies it.
    name: &'static str,
    run: fn(&Connection) -> Result<(), AppError>,
}

/// The schema steps, in the order they must run. **Append only** — a step's `to`
/// is recorded in every database that has run it, so renumbering or reordering
/// rewrites history that already shipped.
///
/// Order is the array, not a comment: `add_source_removed` has to follow
/// `widen_method_check`, which rebuilds `confirmed_facts` with a `SELECT *` copy
/// into an eight-column table. Adding the column first would push nine columns
/// into it and fail on exactly the old databases it exists to rescue.
///
/// Both steps below detect their own applicability because they predate this
/// ledger: every build since the first stamped `user_version = 1` on open no
/// matter what shape the database was in, so version 1 means "some legacy shape"
/// rather than a known one. Steps added from here on can trust the version and
/// need no detection.
const MIGRATIONS: &[Migration] = &[
    Migration {
        to: 2,
        name: "widen_method_check",
        run: migrate_method_check,
    },
    Migration {
        to: 3,
        name: "add_source_removed",
        run: migrate_source_removed,
    },
    Migration {
        to: 4,
        name: "advisory_panel_tables",
        run: migrate_advisory_panel,
    },
    Migration {
        to: 5,
        name: "weather_layers",
        run: migrate_weather_layers,
    },
    Migration {
        to: 6,
        name: "destination_facts",
        run: migrate_destination_facts,
    },
    Migration {
        to: 7,
        name: "facts_origin",
        run: migrate_facts_origin,
    },
    Migration {
        to: 8,
        name: "public_holidays",
        run: migrate_public_holidays,
    },
    Migration {
        to: 9,
        name: "place_summaries",
        run: migrate_place_summaries,
    },
    Migration {
        to: 10,
        name: "traveler_planning",
        run: migrate_traveler_planning,
    },
];

/// The version a fully migrated database carries. Stamped into a backup's
/// manifest so a restore can refuse a snapshot from a newer schema.
fn target_schema_version() -> i64 {
    MIGRATIONS.last().map_or(0, |migration| migration.to)
}

fn user_version(connection: &Connection) -> Result<i64, AppError> {
    connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(storage_error)
}

/// Bring the database up to [`target_schema_version`], running each pending step
/// once and recording it before the next begins.
///
/// A step that fails leaves the version at the last one that succeeded, so the
/// next open retries from there rather than skipping ahead.
fn migrate(connection: &Connection) -> Result<(), AppError> {
    let mut version = user_version(connection)?;
    for migration in MIGRATIONS {
        if version >= migration.to {
            continue;
        }
        (migration.run)(connection).map_err(|error| {
            AppError::with_detail(
                error.code,
                error.message,
                "migration",
                format!("{} (to v{})", migration.name, migration.to),
            )
        })?;
        // PRAGMA values cannot be bound; `to` is a compile-time constant.
        connection
            .execute_batch(&format!("PRAGMA user_version = {};", migration.to))
            .map_err(storage_error)?;
        version = migration.to;
    }
    Ok(())
}

/// Add traveler-owned planning records. These tables intentionally sit beside,
/// rather than inside, the evidence tables so a saved idea or manual activity
/// can never be mistaken for a confirmed fact.
fn migrate_traveler_planning(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS trip_interest_profiles (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                food REAL NOT NULL CHECK(food BETWEEN 0 AND 1),
                culture REAL NOT NULL CHECK(culture BETWEEN 0 AND 1),
                nature REAL NOT NULL CHECK(nature BETWEEN 0 AND 1),
                nightlife REAL NOT NULL CHECK(nightlife BETWEEN 0 AND 1),
                shopping REAL NOT NULL CHECK(shopping BETWEEN 0 AND 1),
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS saved_places (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                pack_id TEXT NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                dimension TEXT NOT NULL,
                lat REAL NOT NULL,
                lon REAL NOT NULL,
                source TEXT NOT NULL,
                license TEXT NOT NULL,
                reasons_json TEXT NOT NULL,
                wildcard INTEGER NOT NULL CHECK(wildcard IN (0, 1)),
                notes TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(trip_id, pack_id, name, lat, lon)
            );

            CREATE TABLE IF NOT EXISTS packing_items (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                label TEXT NOT NULL,
                checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0, 1)),
                suggestion_code TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS packing_items_suggestion
                ON packing_items(trip_id, suggestion_code)
                WHERE suggestion_code IS NOT NULL;

            CREATE TABLE IF NOT EXISTS trip_items (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('activity', 'rail', 'transfer')),
                title TEXT NOT NULL,
                location TEXT,
                start_at TEXT,
                end_at TEXT,
                notes TEXT,
                saved_place_id TEXT REFERENCES saved_places(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );",
        )
        .map_err(storage_error)
}

/// Add `source_removed` to `confirmed_facts` for databases created before the
/// documents manager existed. Detects its own applicability: it inspects the
/// table's columns and adds the column only when absent, so a fresh install is a
/// no-op. See [`MIGRATIONS`] for why this one still detects.
fn migrate_source_removed(connection: &Connection) -> Result<(), AppError> {
    let present = {
        let mut statement = connection
            .prepare("PRAGMA table_info(confirmed_facts)")
            .map_err(storage_error)?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(storage_error)?;
        columns.iter().any(|name| name == "source_removed")
    };
    if present {
        return Ok(());
    }
    connection
        .execute_batch(
            "ALTER TABLE confirmed_facts
             ADD COLUMN source_removed INTEGER NOT NULL DEFAULT 0;",
        )
        .map_err(storage_error)
}

/// Replace the single-row `travel_advice_snapshots` table with the per-source
/// `advisory_snapshots` + `advisory_panels` pair, carrying any stored UK
/// snapshot forward as a `uk-fcdo` entry.
///
/// The migrated panel records **no** `source_status`. A status describes the
/// outcome of the last fetch attempt under the new model, and a migrated row is
/// not the result of any such attempt: claiming `fresh` would assert the copy
/// was just fetched, and `kept` would assert a fetch failed. Neither happened.
/// The entry's own `retrieved_at` carries the honesty until the next fetch.
fn migrate_advisory_panel(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS advisory_snapshots (
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                source TEXT NOT NULL CHECK (source IN ('uk-fcdo', 'us-state', 'ca-gac', 'de-aa')),
                source_name TEXT NOT NULL,
                country_name TEXT NOT NULL,
                level_label TEXT,
                level_rank INTEGER,
                summary TEXT NOT NULL,
                source_url TEXT NOT NULL,
                source_updated_at TEXT,
                change_description TEXT,
                language TEXT NOT NULL,
                attribution TEXT NOT NULL,
                retrieved_at TEXT NOT NULL,
                PRIMARY KEY (trip_id, source)
            );

            CREATE TABLE IF NOT EXISTS advisory_panels (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                country_slug TEXT NOT NULL,
                country_name TEXT NOT NULL,
                health_notices TEXT NOT NULL,
                source_status TEXT NOT NULL,
                retrieved_at TEXT NOT NULL
            );",
        )
        .map_err(storage_error)?;

    let legacy_present: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master
             WHERE type = 'table' AND name = 'travel_advice_snapshots'",
            [],
            |row| row.get(0),
        )
        .map_err(storage_error)?;
    if legacy_present == 0 {
        return Ok(());
    }

    struct LegacyRow {
        trip_id: String,
        country_slug: String,
        country_name: String,
        source_url: String,
        summary: String,
        alert_status: Vec<String>,
        source_updated_at: Option<String>,
        change_description: Option<String>,
        retrieved_at: String,
    }

    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT trip_id, country_slug, country_name, source_url, summary,
                        alert_status, source_updated_at, change_description, retrieved_at
                 FROM travel_advice_snapshots",
            )
            .map_err(storage_error)?;
        statement
            .query_map([], |row| {
                Ok(LegacyRow {
                    trip_id: row.get(0)?,
                    country_slug: row.get(1)?,
                    country_name: row.get(2)?,
                    source_url: row.get(3)?,
                    summary: row.get(4)?,
                    alert_status: sql_to_json(row.get::<_, String>(5)?)?,
                    source_updated_at: row.get(6)?,
                    change_description: row.get(7)?,
                    retrieved_at: row.get(8)?,
                })
            })
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<LegacyRow>>>()
            .map_err(storage_error)?
    };

    for row in rows {
        connection
            .execute(
                "INSERT OR REPLACE INTO advisory_snapshots
                 (trip_id, source, source_name, country_name, level_label, level_rank,
                  summary, source_url, source_updated_at, change_description, language,
                  attribution, retrieved_at)
                 VALUES (?1, 'uk-fcdo', ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, 'en', ?9, ?10)",
                params![
                    row.trip_id,
                    "UK Foreign, Commonwealth & Development Office",
                    row.country_name,
                    (!row.alert_status.is_empty()).then(|| row.alert_status.join(", ")),
                    row.summary,
                    row.source_url,
                    row.source_updated_at,
                    row.change_description,
                    "Open Government Licence v3.0",
                    row.retrieved_at,
                ],
            )
            .map_err(storage_error)?;
        connection
            .execute(
                "INSERT OR REPLACE INTO advisory_panels
                 (trip_id, country_slug, country_name, health_notices, source_status, retrieved_at)
                 VALUES (?1, ?2, ?3, '[]', '[]', ?4)",
                params![
                    row.trip_id,
                    row.country_slug,
                    row.country_name,
                    row.retrieved_at
                ],
            )
            .map_err(storage_error)?;
    }

    connection
        .execute_batch("DROP TABLE travel_advice_snapshots;")
        .map_err(storage_error)
}

/// Create the `destination_facts_snapshots` table for databases that predate
/// the facts card. Purely additive — nothing to backfill.
fn migrate_destination_facts(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS destination_facts_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                place_name TEXT NOT NULL,
                place_region TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                utc_offset_minutes INTEGER NOT NULL,
                country_code TEXT NOT NULL,
                rate_date TEXT NOT NULL,
                currency_rates TEXT NOT NULL DEFAULT '[]',
                retrieved_at TEXT NOT NULL
            );",
        )
        .map_err(storage_error)
}

/// Add the origin place and offset columns to `destination_facts_snapshots`, so
/// a stored snapshot can carry the destination-vs-home time difference.
///
/// Self-detecting: a fresh database runs the base schema (which already carries
/// these columns) and then every migration from zero, so this step must find
/// the columns present and do nothing rather than fail on a duplicate `ADD`.
fn migrate_facts_origin(connection: &Connection) -> Result<(), AppError> {
    let present = {
        let mut statement = connection
            .prepare("PRAGMA table_info(destination_facts_snapshots)")
            .map_err(storage_error)?;
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(storage_error)?;
        columns.iter().any(|name| name == "origin_place")
    };
    if present {
        return Ok(());
    }
    connection
        .execute_batch(
            "ALTER TABLE destination_facts_snapshots ADD COLUMN origin_place TEXT;
             ALTER TABLE destination_facts_snapshots ADD COLUMN origin_utc_offset_minutes INTEGER;",
        )
        .map_err(storage_error)
}

/// Create the `public_holidays_snapshots` table for databases that predate the
/// holidays panel. Purely additive — nothing to backfill.
fn migrate_public_holidays(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS public_holidays_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                country_code TEXT NOT NULL,
                country_name TEXT NOT NULL,
                holidays TEXT NOT NULL DEFAULT '[]',
                retrieved_at TEXT NOT NULL
            );",
        )
        .map_err(storage_error)
}

/// Create the `place_summaries` table for databases that predate the "about
/// this place" panel. Purely additive — nothing to backfill.
fn migrate_place_summaries(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS place_summaries (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                extract TEXT NOT NULL,
                url TEXT NOT NULL,
                retrieved_at TEXT NOT NULL
            );",
        )
        .map_err(storage_error)
}

/// Add the normals / air-quality / alerts columns to `weather_snapshots`.
///
/// Existing rows keep their forecast and simply carry no extra layers until the
/// next fetch: a stored outlook is still true, it just says less.
fn migrate_weather_layers(connection: &Connection) -> Result<(), AppError> {
    let existing = {
        let mut statement = connection
            .prepare("PRAGMA table_info(weather_snapshots)")
            .map_err(storage_error)?;
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(storage_error)?
    };
    // No table, nothing to widen: the base schema creates it already carrying
    // these columns, so this step only has work to do on databases that predate
    // them.
    if existing.is_empty() {
        return Ok(());
    }
    for (column, ddl) in [
        (
            "normals",
            "ALTER TABLE weather_snapshots ADD COLUMN normals TEXT;",
        ),
        (
            "air_quality",
            "ALTER TABLE weather_snapshots ADD COLUMN air_quality TEXT NOT NULL DEFAULT '[]';",
        ),
        (
            "alerts",
            "ALTER TABLE weather_snapshots ADD COLUMN alerts TEXT NOT NULL DEFAULT '[]';",
        ),
    ] {
        if existing.iter().any(|name| name == column) {
            continue;
        }
        connection.execute_batch(ddl).map_err(storage_error)?;
    }
    Ok(())
}

/// Widen the `method` CHECK on the fact tables to allow 'assisted', for databases
/// created before on-device drafts existed.
///
/// Detects its own applicability: it inspects each table's stored SQL and
/// rebuilds only when the constraint predates the new value (a fresh install
/// already includes it, so this is a no-op). See [`MIGRATIONS`] for why this one
/// still detects. The rebuild is a plain row copy — no re-encryption — done
/// with foreign keys disabled so the `confirmed_facts → candidate_facts`
/// reference survives the drop-and-rename, then re-enabled.
fn migrate_method_check(connection: &Connection) -> Result<(), AppError> {
    let is_stale = |table: &str| -> Result<bool, AppError> {
        let sql: Option<String> = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
                params![table],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?;
        Ok(sql.is_some_and(|sql| !sql.contains("'assisted'")))
    };
    if !is_stale("candidate_facts")? && !is_stale("confirmed_facts")? {
        return Ok(());
    }

    // FK enforcement cannot change inside a transaction, so toggle it around one.
    connection
        .execute_batch("PRAGMA foreign_keys = OFF;")
        .map_err(storage_error)?;
    let rebuilt = connection
        .execute_batch(
            "BEGIN;
             CREATE TABLE candidate_facts_migrated (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual', 'assisted')),
                field_spans TEXT NOT NULL,
                warnings TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
                created_at TEXT NOT NULL,
                resolved_at TEXT
             );
             INSERT INTO candidate_facts_migrated SELECT * FROM candidate_facts;
             DROP TABLE candidate_facts;
             ALTER TABLE candidate_facts_migrated RENAME TO candidate_facts;
             CREATE TABLE confirmed_facts_migrated (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual', 'assisted')),
                candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                corrected_fields TEXT NOT NULL,
                confirmed_at TEXT NOT NULL
             );
             INSERT INTO confirmed_facts_migrated SELECT * FROM confirmed_facts;
             DROP TABLE confirmed_facts;
             ALTER TABLE confirmed_facts_migrated RENAME TO confirmed_facts;
             COMMIT;",
        )
        .map_err(storage_error);
    // Restore FK enforcement whether or not the rebuild succeeded.
    let _ = connection.execute_batch("PRAGMA foreign_keys = ON;");
    rebuilt
}

/// The wire/storage tag for one government. Kept next to the CHECK constraint
/// that mirrors it so the two cannot drift apart silently.
fn advisory_source_tag(source: AdvisorySource) -> &'static str {
    match source {
        AdvisorySource::UkFcdo => "uk-fcdo",
        AdvisorySource::UsState => "us-state",
        AdvisorySource::CaGac => "ca-gac",
        AdvisorySource::DeAa => "de-aa",
    }
}

fn advisory_source_from_tag(tag: &str) -> Option<AdvisorySource> {
    match tag {
        "uk-fcdo" => Some(AdvisorySource::UkFcdo),
        "us-state" => Some(AdvisorySource::UsState),
        "ca-gac" => Some(AdvisorySource::CaGac),
        "de-aa" => Some(AdvisorySource::DeAa),
        _ => None,
    }
}

/// Upsert one government's entry. Storing the same source twice replaces it:
/// a trip carries one current copy per government, not a history.
fn store_advisory_entry(
    connection: &Connection,
    trip_id: &str,
    entry: &AdvisoryEntry,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO advisory_snapshots
             (trip_id, source, source_name, country_name, level_label, level_rank,
              summary, source_url, source_updated_at, change_description, language,
              attribution, retrieved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(trip_id, source) DO UPDATE SET
               source_name = excluded.source_name,
               country_name = excluded.country_name,
               level_label = excluded.level_label,
               level_rank = excluded.level_rank,
               summary = excluded.summary,
               source_url = excluded.source_url,
               source_updated_at = excluded.source_updated_at,
               change_description = excluded.change_description,
               language = excluded.language,
               attribution = excluded.attribution,
               retrieved_at = excluded.retrieved_at",
            params![
                trip_id,
                advisory_source_tag(entry.source),
                entry.source_name,
                entry.country_name,
                entry.level_label,
                entry.level_rank,
                entry.summary,
                entry.source_url,
                entry.source_updated_at,
                entry.change_description,
                entry.language,
                entry.attribution,
                entry.retrieved_at,
            ],
        )
        .map(|_| ())
        .map_err(storage_error)
}

/// Drop one government's stored entry — used when that government withdraws
/// its advisory, so a stale card cannot linger.
fn delete_advisory_entry(
    connection: &Connection,
    trip_id: &str,
    source: AdvisorySource,
) -> Result<(), AppError> {
    connection
        .execute(
            "DELETE FROM advisory_snapshots WHERE trip_id = ?1 AND source = ?2",
            params![trip_id, advisory_source_tag(source)],
        )
        .map(|_| ())
        .map_err(storage_error)
}

/// Write the panel-level row: which country it is about, the health notices,
/// and what happened to each source on the last attempt.
fn store_advisory_panel_meta(
    connection: &Connection,
    trip_id: &str,
    country_slug: &str,
    country_name: &str,
    health_notices: &[HealthNotice],
    source_status: &[SourceStatus],
    retrieved_at: &str,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO advisory_panels
             (trip_id, country_slug, country_name, health_notices, source_status, retrieved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(trip_id) DO UPDATE SET
               country_slug = excluded.country_slug,
               country_name = excluded.country_name,
               health_notices = excluded.health_notices,
               source_status = excluded.source_status,
               retrieved_at = excluded.retrieved_at",
            params![
                trip_id,
                country_slug,
                country_name,
                json_to_sql(&health_notices.to_vec())?,
                json_to_sql(&source_status.to_vec())?,
                retrieved_at,
            ],
        )
        .map(|_| ())
        .map_err(storage_error)
}

/// Assemble the stored panel. `None` when this trip has never fetched one.
fn load_advisory_panel(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<AdvisoryPanel>, AppError> {
    let meta = connection
        .query_row(
            "SELECT country_slug, country_name, health_notices, source_status, retrieved_at
             FROM advisory_panels WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    sql_to_json::<Vec<HealthNotice>>(row.get::<_, String>(2)?)?,
                    sql_to_json::<Vec<SourceStatus>>(row.get::<_, String>(3)?)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(storage_error)?;
    let Some((country_slug, country_name, health_notices, source_status, retrieved_at)) = meta
    else {
        return Ok(None);
    };

    let mut statement = connection
        .prepare(
            "SELECT source, source_name, country_name, level_label, level_rank, summary,
                    source_url, source_updated_at, change_description, language,
                    attribution, retrieved_at
             FROM advisory_snapshots WHERE trip_id = ?1
             ORDER BY CASE source
                        WHEN 'uk-fcdo' THEN 0
                        WHEN 'us-state' THEN 1
                        WHEN 'ca-gac' THEN 2
                        ELSE 3
                      END",
        )
        .map_err(storage_error)?;
    let entries = statement
        .query_map(params![trip_id], |row| {
            let tag: String = row.get(0)?;
            Ok(advisory_source_from_tag(&tag).map(|source| AdvisoryEntry {
                source,
                source_name: row.get(1).unwrap_or_default(),
                country_name: row.get(2).unwrap_or_default(),
                level_label: row.get(3).unwrap_or_default(),
                level_rank: row.get(4).unwrap_or_default(),
                summary: row.get(5).unwrap_or_default(),
                source_url: row.get(6).unwrap_or_default(),
                source_updated_at: row.get(7).unwrap_or_default(),
                change_description: row.get(8).unwrap_or_default(),
                language: row.get(9).unwrap_or_default(),
                attribution: row.get(10).unwrap_or_default(),
                retrieved_at: row.get(11).unwrap_or_default(),
            }))
        })
        .map_err(storage_error)?
        .collect::<rusqlite::Result<Vec<Option<AdvisoryEntry>>>>()
        .map_err(storage_error)?
        .into_iter()
        .flatten()
        .collect();

    Ok(Some(AdvisoryPanel {
        country_slug,
        country_name,
        entries,
        health_notices,
        source_status,
        retrieved_at,
    }))
}

/// Resolve an IANA timezone name to its UTC offset in minutes on a given date.
/// An unknown or empty name resolves to UTC rather than guessing — jiff bundles
/// the tz database on platforms without a system one, so this works offline.
fn offset_minutes_for(timezone: &str, on_date: &str) -> i32 {
    if timezone.is_empty() {
        return 0;
    }
    let Ok(tz) = jiff::tz::TimeZone::get(timezone) else {
        return 0;
    };
    let Ok(date) = on_date.parse::<jiff::civil::Date>() else {
        return 0;
    };
    // Noon avoids landing exactly on a DST transition boundary.
    let Ok(datetime) = date.at(12, 0, 0, 0).to_zoned(tz) else {
        return 0;
    };
    datetime.offset().seconds() / 60
}

/// The sun/moon days for the trip window, computed from a stored snapshot's
/// coordinates and offset. Capped so a very long trip stays bounded.
fn derive_astro(snapshot: &DestinationFactsSnapshot, trip: &Trip) -> Vec<AstroDay> {
    const MAX_ASTRO_DAYS: usize = 16;
    let (Ok(start), Ok(end)) = (
        trip.start_date.parse::<jiff::civil::Date>(),
        trip.end_date.parse::<jiff::civil::Date>(),
    ) else {
        return Vec::new();
    };
    let mut days = Vec::new();
    let mut date = start;
    while date <= end && days.len() < MAX_ASTRO_DAYS {
        if let Ok(day) = compute_astro_day(
            snapshot.latitude,
            snapshot.longitude,
            &date.to_string(),
            snapshot.utc_offset_minutes,
        ) {
            days.push(day);
        }
        let Ok(next) = date.tomorrow() else { break };
        date = next;
    }
    days
}

fn load_destination_facts_snapshot(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<DestinationFactsSnapshot>, AppError> {
    connection
        .query_row(
            "SELECT place_name, place_region, latitude, longitude, utc_offset_minutes,
                    country_code, rate_date, currency_rates, retrieved_at,
                    origin_place, origin_utc_offset_minutes
             FROM destination_facts_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(DestinationFactsSnapshot {
                    place_name: row.get(0)?,
                    place_region: row.get(1)?,
                    latitude: row.get(2)?,
                    longitude: row.get(3)?,
                    utc_offset_minutes: row.get(4)?,
                    country_code: row.get(5)?,
                    rate_date: row.get(6)?,
                    currency_rates: sql_to_json(row.get::<_, String>(7)?)?,
                    retrieved_at: row.get(8)?,
                    origin_place: row.get(9)?,
                    origin_utc_offset_minutes: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

/// The distinct calendar years a trip's date window touches, for per-year
/// holiday lookups. Malformed dates yield no years rather than a guess.
fn trip_years(start_date: &str, end_date: &str) -> Vec<i32> {
    let year = |date: &str| date.get(0..4).and_then(|value| value.parse::<i32>().ok());
    match (year(start_date), year(end_date)) {
        (Some(start), Some(end)) if start <= end => (start..=end).collect(),
        (Some(only), None) | (None, Some(only)) | (Some(only), Some(_)) => vec![only],
        (None, None) => Vec::new(),
    }
}

fn load_public_holidays_snapshot(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<PublicHolidaysSnapshot>, AppError> {
    connection
        .query_row(
            "SELECT country_code, country_name, holidays, retrieved_at
             FROM public_holidays_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(PublicHolidaysSnapshot {
                    country_code: row.get(0)?,
                    country_name: row.get(1)?,
                    holidays: sql_to_json(row.get::<_, String>(2)?)?,
                    retrieved_at: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

fn load_place_summary(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<PlaceSummary>, AppError> {
    connection
        .query_row(
            "SELECT title, description, extract, url, retrieved_at
             FROM place_summaries WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(PlaceSummary {
                    title: row.get(0)?,
                    description: row.get(1)?,
                    extract: row.get(2)?,
                    url: row.get(3)?,
                    retrieved_at: row.get(4)?,
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
                    source_url, retrieved_at, normals, air_quality, alerts
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
                    normals: row
                        .get::<_, Option<String>>(8)?
                        .map(sql_to_json)
                        .transpose()?,
                    air_quality: sql_to_json(row.get::<_, String>(9)?)?,
                    alerts: sql_to_json(row.get::<_, String>(10)?)?,
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

/// Flag a proposed stay whose dates fall outside the trip window, so review
/// surfaces it. Deterministic ISO-date string comparison; other checks (e.g.
/// past dates) are left to the reviewer.
fn draft_window_warnings(trip: &Trip, proposal: &LodgingDateProposal) -> Vec<WarningCode> {
    let outside = |date: &Option<String>| {
        date.as_deref()
            .is_some_and(|d| d < trip.start_date.as_str() || d > trip.end_date.as_str())
    };
    if outside(&proposal.checkin_date) || outside(&proposal.checkout_date) {
        vec![WarningCode::OutsideTripWindow]
    } else {
        Vec::new()
    }
}

/// The app_settings key that holds a user override for one AI instruction.
fn ai_prompt_key(kind: AiPromptKind) -> &'static str {
    match kind {
        AiPromptKind::Assist => "ai_prompt.assist",
        AiPromptKind::DraftLodgingDates => "ai_prompt.draft_lodging_dates",
    }
}

/// The built-in default instruction for one AI kind.
fn ai_prompt_default(kind: AiPromptKind) -> &'static str {
    match kind {
        AiPromptKind::Assist => ASSIST_SYSTEM_PROMPT,
        AiPromptKind::DraftLodgingDates => DRAFT_LODGING_DATES_SYSTEM_PROMPT,
    }
}

fn validate_ai_prompt_kind(kind: &str) -> Result<AiPromptKind, AppError> {
    match kind {
        "assist" => Ok(AiPromptKind::Assist),
        "draft_lodging_dates" => Ok(AiPromptKind::DraftLodgingDates),
        _ => Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "unknown AI instruction",
            "field",
            "kind",
        )),
    }
}

/// Read one app_settings value on an existing connection.
fn read_app_setting(connection: &Connection, key: &str) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(storage_error)
}

/// The effective instruction for `kind`: the user's override, or the default.
fn effective_ai_prompt(connection: &Connection, kind: AiPromptKind) -> Result<String, AppError> {
    Ok(read_app_setting(connection, ai_prompt_key(kind))?
        .unwrap_or_else(|| ai_prompt_default(kind).to_owned()))
}

/// Swap a preview's system instruction for `prompt`, keeping the token estimate
/// honest. A no-op when the prompt is unchanged.
fn apply_prompt_override(preview: &mut AssistRequestPreview, prompt: String) {
    if prompt == preview.system_prompt {
        return;
    }
    preview.estimated_tokens = estimate_tokens(&prompt, &preview.user_content);
    preview.system_prompt = prompt;
}

/// Place names from a trip's downloaded packs, newest pack first. Pack contents
/// are not vault-sealed, so this reads regardless of vault state.
fn downloaded_pack_place_names(
    connection: &Connection,
    trip_id: &str,
) -> Result<Vec<String>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT content FROM downloaded_packs
             WHERE trip_id = ?1
             ORDER BY downloaded_at DESC, pack_id ASC",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![trip_id], |row| row.get::<_, String>(0))
        .map_err(storage_error)?;

    let mut names: Vec<String> = Vec::new();
    for row in rows {
        let content = row.map_err(storage_error)?;
        if let Ok(parsed) = serde_json::from_str::<PackContent>(&content) {
            names.extend(parsed.places.into_iter().map(|place| place.name));
        }
    }
    Ok(names)
}

fn collect_rows<T, F>(rows: rusqlite::MappedRows<'_, F>) -> Result<Vec<T>, AppError>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(rusqlite_to_app)
}

/// Convert a rusqlite error to an `AppError`.
///
/// No downcast: sealed columns are opened in [`records`], after rusqlite is done
/// with the row, so a vault error is returned directly instead of being smuggled
/// through `rusqlite::Error` and recovered here.
fn rusqlite_to_app(error: rusqlite::Error) -> AppError {
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

fn record_trip_id(
    connection: &Connection,
    table: &'static str,
    record_id: &str,
) -> Result<String, AppError> {
    debug_assert!(matches!(
        table,
        "saved_places" | "packing_items" | "trip_items"
    ));
    connection
        .query_row(
            &format!("SELECT trip_id FROM {table} WHERE id=?1"),
            params![record_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| {
            AppError::new(
                ErrorCode::ValidationInvalidInput,
                "planning record not found",
            )
        })
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
    use voyalier_core::KeyValidationStatus;
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
    fn traveler_planning_persists_without_becoming_confirmed_evidence() {
        struct PlanningPackFetcher;
        impl AdviceFetcher for PlanningPackFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Ok(serde_json::json!({
                    "packId": "us-nashville",
                    "places": [{
                        "name": "Frist Art Museum",
                        "category": "art_museum",
                        "lat": 36.156,
                        "lon": -86.783
                    }],
                    "articles": []
                })
                .to_string())
            }
        }

        let database = temp_database("traveler-planning");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(PlanningPackFetcher),
            secrets.clone(),
        )
        .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .download_pack(&trip.id, "us-nashville")
            .expect("pack");

        let profile = service
            .set_interest_profile(SetInterestProfileInput {
                trip_id: trip.id.clone(),
                weights: PersonaWeights {
                    culture: 1.0,
                    ..PersonaWeights::balanced()
                },
            })
            .expect("profile");
        let recommendation = service
            .get_recommendations(&trip.id, profile.weights)
            .expect("recommendations")
            .remove(0);
        let saved = service
            .save_place(SavePlaceInput {
                trip_id: trip.id.clone(),
                recommendation,
                notes: "Quiet morning option".to_owned(),
            })
            .expect("saved place");
        let packing = service
            .add_packing_item(AddPackingItemInput {
                trip_id: trip.id.clone(),
                label: "Museum pass".to_owned(),
                suggestion_code: None,
            })
            .expect("packing item");
        let activity = service
            .create_trip_item(CreateTripItemInput {
                trip_id: trip.id.clone(),
                kind: voyalier_core::TripItemKind::Activity,
                title: "Visit Frist".to_owned(),
                location: Some("Frist Art Museum".to_owned()),
                start_at: Some("2027-04-04T15:00:00".to_owned()),
                end_at: None,
                notes: Some("Use the saved shortlist".to_owned()),
                saved_place_id: Some(saved.id.clone()),
            })
            .expect("activity");

        // Removing the source pack keeps the provenance snapshot, while making
        // its unavailable state explicit. Promotion remains a separate record.
        service
            .delete_downloaded_pack(&trip.id, "us-nashville")
            .expect("delete pack");
        let detail = service.get_trip(&trip.id).expect("detail");
        assert_eq!(detail.interest_profile.weights.culture, 1.0);
        assert_eq!(detail.saved_places[0].id, saved.id);
        assert!(!detail.saved_places[0].source_pack_available);
        assert_eq!(detail.packing_items[0].id, packing.id);
        assert_eq!(detail.trip_items[0].id, activity.id);
        assert!(detail.confirmed_facts.is_empty());
        let workspace_hits = service.search_workspace("quiet morning").expect("search");
        assert_eq!(workspace_hits[0].record_id, saved.id);
        assert_eq!(workspace_hits[0].trip_id, trip.id);

        drop(service);
        let reopened = AppService::open_path_with_deps(&database, Arc::new(UreqFetcher), secrets)
            .expect("reopen");
        let detail = reopened.get_trip(&trip.id).expect("persisted detail");
        assert_eq!(detail.saved_places[0].notes, "Quiet morning option");
        assert_eq!(detail.trip_items[0].title, "Visit Frist");
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
    fn imports_a_plain_text_email_using_the_subject_as_the_label() {
        let database = temp_database("email-import");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let raw_email = "From: airline@example.com\r\nSubject: Flight SFO to NRT\r\nContent-Type: text/plain\r\n\r\nConfirmation CODE7\nRoute SFO-NRT\n2027-04-02T10:00";
        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::Email,
                label: None,
                content: raw_email.to_owned(),
            })
            .expect("import email");

        // A candidate was extracted from the email body.
        assert!(!imported.candidates.is_empty());
        // Stored as a normal body kind (never Email), with the email subject as
        // the default label and the headers stripped from the stored body.
        assert_eq!(imported.document.kind, DocumentKind::PastedText);
        assert_eq!(imported.document.label, "Flight SFO to NRT");
        assert!(!imported.document.label.contains("airline@example.com"));

        cleanup_database(database);
    }

    #[test]
    fn oversized_raw_email_is_rejected_before_it_is_parsed() {
        let database = temp_database("email-too-large");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Raw email past the 1,000,000-char cap: rejected up front so the MIME
        // walker never sees a hostile payload.
        let huge = format!("Content-Type: text/plain\r\n\r\n{}", "x".repeat(1_100_000));
        let error = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id,
                kind: DocumentKind::Email,
                label: None,
                content: huge,
            })
            .expect_err("too large");
        assert_eq!(error.code, ErrorCode::DocumentTooLarge);
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
    fn migration_v4_carries_a_legacy_uk_snapshot_into_the_advisory_panel() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(
                r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
                   INSERT INTO trips (id) VALUES ('trip-1');
                   CREATE TABLE travel_advice_snapshots (
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
                   INSERT INTO travel_advice_snapshots VALUES (
                       'trip-1', 'japan', 'Japan',
                       'https://www.gov.uk/foreign-travel-advice/japan',
                       'FCDO travel advice for Japan.',
                       '["avoid_all_travel_to_parts"]',
                       '2026-06-30T11:02:00.000+01:00',
                       'Latest update: typhoon season.',
                       '2026-07-10T12:00:00Z'
                   );
                   PRAGMA user_version = 3;"#,
            )
            .expect("legacy shape");

        migrate(&connection).expect("migrate to v4");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );

        let legacy_tables: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table'
                 AND name = 'travel_advice_snapshots'",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(legacy_tables, 0, "the legacy table is dropped once copied");

        let panel = load_advisory_panel(&connection, "trip-1")
            .expect("load")
            .expect("the migrated panel exists");
        assert_eq!(panel.country_slug, "japan");
        assert_eq!(panel.country_name, "Japan");
        assert_eq!(panel.entries.len(), 1);
        let uk = &panel.entries[0];
        assert_eq!(uk.source, AdvisorySource::UkFcdo);
        assert_eq!(uk.summary, "FCDO travel advice for Japan.");
        assert_eq!(uk.level_label.as_deref(), Some("avoid_all_travel_to_parts"));
        assert_eq!(
            uk.change_description.as_deref(),
            Some("Latest update: typhoon season.")
        );
        assert_eq!(uk.attribution, "Open Government Licence v3.0");
        assert_eq!(uk.language, "en");
        assert_eq!(uk.retrieved_at, "2026-07-10T12:00:00Z");
        assert!(panel.health_notices.is_empty());
        // A migrated row is not the result of any fetch attempt, so it claims
        // no per-source state: the entry's own retrieved_at carries the truth.
        assert!(panel.source_status.is_empty());
        assert_eq!(panel.retrieved_at, "2026-07-10T12:00:00Z");
    }

    #[test]
    fn advisory_panel_roundtrips_every_source_verbatim() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(
                "CREATE TABLE trips (id TEXT PRIMARY KEY);
                 INSERT INTO trips VALUES ('trip-1');
                 PRAGMA user_version = 3;",
            )
            .expect("trips");
        migrate(&connection).expect("migrate");

        let entry = |source, name: &str, rank| AdvisoryEntry {
            source,
            source_name: name.to_owned(),
            country_name: "Japan".to_owned(),
            level_label: Some("Level".to_owned()),
            level_rank: rank,
            summary: "Summary.".to_owned(),
            source_url: "https://example.invalid/japan".to_owned(),
            source_updated_at: Some("2026-07-16T00:00:00Z".to_owned()),
            change_description: None,
            language: "en".to_owned(),
            attribution: "Attribution".to_owned(),
            retrieved_at: "2026-07-17T12:00:00Z".to_owned(),
        };
        for (source, name, rank) in [
            (
                AdvisorySource::UkFcdo,
                "UK Foreign, Commonwealth & Development Office",
                None,
            ),
            (AdvisorySource::UsState, "U.S. Department of State", Some(1)),
            (
                AdvisorySource::CaGac,
                "Government of Canada — Global Affairs Canada",
                Some(0),
            ),
            (AdvisorySource::DeAa, "Auswärtiges Amt (Germany)", Some(2)),
        ] {
            store_advisory_entry(&connection, "trip-1", &entry(source, name, rank)).expect("store");
        }
        let notices = vec![HealthNotice {
            title: "Level 1 - Measles in Japan".to_owned(),
            url: "https://wwwnc.cdc.gov/travel/notices/level1/measles-japan".to_owned(),
            level_label: Some("Level 1".to_owned()),
            published_at: Some("Thu, 25 Jun 2026 04:00:00 GMT".to_owned()),
            summary: "There is an outbreak of measles.".to_owned(),
        }];
        let statuses = vec![
            SourceStatus {
                source: AdvisorySource::UkFcdo,
                state: SourceState::Fresh,
            },
            SourceStatus {
                source: AdvisorySource::CaGac,
                state: SourceState::Kept,
            },
        ];
        store_advisory_panel_meta(
            &connection,
            "trip-1",
            "japan",
            "Japan",
            &notices,
            &statuses,
            "2026-07-17T12:00:00Z",
        )
        .expect("store panel");

        let panel = load_advisory_panel(&connection, "trip-1")
            .expect("load")
            .expect("panel");
        // Entries come back in fixed source order, never feed order.
        assert_eq!(
            panel.entries.iter().map(|e| e.source).collect::<Vec<_>>(),
            vec![
                AdvisorySource::UkFcdo,
                AdvisorySource::UsState,
                AdvisorySource::CaGac,
                AdvisorySource::DeAa,
            ]
        );
        assert_eq!(panel.health_notices, notices);
        assert_eq!(panel.source_status, statuses);
        assert_eq!(panel.entries[1].level_rank, Some(1));

        // Storing the same source twice replaces rather than duplicates.
        store_advisory_entry(
            &connection,
            "trip-1",
            &entry(AdvisorySource::UkFcdo, "UK", None),
        )
        .expect("replace");
        let panel = load_advisory_panel(&connection, "trip-1")
            .expect("load")
            .expect("panel");
        assert_eq!(panel.entries.len(), 4);
        assert_eq!(panel.entries[0].source_name, "UK");

        delete_advisory_entry(&connection, "trip-1", AdvisorySource::DeAa).expect("delete");
        let panel = load_advisory_panel(&connection, "trip-1")
            .expect("load")
            .expect("panel");
        assert_eq!(panel.entries.len(), 3);

        assert!(
            load_advisory_panel(&connection, "trip-missing")
                .expect("load")
                .is_none()
        );
    }

    #[test]
    fn fetch_advisories_stores_each_source_and_keeps_the_last_good_copy() {
        use std::sync::atomic::{AtomicBool, Ordering};

        struct RoutedFetcher {
            fail_canada: AtomicBool,
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for RoutedFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                if url.contains("gov.uk") {
                    return Ok(r#"{"description": "FCDO travel advice for Japan.",
                        "public_updated_at": "2026-06-30T11:02:00.000+01:00",
                        "details": {"alert_status": [], "change_description": "Latest update: typhoon season."}}"#.to_owned());
                }
                if url.contains("cadataapi.state.gov") {
                    return Ok(r#"[{"Title": "Japan - Level 1: Exercise Normal Precautions",
                        "Link": "https://travel.state.gov/japan", "Category": ["JA"],
                        "Summary": "<p>Exercise normal precautions in <b>Japan</b>.</p>",
                        "Published": "2025-05-14T20:00:00-04:00", "Updated": "2025-05-14T20:00:00-04:00"}]"#.to_owned());
                }
                if url.contains("data.international.gc.ca") {
                    if self.fail_canada.load(Ordering::SeqCst) {
                        return Err(AppError::new(ErrorCode::AdviceFetchFailed, "network down"));
                    }
                    return Ok(r#"{"data": {"JP": {"country-iso": "JP", "country-eng": "Japan",
                        "advisory-state": 0, "date-published": {"asp": "2026-07-16T12:53:48.9-04:00"},
                        "eng": {"name": "Japan", "url-slug": "japan",
                                "advisory-text": "Exercise normal security precautions"}}}}"#.to_owned());
                }
                if url.contains("auswaertiges-amt.de") {
                    return Ok(r#"{"response": {"lastModified": 1757063288,
                        "213032": {"lastModified": 1783430993, "effective": 1783431000,
                        "title": "Japan: Reise- und Sicherheitshinweise", "countryCode": "JP",
                        "iso3CountryCode": "JPN", "countryName": "Japan", "warning": false,
                        "partialWarning": true, "situationWarning": false,
                        "situationPartWarning": false}}}"#
                        .to_owned());
                }
                if url.contains("wwwnc.cdc.gov") {
                    return Ok(r#"<rss version="2.0"><channel><title>CDC</title><item>
                        <title>Level 1 - Measles in Japan</title>
                        <description><![CDATA[There is an outbreak of measles in Japan.]]></description>
                        <link>https://wwwnc.cdc.gov/travel/notices/level1/measles-japan</link>
                        <pubDate>Thu, 25 Jun 2026 04:00:00 GMT</pubDate></item></channel></rss>"#
                        .to_owned());
                }
                Err(AppError::new(
                    ErrorCode::AdviceFetchFailed,
                    "unexpected url",
                ))
            }
        }

        let database = temp_database("advisories");
        let fetcher = Arc::new(RoutedFetcher {
            fail_canada: AtomicBool::new(false),
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // An unknown slug is rejected before any fetch happens.
        assert_eq!(
            service
                .fetch_advisories(&trip.id, "atlantis")
                .expect_err("unknown slug")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert!(fetcher.calls.lock().expect("lock").is_empty());

        let panel = service.fetch_advisories(&trip.id, "japan").expect("panel");
        assert_eq!(panel.country_name, "Japan");
        assert_eq!(
            panel.entries.iter().map(|e| e.source).collect::<Vec<_>>(),
            vec![
                AdvisorySource::UkFcdo,
                AdvisorySource::UsState,
                AdvisorySource::CaGac,
                AdvisorySource::DeAa
            ]
        );
        assert!(
            panel
                .source_status
                .iter()
                .all(|s| s.state == SourceState::Fresh)
        );
        assert_eq!(panel.health_notices.len(), 1);
        assert_eq!(
            panel.health_notices[0].level_label.as_deref(),
            Some("Level 1")
        );
        // The German card keeps its own language and its own words.
        let german = panel
            .entries
            .iter()
            .find(|e| e.source == AdvisorySource::DeAa)
            .expect("de");
        assert_eq!(german.language, "de");
        assert_eq!(german.level_label.as_deref(), Some("Teilreisewarnung"));

        // The panel persists and surfaces on the trip detail.
        let detail = service.get_trip(&trip.id).expect("detail");
        assert_eq!(
            detail.advisory_panel.expect("stored panel").entries.len(),
            4
        );

        // Canada now fails: its last good copy is kept and labelled as kept.
        fetcher.fail_canada.store(true, Ordering::SeqCst);
        let panel = service
            .fetch_advisories(&trip.id, "japan")
            .expect("panel despite CA failure");
        assert_eq!(
            panel.entries.len(),
            4,
            "the kept Canadian entry is still shown"
        );
        let canada = panel
            .entries
            .iter()
            .find(|e| e.source == AdvisorySource::CaGac)
            .expect("ca");
        assert_eq!(
            canada.level_label.as_deref(),
            Some("Exercise normal security precautions")
        );
        let state = |source| {
            panel
                .source_status
                .iter()
                .find(|s| s.source == source)
                .expect("status")
                .state
        };
        assert_eq!(state(AdvisorySource::CaGac), SourceState::Kept);
        assert_eq!(state(AdvisorySource::UkFcdo), SourceState::Fresh);

        // A destination edit still invalidates the whole panel.
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
                .advisory_panel
                .is_none()
        );

        // The curated country list still backs the picker.
        assert!(
            service
                .list_advice_countries()
                .iter()
                .any(|country| country.slug == "japan")
        );
        cleanup_database(database);
    }

    #[test]
    fn fetch_advisories_reports_a_government_that_does_not_publish_and_a_total_failure() {
        struct SilentFetcher {
            fail_everything: std::sync::atomic::AtomicBool,
        }
        impl AdviceFetcher for SilentFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                if self
                    .fail_everything
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    return Err(AppError::new(ErrorCode::AdviceFetchFailed, "offline"));
                }
                if url.contains("gov.uk") {
                    return Ok(r#"{"description": "FCDO travel advice for the USA."}"#.to_owned());
                }
                // Every other government publishes nothing about the USA.
                if url.contains("cadataapi.state.gov") {
                    return Ok("[]".to_owned());
                }
                if url.contains("data.international.gc.ca") {
                    return Ok(r#"{"data": {}}"#.to_owned());
                }
                if url.contains("auswaertiges-amt.de") {
                    return Ok(r#"{"response": {"lastModified": 1757063288}}"#.to_owned());
                }
                Ok(r#"<rss version="2.0"><channel><title>CDC</title></channel></rss>"#.to_owned())
            }
        }

        let database = temp_database("advisories_absent");
        let fetcher = Arc::new(SilentFetcher {
            fail_everything: std::sync::atomic::AtomicBool::new(false),
        });
        let service = open_test_service_with_fetcher(&database, fetcher).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let panel = service.fetch_advisories(&trip.id, "usa").expect("panel");
        assert_eq!(
            panel.entries.len(),
            1,
            "only the UK publishes advice about the USA"
        );
        assert_eq!(panel.entries[0].source, AdvisorySource::UkFcdo);
        let state = |source| {
            panel
                .source_status
                .iter()
                .find(|s| s.source == source)
                .expect("status")
                .state
        };
        assert_eq!(state(AdvisorySource::UsState), SourceState::NotPublished);
        assert_eq!(state(AdvisorySource::CaGac), SourceState::NotPublished);
        assert_eq!(state(AdvisorySource::DeAa), SourceState::NotPublished);

        // Everything failing with nothing stored is an honest error, not an
        // empty panel that reads as "no government has anything to say".
        let database2 = temp_database("advisories_offline");
        let fetcher2 = Arc::new(SilentFetcher {
            fail_everything: std::sync::atomic::AtomicBool::new(true),
        });
        let service2 = open_test_service_with_fetcher(&database2, fetcher2).expect("service");
        let trip2 = service2.create_trip(valid_trip_input()).expect("trip");
        assert_eq!(
            service2
                .fetch_advisories(&trip2.id, "japan")
                .expect_err("all sources down")
                .code,
            ErrorCode::AdviceFetchFailed
        );
        assert!(
            service2
                .get_trip(&trip2.id)
                .expect("detail")
                .advisory_panel
                .is_none(),
            "a total failure leaves the database untouched"
        );
        cleanup_database(database);
        cleanup_database(database2);
    }

    /// The forecast is what the click is for; normals, air quality and alerts
    /// are extras hung off the same click. This pins both halves: they arrive
    /// when the sources answer, and their absence never costs the forecast.
    fn weather_bodies(url: &str, country_code: &str) -> Option<String> {
        if url.contains("geocoding-api.open-meteo.com") {
            return Some(format!(
                r#"{{ "results": [ {{ "name": "Kyoto", "latitude": 35.02107,
                    "longitude": 135.75385, "country": "Japan", "admin1": "Kyoto",
                    "country_code": "{country_code}" }} ] }}"#
            ));
        }
        if url.contains("api.open-meteo.com/v1/forecast") {
            return Some(
                r#"{ "daily": {
                    "time": ["2027-04-01", "2027-04-02"],
                    "weather_code": [0, 61],
                    "temperature_2m_max": [18.4, 15.1],
                    "temperature_2m_min": [9.2, 8.7],
                    "precipitation_probability_max": [5, 80]
                } }"#
                    .to_owned(),
            );
        }
        if url.contains("archive-api.open-meteo.com") {
            return Some(
                r#"{ "daily": {
                    "time": ["2025-04-01","2025-04-02","2026-04-01","2026-04-02"],
                    "temperature_2m_max": [17.0, 19.0, 18.0, 20.0],
                    "temperature_2m_min": [7.0, 9.0, 8.0, 10.0],
                    "precipitation_sum": [0.0, 4.0, 0.0, 0.0]
                } }"#
                    .to_owned(),
            );
        }
        if url.contains("air-quality-api.open-meteo.com") {
            return Some(
                r#"{ "daily": {"time": ["2027-04-01"], "uv_index_max": [6.5]},
                     "hourly": {"time": ["2027-04-01T12:00"], "us_aqi": [42], "pm2_5": [8.1]} }"#
                    .to_owned(),
            );
        }
        if url.contains("api.weather.gov") {
            return Some(
                r#"{"features": [{"properties": {"id": "urn:oid:9", "event": "Flood Watch",
                    "severity": "Severe", "headline": "Flood Watch", "areaDesc": "Davidson, TN",
                    "senderName": "NWS Nashville", "status": "Actual"}}]}"#
                    .to_owned(),
            );
        }
        None
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
                weather_bodies(url, "JP")
                    .ok_or_else(|| AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
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

        // The extra layers ride the same click.
        let normals = snapshot.normals.as_ref().expect("normals");
        assert_eq!(normals.sample_days, 4);
        assert_eq!(normals.years_sampled, 2);
        assert_eq!(normals.avg_high_c, 18.5);
        assert_eq!(snapshot.air_quality.len(), 1);
        assert_eq!(snapshot.air_quality[0].uv_index_max, Some(6.5));
        assert_eq!(snapshot.air_quality[0].us_aqi_max, Some(42));

        let calls = fetcher.calls.lock().expect("lock").clone();
        assert!(calls[0].contains("geocoding-api.open-meteo.com"));
        assert!(calls[0].contains("name=Kyoto"));
        assert!(calls[1].contains("api.open-meteo.com/v1/forecast"));
        assert!(calls[1].contains("latitude=35.02107"));
        assert!(
            calls
                .iter()
                .any(|url| url.contains("archive-api.open-meteo.com"))
        );
        assert!(
            calls
                .iter()
                .any(|url| url.contains("air-quality-api.open-meteo.com"))
        );
        // Kyoto is not in the United States, so the NWS is never asked at all —
        // an empty alert list abroad means "not covered", not "all clear".
        assert!(
            !calls.iter().any(|url| url.contains("api.weather.gov")),
            "the NWS covers the US only and must not be called for {}",
            snapshot.place_region
        );
        assert!(snapshot.alerts.is_empty());

        // Persists and rides on the trip detail.
        let detail = service.get_trip(&trip.id).expect("detail");
        let stored = detail.weather.expect("stored weather");
        assert_eq!(stored.days[1].description, "Light rain");
        assert_eq!(stored.days[1].precipitation_chance_pct, Some(80.0));
        assert_eq!(stored.normals.expect("stored normals").sample_days, 4);
        assert_eq!(stored.air_quality.len(), 1);
        // Derived from the stored evidence, without another fetch.
        assert!(
            !detail.packing_list.is_empty(),
            "a stored outlook should imply at least one suggestion"
        );

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
    fn a_us_destination_gets_alerts_and_a_dead_layer_never_costs_the_forecast() {
        struct PickyFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for PickyFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                // The archive is down and the air-quality body is garbage.
                if url.contains("archive-api.open-meteo.com") {
                    return Err(AppError::new(ErrorCode::WeatherFetchFailed, "down"));
                }
                if url.contains("air-quality-api.open-meteo.com") {
                    return Ok("<html>502</html>".to_owned());
                }
                weather_bodies(url, "US")
                    .ok_or_else(|| AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
            }
        }

        let database = temp_database("weather_us");
        let fetcher = Arc::new(PickyFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service
            .fetch_weather(&trip.id)
            .expect("the forecast survives");
        // The thing the user clicked for is still here...
        assert_eq!(snapshot.days.len(), 2);
        // ...and the two broken layers are simply absent rather than fatal.
        assert!(snapshot.normals.is_none());
        assert!(snapshot.air_quality.is_empty());
        // The US destination reached the NWS.
        let calls = fetcher.calls.lock().expect("lock").clone();
        assert!(
            calls
                .iter()
                .any(|url| url.contains("api.weather.gov/alerts/active?point="))
        );
        assert_eq!(snapshot.alerts.len(), 1);
        assert_eq!(snapshot.alerts[0].event, "Flood Watch");
        assert_eq!(
            snapshot.alerts[0].url,
            "https://api.weather.gov/alerts/urn:oid:9"
        );
        cleanup_database(database);
    }

    #[test]
    fn migration_v5_keeps_a_pre_layer_weather_row() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(
                r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
                   INSERT INTO trips (id) VALUES ('trip-1');
                   CREATE TABLE weather_snapshots (
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
                   INSERT INTO weather_snapshots VALUES (
                       'trip-1', 'Kyoto', 'Kyoto, Japan', 35.0, 135.8, '[]', 'none',
                       'https://open-meteo.com/', '2026-07-10T12:00:00Z'
                   );
                   PRAGMA user_version = 4;"#,
            )
            .expect("pre-v5 shape");

        migrate(&connection).expect("migrate to v5");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );

        // The stored outlook is still true; it just carries no extra layers
        // until the next fetch.
        let stored = fetch_weather_snapshot(&connection, "trip-1")
            .expect("load")
            .expect("row survived");
        assert_eq!(stored.place_name, "Kyoto");
        assert_eq!(stored.retrieved_at, "2026-07-10T12:00:00Z");
        assert!(stored.normals.is_none());
        assert!(stored.air_quality.is_empty());
        assert!(stored.alerts.is_empty());
    }

    /// The facts card fetches once: a geocode (name, coords, country, tz) and
    /// the ECB rates. From that it derives country facts and per-day sun/moon,
    /// none of which is re-fetched. A rate-source failure still keeps the rest.
    fn facts_geocode_body(country_code: &str, timezone: &str) -> String {
        format!(
            r#"{{ "results": [ {{ "name": "Kyoto", "latitude": 35.0116,
                "longitude": 135.7681, "country": "Japan", "admin1": "Kyoto",
                "country_code": "{country_code}", "timezone": "{timezone}" }} ] }}"#
        )
    }

    /// A geocoding body for the trip origin "Chicago" (America/Chicago).
    fn chicago_geocode_body() -> String {
        r#"{ "results": [ { "name": "Chicago", "latitude": 41.85,
            "longitude": -87.65, "country": "United States", "admin1": "Illinois",
            "country_code": "US", "timezone": "America/Chicago" } ] }"#
            .to_owned()
    }

    /// Routes the destination geocode (name=Kyoto) to Japan and every other
    /// geocode (the origin) to Chicago, plus the ECB feed.
    /// The standard destination-facts routing: Kyoto as the destination,
    /// Chicago as the origin, and the ECB rate feed. Routes match in
    /// registration order, so the Kyoto geocode is declared before the general
    /// one that stands in for the origin.
    fn routed_facts_fetcher() -> FakeFetcher {
        FakeFetcher::new()
            .route("name=Kyoto", &facts_geocode_body("JP", "Asia/Tokyo"))
            .route("geocoding-api.open-meteo.com", &chicago_geocode_body())
            .route("ecb.europa.eu", ECB_BODY)
    }

    const ECB_BODY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
 xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time='2026-07-17'>
    <Cube currency='USD' rate='1.1435'/>
    <Cube currency='JPY' rate='185.65'/>
    <Cube currency='GBP' rate='0.85098'/>
  </Cube></Cube>
</gesmes:Envelope>"#;

    #[test]
    fn fetch_destination_facts_stores_place_rates_and_derives_facts_and_astro() {
        use voyalier_core::{PolarState, cross_rate};

        struct RoutedFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for RoutedFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                if url.contains("geocoding-api.open-meteo.com") {
                    return Ok(facts_geocode_body("JP", "Asia/Tokyo"));
                }
                if url.contains("ecb.europa.eu") {
                    return Ok(ECB_BODY.to_owned());
                }
                Err(AppError::new(
                    ErrorCode::WeatherFetchFailed,
                    "unexpected url",
                ))
            }
        }

        let database = temp_database("facts");
        let fetcher = Arc::new(RoutedFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
        assert_eq!(snapshot.place_name, "Kyoto");
        assert_eq!(snapshot.country_code, "JP");
        // Asia/Tokyo is UTC+9 all year, so the offset is 540 minutes.
        assert_eq!(snapshot.utc_offset_minutes, 540);
        assert_eq!(snapshot.rate_date, "2026-07-17");
        // The rates round-trip and convert: 1 USD ≈ 162.35 JPY via EUR.
        let usd_jpy = cross_rate(&snapshot.currency_rates, "USD", "JPY").expect("usd->jpy");
        assert!((usd_jpy - 162.35).abs() < 0.1, "{usd_jpy}");

        let calls = fetcher.calls.lock().expect("lock").clone();
        assert!(
            calls
                .iter()
                .any(|url| url.contains("geocoding-api.open-meteo.com"))
        );
        assert!(calls.iter().any(|url| url.contains("ecb.europa.eu")));

        // The detail derives the country facts (bundled) and the sun/moon days
        // (computed) from the stored snapshot — no second fetch.
        let detail = service.get_trip(&trip.id).expect("detail");
        assert_eq!(detail.destination_facts.expect("stored").country_code, "JP");
        let facts = detail.country_facts.expect("resolved facts");
        assert_eq!(facts.currency_code, "JPY");
        assert_eq!(facts.voltage_v, 100);
        assert!(facts.drives_on_left);
        assert!(
            !detail.astro.is_empty(),
            "astro derived for the trip window"
        );
        let first = &detail.astro[0];
        assert_eq!(first.polar, PolarState::Normal);
        assert!(first.sunrise.is_some());
        // The nearest airports fall out of the same stored coordinates.
        assert!(!detail.nearest_airports.is_empty(), "airports derived");
        assert_eq!(detail.nearest_airports[0].iata, "ITM");
        // As do the World Heritage sites near the destination.
        assert!(!detail.world_heritage.is_empty(), "heritage derived");
        assert_eq!(
            detail.world_heritage[0].name,
            "Historic Monuments of Ancient Kyoto"
        );
        // And a tipping note, resolved from the country code (Japan: no tipping).
        assert!(
            detail
                .tipping
                .as_deref()
                .expect("tipping")
                .to_lowercase()
                .contains("not customary")
        );

        // A destination edit invalidates the facts, like weather and advice.
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
        let after = service.get_trip(&trip.id).expect("detail after edit");
        assert!(after.destination_facts.is_none());
        assert!(after.astro.is_empty());
        assert!(after.nearest_airports.is_empty());
        assert!(after.world_heritage.is_empty());
        cleanup_database(database);
    }

    #[test]
    fn facts_degrade_when_the_rate_source_is_down_and_are_absent_for_uncovered_countries() {
        // A country with no bundled facts (Antarctica) and no tz, and a rate
        // feed that is down.
        let fetcher = FakeFetcher::new()
            .route(
                "geocoding-api.open-meteo.com",
                &facts_geocode_body("AQ", ""),
            )
            .route_fail("ecb.europa.eu", ErrorCode::WeatherFetchFailed, "rates down");

        let database = temp_database("facts_degraded");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(fetcher)).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // The rate feed is down, but the geocode succeeded: the snapshot is
        // still worth storing, just with no rates.
        let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
        assert!(snapshot.currency_rates.is_empty());
        assert_eq!(snapshot.rate_date, "");
        // An unknown timezone leaves the offset at UTC rather than guessing.
        assert_eq!(snapshot.utc_offset_minutes, 0);

        let detail = service.get_trip(&trip.id).expect("detail");
        // Antarctica has no bundled facts, so the card shows none — but astro
        // still computes from coordinates alone.
        assert!(detail.country_facts.is_none());
        assert!(!detail.astro.is_empty());
        cleanup_database(database);
    }

    #[test]
    fn migration_v6_keeps_a_database_without_a_facts_table() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(
                r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
                   INSERT INTO trips (id) VALUES ('trip-1');
                   PRAGMA user_version = 5;"#,
            )
            .expect("pre-v6 shape");

        migrate(&connection).expect("migrate to v6");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        // The table now exists and a trip with no facts loads as None.
        assert!(
            load_destination_facts_snapshot(&connection, "trip-1")
                .expect("load")
                .is_none()
        );
    }

    #[test]
    fn fetch_destination_facts_resolves_origin_for_a_time_difference() {
        let database = temp_database("facts_timediff");
        let service = open_test_service_with_fetcher(&database, Arc::new(routed_facts_fetcher()))
            .expect("service");
        // valid_trip_input: origin Chicago, destination Kyoto, start 2027-04-01.
        // Chicago is CDT (−300) that day, Tokyo +540 → 840 min ahead.
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
        assert_eq!(snapshot.origin_place.as_deref(), Some("Chicago"));
        assert_eq!(snapshot.origin_utc_offset_minutes, Some(-300));

        let detail = service.get_trip(&trip.id).expect("detail");
        let diff = detail.time_difference.expect("time difference derived");
        assert_eq!(diff.origin_place, "Chicago");
        assert_eq!(diff.offset_minutes, 840);
        cleanup_database(database);
    }

    #[test]
    fn an_unresolvable_origin_yields_no_time_difference() {
        // The destination geocodes; the origin matches nothing on the map.
        let empty_origin_fetcher = || {
            FakeFetcher::new()
                .route("name=Kyoto", &facts_geocode_body("JP", "Asia/Tokyo"))
                .route("geocoding-api.open-meteo.com", r#"{ "results": [] }"#)
                .route("ecb.europa.eu", ECB_BODY)
        };

        let database = temp_database("facts_no_origin");
        let service = open_test_service_with_fetcher(&database, Arc::new(empty_origin_fetcher()))
            .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
        // The destination still resolves; only the time difference is absent.
        assert_eq!(snapshot.place_name, "Kyoto");
        assert_eq!(snapshot.origin_place, None);
        assert_eq!(snapshot.origin_utc_offset_minutes, None);
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail")
                .time_difference
                .is_none()
        );
        cleanup_database(database);
    }

    #[test]
    fn editing_the_origin_invalidates_the_facts_snapshot() {
        let database = temp_database("facts_origin_edit");
        let service = open_test_service_with_fetcher(&database, Arc::new(routed_facts_fetcher()))
            .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service.fetch_destination_facts(&trip.id).expect("snapshot");
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail")
                .time_difference
                .is_some()
        );

        service
            .update_trip(
                &trip.id,
                UpdateTripInput {
                    title: None,
                    origin: Some("Denver".to_owned()),
                    destination: None,
                    start_date: None,
                    end_date: None,
                },
            )
            .expect("origin edit");

        let after = service.get_trip(&trip.id).expect("detail after edit");
        // The snapshot's time difference was measured from the old home, so the
        // whole facts snapshot is invalidated on an origin change.
        assert!(after.destination_facts.is_none());
        assert!(after.time_difference.is_none());
        cleanup_database(database);
    }

    #[test]
    fn migration_v7_adds_origin_columns_to_the_facts_table() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(
                r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
                   CREATE TABLE destination_facts_snapshots (
                     trip_id TEXT PRIMARY KEY,
                     place_name TEXT NOT NULL,
                     place_region TEXT NOT NULL,
                     latitude REAL NOT NULL,
                     longitude REAL NOT NULL,
                     utc_offset_minutes INTEGER NOT NULL,
                     country_code TEXT NOT NULL,
                     rate_date TEXT NOT NULL,
                     currency_rates TEXT NOT NULL DEFAULT '[]',
                     retrieved_at TEXT NOT NULL);
                   PRAGMA user_version = 6;"#,
            )
            .expect("pre-v7 shape");

        migrate(&connection).expect("migrate to v7");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        let columns: Vec<String> = {
            let mut statement = connection
                .prepare("PRAGMA table_info(destination_facts_snapshots)")
                .expect("table_info");
            statement
                .query_map([], |row| row.get::<_, String>(1))
                .expect("columns")
                .collect::<rusqlite::Result<Vec<String>>>()
                .expect("collect")
        };
        assert!(columns.iter().any(|c| c == "origin_place"));
        assert!(columns.iter().any(|c| c == "origin_utc_offset_minutes"));
    }

    #[test]
    fn fetch_public_holidays_stores_all_years_and_filters_to_the_window() {
        // name "Kyoto", country "Japan", country_code "JP".
        let fetcher = FakeFetcher::new()
            .route(
                "geocoding-api.open-meteo.com",
                &facts_geocode_body("JP", "Asia/Tokyo"),
            )
            .route(
                "date.nager.at/api/v3/PublicHolidays/2027/JP",
                r#"[
                  {"date":"2027-04-05","localName":"テスト祝日","name":"Test Holiday","global":true,"types":["Public"]},
                  {"date":"2027-04-29","localName":"昭和の日","name":"Shōwa Day","global":true,"types":["Public"]}
                ]"#,
            );

        let database = temp_database("holidays");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(fetcher)).expect("service");
        // valid_trip_input: Kyoto, 2027-04-01 .. 2027-04-10.
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service.fetch_public_holidays(&trip.id).expect("snapshot");
        assert_eq!(snapshot.country_code, "JP");
        assert_eq!(snapshot.country_name, "Japan");
        // Both fetched holidays are stored, unfiltered.
        assert_eq!(snapshot.holidays.len(), 2);

        let detail = service.get_trip(&trip.id).expect("detail");
        let panel = detail.public_holidays.expect("holidays panel");
        // Only 2027-04-05 falls inside the 04-01..04-10 window.
        assert_eq!(panel.holidays.len(), 1);
        assert_eq!(panel.holidays[0].date, "2027-04-05");
        assert_eq!(panel.holidays[0].name, "Test Holiday");
        assert_eq!(panel.country_name, "Japan");

        // Moving the window off every holiday invalidates the snapshot.
        service
            .update_trip(
                &trip.id,
                UpdateTripInput {
                    title: None,
                    origin: None,
                    destination: None,
                    start_date: Some("2027-06-01".to_owned()),
                    end_date: Some("2027-06-10".to_owned()),
                },
            )
            .expect("date edit");
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail")
                .public_holidays
                .is_none()
        );
        cleanup_database(database);
    }

    #[test]
    fn fetch_place_summary_stores_and_derives_on_detail() {
        let fetcher = FakeFetcher::new().route(
            "en.wikipedia.org/api/rest_v1/page/summary/Kyoto",
            r#"{"type":"standard","title":"Kyoto","description":"City in Japan",
            "extract":"Kyoto is the capital city of Kyoto Prefecture.",
            "content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Kyoto"}}}"#,
        );
        let database = temp_database("place_summary");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(fetcher)).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let summary = service.fetch_place_summary(&trip.id).expect("summary");
        assert_eq!(summary.title, "Kyoto");
        assert!(summary.extract.contains("capital city"));

        let detail = service.get_trip(&trip.id).expect("detail");
        assert_eq!(
            detail.place_summary.expect("stored").url,
            "https://en.wikipedia.org/wiki/Kyoto"
        );

        // A destination edit invalidates it — it is about the old place.
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
            .expect("edit");
        assert!(
            service
                .get_trip(&trip.id)
                .expect("detail")
                .place_summary
                .is_none()
        );
        cleanup_database(database);
    }

    #[test]
    fn migration_v9_adds_the_place_summaries_table() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(r#"CREATE TABLE trips (id TEXT PRIMARY KEY); PRAGMA user_version = 8;"#)
            .expect("pre-v9 shape");
        migrate(&connection).expect("migrate to v9");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        assert!(
            load_place_summary(&connection, "trip-1")
                .expect("load")
                .is_none()
        );
    }

    #[test]
    fn migration_v8_adds_the_public_holidays_table() {
        let connection = Connection::open_in_memory().expect("memory db");
        connection
            .execute_batch(r#"CREATE TABLE trips (id TEXT PRIMARY KEY); PRAGMA user_version = 7;"#)
            .expect("pre-v8 shape");
        migrate(&connection).expect("migrate to v8");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        assert!(
            load_public_holidays_snapshot(&connection, "trip-1")
                .expect("load")
                .is_none()
        );
    }

    #[test]
    fn provider_keys_live_in_the_secret_store_never_the_config_or_db() {
        use voyalier_core::ProviderId;

        // Provider config never touches the network.
        let database = temp_database("providers");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
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
    fn exports_the_workspace_as_a_portable_encrypted_backup() {
        let database = temp_database("export-backup");
        let service = open_test_service(&database).expect("service");
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

        let container = service
            .export_backup("correct horse battery staple")
            .expect("export");

        let opened = voyalier_core::open_backup("correct horse battery staple", &container)
            .expect("open the backup");
        assert_eq!(opened.manifest.schema_version, target_schema_version());
        assert_eq!(opened.manifest.format_version, BACKUP_FORMAT_VERSION);
        // Without the data key the sealed rows would be undecryptable on another
        // machine, so a backup from an active vault must carry it.
        assert!(opened.data_key.is_some(), "the vault key must ride along");
        assert!(
            opened.snapshot.starts_with(b"SQLite format 3\0"),
            "the snapshot should be the SQLite file"
        );
        // The snapshot is a real workspace, not an empty database.
        assert!(
            opened
                .snapshot
                .windows(trip.id.len())
                .any(|window| window == trip.id.as_bytes()),
            "the exported snapshot should contain the trip"
        );

        // The traveler's secrets are not readable in the exported file.
        for secret in [b"SECRET-PNR".as_slice(), b"Jamie Traveler".as_slice()] {
            assert!(
                container
                    .windows(secret.len())
                    .all(|window| window != secret),
                "a secret leaked into the backup in the clear"
            );
        }

        assert!(
            voyalier_core::open_backup("the wrong passphrase", &container).is_err(),
            "a wrong passphrase must not open the backup"
        );
        assert_eq!(
            service.export_backup("short").expect_err("too short").code,
            ErrorCode::ValidationInvalidInput
        );

        cleanup_database(database);
    }

    #[test]
    fn restores_a_backup_onto_another_machine_at_the_next_launch() {
        // Workspace A — the machine being backed up.
        let database_a = temp_database("restore-source");
        let service_a = open_test_service(&database_a).expect("service a");
        let trip_a = service_a.create_trip(valid_trip_input()).expect("trip a");
        service_a
            .add_manual_fact(AddManualFactInput {
                trip_id: trip_a.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("fact a");
        let container = service_a
            .export_backup("correct horse battery")
            .expect("export");

        // Workspace B — a different machine: its own database and its own
        // keychain, so nothing but the container carries A's data across.
        let database_b = temp_database("restore-target");
        let secrets_b = Arc::new(MemorySecretStore::default());
        let service_b =
            AppService::open_path_with_deps(&database_b, Arc::new(UreqFetcher), secrets_b.clone())
                .expect("service b");
        let trip_b = service_b.create_trip(valid_trip_input()).expect("trip b");

        let preview = service_b
            .stage_restore("correct horse battery", &container)
            .expect("stage");
        assert_eq!(preview.schema_version, target_schema_version());

        // Staging is inert — B keeps its own data until the app restarts, so a
        // crash between staging and applying loses nothing.
        assert!(
            service_b
                .list_trips()
                .expect("trips b")
                .iter()
                .any(|summary| summary.trip.id == trip_b.id),
            "staging must not touch the live workspace"
        );

        // Restart.
        drop(service_b);
        let reopened =
            AppService::open_path_with_deps(&database_b, Arc::new(UreqFetcher), secrets_b.clone())
                .expect("reopen b");

        let trips = reopened.list_trips().expect("trips");
        assert!(
            trips.iter().any(|summary| summary.trip.id == trip_a.id),
            "A's trip should be restored onto B"
        );
        assert!(
            !trips.iter().any(|summary| summary.trip.id == trip_b.id),
            "restore replaces the workspace rather than merging into it"
        );

        // The sealed payload decrypts, which is only possible because the data
        // key travelled inside the container — B's keychain never had it.
        let detail = reopened.get_trip(&trip_a.id).expect("detail");
        assert!(
            detail
                .confirmed_facts
                .iter()
                .any(|fact| fact.payload.confirmation_code.as_deref() == Some("SECRET-PNR")),
            "the restored sealed fact should decrypt"
        );

        // B's pre-restore data is snapshotted, so a mistaken restore is reversible.
        let backups = database_b.parent().expect("parent").join("backups");
        let safety = fs::read_dir(&backups)
            .expect("backups dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("pre-restore-")
            })
            .count();
        assert_eq!(safety, 1, "a pre-restore safety snapshot should exist");

        // The staging marker is consumed, so the restore does not repeat.
        assert!(!database_b.with_file_name("pending-restore.json").exists());

        cleanup_database(database_a);
        cleanup_database(database_b);
    }

    #[test]
    fn refuses_to_stage_a_restore_it_cannot_trust() {
        let database = temp_database("restore-refused");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let container = service
            .export_backup("correct horse battery")
            .expect("export");
        let marker = database.with_file_name("pending-restore.json");

        // A wrong passphrase cannot stage anything.
        assert!(service.stage_restore("not the one", &container).is_err());
        assert!(!marker.exists(), "a failed restore must leave no marker");

        // Nor can a backup written by a newer Voyalier, whose schema this build
        // cannot migrate backwards to understand.
        let future = voyalier_core::seal_backup(
            "correct horse battery",
            &BackupManifest {
                format_version: BACKUP_FORMAT_VERSION,
                schema_version: target_schema_version() + 1,
                app_version: "99.0.0".to_owned(),
                created_at: now_rfc3339(),
            },
            None,
            b"SQLite format 3\0not really",
            &[1u8; VAULT_SALT_LEN],
            &[2u8; VAULT_NONCE_LEN],
        )
        .expect("future container");
        assert!(
            service
                .stage_restore("correct horse battery", &future)
                .is_err()
        );
        assert!(!marker.exists(), "a refused restore must leave no marker");

        // The live workspace is untouched throughout.
        assert!(
            service
                .list_trips()
                .expect("trips")
                .iter()
                .any(|summary| summary.trip.id == trip.id)
        );

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
    fn validate_provider_key_maps_status_and_never_stores_the_key() {
        struct StatusFetcher {
            status: Option<u16>, // None models a transport failure (offline).
        }
        impl AdviceFetcher for StatusFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Err(AppError::new(ErrorCode::AdviceFetchFailed, "n/a"))
            }
            fn get_status(&self, url: &str, headers: &[(&str, &str)]) -> Result<u16, AppError> {
                // The key rides only in the auth header, to the provider endpoint.
                assert!(url.starts_with("https://"));
                assert!(headers.iter().any(|(name, value)| {
                    (*name == "Authorization" && value.contains("test-key"))
                        || (*name == "x-api-key" && *value == "test-key")
                }));
                match self.status {
                    Some(code) => Ok(code),
                    None => Err(AppError::new(ErrorCode::AssistFailed, "offline")),
                }
            }
        }

        // A 200 is a valid key — and validation must never persist it.
        let database = temp_database("validate-ok");
        let service = open_test_service_with_fetcher(
            &database,
            Arc::new(StatusFetcher { status: Some(200) }),
        )
        .expect("service");
        let verdict = service
            .validate_provider_key("openai", "test-key")
            .expect("verdict");
        assert_eq!(verdict.status, KeyValidationStatus::Valid);
        let openai = service
            .list_providers()
            .expect("providers")
            .into_iter()
            .find(|config| config.id == ProviderId::OpenAi)
            .expect("openai");
        assert!(!openai.has_key, "validation must not store the key");
        cleanup_database(database);

        // A 401 is an authoritative rejection (exercises the x-api-key header).
        let database = temp_database("validate-401");
        let service = open_test_service_with_fetcher(
            &database,
            Arc::new(StatusFetcher { status: Some(401) }),
        )
        .expect("service");
        assert_eq!(
            service
                .validate_provider_key("anthropic", "test-key")
                .expect("verdict")
                .status,
            KeyValidationStatus::Rejected
        );
        cleanup_database(database);

        // A reach failure is inconclusive, not a rejection; keyless is invalid input.
        let database = temp_database("validate-down");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(StatusFetcher { status: None }))
                .expect("service");
        assert_eq!(
            service
                .validate_provider_key("openai", "test-key")
                .expect("verdict")
                .status,
            KeyValidationStatus::Unreachable
        );
        assert_eq!(
            service
                .validate_provider_key("ollama", "test-key")
                .expect_err("keyless")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        cleanup_database(database);
    }

    #[test]
    fn pull_local_model_reports_success_and_failure() {
        struct PullFetcher {
            response: Option<String>, // None models Ollama not running.
        }
        impl AdviceFetcher for PullFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Err(AppError::new(ErrorCode::AdviceFetchFailed, "n/a"))
            }
            fn post_json_long(&self, url: &str, body: &str) -> Result<String, AppError> {
                assert!(url.contains("11434/api/pull"));
                assert!(body.contains("gemma"));
                match &self.response {
                    Some(response) => Ok(response.clone()),
                    None => Err(AppError::new(ErrorCode::AssistFailed, "connection refused")),
                }
            }
        }

        let database = temp_database("pull-ok");
        let service = open_test_service_with_fetcher(
            &database,
            Arc::new(PullFetcher {
                response: Some(r#"{"status":"success"}"#.to_owned()),
            }),
        )
        .expect("service");
        let result = service
            .pull_local_model("gemma4:12b-it-qat")
            .expect("result");
        assert!(result.ok);
        cleanup_database(database);

        // A provider error body surfaces its reason verbatim.
        let database = temp_database("pull-err");
        let service = open_test_service_with_fetcher(
            &database,
            Arc::new(PullFetcher {
                response: Some(r#"{"error":"model not found"}"#.to_owned()),
            }),
        )
        .expect("service");
        let result = service.pull_local_model("gemma4:nope").expect("result");
        assert!(!result.ok);
        assert!(result.message.contains("model not found"));
        cleanup_database(database);

        // Ollama not running is a friendly failure, not an error the UI must decode.
        let database = temp_database("pull-down");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(PullFetcher { response: None }))
                .expect("service");
        let result = service
            .pull_local_model("gemma4:12b-it-qat")
            .expect("result");
        assert!(!result.ok);
        assert!(result.message.contains("Ollama"));
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
        let database = temp_database("vault");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
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
        let reopened = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
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
        let database = temp_database("vault-passphrase");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
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
        let reopened = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
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
        let reopened_plain = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
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
        assert!(!pack.offline_map_ready);
        assert_eq!(
            fetcher.calls.lock().expect("lock").as_slice(),
            ["https://github.com/udhawan97/Voyalier/releases/download/packs-v1/us-nashville.json"]
        );

        let downloaded = service.list_downloaded_packs(&trip.id).expect("list");
        assert_eq!(downloaded.len(), 1);
        assert_eq!(downloaded[0].pack_id, "us-nashville");
        assert!(!downloaded[0].offline_map_ready);

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
    fn offline_map_download_is_verified_stored_ranged_and_removed() {
        struct OfflinePackFetcher {
            bytes: Vec<u8>,
            sha256: String,
        }
        impl AdviceFetcher for OfflinePackFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                assert!(url.ends_with("/us-nashville.json"));
                Ok(format!(
                    r#"{{
                      "packId":"us-nashville","places":[],"articles":[],
                      "offlineMap":{{
                        "assetName":"us-nashville.pmtiles","byteLength":{},
                        "sha256":"{}","sourceName":"Protomaps Basemap",
                        "sourceUrl":"https://build.protomaps.com/20260715.pmtiles",
                        "license":"ODbL-1.0","attribution":"© OpenStreetMap contributors",
                        "fetchedAt":"2026-07-16T00:27:07Z","minZoom":0,"maxZoom":15
                      }}
                    }}"#,
                    self.bytes.len(),
                    self.sha256
                ))
            }

            fn fetch_bytes(&self, url: &str, limit: usize) -> Result<Vec<u8>, AppError> {
                assert!(url.ends_with("/us-nashville.pmtiles"));
                assert_eq!(limit, MAX_OFFLINE_MAP_BYTES as usize);
                Ok(self.bytes.clone())
            }
        }

        let bytes = b"PMTiles fixture bytes".to_vec();
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        let database = temp_database("offline-map");
        let service = open_test_service_with_fetcher(
            &database,
            Arc::new(OfflinePackFetcher {
                bytes: bytes.clone(),
                sha256: sha256.clone(),
            }),
        )
        .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let downloaded = service
            .download_pack(&trip.id, "us-nashville")
            .expect("download");
        assert!(downloaded.offline_map_ready);
        let archive = service
            .get_offline_map(&trip.id)
            .expect("offline map")
            .expect("archive");
        assert_eq!(archive.pack_id, "us-nashville");
        assert_eq!(archive.sha256, sha256);
        assert_eq!(archive.byte_length, bytes.len() as u64);
        assert_eq!(archive.bbox.west, -87.06);

        let chunk = service
            .read_offline_map_range(&trip.id, "us-nashville", 2, 7)
            .expect("range");
        assert_eq!(
            BASE64.decode(chunk.data_base64).expect("base64"),
            bytes[2..9]
        );
        assert_eq!(chunk.etag, archive.sha256);
        assert_eq!(
            service
                .read_offline_map_range(&trip.id, "us-nashville", 0, MAX_OFFLINE_MAP_RANGE + 1,)
                .expect_err("oversize range")
                .code,
            ErrorCode::ValidationInvalidInput
        );

        let descriptor = service
            .connection()
            .expect("connection")
            .query_row(
                "SELECT content FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
                params![trip.id, "us-nashville"],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|content| serde_json::from_str::<PackContent>(&content).ok())
            .and_then(|content| content.offline_map)
            .expect("descriptor");
        let path = offline_map_path(&database, "us-nashville", &descriptor).expect("map path");
        fs::write(path, b"tampered map archive").expect("tamper fixture");
        assert!(service.get_offline_map(&trip.id).expect("map").is_none());

        service
            .delete_downloaded_pack(&trip.id, "us-nashville")
            .expect("delete");
        assert!(service.get_offline_map(&trip.id).expect("map").is_none());
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

    #[test]
    fn suggest_packs_matches_the_trip_destination() {
        let database = temp_database("suggest-packs");
        let service = open_test_service(&database).expect("service");
        // valid_trip_input's destination is "Kyoto".
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let suggestions = service.suggest_packs(&trip.id).expect("suggest");
        assert_eq!(suggestions[0].pack.id, "jp-kyoto");
        assert!(matches!(
            suggestions[0].match_kind,
            voyalier_core::PackMatchKind::Exact
        ));

        assert_eq!(
            service
                .suggest_packs("nope")
                .expect_err("unknown trip")
                .code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn suggest_places_offers_gazetteer_cities_and_prefers_the_users_own() {
        let database = temp_database("suggest_places");
        let service = open_test_service(&database).expect("service");

        // With no trips yet, a prefix surfaces gazetteer cities, labelled by
        // country — the create-trip dialog works before any trip exists. Osaka
        // is a gazetteer city with no pack, so its source is the gazetteer.
        let hits = service.suggest_places("osa").expect("suggest");
        let osaka = hits
            .iter()
            .find(|s| s.value == "Osaka")
            .expect("Osaka suggested");
        assert_eq!(osaka.source, voyalier_core::SuggestionSource::Gazetteer);
        assert_eq!(osaka.detail.as_deref(), Some("Japan"));

        // A blank query (focus) still offers the pack catalog / trip history,
        // as before — but never dumps the 34k-city gazetteer.
        let blank = service.suggest_places("   ").expect("blank");
        assert!(!blank.is_empty(), "focus shows pack destinations");
        assert!(blank.len() <= FIELD_SUGGESTION_LIMIT);
        assert!(
            blank
                .iter()
                .all(|s| s.source != voyalier_core::SuggestionSource::Gazetteer),
            "the gazetteer only fires on a typed prefix"
        );

        // Once the user has a trip to Kyoto, their own copy wins the dedup:
        // one "Kyoto", sourced from trip history, not the gazetteer.
        service
            .create_trip(CreateTripInput {
                title: None,
                origin: "Chicago".to_owned(),
                destination: "Kyoto".to_owned(),
                start_date: "2027-04-01".to_owned(),
                end_date: "2027-04-05".to_owned(),
            })
            .expect("trip");
        let hits = service.suggest_places("kyo").expect("suggest");
        let kyotos: Vec<_> = hits.iter().filter(|s| s.value == "Kyoto").collect();
        assert_eq!(kyotos.len(), 1, "deduped to one Kyoto");
        assert_eq!(
            kyotos[0].source,
            voyalier_core::SuggestionSource::TripHistory
        );
        cleanup_database(database);
    }

    #[test]
    fn suggest_field_values_draws_on_confirmed_facts_and_pack_places() {
        // A stub that serves one Kyoto pack with a single named place.
        struct PackFetcher;
        impl AdviceFetcher for PackFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                assert!(url.contains("jp-kyoto.json"));
                Ok(r#"{"packId":"jp-kyoto","places":[{"name":"Nishiki Market",
                       "category":"market","lat":35.0,"lon":135.76}],"articles":[]}"#
                    .to_owned())
            }
        }

        let database = temp_database("suggest-fields");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(PackFetcher)).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    property_name: Some("River Paper Inn".to_owned()),
                    address: Some("7 Paper Street, Kyoto".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual stay");
        service
            .download_pack(&trip.id, "jp-kyoto")
            .expect("download");

        // Property-name suggestions combine confirmed values and pack places.
        let property = service
            .suggest_field_values(&trip.id, "propertyName", "")
            .expect("property suggestions");
        let values: Vec<&str> = property.iter().map(|s| s.value.as_str()).collect();
        assert!(values.contains(&"River Paper Inn"));
        assert!(values.contains(&"Nishiki Market"));
        assert!(
            property
                .iter()
                .any(|s| s.source == SuggestionSource::ConfirmedFact)
        );
        assert!(
            property
                .iter()
                .any(|s| s.source == SuggestionSource::PackPlace)
        );

        // Address suggestions come only from confirmed facts (places carry none),
        // and the query filters case-insensitively.
        let address = service
            .suggest_field_values(&trip.id, "address", "paper")
            .expect("address suggestions");
        assert_eq!(address.len(), 1);
        assert_eq!(address[0].value, "7 Paper Street, Kyoto");
        assert!(
            address
                .iter()
                .all(|s| s.source != SuggestionSource::PackPlace)
        );

        // An unsupported field is a validation error, not a silent empty list.
        assert_eq!(
            service
                .suggest_field_values(&trip.id, "confirmationCode", "")
                .expect_err("unsupported field")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        cleanup_database(database);
    }

    #[test]
    fn suggest_field_values_skips_confirmed_source_when_the_vault_is_locked() {
        let database = temp_database("suggest-fields-locked");
        let secrets = Arc::new(MemorySecretStore::default());
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
        .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    address: Some("7 Paper Street, Kyoto".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual stay");
        service
            .set_vault_passphrase("correct horse battery")
            .expect("set passphrase");

        // Reopen: the vault is locked, so the confirmed-fact source is unreadable.
        // Suggestions must degrade to empty rather than surfacing a locked error.
        let reopened = AppService::open_path_with_deps(
            &database,
            Arc::new(FakeFetcher::offline()),
            secrets.clone(),
        )
        .expect("reopen");
        assert!(reopened.get_vault_status().expect("status").locked);
        let address = reopened
            .suggest_field_values(&trip.id, "address", "")
            .expect("suggestions must not error when locked");
        assert!(address.is_empty());
        cleanup_database(database);
    }

    /// An Ollama stub that returns a fixed chat reply and records the posted body.
    struct DraftOllamaStub {
        reply: String,
        last_body: std::sync::Mutex<String>,
    }
    impl AdviceFetcher for DraftOllamaStub {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            panic!("draft must POST, not GET");
        }
        fn post_json(
            &self,
            url: &str,
            body: &str,
            _headers: &[(&str, &str)],
        ) -> Result<String, AppError> {
            assert_eq!(url, "http://localhost:11434/api/chat");
            *self.last_body.lock().expect("lock") = body.to_owned();
            Ok(serde_json::json!({
                "message": { "role": "assistant", "content": self.reply }
            })
            .to_string())
        }
    }

    /// Import a flight memo that the plaintext parser actually extracts from,
    /// and return (document id, its candidate ids). `import_stay_text` is
    /// deliberately unparseable — it exists for the gap-filling draft tests — so
    /// it is useless anywhere the candidates themselves matter.
    fn import_flight_memo(service: &AppService, trip_id: &str) -> (String, Vec<String>) {
        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip_id.to_owned(),
                kind: DocumentKind::PastedText,
                label: Some("Flight memo".to_owned()),
                content: "Confirmation HOLD9\nRoute SFO-NRT\n2027-04-02T10:00".to_owned(),
            })
            .expect("import");
        assert!(
            !imported.candidates.is_empty(),
            "fixture must produce candidates"
        );
        (
            imported.document.id,
            imported.candidates.iter().map(|c| c.id.clone()).collect(),
        )
    }

    fn import_stay_text(service: &AppService, trip_id: &str) -> String {
        service
            .import_document(ImportDocumentInput {
                trip_id: trip_id.to_owned(),
                kind: DocumentKind::PastedText,
                label: Some("Hotel email".to_owned()),
                content: "River Paper Inn — check in 2027-04-02, check out 2027-04-08.".to_owned(),
            })
            .expect("import")
            .document
            .id
    }

    #[test]
    fn run_assist_draft_turns_a_valid_reply_into_pending_assisted_candidates() {
        let reply = r#"{"stays":[
            {"propertyName":"River Paper Inn","checkinDate":"2027-04-02","checkoutDate":"2027-04-08"},
            {"propertyName":"Late Inn","checkinDate":"2027-05-01","checkoutDate":"2027-05-03"}
        ]}"#;
        let database = temp_database("draft-run");
        let stub = Arc::new(DraftOllamaStub {
            reply: reply.to_owned(),
            last_body: std::sync::Mutex::new(String::new()),
        });
        let service = open_test_service_with_fetcher(&database, stub.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let document_id = import_stay_text(&service, &trip.id);

        let result = service
            .run_assist_draft(&trip.id, "lodging_dates")
            .expect("draft");
        assert_eq!(result.candidates.len(), 2);

        let in_window = &result.candidates[0];
        assert_eq!(in_window.method, ExtractionMethod::Assisted);
        assert_eq!(in_window.status, CandidateStatus::Pending);
        assert_eq!(in_window.fact_type, FactType::LodgingStay);
        assert_eq!(in_window.document_id, document_id);
        assert_eq!(
            in_window.payload.checkin_date.as_deref(),
            Some("2027-04-02")
        );
        assert!(in_window.warnings.is_empty());
        // The out-of-window stay is flagged for the reviewer, not dropped.
        assert!(
            result.candidates[1]
                .warnings
                .contains(&WarningCode::OutsideTripWindow)
        );

        // The proposals are now reviewable pending candidates.
        let pending = service
            .list_candidates(&trip.id, Some(CandidateStatus::Pending))
            .expect("pending");
        assert_eq!(pending.len(), 2);

        // The posted request carried the imported text and the trip dates.
        let body = stub.last_body.lock().expect("lock").clone();
        assert!(body.contains("River Paper Inn"));
        assert!(body.contains("2027-04-01 to 2027-04-10"));
        cleanup_database(database);
    }

    #[test]
    fn run_assist_draft_rejects_a_malformed_reply_and_saves_nothing() {
        let database = temp_database("draft-bad");
        let stub = Arc::new(DraftOllamaStub {
            reply: "I couldn't find any dates in there.".to_owned(),
            last_body: std::sync::Mutex::new(String::new()),
        });
        let service = open_test_service_with_fetcher(&database, stub).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        import_stay_text(&service, &trip.id);

        assert_eq!(
            service
                .run_assist_draft(&trip.id, "lodging_dates")
                .expect_err("malformed")
                .code,
            ErrorCode::AssistFailed
        );
        // Nothing was persisted from the bad reply.
        assert!(
            service
                .list_candidates(&trip.id, Some(CandidateStatus::Pending))
                .expect("pending")
                .is_empty()
        );
        cleanup_database(database);
    }

    #[test]
    fn run_assist_draft_without_documents_calls_no_model() {
        // Panics if the model is ever contacted: with no documents to read there
        // is nothing to ask it about.
        let database = temp_database("draft-empty");
        let service = open_test_service_with_fetcher(&database, Arc::new(FakeFetcher::offline()))
            .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let result = service
            .run_assist_draft(&trip.id, "lodging_dates")
            .expect("draft");
        assert!(result.candidates.is_empty());

        // An unknown draft kind is a validation error.
        assert_eq!(
            service
                .run_assist_draft(&trip.id, "made_up_kind")
                .expect_err("unknown kind")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        cleanup_database(database);
    }

    /// A database in the shape shipped before this ledger existed: the fact
    /// tables reject 'assisted', confirmed_facts has no source_removed, and
    /// user_version is 1 because every build stamped it on open regardless.
    fn legacy_database() -> Connection {
        let connection = Connection::open_in_memory().expect("db");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE trips (id TEXT PRIMARY KEY);
                 CREATE TABLE source_documents (id TEXT PRIMARY KEY,
                     trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE);
                 CREATE TABLE parser_runs (id TEXT PRIMARY KEY,
                     document_id TEXT REFERENCES source_documents(id) ON DELETE CASCADE);
                 CREATE TABLE candidate_facts (
                     id TEXT PRIMARY KEY,
                     trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                     document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                     parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                     fact_type TEXT NOT NULL,
                     payload TEXT NOT NULL,
                     method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                     field_spans TEXT NOT NULL,
                     warnings TEXT NOT NULL,
                     status TEXT NOT NULL,
                     created_at TEXT NOT NULL,
                     resolved_at TEXT
                 );
                 CREATE TABLE confirmed_facts (
                     id TEXT PRIMARY KEY,
                     trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                     fact_type TEXT NOT NULL,
                     payload TEXT NOT NULL,
                     method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                     candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                     corrected_fields TEXT NOT NULL,
                     confirmed_at TEXT NOT NULL
                 );
                 INSERT INTO trips (id) VALUES ('t1');
                 INSERT INTO source_documents (id, trip_id) VALUES ('d1', 't1');
                 INSERT INTO parser_runs (id, document_id) VALUES ('r1', 'd1');
                 INSERT INTO candidate_facts VALUES
                     ('c1','t1','d1','r1','lodging_stay','{}','manual','[]','[]','pending','now',NULL);
                 INSERT INTO confirmed_facts VALUES
                     ('f1','t1','lodging_stay','{}','manual',NULL,'[]','now');
                 PRAGMA user_version = 1;",
            )
            .expect("legacy schema");
        connection
    }

    fn columns_of(connection: &Connection, table: &str) -> Vec<String> {
        let mut statement = connection
            .prepare(&format!("PRAGMA table_info({table})"))
            .expect("table_info");
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("columns")
            .collect::<rusqlite::Result<Vec<String>>>()
            .expect("columns")
    }

    /// Every column declared in [`SEALED_COLUMNS`] must actually be ciphertext on
    /// disk and plaintext through the record reads.
    ///
    /// Driven by the declaration itself: add a pair there and this fails until
    /// the read and write paths seal it. That is the whole point of having one
    /// list — before, the list only drove the legacy migration and each SELECT
    /// re-decided sealing by hand, so a forgotten open returned "v1:<base64>" to
    /// the UI with nothing objecting.
    #[test]
    fn sealed_columns_round_trip_through_the_vault() {
        let database = temp_database("sealed-columns");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Populate every sealed column: a document, its candidates, a confirmed
        // fact, and notes.
        let (_document_id, candidate_ids) = import_flight_memo(&service, &trip.id);
        service
            .confirm_candidate(ConfirmCandidateInput {
                candidate_id: candidate_ids[0].clone(),
                edited_payload: None,
            })
            .expect("confirm");
        service
            .set_trip_notes(&trip.id, "Gate code 5150, ask for Rin")
            .expect("notes");
        // Populate every traveler-planning sealed column through the public
        // service. The direct insert is only the non-sensitive downloaded-pack
        // prerequisite for the saved recommendation.
        service
            .connection()
            .expect("connection")
            .execute(
                "INSERT INTO downloaded_packs
                    (trip_id, pack_id, name, region, place_count, article_count, content, downloaded_at)
                 VALUES (?1, 'us-nashville', 'Nashville', 'Tennessee', 1, 0, '{}', 'now')",
                params![trip.id],
            )
            .expect("pack prerequisite");
        let saved = service
            .save_place(SavePlaceInput {
                trip_id: trip.id.clone(),
                recommendation: Recommendation {
                    pack_id: "us-nashville".to_owned(),
                    name: "Frist Art Museum".to_owned(),
                    category: "art_museum".to_owned(),
                    dimension: "culture".to_owned(),
                    lat: 36.156,
                    lon: -86.783,
                    source: "Overture Maps".to_owned(),
                    license: "CDLA-Permissive-2.0".to_owned(),
                    score: 1.0,
                    reasons: vec!["Matches your interest in culture".to_owned()],
                    wildcard: false,
                },
                notes: "Meet Hana by the side entrance".to_owned(),
            })
            .expect("saved place");
        service
            .add_packing_item(AddPackingItemInput {
                trip_id: trip.id.clone(),
                label: "Passport copy".to_owned(),
                suggestion_code: None,
            })
            .expect("packing");
        service
            .create_trip_item(CreateTripItemInput {
                trip_id: trip.id.clone(),
                kind: voyalier_core::TripItemKind::Activity,
                title: "Private studio visit".to_owned(),
                location: Some("12 Secret Lane".to_owned()),
                start_at: None,
                end_at: None,
                notes: Some("Door code 8080".to_owned()),
                saved_place_id: Some(saved.id),
            })
            .expect("trip item");

        let connection = service.connection().expect("connection");
        for (table, column) in SEALED_COLUMNS {
            let stored: Vec<String> = {
                let mut statement = connection
                    .prepare(&format!("SELECT {column} FROM {table}"))
                    .expect("prepare");
                statement
                    .query_map([], |row| row.get::<_, String>(0))
                    .expect("query")
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .expect("rows")
            };
            assert!(
                !stored.is_empty(),
                "{table}.{column} has no rows — the fixture must exercise every sealed column"
            );
            for value in stored {
                assert!(
                    value.starts_with(VAULT_PREFIX),
                    "{table}.{column} is stored in the clear: {value:.40}"
                );
            }
        }
        drop(connection);

        // ...and the read paths hand back plaintext, not the stored envelope.
        let notes = service.get_trip_notes(&trip.id).expect("notes");
        assert_eq!(notes.body, "Gate code 5150, ask for Rin");
        assert!(!notes.body.starts_with(VAULT_PREFIX));

        let detail = service.get_trip(&trip.id).expect("detail");
        let payload = serde_json::to_string(&detail.confirmed_facts[0].payload).expect("json");
        assert!(!payload.contains(VAULT_PREFIX));
        assert_eq!(
            detail.saved_places[0].notes,
            "Meet Hana by the side entrance"
        );
        assert_eq!(detail.packing_items[0].label, "Passport copy");
        assert_eq!(
            detail.trip_items[0].location.as_deref(),
            Some("12 Secret Lane")
        );

        drop(service);
        cleanup_database(database);
    }

    #[test]
    fn a_legacy_database_migrates_in_order_and_keeps_its_rows() {
        let connection = legacy_database();
        migrate(&connection).expect("migrate");

        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        // add_source_removed ran after widen_method_check rebuilt the table, so
        // the column is present rather than dropped by the rebuild's copy.
        assert!(columns_of(&connection, "confirmed_facts").contains(&"source_removed".to_owned()));
        // Both pre-existing rows survived the rebuild.
        let kept: i64 = connection
            .query_row("SELECT count(*) FROM confirmed_facts", [], |row| row.get(0))
            .expect("count");
        assert_eq!(kept, 1);
        // The widened constraint took effect.
        connection
            .execute(
                "INSERT INTO candidate_facts VALUES
                 ('c2','t1','d1','r1','lodging_stay','{}','assisted','[]','[]','pending','now',NULL)",
                [],
            )
            .expect("assisted now allowed");
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let connection = legacy_database();
        migrate(&connection).expect("first");
        connection
            .execute(
                "UPDATE confirmed_facts SET source_removed = 1 WHERE id = 'f1'",
                [],
            )
            .expect("mark");

        migrate(&connection).expect("second");

        // The steps did not run again: the row and its new column value stand.
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        let removed: i64 = connection
            .query_row(
                "SELECT source_removed FROM confirmed_facts WHERE id = 'f1'",
                [],
                |row| row.get(0),
            )
            .expect("value");
        assert_eq!(removed, 1);
    }

    #[test]
    fn a_fresh_database_is_stamped_at_the_target_version() {
        let path = temp_database("migrate-fresh");
        let service = open_test_service(&path).expect("service");
        {
            let connection = service.connection().expect("connection");
            assert_eq!(
                user_version(&connection).expect("version"),
                target_schema_version()
            );
            assert!(
                columns_of(&connection, "confirmed_facts").contains(&"source_removed".to_owned())
            );
        }
        drop(service);
        cleanup_database(path);
    }

    #[test]
    fn migration_versions_are_ordered_and_unique() {
        // The list is the ordering, so a bad edit must fail here rather than in
        // a user's database.
        let versions: Vec<i64> = MIGRATIONS.iter().map(|migration| migration.to).collect();
        let mut sorted = versions.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(versions, sorted, "migration versions ascend and are unique");
        assert!(versions.first().is_some_and(|first| *first > 1));
    }

    #[test]
    fn migrate_method_check_widens_an_old_constraint_and_keeps_rows() {
        // A pre-drafts database: the fact tables reject 'assisted'.
        let connection = Connection::open_in_memory().expect("db");
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE trips (id TEXT PRIMARY KEY);
                 CREATE TABLE source_documents (id TEXT PRIMARY KEY,
                     trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE);
                 CREATE TABLE parser_runs (id TEXT PRIMARY KEY,
                     document_id TEXT REFERENCES source_documents(id) ON DELETE CASCADE);
                 CREATE TABLE candidate_facts (
                     id TEXT PRIMARY KEY,
                     trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                     document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                     parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                     fact_type TEXT NOT NULL,
                     payload TEXT NOT NULL,
                     method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                     field_spans TEXT NOT NULL,
                     warnings TEXT NOT NULL,
                     status TEXT NOT NULL,
                     created_at TEXT NOT NULL,
                     resolved_at TEXT
                 );
                 CREATE TABLE confirmed_facts (
                     id TEXT PRIMARY KEY,
                     trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                     fact_type TEXT NOT NULL,
                     payload TEXT NOT NULL,
                     method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                     candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                     corrected_fields TEXT NOT NULL,
                     confirmed_at TEXT NOT NULL
                 );
                 INSERT INTO trips (id) VALUES ('t1');
                 INSERT INTO source_documents (id, trip_id) VALUES ('d1', 't1');
                 INSERT INTO parser_runs (id, document_id) VALUES ('r1', 'd1');
                 INSERT INTO candidate_facts VALUES
                     ('c1','t1','d1','r1','lodging_stay','{}','manual','[]','[]','pending','now',NULL);",
            )
            .expect("old schema");

        // Before the migration, an assisted method is rejected.
        assert!(
            connection
                .execute(
                    "INSERT INTO candidate_facts VALUES
                     ('c2','t1','d1','r1','lodging_stay','{}','assisted','[]','[]','pending','now',NULL)",
                    [],
                )
                .is_err()
        );

        migrate_method_check(&connection).expect("migrate");

        // The pre-existing row survived...
        let kept: i64 = connection
            .query_row("SELECT count(*) FROM candidate_facts", [], |row| row.get(0))
            .expect("count");
        assert_eq!(kept, 1);
        // ...and an assisted row now inserts into both fact tables.
        connection
            .execute(
                "INSERT INTO candidate_facts VALUES
                 ('c2','t1','d1','r1','lodging_stay','{}','assisted','[]','[]','pending','now',NULL)",
                [],
            )
            .expect("assisted candidate now allowed");
        connection
            .execute(
                "INSERT INTO confirmed_facts VALUES
                 ('cf1','t1','lodging_stay','{}','assisted','c2','[]','now')",
                [],
            )
            .expect("assisted confirmed fact now allowed");
        // Re-running is a no-op (the constraint already allows 'assisted').
        migrate_method_check(&connection).expect("idempotent");

        // The two migrations run in this order for real, and the order is load
        // bearing: migrate_method_check rebuilds confirmed_facts with
        // `INSERT ... SELECT *`, so source_removed must arrive after it or the
        // copy would push nine columns into an eight-column table.
        migrate_source_removed(&connection).expect("add source_removed");
        let flag: i64 = connection
            .query_row(
                "SELECT source_removed FROM confirmed_facts WHERE id = 'cf1'",
                [],
                |row| row.get(0),
            )
            .expect("column exists");
        // A fact that predates the documents manager still has its source.
        assert_eq!(flag, 0);
        // Adding the column twice must not fail.
        migrate_source_removed(&connection).expect("idempotent");
    }

    #[test]
    fn ai_prompt_overrides_and_reset_flow_into_requests() {
        // Captures the draft POST so we can see which instruction was sent.
        struct CaptureStub {
            last_body: std::sync::Mutex<String>,
        }
        impl AdviceFetcher for CaptureStub {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("assist must POST, not GET");
            }
            fn post_json(
                &self,
                _url: &str,
                body: &str,
                _headers: &[(&str, &str)],
            ) -> Result<String, AppError> {
                *self.last_body.lock().expect("lock") = body.to_owned();
                Ok(serde_json::json!({ "message": { "content": "{\"stays\":[]}" } }).to_string())
            }
        }

        let database = temp_database("ai-prompts");
        let stub = Arc::new(CaptureStub {
            last_body: std::sync::Mutex::new(String::new()),
        });
        let service = open_test_service_with_fetcher(&database, stub.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Defaults out of the box, no overrides.
        let prompts = service.get_ai_prompts().expect("prompts");
        assert_eq!(prompts.prompts.len(), 2);
        assert!(prompts.prompts.iter().all(|p| p.custom_text.is_none()));

        // A custom assist instruction flows into the assist preview (which run reuses).
        service
            .set_ai_prompt("assist", Some("ASSIST-CUSTOM-RULE"))
            .expect("set assist");
        let preview = service.preview_assist(&trip.id, "ollama").expect("preview");
        assert_eq!(preview.system_prompt, "ASSIST-CUSTOM-RULE");

        // Resetting restores the default, which forbids inventing high-stakes facts.
        service.set_ai_prompt("assist", None).expect("reset assist");
        let preview = service.preview_assist(&trip.id, "ollama").expect("preview");
        assert!(preview.system_prompt.contains("Do not invent"));

        // A custom draft instruction is what actually gets POSTed to the model.
        import_stay_text(&service, &trip.id);
        service
            .set_ai_prompt("draft_lodging_dates", Some("DRAFT-CUSTOM-RULE"))
            .expect("set draft");
        let draft_preview = service
            .preview_assist_draft(&trip.id, "lodging_dates")
            .expect("draft preview");
        assert_eq!(draft_preview.system_prompt, "DRAFT-CUSTOM-RULE");
        service
            .run_assist_draft(&trip.id, "lodging_dates")
            .expect("run draft");
        assert!(
            stub.last_body
                .lock()
                .expect("lock")
                .contains("DRAFT-CUSTOM-RULE")
        );

        // A blank override and an unknown kind are validation errors.
        assert_eq!(
            service
                .set_ai_prompt("assist", Some("   "))
                .expect_err("blank")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            service
                .set_ai_prompt("made_up", None)
                .expect_err("kind")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        cleanup_database(database);
    }

    #[test]
    fn preview_assist_draft_stays_on_device_and_shows_the_text() {
        let database = temp_database("draft-preview");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        import_stay_text(&service, &trip.id);

        let preview = service
            .preview_assist_draft(&trip.id, "lodging_dates")
            .expect("preview");
        assert!(!preview.leaves_device);
        assert_eq!(preview.endpoint, "http://localhost:11434/api/chat");
        assert!(preview.withheld.is_empty());
        assert!(preview.user_content.contains("River Paper Inn"));
        assert!(preview.grounded_in.iter().any(|g| g.contains("imported")));
        cleanup_database(database);
    }

    /// The exact confirmation the web app's "Explore a sample trip" imports.
    /// Included from the shared fixture rather than copied, so this test fails
    /// if the shipped sample ever stops parsing.
    const SAMPLE_CONFIRMATION: &str =
        include_str!("../../../packages/contracts/fixtures/sample-confirmation.html");

    #[test]
    fn the_sample_confirmation_parses_into_a_flight_and_a_stay() {
        // The sample is a newcomer's first impression: if its JSON-LD is wrong,
        // "Explore a sample trip" lands them on an empty trip with nothing to
        // review — the exact opposite of the point — and no UI test would notice,
        // because parsing happens here, not in the web layer.
        let database = temp_database("sample-parse");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::Html,
                label: Some("Sample confirmation email".to_owned()),
                content: SAMPLE_CONFIRMATION.to_owned(),
            })
            .expect("import sample");

        let flights = imported
            .candidates
            .iter()
            .filter(|c| c.fact_type == FactType::FlightSegment)
            .count();
        let stays = imported
            .candidates
            .iter()
            .filter(|c| c.fact_type == FactType::LodgingStay)
            .count();
        assert_eq!(flights, 1, "sample must yield exactly one flight");
        assert_eq!(stays, 1, "sample must yield exactly one stay");
        // Left pending on purpose: the demo IS the review.
        assert!(
            imported
                .candidates
                .iter()
                .all(|c| c.status == CandidateStatus::Pending)
        );
        // Structured, not guessed — proving it took the JSON-LD path a real
        // airline email takes.
        assert!(
            imported
                .candidates
                .iter()
                .all(|c| c.method == ExtractionMethod::Structured)
        );
        cleanup_database(database);
    }

    #[test]
    fn trip_notes_round_trip_and_are_sealed_at_rest() {
        let database = temp_database("notes-seal");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Never written is an empty body, not an error.
        let empty = service.get_trip_notes(&trip.id).expect("get");
        assert_eq!(empty.body, "");
        assert!(empty.updated_at.is_none());

        let saved = service
            .set_trip_notes(&trip.id, "Ask about the tea house")
            .expect("set");
        assert_eq!(saved.body, "Ask about the tea house");
        assert!(saved.updated_at.is_some());
        assert_eq!(
            service.get_trip_notes(&trip.id).expect("get").body,
            "Ask about the tea house"
        );

        // The row on disk must not hold the plaintext.
        let connection = Connection::open(&database).expect("open db");
        let stored: String = connection
            .query_row("SELECT body FROM trip_notes", [], |row| row.get(0))
            .expect("stored row");
        assert!(
            !stored.contains("tea house"),
            "notes must be sealed at rest"
        );
        drop(connection);
        cleanup_database(database);
    }

    #[test]
    fn clearing_trip_notes_removes_them_rather_than_storing_blank() {
        let database = temp_database("notes-clear");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service.set_trip_notes(&trip.id, "Temporary").expect("set");

        let cleared = service.set_trip_notes(&trip.id, "").expect("clear");
        assert_eq!(cleared.body, "");
        // Cleared and never-written are one state, not two.
        assert!(cleared.updated_at.is_none());
        assert!(
            service
                .get_trip_notes(&trip.id)
                .expect("get")
                .updated_at
                .is_none()
        );
        cleanup_database(database);
    }

    #[test]
    fn trip_notes_are_bounded_and_never_reach_a_brief() {
        let database = temp_database("notes-bounds");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let too_long = "x".repeat(MAX_NOTES_CHARS + 1);
        assert_eq!(
            service
                .set_trip_notes(&trip.id, &too_long)
                .unwrap_err()
                .code,
            ErrorCode::ValidationInvalidInput
        );

        // The brief is built from the trip and its facts, so notes have no path
        // into it. Assert the property rather than trusting the shape.
        service
            .set_trip_notes(&trip.id, "SECRET-NOTE-TEXT")
            .expect("set");
        let brief = service.get_trip_brief(&trip.id).expect("brief");
        let rendered = serde_json::to_string(&brief).expect("json");
        assert!(!rendered.contains("SECRET-NOTE-TEXT"));
        cleanup_database(database);
    }

    #[test]
    fn documents_are_listed_newest_first_with_their_candidate_counts() {
        let database = temp_database("documents-list");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let (document_id, _) = import_flight_memo(&service, &trip.id);

        let documents = service.list_documents(&trip.id).expect("list");
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].document.id, document_id);
        assert_eq!(documents[0].document.label, "Flight memo");
        // The import produced candidates, none reviewed yet.
        assert!(documents[0].pending_count > 0);
        assert_eq!(documents[0].confirmed_count, 0);

        // Confirming one moves it across the two counters.
        let pending = service
            .list_candidates(&trip.id, Some(CandidateStatus::Pending))
            .expect("candidates");
        let before = documents[0].pending_count;
        service
            .confirm_candidate(ConfirmCandidateInput {
                candidate_id: pending[0].id.clone(),
                edited_payload: None,
            })
            .expect("confirm");
        let documents = service.list_documents(&trip.id).expect("list");
        assert_eq!(documents[0].pending_count, before - 1);
        assert_eq!(documents[0].confirmed_count, 1);
        cleanup_database(database);
    }

    #[test]
    fn a_document_body_is_readable_back_and_gone_after_deletion() {
        let database = temp_database("documents-read");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let document_id = import_stay_text(&service, &trip.id);

        // The body is sealed at rest but must come back intact — this is the
        // whole point of the manager: seeing what you handed over.
        let stored = service.get_document(&document_id).expect("get");
        assert!(stored.content.contains("River Paper Inn"));
        assert_eq!(stored.document.id, document_id);

        service.delete_document(&document_id).expect("delete");
        assert_eq!(
            service.get_document(&document_id).unwrap_err().code,
            ErrorCode::DocumentNotFound
        );
        assert!(service.list_documents(&trip.id).expect("list").is_empty());
        cleanup_database(database);
    }

    #[test]
    fn deleting_a_document_drops_pending_candidates_but_keeps_confirmed_facts() {
        let database = temp_database("documents-cascade");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let (document_id, candidates) = import_flight_memo(&service, &trip.id);

        // Confirm one candidate; anything else stays pending.
        service
            .confirm_candidate(ConfirmCandidateInput {
                candidate_id: candidates[0].clone(),
                edited_payload: None,
            })
            .expect("confirm");

        service.delete_document(&document_id).expect("delete");

        // Pending candidates were unreviewed derivatives of a discarded body.
        assert!(
            service
                .list_candidates(&trip.id, Some(CandidateStatus::Pending))
                .expect("candidates")
                .is_empty()
        );
        // The confirmed fact survives — the traveler approved it — but it is
        // flagged, so the UI stops offering evidence that no longer exists.
        let detail = service.get_trip(&trip.id).expect("detail");
        assert_eq!(detail.confirmed_facts.len(), 1);
        assert!(detail.confirmed_facts[0].source_removed);
        // And it must not be mistaken for a fact the traveler typed by hand.
        assert_ne!(detail.confirmed_facts[0].method, ExtractionMethod::Manual);
        cleanup_database(database);
    }

    #[test]
    fn a_manual_fact_is_never_flagged_as_source_removed() {
        let database = temp_database("documents-manual");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let (document_id, _) = import_flight_memo(&service, &trip.id);
        let manual = service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    property_name: Some("Hand typed".to_owned()),
                    checkin_date: Some("2027-04-02".to_owned()),
                    checkout_date: Some("2027-04-08".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual");

        // Deleting an unrelated document must not touch a hand-typed fact: it
        // has no candidate, so nothing links it to the document.
        service.delete_document(&document_id).expect("delete");
        let detail = service.get_trip(&trip.id).expect("detail");
        let stored = detail
            .confirmed_facts
            .iter()
            .find(|fact| fact.id == manual.id)
            .expect("manual fact survives");
        assert!(!stored.source_removed);
        assert!(stored.candidate_id.is_none());
        cleanup_database(database);
    }

    #[test]
    fn deleting_a_document_that_does_not_exist_is_an_error_not_a_silent_success() {
        let database = temp_database("documents-missing");
        let service = open_test_service(&database).expect("service");
        assert_eq!(
            service.delete_document("document_nope").unwrap_err().code,
            ErrorCode::DocumentNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn unarchive_restores_an_archived_trip_to_draft() {
        let database = temp_database("unarchive");
        let service = open_test_service(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        assert_eq!(
            service.archive_trip(&trip.id).expect("archive").status,
            TripStatus::Archived
        );
        assert_eq!(
            service.unarchive_trip(&trip.id).expect("unarchive").status,
            TripStatus::Draft
        );
        cleanup_database(database);
    }

    #[test]
    fn a_weather_network_failure_is_a_weather_error_not_an_advice_one() {
        let database = temp_database("weather-neterr");
        let service = open_test_service_with_fetcher(&database, Arc::new(FakeFetcher::new()))
            .expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        // fetch_weather re-flavors the fetch failure so the panel never wears
        // travel-advice wording.
        assert_eq!(
            service
                .fetch_weather(&trip.id)
                .expect_err("weather fails")
                .code,
            ErrorCode::WeatherFetchFailed
        );
        cleanup_database(database);
    }
}
