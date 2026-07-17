# Multi-Government Advisories Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the single-source UK FCDO travel-advice feature into a four-government advisory panel (UK, US, Canada, Germany) plus CDC travel-health notices, all keyless official feeds, fetched on one consent click and stored as dated snapshots.

**Architecture:** New pure parsers in `voyalier-core` (one per source, fixture-tested against real captured payloads), a schema migration replacing the single-row `travel_advice_snapshots` table with per-source `advisory_snapshots` + a per-trip `advisory_panels` row, one orchestrating service method `fetch_advisories` behind the existing `AdviceFetcher` seam with per-source failure honesty, and the standard 6-place contract change (`fetchAdvisories` replaces `fetchTravelAdvice`).

**Tech Stack:** Rust (serde_json, quick-xml new dep), SQLite via rusqlite, TypeScript contract + React panel.

## Global Constraints

- Network only on the explicit user click; all fetches Rust-side via `AdviceFetcher::fetch_text` (identifying User-Agent already set by `UreqFetcher`). The US endpoint returns `[]` to anonymous UAs — the UA is load-bearing.
- Verbatim snapshots: never summarize, assert, or clear anything. `level_rank` is source-native and must never be compared across sources.
- Trust ordering: all four are `official` source class (DATA_SOURCES.md); CDC notices are informational chips, they never clear readiness items.
- Migration ledger is append-only; new step is `to: 4`.
- Every capability change updates: `packages/contracts/src/index.ts`, `packages/contracts/src/mock.ts`, `apps/web/src/gateway/http.ts` + `crates/voyalier-server/src/lib.rs`, `apps/web/src/gateway/tauri.ts` + `apps/desktop/src-tauri/src/lib.rs`, `crates/voyalier-app/src/lib.rs`.
- TDD: write the failing test first, watch it fail, make it pass, commit. Run Rust tests with `cargo test -p <crate>`, web tests with `pnpm --filter web test -- --run <file>`.
- Attribution strings (exact): UK `Open Government Licence v3.0`; US `Public domain (U.S. Department of State)`; CA `Open Government Licence – Canada`; DE `Auswärtiges Amt OpenData (Datenlizenz Deutschland – Namensnennung – 2.0)`; CDC `Public domain (U.S. CDC)`.

## Source payload shapes (captured live 2026-07-17)

- **US** `https://cadataapi.state.gov/api/TravelAdvisories` → JSON array of `{Title, Link, Category: [..], Summary: <html>, id, Published, Updated}`. `Title` = `"<country> - Level N: <label>"`. Quirks: `"Mexico Travel Advisory - Level 2: …"`, `"Switzerland  - Level 1: …"` (double space), `"Kingdom of Denmark - Level 2: …"`, Brazil currently absent, no USA entry.
- **CA** `https://data.international.gc.ca/travel-voyage/index-alpha-eng.json` → `{data: {<ISO2>: {country-eng, advisory-state: 0..3, date-published: {asp}, eng: {name, url-slug, advisory-text}, …}}, metadata}`. No Canada entry. Human page: `https://travel.gc.ca/destinations/{url-slug}`.
- **DE** `https://www.auswaertiges-amt.de/opendata/travelwarning` → `{response: {lastModified: <num>, "<id>": {title, countryCode, countryName, warning, partialWarning, situationWarning, situationPartWarning, effective, lastModified}}}`. German-language. No Germany entry. Link to overview page `https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise`.
- **CDC** `https://wwwnc.cdc.gov/travel/rss/notices.xml` → RSS `<item><title>Level N - Disease in Place</title><description><![CDATA[..]]></description><link/><pubDate/><guid/></item>`.

---

### Task 1: Policy groundwork (docs only)

**Files:**
- Modify: `docs/architecture/ADR-0003-phase2-contract.md` (append addendum section)
- Modify: `docs/data/DATA_SOURCES.md` (add four source rows)

**Steps:**

- [ ] **Step 1: ADR-0003 addendum.** Append at end of file:

