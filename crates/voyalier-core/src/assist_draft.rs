//! On-device AI draft: propose lodging check-in/check-out dates from a trip's
//! own imported text, as *reviewable candidates*.
//!
//! This is the one place Voyalier feeds imported document text to a model, and
//! it is deliberately fenced in: the runtime is on-device (Ollama) only, the
//! output is a strict, closed JSON shape (so the model cannot smuggle prices,
//! visa/entry, health, or safety claims), every proposal is sanitized here, and
//! whatever survives becomes a *pending* candidate the user accepts, edits, or
//! rejects — never a confirmed fact. This module is IO-free: it builds the
//! prompt and validates the reply; the application layer does the I/O.

use serde::{Deserialize, Serialize};

use crate::assist::{AssistRequestPreview, estimate_tokens};
use crate::provider::{ProviderId, provider_info};
use crate::types::{AppError, CandidateFact, ErrorCode, Trip};

/// The only draft kind today: fill missing lodging dates from imported text.
pub const ASSIST_DRAFT_LODGING_DATES: &str = "lodging_dates";

/// Fixed instruction for the lodging-dates draft. It pins the output shape and
/// forbids inventing anything beyond dates and a name copied from the text.
pub const DRAFT_LODGING_DATES_SYSTEM_PROMPT: &str = "You extract lodging check-in and check-out dates from a traveler's own booking text. \
Reply with ONLY a JSON object of exactly this shape and no other keys: \
{\"stays\":[{\"propertyName\":\"<name from the text>\",\"checkinDate\":\"YYYY-MM-DD\",\"checkoutDate\":\"YYYY-MM-DD\"}]}. \
Use only dates that appear in, or are directly stated by, the text. If a date is not in the text, omit that field. \
Copy property names verbatim from the text; do not invent them. \
Never include prices, room types, cancellation terms, confirmation codes, guest names, or visa, entry, health, or safety information. \
If the text contains no lodging dates, reply with {\"stays\":[]}.";

/// Most proposals accepted from one reply, to bound review work.
pub const MAX_DRAFT_STAYS: usize = 8;
/// Character cap for a copied property name.
pub const MAX_DRAFT_NAME_LEN: usize = 120;
/// Character cap for the assembled document text sent to the model.
pub const MAX_DRAFT_INPUT_CHARS: usize = 12_000;

/// One sanitized lodging-date proposal from the model. Only dates and a copied
/// name can ever be present — the closed input schema guarantees nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LodgingDateProposal {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkin_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout_date: Option<String>,
}

/// The candidates a draft run produced, for review. Pending candidates — never
/// confirmed facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistDraftResult {
    pub candidates: Vec<CandidateFact>,
}

/// The model's reply shape. `deny_unknown_fields` at both levels is the schema
/// gate: any extra key (a smuggled price, visa note, etc.) fails the whole parse.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawProposal {
    #[serde(default)]
    property_name: Option<String>,
    #[serde(default)]
    checkin_date: Option<String>,
    #[serde(default)]
    checkout_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RawReply {
    #[serde(default)]
    stays: Vec<RawProposal>,
}

fn assist_failed() -> AppError {
    AppError::new(
        ErrorCode::AssistFailed,
        "the on-device model's reply didn't match the expected format, so nothing was saved",
    )
}

/// True for a well-formed calendar date "YYYY-MM-DD" (month 1–12, day 1–31).
/// A structural check — enough to keep a malformed date out of a stored fact.
pub fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| bytes[range].iter().all(u8::is_ascii_digit);
    if !(digits(0..4) && digits(5..7) && digits(8..10)) {
        return false;
    }
    let month: u32 = value[5..7].parse().unwrap_or(0);
    let day: u32 = value[8..10].parse().unwrap_or(0);
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

