//! A deterministic "Today" projection: where a trip stands relative to a
//! reference date, what happens today, and what's next. Pure and offline — it
//! reads only confirmed facts and a caller-supplied `today`, so it is fully
//! testable and never needs the network.

use jiff::Unit;
use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use crate::types::{ConfirmedFact, FactPayload, FactType, Trip};

/// Where the trip sits relative to `today`. `state` is the discriminant; the
/// day counts are present only for the relevant state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripPhase {
    pub state: TripPhaseState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_until: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub days_ago: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TripPhaseState {
    Upcoming,
    Active,
    Completed,
}

/// The kind of thing happening on a day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodayItemKind {
    FlightDeparture,
    FlightArrival,
    Checkin,
    Checkout,
    StayingTonight,
}

/// One dated entry in the Today view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayItem {
    pub kind: TodayItemKind,
    pub title: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub detail: String,
    pub date: String,
    /// Local time (HH:MM) when known (flights).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<String>,
}

/// The Today projection for a trip against a reference date.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayView {
    pub reference_date: String,
    pub phase: TripPhase,
    /// Everything happening on `reference_date`, ordered by time then kind.
    pub today: Vec<TodayItem>,
    /// The single next upcoming anchor (a departure or check-in) after today.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next: Option<TodayItem>,
}

/// Total whole days from `a` to `b` (non-negative when `a <= b`), or 0 if the
/// span can't be computed.
fn days_between(a: Date, b: Date) -> i64 {
    a.until((Unit::Day, b))
        .map(|span| span.get_days() as i64)
        .unwrap_or(0)
}

fn date_part(value: &str) -> &str {
    value.split('T').next().unwrap_or(value)
}

fn time_part(value: &str) -> Option<String> {
    value.split_once('T').map(|(_, time)| time.to_owned())
}

fn phase_for(trip: &Trip, today: &str) -> TripPhase {
    let parsed = (
        today.parse::<Date>().ok(),
        trip.start_date.parse::<Date>().ok(),
        trip.end_date.parse::<Date>().ok(),
    );
    if let (Some(t), Some(start), Some(end)) = parsed {
        if t < start {
            return TripPhase {
                state: TripPhaseState::Upcoming,
                days_until: Some(days_between(t, start)),
                day: None,
                total_days: None,
                days_ago: None,
            };
        }
        if t > end {
            return TripPhase {
                state: TripPhaseState::Completed,
                days_until: None,
                day: None,
                total_days: None,
                days_ago: Some(days_between(end, t)),
            };
        }
        return TripPhase {
            state: TripPhaseState::Active,
            days_until: None,
            day: Some(days_between(start, t) + 1),
            total_days: Some(days_between(start, end) + 1),
            days_ago: None,
        };
    }
    // Unparseable dates: fall back to a lexical comparison without day counts.
    let state = if today < trip.start_date.as_str() {
        TripPhaseState::Upcoming
    } else if today > trip.end_date.as_str() {
        TripPhaseState::Completed
    } else {
        TripPhaseState::Active
    };
    TripPhase {
        state,
        days_until: None,
        day: None,
        total_days: None,
        days_ago: None,
    }
}

fn flight_route(payload: &FactPayload) -> String {
    match (
        payload.departure_airport_iata.as_deref(),
        payload.arrival_airport_iata.as_deref(),
    ) {
        (Some(from), Some(to)) => format!("{from} → {to}"),
        _ => String::new(),
    }
}