```markdown
## Addendum 2026-07-17 — US advisories re-decision

The 2026-07-11 decision "US: link-only — no machine-readable feed exists" rested
on a premise that is now false: the Consular Affairs Data API
(`https://cadataapi.state.gov/api/TravelAdvisories`) serves the full advisory
list as keyless public-domain JSON (verified live 2026-07-17; it returns an
empty array to anonymous User-Agents, so the identifying-UA fetcher policy is
load-bearing). Owner decision (2026-07-17): overturned. US advisories become a
fetched snapshot source beside the UK FCDO one, together with Canada
(`data.international.gc.ca`, OGL-Canada) and Germany (Auswärtiges Amt OpenData,
DL-DE BY 2.0), plus CDC travel-health notices (public domain) as informational
chips. Source class for all four: `official`. Levels render per-source and are
never compared or merged across governments.
```

- [ ] **Step 2: DATA_SOURCES.md rows.** Follow the file's existing per-source format (provider, endpoint, license/attribution, source class, consent trigger, "may go to a model": no). Add: US State Dept Consular Affairs API, Canada GAC advisories JSON, Auswärtiges Amt travelwarning OpenData, CDC travel notices RSS — endpoints and attribution strings from Global Constraints above.

- [ ] **Step 3: Commit.**

```bash
git add docs/architecture/ADR-0003-phase2-contract.md docs/data/DATA_SOURCES.md
git commit -m "Docs: re-decide US advisories, register four official advisory sources"
```

---

### Task 2: Core advisory types + curated country table

**Files:**
- Create: `crates/voyalier-core/src/advisories.rs`
- Modify: `crates/voyalier-core/src/lib.rs` (add `pub mod advisories;`)
- Modify: `crates/voyalier-core/src/parser.rs:594` (make `strip_tags_and_collapse` `pub(crate)`)

**Interfaces:**
- Consumes: `crate::advice::{FcdoCountry, TravelAdviceSnapshot, FCDO_COUNTRIES}`, `crate::types::{AppError, ErrorCode}`.
- Produces (used by Tasks 3–8): `AdvisorySource`, `AdvisoryEntry`, `HealthNotice`, `SourceState`, `SourceStatus`, `AdvisoryPanel`, `AdvisoryCountry { slug: &'static str, iso2: &'static str, us_title: Option<&'static str> }`, `advisory_country(slug) -> Result<&'static AdvisoryCountry, AppError>`, `entry_from_fcdo(snapshot: &TravelAdviceSnapshot) -> AdvisoryEntry`.

- [ ] **Step 1: Write failing tests** (in `advisories.rs` `#[cfg(test)]`):

```rust
#[test]
fn advisory_countries_cover_every_fcdo_country_with_unique_iso2() {
    use std::collections::HashSet;
    use crate::advice::{validate_country_slug, FCDO_COUNTRIES};

    assert_eq!(ADVISORY_COUNTRIES.len(), FCDO_COUNTRIES.len());
    let iso: HashSet<_> = ADVISORY_COUNTRIES.iter().map(|c| c.iso2).collect();
    assert_eq!(iso.len(), ADVISORY_COUNTRIES.len(), "iso2 codes are unique");
    // Every curated advisory slug is a real FCDO slug, and vice versa.
    for country in ADVISORY_COUNTRIES {
        validate_country_slug(country.slug).expect("advisory slug is an FCDO slug");
        assert_eq!(country.iso2.len(), 2, "{} iso2 is two letters", country.slug);
    }
    for fcdo in FCDO_COUNTRIES {
        advisory_country(fcdo.slug).expect("every FCDO slug has an advisory row");
    }

    assert_eq!(advisory_country("denmark").expect("denmark").us_title, Some("Kingdom of Denmark"));
    assert_eq!(advisory_country("japan").expect("japan").us_title, Some("Japan"));
    // The US does not publish an advisory about the US.
    assert_eq!(advisory_country("usa").expect("usa").us_title, None);
    assert_eq!(advisory_country("usa").expect("usa").iso2, "US");
    assert!(advisory_country("atlantis").is_err());
}

#[test]
fn fcdo_snapshot_converts_to_a_uk_entry() {
    let snapshot = crate::advice::TravelAdviceSnapshot {
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
    assert_eq!(entry.source_name, "UK Foreign, Commonwealth & Development Office");
    assert_eq!(entry.level_label.as_deref(), Some("avoid_all_travel_to_parts"));
    assert_eq!(entry.level_rank, None);
    assert_eq!(entry.language, "en");
    assert_eq!(entry.attribution, "Open Government Licence v3.0");
    assert_eq!(entry.retrieved_at, "2026-07-17T12:00:00Z");
}
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p voyalier-core advisories` → FAIL (module missing).

- [ ] **Step 3: Implement.** In `advisories.rs`:

```rust
//! Multi-government advisory panel: types, curated country mapping, and pure
//! parsers for the US, Canadian, and German official feeds plus CDC health
//! notices. IO-free; every parser takes fetched text and a retrieval stamp.

use serde::{Deserialize, Serialize};

use crate::advice::TravelAdviceSnapshot;
use crate::types::{AppError, ErrorCode};

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
    /// Source-native numeric rank for badge tone only (US 1–4, CA 0–3, DE 0–3).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_rank: Option<u8>,
    pub summary: String,
    pub source_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_description: Option<String>,
    /// BCP-47-ish content language tag ("en", "de").
    pub language: String,
    pub attribution: String,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceState {
    /// Fetched and stored on this click.
    Fresh,
    /// Fetch failed; an older stored snapshot is being shown.
    Kept,
    /// Fetch failed and nothing is stored.
    Unavailable,
    /// Fetch succeeded but this government publishes nothing for the country.
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
    /// When the panel-level fetch (health notices + statuses) happened.
    pub retrieved_at: String,
}

```

Then `ADVISORY_COUNTRIES: &[AdvisoryCountry]` — 39 entries, one per `FCDO_COUNTRIES` slug, same order. ISO2 values in that order: AU, AT, BE, BR, CA, CN, HR, DK, EG, FI, FR, DE, GR, IS, IN, ID, IE, IT, JP, MY, MX, MA, NL, NZ, NO, PE, PL, PT, SG, ZA, KR, ES, SE, CH, TH, TR, AE, US, VN. `us_title`: `Some(<FCDO name>)` for all except Denmark → `Some("Kingdom of Denmark")` and USA → `None`:

```rust
/// Curated cross-feed identity for one country. `us_title` is the exact
/// prefix of the State Department Title field where it differs from the FCDO
/// name (or `None` where that government never publishes for this country).
pub struct AdvisoryCountry {
    pub slug: &'static str,
    pub iso2: &'static str,
    /// Exact State Dept Title prefix; None = never published.
    pub us_title: Option<&'static str>,
}

pub const ADVISORY_COUNTRIES: &[AdvisoryCountry] = &[
    AdvisoryCountry { slug: "australia", iso2: "AU", us_title: Some("Australia") },
    // … one row per FCDO slug, same order …
    AdvisoryCountry { slug: "denmark", iso2: "DK", us_title: Some("Kingdom of Denmark") },
    AdvisoryCountry { slug: "usa", iso2: "US", us_title: None },
];

/// Resolve a submitted slug against the curated table. Like
/// [`crate::advice::validate_country_slug`], this is the only door to a fetch
/// URL — arbitrary strings are rejected, never interpolated.
pub fn advisory_country(slug: &str) -> Result<&'static AdvisoryCountry, AppError> {
    ADVISORY_COUNTRIES
        .iter()
        .find(|country| country.slug == slug)
        .ok_or_else(|| AppError::with_detail(
            ErrorCode::ValidationInvalidInput, "unknown country", "field", "countrySlug",
        ))
}

pub fn entry_from_fcdo(snapshot: &TravelAdviceSnapshot) -> AdvisoryEntry {
    AdvisoryEntry {
        source: AdvisorySource::UkFcdo,
        source_name: "UK Foreign, Commonwealth & Development Office".to_owned(),
        country_name: snapshot.country_name.clone(),
        level_label: (!snapshot.alert_status.is_empty())
            .then(|| snapshot.alert_status.join(", ")),
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
```

Add `pub mod advisories;` to `lib.rs` (and re-export the public types from the crate root if `lib.rs` re-exports `advice`'s types that way — match the existing pattern). Change `fn strip_tags_and_collapse` in `parser.rs:594` to `pub(crate) fn`.

- [ ] **Step 4: Run to verify pass.** `cargo test -p voyalier-core advisories` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "Core: advisory panel types and curated cross-feed country table"`

---

### Task 3: Core US State Department parser

**Files:**
- Modify: `crates/voyalier-core/src/advisories.rs`

**Interfaces:**
- Produces: `parse_us_state(country: &AdvisoryCountry, country_name: &str, json: &str, retrieved_at: &str) -> Result<Option<AdvisoryEntry>, AppError>` — `Ok(None)` when the feed has no entry for the country (real case: Brazil today, USA always).

- [ ] **Step 1: Failing tests** (fixtures are trimmed real payloads captured 2026-07-17):

```rust
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
  "Published": "2026-04-01T20:00:00-04:00", "Updated": "2026-04-01T20:00:00-04:00"}
]"#;

