//! Domain types, validation, and deterministic parsers for Voyalier.
//!
//! This crate deliberately has no dependency on the web, desktop, or storage
//! shells. It treats documents as untrusted data and never performs IO.

mod advice;
mod brief;
mod itinerary;
mod parser;
mod readiness;
mod search;
mod types;

pub use advice::{
    FCDO_COUNTRIES, FcdoCountry, TravelAdviceSnapshot, parse_fcdo_content, validate_country_slug,
};
pub use brief::{RedactionPolicy, TripBrief, build_trip_brief};
pub use itinerary::detect_itinerary_conflicts;
pub use parser::{
    ConfirmationParser, JsonLdParser, NormalizedDocument, ParsedCandidate, ParserDiagnostic,
    ParserOutcome, PlaintextParser,
};
pub use readiness::assess_readiness;
pub use search::{
    SearchHit, SearchHitSource, SearchableDocument, search_trip_corpus, validate_search_query,
};
pub use types::*;

#[cfg(test)]
mod schema_validation;
#[cfg(test)]
mod tests;
