//! Multi-government advisory panel: types, curated country mapping, and pure
//! parsers for the US, Canadian, and German official feeds plus CDC health
//! notices.
//!
//! This module is IO-free: every parser takes already-fetched text and a
//! retrieval stamp. Each government's wording is carried verbatim on its own
//! entry — levels are source-native and are never compared, merged, or ranked
//! across governments, and no government's advice is translated.

use serde::{Deserialize, Serialize};

use crate::advice::TravelAdviceSnapshot;
use crate::types::{AppError, ErrorCode};

/// One government whose advisories Voyalier fetches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AdvisorySource {
    UkFcdo,
    UsState,
    CaGac,
    DeAa,
}

/// One government's dated, verbatim advisory for one country.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryEntry {
    pub source: AdvisorySource,
    pub source_name: String,
    pub country_name: String,
    /// Verbatim level wording. Source-native; never compared across sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_label: Option<String>,
    /// Source-native numeric rank, for toning this card's own badge only
    /// (US 1–4, CA 0–3, DE 0–3). Never comparable between sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_rank: Option<u8>,
    pub summary: String,
    pub source_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_description: Option<String>,
    /// Content language tag ("en", "de"), so the interface can mark it up.
    pub language: String,
    pub attribution: String,
    /// When this device retrieved the entry (RFC 3339).
    pub retrieved_at: String,
}

/// One CDC travel-health notice matched to the trip country. Informational
/// only — never feeds readiness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthNotice {
    pub title: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub summary: String,
}

/// What happened to one source on the last fetch attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    /// Fetched and stored on this click.
    Fresh,
    /// Fetch failed; an older stored snapshot is being shown.
    Kept,
    /// Fetch failed and nothing is stored.
    Unavailable,
    /// Fetch succeeded, but this government publishes nothing for the country.
    NotPublished,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub source: AdvisorySource,
    pub state: SourceState,
}

/// Everything the advice panel renders, assembled from stored snapshots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryPanel {
    pub country_slug: String,
    pub country_name: String,
    pub entries: Vec<AdvisoryEntry>,
    pub health_notices: Vec<HealthNotice>,
    pub source_status: Vec<SourceStatus>,
    /// When the panel-level fetch happened (RFC 3339).
    pub retrieved_at: String,
}

/// Curated cross-feed identity for one country. `us_title` is the exact prefix
/// of the State Department `Title` field where it differs from the FCDO name
/// (or `None` where that government never publishes for this country).
pub struct AdvisoryCountry {
    pub slug: &'static str,
    pub iso2: &'static str,
    pub us_title: Option<&'static str>,
}

