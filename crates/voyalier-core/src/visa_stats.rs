//! Published visa statistics, read live from the authority and never bundled.
//!
//! ADR-0014's half of the visa split: `visa.rs` curates translations and
//! cautions and may never quote a number; this module quotes numbers and may
//! never author one. Every figure that leaves here was machine-read from the
//! authority's own publication by an injected fetch, at the traveler's explicit
//! request, and carries the source name, the human page to verify at, the
//! licence, the retrieval time, and the source's own "as of" stamp where it
//! publishes one.
//!
//! Per ADR-0008 the module owns its protocol: the dataset endpoints and the
//! parsers that read their replies live here, private, and the application
//! layer supplies only the fetch, the error flavour, and storage. The stored
//! form is the raw fetched body — parsing happens on every read, so a parser
//! fix reaches copies this device already kept.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// Where one destination authority publishes decision statistics.
///
/// `fetchable` is a statement about the *publication*, not the network: true
/// only where the authority ships a machine-readable dataset or a stable page
/// this module carries a parser for. Everything else is a link and a name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaStatsSource {
    pub destination_iso2: String,
    pub authority_name: String,
    /// The human page — where the traveler reads the current answer. Never the
    /// dataset endpoint.
    pub page_url: String,
    pub fetchable: bool,
}

/// One quoted figure, exactly as the source labels it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaStatMetric {
    pub id: String,
    /// The source's own product term for the row.
    pub label: String,
    /// The source's own row key when the publication is per-country ("IN").
    /// Matched by key equality against the stored passport code, never mapped
    /// through names; absent when the table is not per-country.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    /// Verbatim, units and all — "22 days", "3 weeks", "No processing time
    /// available". Never parsed into a number, converted, or averaged here.
    pub value: String,
}

/// Whether the figures came back from the authority in this very call, or from
/// the copy this device kept.
///
/// Defined by delivery, not history: `Fetched` describes only the direct
/// return of a successful refresh. Anything served from storage — including a
/// copy written seconds ago — is `KeptCopy`, so a stamp can never look fresher
/// than the fetch behind it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VisaStatsProvenance {
    Fetched,
    KeptCopy,
}

/// Figures read from one authority at one moment, with everything a reader
/// needs to check them at the source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaStatsSnapshot {
    pub destination_iso2: String,
    pub authority_name: String,
    /// The page to verify at — the human page, not the dataset endpoint.
    pub source_url: String,
    /// The source's own reuse terms, rendered beside the figures exactly as
    /// advisory attributions are.
    pub attribution: String,
    pub retrieved_at: String,
    /// The source's own "updated" stamp, where the publication carries one.
    /// IRCC's dataset does not; GOV.UK's page metadata does. When present it
    /// is displayed — a retrieval stamp over older figures is the stale-table
    /// trap wearing a fresh date.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub metrics: Vec<VisaStatMetric>,
    pub provenance: VisaStatsProvenance,
}

/// The statistics zone of the cockpit: the source row always, the snapshot only
/// when this device holds one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaStatsPanel {
    pub source: VisaStatsSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<VisaStatsSnapshot>,
}

// ---- Sources --------------------------------------------------------------
//
// Authority names and page URLs are deliberately redeclared rather than shared
// with `visa.rs`: statistics are this module's protocol (ADR-0008), and a
// curation edit over there must not silently retarget where figures come from.

const IRCC: &str = "Immigration, Refugees and Citizenship Canada";
const IRCC_PAGE: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html";
/// The published dataset behind IRCC's processing-times page. JSON, keyed by
/// product then ISO-3166-1 alpha-2 country of application.
const IRCC_DATASET: &str =
    "https://www.canada.ca/content/dam/ircc/documents/json/data-ptime-en.json";
const IRCC_ATTRIBUTION: &str = "Open Government Licence – Canada";

const UKVI: &str = "UK Visas and Immigration (GOV.UK)";
/// One page is both the human page and the fetch target: GOV.UK publishes the
/// waiting times as sectioned HTML with its update stamp in page metadata.
const UKVI_PAGE: &str =
    "https://www.gov.uk/guidance/visa-decision-waiting-times-applications-outside-the-uk";
const UKVI_ATTRIBUTION: &str = "Open Government Licence v3.0";

const MOFA: &str = "Ministry of Foreign Affairs of Japan";
const MOFA_PAGE: &str = "https://www.mofa.go.jp/j_info/visit/visa/index.html";
const HOME_AFFAIRS: &str = "Department of Home Affairs (Australia)";
const AU_PAGE: &str = "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-finder";
const INZ: &str = "Immigration New Zealand";
const NZ_PAGE: &str = "https://www.immigration.govt.nz/visit/what-you-need-to-visit-new-zealand/visa-waiver-countries-and-territories/";
const KIS: &str = "Korea Immigration Service (Ministry of Justice)";
const KR_PAGE: &str = "https://www.k-eta.go.kr/portal/apply/index.do";
const US_STATE: &str = "U.S. Department of State — Bureau of Consular Affairs";
const US_PAGE: &str =
    "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visa-waiver-program.html";

