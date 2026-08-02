use std::{
    collections::HashMap,
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
    ChatContext, ChatMessage, ChatRole, ClimateNormals, ClockChange, ConfirmCandidateInput,
    ConfirmedFact, CreateResourceInput, CreateTripInput, CreateTripItemInput,
    DRAFT_LODGING_DATES_SYSTEM_PROMPT, DestinationFactsSnapshot, DocumentContent, DocumentKind,
    DocumentParse, DocumentSummary, DownloadedPack, ErrorCode, ExtractionMethod, FCDO_COUNTRIES,
    FIELD_SUGGESTION_LIMIT, FactPayload, FactType, FcdoCountry, FieldSuggestion, GeocodedPlace,
    HealthNotice, HealthResponse, ImportDocumentInput, ImportResult, IntelligenceMode,
    InterestProfile, KeyValidation, LocalAiStatus, LocalModelPullResult, LodgingDateProposal,
    MAX_AI_PROMPT_LEN, MAX_CHAT_CONTEXT_RECORDS, MAX_CHAT_EXCERPT_CHARS, MAX_NOTES_CHARS,
    MAX_OFFLINE_MAP_BYTES, OLLAMA_PULL_URL, OLLAMA_TAGS_URL, OfflineMapArchive, OfflineMapChunk,
    OfflineMapDescriptor, PROVIDERS, PackContent, PackInfo, PackSuggestion, PackingItem,
    PersonaWeights, PlaceSummary, ProviderConfig, ProviderId, PublicHolidaysSnapshot,
    Recommendation, RedactionPolicy, ResearchSettings, Resource, ResourceSnapshot,
    SEARCH_SUGGESTION_LIMIT, SavePlaceInput, SavedPlace, SearchHit, SearchHitSource,
    SearchableDocument, SearchableResource, SetInterestProfileInput, SetResearchSettingsInput,
    SetVisaItemProgressInput, SetVisaNationalityInput, SourceDocument, SourceState, SourceStatus,
    SuggestionSource, TodayView, Trip, TripAssessment, TripBrief, TripDetail, TripItem, TripNotes,
    TripStatus, TripSummary, UpdatePackingItemInput, UpdateResourceInput, UpdateSavedPlaceInput,
    UpdateTripInput, UpdateTripItemInput, VisaPrep, VisaSelfReport, WarningCode, WeatherAlert,
    WeatherSnapshot, WorkspaceSearchHit, WorkspaceSearchRecord, WorkspaceSearchSource,
    advisory_country, air_quality, assess_trip, build_assist_preview, build_assist_request,
    build_chat_prompt, build_draft_preview, build_key_validation_request, build_packing_list,
    build_pull_body, build_today_view, build_trip_brief, ca_gac_advisory, cdc_health_notices,
    changed_payload_fields, climate_normals, compute_astro_day, country_facts, de_aa_advisory,
    derived_link_title, detect_planned_item_conflicts, ecb_rates, entry_from_fcdo,
    estimate_flight_emissions, estimate_tokens, extract_readable_page, fact_identity,
    fact_search_text, forecast, geocode, high_stakes_topics, holidays_within,
    interpret_key_validation, interpret_pull_response, matching_airports, missions_in,
    nearest_airports, new_id, now_rfc3339, nws_alerts, offline_map_download_url, pack_catalog,
    pack_download_url, parse_assist_reply, parse_import, parse_lodging_dates_reply,
    parse_pack_content, place_summary, provider_info, public_holidays, rank_field_suggestions,
    recommend_attributed_places, resource_url_identity, saved_place_identity, school_holidays,
    school_holidays_covered, school_holidays_within, search_cities, search_trip_corpus,
    search_workspace_corpus, sky_events_within, suggest_packs, suggest_search_terms,
    time_difference, tipping_guidance, travel_advice, us_state_advisory, validate_api_key,
    validate_chat_message, validate_country_slug, validate_create_resource, validate_create_trip,
    validate_create_trip_item, validate_fact_payload, validate_model_name, validate_pack_id,
    validate_packing_label, validate_planning_notes, validate_provider_id, validate_resource_url,
    validate_search_query, validate_update_resource, validate_update_trip, world_heritage_near,
};
use voyalier_core::{
    BACKUP_FORMAT_VERSION, BackupManifest, VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN,
    VaultStatus, derive_key as vault_derive_key, open as vault_open, open_backup,
    seal as vault_seal, seal_backup,
};

