//! Deterministic preview of the exact request Voyalier would send to an AI
//! provider — the consent step from ADR-0003. Before any cloud call is wired up,
//! the user can see precisely what would leave the device.
//!
//! The preview reuses the same generation-time exclusion as the shareable brief
//! ([`crate::brief`]): confirmation codes and traveler names are stripped from a
//! copy of the plan, so they never enter the preview and therefore could never
//! reach a provider. Only the traveler's own confirmed itinerary is grounded in
//! — never imported document text, which is untrusted. No network happens here;
//! nothing is transmitted.

use serde::{Deserialize, Serialize};

use crate::brief::{RedactionPolicy, TripBrief, build_trip_brief};
use crate::provider::{ProviderId, provider_info};
use crate::types::{ConfirmedFact, FactPayload, Trip};

/// The instruction sent with every assist request. Fixed and deterministic so a
/// user can review it once; it forbids inventing high-stakes facts, which
/// Voyalier only ever surfaces from cited sources.
pub const ASSIST_SYSTEM_PROMPT: &str = "You are a careful travel-planning assistant for Voyalier. \
Use only the trip details provided below. Do not invent flights, prices, visa or entry rules, \
health requirements, or safety guidance; if the trip details do not answer a question, say so.";

/// Where a provider's request would go — shown for transparency, never guessed
/// from user data.
fn endpoint_for(id: ProviderId) -> &'static str {
    match id {
        ProviderId::OpenAi => "https://api.openai.com/v1/chat/completions",
        ProviderId::Anthropic => "https://api.anthropic.com/v1/messages",
        ProviderId::Ollama => "http://localhost:11434/api/chat",
    }
}

/// A deterministic, redacted preview of the request Voyalier would send to a
/// provider. Built entirely on-device; nothing here is transmitted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequestPreview {
    pub provider: ProviderId,
    pub provider_label: String,
    /// The model that would be used, if the user has chosen one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Where the request would go — shown for transparency.
    pub endpoint: String,
    /// True when the request would leave this device (cloud providers); false
    /// for a local provider like Ollama.
    pub leaves_device: bool,
    /// The fixed system instruction.
    pub system_prompt: String,
    /// The exact user message: the traveler's own confirmed itinerary, redacted.
    pub user_content: String,
    /// Field kinds excluded from the request, for transparency.
    pub withheld: Vec<String>,
}

/// Build the preview for `provider`, grounded only in the trip's confirmed facts.
///
/// `model` is the user's chosen model, if any. `generated_at` is supplied by the
/// caller so this stays pure and testable.
pub fn build_assist_preview(
    trip: &Trip,
    facts: &[ConfirmedFact],
    provider: ProviderId,
    model: Option<&str>,
    generated_at: &str,
) -> AssistRequestPreview {
    // Reuse the brief's generation-time exclusion: secrets never enter the copy.
    let brief = build_trip_brief(trip, facts, &RedactionPolicy::for_sharing(), generated_at);

    let mut withheld = brief.redacted_fields.clone();
    // Only structured, confirmed facts are grounded in — never raw document text.
    withheld.push("Imported document text".to_owned());

    let info = provider_info(provider);
    AssistRequestPreview {
        provider,
        provider_label: info.label.to_owned(),
        model: model.map(str::to_owned),
        endpoint: endpoint_for(provider).to_owned(),
        leaves_device: !matches!(provider, ProviderId::Ollama),
        system_prompt: ASSIST_SYSTEM_PROMPT.to_owned(),
        user_content: format_itinerary(&brief),
        withheld,
    }
}

/// Render the redacted brief as the plain-text itinerary the model would receive.
fn format_itinerary(brief: &TripBrief) -> String {
    let mut out = String::new();
    out.push_str(&format!("Trip: {}\n", brief.title));
    out.push_str(&format!(
        "Route: {} to {}\n",
        brief.origin, brief.destination
    ));
    out.push_str(&format!(
        "Dates: {} to {}\n",
        brief.start_date, brief.end_date
    ));

    if !brief.flights.is_empty() {
        out.push_str("\nFlights:\n");
        for flight in &brief.flights {
            out.push_str(&format!("- {}\n", format_flight(flight)));
        }
    }
    if !brief.stays.is_empty() {
        out.push_str("\nStays:\n");
        for stay in &brief.stays {
            out.push_str(&format!("- {}\n", format_stay(stay)));
        }
    }
    out
}

