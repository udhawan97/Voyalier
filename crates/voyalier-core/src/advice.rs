//! Types and pure parsing for official travel-advice snapshots.
//!
//! Voyalier surfaces the UK FCDO's per-country travel advice via the keyless
//! GOV.UK Content API, reusable under the Open Government Licence v3.0 with
//! attribution. This module is IO-free: it validates a country choice against a
//! curated list (slugs are code, never derived from trip text or a model) and
//! parses a fetched JSON document into a dated snapshot. The snapshot is shown
//! verbatim with its source and retrieval time — Voyalier never summarizes,
//! asserts, or clears requirements.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// One fetchable FCDO country page. `slug` is the GOV.UK path segment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FcdoCountry {
    pub slug: &'static str,
    pub name: &'static str,
}

/// Curated countries whose GOV.UK slugs follow the verified pattern. Kept
/// deliberately explicit: a wrong slug fails loudly as a fetch error rather
/// than fetching the wrong page.
pub const FCDO_COUNTRIES: &[FcdoCountry] = &[
    FcdoCountry {
        slug: "australia",
        name: "Australia",
    },
    FcdoCountry {
        slug: "austria",
        name: "Austria",
    },
    FcdoCountry {
        slug: "belgium",
        name: "Belgium",
    },
    FcdoCountry {
        slug: "brazil",
        name: "Brazil",
    },
    FcdoCountry {
        slug: "canada",
        name: "Canada",
    },
    FcdoCountry {
        slug: "china",
        name: "China",
    },
    FcdoCountry {
        slug: "croatia",
        name: "Croatia",
    },
    FcdoCountry {
        slug: "denmark",
        name: "Denmark",
    },
    FcdoCountry {
        slug: "egypt",
        name: "Egypt",
    },
    FcdoCountry {
        slug: "finland",
        name: "Finland",
    },
    FcdoCountry {
        slug: "france",
        name: "France",
    },
    FcdoCountry {
        slug: "germany",
        name: "Germany",
    },
    FcdoCountry {
        slug: "greece",
        name: "Greece",
    },
    FcdoCountry {
        slug: "iceland",
        name: "Iceland",
    },
    FcdoCountry {
        slug: "india",
        name: "India",
    },
    FcdoCountry {
        slug: "indonesia",
        name: "Indonesia",
    },
    FcdoCountry {
        slug: "ireland",
        name: "Ireland",
    },
    FcdoCountry {
        slug: "italy",
        name: "Italy",
    },
    FcdoCountry {
        slug: "japan",
        name: "Japan",
    },
    FcdoCountry {
        slug: "malaysia",
        name: "Malaysia",
    },
    FcdoCountry {
        slug: "mexico",
        name: "Mexico",
    },
    FcdoCountry {
        slug: "morocco",
        name: "Morocco",
    },
    FcdoCountry {
        slug: "netherlands",
        name: "Netherlands",
    },
    FcdoCountry {
        slug: "new-zealand",
        name: "New Zealand",
    },
    FcdoCountry {
        slug: "norway",
        name: "Norway",
    },
    FcdoCountry {
        slug: "peru",
        name: "Peru",
    },
    FcdoCountry {
        slug: "poland",
        name: "Poland",
    },
    FcdoCountry {
        slug: "portugal",
        name: "Portugal",
    },
    FcdoCountry {
        slug: "singapore",
        name: "Singapore",
    },
    FcdoCountry {
        slug: "south-africa",
        name: "South Africa",
    },
    FcdoCountry {
        slug: "south-korea",
        name: "South Korea",
    },
    FcdoCountry {
        slug: "spain",
        name: "Spain",
    },
    FcdoCountry {
        slug: "sweden",
        name: "Sweden",
    },
    FcdoCountry {
        slug: "switzerland",
        name: "Switzerland",
    },
    FcdoCountry {
        slug: "thailand",
        name: "Thailand",
    },
    FcdoCountry {
        slug: "turkey",
        name: "Turkey",
    },
    FcdoCountry {
        slug: "united-arab-emirates",
        name: "United Arab Emirates",
    },
    FcdoCountry {
        slug: "usa",
        name: "USA",
    },
    FcdoCountry {
        slug: "vietnam",
        name: "Vietnam",
    },
];

