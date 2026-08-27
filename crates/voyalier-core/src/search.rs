//! Deterministic search over a trip's own corpus (source documents and
//! confirmed facts), with provenance on every hit.
//!
//! A trip's corpus is tiny (a handful of documents, dozens of facts), so this
//! is a plain in-process scan with transparent scoring — no index, no
//! dependencies, identical results on every platform. FTS5 or embeddings can
//! replace the internals later without changing the contract. Queries and
//! document text are untrusted data; matching is purely lexical.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ConfirmedFact, ErrorCode, FactType, TripStatus};

pub const MAX_QUERY_LEN: usize = 200;
const MAX_HITS: usize = 20;
const SNIPPET_CONTEXT_CHARS: usize = 60;
/// Most typeahead term suggestions returned for one query.
pub const SEARCH_SUGGESTION_LIMIT: usize = 8;

/// Where a search hit came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchHitSource {
    Document,
    ConfirmedFact,
    /// Research the traveler kept to read. Separate from `Document` on purpose:
    /// one is evidence that was parsed, the other is reading that never is.
    Resource,
}

/// One ranked hit with enough provenance to open the underlying record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub source: SearchHitSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fact_type: Option<FactType>,
    /// Source/traveler text inserted into a localized fact label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// `source_documents.id` or `confirmed_facts.id` depending on `source`.
    pub record_id: String,
    /// Human label: the document label, or a fact headline.
    pub label: String,
    /// Verbatim excerpt around the first match (documents) or the matching
    /// field's value (facts).
    pub snippet: String,
    /// Transparent relevance: number of query-term occurrences.
    pub score: u32,
}

/// A document made available to search (already stored locally).
pub struct SearchableDocument<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub content: &'a str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSearchSource {
    Document,
    ConfirmedFact,
    Note,
    SavedPlace,
    TripItem,
    Resource,
}

/// One locally opened record offered to the deterministic workspace search.
/// The app layer owns opening sealed text; core only ranks borrowed strings.
pub struct WorkspaceSearchRecord<'a> {
    pub source: WorkspaceSearchSource,
    pub trip_id: &'a str,
    pub trip_title: &'a str,
    pub trip_status: TripStatus,
    pub trip_updated_at: &'a str,
    pub record_id: &'a str,
    pub label: &'a str,
    pub text: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchHit {
    pub source: WorkspaceSearchSource,
    pub trip_id: String,
    pub trip_title: String,
    pub trip_status: TripStatus,
    pub trip_updated_at: String,
    pub record_id: String,
    pub label: String,
    pub snippet: String,
    pub score: u32,
}

/// Validate a raw search query: non-empty after trimming, bounded length.
pub fn validate_search_query(query: &str) -> Result<String, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "search query is required",
            "field",
            "query",
        ));
    }
    if trimmed.chars().count() > MAX_QUERY_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "search query must be 200 characters or fewer",
            "field",
            "query",
        ));
    }
    Ok(trimmed.to_owned())
}

/// Distinct, lowercased query words. The relaxed match works per word, so
/// "airport shuttle" finds text with either word — not only the exact phrase.
fn query_tokens(query: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    for word in query.split_whitespace() {
        let lowered = word.to_lowercase();
        if !lowered.is_empty() && !tokens.contains(&lowered) {
            tokens.push(lowered);
        }
    }
    tokens
}

/// Score one lowercased haystack against the query tokens: how many distinct
/// tokens it contains, the total occurrences, and the earliest-matching token
/// (for anchoring a snippet). `matched == 0` means no token appears.
fn score_haystack<'t>(haystack: &str, tokens: &'t [String]) -> (u32, u32, Option<&'t str>) {
    let mut matched = 0u32;
    let mut occurrences = 0u32;
    let mut earliest: Option<(usize, &str)> = None;
    for token in tokens {
        let count = count_occurrences(haystack, token);
        if count > 0 {
            matched += 1;
            occurrences = occurrences.saturating_add(count);
            if let Some(position) = haystack.find(token.as_str()) {
                if earliest.is_none_or(|(prev, _)| position < prev) {
                    earliest = Some((position, token));
                }
            }
        }
    }
    (matched, occurrences, earliest.map(|(_, token)| token))
}

