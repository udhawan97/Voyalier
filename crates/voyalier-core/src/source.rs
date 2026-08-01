//! How Voyalier addresses a remote source.
//!
//! Building a source's URL is part of knowing that source's protocol, so it
//! belongs beside the parser that reads the reply rather than at the call site
//! that happens to need it. This module holds what every such source needs:
//! how to address it, and what to say when its reply does not parse.

use crate::types::{AppError, ErrorCode};

/// The error a source gets when it answered, but not with anything readable.
///
/// Seven modules needed this sentence and each wrote its own copy, differing
/// only in the error code and one noun. The sentence is shown to the traveler,
/// so keeping the copies identical mattered and nothing was keeping them so.
///
/// `source` names the source in the traveler's words — "weather",
/// "exchange-rate", "public-holiday" — and is interpolated into
/// "the {source} source returned something Voyalier could not read".
pub(crate) fn unreadable_source(code: ErrorCode, source: &str) -> AppError {
    AppError::new(
        code,
        format!("the {source} source returned something Voyalier could not read"),
    )
}

/// Minimal RFC 3986 percent-encoding for a single query value.
///
/// Destinations are user-typed free text, so this is what stands between a
/// place name with a space or an accent in it and a malformed request.
pub(crate) fn percent_encode(value: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_only_what_must_be_encoded() {
        assert_eq!(percent_encode("Kyoto"), "Kyoto");
        assert_eq!(percent_encode("New York"), "New%20York");
        assert_eq!(percent_encode("São Paulo"), "S%C3%A3o%20Paulo");
        // Unreserved characters survive verbatim.
        assert_eq!(percent_encode("a-b_c.d~e"), "a-b_c.d~e");
    }
}
