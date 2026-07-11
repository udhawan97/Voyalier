//! Deterministic, redaction-first assembly of a shareable trip brief.
//!
//! The brief is built by *excluding* sensitive fields from a copy of the plan
//! (generation-time exclusion), so redacted values never enter the brief
//! structure and therefore can never reach any downstream renderer. This is the
//! guarantee to make publicly: redacted data never enters the brief. It is the
//! opposite of drawing black boxes over a finished document, where the data is
//! merely hidden and remains recoverable.

use serde::{Deserialize, Serialize};

use crate::types::{ConfirmedFact, FactPayload, FactType, Trip};

/// Which sensitive fields to strip before sharing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionPolicy {
    pub redact_confirmation_codes: bool,
    pub redact_traveler_names: bool,
    pub redact_addresses: bool,
}

impl RedactionPolicy {
    /// The default sharing policy: hide confirmation codes and traveler names;
    /// keep property addresses (useful to a companion, not a secret).
    pub fn for_sharing() -> Self {
        Self {
            redact_confirmation_codes: true,
            redact_traveler_names: true,
            redact_addresses: false,
        }
    }

    /// No redaction — the traveler's own full copy.
    pub fn none() -> Self {
        Self {
            redact_confirmation_codes: false,
            redact_traveler_names: false,
            redact_addresses: false,
        }
    }

    fn redacted_field_labels(&self) -> Vec<String> {
        let mut labels = Vec::new();
        if self.redact_confirmation_codes {
            labels.push("Confirmation codes".to_owned());
        }
        if self.redact_traveler_names {
            labels.push("Traveler names".to_owned());
        }
        if self.redact_addresses {
            labels.push("Addresses".to_owned());
        }
        labels
    }
}

impl Default for RedactionPolicy {
    fn default() -> Self {
        Self::for_sharing()
    }
}

/// A shareable projection of a trip with sensitive fields excluded by construction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripBrief {
    pub title: String,
    pub origin: String,
    pub destination: String,
    pub start_date: String,
    pub end_date: String,
    pub flights: Vec<FactPayload>,
    pub stays: Vec<FactPayload>,
    /// Human-readable list of the field kinds removed from this brief, for
    /// transparency to whoever generated it.
    pub redacted_fields: Vec<String>,
    pub generated_at: String,
}

/// Build a shareable brief by excluding sensitive fields from a copy of the plan.
///
/// `generated_at` is supplied by the caller so this stays pure and testable.
pub fn build_trip_brief(
    trip: &Trip,
    facts: &[ConfirmedFact],
    policy: &RedactionPolicy,
    generated_at: &str,
) -> TripBrief {
    let mut flights: Vec<(String, FactPayload)> = Vec::new();
    let mut stays: Vec<(String, FactPayload)> = Vec::new();
    for fact in facts {
        let payload = redact_payload(&fact.payload, policy);
        match fact.fact_type {
            FactType::FlightSegment => {
                let key = payload.departure_local.clone().unwrap_or_default();
                flights.push((key, payload));
            }
            FactType::LodgingStay => {
                let key = payload.checkin_date.clone().unwrap_or_default();
                stays.push((key, payload));
            }
        }
    }
    flights.sort_by(|left, right| left.0.cmp(&right.0));
    stays.sort_by(|left, right| left.0.cmp(&right.0));

    TripBrief {
        title: trip.title.clone(),
        origin: trip.origin.clone(),
        destination: trip.destination.clone(),
        start_date: trip.start_date.clone(),
        end_date: trip.end_date.clone(),
        flights: flights.into_iter().map(|(_, payload)| payload).collect(),
        stays: stays.into_iter().map(|(_, payload)| payload).collect(),
        redacted_fields: policy.redacted_field_labels(),
        generated_at: generated_at.to_owned(),
    }
}

fn redact_payload(payload: &FactPayload, policy: &RedactionPolicy) -> FactPayload {
    let mut redacted = payload.clone();
    if policy.redact_confirmation_codes {
        redacted.confirmation_code = None;
    }
    if policy.redact_traveler_names {
        redacted.passenger_name = None;
        redacted.guest_name = None;
    }
    if policy.redact_addresses {
        redacted.address = None;
    }
    redacted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, TripStatus};

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
    fn sharing_brief_excludes_secrets_by_construction() {
        let brief = build_trip_brief(
            &trip(),
            &[flight(), lodging()],
            &RedactionPolicy::for_sharing(),
            "2026-11-01T00:00:00Z",
        );
        let serialized = serde_json::to_string(&brief).expect("serialize");
        // The guarantee: redacted values are absent from the brief entirely.
        assert!(!serialized.contains("SECRET-PNR-1"));
        assert!(!serialized.contains("SECRET-PNR-2"));
        assert!(!serialized.contains("Jamie Traveler"));
        // Non-sensitive itinerary detail survives.
        assert!(serialized.contains("FP18"));
        assert!(serialized.contains("River Paper Inn"));
        assert_eq!(brief.flights.len(), 1);
        assert_eq!(brief.stays.len(), 1);
        assert!(brief.flights[0].confirmation_code.is_none());
        assert!(brief.flights[0].passenger_name.is_none());
        assert!(brief.stays[0].guest_name.is_none());
        // Address is kept under the default sharing policy.
        assert_eq!(
            brief.stays[0].address.as_deref(),
            Some("7 Fictional Paper Street")
        );
        assert!(
            brief
                .redacted_fields
                .contains(&"Confirmation codes".to_owned())
        );
    }

    #[test]
    fn none_policy_keeps_the_full_copy() {
        let brief = build_trip_brief(
            &trip(),
            &[flight()],
            &RedactionPolicy::none(),
            "2026-11-01T00:00:00Z",
        );
        assert_eq!(
            brief.flights[0].confirmation_code.as_deref(),
            Some("SECRET-PNR-1")
        );
        assert!(brief.redacted_fields.is_empty());
    }

    #[test]
    fn flights_are_sorted_by_departure() {
        let mut early = flight();
        early.id = "early".to_owned();
        early.payload.departure_local = Some("2026-11-03T08:00".to_owned());
        let mut late = flight();
        late.id = "late".to_owned();
        late.payload.departure_local = Some("2026-11-05T20:00".to_owned());

        let brief = build_trip_brief(
            &trip(),
            &[late, early],
            &RedactionPolicy::none(),
            "2026-11-01T00:00:00Z",
        );
        assert_eq!(
            brief.flights[0].departure_local.as_deref(),
            Some("2026-11-03T08:00")
        );
        assert_eq!(
            brief.flights[1].departure_local.as_deref(),
            Some("2026-11-05T20:00")
        );
    }
}
