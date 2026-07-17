//! Field-value suggestions for form entry, drawn only from local, already-known
//! data — never from an external geocoder or per-keystroke network call.
//!
//! This module is IO-free: it defines the suggestion types and the deterministic
//! ranking rule. Callers (the application layer) gather candidate values from
//! downloaded pack data and reviewed/confirmed facts, then rank them here.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// The most field suggestions ever returned, to keep the dropdown short and the
/// per-keystroke work bounded.
pub const FIELD_SUGGESTION_LIMIT: usize = 8;

/// Where a suggested value came from, so the UI can label it honestly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionSource {
    /// A pack catalog name (city/region).
    Catalog,
    /// A place name from a downloaded city pack (open place data).
    PackPlace,
    /// A value the user previously confirmed on a fact.
    ConfirmedFact,
    /// A value reused from another of the user's trips.
    TripHistory,
    /// A city from the bundled offline gazetteer (GeoNames).
    Gazetteer,
}

/// One suggested value for a form field, with its provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSuggestion {
    pub value: String,
    pub source: SuggestionSource,
    /// A short human note ("from a previous stay"), when useful.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl FieldSuggestion {
    pub fn new(value: impl Into<String>, source: SuggestionSource) -> Self {
        Self {
            value: value.into(),
            source,
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

/// Rank candidate values against a query, most useful first.
///
/// Case-insensitive: prefix matches come before mid-string matches; within each
/// group the caller's order (its source priority) is preserved. Blank values are
/// dropped, duplicates (by case-folded value) are removed keeping the first
/// occurrence, and the result is capped at [`FIELD_SUGGESTION_LIMIT`]. An empty
/// query returns the top candidates in caller order.
pub fn rank_field_suggestions(
    query: &str,
    candidates: Vec<FieldSuggestion>,
) -> Vec<FieldSuggestion> {
    let needle = query.trim().to_lowercase();
    let mut seen: HashSet<String> = HashSet::new();
    let mut prefix: Vec<FieldSuggestion> = Vec::new();
    let mut contains: Vec<FieldSuggestion> = Vec::new();

    for candidate in candidates {
        let trimmed = candidate.value.trim();
        if trimmed.is_empty() {
            continue;
        }
        let folded = trimmed.to_lowercase();
        if !seen.insert(folded.clone()) {
            continue;
        }
        // Normalize the stored value's surrounding whitespace, keep inner text.
        let candidate = FieldSuggestion {
            value: trimmed.to_owned(),
            ..candidate
        };
        if needle.is_empty() || folded.starts_with(&needle) {
            prefix.push(candidate);
        } else if folded.contains(&needle) {
            contains.push(candidate);
        }
    }

    prefix.extend(contains);
    prefix.truncate(FIELD_SUGGESTION_LIMIT);
    prefix
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<FieldSuggestion> {
        vec![
            FieldSuggestion::new("River Paper Inn", SuggestionSource::ConfirmedFact)
                .with_detail("from this trip"),
            FieldSuggestion::new("Riverside Hostel", SuggestionSource::PackPlace),
            FieldSuggestion::new("Grand Hotel", SuggestionSource::TripHistory),
        ]
    }

    #[test]
    fn prefix_matches_rank_before_substring_matches() {
        let ranked = rank_field_suggestions("river", sample());
        assert_eq!(ranked[0].value, "River Paper Inn");
        assert_eq!(ranked[1].value, "Riverside Hostel");
        assert_eq!(ranked.len(), 2); // "Grand Hotel" is filtered out
    }

    #[test]
    fn matching_is_case_insensitive_and_substring_aware() {
        let ranked = rank_field_suggestions("HOTEL", sample());
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].value, "Grand Hotel");
    }

    #[test]
    fn empty_query_keeps_caller_order_and_drops_blanks_and_dupes() {
        let mut candidates = sample();
        candidates.push(FieldSuggestion::new("   ", SuggestionSource::PackPlace));
        candidates.push(FieldSuggestion::new(
            "river paper inn",
            SuggestionSource::PackPlace,
        ));
        let ranked = rank_field_suggestions("", candidates);
        assert_eq!(ranked.len(), 3);
        assert_eq!(ranked[0].value, "River Paper Inn");
    }

    #[test]
    fn result_is_capped_at_the_limit() {
        let many: Vec<FieldSuggestion> = (0..20)
            .map(|n| FieldSuggestion::new(format!("Place {n}"), SuggestionSource::PackPlace))
            .collect();
        assert_eq!(
            rank_field_suggestions("place", many).len(),
            FIELD_SUGGESTION_LIMIT
        );
    }
}