#[test]
fn parses_a_us_advisory_with_level_and_plain_text_summary() {
    let japan = advisory_country("japan").expect("japan");
    let entry = parse_us_state(japan, "Japan", US_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").expect("present");
    assert_eq!(entry.source, AdvisorySource::UsState);
    assert_eq!(entry.level_label.as_deref(), Some("Level 1: Exercise Normal Precautions"));
    assert_eq!(entry.level_rank, Some(1));
    assert!(!entry.summary.contains('<'), "summary must be tag-free plain text");
    assert!(entry.summary.contains("exercise caution when traveling abroad"));
    assert_eq!(entry.source_updated_at.as_deref(), Some("2025-05-14T20:00:00-04:00"));
    assert_eq!(entry.language, "en");
    assert_eq!(entry.attribution, "Public domain (U.S. Department of State)");
}

#[test]
fn matches_title_quirks_and_reports_absence() {
    let mexico = advisory_country("mexico").expect("mexico");
    let entry = parse_us_state(mexico, "Mexico", US_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").expect("matched despite 'Travel Advisory' suffix");
    assert_eq!(entry.level_rank, Some(2));

    let switzerland = advisory_country("switzerland").expect("switzerland");
    let entry = parse_us_state(switzerland, "Switzerland", US_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").expect("matched despite double space");
    assert_eq!(entry.level_rank, Some(1));

    let brazil = advisory_country("brazil").expect("brazil");
    assert!(parse_us_state(brazil, "Brazil", US_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").is_none(), "absent country is None, not an error");

    let usa = advisory_country("usa").expect("usa");
    assert!(parse_us_state(usa, "USA", US_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").is_none(), "us_title None short-circuits to None");

    let japan = advisory_country("japan").expect("japan");
    let error = parse_us_state(japan, "Japan", "<html>", "2026-07-17T12:00:00Z")
        .expect_err("bad json is an error");
    assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
}
```

- [ ] **Step 2: Run to verify failure.** `cargo test -p voyalier-core parses_a_us_advisory` → FAIL.

- [ ] **Step 3: Implement.**

```rust
/// Parse the full State Department advisory list and pick out one country.
/// Title matching normalizes runs of whitespace and tolerates the optional
/// " Travel Advisory" suffix; the level is the text after " - ".
pub fn parse_us_state(
    country: &AdvisoryCountry,
    country_name: &str,
    json: &str,
    retrieved_at: &str,
) -> Result<Option<AdvisoryEntry>, AppError> {
    let Some(us_title) = country.us_title else { return Ok(None) };
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| AppError::new(
        ErrorCode::AdviceFetchFailed,
        "the official source returned something Voyalier could not read",
    ))?;
    let entries = value.as_array().ok_or_else(|| AppError::new(
        ErrorCode::AdviceFetchFailed,
        "the official source returned something Voyalier could not read",
    ))?;
    for item in entries {
        let title = item.get("Title").and_then(|field| field.as_str()).unwrap_or_default();
        let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let Some(rest) = normalized
            .strip_prefix(&format!("{us_title} - "))
            .or_else(|| normalized.strip_prefix(&format!("{us_title} Travel Advisory - ")))
        else { continue };
        let level_label = rest.trim().to_owned();
        let level_rank = level_label
            .strip_prefix("Level ")
            .and_then(|text| text.chars().next())
            .and_then(|digit| digit.to_digit(10))
            .map(|digit| digit as u8);
        let summary_html = item.get("Summary").and_then(|field| field.as_str()).unwrap_or_default();
        return Ok(Some(AdvisoryEntry {
            source: AdvisorySource::UsState,
            source_name: "U.S. Department of State".to_owned(),
            country_name: country_name.to_owned(),
            level_label: Some(level_label),
            level_rank,
            summary: crate::parser::strip_tags_and_collapse(summary_html),
            source_url: item.get("Link").and_then(|field| field.as_str()).unwrap_or_default().to_owned(),
            source_updated_at: item.get("Updated").and_then(|field| field.as_str()).map(str::to_owned),
            change_description: None,
            language: "en".to_owned(),
            attribution: "Public domain (U.S. Department of State)".to_owned(),
            retrieved_at: retrieved_at.to_owned(),
        }));
    }
    Ok(None)
}
```

(If `strip_tags_and_collapse` leaves HTML entities like `&nbsp;` visible in the test summary, decode the four common entities — `&nbsp;` `&amp;` `&#8217;` `&quot;` — inside the parser before stripping; assert accordingly.)

- [ ] **Step 4: Run to verify pass.** `cargo test -p voyalier-core -- advisories` → PASS.
- [ ] **Step 5: Commit.** `git commit -am "Core: parse US State Department advisories"`

---

### Task 4: Core Canada parser

**Files:** Modify `crates/voyalier-core/src/advisories.rs`

**Interfaces:**
- Produces: `parse_ca_gac(country: &AdvisoryCountry, country_name: &str, json: &str, retrieved_at: &str) -> Result<Option<AdvisoryEntry>, AppError>`

- [ ] **Step 1: Failing tests:**

```rust
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

#[test]
fn parses_a_canadian_advisory_by_iso2() {
    let france = advisory_country("france").expect("france");
    let entry = parse_ca_gac(france, "France", CA_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").expect("present");
    assert_eq!(entry.source, AdvisorySource::CaGac);
    assert_eq!(entry.level_label.as_deref(), Some("Exercise a high degree of caution"));
    assert_eq!(entry.level_rank, Some(1));
    assert_eq!(entry.source_url, "https://travel.gc.ca/destinations/france");
    assert_eq!(entry.source_updated_at.as_deref(), Some("2026-07-13T14:53:10.4800879-04:00"));
    assert_eq!(entry.attribution, "Open Government Licence – Canada");

    let canada = advisory_country("canada").expect("canada");
    assert!(parse_ca_gac(canada, "Canada", CA_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").is_none(), "Canada does not advise on itself");
    let france = advisory_country("france").expect("france");
    assert!(parse_ca_gac(france, "France", "nope", "2026-07-17T12:00:00Z").is_err());
}
```

- [ ] **Step 2: Verify failure.** `cargo test -p voyalier-core parses_a_canadian` → FAIL.
- [ ] **Step 3: Implement.** Look up `value["data"][country.iso2]`; absent → `Ok(None)`. `level_label` = `eng.advisory-text` verbatim; `level_rank` = `advisory-state` as u8; summary = empty string (the feed's list endpoint carries no prose — the page link is the content); `source_url` from `eng.url-slug`; `source_updated_at` = `date-published.asp`; `source_name` = `"Government of Canada — Global Affairs Canada"`; language `"en"`. Same bad-JSON error as Task 3.
- [ ] **Step 4: Verify pass**, **Step 5: Commit** `"Core: parse Canadian travel advisories"`.

---

### Task 5: Core Germany parser

**Files:** Modify `crates/voyalier-core/src/advisories.rs`

**Interfaces:**
- Produces: `parse_de_aa(country: &AdvisoryCountry, country_name: &str, json: &str, retrieved_at: &str) -> Result<Option<AdvisoryEntry>, AppError>`

- [ ] **Step 1: Failing tests:**

```rust
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
fn parses_a_german_advisory_with_warning_flags() {
    let japan = advisory_country("japan").expect("japan");
    let entry = parse_de_aa(japan, "Japan", DE_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").expect("present");
    assert_eq!(entry.source, AdvisorySource::DeAa);
    assert_eq!(entry.level_label.as_deref(), Some("Teilreisewarnung"));
    assert_eq!(entry.level_rank, Some(2));
    assert_eq!(entry.language, "de");
    assert_eq!(entry.summary, "Japan: Reise- und Sicherheitshinweise");

    let france = advisory_country("france").expect("france");
    let entry = parse_de_aa(france, "France", DE_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").expect("present");
    assert_eq!(entry.level_label.as_deref(), Some("Reise- und Sicherheitshinweise"));
    assert_eq!(entry.level_rank, Some(0));

    let germany = advisory_country("germany").expect("germany");
    assert!(parse_de_aa(germany, "Germany", DE_FIXTURE, "2026-07-17T12:00:00Z")
        .expect("parsed").is_none());
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Iterate `response`'s object-valued entries (skip `lastModified`, which is a number); match `countryCode == country.iso2`; absent → `Ok(None)`. Flags → label/rank: `warning` → (`"Reisewarnung"`, 3); else `partialWarning` → (`"Teilreisewarnung"`, 2); else `situationWarning || situationPartWarning` → (`"Sicherheitshinweis (verschärft)"`, 1); else (`"Reise- und Sicherheitshinweise"`, 0). `summary` = `title` verbatim (German); `source_url` = `"https://www.auswaertiges-amt.de/de/ReiseUndSicherheit/reise-und-sicherheitshinweise"` (the feed has no per-country page URL); `source_updated_at` = None (the feed stamps epoch seconds, not RFC 3339 — do not invent a format); `source_name` = `"Auswärtiges Amt (Germany)"`; language `"de"`.
- [ ] **Step 4: Verify pass**, **Step 5: Commit** `"Core: parse German travel advisories"`.

---

### Task 6: Core CDC notices parser (quick-xml)

**Files:**
- Modify: root `Cargo.toml` (`[workspace.dependencies]` add `quick-xml = "0.37"`)
- Modify: `crates/voyalier-core/Cargo.toml` (add `quick-xml.workspace = true`)
- Modify: `crates/voyalier-core/src/advisories.rs`

**Interfaces:**
- Produces: `parse_cdc_notices(xml: &str, retrieved_at: &str) -> Result<Vec<HealthNotice>, AppError>` (retrieved_at unused per-notice but kept for symmetry — drop the parameter if clippy objects) and `notices_for_country(notices: &[HealthNotice], country_name: &str) -> Vec<HealthNotice>`.

- [ ] **Step 1: Failing tests:**

```rust
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
</channel></rss>"#;

#[test]
fn parses_cdc_notices_and_filters_by_country() {
    let notices = parse_cdc_notices(CDC_FIXTURE, "2026-07-17T12:00:00Z").expect("parsed");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].title, "Level 1 - Diphtheria in Haiti");
    assert_eq!(notices[0].level_label.as_deref(), Some("Level 1"));
    assert_eq!(notices[0].summary, "There is an outbreak of diphtheria in Haiti.");
    assert_eq!(notices[0].published_at.as_deref(), Some("Thu, 25 Jun 2026 04:00:00 GMT"));

    let uganda_hits = notices_for_country(&notices, "Uganda");
    assert_eq!(uganda_hits.len(), 1);
    assert!(uganda_hits[0].title.contains("Ebola"));
    assert!(notices_for_country(&notices, "Japan").is_empty());
}

#[test]
fn cdc_parser_distinguishes_an_empty_feed_from_an_unreadable_one() {
    // A real feed with nothing to report parses to an empty list.
    let empty = parse_cdc_notices(
        r#"<?xml version="1.0"?><rss version="2.0"><channel><title>CDC</title></channel></rss>"#,
        "2026-07-17T12:00:00Z",
    )
    .expect("an empty channel is a valid feed");
    assert!(empty.is_empty());

    // Anything without a <channel> is not the feed we asked for.
    let error = parse_cdc_notices("not xml at all <<<", "2026-07-17T12:00:00Z")
        .expect_err("unreadable input is an error");
    assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
    let error = parse_cdc_notices("<html><body>503 Service Unavailable</body></html>", "2026-07-17T12:00:00Z")
        .expect_err("an error page is not a feed");
    assert_eq!(error.code, ErrorCode::AdviceFetchFailed);
}
```

**Parser contract (makes the above deterministic regardless of quick-xml's leniency):** the parser owns the distinction, not the library. Track whether a `<channel>` start element was seen; at EOF, no `<channel>` ⇒ `Err(AdviceFetchFailed)`. A quick-xml reader error ⇒ the same `Err(AdviceFetchFailed)`. A `<channel>` with zero `<item>` children ⇒ `Ok(vec![])`.

- [ ] **Step 2: Verify failure** (compile error: quick_xml unknown until Cargo.toml edits; make the edits, then the test fails on missing functions).
- [ ] **Step 3: Implement.** Use `quick_xml::Reader` in streaming mode over `<item>` children: track current element name, collect `title`, `description` (CDATA arrives as `Event::CData`), `link`, `pubDate`. `level_label` = title prefix up to `" - "` when it starts with `"Level "`. `notices_for_country` = case-insensitive `title.contains(country_name) || summary.contains(country_name)` using lowercase comparison. Cap output at 50 notices (`.take(50)`) so a hostile feed cannot balloon the snapshot — same DoS posture as the email parser.
- [ ] **Step 4: Verify pass.** Also run `cargo tree -p voyalier-core | grep quick-xml` → present once.
- [ ] **Step 5: Commit** `"Core: parse CDC travel health notices"`.

---

### Task 7: App storage — migration v4 + snapshot persistence

**Files:**
- Modify: `crates/voyalier-app/src/lib.rs` — base schema (`travel_advice_snapshots` block at ~line 2771), `MIGRATIONS` array (~line 2883), storage helpers (`fetch_travel_advice_snapshot` ~line 3033), trip-detail assembly (~line 845), the trip-scoped `DELETE FROM travel_advice_snapshots` (~line 2088)

**Interfaces:**
- Consumes: `voyalier_core::advisories::{AdvisoryEntry, AdvisorySource, HealthNotice, SourceStatus, AdvisoryPanel}`.
- Produces: `store_advisory_entry(conn, trip_id, &AdvisoryEntry)`, `delete_advisory_entry(conn, trip_id, source)`, `store_advisory_panel_meta(conn, trip_id, country_slug, country_name, &[HealthNotice], &[SourceStatus], retrieved_at)`, `load_advisory_panel(conn, trip_id) -> Result<Option<AdvisoryPanel>, AppError>`. `TripDetail` gains `advisory_panel` in place of `travel_advice`.

- [ ] **Step 1: Failing test** (alongside the existing storage tests, using the in-memory test service):

```rust
#[test]
fn migration_v4_preserves_a_legacy_uk_snapshot_and_roundtrips_a_panel() {
    // Build a pre-v4 database shape: create the legacy table and a row, set
    // user_version = 3, then run migrate() and assert the row surfaces as a
    // uk-fcdo AdvisoryEntry inside load_advisory_panel.
    // Then store a full panel (4 entries + 1 notice + statuses) and load it
    // back verbatim.
}
```

Write it concretely against the real helpers: open an in-memory `Connection`, execute the **old** `CREATE TABLE travel_advice_snapshots (...)` DDL (copy the 9-column shape from git history / this plan's header) plus a minimal `trips` table row, insert one legacy row for slug `japan` with `alert_status` = `["avoid_all_travel_to_parts"]` JSON, `PRAGMA user_version = 3`, call `migrate(&connection)`, then `load_advisory_panel(&connection, "trip-1")` and assert: one entry, `source == AdvisorySource::UkFcdo`, `level_label == Some("avoid_all_travel_to_parts")`, summary/state preserved, `health_notices` empty, and `source_status` contains only `{UkFcdo, Fresh}`-equivalent kept data (see storage note below). Then exercise store/load of all four sources + notices.

- [ ] **Step 2: Verify failure.** `cargo test -p voyalier-app migration_v4` → FAIL.
- [ ] **Step 3: Implement.**

New DDL (both in base schema, replacing the `travel_advice_snapshots` block, **and** created by the migration for existing DBs):

```sql
CREATE TABLE IF NOT EXISTS advisory_snapshots (
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('uk-fcdo', 'us-state', 'ca-gac', 'de-aa')),
    source_name TEXT NOT NULL,
    country_name TEXT NOT NULL,
    level_label TEXT,
    level_rank INTEGER,
    summary TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_updated_at TEXT,
    change_description TEXT,
    language TEXT NOT NULL,
    attribution TEXT NOT NULL,
    retrieved_at TEXT NOT NULL,
    PRIMARY KEY (trip_id, source)
);

CREATE TABLE IF NOT EXISTS advisory_panels (
    trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
    country_slug TEXT NOT NULL,
    country_name TEXT NOT NULL,
    health_notices TEXT NOT NULL,
    source_status TEXT NOT NULL,
    retrieved_at TEXT NOT NULL
);
```

Migration step (append to `MIGRATIONS`, self-detecting like its predecessors):

```rust
Migration { to: 4, name: "advisory_panel_tables", run: migrate_advisory_panel },
```

`migrate_advisory_panel`: execute the two `CREATE TABLE IF NOT EXISTS` statements; if `sqlite_master` has `travel_advice_snapshots`, read every legacy row in Rust, insert per row (a) an `advisory_snapshots` row: source `'uk-fcdo'`, source_name `'UK Foreign, Commonwealth & Development Office'`, `level_label` = joined alert_status array or NULL, `level_rank` NULL, summary/source_url/source_updated_at/change_description/retrieved_at copied, language `'en'`, attribution `'Open Government Licence v3.0'`; and (b) an `advisory_panels` row: same trip/slug/name, `health_notices` `'[]'`, `source_status` `'[]'`, retrieved_at copied; then `DROP TABLE travel_advice_snapshots`.

Storage helpers mirror the existing `fetch_travel_advice_snapshot` style (`params![]`, `json_to_sql`/`sql_to_json` for the two JSON columns). `load_advisory_panel` returns `None` when no `advisory_panels` row exists; entries ordered by fixed source order UK, US, CA, DE (`ORDER BY CASE source …`). Replace the `travel_advice` field in `TripDetail` (Rust struct + assembly at ~line 845) with `advisory_panel: Option<AdvisoryPanel>`; update the delete path at ~line 2088 to clear both new tables. Legacy-migration `source_status`: store `[{"source":"uk-fcdo","state":"fresh"}]` so the panel renders honestly with just the UK card.

- [ ] **Step 4: Verify pass.** `cargo test -p voyalier-app` (expect the old advice tests to fail compilation — update them in Task 8 if they reference `fetch_travel_advice`; if the compile break blocks this task's test, do the minimal rename of the service method as part of this task instead and fold Task 8's orchestration on top).
- [ ] **Step 5: Commit** `"App: advisory panel storage and migration v4"`.

---

### Task 8: App orchestration — `fetch_advisories`

**Files:**
- Modify: `crates/voyalier-app/src/lib.rs` (replace `fetch_travel_advice` at ~line 1504; update its test `fetch_travel_advice_stores_a_dated_snapshot_without_network_in_tests` at ~line 3547)

**Interfaces:**
- Consumes: Task 7 helpers, core parsers from Tasks 2–6, existing `AdviceFetcher::fetch_text`, `now_rfc3339()`.
- Produces: `pub fn fetch_advisories(&self, trip_id: &str, country_slug: &str) -> Result<AdvisoryPanel, AppError>` — the method the transports call.

- [ ] **Step 1: Failing test.** Extend the existing mock-fetcher advice test into:

```rust
#[test]
fn fetch_advisories_stores_per_source_snapshots_and_reports_partial_failure() {
    // Mock fetcher returns: UK ok (existing fixture), US ok (US_FIXTURE-like
    // body), CA error, DE ok, CDC ok. Assert: panel has UK+US+DE entries,
    // CA status is Unavailable (nothing previously stored), health notices
    // parsed, everything reloadable via trip_detail, and a second call where
    // CA still errors after a prior success yields state Kept with the old
    // CA entry still present.
}
```

Make it concrete with the repo's existing `MockFetcher`/test-service pattern (see how the current advice test injects canned `fetch_text` responses keyed by URL).

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Shape:

```rust
pub fn fetch_advisories(&self, trip_id: &str, country_slug: &str) -> Result<AdvisoryPanel, AppError> {
    let country = advisory_country(country_slug)?;
    let fcdo = validate_country_slug(country_slug)?;
    { let connection = self.connection()?; self.records(&connection).trip(trip_id)?; }
    let retrieved_at = now_rfc3339();

    // Each source resolves to (Option<AdvisoryEntry>, SourceState) without
    // aborting the others. fetch+parse success with None => NotPublished.
    // fetch/parse failure => Kept if a row already exists, else Unavailable.
    ...
}
```

Concrete per-source closures: UK = existing per-country URL + `parse_fcdo_content` + `entry_from_fcdo`; US/CA/DE = list URLs from the plan header + their parsers. CDC fetch failure ⇒ keep previously stored notices (they live on the panel row; on failure re-store the old notices with the new statuses). Persist: successful entries via `store_advisory_entry`; `NotPublished` deletes any stale row for that source; panel meta row always rewritten with fresh `source_status` + `retrieved_at`. Error only when **all five** fetches fail AND nothing was previously stored — then return `ErrorCode::AdviceFetchFailed`. Return `load_advisory_panel(...)` output so the response is exactly what a reload shows.

- [ ] **Step 4: Verify pass.** `cargo test -p voyalier-app` fully green (old advice test now rewritten).
- [ ] **Step 5: Commit** `"App: fetch_advisories orchestrates five official sources with per-source honesty"`.

---

### Task 9: Contract + both transports + mock

**Files:**
- Modify: `packages/contracts/src/index.ts` (~lines 20–30 TripDetail, 249–274 types, 625 error codes untouched, 731 method)
- Modify: `packages/contracts/src/mock.ts` (~lines 1249, 1424–1436, 1473, 2179–2205, 2258)
- Modify: `apps/web/src/gateway/http.ts` (~line 277) and `crates/voyalier-server/src/lib.rs` (~lines 206–208, 526–534)
- Modify: `apps/web/src/gateway/tauri.ts` (~line 201) and `apps/desktop/src-tauri/src/lib.rs` (~lines 472–476, 835, 1222)

**Interfaces:**
- Produces (TS, exact):

```ts
export type AdvisorySource = "uk-fcdo" | "us-state" | "ca-gac" | "de-aa";
export type SourceState = "fresh" | "kept" | "unavailable" | "notPublished";
export interface AdvisoryEntry {
  source: AdvisorySource;
  sourceName: string;
  countryName: string;
  levelLabel?: string;
  levelRank?: number;
  summary: string;
  sourceUrl: string;
  sourceUpdatedAt?: string;
  changeDescription?: string;
  language: string;
  attribution: string;
  retrievedAt: string;
}
export interface HealthNotice {
  title: string;
  url: string;
  levelLabel?: string;
  publishedAt?: string;
  summary: string;
}
export interface SourceStatus { source: AdvisorySource; state: SourceState; }
export interface AdvisoryPanel {
  countrySlug: string;
  countryName: string;
  entries: AdvisoryEntry[];
  healthNotices: HealthNotice[];
  sourceStatus: SourceStatus[];
  retrievedAt: string;
}
export interface FetchAdvisoriesInput { tripId: string; countrySlug: string; }
```

`TravelAdviceSnapshot` + `FetchTravelAdviceInput` are deleted; `TripDetail.travelAdvice?: TravelAdviceSnapshot` becomes `advisoryPanel?: AdvisoryPanel`; `AppGateway.fetchTravelAdvice` becomes `fetchAdvisories(input: FetchAdvisoriesInput): Promise<AdvisoryPanel>`; `listAdviceCountries(): Promise<FcdoCountry[]>` is unchanged.

- [ ] **Step 1: Make the change compile-first (types drive everything).** Update `index.ts` as above. Run `pnpm --filter contracts build` (or `pnpm typecheck` at root — use whichever script exists in `packages/contracts/package.json`) → expect mock + gateways to FAIL compilation. That failing typecheck is this task's "failing test."
- [ ] **Step 2: Mock.** In `mock.ts`: rename the snapshot map to `advisoryPanels = new Map<string, AdvisoryPanel>()`; `fetchAdvisories` builds a deterministic fictional panel: UK entry (reuse the existing fictional FCDO wording), US entry (`levelLabel: "Level 1: Exercise Normal Precautions"`, `levelRank: 1`), CA entry (`levelLabel: "Exercise normal security precautions"`, `levelRank: 0`), DE entry (`levelLabel: "Reise- und Sicherheitshinweise"`, `levelRank: 0`, `language: "de"`), one health notice (`title: "Level 1 - Measles in Fictionland"`), `sourceStatus` all `"fresh"`, stored per trip and surfaced on `tripDetail` as `advisoryPanel`. Keep the delete-path cleanup (lines 1473/2258 equivalents).
- [ ] **Step 3: HTTP transport.** `http.ts`: `fetchAdvisories: (input) => request<AdvisoryPanel>("POST", \`/api/v1/trips/${enc(input.tripId)}/advisories\`, { countrySlug: input.countrySlug })`. Server: rename route to `/api/v1/trips/{trip_id}/advisories`, handler calls `service.fetch_advisories(&trip_id, &body.country_slug)`.
- [ ] **Step 4: Tauri transport.** `tauri.ts`: `fetchAdvisories: (input) => call<AdvisoryPanel>("fetch_advisories", input)`. Desktop `lib.rs`: rename command fn + `generate_handler!` entry + the capability-name string at ~line 1222 to `fetch_advisories`.
- [ ] **Step 5: Verify.** Root `pnpm typecheck && pnpm --filter contracts test` (run whatever test script the package declares), `cargo test -p voyalier-server`, `cargo build -p voyalier-desktop` (or the tauri crate's name from its Cargo.toml). All green.
- [ ] **Step 6: Commit** `"Contract: fetchAdvisories replaces fetchTravelAdvice across both transports"`.

---

### Task 10: Web UI panel + i18n + tests + changelog

**Files:**
- Modify: `apps/web/src/views/TravelAdvice.tsx` (161 lines today — extend in place, keep its fetch/announce/staleness scaffolding)
- Modify: `apps/web/src/views/TripDetailView.tsx:754` (prop now `advisoryPanel`)
- Modify: `apps/web/src/app/i18n.ts` (advice.* keys, ~line 467)
- Modify: `apps/web/src/travelAdvice.test.tsx`
- Modify: `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:** consumes `AdvisoryPanel` from the contract; renders one card per entry in contract order + a health-notices list + per-source status lines.

- [ ] **Step 1: Failing tests.** Rewrite `travelAdvice.test.tsx` against the mock gateway: after clicking the existing fetch button, assert (a) four `region`/card headings — "UK Foreign, Commonwealth & Development Office", "U.S. Department of State", "Government of Canada — Global Affairs Canada", "Auswärtiges Amt (Germany)"; (b) the US card shows "Level 1: Exercise Normal Precautions"; (c) the German card carries `lang="de"` on its content element; (d) a "Health notices (US CDC)" section with the fictional notice title rendered as an external link; (e) each card shows its attribution string; (f) the existing staleness copy still appears. Follow the file's current testing-library idioms.
- [ ] **Step 2: Verify failure.** `pnpm --filter web test -- --run travelAdvice`.
- [ ] **Step 3: Implement.** Keep the component's existing fetch flow (button → `gateway.fetchAdvisories({tripId, countrySlug})` → announce). Render `panel.entries.map(...)`: heading = `sourceName`, badge = `levelLabel` (omit when absent; badge tone from `levelRank` within that card only), body = `summary` (plain text), meta row = retrieved/source-updated stamps reusing `advice.retrieved`/`advice.sourceUpdated`, link = `sourceUrl` with `advice.readMore` generalized, footer = `attribution`. German entry: wrap summary + label in an element with `lang="de"`. Status lines for non-`fresh` sources via new keys. New/changed i18n keys (exact):

```ts
"advice.title": "Official travel advice",
"advice.readMore": "Read the full advice at the source",
"advice.healthNotices": "Health notices (US CDC)",
"advice.status.kept": "{source}: fetch failed — showing the last saved copy",
"advice.status.unavailable": "{source}: not available right now",
"advice.status.notPublished": "{source} does not publish advice for this destination",
"advice.announce.saved": "Official advice for {country} saved.",
```

(Keep every existing `advice.*` key that still has a caller; delete none blindly — search usages first.)
- [ ] **Step 4: Verify pass + a11y.** `pnpm --filter web test -- --run travelAdvice` then the full `pnpm --filter web test -- --run` (axe gates included).
- [ ] **Step 5: CHANGELOG.** Under `[Unreleased]` → Added: `Official advice panel now shows UK, US, Canadian, and German government advisories side by side, plus US CDC travel health notices — all keyless official feeds, fetched only on your click and saved as dated snapshots.`
- [ ] **Step 6: Commit** `"Web: four-government advisory panel with CDC health notices"`.

---

### Task 11: Full verification sweep

- [ ] `cargo test --workspace` → all green.
- [ ] `cargo clippy --workspace --all-targets` → no new warnings.
- [ ] Root `pnpm typecheck && pnpm test` (or the repo's aggregate scripts from the root `package.json`) → all green, including contract parity suites.
- [ ] `pnpm --filter web build` and `cargo build -p voyalier-server` → clean.
- [ ] Manual smoke via the mock gateway (browser dev mode, `VITE_MOCK=1` on :5174 per repo convention): open a trip → Official advice → fetch → four cards + notices render; screenshot for the review checkpoint.
- [ ] Commit any stragglers; stop for the user's seam-1 review checkpoint (do NOT start seam 2).