/// Build the on-device draft request preview from a trip and its document texts.
///
/// Ollama-only, so it never leaves the device and withholds nothing (the text is
/// the traveler's own imported content). `system_prompt` is the effective
/// instruction — the default above or the user's override.
///
/// This lives beside the prompt it previews so the consent step and the request
/// that is actually sent are built from one description of the call.
pub fn build_draft_preview(
    trip: &Trip,
    documents: &[(String, String)],
    model: Option<&str>,
    system_prompt: &str,
) -> AssistRequestPreview {
    let system_prompt = system_prompt.to_owned();
    let user_content =
        build_lodging_dates_user_content(&trip.start_date, &trip.end_date, documents);
    let estimated_tokens = estimate_tokens(&system_prompt, &user_content);
    let grounded_in = if documents.is_empty() {
        vec!["no imported documents yet".to_owned()]
    } else {
        let noun = if documents.len() == 1 {
            "document"
        } else {
            "documents"
        };
        vec![
            format!("{} imported {noun}", documents.len()),
            "trip dates".to_owned(),
        ]
    };
    AssistRequestPreview {
        provider: ProviderId::Ollama,
        provider_label: provider_info(ProviderId::Ollama).label.to_owned(),
        model: model.map(str::to_owned),
        endpoint: crate::assist::endpoint_for(ProviderId::Ollama).to_owned(),
        leaves_device: false,
        system_prompt,
        user_content,
        withheld: Vec::new(),
        grounded_in,
        estimated_tokens,
    }
}

/// Assemble the user message: the trip window plus the imported documents' text,
/// labeled, and truncated to [`MAX_DRAFT_INPUT_CHARS`]. Grounds the model in the
/// traveler's own text; contains no data the user did not already import.
pub fn build_lodging_dates_user_content(
    start_date: &str,
    end_date: &str,
    documents: &[(String, String)],
) -> String {
    let mut out = String::new();
    out.push_str(&format!("Trip dates: {start_date} to {end_date}\n\n"));
    out.push_str("Imported booking text:\n");
    for (label, text) in documents {
        out.push_str(&format!("--- {label} ---\n{}\n", text.trim()));
    }
    if out.chars().count() > MAX_DRAFT_INPUT_CHARS {
        out = out.chars().take(MAX_DRAFT_INPUT_CHARS).collect();
        out.push_str("\n[text truncated]");
    }
    out
}

/// Slice out the first top-level JSON object from a reply, tolerating a Markdown
/// code fence or surrounding prose. Returns `None` if there is no `{...}` span.
fn extract_json_object(body: &str) -> Option<&str> {
    let start = body.find('{')?;
    let end = body.rfind('}')?;
    if end > start {
        Some(&body[start..=end])
    } else {
        None
    }
}

