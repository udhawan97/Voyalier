//! Deterministic cross-segment itinerary checks over confirmed facts.
//!
//! These checks are advisory: they never block confirmation and never touch the
//! network. They read only already-confirmed facts plus the trip window, and
//! ignore any fact whose relevant dates are missing or unparseable (those are
//! surfaced earlier as per-candidate warnings). The result is stable-ordered:
//! flight overlaps, then lodging overlaps, then lodging gaps by date.

use jiff::civil::{Date, DateTime};

use crate::planning::TripItem;
use crate::types::{
    ConfirmedFact, ConflictSeverity, FactLabel, FactType, ItineraryConflict, ItineraryConflictKind,
    Trip,
};

/// Guard against absurd trip windows (~10 years) when walking nights.
const MAX_TRIP_NIGHTS: usize = 3660;

/// Detect flight/lodging overlaps and lodging gaps across a trip's confirmed facts.
pub fn detect_itinerary_conflicts(trip: &Trip, facts: &[ConfirmedFact]) -> Vec<ItineraryConflict> {
    let mut conflicts = Vec::new();
    conflicts.extend(flight_overlaps(facts));
    conflicts.extend(lodging_overlaps(facts));
    conflicts.extend(lodging_gaps(trip, facts));
    conflicts
}

/// Detect literal half-open overlaps among traveler-authored timed items.
/// These remain planning notices and never feed the confirmed-plan readiness
/// rollup.
pub fn detect_planned_item_conflicts(
    items: &[TripItem],
    facts: &[ConfirmedFact],
) -> Vec<ItineraryConflict> {
    let timed: Vec<&TripItem> = items
        .iter()
        .filter(|item| {
            matches!((&item.start_at, &item.end_at), (Some(start), Some(end)) if end > start)
        })
        .collect();
    let mut conflicts = Vec::new();
    for left_index in 0..timed.len() {
        for right_index in (left_index + 1)..timed.len() {
            let left = timed[left_index];
            let right = timed[right_index];
            let (left_start, left_end) = (
                left.start_at.as_deref().unwrap_or_default(),
                left.end_at.as_deref().unwrap_or_default(),
            );
            let (right_start, right_end) = (
                right.start_at.as_deref().unwrap_or_default(),
                right.end_at.as_deref().unwrap_or_default(),
            );
            if left_start < right_end && right_start < left_end {
                let mut planned = vec![
                    (left.id.clone(), left.title.clone()),
                    (right.id.clone(), right.title.clone()),
                ];
                planned.sort_by(|a, b| a.0.cmp(&b.0));
                conflicts.push(ItineraryConflict {
                    kind: ItineraryConflictKind::PlannedItemOverlap,
                    severity: ConflictSeverity::Notice,
                    subjects: Vec::new(),
                    fact_ids: Vec::new(),
                    planned_item_ids: planned.iter().map(|entry| entry.0.clone()).collect(),
                    planned_item_titles: planned.into_iter().map(|entry| entry.1).collect(),
                    start_date: None,
                    end_date: None,
                });
            }
        }
    }
    let flights: Vec<(&ConfirmedFact, DateTime, DateTime)> = facts
        .iter()
        .filter(|fact| fact.fact_type == FactType::FlightSegment)
        .filter_map(|fact| {
            let departure = fact
                .payload
                .departure_local
                .as_deref()
                .and_then(parse_datetime)?;
            let arrival = fact
                .payload
                .arrival_local
                .as_deref()
                .and_then(parse_datetime)?;
            (arrival >= departure).then_some((fact, departure, arrival))
        })
        .collect();
    for item in timed {
        let Some(item_start) = item.start_at.as_deref().and_then(parse_datetime) else {
            continue;
        };
        let Some(item_end) = item.end_at.as_deref().and_then(parse_datetime) else {
            continue;
        };
        for (flight, flight_start, flight_end) in &flights {
            if item_start < *flight_end && *flight_start < item_end {
                conflicts.push(ItineraryConflict {
                    kind: ItineraryConflictKind::PlannedItemOverlap,
                    severity: ConflictSeverity::Notice,
                    subjects: vec![flight_label(flight)],
                    fact_ids: vec![flight.id.clone()],
                    planned_item_ids: vec![item.id.clone()],
                    planned_item_titles: vec![item.title.clone()],
                    start_date: None,
                    end_date: None,
                });
            }
        }
    }
    conflicts.sort_by(|left, right| {
        left.planned_item_ids
            .cmp(&right.planned_item_ids)
            .then_with(|| left.fact_ids.cmp(&right.fact_ids))
    });
    conflicts
}

