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

/// The error every advisory parser reports when a source sends something it
/// cannot read. Deliberately identical to the FCDO parser's wording: which
/// government failed is the caller's news to break, not the parser's.
fn unreadable_source() -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        "the official source returned something Voyalier could not read",
    )
}

/// Decode the handful of HTML entities the State Department feed actually
/// emits. Not a general entity table: an unknown entity is left alone rather
/// than guessed at.
fn decode_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&#8217;", "\u{2019}")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        // Ampersand last: decoding it first would let "&amp;lt;" become "<".
        .replace("&amp;", "&")
}

/// Parse the State Department's full advisory list and pick out one country.
///
/// `Ok(None)` means this government publishes nothing for the country — either
/// because it never does (the US does not advise on the US) or because the feed
/// currently carries no entry for it. That is a different fact from a failed
/// fetch, and the caller renders it differently.
pub fn parse_us_state(
    country: &AdvisoryCountry,
    country_name: &str,
    json: &str,
    retrieved_at: &str,
) -> Result<Option<AdvisoryEntry>, AppError> {
    let Some(us_title) = country.us_title else {
        return Ok(None);
    };
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let entries = value.as_array().ok_or_else(unreadable_source)?;

    for item in entries {
        let title = item
            .get("Title")
            .and_then(|field| field.as_str())
            .unwrap_or_default();
        // The feed pads some titles with stray double spaces.
        let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let Some(rest) = normalized
            .strip_prefix(&format!("{us_title} - "))
            // ...and titles others "<name> Travel Advisory - Level N: ...".
            .or_else(|| normalized.strip_prefix(&format!("{us_title} Travel Advisory - ")))
        else {
            continue;
        };

        let level_label = rest.trim().to_owned();
        let level_rank = level_label
            .strip_prefix("Level ")
            .and_then(|text| text.chars().next())
            .and_then(|digit| digit.to_digit(10))
            .map(|digit| digit as u8);
        let summary_html = item
            .get("Summary")
            .and_then(|field| field.as_str())
            .unwrap_or_default();

        return Ok(Some(AdvisoryEntry {
            source: AdvisorySource::UsState,
            source_name: "U.S. Department of State".to_owned(),
            country_name: country_name.to_owned(),
            level_label: Some(level_label),
            level_rank,
            summary: crate::parser::strip_tags_and_collapse(&decode_entities(summary_html))
                .trim()
                .to_owned(),
            source_url: item
                .get("Link")
                .and_then(|field| field.as_str())
                .unwrap_or_default()
                .to_owned(),
            source_updated_at: item
                .get("Updated")
                .and_then(|field| field.as_str())
                .map(str::to_owned),
            change_description: None,
            language: "en".to_owned(),
            attribution: "Public domain (U.S. Department of State)".to_owned(),
            retrieved_at: retrieved_at.to_owned(),
        }));
    }
    Ok(None)
}

/// Parse Global Affairs Canada's full advisory list and pick out one country.
///
/// The list endpoint carries no prose — the advisory text *is* the level
/// wording, and the destination page is the content. `summary` is therefore
/// empty by construction rather than padded with invented words.
pub fn parse_ca_gac(
    country: &AdvisoryCountry,
    country_name: &str,
    json: &str,
    retrieved_at: &str,
) -> Result<Option<AdvisoryEntry>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let Some(entry) = value.get("data").and_then(|data| data.get(country.iso2)) else {
        return Ok(None);
    };
    let english = entry.get("eng");
    let slug = english
        .and_then(|english| english.get("url-slug"))
        .and_then(|field| field.as_str())
        .unwrap_or_default();

    Ok(Some(AdvisoryEntry {
        source: AdvisorySource::CaGac,
        source_name: "Government of Canada — Global Affairs Canada".to_owned(),
        country_name: country_name.to_owned(),
        level_label: english
            .and_then(|english| english.get("advisory-text"))
            .and_then(|field| field.as_str())
            .map(str::to_owned),
        level_rank: entry
            .get("advisory-state")
            .and_then(serde_json::Value::as_u64)
            .map(|state| state as u8),
        summary: String::new(),
        source_url: format!("https://travel.gc.ca/destinations/{slug}"),
        source_updated_at: entry
            .get("date-published")
            .and_then(|published| published.get("asp"))
            .and_then(|field| field.as_str())
            .map(str::to_owned),
        change_description: None,
        language: "en".to_owned(),
        attribution: "Open Government Licence – Canada".to_owned(),
        retrieved_at: retrieved_at.to_owned(),
    }))
}