/// The statistics source for a destination, or `None` when Voyalier has no
/// authority to name there — the same seven destinations `entry_path` can
/// quote, and nothing beyond them.
pub fn stats_source(destination_iso2: &str) -> Option<VisaStatsSource> {
    let (authority_name, page_url, fetchable) = match destination_iso2 {
        "CA" => (IRCC, IRCC_PAGE, true),
        "GB" => (UKVI, UKVI_PAGE, true),
        "JP" => (MOFA, MOFA_PAGE, false),
        "AU" => (HOME_AFFAIRS, AU_PAGE, false),
        "NZ" => (INZ, NZ_PAGE, false),
        "KR" => (KIS, KR_PAGE, false),
        "US" => (US_STATE, US_PAGE, false),
        _ => return None,
    };
    Some(VisaStatsSource {
        destination_iso2: destination_iso2.to_owned(),
        authority_name: authority_name.to_owned(),
        page_url: page_url.to_owned(),
        fetchable,
    })
}

/// Fetch and read a destination's published times through the injected fetch.
///
/// `Ok(None)` when the destination has no fetchable source — the caller shows
/// the link-only state. On success the raw body rides along for storage, so a
/// kept copy is the source's own bytes rather than our reading of them.
pub fn published_times(
    destination_iso2: &str,
    nationality_iso2: &str,
    retrieved_at: &str,
    fetch: impl FnOnce(&str) -> Result<String, AppError>,
) -> Result<Option<(VisaStatsSnapshot, String)>, AppError> {
    let Some(source) = stats_source(destination_iso2) else {
        return Ok(None);
    };
    if !source.fetchable {
        return Ok(None);
    }
    let endpoint = match destination_iso2 {
        "CA" => IRCC_DATASET,
        "GB" => UKVI_PAGE,
        _ => unreachable!("every fetchable source names its endpoint"),
    };
    let body = fetch(endpoint)?;
    let snapshot = parse_stats(
        &source,
        nationality_iso2,
        &body,
        retrieved_at,
        VisaStatsProvenance::Fetched,
    )?;
    Ok(Some((snapshot, body)))
}

/// Re-read a body this device kept. Same parser, `KeptCopy` provenance, and
/// the retrieval time of the original fetch — never of the read.
pub fn kept_times(
    destination_iso2: &str,
    nationality_iso2: &str,
    body: &str,
    retrieved_at: &str,
) -> Result<VisaStatsSnapshot, AppError> {
    let source = stats_source(destination_iso2).ok_or_else(|| {
        AppError::new(
            ErrorCode::AdviceFetchFailed,
            "no statistics source is curated for this destination",
        )
    })?;
    parse_stats(
        &source,
        nationality_iso2,
        body,
        retrieved_at,
        VisaStatsProvenance::KeptCopy,
    )
}

fn parse_stats(
    source: &VisaStatsSource,
    nationality_iso2: &str,
    body: &str,
    retrieved_at: &str,
    provenance: VisaStatsProvenance,
) -> Result<VisaStatsSnapshot, AppError> {
    let (metrics, published_at, attribution) = match source.destination_iso2.as_str() {
        "CA" => (
            parse_ircc_processing_times(body, nationality_iso2)?,
            // The dataset carries no update stamp of its own; only the
            // retrieval time is honest here.
            None,
            IRCC_ATTRIBUTION,
        ),
        "GB" => {
            let (metrics, published_at) = parse_ukvi_waiting_times(body)?;
            (metrics, published_at, UKVI_ATTRIBUTION)
        }
        _ => {
            return Err(AppError::new(
                ErrorCode::AdviceFetchFailed,
                "this authority's statistics cannot be read automatically",
            ));
        }
    };
    Ok(VisaStatsSnapshot {
        destination_iso2: source.destination_iso2.clone(),
        authority_name: source.authority_name.clone(),
        source_url: source.page_url.clone(),
        attribution: attribution.to_owned(),
        retrieved_at: retrieved_at.to_owned(),
        published_at,
        metrics,
        provenance,
    })
}

fn unreadable(detail: &str) -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        format!("the authority's published statistics could not be read: {detail}"),
    )
}

// ---- IRCC -----------------------------------------------------------------

/// The travel-facing products in IRCC's dataset, with IRCC's own product terms.
/// Selection by product, never by row: within each product the traveler's own
/// country row is quoted whole, and absence is reported as absence.
const IRCC_PRODUCTS: [(&str, &str); 4] = [
    (
        "visitor-outside-canada",
        "Visitor visa (from outside Canada)",
    ),
    ("supervisa", "Super visa (parents and grandparents)"),
    ("study", "Study permit (from outside Canada)"),
    ("work", "Work permit (from outside Canada)"),
];

