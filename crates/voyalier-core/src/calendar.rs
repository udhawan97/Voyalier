//! A redacted, repeatable calendar snapshot over local itinerary records.
//! Identity and revision are supplied by the app layer; this module owns event
//! roles, omissions, ordering, and the rule that recorded wall clocks stay
//! floating rather than acquiring an invented timezone.

use jiff::civil::{Date, DateTime};
use serde::{Deserialize, Serialize};

use crate::{ConfirmedFact, FactType, Trip, TripItem, TripItemKind};
use crate::{TodayItemKind, TodayItemTargetSource};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarRole {
    Departure,
    Arrival,
    Checkin,
    Checkout,
    Plan,
}

impl CalendarRole {
    fn wire(self) -> &'static str {
        match self {
            Self::Departure => "departure",
            Self::Arrival => "arrival",
            Self::Checkin => "checkin",
            Self::Checkout => "checkout",
            Self::Plan => "plan",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItineraryIdentity {
    pub source: TodayItemTargetSource,
    pub source_id: String,
    pub calendar_lineage: String,
    pub ui_locator: String,
    pub revision: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub uid: String,
    pub sequence: u32,
    pub dtstamp: String,
    pub role: CalendarRole,
    pub kind: TodayItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub detail: String,
    pub start: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end: Option<String>,
    pub all_day: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarOmission {
    pub source: TodayItemTargetSource,
    pub role: CalendarRole,
    pub title: String,
    pub reason: CalendarOmissionReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalendarOmissionReason {
    MissingDate,
    InvalidDate,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSnapshot {
    pub title: String,
    pub events: Vec<CalendarEvent>,
    pub omissions: Vec<CalendarOmission>,
    /// Roles removed by a later fact version. Populated once amendment history
    /// exists; a downloaded file cannot remove an already imported event.
    pub removals: Vec<String>,
}

fn identity<'a>(
    identities: &'a [ItineraryIdentity],
    source: TodayItemTargetSource,
    source_id: &str,
) -> Option<&'a ItineraryIdentity> {
    identities
        .iter()
        .find(|identity| identity.source == source && identity.source_id == source_id)
}

fn valid_value(value: &str, all_day: bool) -> bool {
    if all_day {
        value.parse::<Date>().is_ok()
    } else {
        value.parse::<DateTime>().is_ok()
    }
}

fn subject(fact: &ConfirmedFact) -> Option<String> {
    let payload = &fact.payload;
    let values = match fact.fact_type {
        FactType::FlightSegment => [
            payload.airline_name.as_deref(),
            payload.flight_number.as_deref(),
        ],
        FactType::LodgingStay => [payload.property_name.as_deref(), None],
        _ => [
            payload.carrier_name.as_deref(),
            payload.service_number.as_deref(),
        ],
    };
    let text = values.into_iter().flatten().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

fn detail(fact: &ConfirmedFact) -> String {
    let payload = &fact.payload;
    match fact.fact_type {
        FactType::FlightSegment => match (
            payload.departure_airport_iata.as_deref(),
            payload.arrival_airport_iata.as_deref(),
        ) {
            (Some(from), Some(to)) => format!("{from} → {to}"),
            _ => String::new(),
        },
        FactType::LodgingStay => payload.address.clone().unwrap_or_default(),
        _ => match (
            payload.departure_place.as_deref(),
            payload.arrival_place.as_deref(),
        ) {
            (Some(from), Some(to)) => format!("{from} → {to}"),
            _ => String::new(),
        },
    }
}

struct EventSpec<'a> {
    role: CalendarRole,
    kind: TodayItemKind,
    title: &'a str,
    start: Option<&'a str>,
    end: Option<&'a str>,
    all_day: bool,
}

fn add_fact_event(
    events: &mut Vec<CalendarEvent>,
    omissions: &mut Vec<CalendarOmission>,
    fact: &ConfirmedFact,
    identities: &[ItineraryIdentity],
    spec: EventSpec<'_>,
) {
    let Some(start) = spec.start else {
        omissions.push(CalendarOmission {
            source: TodayItemTargetSource::ConfirmedFact,
            role: spec.role,
            title: spec.title.to_owned(),
            reason: CalendarOmissionReason::MissingDate,
        });
        return;
    };
    if !valid_value(start, spec.all_day) {
        omissions.push(CalendarOmission {
            source: TodayItemTargetSource::ConfirmedFact,
            role: spec.role,
            title: spec.title.to_owned(),
            reason: CalendarOmissionReason::InvalidDate,
        });
        return;
    }
    let stored = identity(identities, TodayItemTargetSource::ConfirmedFact, &fact.id);
    let lineage = stored
        .map(|identity| identity.calendar_lineage.as_str())
        .unwrap_or(&fact.id);
    events.push(CalendarEvent {
        uid: format!("{lineage}:{}@voyalier.local", spec.role.wire()),
        sequence: stored.map_or(0, |identity| identity.revision),
        dtstamp: fact.confirmed_at.clone(),
        role: spec.role,
        kind: spec.kind,
        subject: subject(fact),
        title: spec.title.to_owned(),
        detail: detail(fact),
        start: start.to_owned(),
        end: spec
            .end
            .filter(|end| valid_value(end, spec.all_day))
            .map(str::to_owned),
        all_day: spec.all_day,
    });
}

/// Build a redacted calendar snapshot. The returned type cannot name codes,
/// traveler names, document text, plan notes, resources, or provider output.
pub fn build_calendar_snapshot(
    trip: &Trip,
    facts: &[ConfirmedFact],
    trip_items: &[TripItem],
    identities: &[ItineraryIdentity],
) -> CalendarSnapshot {
    let mut events = Vec::new();
    let mut omissions = Vec::new();
    for fact in facts {
        let payload = &fact.payload;
        match fact.fact_type {
            FactType::FlightSegment => {
                add_fact_event(
                    &mut events,
                    &mut omissions,
                    fact,
                    identities,
                    EventSpec {
                        role: CalendarRole::Departure,
                        kind: TodayItemKind::FlightDeparture,
                        title: "Departure",
                        start: payload.departure_local.as_deref(),
                        end: None,
                        all_day: false,
                    },
                );
                add_fact_event(
                    &mut events,
                    &mut omissions,
                    fact,
                    identities,
                    EventSpec {
                        role: CalendarRole::Arrival,
                        kind: TodayItemKind::FlightArrival,
                        title: "Arrival",
                        start: payload.arrival_local.as_deref(),
                        end: None,
                        all_day: false,
                    },
                );
            }
            FactType::LodgingStay => {
                add_fact_event(
                    &mut events,
                    &mut omissions,
                    fact,
                    identities,
                    EventSpec {
                        role: CalendarRole::Checkin,
                        kind: TodayItemKind::Checkin,
                        title: "Check in",
                        start: payload.checkin_date.as_deref(),
                        end: None,
                        all_day: true,
                    },
                );
                add_fact_event(
                    &mut events,
                    &mut omissions,
                    fact,
                    identities,
                    EventSpec {
                        role: CalendarRole::Checkout,
                        kind: TodayItemKind::Checkout,
                        title: "Check out",
                        start: payload.checkout_date.as_deref(),
                        end: None,
                        all_day: true,
                    },
                );
            }
            FactType::RailJourney
            | FactType::CoachJourney
            | FactType::FerryCrossing
            | FactType::CarRental => {
                add_fact_event(
                    &mut events,
                    &mut omissions,
                    fact,
                    identities,
                    EventSpec {
                        role: CalendarRole::Departure,
                        kind: TodayItemKind::JourneyDeparture,
                        title: "Departure",
                        start: payload.departure_local.as_deref(),
                        end: None,
                        all_day: false,
                    },
                );
                add_fact_event(
                    &mut events,
                    &mut omissions,
                    fact,
                    identities,
                    EventSpec {
                        role: CalendarRole::Arrival,
                        kind: TodayItemKind::JourneyArrival,
                        title: "Arrival",
                        start: payload.arrival_local.as_deref(),
                        end: None,
                        all_day: false,
                    },
                );
            }
        }
    }
    for item in trip_items {
        let Some(start) = item.start_at.as_deref() else {
            omissions.push(CalendarOmission {
                source: TodayItemTargetSource::TripItem,
                role: CalendarRole::Plan,
                title: item.title.clone(),
                reason: CalendarOmissionReason::MissingDate,
            });
            continue;
        };
        if !valid_value(start, false) {
            omissions.push(CalendarOmission {
                source: TodayItemTargetSource::TripItem,
                role: CalendarRole::Plan,
                title: item.title.clone(),
                reason: CalendarOmissionReason::InvalidDate,
            });
            continue;
        }
        let stored = identity(identities, TodayItemTargetSource::TripItem, &item.id);
        let lineage = stored
            .map(|identity| identity.calendar_lineage.as_str())
            .unwrap_or(&item.id);
        events.push(CalendarEvent {
            uid: format!("{lineage}:plan@voyalier.local"),
            sequence: stored.map_or(0, |identity| identity.revision),
            dtstamp: item.updated_at.clone(),
            role: CalendarRole::Plan,
            kind: match item.kind {
                TripItemKind::Activity => TodayItemKind::Activity,
                TripItemKind::Rail => TodayItemKind::Rail,
                TripItemKind::Transfer => TodayItemKind::Transfer,
            },
            subject: None,
            title: item.title.clone(),
            detail: item.location.clone().unwrap_or_default(),
            start: start.to_owned(),
            end: item
                .end_at
                .as_deref()
                .filter(|end| valid_value(end, false))
                .map(str::to_owned),
            all_day: false,
        });
    }
    events.sort_by(|left, right| {
        left.start
            .cmp(&right.start)
            .then_with(|| left.role.wire().cmp(right.role.wire()))
            .then_with(|| left.uid.cmp(&right.uid))
    });
    omissions.sort_by(|left, right| {
        left.title
            .cmp(&right.title)
            .then_with(|| left.role.wire().cmp(right.role.wire()))
    });
    CalendarSnapshot {
        title: trip.title.clone(),
        events,
        omissions,
        removals: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ExtractionMethod, FactPayload, TripStatus};

    fn trip() -> Trip {
        Trip {
            id: "trip".into(),
            title: "Kyoto".into(),
            origin: "A".into(),
            destination: "B".into(),
            start_date: "2026-11-01".into(),
            end_date: "2026-11-10".into(),
            status: TripStatus::Active,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn journey(id: &str) -> ConfirmedFact {
        ConfirmedFact {
            id: id.into(),
            trip_id: "trip".into(),
            fact_type: FactType::RailJourney,
            payload: FactPayload {
                carrier_name: Some("Rail".into()),
                service_number: Some("R1".into()),
                departure_local: Some("2026-11-02T10:00".into()),
                arrival_local: Some("2026-11-02T11:00".into()),
                confirmation_code: Some("SECRET".into()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".into(),
            source_removed: false,
        }
    }

    #[test]
    fn stable_roles_do_not_depend_on_array_position() {
        let one = journey("one");
        let two = journey("two");
        let ids = vec![ItineraryIdentity {
            source: TodayItemTargetSource::ConfirmedFact,
            source_id: "one".into(),
            calendar_lineage: "cal_stable".into(),
            ui_locator: "focus_stable".into(),
            revision: 3,
        }];
        let first = build_calendar_snapshot(&trip(), &[one.clone(), two.clone()], &[], &ids);
        let reordered = build_calendar_snapshot(&trip(), &[two, one], &[], &ids);
        assert_eq!(first, reordered);
        let stable = first
            .events
            .iter()
            .filter(|event| event.uid.starts_with("cal_stable"))
            .collect::<Vec<_>>();
        assert_eq!(stable.len(), 2);
        assert!(stable.iter().all(|event| event.sequence == 3));
        assert!(
            stable
                .iter()
                .any(|event| event.role == CalendarRole::Departure)
        );
        assert!(
            stable
                .iter()
                .any(|event| event.role == CalendarRole::Arrival)
        );
        assert!(!serde_json::to_string(&first).unwrap().contains("SECRET"));
    }

    #[test]
    fn missing_dates_are_explicit_omissions() {
        let mut missing = journey("missing");
        missing.payload.arrival_local = None;
        let snapshot = build_calendar_snapshot(&trip(), &[missing], &[], &[]);
        assert_eq!(snapshot.events.len(), 1);
        assert_eq!(snapshot.omissions.len(), 1);
        assert_eq!(snapshot.omissions[0].role, CalendarRole::Arrival);
    }
}