fn flight_overlaps(facts: &[ConfirmedFact]) -> Vec<ItineraryConflict> {
    let flights: Vec<(&ConfirmedFact, DateTime, DateTime)> = facts
        .iter()
        .filter(|fact| fact.fact_type == FactType::FlightSegment)
        .filter_map(|fact| {
            let departure = fact
                .payload
                .departure_local
                .as_deref()
                .and_then(parse_datetime)?;
            let arrival = fact
                .payload
                .arrival_local
                .as_deref()
                .and_then(parse_datetime)?;
            (arrival >= departure).then_some((fact, departure, arrival))
        })
        .collect();

    let mut conflicts = Vec::new();
    for left_index in 0..flights.len() {
        for right_index in (left_index + 1)..flights.len() {
            let (left, left_start, left_end) = flights[left_index];
            let (right, right_start, right_end) = flights[right_index];
            // Half-open overlap: touching endpoints (a connection) is not a conflict.
            if left_start < right_end && right_start < left_end {
                conflicts.push(ItineraryConflict {
                    kind: ItineraryConflictKind::FlightOverlap,
                    severity: ConflictSeverity::Warning,
                    subjects: vec![flight_label(left), flight_label(right)],
                    fact_ids: sorted_ids(&left.id, &right.id),
                    planned_item_ids: Vec::new(),
                    planned_item_titles: Vec::new(),
                    start_date: None,
                    end_date: None,
                });
            }
        }
    }
    conflicts
}

fn lodging_overlaps(facts: &[ConfirmedFact]) -> Vec<ItineraryConflict> {
    let stays = lodging_intervals(facts);
    let mut conflicts = Vec::new();
    for left_index in 0..stays.len() {
        for right_index in (left_index + 1)..stays.len() {
            let (left, left_checkin, left_checkout) = stays[left_index];
            let (right, right_checkin, right_checkout) = stays[right_index];
            // Half-open [checkin, checkout): a checkout-day handover does not overlap.
            if left_checkin < right_checkout && right_checkin < left_checkout {
                conflicts.push(ItineraryConflict {
                    kind: ItineraryConflictKind::LodgingOverlap,
                    severity: ConflictSeverity::Warning,
                    subjects: vec![lodging_label(left), lodging_label(right)],
                    fact_ids: sorted_ids(&left.id, &right.id),
                    planned_item_ids: Vec::new(),
                    planned_item_titles: Vec::new(),
                    start_date: None,
                    end_date: None,
                });
            }
        }
    }
    conflicts
}

fn lodging_gaps(trip: &Trip, facts: &[ConfirmedFact]) -> Vec<ItineraryConflict> {
    let stays = lodging_intervals(facts);
    // Only reason about gaps once the traveler has started tracking lodging.
    if stays.is_empty() {
        return Vec::new();
    }
    let (Some(start), Some(end)) = (
        parse_date(trip.start_date.trim()),
        parse_date(trip.end_date.trim()),
    ) else {
        return Vec::new();
    };
    if start >= end {
        return Vec::new();
    }

    // Nights are the dates you sleep somewhere: [start, end). Checkout day is not a night.
    let mut uncovered: Vec<Date> = Vec::new();
    let mut night = start;
    let mut walked = 0usize;
    while night < end && walked < MAX_TRIP_NIGHTS {
        let covered = stays
            .iter()
            .any(|(_, checkin, checkout)| *checkin <= night && night < *checkout);
        if !covered {
            uncovered.push(night);
        }
        let Ok(next) = night.tomorrow() else { break };
        night = next;
        walked += 1;
    }

    collapse_runs(&uncovered)
        .into_iter()
        .map(|(first, last)| {
            ItineraryConflict {
                kind: ItineraryConflictKind::LodgingGap,
                severity: ConflictSeverity::Notice,
                // A gap is about nights, not facts: `start_date`/`end_date`
                // carry it, and whether that reads as one night or several is
                // the interface's plural rules to apply.
                subjects: Vec::new(),
                fact_ids: Vec::new(),
                planned_item_ids: Vec::new(),
                planned_item_titles: Vec::new(),
                start_date: Some(first.to_string()),
                end_date: Some(last.to_string()),
            }
        })
        .collect()
}

fn lodging_intervals(facts: &[ConfirmedFact]) -> Vec<(&ConfirmedFact, Date, Date)> {
    facts
        .iter()
        .filter(|fact| fact.fact_type == FactType::LodgingStay)
        .filter_map(|fact| {
            let checkin = fact.payload.checkin_date.as_deref().and_then(parse_date)?;
            let checkout = fact.payload.checkout_date.as_deref().and_then(parse_date)?;
            (checkout > checkin).then_some((fact, checkin, checkout))
        })
        .collect()
}