/// One kept link or file offered to the trip scan.
///
/// Shaped like [`SearchableDocument`] and named apart from it deliberately:
/// "document" is imported evidence in this product's language, and a resource
/// is the thing that never is.
pub struct SearchableResource<'a> {
    pub id: &'a str,
    pub title: &'a str,
    /// The traveler's note and tags plus any fetched page text, already joined
    /// by the app layer.
    pub text: &'a str,
}

/// Search documents, confirmed facts, and kept resources for a validated query.
/// Relaxed: a record matches if it contains ANY query word. Ranked by how many
/// distinct query words it covers, then by total occurrences, then stable by id.
pub fn search_trip_corpus(
    query: &str,
    documents: &[SearchableDocument<'_>],
    facts: &[ConfirmedFact],
    resources: &[SearchableResource<'_>],
) -> Vec<SearchHit> {
    let tokens = query_tokens(query);
    if tokens.is_empty() {
        return Vec::new();
    }
    // Track (hit, distinct-tokens-matched) so ranking can prefer broader coverage
    // without widening the public SearchHit shape.
    let mut ranked: Vec<(SearchHit, u32)> = Vec::new();

    for document in documents {
        let haystack = document.content.to_lowercase();
        let (matched, occurrences, first_token) = score_haystack(&haystack, &tokens);
        if matched == 0 {
            continue;
        }
        let snippet = first_token
            .map(|token| snippet_around_first_match(document.content, &haystack, token))
            .unwrap_or_default();
        ranked.push((
            SearchHit {
                source: SearchHitSource::Document,
                fact_type: None,
                subject: None,
                record_id: document.id.to_owned(),
                label: document.label.to_owned(),
                snippet,
                score: occurrences,
            },
            matched,
        ));
    }

    for fact in facts {
        // Pick the field value that covers the most query words (then most
        // occurrences); its verbatim text is the snippet — clean to reuse.
        let mut best: Option<(u32, u32, String)> = None;
        for value in fact_field_values(fact) {
            let (matched, occurrences, _) = score_haystack(&value.to_lowercase(), &tokens);
            if matched > 0
                && best
                    .as_ref()
                    .is_none_or(|(m, o, _)| (matched, occurrences) > (*m, *o))
            {
                best = Some((matched, occurrences, value.to_owned()));
            }
        }
        if let Some((matched, occurrences, snippet)) = best {
            ranked.push((
                SearchHit {
                    source: SearchHitSource::ConfirmedFact,
                    fact_type: Some(fact.fact_type),
                    subject: fact_subject(fact),
                    record_id: fact.id.clone(),
                    label: fact_label(fact),
                    snippet,
                    score: occurrences,
                },
                matched,
            ));
        }
    }

    for resource in resources {
        // The title is searched with the text: unlike a fact's derived label or
        // the product's word for "notes", a resource title is what the traveler
        // (or the page) actually called it.
        let combined = format!("{} {}", resource.title, resource.text);
        let haystack = combined.to_lowercase();
        let (matched, occurrences, first_token) = score_haystack(&haystack, &tokens);
        if matched == 0 {
            continue;
        }
        let text_lower = resource.text.to_lowercase();
        let snippet = first_token
            .filter(|token| text_lower.contains(token))
            .map(|token| snippet_around_first_match(resource.text, &text_lower, token))
            .unwrap_or_default();
        ranked.push((
            SearchHit {
                source: SearchHitSource::Resource,
                fact_type: None,
                subject: None,
                record_id: resource.id.to_owned(),
                label: resource.title.to_owned(),
                snippet,
                score: occurrences,
            },
            matched,
        ));
    }

    ranked.sort_by(|(left, left_matched), (right, right_matched)| {
        right_matched
            .cmp(left_matched)
            .then_with(|| right.score.cmp(&left.score))
            .then_with(|| left.record_id.cmp(&right.record_id))
    });
    ranked.truncate(MAX_HITS);
    ranked.into_iter().map(|(hit, _)| hit).collect()
}

/// Search every trip's explicitly supplied local records. Pending parser
/// candidates are absent by construction because the app never supplies them.
pub fn search_workspace_corpus(
    query: &str,
    records: &[WorkspaceSearchRecord<'_>],
) -> Vec<WorkspaceSearchHit> {
    let tokens = query_tokens(query);
    let mut ranked: Vec<(WorkspaceSearchHit, u32)> = records
        .iter()
        .filter_map(|record| {
            let searches_source_label = matches!(
                record.source,
                WorkspaceSearchSource::Document
                    | WorkspaceSearchSource::SavedPlace
                    | WorkspaceSearchSource::TripItem
                    | WorkspaceSearchSource::Resource
            );
            let combined = if searches_source_label {
                format!("{} {}", record.label, record.text)
            } else {
                record.text.to_owned()
            };
            let lower = combined.to_lowercase();
            let (matched, score, first_token) = score_haystack(&lower, &tokens);
            if matched == 0 {
                return None;
            }
            let text_lower = record.text.to_lowercase();
            let snippet = first_token
                .filter(|token| text_lower.contains(token))
                .map(|token| snippet_around_first_match(record.text, &text_lower, token))
                .unwrap_or_default();
            Some((
                WorkspaceSearchHit {
                    source: record.source,
                    trip_id: record.trip_id.to_owned(),
                    trip_title: record.trip_title.to_owned(),
                    trip_status: record.trip_status,
                    trip_updated_at: record.trip_updated_at.to_owned(),
                    record_id: record.record_id.to_owned(),
                    label: record.label.to_owned(),
                    snippet,
                    score,
                },
                matched,
            ))
        })
        .collect();
    ranked.sort_by(|(left, left_matched), (right, right_matched)| {
        right_matched
            .cmp(left_matched)
            .then_with(|| right.score.cmp(&left.score))
            .then_with(|| right.trip_updated_at.cmp(&left.trip_updated_at))
            .then_with(|| left.record_id.cmp(&right.record_id))
    });
    ranked.truncate(50);
    ranked.into_iter().map(|(hit, _)| hit).collect()
}

/// Typeahead term suggestions for the query's last word: distinct words from the
/// corpus (document text and fact field values) that contain it —
/// so a partial "shut" surfaces "shuttle" to autofill. Prefix matches rank first,
/// then by how often the term appears. Local only; nothing leaves the device.
pub fn suggest_search_terms(
    query: &str,
    documents: &[SearchableDocument<'_>],
    facts: &[ConfirmedFact],
    limit: usize,
) -> Vec<String> {
    let last = match query.split_whitespace().next_back() {
        Some(word) if word.chars().count() >= 2 => word.to_lowercase(),
        _ => return Vec::new(),
    };

    // term (original casing) -> (occurrences, is_prefix_match)
    let mut seen: std::collections::HashMap<String, (u32, bool)> = std::collections::HashMap::new();
    let mut consider = |term: &str| {
        let trimmed = term.trim();
        if trimmed.chars().count() < 2 {
            return;
        }
        let lowered = trimmed.to_lowercase();
        if !lowered.contains(&last) {
            return;
        }
        let entry = seen.entry(trimmed.to_owned()).or_insert((0, false));
        entry.0 = entry.0.saturating_add(1);
        entry.1 = lowered.starts_with(&last);
    };

    for document in documents {
        for word in document.content.split(|c: char| !c.is_alphanumeric()) {
            consider(word);
        }
    }
    for fact in facts {
        // Whole field values (e.g. "River Paper Inn", a confirmation code) are
        // useful autofill targets alongside individual words.
        for value in fact_field_values(fact) {
            consider(value);
            for word in value.split(|c: char| !c.is_alphanumeric()) {
                consider(word);
            }
        }
    }

    let mut terms: Vec<(String, u32, bool)> = seen
        .into_iter()
        .map(|(term, (count, prefix))| (term, count, prefix))
        .collect();
    // Prefix matches first, then more frequent, then alphabetical for stability.
    terms.sort_by(|(left, lc, lp), (right, rc, rp)| {
        rp.cmp(lp)
            .then_with(|| rc.cmp(lc))
            .then_with(|| left.to_lowercase().cmp(&right.to_lowercase()))
    });
    terms.truncate(limit);
    terms.into_iter().map(|(term, _, _)| term).collect()
}

fn count_occurrences(haystack: &str, needle: &str) -> u32 {
    if needle.is_empty() {
        return 0;
    }
    let mut count = 0u32;
    let mut from = 0usize;
    while let Some(position) = haystack[from..].find(needle) {
        count = count.saturating_add(1);
        from += position + needle.len();
        if from >= haystack.len() {
            break;
        }
    }
    count
}

/// A verbatim excerpt around the first match, clipped to char boundaries with
/// ellipses when truncated.
fn snippet_around_first_match(original: &str, _lowered: &str, needle: &str) -> String {
    // Unicode lowercase conversion can expand a character (for example,
    // `İ` becomes `i` plus a combining dot). Byte offsets in the folded string
    // therefore cannot be used to slice the original. Build the folded string
    // together with an explicit mapping back to original character positions.
    let mut folded = String::new();
    let mut folded_segments = Vec::new();
    for (original_index, character) in original.chars().enumerate() {
        let start = folded.len();
        folded.extend(character.to_lowercase());
        folded_segments.push((start, folded.len(), original_index));
    }

    let Some(byte_start) = folded.find(needle) else {
        return String::new();
    };
    let byte_end = byte_start.saturating_add(needle.len());
    let prefix_chars = folded_segments
        .iter()
        .find(|(start, end, _)| *start <= byte_start && byte_start < *end)
        .map_or(0, |(_, _, index)| *index);
    let match_end_chars = folded_segments
        .iter()
        .rev()
        .find(|(start, end, _)| *start < byte_end && byte_start < *end)
        .map_or(prefix_chars.saturating_add(1), |(_, _, index)| index + 1);
    let chars: Vec<char> = original.chars().collect();

    let start = prefix_chars.saturating_sub(SNIPPET_CONTEXT_CHARS);
    let end = (match_end_chars + SNIPPET_CONTEXT_CHARS).min(chars.len());

    let mut snippet: String = chars[start..end].iter().collect();
    snippet = snippet.split_whitespace().collect::<Vec<_>>().join(" ");
    if start > 0 {
        snippet = format!("…{snippet}");
    }
    if end < chars.len() {
        snippet = format!("{snippet}…");
    }
    snippet
}

fn fact_label(fact: &ConfirmedFact) -> String {
    match fact.fact_type {
        FactType::FlightSegment => match fact
            .payload
            .flight_number
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(number) => format!("Flight {number}"),
            None => "Flight".to_owned(),
        },
        FactType::LodgingStay => fact
            .payload
            .property_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "Stay".to_owned()),
        FactType::RailJourney | FactType::CoachJourney | FactType::FerryCrossing => {
            journey_name(fact).unwrap_or_else(|| {
                match fact.fact_type {
                    FactType::CoachJourney => "Coach journey",
                    FactType::FerryCrossing => "Ferry crossing",
                    _ => "Rail journey",
                }
                .to_owned()
            })
        }
        FactType::CarRental => {
            trimmed(fact.payload.carrier_name.as_deref()).unwrap_or_else(|| "Car rental".to_owned())
        }
    }
}

/// What a surface journey calls itself: the service if the operator named one,
/// otherwise the operator.
fn journey_name(fact: &ConfirmedFact) -> Option<String> {
    trimmed(fact.payload.service_number.as_deref())
        .or_else(|| trimmed(fact.payload.carrier_name.as_deref()))
}

fn trimmed(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn fact_subject(fact: &ConfirmedFact) -> Option<String> {
    match fact.fact_type {
        FactType::FlightSegment => trimmed(fact.payload.flight_number.as_deref()),
        FactType::LodgingStay => trimmed(fact.payload.property_name.as_deref()),
        FactType::RailJourney | FactType::CoachJourney | FactType::FerryCrossing => {
            journey_name(fact)
        }
        FactType::CarRental => trimmed(fact.payload.carrier_name.as_deref()),
    }
}

fn fact_field_values(fact: &ConfirmedFact) -> Vec<&str> {
    let payload = &fact.payload;
    [
        payload.airline_name.as_deref(),
        payload.airline_iata.as_deref(),
        payload.flight_number.as_deref(),
        payload.departure_airport_iata.as_deref(),
        payload.arrival_airport_iata.as_deref(),
        payload.departure_local.as_deref(),
        payload.arrival_local.as_deref(),
        payload.confirmation_code.as_deref(),
        payload.passenger_name.as_deref(),
        payload.property_name.as_deref(),
        payload.address.as_deref(),
        payload.checkin_date.as_deref(),
        payload.checkout_date.as_deref(),
        payload.guest_name.as_deref(),
        payload.carrier_name.as_deref(),
        payload.service_number.as_deref(),
        payload.departure_place.as_deref(),
        payload.arrival_place.as_deref(),
        payload.vehicle_description.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// Traveler/source-supplied confirmed-fact values, flattened for local search.
/// Field names are deliberately excluded: camelCase contract keys are product
/// implementation text, not content the traveler entered or approved.
pub fn fact_search_text(fact: &ConfirmedFact) -> String {
    fact_field_values(fact).join(" ")
}

/// How this fact identifies itself, using only the traveler's own data.
///
/// A search result headed "Confirmed fact" spent its one line saying what the
/// interface already says beside it, instead of naming which flight or stay
/// matched. This supplies the name. It returns `None` rather than a fallback
/// noun, because the noun is prose and prose is the interface's job — this
/// crate must not ship English that a Spanish reader would then see.
pub fn fact_identity(fact: &ConfirmedFact) -> Option<String> {
    let payload = &fact.payload;
    match fact.fact_type {
        FactType::FlightSegment => {
            match (
                payload.departure_airport_iata.as_deref(),
                payload.arrival_airport_iata.as_deref(),
            ) {
                (Some(from), Some(to)) => Some(format!("{from} → {to}")),
                _ => payload.flight_number.clone(),
            }
        }
        FactType::LodgingStay => payload.property_name.clone(),
        FactType::RailJourney | FactType::CoachJourney | FactType::FerryCrossing => {
            match (
                trimmed(payload.departure_place.as_deref()),
                trimmed(payload.arrival_place.as_deref()),
            ) {
                (Some(from), Some(to)) => Some(format!("{from} → {to}")),
                _ => journey_name(fact),
            }
        }
        FactType::CarRental => trimmed(payload.carrier_name.as_deref()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactPayload};

    #[test]
    fn parity_search_score_matches_the_contract() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/contracts/parity/search-score.json");
        let raw = std::fs::read_to_string(&path).expect("parity/search-score.json");
        let mut golden: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        let regenerate = std::env::var("VOYALIER_REGENERATE_GOLDEN").is_ok();
        let token_cases = golden["tokenCases"]
            .as_array()
            .expect("token cases array")
            .clone();
        let cases = golden["cases"].as_array().expect("cases array").clone();
        let mut regenerated_token_cases = Vec::with_capacity(token_cases.len());
        let mut regenerated = Vec::with_capacity(cases.len());

        for case in &token_cases {
            let name = case["name"].as_str().expect("name");
            let query = case["query"].as_str().expect("query");
            let actual = serde_json::to_value(query_tokens(query)).expect("serializable tokens");
            if regenerate {
                let mut updated = case.clone();
                updated["expected"] = actual;
                regenerated_token_cases.push(updated);
                continue;
            }
            assert_eq!(
                actual, case["expected"],
                "query tokens disagree for {name:?}"
            );
        }

        for case in &cases {
            let name = case["name"].as_str().expect("name");
            let haystack = case["haystack"].as_str().expect("haystack");
            let tokens: Vec<String> =
                serde_json::from_value(case["tokens"].clone()).expect("tokens");
            let (matched, occurrences, first) = score_haystack(haystack, &tokens);
            let actual = serde_json::json!({
                "matched": matched,
                "occurrences": occurrences,
                "first": first,
            });
            if regenerate {
                let mut updated = case.clone();
                updated["expected"] = actual;
                regenerated.push(updated);
                continue;
            }
            assert_eq!(
                actual, case["expected"],
                "search score disagrees for {name:?}"
            );
        }

        if regenerate {
            golden["tokenCases"] = serde_json::Value::Array(regenerated_token_cases);
            golden["cases"] = serde_json::Value::Array(regenerated);
            let mut written = serde_json::to_string_pretty(&golden).expect("serializable");
            written.push('\n');
            std::fs::write(&path, written).expect("rewrite golden");
            panic!("golden regenerated — review the diff, then run without the flag");
        }
        assert_eq!(
            token_cases.len(),
            1,
            "every query-token case must be checked"
        );
        assert_eq!(cases.len(), 7, "every search-score case must be checked");
    }

    fn fact(id: &str, property: &str, code: &str) -> ConfirmedFact {
        ConfirmedFact {
            id: id.to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some(property.to_owned()),
                confirmation_code: Some(code.to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
            source_removed: false,
        }
    }

    #[test]
    fn fact_identity_names_the_fact_with_the_traveler_s_own_data() {
        // A search result headed "Confirmed fact" told the traveler nothing
        // about *which* fact matched. The identifying data does.
        let mut flight = fact("fact_2", "unused", "KYT042");
        flight.fact_type = FactType::FlightSegment;
        flight.payload.property_name = None;
        flight.payload.departure_airport_iata = Some("SFO".to_owned());
        flight.payload.arrival_airport_iata = Some("KIX".to_owned());
        assert_eq!(fact_identity(&flight).as_deref(), Some("SFO → KIX"));

        // A flight with no route falls back to its number.
        flight.payload.departure_airport_iata = None;
        flight.payload.arrival_airport_iata = None;
        flight.payload.flight_number = Some("FP18".to_owned());
        assert_eq!(fact_identity(&flight).as_deref(), Some("FP18"));

        // Lodging is named by its property.
        assert_eq!(
            fact_identity(&fact("fact_1", "River Paper Inn", "RPI731")).as_deref(),
            Some("River Paper Inn")
        );

        // Nothing identifying: None, so the interface supplies its own
        // localized noun rather than this crate inventing English prose.
        let mut bare = fact("fact_3", "unused", "X1");
        bare.payload.property_name = None;
        assert_eq!(fact_identity(&bare), None);
    }

    #[test]
    fn fact_search_text_contains_values_but_never_contract_field_names() {
        let text = fact_search_text(&fact("fact_1", "River Paper Inn", "RPI731"));
        assert!(text.contains("River Paper Inn"));
        assert!(text.contains("RPI731"));
        assert!(!text.contains("propertyName"));
        assert!(!text.contains("confirmationCode"));
    }

    #[test]
    fn rejects_empty_and_oversized_queries() {
        assert_eq!(
            validate_search_query("   ").expect_err("empty").code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            validate_search_query(&"x".repeat(201))
                .expect_err("too long")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(validate_search_query("  shuttle  ").expect("ok"), "shuttle");
    }

    #[test]
    fn finds_document_matches_with_verbatim_snippets() {
        let documents = [SearchableDocument {
            id: "doc_1",
            label: "Hotel email",
            content: "Dear guest, the airport Shuttle leaves every 30 minutes from door 4.",
        }];
        let hits = search_trip_corpus("shuttle", &documents, &[], &[]);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source, SearchHitSource::Document);
        assert_eq!(hits[0].record_id, "doc_1");
        // Case-insensitive match, verbatim original casing in the snippet.
        assert!(hits[0].snippet.contains("Shuttle leaves"));
        assert_eq!(hits[0].score, 1);
    }

    #[test]
    fn finds_fact_matches_and_ranks_by_occurrences() {
        let documents = [SearchableDocument {
            id: "doc_1",
            label: "Notes",
            content: "inn inn inn",
        }];
        let facts = [fact("fact_1", "River Paper Inn", "RPI731")];
        let hits = search_trip_corpus("inn", &documents, &facts, &[]);
        assert_eq!(hits.len(), 2);
        // Document has three occurrences, fact one — document ranks first.
        assert_eq!(hits[0].record_id, "doc_1");
        assert_eq!(hits[0].score, 3);
        assert_eq!(hits[1].source, SearchHitSource::ConfirmedFact);
        assert_eq!(hits[1].label, "River Paper Inn");
    }

    #[test]
    fn finds_research_resources_and_marks_them_as_their_own_kind_of_hit() {
        let resources = [SearchableResource {
            id: "res_1",
            title: "Kyoto cherry blossom timing",
            text: "Peak bloom is usually the first week of April.",
        }];
        let hits = search_trip_corpus("bloom", &[], &[], &resources);

        assert_eq!(hits.len(), 1);
        // Not a Document: a resource is reading material, and the interface has
        // to be able to say so rather than filing it beside imported evidence.
        assert_eq!(hits[0].source, SearchHitSource::Resource);
        assert_eq!(hits[0].record_id, "res_1");
        assert_eq!(hits[0].label, "Kyoto cherry blossom timing");
        assert!(hits[0].snippet.contains("Peak bloom"));
    }

    #[test]
    fn matches_a_resource_by_its_title_because_the_traveler_chose_those_words() {
        let resources = [SearchableResource {
            id: "res_1",
            title: "Shinkansen fare guide",
            text: "",
        }];
        let hits = search_trip_corpus("shinkansen", &[], &[], &resources);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].record_id, "res_1");
    }

    #[test]
    fn ranks_a_resource_workspace_hit_with_its_trip_provenance() {
        let hits = search_workspace_corpus(
            "onsen",
            &[WorkspaceSearchRecord {
                source: WorkspaceSearchSource::Resource,
                trip_id: "trip_1",
                trip_title: "Japan",
                trip_status: TripStatus::Active,
                trip_updated_at: "2026-01-02T00:00:00Z",
                record_id: "res_1",
                label: "Onsen etiquette",
                text: "Tattoo policies vary by bathhouse.",
            }],
        );

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].source, WorkspaceSearchSource::Resource);
        assert_eq!(hits[0].trip_id, "trip_1");
        assert_eq!(hits[0].label, "Onsen etiquette");
    }

    #[test]
    fn no_matches_yields_empty_not_error() {
        let hits = search_trip_corpus("zeppelin", &[], &[], &[]);
        assert!(hits.is_empty());
    }

    #[test]
    fn snippets_never_split_multibyte_text() {
        let content = format!("{}目的地は京都です{}", "あ".repeat(100), "い".repeat(100));
        let documents = [SearchableDocument {
            id: "doc_1",
            label: "Japanese note",
            content: &content,
        }];
        let hits = search_trip_corpus("京都", &documents, &[], &[]);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("京都"));
        assert!(hits[0].snippet.starts_with('…') && hits[0].snippet.ends_with('…'));
    }

    #[test]
    fn relaxed_matching_finds_any_word_and_ranks_by_coverage() {
        let both = SearchableDocument {
            id: "doc_both",
            label: "Full",
            content: "The airport shuttle leaves from door 4.",
        };
        let one = SearchableDocument {
            id: "doc_one",
            label: "Partial",
            content: "Shuttle service is hourly.",
        };
        // The exact phrase "airport shuttle" is in neither as a phrase-with-count,
        // but relaxed per-word matching still finds both.
        let hits = search_trip_corpus("airport shuttle", &[both, one], &[], &[]);
        assert_eq!(hits.len(), 2);
        // The doc covering BOTH words ranks first over the one with a single word.
        assert_eq!(hits[0].record_id, "doc_both");
        assert_eq!(hits[1].record_id, "doc_one");
    }

    #[test]
    fn suggests_terms_that_complete_the_last_word() {
        let documents = [SearchableDocument {
            id: "doc_1",
            label: "Hotel email",
            content: "The airport shuttle leaves from the shuttle bay.",
        }];
        let facts = [fact("fact_1", "River Paper Inn", "RPI731")];

        // A partial word surfaces the full word from the corpus.
        let terms = suggest_search_terms("shut", &documents, &facts, 8);
        assert!(
            terms
                .iter()
                .any(|term| term.eq_ignore_ascii_case("shuttle"))
        );

        // Whole fact values are offered as autofill targets too.
        let paper = suggest_search_terms("paper", &documents, &facts, 8);
        assert!(paper.iter().any(|term| term == "River Paper Inn"));

        // Completion targets the LAST word, so earlier words are kept by the UI.
        let multi = suggest_search_terms("airport shut", &documents, &facts, 8);
        assert!(
            multi
                .iter()
                .any(|term| term.eq_ignore_ascii_case("shuttle"))
        );

        // Too-short or empty tails suggest nothing.
        assert!(suggest_search_terms("a", &documents, &facts, 8).is_empty());
        assert!(suggest_search_terms("   ", &documents, &facts, 8).is_empty());
    }

    #[test]
    fn results_are_capped() {
        let contents: Vec<String> = (0..30).map(|index| format!("match {index}")).collect();
        let documents: Vec<SearchableDocument<'_>> = contents
            .iter()
            .enumerate()
            .map(|(index, content)| SearchableDocument {
                id: Box::leak(format!("doc_{index:02}").into_boxed_str()),
                label: "Doc",
                content,
            })
            .collect();
        let hits = search_trip_corpus("match", &documents, &[], &[]);
        assert_eq!(hits.len(), 20);
    }

    #[test]
    fn workspace_search_keeps_trip_and_record_provenance() {
        let records = [WorkspaceSearchRecord {
            source: WorkspaceSearchSource::SavedPlace,
            trip_id: "trip_kyoto",
            trip_title: "Kyoto spring",
            trip_status: TripStatus::Active,
            trip_updated_at: "2026-07-01T12:00:00Z",
            record_id: "place_1",
            label: "Philosopher's Path",
            text: "Walk early before the crowds",
        }];

        let hits = search_workspace_corpus("crowds", &records);

        assert_eq!(hits[0].trip_id, "trip_kyoto");
        assert_eq!(hits[0].source, WorkspaceSearchSource::SavedPlace);
        assert!(hits[0].snippet.contains("crowds"));
    }

    #[test]
    fn workspace_search_handles_lowercase_expansion_without_panicking() {
        let records = [WorkspaceSearchRecord {
            source: WorkspaceSearchSource::Note,
            trip_id: "trip_istanbul",
            trip_title: "Istanbul",
            trip_status: TripStatus::Draft,
            trip_updated_at: "2026-07-01T12:00:00Z",
            record_id: "note_1",
            label: "Trip notes",
            text: "İİx Unicode note",
        }];

        let hits = search_workspace_corpus("x", &records);

        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains('x'));
    }

    #[test]
    fn workspace_search_breaks_equal_scores_by_latest_trip_update() {
        let records = [
            WorkspaceSearchRecord {
                source: WorkspaceSearchSource::Note,
                trip_id: "trip_old",
                trip_title: "A title that would otherwise sort first",
                trip_status: TripStatus::Archived,
                trip_updated_at: "2026-01-01T00:00:00Z",
                record_id: "note_old",
                label: "Museum note",
                text: "museum",
            },
            WorkspaceSearchRecord {
                source: WorkspaceSearchSource::Note,
                trip_id: "trip_new",
                trip_title: "Z title",
                trip_status: TripStatus::Active,
                trip_updated_at: "2026-07-01T00:00:00Z",
                record_id: "note_new",
                label: "Museum note",
                text: "museum",
            },
        ];

        let hits = search_workspace_corpus("museum", &records);

        assert_eq!(hits[0].trip_id, "trip_new");
        assert_eq!(hits[1].trip_status, TripStatus::Archived);
    }
}