/// Parse the Auswärtiges Amt's full advisory list and pick out one country.
///
/// The feed reports severity as four booleans rather than a level, and
/// publishes in German. Both are carried as-is: the label stays in the
/// source's language and the rank only tones this card's own badge.
pub fn parse_de_aa(
    country: &AdvisoryCountry,
    country_name: &str,
    json: &str,
    retrieved_at: &str,
) -> Result<Option<AdvisoryEntry>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let response = value
        .get("response")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(unreadable_source)?;

    // `lastModified` sits beside the country objects as a bare number, so
    // select on shape rather than trusting every value to be an object.
    let Some(entry) = response
        .values()
        .filter_map(serde_json::Value::as_object)
        .find(|entry| {
            entry
                .get("countryCode")
                .and_then(|field| field.as_str())
                .is_some_and(|code| code == country.iso2)
        })
    else {
        return Ok(None);
    };

    let flag = |name: &str| {
        entry
            .get(name)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    };
    let (label, rank) = if flag("warning") {
        ("Reisewarnung", 3)
    } else if flag("partialWarning") {
        ("Teilreisewarnung", 2)
    } else if flag("situationWarning") || flag("situationPartWarning") {
        ("Sicherheitshinweis (verschärft)", 1)
    } else {
        ("Reise- und Sicherheitshinweise", 0)
    };

    Ok(Some(AdvisoryEntry {
        source: AdvisorySource::DeAa,
        source_name: "Auswärtiges Amt (Germany)".to_owned(),
        country_name: country_name.to_owned(),
        level_label: Some(label.to_owned()),
        level_rank: Some(rank),
        summary: entry
            .get("title")
            .and_then(|field| field.as_str())
            .unwrap_or_default()
            .to_owned(),
        // The feed has no per-country page URL, only an overview.
        source_url:
            "https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise"
                .to_owned(),
        // The feed stamps epoch seconds, not RFC 3339. Rather than invent a
        // format, say nothing: `retrieved_at` still dates the card.
        source_updated_at: None,
        change_description: None,
        language: "de".to_owned(),
        attribution: "Auswärtiges Amt OpenData (Datenlizenz Deutschland – Namensnennung – 2.0)"
            .to_owned(),
        retrieved_at: retrieved_at.to_owned(),
    }))
}

/// The most notices Voyalier will lift out of one feed. The list is normally a
/// few dozen; the cap is a bound on a source that misbehaves, matching the
/// posture the email parser already takes toward untrusted input.
const MAX_HEALTH_NOTICES: usize = 50;

