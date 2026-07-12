//! Domain types, validation, and deterministic parsers for Voyalier.
//!
//! This crate deliberately has no dependency on the web, desktop, or storage
//! shells. It treats documents as untrusted data and never performs IO.

mod advice;
mod assist;
mod assist_draft;
mod brief;
mod email;
mod itinerary;
mod local_ai;
mod packs;
mod parser;
mod provider;
mod readiness;
mod recommend;
mod search;
mod suggest;
mod today;
mod types;
mod vault;
mod weather;

pub use advice::{
    FCDO_COUNTRIES, FcdoCountry, TravelAdviceSnapshot, parse_fcdo_content, validate_country_slug,
};
pub use assist::{
    ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, ASSIST_SYSTEM_PROMPT, AssistActivityEntry,
    AssistReply, AssistRequestPreview, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OLLAMA_MODEL,
    DEFAULT_OPENAI_MODEL, OLLAMA_CHAT_URL, OPENAI_CHAT_URL, build_anthropic_messages_body,
    build_assist_preview, build_ollama_chat_body, build_openai_chat_body, parse_anthropic_reply,
    parse_ollama_chat_reply, parse_openai_chat_reply,
};
pub use assist_draft::{
    ASSIST_DRAFT_LODGING_DATES, AssistDraftResult, DRAFT_LODGING_DATES_SYSTEM_PROMPT,
    LodgingDateProposal, build_lodging_dates_user_content, parse_lodging_dates_reply,
};
pub use brief::{RedactionPolicy, TripBrief, build_trip_brief};
pub use email::{EmailBody, extract_email_body};
pub use itinerary::detect_itinerary_conflicts;
pub use local_ai::{
    LocalAiModel, LocalAiStatus, LocalModelPullResult, OLLAMA_PULL_URL, OLLAMA_TAGS_URL,
    build_pull_body, interpret_pull_response, parse_ollama_models,
};
pub use packs::{
    BoundingBox, DownloadedPack, PACK_RELEASE_TAG, PackArticle, PackContent, PackInfo,
    PackLayerLicense, PackMatchKind, PackPlace, PackSuggestion, normalize_place, pack_catalog,
    pack_download_url, parse_pack_content, suggest_packs, validate_pack_id,
};
pub use parser::{
    ConfirmationParser, JsonLdParser, NormalizedDocument, ParsedCandidate, ParserDiagnostic,
    ParserOutcome, PlaintextParser,
};
pub use provider::{
    KeyValidation, KeyValidationStatus, MAX_API_KEY_LEN, MAX_MODEL_LEN, PROVIDERS, ProviderConfig,
    ProviderId, ProviderInfo, interpret_key_validation, provider_info,
    provider_validation_endpoint, provider_validation_headers, validate_api_key,
    validate_model_name, validate_provider_id,
};
pub use readiness::assess_readiness;
pub use recommend::{PersonaWeights, Recommendation, recommend_places};
pub use search::{
    SEARCH_SUGGESTION_LIMIT, SearchHit, SearchHitSource, SearchableDocument, search_trip_corpus,
    suggest_search_terms, validate_search_query,
};
pub use suggest::{
    FIELD_SUGGESTION_LIMIT, FieldSuggestion, SuggestionSource, rank_field_suggestions,
};
pub use today::{TodayItem, TodayItemKind, TodayView, TripPhase, TripPhaseState, build_today_view};
pub use types::*;
pub use vault::{VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN, derive_key, open, seal};
pub use weather::{
    GeocodedPlace, WeatherCoverage, WeatherDay, WeatherSnapshot, describe_weather_code,
    parse_forecast_response, parse_geocoding_response,
};

#[cfg(test)]
mod schema_validation;
#[cfg(test)]
mod tests;