fn flight_label(payload: &FactPayload) -> String {
    let carrier: String = [
        payload.airline_name.as_deref(),
        payload.flight_number.as_deref(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" ");
    if carrier.is_empty() {
        "Flight".to_owned()
    } else {
        carrier
    }
}

fn property_name(payload: &FactPayload) -> String {
    payload
        .property_name
        .clone()
        .unwrap_or_else(|| "your stay".to_owned())
}

/// Build the Today view for `trip` and `facts` against `today` (YYYY-MM-DD).
pub fn build_today_view(trip: &Trip, facts: &[ConfirmedFact], today: &str) -> TodayView {
    let mut today_items: Vec<TodayItem> = Vec::new();
    let mut anchors: Vec<TodayItem> = Vec::new(); // future departures/check-ins

    for fact in facts {
        match fact.fact_type {
            FactType::FlightSegment => {
                let payload = &fact.payload;
                if let Some(departure) = payload.departure_local.as_deref() {
                    let date = date_part(departure);
                    let item = TodayItem {
                        kind: TodayItemKind::FlightDeparture,
                        title: format!("Depart — {}", flight_label(payload)),
                        detail: flight_route(payload),
                        date: date.to_owned(),
                        time: time_part(departure),
                    };
                    if date == today {
                        today_items.push(item);
                    } else if date > today {
                        anchors.push(item);
                    }
                }
                if let Some(arrival) = payload.arrival_local.as_deref() {
                    let date = date_part(arrival);
                    if date == today {
                        today_items.push(TodayItem {
                            kind: TodayItemKind::FlightArrival,
                            title: format!("Arrive — {}", flight_label(payload)),
                            detail: flight_route(payload),
                            date: date.to_owned(),
                            time: time_part(arrival),
                        });
                    }
                }
            }
            FactType::LodgingStay => {
                let payload = &fact.payload;
                let checkin = payload.checkin_date.as_deref();
                let checkout = payload.checkout_date.as_deref();
                let name = property_name(payload);
                if let Some(checkin) = checkin {
                    let item = TodayItem {
                        kind: TodayItemKind::Checkin,
                        title: format!("Check in — {name}"),
                        detail: payload.address.clone().unwrap_or_default(),
                        date: checkin.to_owned(),
                        time: None,
                    };
                    if checkin == today {
                        today_items.push(item);
                    } else if checkin > today {
                        anchors.push(item);
                    }
                }
                if checkout == Some(today) {
                    today_items.push(TodayItem {
                        kind: TodayItemKind::Checkout,
                        title: format!("Check out — {name}"),
                        detail: String::new(),
                        date: today.to_owned(),
                        time: None,
                    });
                } else if let (Some(checkin), Some(checkout)) = (checkin, checkout) {
                    // A night in the middle of a stay (not the check-in/out day).
                    if checkin < today && today < checkout {
                        today_items.push(TodayItem {
                            kind: TodayItemKind::StayingTonight,
                            title: format!("Staying at {name}"),
                            detail: payload.address.clone().unwrap_or_default(),
                            date: today.to_owned(),
                            time: None,
                        });
                    }
                }
            }
        }
    }

    today_items.sort_by(|a, b| {
        a.time
            .cmp(&b.time)
            .then_with(|| kind_order(a.kind).cmp(&kind_order(b.kind)))
            .then_with(|| a.title.cmp(&b.title))
    });

    anchors.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| a.time.cmp(&b.time))
            .then_with(|| a.title.cmp(&b.title))
    });

    TodayView {
        reference_date: today.to_owned(),
        phase: phase_for(trip, today),
        today: today_items,
        next: anchors.into_iter().next(),
    }
}

fn kind_order(kind: TodayItemKind) -> u8 {
    match kind {
        TodayItemKind::Checkout => 0,
        TodayItemKind::FlightDeparture => 1,
        TodayItemKind::FlightArrival => 2,
        TodayItemKind::Checkin => 3,
        TodayItemKind::StayingTonight => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, TripStatus};

    fn trip() -> Trip {
        Trip {
            id: "t1".to_owned(),
            title: "Kyoto".to_owned(),
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
            trip_id: "t1".to_owned(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                airline_name: Some("Fictional Pacific".to_owned()),
                flight_number: Some("FP18".to_owned()),
                departure_airport_iata: Some("ORD".to_owned()),
                arrival_airport_iata: Some("HND".to_owned()),
                departure_local: Some("2026-11-03T12:40".to_owned()),
                arrival_local: Some("2026-11-04T16:05".to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn stay() -> ConfirmedFact {
        ConfirmedFact {
            id: "l1".to_owned(),
            trip_id: "t1".to_owned(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some("River Paper Inn".to_owned()),
                checkin_date: Some("2026-11-04".to_owned()),
                checkout_date: Some("2026-11-12".to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn phase_and_next_before_the_trip() {
        let view = build_today_view(&trip(), &[flight(), stay()], "2026-11-01");
        assert_eq!(view.phase.state, TripPhaseState::Upcoming);
        assert_eq!(view.phase.days_until, Some(2));
        assert!(view.today.is_empty());
        // The next anchor is the outbound departure on 11-03.
        let next = view.next.expect("next");
        assert_eq!(next.kind, TodayItemKind::FlightDeparture);
        assert_eq!(next.date, "2026-11-03");
    }

    #[test]
    fn active_day_surfaces_todays_items() {
        // 11-04: flight arrives and lodging checks in.
        let view = build_today_view(&trip(), &[flight(), stay()], "2026-11-04");
        assert_eq!(view.phase.state, TripPhaseState::Active);
        assert_eq!(view.phase.day, Some(2));
        assert_eq!(view.phase.total_days, Some(10));
        let kinds: Vec<TodayItemKind> = view.today.iter().map(|i| i.kind).collect();
        assert!(kinds.contains(&TodayItemKind::FlightArrival));
        assert!(kinds.contains(&TodayItemKind::Checkin));

        // A middle night shows "staying tonight" and no next anchor remains.
        let mid = build_today_view(&trip(), &[flight(), stay()], "2026-11-06");
        assert_eq!(
            mid.today.iter().map(|i| i.kind).collect::<Vec<_>>(),
            vec![TodayItemKind::StayingTonight]
        );
        assert!(mid.next.is_none());
    }

    #[test]
    fn completed_after_the_trip() {
        let view = build_today_view(&trip(), &[flight(), stay()], "2026-11-20");
        assert_eq!(view.phase.state, TripPhaseState::Completed);
        assert_eq!(view.phase.days_ago, Some(8));
        assert!(view.today.is_empty());
        assert!(view.next.is_none());
    }
}
