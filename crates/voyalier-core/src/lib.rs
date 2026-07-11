//! Domain types, validation, and deterministic parsers for Voyalier.
//!
//! This crate deliberately has no dependency on the web, desktop, or storage
//! shells. It treats documents as untrusted data and never performs IO.

mod advice;
mod assist;
mod brief;
mod itinerary;
mod local_ai;
mod packs;
mod parser;
mod provider;
mod readiness;
mod recommend;
mod search;
mod today;
mod types;
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
pub use brief::{RedactionPolicy, TripBrief, build_trip_brief};
pub use itinerary::detect_itinerary_conflicts;
pub use local_ai::{LocalAiModel, LocalAiStatus, OLLAMA_TAGS_URL, parse_ollama_models};
pub use packs::{
    BoundingBox, DownloadedPack, PACK_RELEASE_TAG, PackArticle, PackContent, PackInfo,
    PackLayerLicense, PackPlace, pack_catalog, pack_download_url, parse_pack_content,
    validate_pack_id,
};
pub use parser::{
    ConfirmationParser, JsonLdParser, NormalizedDocument, ParsedCandidate, ParserDiagnostic,
    ParserOutcome, PlaintextParser,
};
pub use provider::{
    MAX_API_KEY_LEN, MAX_MODEL_LEN, PROVIDERS, ProviderConfig, ProviderId, ProviderInfo,
    provider_info, validate_api_key, validate_model_name, validate_provider_id,
};
pub use readiness::assess_readiness;
pub use recommend::{PersonaWeights, Recommendation, recommend_places};
pub use search::{
    SearchHit, SearchHitSource, SearchableDocument, search_trip_corpus, validate_search_query,
};
pub use today::{TodayItem, TodayItemKind, TodayView, TripPhase, TripPhaseState, build_today_view};
pub use types::*;
pub use weather::{
    GeocodedPlace, WeatherCoverage, WeatherDay, WeatherSnapshot, describe_weather_code,
    parse_forecast_response, parse_geocoding_response,
};

#[cfg(test)]
mod schema_validation;
#[cfg(test)]
mod tests;
