//! Domain types, validation, and deterministic parsers for Voyalier.
//!
//! This crate deliberately has no dependency on the web, desktop, or storage
//! shells. It treats documents as untrusted data and never performs IO.

mod advice;
mod advisories;
mod airports;
mod alerts;
mod assist;
mod assist_draft;
mod astro;
mod backup;
mod brief;
mod climate;
mod email;
mod facts;
mod gazetteer;
mod heritage;
mod holidays;
mod itinerary;
mod local_ai;
mod packing;
mod packs;
mod parser;
mod place_summary;
mod planning;
mod provider;
mod readiness;
mod recommend;
mod search;
mod source;
mod suggest;
mod tipping;
mod today;
mod types;
mod vault;
mod weather;

pub use advice::{
    FCDO_COUNTRIES, FcdoCountry, TravelAdviceSnapshot, parse_fcdo_content, validate_country_slug,
};
// The curated `ADVISORY_COUNTRIES` table stays internal: `advisory_country` is
// the only door to a fetch URL, the same way `validate_country_slug` is for the
// FCDO list.
pub use advisories::{
    AdvisoryCountry, AdvisoryEntry, AdvisoryPanel, AdvisorySource, HealthNotice, SourceState,
    SourceStatus, advisory_country, entry_from_fcdo, notices_for_country, parse_ca_gac,
    parse_cdc_notices, parse_de_aa, parse_us_state,
};
// Per-provider endpoints, model defaults, body builders, and reply parsers stay
// internal: which of each pairs with which provider is `assist`'s knowledge.
// `build_assist_request` + `parse_assist_reply` are the way in.
pub use airports::{AirportSize, NearbyAirport, nearest_airports};
pub use alerts::{WeatherAlert, parse_nws_alerts};
pub use assist::{
    ASSIST_SYSTEM_PROMPT, AssistActivityEntry, AssistReply, AssistRequest, AssistRequestPreview,
    MAX_AI_PROMPT_LEN, build_assist_preview, build_assist_request, estimate_tokens,
    parse_assist_reply,
};
pub use astro::{AstroDay, MoonPhase, MoonPhaseName, PolarState, compute_astro_day, moon_phase};
// `build_lodging_dates_user_content` stays internal: it is reached through
// `build_draft_preview`, so the previewed user content and the sent user content
// cannot be built two different ways.
pub use assist_draft::{
    ASSIST_DRAFT_LODGING_DATES, AssistDraftResult, DRAFT_LODGING_DATES_SYSTEM_PROMPT,
    LodgingDateProposal, build_draft_preview, parse_lodging_dates_reply,
};
pub use backup::{
    BACKUP_FORMAT_VERSION, BACKUP_MAGIC, BackupManifest, OpenedBackup, open_backup, seal_backup,
};
pub use brief::{BriefTripItem, RedactionPolicy, TripBrief, build_trip_brief};
pub use climate::{
    AirQualityDay, ClimateNormals, archive_window, parse_air_quality, parse_climate_normals,
};
// `extract_email_body` is deliberately not re-exported: it must only be reached
// through `parse_import`, which bounds the raw input before the extractor walks
// an untrusted MIME tree.
pub use facts::{
    CountryFacts, CurrencyRate, DestinationFactsSnapshot, EmergencyNumbers, TimeDifference,
    country_facts, cross_rate, parse_ecb_rates, time_difference,
};
pub use gazetteer::{CitySuggestion, search_cities};
pub use heritage::{HeritageSite, world_heritage_near};
// The Nager endpoint and its per-year addressing stay internal: which URL
// answers for a country and year is this module's knowledge. `public_holidays`
// is the way in; `parse_nager_holidays` remains exported for the fixture tests.
pub use holidays::{
    PublicHoliday, PublicHolidaysSnapshot, holidays_within, parse_nager_holidays, public_holidays,
};
pub use itinerary::{detect_itinerary_conflicts, detect_planned_item_conflicts};
pub use local_ai::{
    LocalAiModel, LocalAiStatus, LocalModelPullResult, OLLAMA_PULL_URL, OLLAMA_TAGS_URL,
    build_pull_body, interpret_pull_response, parse_ollama_models,
};
pub use packing::{
    PackingCode, PackingReason, PackingReasonCode, PackingSuggestion, build_packing_list,
};
pub use packs::{
    BoundingBox, DownloadedPack, MAX_OFFLINE_MAP_BYTES, OfflineMapArchive, OfflineMapChunk,
    OfflineMapDescriptor, PACK_RELEASE_TAG, PackArticle, PackContent, PackInfo, PackLayerLicense,
    PackMatchKind, PackPlace, PackSuggestion, normalize_place, offline_map_download_url,
    pack_catalog, pack_download_url, parse_pack_content, saved_place_identity, suggest_packs,
    validate_pack_id,
};
// The parser trait, its implementations, and `NormalizedDocument` stay internal:
// which parser handles which `DocumentKind` is this module's knowledge, not its
// callers'. `parse_import` is the way in.
pub use parser::{DocumentParse, ParsedCandidate, parse_import};
pub use place_summary::{PlaceSummary, parse_place_summary, place_summary};
pub use planning::*;
// The validation endpoint and its auth headers stay internal: which pairs with
// which provider is `provider`'s knowledge. `build_key_validation_request` is
// the way in.
pub use provider::{
    KeyValidation, KeyValidationRequest, KeyValidationStatus, MAX_API_KEY_LEN, MAX_MODEL_LEN,
    PROVIDERS, ProviderConfig, ProviderId, ProviderInfo, build_key_validation_request,
    interpret_key_validation, provider_info, validate_api_key, validate_model_name,
    validate_provider_id,
};
pub use readiness::{TripAssessment, assess_trip};
pub use recommend::{
    AttributedPackPlace, PersonaWeights, Recommendation, recommend_attributed_places,
    recommend_places,
};
pub use search::{
    SEARCH_SUGGESTION_LIMIT, SearchHit, SearchHitSource, SearchableDocument, WorkspaceSearchHit,
    WorkspaceSearchRecord, WorkspaceSearchSource, fact_search_text, search_trip_corpus,
    search_workspace_corpus, suggest_search_terms, validate_search_query,
};
pub use suggest::{
    FIELD_SUGGESTION_LIMIT, FieldSuggestion, SuggestionSource, rank_field_suggestions,
};
pub use tipping::tipping_guidance;
pub use today::{TodayItem, TodayItemKind, TodayView, TripPhase, TripPhaseState, build_today_view};
pub use types::*;
pub use vault::{VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN, derive_key, open, seal};
pub use weather::{
    GeocodedPlace, WeatherCoverage, WeatherDay, WeatherSnapshot, describe_weather_code, geocode,
    parse_forecast_response, parse_geocoding_response,
};

#[cfg(test)]
mod schema_validation;
#[cfg(test)]
mod tests;