/// Read the rows IRCC publishes for one country of application.
///
/// A missing product section is shape drift and fails loudly; a missing
/// country row inside a present section is data ("IRCC publishes no row for
/// this code") and yields no metric for that product.
fn parse_ircc_processing_times(
    body: &str,
    nationality_iso2: &str,
) -> Result<Vec<VisaStatMetric>, AppError> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|_| unreadable("not the JSON dataset"))?;
    let visitor = value
        .get(IRCC_PRODUCTS[0].0)
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| unreadable("the visitor-visa section is missing"))?;
    // The visitor section is the one this feature exists for; its presence is
    // the shape check. The others degrade row by row.
    let _ = visitor;
    let mut metrics = Vec::new();
    for (key, label) in IRCC_PRODUCTS {
        let Some(row) = value
            .get(key)
            .and_then(|section| section.get(nationality_iso2))
            .and_then(serde_json::Value::as_str)
        else {
            continue;
        };
        metrics.push(VisaStatMetric {
            id: format!("ca-ircc.{key}"),
            label: label.to_owned(),
            audience: Some(nationality_iso2.to_owned()),
            value: row.to_owned(),
        });
    }
    Ok(metrics)
}

// ---- UKVI -----------------------------------------------------------------

/// Read the "Visit visas" table from GOV.UK's waiting-times page, and the
/// page's own update stamp from its metadata.
///
/// UKVI publishes by visa category, not by nationality, so these rows carry no
/// audience. The table is quoted whole and in order.
fn parse_ukvi_waiting_times(body: &str) -> Result<(Vec<VisaStatMetric>, Option<String>), AppError> {
    let published_at = body
        .split("govuk:public-updated-at")
        .nth(1)
        .and_then(|rest| rest.split("content=\"").nth(1))
        .and_then(|rest| rest.split('"').next())
        .map(str::to_owned);

    let section = body
        .split("<h2 id=\"visit-visas\">")
        .nth(1)
        .and_then(|rest| rest.split("</table>").next())
        .ok_or_else(|| unreadable("the visit-visas table is missing"))?;

    let mut metrics = Vec::new();
    for row in section.split("<tr>").skip(1) {
        let cells: Vec<String> = row
            .split("<td>")
            .skip(1)
            .map(|cell| strip_tags(cell.split("</td>").next().unwrap_or("")))
            .collect();
        let [category, time] = cells.as_slice() else {
            continue;
        };
        if category.is_empty() || time.is_empty() {
            continue;
        }
        let slug: String = category
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        metrics.push(VisaStatMetric {
            id: format!("uk-ukvi.visit.{slug}"),
            label: category.clone(),
            audience: None,
            value: time.clone(),
        });
    }
    if metrics.is_empty() {
        return Err(unreadable("the visit-visas table has no readable rows"));
    }
    Ok((metrics, published_at))
}