/// Collapse a sorted, unique list of dates into inclusive consecutive runs.
fn collapse_runs(dates: &[Date]) -> Vec<(Date, Date)> {
    let mut runs: Vec<(Date, Date)> = Vec::new();
    for &date in dates {
        match runs.last_mut() {
            Some((_, last)) if last.tomorrow().map(|next| next == date).unwrap_or(false) => {
                *last = date;
            }
            _ => runs.push((date, date)),
        }
    }
    runs
}

/// Which identifying detail this flight actually has, in preference order.
fn flight_label(fact: &ConfirmedFact) -> FactLabel {
    let payload = &fact.payload;
    if let Some(number) = payload
        .flight_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return FactLabel::FlightNumber {
            number: number.to_owned(),
        };
    }
    match (
        payload
            .departure_airport_iata
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        payload
            .arrival_airport_iata
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
    ) {
        (Some(from), Some(to)) => FactLabel::FlightRoute {
            from: from.to_owned(),
            to: to.to_owned(),
        },
        _ => FactLabel::Flight,
    }
}

fn lodging_label(fact: &ConfirmedFact) -> FactLabel {
    fact.payload
        .property_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|property| FactLabel::LodgingProperty {
            property: property.to_owned(),
        })
        .unwrap_or(FactLabel::Lodging)
}

fn sorted_ids(left: &str, right: &str) -> Vec<String> {
    if left <= right {
        vec![left.to_owned(), right.to_owned()]
    } else {
        vec![right.to_owned(), left.to_owned()]
    }
}

fn parse_datetime(value: &str) -> Option<DateTime> {
    value.trim().parse::<DateTime>().ok()
}