/// Strictly parse and sanitize the model's reply into usable proposals.
///
/// The reply must be the documented closed shape (a code-fence or surrounding
/// prose is tolerated, but any unexpected JSON key is not). Within a valid reply
/// each proposal is sanitized: malformed dates are dropped, an inverted range
/// (`checkin` after `checkout`) is dropped, names are trimmed and length-capped,
/// and a proposal left with no usable date is discarded. A body that is not the
/// documented shape is an [`ErrorCode::AssistFailed`]; a valid reply with nothing
/// usable yields an empty vec (the caller shows "no dates found").
pub fn parse_lodging_dates_reply(body: &str) -> Result<Vec<LodgingDateProposal>, AppError> {
    let json = extract_json_object(body).ok_or_else(assist_failed)?;
    let reply: RawReply = serde_json::from_str(json).map_err(|_| assist_failed())?;

    let mut proposals = Vec::new();
    for raw in reply.stays.into_iter().take(MAX_DRAFT_STAYS) {
        let checkin = raw.checkin_date.filter(|date| is_iso_date(date));
        let checkout = raw.checkout_date.filter(|date| is_iso_date(date));
        // Drop an inverted range outright — both dates become unusable.
        let (checkin, checkout) = match (checkin, checkout) {
            (Some(ci), Some(co)) if ci > co => (None, None),
            pair => pair,
        };
        if checkin.is_none() && checkout.is_none() {
            continue; // no usable date → nothing worth proposing
        }
        let property_name = raw
            .property_name
            .map(|name| {
                name.trim()
                    .chars()
                    .take(MAX_DRAFT_NAME_LEN)
                    .collect::<String>()
            })
            .filter(|name| !name.is_empty());
        proposals.push(LodgingDateProposal {
            property_name,
            checkin_date: checkin,
            checkout_date: checkout,
        });
    }
    Ok(proposals)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_iso_dates_and_rejects_malformed_ones() {
        assert!(is_iso_date("2026-11-04"));
        assert!(!is_iso_date("2026-13-04")); // month
        assert!(!is_iso_date("2026-11-40")); // day
        assert!(!is_iso_date("11/04/2026"));
        assert!(!is_iso_date("2026-11-4"));
    }

    #[test]
    fn parses_a_clean_reply_and_keeps_only_valid_dates() {
        let body = r#"Sure! ```json
        {"stays":[
          {"propertyName":"River Paper Inn","checkinDate":"2026-11-04","checkoutDate":"2026-11-12"}
        ]}
        ``` hope that helps"#;
        let proposals = parse_lodging_dates_reply(body).expect("parse");
        assert_eq!(proposals.len(), 1);
        assert_eq!(
            proposals[0].property_name.as_deref(),
            Some("River Paper Inn")
        );
        assert_eq!(proposals[0].checkin_date.as_deref(), Some("2026-11-04"));
        assert_eq!(proposals[0].checkout_date.as_deref(), Some("2026-11-12"));
    }

    #[test]
    fn drops_invalid_dates_inverted_ranges_and_dateless_proposals() {
        let body = r#"{"stays":[
          {"propertyName":"Bad Date Inn","checkinDate":"not-a-date","checkoutDate":"2026-11-12"},
          {"propertyName":"Inverted Inn","checkinDate":"2026-11-12","checkoutDate":"2026-11-04"},
          {"propertyName":"No Dates Inn"}
        ]}"#;
        let proposals = parse_lodging_dates_reply(body).expect("parse");
        // Only the first survives, with the bad checkin dropped but checkout kept.
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].property_name.as_deref(), Some("Bad Date Inn"));
        assert!(proposals[0].checkin_date.is_none());
        assert_eq!(proposals[0].checkout_date.as_deref(), Some("2026-11-12"));
    }

    #[test]
    fn rejects_non_json_and_smuggled_extra_fields() {
        // Not JSON at all.
        assert_eq!(
            parse_lodging_dates_reply("I couldn't find any dates.")
                .expect_err("prose")
                .code,
            ErrorCode::AssistFailed
        );
        // A well-formed-looking object that smuggles an extra claim fails the
        // closed schema — nothing is salvaged.
        let smuggled =
            r#"{"stays":[{"propertyName":"X","checkinDate":"2026-11-04","price":"$200"}]}"#;
        assert_eq!(
            parse_lodging_dates_reply(smuggled)
                .expect_err("extra key")
                .code,
            ErrorCode::AssistFailed
        );
    }

    #[test]
    fn empty_stays_is_a_valid_no_op() {
        assert!(
            parse_lodging_dates_reply(r#"{"stays":[]}"#)
                .expect("parse")
                .is_empty()
        );
    }

    #[test]
    fn caps_the_number_of_proposals() {
        let inner = (0..20)
            .map(|n| format!(r#"{{"propertyName":"Inn {n}","checkinDate":"2026-11-04"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        let body = format!(r#"{{"stays":[{inner}]}}"#);
        assert_eq!(
            parse_lodging_dates_reply(&body).expect("parse").len(),
            MAX_DRAFT_STAYS
        );
    }

    #[test]
    fn user_content_carries_window_and_labeled_text() {
        let content = build_lodging_dates_user_content(
            "2026-11-03",
            "2026-11-12",
            &[("Hotel email".to_owned(), "Check in Nov 4".to_owned())],
        );
        assert!(content.contains("Trip dates: 2026-11-03 to 2026-11-12"));
        assert!(content.contains("--- Hotel email ---"));
        assert!(content.contains("Check in Nov 4"));
    }
}