/// Resolve a submitted slug against the curated list. This is the only door to
/// a fetch URL — arbitrary strings are rejected, never interpolated.
pub fn validate_country_slug(slug: &str) -> Result<&'static FcdoCountry, AppError> {
    FCDO_COUNTRIES
        .iter()
        .find(|country| country.slug == slug)
        .ok_or_else(|| {
            AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "unknown country",
                "field",
                "countrySlug",
            )
        })
}

/// A dated, verbatim snapshot of one country's FCDO travel advice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TravelAdviceSnapshot {
    pub country_slug: String,
    pub country_name: String,
    /// The human page this snapshot came from (not the API URL).
    pub source_url: String,
    /// Verbatim GOV.UK description for the country page. May be empty.
    pub summary: String,
    /// Verbatim alert-status identifiers, when present (often empty).
    pub alert_status: Vec<String>,
    /// GOV.UK's own `public_updated_at`, verbatim, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_updated_at: Option<String>,
    /// GOV.UK's latest change description, verbatim, when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_description: Option<String>,
    /// When this device retrieved the snapshot (RFC 3339).
    pub retrieved_at: String,
}

/// Parse a GOV.UK Content API response into a snapshot. Pure and total over
/// malformed input: bad JSON is an error; missing fields degrade to empty.
pub fn parse_fcdo_content(
    country: &FcdoCountry,
    json: &str,
    retrieved_at: &str,
) -> Result<TravelAdviceSnapshot, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| {
        AppError::new(
            ErrorCode::AdviceFetchFailed,
            "the official source returned something Voyalier could not read",
        )
    })?;

    let summary = value
        .get("description")
        .and_then(|field| field.as_str())
        .unwrap_or_default()
        .trim()
        .to_owned();
    let source_updated_at = value
        .get("public_updated_at")
        .and_then(|field| field.as_str())
        .map(str::to_owned);
    let details = value.get("details");
    let alert_status = details
        .and_then(|details| details.get("alert_status"))
        .and_then(|field| field.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.as_str())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let change_description = details
        .and_then(|details| details.get("change_description"))
        .and_then(|field| field.as_str())
        .map(|text| text.trim().to_owned())
        .filter(|text| !text.is_empty());

    Ok(TravelAdviceSnapshot {
        country_slug: country.slug.to_owned(),
        country_name: country.name.to_owned(),
        source_url: format!("https://www.gov.uk/foreign-travel-advice/{}", country.slug),
        summary,
        alert_status,
        source_updated_at,
        change_description,
        retrieved_at: retrieved_at.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_only_curated_slugs() {
        assert_eq!(validate_country_slug("japan").expect("japan").name, "Japan");
        let error = validate_country_slug("../../etc/passwd").expect_err("rejected");
        assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
        let error = validate_country_slug("atlantis").expect_err("rejected");
        assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
    }

    #[test]
    fn parses_a_realistic_content_response() {
        let country = validate_country_slug("japan").expect("japan");
        let json = r#"{
            "title": "Japan",
            "description": "FCDO travel advice for Japan. Includes safety and security, entry requirements, and legal differences.",
            "public_updated_at": "2026-06-30T11:02:00.000+01:00",
            "details": {
                "alert_status": [],
                "change_description": "Latest update: Updated information on typhoon season ('Warnings and insurance' page)."
            }
        }"#;
        let snapshot = parse_fcdo_content(country, json, "2026-07-10T12:00:00Z").expect("parsed");
        assert_eq!(snapshot.country_name, "Japan");
        assert_eq!(
            snapshot.source_url,
            "https://www.gov.uk/foreign-travel-advice/japan"
        );
        assert!(snapshot.summary.starts_with("FCDO travel advice for Japan"));
        assert_eq!(
            snapshot.source_updated_at.as_deref(),
            Some("2026-06-30T11:02:00.000+01:00")
        );
        assert!(
            snapshot
                .change_description
                .as_deref()
                .expect("change description")
                .contains("typhoon season")
        );
        assert_eq!(snapshot.retrieved_at, "2026-07-10T12:00:00Z");
    }

    #[test]
    fn tolerates_missing_fields_but_not_bad_json() {
        let country = validate_country_slug("france").expect("france");
        let snapshot =
            parse_fcdo_content(country, "{}", "2026-07-10T12:00:00Z").expect("parsed empty");
        assert_eq!(snapshot.summary, "");
        assert!(snapshot.alert_status.is_empty());
        assert!(snapshot.source_updated_at.is_none());

        let error = parse_fcdo_content(country, "<html>not json</html>", "2026-07-10T12:00:00Z")
            .expect_err("bad json");
        assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
    }
}
