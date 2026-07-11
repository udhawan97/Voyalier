//! Deterministic search over a trip's own corpus (source documents and
//! confirmed facts), with provenance on every hit.
//!
//! A trip's corpus is tiny (a handful of documents, dozens of facts), so this
//! is a plain in-process scan with transparent scoring — no index, no
//! dependencies, identical results on every platform. FTS5 or embeddings can
//! replace the internals later without changing the contract. Queries and
//! document text are untrusted data; matching is purely lexical.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ConfirmedFact, ErrorCode, FactType};

pub const MAX_QUERY_LEN: usize = 200;
const MAX_HITS: usize = 20;
const SNIPPET_CONTEXT_CHARS: usize = 60;

/// Where a search hit came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchHitSource {
    Document,
    ConfirmedFact,
}

/// One ranked hit with enough provenance to open the underlying record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub source: SearchHitSource,
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

/// Search documents and confirmed facts for a validated query. Results are
/// ranked by occurrence count, then stable by kind and id.
pub fn search_trip_corpus(
    query: &str,
    documents: &[SearchableDocument<'_>],
    facts: &[ConfirmedFact],
) -> Vec<SearchHit> {
    let needle = query.to_lowercase();
    let mut hits: Vec<SearchHit> = Vec::new();

    for document in documents {
        let haystack = document.content.to_lowercase();
        let count = count_occurrences(&haystack, &needle);
        if count == 0 {
            continue;
        }
        let snippet = snippet_around_first_match(document.content, &haystack, &needle);
        hits.push(SearchHit {
            source: SearchHitSource::Document,
            record_id: document.id.to_owned(),
            label: document.label.to_owned(),
            snippet,
            score: count,
        });
    }

    for fact in facts {
        let mut best: Option<(u32, String)> = None;
        for value in fact_field_values(fact) {
            let haystack = value.to_lowercase();
            let count = count_occurrences(&haystack, &needle);
            if count > 0 && best.as_ref().is_none_or(|(prev, _)| count > *prev) {
                best = Some((count, value.to_owned()));
            }
        }
        if let Some((score, snippet)) = best {
            hits.push(SearchHit {
                source: SearchHitSource::ConfirmedFact,
                record_id: fact.id.clone(),
                label: fact_label(fact),
                snippet,
                score,
            });
        }
    }

    hits.sort_by(|left, right| {
        right
            .score
            .cmp(&left.score)
            .then_with(|| left.record_id.cmp(&right.record_id))
    });
    hits.truncate(MAX_HITS);
    hits
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
fn snippet_around_first_match(original: &str, lowered: &str, needle: &str) -> String {
    let Some(byte_start) = lowered.find(needle) else {
        return String::new();
    };
    // Work in char space so multibyte text never splits.
    let prefix_chars = original[..byte_start].chars().count();
    let needle_chars = needle.chars().count();
    let chars: Vec<char> = original.chars().collect();

    let start = prefix_chars.saturating_sub(SNIPPET_CONTEXT_CHARS);
    let end = (prefix_chars + needle_chars + SNIPPET_CONTEXT_CHARS).min(chars.len());

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
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactPayload};

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
        }
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
        let hits = search_trip_corpus("shuttle", &documents, &[]);
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
        let hits = search_trip_corpus("inn", &documents, &facts);
        assert_eq!(hits.len(), 2);
        // Document has three occurrences, fact one — document ranks first.
        assert_eq!(hits[0].record_id, "doc_1");
        assert_eq!(hits[0].score, 3);
        assert_eq!(hits[1].source, SearchHitSource::ConfirmedFact);
        assert_eq!(hits[1].label, "River Paper Inn");
    }

    #[test]
    fn no_matches_yields_empty_not_error() {
        let hits = search_trip_corpus("zeppelin", &[], &[]);
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
        let hits = search_trip_corpus("京都", &documents, &[]);
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains("京都"));
        assert!(hits[0].snippet.starts_with('…') && hits[0].snippet.ends_with('…'));
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
        let hits = search_trip_corpus("match", &documents, &[]);
        assert_eq!(hits.len(), 20);
    }
}
