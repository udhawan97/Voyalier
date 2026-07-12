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
/// Most typeahead term suggestions returned for one query.
pub const SEARCH_SUGGESTION_LIMIT: usize = 8;

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

/// Search documents and confirmed facts for a validated query. Relaxed: a record
/// matches if it contains ANY query word. Ranked by how many distinct query
/// words it covers, then by total occurrences, then stable by id.
pub fn search_trip_corpus(
    query: &str,
    documents: &[SearchableDocument<'_>],
    facts: &[ConfirmedFact],
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
                    record_id: fact.id.clone(),
                    label: fact_label(fact),
                    snippet,
                    score: occurrences,
                },
                matched,
            ));
        }
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

/// Typeahead term suggestions for the query's last word: distinct words from the
/// corpus (document text, fact field values, and fact labels) that contain it —
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
        consider(&fact_label(fact));
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
        let hits = search_trip_corpus("airport shuttle", &[both, one], &[]);
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
        let hits = search_trip_corpus("match", &documents, &[]);
        assert_eq!(hits.len(), 20);
    }
}
