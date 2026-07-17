//! An "about this place" summary from the Wikimedia REST API.
//!
//! IO-free: the parser reads a `page/summary/{title}` response; the application
//! layer owns the consent-gated fetch and the dated snapshot. The text is
//! Wikipedia's, shown under CC BY-SA with attribution and a link back — never
//! presented as Voyalier's own words or as a safety claim.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// A dated Wikipedia summary of the destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceSummary {
    /// The article title (the canonical place name Wikipedia resolved to).
    pub title: String,
    /// The short one-line description, when present.
    pub description: String,
    /// The plain-text lead summary.
    pub extract: String,
    /// The canonical article URL, for attribution and "read more".
    pub url: String,
    pub retrieved_at: String,
}

/// Parse a Wikimedia REST `page/summary` response. A disambiguation page or an
/// empty extract has nothing useful to show and is an error the caller surfaces.
pub fn parse_place_summary(json: &str, retrieved_at: &str) -> Result<PlaceSummary, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable())?;
    let string = |key: &str| {
        value
            .get(key)
            .and_then(|field| field.as_str())
            .unwrap_or_default()
            .trim()
            .to_owned()
    };
    let extract = string("extract");
    // A disambiguation page or an empty lead has no single summary worth showing.
    if extract.is_empty()
        || value.get("type").and_then(|kind| kind.as_str()) == Some("disambiguation")
    {
        return Err(no_summary());
    }
    let url = value
        .get("content_urls")
        .and_then(|urls| urls.get("desktop"))
        .and_then(|desktop| desktop.get("page"))
        .and_then(|page| page.as_str())
        .unwrap_or_default()
        .to_owned();
    Ok(PlaceSummary {
        title: string("title"),
        description: string("description"),
        extract,
        url,
        retrieved_at: retrieved_at.to_owned(),
    })
}

fn unreadable() -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        "the place-summary source returned something Voyalier could not read",
    )
}

fn no_summary() -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        "there is no clear encyclopedia summary for this destination",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUMMARY: &str = r#"{
      "type":"standard","title":"Kyoto","displaytitle":"Kyoto",
      "description":"City in the Kansai region of Japan",
      "extract":"Kyoto is the capital city of Kyoto Prefecture in Japan.",
      "content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Kyoto"}}
    }"#;

    #[test]
    fn parses_a_place_summary() {
        let summary = parse_place_summary(SUMMARY, "2026-07-17T00:00:00Z").expect("parsed");
        assert_eq!(summary.title, "Kyoto");
        assert_eq!(summary.description, "City in the Kansai region of Japan");
        assert!(summary.extract.contains("capital city"));
        assert_eq!(summary.url, "https://en.wikipedia.org/wiki/Kyoto");
        assert_eq!(summary.retrieved_at, "2026-07-17T00:00:00Z");
    }

    #[test]
    fn rejects_disambiguation_empty_and_malformed() {
        // Disambiguation pages carry no single useful summary.
        let disambig = r#"{"type":"disambiguation","title":"Springfield","extract":"Springfield may refer to several places."}"#;
        assert!(parse_place_summary(disambig, "t").is_err());
        // An empty extract is nothing to show.
        let empty = r#"{"type":"standard","title":"X","extract":"   "}"#;
        assert!(parse_place_summary(empty, "t").is_err());
        // Malformed input errors rather than panicking.
        assert!(parse_place_summary("<html>404</html>", "t").is_err());
    }
}
