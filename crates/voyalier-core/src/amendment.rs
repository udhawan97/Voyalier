//! Conservative repeat-import classification.
//!
//! A false negative creates one extra review card. A false positive could put
//! an approved record on a replacement path, so every identifier and context
//! component below is required and exact after whitespace/case normalization.

use crate::{ConfirmedFact, FactPayload, FactType};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AmendmentMatch {
    Ordinary,
    Duplicate { fact_id: String },
    Amendment { fact_id: String },
}

fn normalized(value: Option<&String>) -> Option<String> {
    value
        .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|value| !value.is_empty())
        .map(|value| value.to_uppercase())
}

fn same_required(left: Option<&String>, right: Option<&String>) -> bool {
    matches!((normalized(left), normalized(right)), (Some(left), Some(right)) if left == right)
}

fn conservative_context(fact_type: FactType, left: &FactPayload, right: &FactPayload) -> bool {
    match fact_type {
        FactType::FlightSegment => {
            let same_operator = match (
                normalized(left.airline_iata.as_ref()),
                normalized(right.airline_iata.as_ref()),
            ) {
                (Some(left), Some(right)) => left == right,
                _ => same_required(left.airline_name.as_ref(), right.airline_name.as_ref()),
            };
            same_operator
                && same_required(
                    left.departure_airport_iata.as_ref(),
                    right.departure_airport_iata.as_ref(),
                )
                && same_required(
                    left.arrival_airport_iata.as_ref(),
                    right.arrival_airport_iata.as_ref(),
                )
        }
        FactType::LodgingStay => {
            same_required(left.property_name.as_ref(), right.property_name.as_ref())
        }
        FactType::RailJourney | FactType::CoachJourney | FactType::FerryCrossing => {
            same_required(left.carrier_name.as_ref(), right.carrier_name.as_ref())
                && same_required(
                    left.departure_place.as_ref(),
                    right.departure_place.as_ref(),
                )
                && same_required(left.arrival_place.as_ref(), right.arrival_place.as_ref())
        }
        FactType::CarRental => {
            same_required(left.carrier_name.as_ref(), right.carrier_name.as_ref())
                && same_required(
                    left.departure_place.as_ref(),
                    right.departure_place.as_ref(),
                )
                && same_required(left.arrival_place.as_ref(), right.arrival_place.as_ref())
        }
    }
}

pub fn classify_amendment(
    fact_type: FactType,
    payload: &FactPayload,
    active_facts: &[ConfirmedFact],
) -> AmendmentMatch {
    let Some(code) = normalized(payload.confirmation_code.as_ref()) else {
        return AmendmentMatch::Ordinary;
    };
    let matches = active_facts
        .iter()
        .filter(|fact| fact.fact_type == fact_type)
        .filter(|fact| normalized(fact.payload.confirmation_code.as_ref()).as_ref() == Some(&code))
        .filter(|fact| conservative_context(fact_type, payload, &fact.payload))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return AmendmentMatch::Ordinary;
    }
    let existing = matches[0];
    if existing.payload == *payload {
        AmendmentMatch::Duplicate {
            fact_id: existing.id.clone(),
        }
    } else {
        AmendmentMatch::Amendment {
            fact_id: existing.id.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ExtractionMethod;

    fn fact(id: &str, payload: FactPayload) -> ConfirmedFact {
        ConfirmedFact {
            id: id.into(),
            trip_id: "trip_1".into(),
            fact_type: FactType::FlightSegment,
            payload,
            method: ExtractionMethod::Structured,
            candidate_id: None,
            corrected_fields: vec![],
            confirmed_at: "2026-01-01T00:00:00Z".into(),
            source_removed: false,
        }
    }

    fn flight(arrival: &str) -> FactPayload {
        FactPayload {
            airline_iata: Some("BA".into()),
            departure_airport_iata: Some("ORD".into()),
            arrival_airport_iata: Some("LHR".into()),
            arrival_local: Some(arrival.into()),
            confirmation_code: Some(" ABC 123 ".into()),
            ..FactPayload::default()
        }
    }

    #[test]
    fn exact_match_is_duplicate_and_changed_match_is_amendment() {
        let existing = fact("fact_1", flight("2026-06-02T08:00"));
        assert_eq!(
            classify_amendment(
                FactType::FlightSegment,
                &flight("2026-06-02T08:00"),
                std::slice::from_ref(&existing)
            ),
            AmendmentMatch::Duplicate {
                fact_id: "fact_1".into()
            }
        );
        assert_eq!(
            classify_amendment(
                FactType::FlightSegment,
                &flight("2026-06-02T09:00"),
                &[existing]
            ),
            AmendmentMatch::Amendment {
                fact_id: "fact_1".into()
            }
        );
    }

    #[test]
    fn missing_context_or_multiple_matches_stays_ordinary() {
        let existing = fact("fact_1", flight("2026-06-02T08:00"));
        let mut missing = flight("2026-06-02T09:00");
        missing.departure_airport_iata = None;
        assert_eq!(
            classify_amendment(
                FactType::FlightSegment,
                &missing,
                std::slice::from_ref(&existing),
            ),
            AmendmentMatch::Ordinary
        );
        assert_eq!(
            classify_amendment(
                FactType::FlightSegment,
                &flight("2026-06-02T09:00"),
                &[existing.clone(), existing]
            ),
            AmendmentMatch::Ordinary
        );
    }
}