/// Parse the CDC's travel-notice RSS into a list.
///
/// A feed with nothing to report is `Ok(vec![])`. Input that is not the feed we
/// asked for — an error page, truncated XML, anything without a `<channel>` —
/// is an error, so "CDC is down" can never be rendered as "CDC says you are
/// fine".
pub fn parse_cdc_notices(xml: &str) -> Result<Vec<HealthNotice>, AppError> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut notices = Vec::new();
    let mut saw_channel = false;
    let mut in_item = false;
    let mut field = String::new();
    let mut title = String::new();
    let mut description = String::new();
    let mut link = String::new();
    let mut published_at = String::new();

    loop {
        match reader.read_event().map_err(|_| unreadable_source())? {
            Event::Start(start) => {
                let name = String::from_utf8_lossy(start.name().as_ref()).into_owned();
                match name.as_str() {
                    "channel" => saw_channel = true,
                    "item" => {
                        in_item = true;
                        title.clear();
                        description.clear();
                        link.clear();
                        published_at.clear();
                    }
                    _ => {}
                }
                field = name;
            }
            Event::Text(text) if in_item => {
                let value = text.unescape().map_err(|_| unreadable_source())?;
                append_field(
                    &field,
                    &value,
                    &mut title,
                    &mut description,
                    &mut link,
                    &mut published_at,
                );
            }
            Event::CData(data) => {
                if in_item {
                    let value = String::from_utf8_lossy(data.as_ref()).into_owned();
                    append_field(
                        &field,
                        &value,
                        &mut title,
                        &mut description,
                        &mut link,
                        &mut published_at,
                    );
                }
            }
            Event::End(end) => {
                if String::from_utf8_lossy(end.name().as_ref()) == "item" {
                    in_item = false;
                    if notices.len() < MAX_HEALTH_NOTICES {
                        notices.push(HealthNotice {
                            level_label: title
                                .split_once(" - ")
                                .map(|(level, _)| level.trim())
                                .filter(|level| level.starts_with("Level "))
                                .map(str::to_owned),
                            title: title.trim().to_owned(),
                            url: link.trim().to_owned(),
                            published_at: (!published_at.trim().is_empty())
                                .then(|| published_at.trim().to_owned()),
                            summary: description.trim().to_owned(),
                        });
                    }
                }
                field.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !saw_channel {
        return Err(unreadable_source());
    }
    Ok(notices)
}

/// Route one element's text to the field it belongs to. Text can arrive in
/// several events, so append rather than assign.
fn append_field(
    field: &str,
    value: &str,
    title: &mut String,
    description: &mut String,
    link: &mut String,
    published_at: &mut String,
) {
    match field {
        "title" => title.push_str(value),
        "description" => description.push_str(value),
        "link" => link.push_str(value),
        "pubDate" => published_at.push_str(value),
        _ => {}
    }
}

/// Select the notices that name a country. Substring matching over the title
/// and summary: the feed has no country field, so this is the honest best
/// effort, and a miss shows nothing rather than something wrong.
pub fn notices_for_country(notices: &[HealthNotice], country_name: &str) -> Vec<HealthNotice> {
    let needle = country_name.to_lowercase();
    notices
        .iter()
        .filter(|notice| {
            notice.title.to_lowercase().contains(&needle)
                || notice.summary.to_lowercase().contains(&needle)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CDC_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>CDC Travel Notices</title>
    <item>
      <title>Level 1 - Diphtheria in Haiti</title>
      <description><![CDATA[There is an outbreak of diphtheria in Haiti.]]></description>
      <link>https://wwwnc.cdc.gov/travel/notices/level1/diphtheria-haiti</link>
      <pubDate>Thu, 25 Jun 2026 04:00:00 GMT</pubDate>
      <guid>https://wwwnc.cdc.gov/travel/notices/level1/diphtheria-haiti</guid>
    </item>
    <item>
      <title>Level 2 - Ebola in Democratic Republic of the Congo and Uganda</title>
      <description><![CDATA[CDC recommends enhanced precautions.]]></description>
      <link>https://wwwnc.cdc.gov/travel/notices/level2/ebola-drc</link>
      <pubDate>Wed, 17 Jun 2026 04:00:00 GMT</pubDate>
      <guid>https://wwwnc.cdc.gov/travel/notices/level2/ebola-drc</guid>
    </item>
    <item>
      <title>Global Measles</title>
      <description>Measles is in many countries, including Japan.</description>
      <link>https://wwwnc.cdc.gov/travel/notices/level1/measles</link>
      <pubDate>Mon, 01 Jun 2026 04:00:00 GMT</pubDate>
    </item>
    </channel></rss>"#;

    #[test]
    fn parses_cdc_notices_from_the_feed() {
        let notices = parse_cdc_notices(CDC_FIXTURE).expect("parsed");
        assert_eq!(notices.len(), 3);
        assert_eq!(notices[0].title, "Level 1 - Diphtheria in Haiti");
        assert_eq!(notices[0].level_label.as_deref(), Some("Level 1"));
        assert_eq!(
            notices[0].summary,
            "There is an outbreak of diphtheria in Haiti."
        );
        assert_eq!(
            notices[0].url,
            "https://wwwnc.cdc.gov/travel/notices/level1/diphtheria-haiti"
        );
        assert_eq!(
            notices[0].published_at.as_deref(),
            Some("Thu, 25 Jun 2026 04:00:00 GMT")
        );
        // A title that carries no "Level N -" prefix claims no level.
        assert_eq!(notices[2].title, "Global Measles");
        assert_eq!(notices[2].level_label, None);
        // Plain-text descriptions parse the same as CDATA ones.
        assert_eq!(
            notices[2].summary,
            "Measles is in many countries, including Japan."
        );
    }

    #[test]
    fn selects_notices_that_name_the_country() {
        let notices = parse_cdc_notices(CDC_FIXTURE).expect("parsed");

        let uganda = notices_for_country(&notices, "Uganda");
        assert_eq!(uganda.len(), 1);
        assert!(uganda[0].title.contains("Ebola"));

        // Matching reaches the summary, not just the title.
        let japan = notices_for_country(&notices, "Japan");
        assert_eq!(japan.len(), 1);
        assert_eq!(japan[0].title, "Global Measles");

        assert!(notices_for_country(&notices, "Norway").is_empty());
        // Case is not a country's problem.
        assert_eq!(notices_for_country(&notices, "haiti").len(), 1);
    }

    #[test]
    fn cdc_parser_distinguishes_an_empty_feed_from_an_unreadable_one() {
        let empty = parse_cdc_notices(
            r#"<?xml version="1.0"?><rss version="2.0"><channel><title>CDC</title></channel></rss>"#,
        )
        .expect("an empty channel is a valid feed");
        assert!(empty.is_empty());

        // Anything without a <channel> is not the feed we asked for. Reporting
        // that as "no notices" would turn an outage into a clean bill of health.
        for not_the_feed in [
            "not xml at all <<<",
            "<html><body>503 Service Unavailable</body></html>",
            "",
        ] {
            assert_eq!(
                parse_cdc_notices(not_the_feed)
                    .expect_err("unreadable input is an error")
                    .code,
                ErrorCode::AdviceFetchFailed,
                "input: {not_the_feed:?}"
            );
        }
    }

    #[test]
    fn cdc_parser_bounds_a_misbehaving_feed() {
        let mut xml = String::from(r#"<rss version="2.0"><channel><title>CDC</title>"#);
        for index in 0..(MAX_HEALTH_NOTICES + 20) {
            xml.push_str(&format!(
                "<item><title>Level 1 - Thing {index} in Japan</title>\
                 <description>Body</description>\
                 <link>https://wwwnc.cdc.gov/{index}</link></item>"
            ));
        }
        xml.push_str("</channel></rss>");
        let notices = parse_cdc_notices(&xml).expect("parsed");
        assert_eq!(notices.len(), MAX_HEALTH_NOTICES);
    }

    const CA_FIXTURE: &str = r#"{"data": {
     "JP": {"country-iso": "JP", "country-eng": "Japan", "advisory-state": 0,
            "date-published": {"asp": "2026-07-16T12:53:48.9258584-04:00"},
            "eng": {"name": "Japan", "url-slug": "japan",
                    "advisory-text": "Exercise normal security precautions"}},
     "FR": {"country-iso": "FR", "country-eng": "France", "advisory-state": 1,
            "date-published": {"asp": "2026-07-13T14:53:10.4800879-04:00"},
            "eng": {"name": "France", "url-slug": "france",
                    "advisory-text": "Exercise a high degree of caution"}}
    }}"#;

    const DE_FIXTURE: &str = r#"{"response": {"lastModified": 1757063288,
     "213032": {"lastModified": 1783430993, "effective": 1783431000,
       "title": "Japan: Reise- und Sicherheitshinweise", "countryCode": "JP",
       "iso3CountryCode": "JPN", "countryName": "Japan",
       "warning": false, "partialWarning": true,
       "situationWarning": false, "situationPartWarning": false},
     "209524": {"lastModified": 1783339712, "effective": 1783339200,
       "title": "Frankreich: Reise- und Sicherheitshinweise", "countryCode": "FR",
       "iso3CountryCode": "FRA", "countryName": "Frankreich",
       "warning": false, "partialWarning": false,
       "situationWarning": false, "situationPartWarning": false}
    }}"#;

    #[test]
    fn parses_a_canadian_advisory_by_iso2() {
        let france = advisory_country("france").expect("france");
        let entry = parse_ca_gac(france, "France", CA_FIXTURE, "2026-07-17T12:00:00Z")
            .expect("parsed")
            .expect("present");
        assert_eq!(entry.source, AdvisorySource::CaGac);
        assert_eq!(
            entry.source_name,
            "Government of Canada — Global Affairs Canada"
        );
        assert_eq!(
            entry.level_label.as_deref(),
            Some("Exercise a high degree of caution")
        );
        assert_eq!(entry.level_rank, Some(1));
        assert_eq!(entry.source_url, "https://travel.gc.ca/destinations/france");
        assert_eq!(
            entry.source_updated_at.as_deref(),
            Some("2026-07-13T14:53:10.4800879-04:00")
        );
        assert_eq!(entry.language, "en");
        assert_eq!(entry.attribution, "Open Government Licence – Canada");
        assert_eq!(entry.retrieved_at, "2026-07-17T12:00:00Z");
    }

    #[test]
    fn canada_reports_absence_and_rejects_unreadable_json() {
        // Canada does not publish an advisory about Canada.
        let canada = advisory_country("canada").expect("canada");
        assert!(
            parse_ca_gac(canada, "Canada", CA_FIXTURE, "2026-07-17T12:00:00Z")
                .expect("parsed")
                .is_none()
        );
        let japan = advisory_country("japan").expect("japan");
        assert_eq!(
            parse_ca_gac(japan, "Japan", "nope", "2026-07-17T12:00:00Z")
                .expect_err("bad json")
                .code,
            ErrorCode::AdviceFetchFailed
        );
        assert!(
            parse_ca_gac(japan, "Japan", r#"{"data": {}}"#, "2026-07-17T12:00:00Z")
                .expect("empty data parses")
                .is_none()
        );
    }

    #[test]
    fn parses_a_german_advisory_with_warning_flags() {
        let japan = advisory_country("japan").expect("japan");
        let entry = parse_de_aa(japan, "Japan", DE_FIXTURE, "2026-07-17T12:00:00Z")
            .expect("parsed")
            .expect("present");
        assert_eq!(entry.source, AdvisorySource::DeAa);
        assert_eq!(entry.source_name, "Auswärtiges Amt (Germany)");
        assert_eq!(entry.level_label.as_deref(), Some("Teilreisewarnung"));
        assert_eq!(entry.level_rank, Some(2));
        // The source publishes in German and Voyalier does not translate it.
        assert_eq!(entry.language, "de");
        assert_eq!(entry.summary, "Japan: Reise- und Sicherheitshinweise");
        // The feed stamps epoch seconds, not RFC 3339: inventing a format here
        // would be Voyalier asserting a precision the source did not publish.
        assert_eq!(entry.source_updated_at, None);

        let france = advisory_country("france").expect("france");
        let entry = parse_de_aa(france, "France", DE_FIXTURE, "2026-07-17T12:00:00Z")
            .expect("parsed")
            .expect("present");
        assert_eq!(
            entry.level_label.as_deref(),
            Some("Reise- und Sicherheitshinweise")
        );
        assert_eq!(entry.level_rank, Some(0));
    }

    #[test]
    fn germany_reports_absence_and_ignores_the_last_modified_scalar() {
        // Germany does not publish an advisory about Germany.
        let germany = advisory_country("germany").expect("germany");
        assert!(
            parse_de_aa(germany, "Germany", DE_FIXTURE, "2026-07-17T12:00:00Z")
                .expect("parsed")
                .is_none()
        );
        // `lastModified` sits beside the country objects as a bare number.
        let japan = advisory_country("japan").expect("japan");
        assert!(
            parse_de_aa(
                japan,
                "Japan",
                r#"{"response": {"lastModified": 1757063288}}"#,
                "2026-07-17T12:00:00Z"
            )
            .expect("a list with no countries parses")
            .is_none()
        );
        assert_eq!(
            parse_de_aa(japan, "Japan", "<html>", "2026-07-17T12:00:00Z")
                .expect_err("bad json")
                .code,
            ErrorCode::AdviceFetchFailed
        );
    }

    const US_FIXTURE: &str = r#"[
     {"Title": "Japan - Level 1: Exercise Normal Precautions",
      "Link": "https://travel.state.gov/content/tsg_aem/us/en/home/international-travel/travel-advisories/destination.jpn.html",
      "Category": ["JA"],
      "Summary": "Exercise normal precaution<p>in <b>Japan.</b></p> <p>U.S. citizens should always exercise caution when traveling abroad.</p>",
      "Published": "2025-05-14T20:00:00-04:00", "Updated": "2025-05-14T20:00:00-04:00"},
     {"Title": "Mexico Travel Advisory - Level 2: Exercise Increased Caution",
      "Link": "https://travel.state.gov/content/tsg_aem/us/en/home/international-travel/travel-advisories/destination.mex.html",
      "Category": ["MX"],
      "Summary": "Exercise increased caution<p>in <b>Mexico </b>due to<b> terrorism, crime, </b>and <b>kidnapping.</b></p>",
      "Published": "2026-05-28T20:00:00-04:00", "Updated": "2026-05-28T20:00:00-04:00"},
     {"Title": "Switzerland  - Level 1: Exercise Normal Precautions",
      "Link": "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/switzerland-travel-advisory.html",
      "Category": ["SZ"],
      "Summary": "<p>Exercise normal precautions in Switzerland.</p>",
      "Published": "2026-04-01T20:00:00-04:00", "Updated": "2026-04-01T20:00:00-04:00"},
     {"Title": "United Arab Emirates - Level 3: Reconsider Travel",
      "Link": "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories/united-arab-emirates-travel-advisory.html",
      "Category": ["AE"],
      "Summary": "<p><b>Reconsider travel&nbsp;</b>due to the <b>threat of missile attacks.</b>&nbsp; Visit the CDC&#8217;s page for Travel &amp; COVID.</p>",
      "Published": "2026-03-02T19:00:00-05:00", "Updated": "2026-03-02T19:00:00-05:00"}
    ]"#;

    #[test]
    fn parses_a_us_advisory_with_level_and_plain_text_summary() {
        let japan = advisory_country("japan").expect("japan");
        let entry = parse_us_state(japan, "Japan", US_FIXTURE, "2026-07-17T12:00:00Z")
            .expect("parsed")
            .expect("present");
        assert_eq!(entry.source, AdvisorySource::UsState);
        assert_eq!(entry.source_name, "U.S. Department of State");
        assert_eq!(
            entry.level_label.as_deref(),
            Some("Level 1: Exercise Normal Precautions")
        );
        assert_eq!(entry.level_rank, Some(1));
        assert!(
            !entry.summary.contains('<'),
            "summary must be tag-free plain text, got {:?}",
            entry.summary
        );
        assert!(
            entry
                .summary
                .contains("exercise caution when traveling abroad")
        );
        assert_eq!(
            entry.source_updated_at.as_deref(),
            Some("2025-05-14T20:00:00-04:00")
        );
        assert_eq!(entry.language, "en");
        assert_eq!(
            entry.attribution,
            "Public domain (U.S. Department of State)"
        );
        assert_eq!(entry.retrieved_at, "2026-07-17T12:00:00Z");
    }

    #[test]
    fn us_summary_decodes_html_entities_rather_than_showing_them() {
        // The real feed is full of &nbsp;, &#8217; and &amp;. Left encoded they
        // would render as literal garbage in the card.
        let uae = advisory_country("united-arab-emirates").expect("uae");
        let entry = parse_us_state(
            uae,
            "United Arab Emirates",
            US_FIXTURE,
            "2026-07-17T12:00:00Z",
        )
        .expect("parsed")
        .expect("present");
        assert_eq!(entry.level_rank, Some(3));
        for entity in ["&nbsp;", "&#8217;", "&amp;", "&quot;"] {
            assert!(
                !entry.summary.contains(entity),
                "{entity} must be decoded, got {:?}",
                entry.summary
            );
        }
        assert!(entry.summary.contains("CDC\u{2019}s page"));
        // A decoded ampersand is text, not an entity: it must survive.
        assert!(entry.summary.contains("Travel & COVID"));
    }

    #[test]
    fn matches_us_title_quirks_and_reports_absence() {
        // The feed titles some countries "<name> Travel Advisory - Level N".
        let mexico = advisory_country("mexico").expect("mexico");
        let entry = parse_us_state(mexico, "Mexico", US_FIXTURE, "2026-07-17T12:00:00Z")
            .expect("parsed")
            .expect("matched despite the 'Travel Advisory' suffix");
        assert_eq!(entry.level_rank, Some(2));

        // ...and pads others with a stray double space.
        let switzerland = advisory_country("switzerland").expect("switzerland");
        let entry = parse_us_state(
            switzerland,
            "Switzerland",
            US_FIXTURE,
            "2026-07-17T12:00:00Z",
        )
        .expect("parsed")
        .expect("matched despite the double space");
        assert_eq!(entry.level_rank, Some(1));

        // A country the feed simply has nothing for is absent, not an error.
        let brazil = advisory_country("brazil").expect("brazil");
        assert!(
            parse_us_state(brazil, "Brazil", US_FIXTURE, "2026-07-17T12:00:00Z")
                .expect("parsed")
                .is_none()
        );

        // The US never publishes about itself, so it short-circuits.
        let usa = advisory_country("usa").expect("usa");
        assert!(
            parse_us_state(usa, "USA", US_FIXTURE, "2026-07-17T12:00:00Z")
                .expect("parsed")
                .is_none()
        );

        let japan = advisory_country("japan").expect("japan");
        let error = parse_us_state(japan, "Japan", "<html>", "2026-07-17T12:00:00Z")
            .expect_err("bad json is an error");
        assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
        // An empty list is a readable feed with nothing in it.
        assert!(
            parse_us_state(japan, "Japan", "[]", "2026-07-17T12:00:00Z")
                .expect("empty list parses")
                .is_none()
        );
    }

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
