//! A deterministic day-by-day projection over approved facts and authored
//! plans. It preserves recorded wall-clock text, never infers routes or zones,
//! and keeps evidence-backed records visibly distinct from traveler plans.

use jiff::civil::{Date, DateTime};
use serde::{Deserialize, Serialize};

use crate::planning::{TripItem, TripItemKind};
use crate::today::{TodayItemKind, TodayItemTarget, TodayItemTargetSource};
use crate::types::{ConfirmedFact, FactPayload, FactType, Trip};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JourneyBoardEntry {
    pub kind: TodayItemKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
    pub target: TodayItemTarget,
    /// Stable projection identity, separate from external calendar lineage.
    pub focus_locator: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JourneyBoardDay {
    pub date: String,
    pub entries: Vec<JourneyBoardEntry>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JourneyBoard {
    pub before: Vec<JourneyBoardEntry>,
    pub days: Vec<JourneyBoardDay>,
    pub after: Vec<JourneyBoardEntry>,
    pub unscheduled: Vec<JourneyBoardEntry>,
}

fn date_and_time(value: Option<&str>) -> (Option<String>, Option<String>) {
    let Some(value) = value else {
        return (None, None);
    };
    let date = value.split('T').next().unwrap_or(value);
    if date.parse::<Date>().is_err() {
        return (None, None);
    }
    let time = value
        .split_once('T')
        .and_then(|(_, time)| value.parse::<DateTime>().ok().map(|_| time.to_owned()));
    (Some(date.to_owned()), time)
}

fn carrier_subject(payload: &FactPayload, flight: bool) -> Option<String> {
    let values = if flight {
        [
            payload.airline_name.as_deref(),
            payload.flight_number.as_deref(),
        ]
    } else {
        [
            payload.carrier_name.as_deref(),
            payload.service_number.as_deref(),
        ]
    };
    let subject = values.into_iter().flatten().collect::<Vec<_>>().join(" ");
    (!subject.is_empty()).then_some(subject)
}

fn route(payload: &FactPayload, flight: bool) -> String {
    let endpoints = if flight {
        (
            payload.departure_airport_iata.as_deref(),
            payload.arrival_airport_iata.as_deref(),
        )
    } else {
        (
            payload.departure_place.as_deref(),
            payload.arrival_place.as_deref(),
        )
    };
    match endpoints {
        (Some(from), Some(to)) => format!("{from} → {to}"),
        _ => String::new(),
    }
}

fn fact_entry(
    fact: &ConfirmedFact,
    kind: TodayItemKind,
    subject: Option<String>,
    title: &str,
    detail: String,
    value: Option<&str>,
) -> JourneyBoardEntry {
    let (date, time) = date_and_time(value);
    JourneyBoardEntry {
        kind,
        subject,
        title: title.to_owned(),
        detail,
        date,
        time,
        target: TodayItemTarget {
            source: TodayItemTargetSource::ConfirmedFact,
            record_id: fact.id.clone(),
        },
        // UI namespace only. Calendar export never consumes it.
        focus_locator: format!("focus:fact:{}", fact.id),
    }
}

fn plan_entry(item: &TripItem) -> JourneyBoardEntry {
    let (date, time) = date_and_time(item.start_at.as_deref());
    JourneyBoardEntry {
        kind: match item.kind {
            TripItemKind::Activity => TodayItemKind::Activity,
            TripItemKind::Rail => TodayItemKind::Rail,
            TripItemKind::Transfer => TodayItemKind::Transfer,
        },
        subject: None,
        title: item.title.clone(),
        detail: item.location.clone().unwrap_or_default(),
        date,
        time,
        target: TodayItemTarget {
            source: TodayItemTargetSource::TripItem,
            record_id: item.id.clone(),
        },
        focus_locator: format!("focus:plan:{}", item.id),
    }
}

fn kind_order(kind: TodayItemKind) -> u8 {
    match kind {
        TodayItemKind::Checkout => 0,
        TodayItemKind::FlightDeparture => 1,
        TodayItemKind::FlightArrival => 2,
        TodayItemKind::JourneyDeparture => 3,
        TodayItemKind::JourneyArrival => 4,
        TodayItemKind::Checkin => 5,
        TodayItemKind::StayingTonight => 6,
        TodayItemKind::Activity => 7,
        TodayItemKind::Rail => 8,
        TodayItemKind::Transfer => 9,
    }
}

fn source_order(source: TodayItemTargetSource) -> u8 {
    match source {
        TodayItemTargetSource::ConfirmedFact => 0,
        TodayItemTargetSource::TripItem => 1,
    }
}

fn sort_entries(entries: &mut [JourneyBoardEntry]) {
    entries.sort_by(|left, right| {
        left.time
            .cmp(&right.time)
            .then_with(|| kind_order(left.kind).cmp(&kind_order(right.kind)))
            .then_with(|| source_order(left.target.source).cmp(&source_order(right.target.source)))
            .then_with(|| left.focus_locator.cmp(&right.focus_locator))
    });
}

/// Build the complete itinerary spine from local records only.
pub fn build_journey_board(
    trip: &Trip,
    facts: &[ConfirmedFact],
    trip_items: &[TripItem],
) -> JourneyBoard {
    let mut entries = Vec::new();
    for fact in facts {
        let payload = &fact.payload;
        match fact.fact_type {
            FactType::FlightSegment => {
                let subject = carrier_subject(payload, true);
                let detail = route(payload, true);
                entries.push(fact_entry(
                    fact,
                    TodayItemKind::FlightDeparture,
                    subject.clone(),
                    "Depart",
                    detail.clone(),
                    payload.departure_local.as_deref(),
                ));
                entries.push(fact_entry(
                    fact,
                    TodayItemKind::FlightArrival,
                    subject,
                    "Arrive",
                    detail,
                    payload.arrival_local.as_deref(),
                ));
            }
            FactType::RailJourney
            | FactType::CoachJourney
            | FactType::FerryCrossing
            | FactType::CarRental => {
                let subject = carrier_subject(payload, false);
                let detail = route(payload, false);
                entries.push(fact_entry(
                    fact,
                    TodayItemKind::JourneyDeparture,
                    subject.clone(),
                    "Depart",
                    detail.clone(),
                    payload.departure_local.as_deref(),
                ));
                entries.push(fact_entry(
                    fact,
                    TodayItemKind::JourneyArrival,
                    subject,
                    "Arrive",
                    detail,
                    payload.arrival_local.as_deref(),
                ));
            }
            FactType::LodgingStay => {
                let subject = payload.property_name.clone();
                let detail = payload.address.clone().unwrap_or_default();
                entries.push(fact_entry(
                    fact,
                    TodayItemKind::Checkin,
                    subject.clone(),
                    "Check in",
                    detail.clone(),
                    payload.checkin_date.as_deref(),
                ));
                entries.push(fact_entry(
                    fact,
                    TodayItemKind::Checkout,
                    subject.clone(),
                    "Check out",
                    String::new(),
                    payload.checkout_date.as_deref(),
                ));
                let dates = (
                    payload
                        .checkin_date
                        .as_deref()
                        .and_then(|value| value.parse::<Date>().ok()),
                    payload
                        .checkout_date
                        .as_deref()
                        .and_then(|value| value.parse::<Date>().ok()),
                );
                if let (Some(mut night), Some(checkout)) = dates {
                    while night < checkout {
                        let night_value = night.to_string();
                        entries.push(fact_entry(
                            fact,
                            TodayItemKind::StayingTonight,
                            subject.clone(),
                            "Staying tonight",
                            detail.clone(),
                            Some(&night_value),
                        ));
                        let Ok(next) = night.tomorrow() else { break };
                        night = next;
                    }
                }
            }
        }
    }
    entries.extend(trip_items.iter().map(plan_entry));

    let bounds = (
        trip.start_date.parse::<Date>().ok(),
        trip.end_date.parse::<Date>().ok(),
    );
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut unscheduled = Vec::new();
    let mut days = Vec::new();
    if let (Some(start), Some(end)) = bounds {
        let mut date = start;
        while date <= end {
            days.push(JourneyBoardDay {
                date: date.to_string(),
                entries: Vec::new(),
            });
            let Ok(next) = date.tomorrow() else { break };
            date = next;
        }
        for entry in entries {
            match entry
                .date
                .as_deref()
                .and_then(|value| value.parse::<Date>().ok())
            {
                None => unscheduled.push(entry),
                Some(date) if date < start => before.push(entry),
                Some(date) if date > end => after.push(entry),
                Some(date) => {
                    if let Some(day) = days.iter_mut().find(|day| day.date == date.to_string()) {
                        day.entries.push(entry);
                    }
                }
            }
        }
    } else {
        unscheduled = entries;
    }

    sort_entries(&mut before);
    sort_entries(&mut after);
    sort_entries(&mut unscheduled);
    for day in &mut days {
        sort_entries(&mut day.entries);
    }
    JourneyBoard {
        before,
        days,
        after,
        unscheduled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ExtractionMethod, TripStatus};

    fn trip() -> Trip {
        Trip {
            id: "trip".into(),
            title: "Journey".into(),
            origin: "A".into(),
            destination: "B".into(),
            start_date: "2026-11-03".into(),
            end_date: "2026-11-05".into(),
            status: TripStatus::Active,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn fact(id: &str, fact_type: FactType, payload: FactPayload) -> ConfirmedFact {
        ConfirmedFact {
            id: id.into(),
            trip_id: "trip".into(),
            fact_type,
            payload,
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".into(),
            source_removed: false,
        }
    }

    #[test]
    fn separates_arrival_departure_and_every_stay_night() {
        let flight = fact(
            "flight",
            FactType::FlightSegment,
            FactPayload {
                departure_local: Some("2026-11-02T23:00".into()),
                arrival_local: Some("2026-11-03T08:00".into()),
                ..FactPayload::default()
            },
        );
        let stay = fact(
            "stay",
            FactType::LodgingStay,
            FactPayload {
                checkin_date: Some("2026-11-03".into()),
                checkout_date: Some("2026-11-05".into()),
                ..FactPayload::default()
            },
        );
        let board = build_journey_board(&trip(), &[flight, stay], &[]);
        assert_eq!(board.before[0].kind, TodayItemKind::FlightDeparture);
        assert!(
            board.days[0]
                .entries
                .iter()
                .any(|entry| entry.kind == TodayItemKind::FlightArrival)
        );
        assert_eq!(
            board
                .days
                .iter()
                .flat_map(|day| &day.entries)
                .filter(|entry| entry.kind == TodayItemKind::StayingTonight)
                .count(),
            2
        );
        assert!(
            board.days[2]
                .entries
                .iter()
                .any(|entry| entry.kind == TodayItemKind::Checkout)
        );
    }

    #[test]
    fn invalid_and_missing_dates_are_unscheduled_without_private_notes() {
        let item = TripItem {
            id: "plan".into(),
            trip_id: "trip".into(),
            kind: TripItemKind::Activity,
            title: "Museum".into(),
            location: Some("Center".into()),
            start_at: Some("not-a-date".into()),
            end_at: None,
            notes: Some("PRIVATE".into()),
            saved_place_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        };
        let board = build_journey_board(&trip(), &[], &[item]);
        assert_eq!(board.unscheduled[0].title, "Museum");
        assert!(!serde_json::to_string(&board).unwrap().contains("PRIVATE"));
    }
}
