//! Domain types, validation, and deterministic parsers for Voyalier.
//!
//! This crate deliberately has no dependency on the web, desktop, or storage
//! shells. It treats documents as untrusted data and never performs IO.

mod parser;
mod types;

pub use parser::{
    ConfirmationParser, JsonLdParser, NormalizedDocument, ParsedCandidate, ParserDiagnostic,
    ParserOutcome, PlaintextParser,
};
pub use types::*;

#[cfg(test)]
mod schema_validation;
#[cfg(test)]
mod tests;