const DATABASE_FILE: &str = "voyalier.sqlite3";
const MAX_OFFLINE_MAP_RANGE: u32 = 4 * 1024 * 1024;

mod records;
mod sealed;
mod service_assist;
mod service_backup;
mod service_chat;
mod service_documents;
mod service_packs;
mod service_planning;
mod service_providers;
mod service_resources;
mod service_retrieved;
mod service_search;
mod service_trips;
/// One imported document as `(id, label, decrypted text)`.
mod service_vault;
mod service_visa;
mod snapshots;

use records::{Records, SEALED_COLUMNS, ensure_candidate_pending};
use snapshots::invalidate_after_trip_edit;

type DocumentText = (String, String, String);

struct OwnedWorkspaceSearchRecord {
    source: WorkspaceSearchSource,
    trip_id: String,
    trip_title: String,
    trip_status: voyalier_core::TripStatus,
    trip_updated_at: String,
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
                if getrandom::fill(&mut key).is_err() {
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
///
/// Sealed columns are read as `Option<String>`, because several of them are
/// nullable — `trip_items.location`, `trip_items.notes`, and both visa-prep
/// columns. Reading those as `String` made a NULL an `AppError` from
/// `open_path`, so one manual plan without a location, or one ticked visa
/// document without a note, refused to open the workspace at all. A NULL is
/// nothing to seal, so it is skipped rather than repaired.
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
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
                })
                .map_err(storage_error)?;
            collect_rows(rows)?
                .into_iter()
                .filter_map(|(id, value): (String, Option<String>)| value.map(|value| (id, value)))
                .collect()
        };
        for (id, value) in legacy {
            if value.starts_with(VAULT_PREFIX) {
                continue;
            }
            let sealed = vault.seal(&value)?;
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
                origin_utc_offset_minutes INTEGER,
                timezone TEXT NOT NULL DEFAULT '',
                origin_timezone TEXT
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
    Migration {
        to: 11,
        name: "saved_place_folded_identity",
        run: migrate_saved_place_folded_identity,
    },
    Migration {
        to: 12,
        name: "visa_preparation",
        run: migrate_visa_preparation,
    },
    Migration {
        to: 13,
        name: "school_holidays",
        run: migrate_school_holidays,
    },
    Migration {
        to: 14,
        name: "trip_resources",
        run: migrate_trip_resources,
    },
    Migration {
        to: 15,
        name: "chat_messages",
        run: migrate_chat_messages,
    },
    Migration {
        to: 16,
        name: "destination_facts_timezone",
        run: migrate_facts_timezone,
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

/// Research the traveler kept to read. Beside the evidence tables for the same
/// reason planning is: a saved link is not a source document, and nothing here
/// is ever parsed into a candidate fact.
///
/// `url_identity` carries the folded form of the address, and the partial
/// unique index over it is what makes saving the same page twice a no-op — the
/// service reads the conflict rather than counting rows first, so two quick
/// saves cannot race past a check.
fn migrate_trip_resources(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS trip_resources (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK(kind IN ('link', 'file')),
                url TEXT,
                url_identity TEXT,
                file_name TEXT,
                title TEXT NOT NULL,
                note TEXT NOT NULL,
                tags_json TEXT NOT NULL DEFAULT '[]',
                snapshot_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS trip_resources_url_identity
                ON trip_resources(trip_id, url_identity)
                WHERE url_identity IS NOT NULL;
            CREATE INDEX IF NOT EXISTS trip_resources_trip
                ON trip_resources(trip_id, created_at);",
        )
        .map_err(storage_error)
}

/// The traveler's own conversation with the on-device model.
///
/// Sealed, because a free-form message is whatever the traveler typed and may
/// carry the very codes the rest of the product works to keep out of prompts.
/// Deliberately absent from search: a searchable transcript would be retrieved
/// into the next prompt, and the model would start citing itself as local
/// knowledge.
fn migrate_chat_messages(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
                text TEXT NOT NULL,
                grounding_json TEXT NOT NULL DEFAULT '[]',
                pointers_json TEXT NOT NULL DEFAULT '[]',
                itinerary_facts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS chat_messages_trip
                ON chat_messages(trip_id, created_at);",
        )
        .map_err(storage_error)
}

/// Add traveler-owned planning records. These tables intentionally sit beside,
/// rather than inside, the evidence tables so a saved idea or manual activity
/// can never be mistaken for a confirmed fact.
/// Traveler-owned visa preparation. Following ADR-0005 these sit beside the
/// evidence tables rather than inside them: a ticked checklist row is the
/// traveler saying so, and must never read as a confirmed fact or clear
/// readiness. `nationality_iso2` and `note` are sealed (see `SEALED_COLUMNS`) --
/// nationality is personal data and notes carry application numbers.
fn migrate_visa_preparation(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            // `id` is not the natural key here -- one row per trip is -- but
            // migrate_encrypt_sensitive_columns re-seals legacy rows by
            // `SELECT id, <column>`, so every sealed table carries one. Matching
            // trip_notes costs a column; teaching that helper per-table keys
            // would cost a branch on every future sealed table.
            "CREATE TABLE IF NOT EXISTS visa_prep (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
                nationality_iso2 TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS visa_prep_items (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL,
                checked INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (trip_id, document_id)
            );

            CREATE INDEX IF NOT EXISTS visa_prep_items_trip
                ON visa_prep_items(trip_id);",
        )
        .map_err(storage_error)?;
    Ok(())
}

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