fn parse_date(value: &str) -> Option<Date> {
    value.trim().parse::<Date>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactPayload};

    fn trip(start_date: &str, end_date: &str) -> Trip {
        Trip {
            id: "trip_1".to_owned(),
            title: "Test".to_owned(),
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: start_date.to_owned(),
            end_date: end_date.to_owned(),
            status: crate::types::TripStatus::Active,
            created_at: "2026-01-01T00:00:00Z".to_owned(),
            updated_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    fn flight(id: &str, departure_local: &str, arrival_local: &str) -> ConfirmedFact {
        ConfirmedFact {
            id: id.to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                flight_number: Some(id.to_uppercase()),
                departure_airport_iata: Some("SFO".to_owned()),
                arrival_airport_iata: Some("NRT".to_owned()),
                departure_local: Some(departure_local.to_owned()),
                arrival_local: Some(arrival_local.to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
            source_removed: false,
        }
    }

    fn lodging(id: &str, checkin: &str, checkout: &str) -> ConfirmedFact {
        ConfirmedFact {
            id: id.to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some(format!("Stay {id}")),
                checkin_date: Some(checkin.to_owned()),
                checkout_date: Some(checkout.to_owned()),
                ..FactPayload::default()
            },
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-01-01T00:00:00Z".to_owned(),
            source_removed: false,
        }
    }

    #[test]
    fn empty_itinerary_has_no_conflicts() {
        assert!(detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-12"), &[]).is_empty());
    }

    #[test]
    fn overlapping_flights_are_a_warning() {
        let facts = [
            flight("f1", "2026-11-03T09:00", "2026-11-03T13:00"),
            flight("f2", "2026-11-03T12:00", "2026-11-03T15:00"),
        ];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-05"), &facts);
        let overlap = conflicts
            .iter()
            .find(|conflict| conflict.kind == ItineraryConflictKind::FlightOverlap)
            .expect("flight overlap detected");
        assert_eq!(overlap.severity, ConflictSeverity::Warning);
        assert_eq!(overlap.fact_ids, vec!["f1".to_owned(), "f2".to_owned()]);
    }

    #[test]
    fn back_to_back_flights_do_not_overlap() {
        let facts = [
            flight("f1", "2026-11-03T09:00", "2026-11-03T12:00"),
            flight("f2", "2026-11-03T12:00", "2026-11-03T15:00"),
        ];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-05"), &facts);
        assert!(
            !conflicts
                .iter()
                .any(|conflict| conflict.kind == ItineraryConflictKind::FlightOverlap)
        );
    }

    #[test]
    fn overlapping_lodging_is_a_warning() {
        let facts = [
            lodging("l1", "2026-11-04", "2026-11-08"),
            lodging("l2", "2026-11-07", "2026-11-10"),
        ];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-04", "2026-11-10"), &facts);
        assert!(conflicts.iter().any(|conflict| conflict.kind
            == ItineraryConflictKind::LodgingOverlap
            && conflict.severity == ConflictSeverity::Warning));
    }

    #[test]
    fn handover_day_lodging_does_not_overlap() {
        // Checkout on the 8th, next check-in on the 8th: no shared night.
        let facts = [
            lodging("l1", "2026-11-04", "2026-11-08"),
            lodging("l2", "2026-11-08", "2026-11-10"),
        ];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-04", "2026-11-10"), &facts);
        assert!(
            !conflicts
                .iter()
                .any(|conflict| conflict.kind == ItineraryConflictKind::LodgingOverlap)
        );
    }

    #[test]
    fn uncovered_nights_collapse_into_one_gap_range() {
        // Trip 11-03..11-10 (nights 03..09). Lodging covers 06,07,08 only.
        let facts = [lodging("l1", "2026-11-06", "2026-11-09")];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-10"), &facts);
        let gaps: Vec<_> = conflicts
            .iter()
            .filter(|conflict| conflict.kind == ItineraryConflictKind::LodgingGap)
            .collect();
        // Two runs: 03-05 (before) and 09 (after checkout on the 9th).
        assert_eq!(gaps.len(), 2);
        assert_eq!(gaps[0].start_date.as_deref(), Some("2026-11-03"));
        assert_eq!(gaps[0].end_date.as_deref(), Some("2026-11-05"));
        assert_eq!(gaps[0].severity, ConflictSeverity::Notice);
        assert_eq!(gaps[1].start_date.as_deref(), Some("2026-11-09"));
        assert_eq!(gaps[1].end_date.as_deref(), Some("2026-11-09"));
    }

    #[test]
    fn fully_covered_trip_has_no_gap() {
        let facts = [lodging("l1", "2026-11-03", "2026-11-10")];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-10"), &facts);
        assert!(
            !conflicts
                .iter()
                .any(|conflict| conflict.kind == ItineraryConflictKind::LodgingGap)
        );
    }

    #[test]
    fn no_lodging_facts_means_no_gap_noise() {
        let facts = [flight("f1", "2026-11-03T09:00", "2026-11-03T12:00")];
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-10"), &facts);
        assert!(
            !conflicts
                .iter()
                .any(|conflict| conflict.kind == ItineraryConflictKind::LodgingGap)
        );
    }

    #[test]
    fn unparseable_dates_are_ignored() {
        let mut broken = flight("f1", "not-a-date", "also-not");
        broken.payload.departure_local = Some("garbage".to_owned());
        let conflicts = detect_itinerary_conflicts(&trip("2026-11-03", "2026-11-10"), &[broken]);
        assert!(conflicts.is_empty());
    }

    #[test]
    fn overlapping_manual_items_are_notices_but_touching_items_are_clear() {
        use crate::planning::TripItemKind;

        let item = |id: &str, title: &str, start: &str, end: &str| TripItem {
            id: id.to_owned(),
            trip_id: "t1".to_owned(),
            kind: TripItemKind::Activity,
            title: title.to_owned(),
            location: None,
            start_at: Some(start.to_owned()),
            end_at: Some(end.to_owned()),
            notes: None,
            saved_place_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let conflicts = detect_planned_item_conflicts(
            &[
                item("b", "Museum", "2026-11-04T10:00", "2026-11-04T12:00"),
                item("a", "Tea", "2026-11-04T11:00", "2026-11-04T13:00"),
                item("c", "Rail", "2026-11-04T13:00", "2026-11-04T14:00"),
            ],
            &[],
        );

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].kind, ItineraryConflictKind::PlannedItemOverlap);
        assert_eq!(conflicts[0].severity, ConflictSeverity::Notice);
        assert_eq!(conflicts[0].planned_item_ids, ["a", "b"]);
        assert_eq!(conflicts[0].planned_item_titles, ["Tea", "Museum"]);
    }

    #[test]
    fn manual_items_overlapping_confirmed_flights_are_notices() {
        use crate::planning::TripItemKind;

        let item = TripItem {
            id: "plan_1".to_owned(),
            trip_id: "t1".to_owned(),
            kind: TripItemKind::Transfer,
            title: "Airport transfer".to_owned(),
            location: None,
            start_at: Some("2026-11-03T10:00".to_owned()),
            end_at: Some("2026-11-03T11:00".to_owned()),
            notes: None,
            saved_place_id: None,
            created_at: String::new(),
            updated_at: String::new(),
        };

        let conflicts = detect_planned_item_conflicts(
            &[item],
            &[flight("flight_1", "2026-11-03T10:30", "2026-11-03T12:00")],
        );

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].severity, ConflictSeverity::Notice);
        assert_eq!(conflicts[0].planned_item_titles, ["Airport transfer"]);
        assert_eq!(conflicts[0].fact_ids, ["flight_1"]);
    }
}