/// Markup out, whitespace folded — the cell's words, nothing else.
fn strip_tags(fragment: &str) -> String {
    let mut text = String::new();
    let mut inside_tag = false;
    for c in fragment.chars() {
        match c {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            c if !inside_tag => text.push(c),
            _ => {}
        }
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const IRCC_FIXTURE: &str = include_str!("../fixtures/visa_stats/ircc-times.json");
    const IRCC_MISSING: &str = include_str!("../fixtures/visa_stats/ircc-missing-section.json");
    const UKVI_FIXTURE: &str = include_str!("../fixtures/visa_stats/ukvi-times.html");
    const UKVI_NO_TABLE: &str = include_str!("../fixtures/visa_stats/ukvi-no-table.html");

    fn fetch_fixture(fixture: &'static str) -> impl FnOnce(&str) -> Result<String, AppError> {
        move |_| Ok(fixture.to_owned())
    }

    #[test]
    fn seven_sources_two_fetchable_and_pages_are_never_endpoints() {
        let sources: Vec<_> = ["CA", "GB", "JP", "AU", "NZ", "KR", "US"]
            .iter()
            .map(|code| stats_source(code).expect("curated"))
            .collect();
        assert_eq!(sources.iter().filter(|s| s.fetchable).count(), 2);
        for source in &sources {
            assert!(source.page_url.starts_with("https://"));
            assert_ne!(
                source.page_url, IRCC_DATASET,
                "the traveler is sent to the page, not the dataset"
            );
        }
        assert!(stats_source("FR").is_none(), "no authority, no source row");
    }

    #[test]
    fn ircc_quotes_the_travelers_own_rows_verbatim() {
        let (snapshot, body) = published_times("CA", "IN", "2026-08-02T10:00:00Z", |url| {
            assert_eq!(url, IRCC_DATASET);
            Ok(IRCC_FIXTURE.to_owned())
        })
        .expect("parses")
        .expect("fetchable");

        assert_eq!(body, IRCC_FIXTURE, "the stored copy is the source's bytes");
        assert_eq!(snapshot.provenance, VisaStatsProvenance::Fetched);
        assert_eq!(
            snapshot.published_at, None,
            "IRCC's dataset carries no stamp"
        );
        assert_eq!(snapshot.attribution, "Open Government Licence – Canada");
        assert_eq!(snapshot.source_url, IRCC_PAGE);

        let visitor = &snapshot.metrics[0];
        assert_eq!(visitor.id, "ca-ircc.visitor-outside-canada");
        assert_eq!(visitor.value, "22 days", "verbatim, units and all");
        assert_eq!(visitor.audience.as_deref(), Some("IN"));
        // Every metric is addressed to the passport that asked.
        assert!(
            snapshot
                .metrics
                .iter()
                .all(|m| m.audience.as_deref() == Some("IN"))
        );
    }

    #[test]
    fn ircc_reports_absence_as_absence_not_as_failure() {
        // AD is in the fixture with "No processing time available" for some
        // products and absent rows for others — both stay honest.
        let (snapshot, _) = published_times("CA", "AD", "2026-08-02T10:00:00Z", |_| {
            Ok(IRCC_FIXTURE.to_owned())
        })
        .expect("parses")
        .expect("fetchable");
        assert!(
            snapshot
                .metrics
                .iter()
                .any(|m| m.value == "No processing time available"),
            "the source's own 'no data' wording is quoted, not translated"
        );
    }

    #[test]
    fn ircc_shape_drift_fails_loudly() {
        let error = published_times("CA", "IN", "2026-08-02T10:00:00Z", |_| {
            Ok(IRCC_MISSING.to_owned())
        })
        .expect_err("the visitor section is gone");
        assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
    }

    #[test]
    fn ukvi_quotes_the_visit_table_with_the_pages_own_stamp() {
        let (snapshot, _) = published_times("GB", "IN", "2026-08-02T10:00:00Z", |url| {
            assert_eq!(url, UKVI_PAGE);
            Ok(UKVI_FIXTURE.to_owned())
        })
        .expect("parses")
        .expect("fetchable");

        assert_eq!(
            snapshot.published_at.as_deref(),
            Some("2026-06-26T09:53:33+01:00"),
            "GOV.UK's own update stamp rides along"
        );
        assert_eq!(snapshot.attribution, "Open Government Licence v3.0");
        let labels: Vec<&str> = snapshot.metrics.iter().map(|m| m.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "Standard Visitor",
                "Marriage Visitor",
                "Chinese tour group",
                "Transit"
            ],
            "the table is quoted whole and in the source's order"
        );
        assert!(
            snapshot.metrics.iter().all(|m| m.audience.is_none()),
            "UKVI publishes by category, not by passport"
        );
        assert_eq!(snapshot.metrics[0].value, "3 weeks");
    }

    #[test]
    fn ukvi_without_the_table_fails_loudly() {
        let error = published_times("GB", "IN", "2026-08-02T10:00:00Z", |_| {
            Ok(UKVI_NO_TABLE.to_owned())
        })
        .expect_err("no visit table");
        assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
    }

    #[test]
    fn kept_copies_reparse_with_kept_provenance_and_the_original_stamp() {
        let snapshot = kept_times("GB", "IN", UKVI_FIXTURE, "2026-07-01T09:00:00Z").expect("kept");
        assert_eq!(snapshot.provenance, VisaStatsProvenance::KeptCopy);
        assert_eq!(snapshot.retrieved_at, "2026-07-01T09:00:00Z");
        // A different passport re-reads the same kept body: destination-scoped
        // storage never binds a snapshot to the first traveler who fetched it.
        let other = kept_times("CA", "AU", IRCC_FIXTURE, "2026-07-01T09:00:00Z").expect("kept");
        assert!(
            other
                .metrics
                .iter()
                .all(|m| m.audience.as_deref() == Some("AU"))
        );
    }

    #[test]
    fn unfetchable_sources_never_reach_a_parser() {
        let result = published_times("JP", "IN", "2026-08-02T10:00:00Z", |_| {
            panic!("no fetch may happen for an unfetchable source")
        })
        .expect("not an error");
        assert!(result.is_none(), "link-only, by design");
        assert!(
            published_times(
                "FR",
                "IN",
                "2026-08-02T10:00:00Z",
                fetch_fixture(IRCC_FIXTURE)
            )
            .expect("not an error")
            .is_none(),
            "no authority, nothing to fetch"
        );
    }
}