/// One row per [`crate::advice::FCDO_COUNTRIES`] entry, same order. Kept
/// explicit for the same reason the FCDO slugs are: a wrong code should fail
/// loudly here rather than silently select another country's advice.
pub const ADVISORY_COUNTRIES: &[AdvisoryCountry] = &[
    AdvisoryCountry {
        slug: "australia",
        iso2: "AU",
        us_title: Some("Australia"),
    },
    AdvisoryCountry {
        slug: "austria",
        iso2: "AT",
        us_title: Some("Austria"),
    },
    AdvisoryCountry {
        slug: "belgium",
        iso2: "BE",
        us_title: Some("Belgium"),
    },
    AdvisoryCountry {
        slug: "brazil",
        iso2: "BR",
        us_title: Some("Brazil"),
    },
    AdvisoryCountry {
        slug: "canada",
        iso2: "CA",
        us_title: Some("Canada"),
    },
    AdvisoryCountry {
        slug: "china",
        iso2: "CN",
        us_title: Some("China"),
    },
    AdvisoryCountry {
        slug: "croatia",
        iso2: "HR",
        us_title: Some("Croatia"),
    },
    AdvisoryCountry {
        slug: "denmark",
        iso2: "DK",
        us_title: Some("Kingdom of Denmark"),
    },
    AdvisoryCountry {
        slug: "egypt",
        iso2: "EG",
        us_title: Some("Egypt"),
    },
    AdvisoryCountry {
        slug: "finland",
        iso2: "FI",
        us_title: Some("Finland"),
    },
    AdvisoryCountry {
        slug: "france",
        iso2: "FR",
        us_title: Some("France"),
    },
    AdvisoryCountry {
        slug: "germany",
        iso2: "DE",
        us_title: Some("Germany"),
    },
    AdvisoryCountry {
        slug: "greece",
        iso2: "GR",
        us_title: Some("Greece"),
    },
    AdvisoryCountry {
        slug: "iceland",
        iso2: "IS",
        us_title: Some("Iceland"),
    },
    AdvisoryCountry {
        slug: "india",
        iso2: "IN",
        us_title: Some("India"),
    },
    AdvisoryCountry {
        slug: "indonesia",
        iso2: "ID",
        us_title: Some("Indonesia"),
    },
    AdvisoryCountry {
        slug: "ireland",
        iso2: "IE",
        us_title: Some("Ireland"),
    },
    AdvisoryCountry {
        slug: "italy",
        iso2: "IT",
        us_title: Some("Italy"),
    },
    AdvisoryCountry {
        slug: "japan",
        iso2: "JP",
        us_title: Some("Japan"),
    },
    AdvisoryCountry {
        slug: "malaysia",
        iso2: "MY",
        us_title: Some("Malaysia"),
    },
    AdvisoryCountry {
        slug: "mexico",
        iso2: "MX",
        us_title: Some("Mexico"),
    },
    AdvisoryCountry {
        slug: "morocco",
        iso2: "MA",
        us_title: Some("Morocco"),
    },
    AdvisoryCountry {
        slug: "netherlands",
        iso2: "NL",
        us_title: Some("Netherlands"),
    },
    AdvisoryCountry {
        slug: "new-zealand",
        iso2: "NZ",
        us_title: Some("New Zealand"),
    },
    AdvisoryCountry {
        slug: "norway",
        iso2: "NO",
        us_title: Some("Norway"),
    },
    AdvisoryCountry {
        slug: "peru",
        iso2: "PE",
        us_title: Some("Peru"),
    },
    AdvisoryCountry {
        slug: "poland",
        iso2: "PL",
        us_title: Some("Poland"),
    },
    AdvisoryCountry {
        slug: "portugal",
        iso2: "PT",
        us_title: Some("Portugal"),
    },
    AdvisoryCountry {
        slug: "singapore",
        iso2: "SG",
        us_title: Some("Singapore"),
    },
    AdvisoryCountry {
        slug: "south-africa",
        iso2: "ZA",
        us_title: Some("South Africa"),
    },
    AdvisoryCountry {
        slug: "south-korea",
        iso2: "KR",
        us_title: Some("South Korea"),
    },
    AdvisoryCountry {
        slug: "spain",
        iso2: "ES",
        us_title: Some("Spain"),
    },
    AdvisoryCountry {
        slug: "sweden",
        iso2: "SE",
        us_title: Some("Sweden"),
    },
    AdvisoryCountry {
        slug: "switzerland",
        iso2: "CH",
        us_title: Some("Switzerland"),
    },
    AdvisoryCountry {
        slug: "thailand",
        iso2: "TH",
        us_title: Some("Thailand"),
    },
    AdvisoryCountry {
        slug: "turkey",
        iso2: "TR",
        us_title: Some("Turkey"),
    },
    AdvisoryCountry {
        slug: "united-arab-emirates",
        iso2: "AE",
        us_title: Some("United Arab Emirates"),
    },
    // The United States does not publish a travel advisory about itself.
    AdvisoryCountry {
        slug: "usa",
        iso2: "US",
        us_title: None,
    },
    AdvisoryCountry {
        slug: "vietnam",
        iso2: "VN",
        us_title: Some("Vietnam"),
    },
];

