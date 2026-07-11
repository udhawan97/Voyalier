//! Domain types, validation, and deterministic parsers for Voyalier.
//!
//! This crate deliberately has no dependency on the web, desktop, or storage
//! shells. It treats documents as untrusted data and never performs IO.

mod advice;
mod brief;
mod itinerary;
mod local_ai;
mod parser;
mod readiness;
mod search;
mod types;
mod weather;

pub use advice::{
    FCDO_COUNTRIES, FcdoCountry, TravelAdviceSnapshot, parse_fcdo_content, validate_country_slug,
};
pub use brief::{RedactionPolicy, TripBrief, build_trip_brief};
pub use itinerary::detect_itinerary_conflicts;
pub use local_ai::{LocalAiModel, LocalAiStatus, OLLAMA_TAGS_URL, parse_ollama_models};
pub use parser::{
    ConfirmationParser, JsonLdParser, NormalizedDocument, ParsedCandidate, ParserDiagnostic,
    ParserOutcome, PlaintextParser,
};
pub use readiness::assess_readiness;
pub use search::{
    SearchHit, SearchHitSource, SearchableDocument, search_trip_corpus, validate_search_query,
};
pub use types::*;
pub use weather::{
    GeocodedPlace, WeatherCoverage, WeatherDay, WeatherSnapshot, describe_weather_code,
    parse_forecast_response, parse_geocoding_response,
};

#[cfg(test)]
mod schema_validation;
#[cfg(test)]
mod tests;