fn format_flight(payload: &FactPayload) -> String {
    let mut parts: Vec<String> = Vec::new();
    let carrier: String = [
        payload.airline_name.as_deref(),
        payload.flight_number.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    if !carrier.is_empty() {
        parts.push(carrier);
    }
    if let (Some(from), Some(to)) = (
        payload.departure_airport_iata.as_deref(),
        payload.arrival_airport_iata.as_deref(),
    ) {
        parts.push(format!("{from} to {to}"));
    }
    if let Some(departs) = payload.departure_local.as_deref() {
        parts.push(format!("departs {departs}"));
    }
    parts.join(", ")
}

fn format_stay(payload: &FactPayload) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(name) = payload.property_name.as_deref() {
        parts.push(name.to_owned());
    }
    if let Some(address) = payload.address.as_deref() {
        parts.push(address.to_owned());
    }
    match (
        payload.checkin_date.as_deref(),
        payload.checkout_date.as_deref(),
    ) {
        (Some(checkin), Some(checkout)) => parts.push(format!("{checkin} to {checkout}")),
        (Some(checkin), None) => parts.push(format!("from {checkin}")),
        _ => {}
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactType, TripStatus};

    fn trip() -> Trip {
        Trip {
            id: "trip_1".to_owned(),
            title: "Kyoto autumn journey".to_owned(),
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: "2026-11-03".to_owned(),
            end_date: "2026-11-12".to_owned(),
            status: TripStatus::Active,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn flight() -> ConfirmedFact {
        ConfirmedFact {
            id: "f1".to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                airline_name: Some("Fictional Pacific".to_owned()),
                flight_number: Some("FP18".to_owned()),
                departure_airport_iata: Some("ORD".to_owned()),
                arrival_airport_iata: Some("HND".to_owned()),
                departure_local: Some("2026-11-03T12:40".to_owned()),
                confirmation_code: Some("SECRET-PNR-1".to_owned()),
                passenger_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn lodging() -> ConfirmedFact {
        ConfirmedFact {
            id: "l1".to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some("River Paper Inn".to_owned()),
                address: Some("7 Fictional Paper Street".to_owned()),
                checkin_date: Some("2026-11-04".to_owned()),
                checkout_date: Some("2026-11-12".to_owned()),
                confirmation_code: Some("SECRET-PNR-2".to_owned()),
                guest_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn preview_excludes_secrets_by_construction() {
        let preview = build_assist_preview(
            &trip(),
            &[flight(), lodging()],
            ProviderId::OpenAi,
            Some("gpt-x"),
            "2026-11-01T00:00:00Z",
        );
        let serialized = serde_json::to_string(&preview).expect("serialize");
        // The guarantee: redacted values never enter the request at all.
        assert!(!serialized.contains("SECRET-PNR-1"));
        assert!(!serialized.contains("SECRET-PNR-2"));
        assert!(!serialized.contains("Jamie Traveler"));
        // Non-sensitive itinerary detail is grounded in.
        assert!(preview.user_content.contains("FP18"));
        assert!(preview.user_content.contains("ORD to HND"));
        assert!(preview.user_content.contains("River Paper Inn"));
        // Transparency: what was withheld is listed.
        assert!(preview.withheld.contains(&"Confirmation codes".to_owned()));
        assert!(preview.withheld.contains(&"Traveler names".to_owned()));
        assert!(
            preview
                .withheld
                .contains(&"Imported document text".to_owned())
        );
    }

    #[test]
    fn cloud_preview_leaves_the_device() {
        let preview = build_assist_preview(
            &trip(),
            &[flight()],
            ProviderId::Anthropic,
            None,
            "2026-11-01T00:00:00Z",
        );
        assert!(preview.leaves_device);
        assert_eq!(preview.endpoint, "https://api.anthropic.com/v1/messages");
        assert_eq!(preview.provider_label, "Anthropic");
        assert!(preview.model.is_none());
        assert!(preview.system_prompt.contains("Do not invent"));
    }

    #[test]
    fn ollama_preview_stays_on_device() {
        let preview = build_assist_preview(
            &trip(),
            &[flight()],
            ProviderId::Ollama,
            Some("qwen3:4b"),
            "2026-11-01T00:00:00Z",
        );
        assert!(!preview.leaves_device);
        assert_eq!(preview.endpoint, "http://localhost:11434/api/chat");
        assert_eq!(preview.model.as_deref(), Some("qwen3:4b"));
    }
}