/// Resolve a submitted slug against the curated table. Like
/// [`crate::advice::validate_country_slug`], this is the only door to a fetch
/// URL — arbitrary strings are rejected, never interpolated.
pub fn advisory_country(slug: &str) -> Result<&'static AdvisoryCountry, AppError> {
    ADVISORY_COUNTRIES
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

/// Present an already-parsed FCDO snapshot as one entry in the panel. The UK
/// keeps its own storage shape; this is the adapter, not a re-parse.
pub fn entry_from_fcdo(snapshot: &TravelAdviceSnapshot) -> AdvisoryEntry {
    AdvisoryEntry {
        source: AdvisorySource::UkFcdo,
        source_name: "UK Foreign, Commonwealth & Development Office".to_owned(),
        country_name: snapshot.country_name.clone(),
        level_label: (!snapshot.alert_status.is_empty()).then(|| snapshot.alert_status.join(", ")),
        level_rank: None,
        summary: snapshot.summary.clone(),
        source_url: snapshot.source_url.clone(),
        source_updated_at: snapshot.source_updated_at.clone(),
        change_description: snapshot.change_description.clone(),
        language: "en".to_owned(),
        attribution: "Open Government Licence v3.0".to_owned(),
        retrieved_at: snapshot.retrieved_at.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advisory_countries_cover_every_fcdo_country_with_unique_iso2() {
        use crate::advice::{FCDO_COUNTRIES, validate_country_slug};
        use std::collections::HashSet;

        assert_eq!(ADVISORY_COUNTRIES.len(), FCDO_COUNTRIES.len());
        let iso: HashSet<_> = ADVISORY_COUNTRIES.iter().map(|c| c.iso2).collect();
        assert_eq!(iso.len(), ADVISORY_COUNTRIES.len(), "iso2 codes are unique");
        for country in ADVISORY_COUNTRIES {
            validate_country_slug(country.slug).expect("advisory slug is an FCDO slug");
            assert_eq!(
                country.iso2.len(),
                2,
                "{} iso2 is two letters",
                country.slug
            );
        }
        for fcdo in FCDO_COUNTRIES {
            advisory_country(fcdo.slug).expect("every FCDO slug has an advisory row");
        }

        assert_eq!(
            advisory_country("denmark").expect("denmark").us_title,
            Some("Kingdom of Denmark")
        );
        assert_eq!(
            advisory_country("japan").expect("japan").us_title,
            Some("Japan")
        );
        assert_eq!(advisory_country("usa").expect("usa").us_title, None);
        assert_eq!(advisory_country("usa").expect("usa").iso2, "US");
        assert!(advisory_country("atlantis").is_err());
    }

    #[test]
    fn fcdo_snapshot_converts_to_a_uk_entry() {
        let snapshot = TravelAdviceSnapshot {
            country_slug: "japan".into(),
            country_name: "Japan".into(),
            source_url: "https://www.gov.uk/foreign-travel-advice/japan".into(),
            summary: "FCDO travel advice for Japan.".into(),
            alert_status: vec!["avoid_all_travel_to_parts".into()],
            source_updated_at: Some("2026-06-30T11:02:00.000+01:00".into()),
            change_description: Some("Latest update: typhoon season.".into()),
            retrieved_at: "2026-07-17T12:00:00Z".into(),
        };
        let entry = entry_from_fcdo(&snapshot);
        assert_eq!(entry.source, AdvisorySource::UkFcdo);
        assert_eq!(
            entry.source_name,
            "UK Foreign, Commonwealth & Development Office"
        );
        assert_eq!(
            entry.level_label.as_deref(),
            Some("avoid_all_travel_to_parts")
        );
        assert_eq!(entry.level_rank, None);
        assert_eq!(entry.language, "en");
        assert_eq!(entry.attribution, "Open Government Licence v3.0");
        assert_eq!(entry.retrieved_at, "2026-07-17T12:00:00Z");
    }
}