/// Persist the same folded place identity used by recommendation matching, so
/// case, punctuation, and diacritics cannot create duplicate saved places.
/// Existing duplicates are retired deterministically before the unique index
/// is installed; their sealed notes remain in the database, while linked plan
/// items point at the newest active saved record.
fn migrate_saved_place_folded_identity(connection: &Connection) -> Result<(), AppError> {
    let columns = {
        let mut statement = connection
            .prepare("PRAGMA table_info(saved_places)")
            .map_err(storage_error)?;
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?
    };
    if !columns.iter().any(|column| column == "name_folded") {
        connection
            .execute_batch("ALTER TABLE saved_places ADD COLUMN name_folded TEXT;")
            .map_err(storage_error)?;
    }
    if !columns.iter().any(|column| column == "merged_into") {
        connection
            .execute_batch(
                "ALTER TABLE saved_places ADD COLUMN merged_into TEXT
                 REFERENCES saved_places(id) ON DELETE CASCADE;",
            )
            .map_err(storage_error)?;
    }

    let rows = {
        let mut statement = connection
            .prepare(
                "SELECT id, trip_id, pack_id, name, lat, lon
                 FROM saved_places
                 WHERE merged_into IS NULL
                 ORDER BY updated_at DESC, id DESC",
            )
            .map_err(storage_error)?;
        statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, f64>(5)?,
                ))
            })
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?
    };

    let mut keepers: HashMap<(String, String, String, u64, u64), String> = HashMap::new();
    for (id, trip_id, pack_id, name, lat, lon) in rows {
        let folded = saved_place_identity(&name);
        let identity = (
            trip_id,
            pack_id,
            folded.clone(),
            lat.to_bits(),
            lon.to_bits(),
        );
        if let Some(keeper) = keepers.get(&identity) {
            connection
                .execute(
                    "UPDATE trip_items SET saved_place_id=?1 WHERE saved_place_id=?2",
                    params![keeper, id],
                )
                .map_err(storage_error)?;
            connection
                .execute(
                    "UPDATE saved_places SET name_folded=?2, merged_into=?3 WHERE id=?1",
                    params![id, folded, keeper],
                )
                .map_err(storage_error)?;
        } else {
            connection
                .execute(
                    "UPDATE saved_places SET name_folded=?2 WHERE id=?1",
                    params![id, folded],
                )
                .map_err(storage_error)?;
            keepers.insert(identity, id);
        }
    }

    connection
        .execute_batch(
            "DROP INDEX IF EXISTS saved_places_folded_identity;
             CREATE UNIQUE INDEX saved_places_folded_identity
             ON saved_places(trip_id, pack_id, name_folded, lat, lon)
             WHERE merged_into IS NULL;
             CREATE TRIGGER IF NOT EXISTS saved_places_require_folded_identity_insert
             BEFORE INSERT ON saved_places
             WHEN NEW.name_folded IS NULL
             BEGIN
                 SELECT RAISE(ABORT, 'saved place folded identity is required');
             END;
             CREATE TRIGGER IF NOT EXISTS saved_places_require_folded_identity_update
             BEFORE UPDATE OF name_folded ON saved_places
             WHEN NEW.name_folded IS NULL
             BEGIN
                 SELECT RAISE(ABORT, 'saved place folded identity is required');
             END;",
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

/// Carry the IANA zone beside the offset on `destination_facts_snapshots`.
///
/// Before this, a snapshot stored one offset resolved on the trip's start date,
/// so every trip spanning a DST transition rendered its later sun times — and
/// its dual clock — an hour wrong. Retry-safe by the same self-detection as
/// [`migrate_facts_origin`]. An existing row keeps its offset and simply
/// reports no clock change until the traveler fetches the facts again.
fn migrate_facts_timezone(connection: &Connection) -> Result<(), AppError> {
    let columns = {
        let mut statement = connection
            .prepare("PRAGMA table_info(destination_facts_snapshots)")
            .map_err(storage_error)?;
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(storage_error)?
    };
    // Two different nothings, and only one of them is "already done". No
    // columns at all means the table itself is absent — a database stamped past
    // v6 that never ran it — and altering it would break the chain for every
    // later step. Skip, exactly as the school-holiday step does.
    if columns.is_empty() || columns.iter().any(|name| name == "timezone") {
        return Ok(());
    }
    connection
        .execute_batch(
            "ALTER TABLE destination_facts_snapshots ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
             ALTER TABLE destination_facts_snapshots ADD COLUMN origin_timezone TEXT;",
        )
        .map_err(storage_error)
}

/// Add the school-holiday columns to `public_holidays_snapshots`.
///
/// Additive and retry-safe. An existing snapshot keeps its public holidays and
/// reads as "school holidays not covered" until the traveler fetches again,
/// which is the honest state: nothing was ever asked of the school-holiday
/// source for that row, so claiming it found nothing would be a fabrication.
fn migrate_school_holidays(connection: &Connection) -> Result<(), AppError> {
    let columns = {
        let mut statement = connection
            .prepare("PRAGMA table_info(public_holidays_snapshots)")
            .map_err(storage_error)?;
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<String>>>()
            .map_err(storage_error)?
    };
    if columns.iter().any(|name| name == "school_holidays") {
        return Ok(());
    }
    // An empty column list means the table is not there at all — a database
    // stamped past v8 without having run it. Altering a missing table would
    // fail the whole chain, so this step creates what it needs rather than
    // depending on an earlier step having run.
    if columns.is_empty() {
        return connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS public_holidays_snapshots (
                    trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                    country_code TEXT NOT NULL,
                    country_name TEXT NOT NULL,
                    holidays TEXT NOT NULL DEFAULT '[]',
                    school_holidays TEXT NOT NULL DEFAULT '[]',
                    school_holidays_covered INTEGER NOT NULL DEFAULT 0,
                    retrieved_at TEXT NOT NULL
                );",
            )
            .map_err(storage_error);
    }
    connection
        .execute_batch(
            "ALTER TABLE public_holidays_snapshots
               ADD COLUMN school_holidays TEXT NOT NULL DEFAULT '[]';
             ALTER TABLE public_holidays_snapshots
               ADD COLUMN school_holidays_covered INTEGER NOT NULL DEFAULT 0;",
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

/// Every day inside the window whose offset differs from the day before it.
///
/// A blank or unresolvable zone yields nothing on purpose. Snapshots written
/// before the zone was stored carry no zone at all, and for them a missing
/// clock change is a quiet omission — whereas inventing one would put a
/// traveler at an airport an hour late, which is the failure that matters here.
fn clock_changes_for(timezone: &str, start: &str, end: &str, place: &str) -> Vec<ClockChange> {
    if timezone.is_empty() || jiff::tz::TimeZone::get(timezone).is_err() {
        return Vec::new();
    }
    let (Ok(first), Ok(end)) = (
        start.parse::<jiff::civil::Date>(),
        end.parse::<jiff::civil::Date>(),
    ) else {
        return Vec::new();
    };
    let mut changes = Vec::new();
    let mut previous = offset_minutes_for(timezone, &first.to_string());
    let mut date = first;
    while date < end {
        let Ok(next) = date.tomorrow() else { break };
        date = next;
        let offset = offset_minutes_for(timezone, &date.to_string());
        if offset != previous {
            changes.push(ClockChange {
                date: date.to_string(),
                from_offset_minutes: previous,
                to_offset_minutes: offset,
                place: place.to_owned(),
            });
            previous = offset;
        }
    }
    changes
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
        // Per day, not per trip. A stored snapshot's scalar offset was resolved
        // on the trip's start date, so using it for every day put every sun time
        // after a DST transition an hour out. Rows written before the zone was
        // stored still fall back to it — one wrong hour beats no sun times.
        let offset = if snapshot.timezone.is_empty() {
            snapshot.utc_offset_minutes
        } else {
            offset_minutes_for(&snapshot.timezone, &date.to_string())
        };
        if let Ok(day) = compute_astro_day(
            snapshot.latitude,
            snapshot.longitude,
            &date.to_string(),
            offset,
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
                    origin_place, origin_utc_offset_minutes, timezone, origin_timezone
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
                    timezone: row.get(11)?,
                    origin_timezone: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

/// The distinct calendar years a trip's date window touches, for per-year
/// holiday lookups. Malformed dates yield no years rather than a guess.
/// The four-digit year of an ISO date, or the empty string when unparseable —
/// which yields a range the source will simply return nothing for, rather than
/// a panic or a silently wrong window.
fn year_of(date: &str) -> &str {
    date.get(0..4).filter(|year| year.len() == 4).unwrap_or("")
}

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
            "SELECT country_code, country_name, holidays, school_holidays,
                    school_holidays_covered, retrieved_at
             FROM public_holidays_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(PublicHolidaysSnapshot {
                    country_code: row.get(0)?,
                    country_name: row.get(1)?,
                    holidays: sql_to_json(row.get::<_, String>(2)?)?,
                    school_holidays: sql_to_json(row.get::<_, String>(3)?)?,
                    school_holidays_covered: row.get(4)?,
                    retrieved_at: row.get(5)?,
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

fn validate_saved_place_trip(
    connection: &Connection,
    saved_place_id: Option<&str>,
    expected_trip_id: &str,
) -> Result<(), AppError> {
    let Some(saved_place_id) = saved_place_id else {
        return Ok(());
    };
    if record_trip_id(connection, "saved_places", saved_place_id)? != expected_trip_id {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "saved place belongs to a different trip",
        ));
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

#[cfg(test)]
mod tests;
