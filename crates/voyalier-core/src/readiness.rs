//! Deterministic plan-completeness readiness rollup.
//!
//! This is a logistics summary only: it reports whether the confirmed plan hangs
//! together (no schedule conflicts, lodging covers the nights, nothing left to
//! review). It never asserts anything about entry rules, visas, health, safety,
//! or weather — that sourced readiness is a later milestone and must be quoted
//! from identified sources, never inferred here or by a model.

use crate::types::{
    ConfirmedFact, ConflictSeverity, FactType, ItineraryConflict, ItineraryConflictKind,
    ReadinessCheck, ReadinessItem, ReadinessStatus, ReadinessSummary, SourceLink, Trip,
};

/// Roll up plan-completeness readiness from the confirmed facts, pending count,
/// and the already-computed itinerary conflicts.
pub fn assess_readiness(
    _trip: &Trip,
    facts: &[ConfirmedFact],
    pending_candidate_count: u32,
    conflicts: &[ItineraryConflict],
) -> ReadinessSummary {
    let has_facts = !facts.is_empty();
    let has_lodging = facts
        .iter()
        .any(|fact| fact.fact_type == FactType::LodgingStay);

    // Logistics checks drive the overall rollup. The entry-requirements item is
    // a link-only reference that never asserts anything, so it must not affect
    // the overall status (it is always NotChecked and would otherwise pin it).
    let logistics = vec![
        schedule_item(has_facts, conflicts),
        lodging_item(has_lodging, conflicts),
        pending_item(pending_candidate_count),
    ];
    let status = overall_status(&logistics, has_facts);

    let mut items = logistics;
    items.push(entry_requirements_item());
    items.push(health_notices_item());

    ReadinessSummary { status, items }
}

/// A link-only, high-stakes-safe reference item. Voyalier never asserts, infers,
/// or clears entry requirements — it points the traveler at official sources.
fn entry_requirements_item() -> ReadinessItem {
    ReadinessItem {
        id: ReadinessCheck::EntryRequirements,
        status: ReadinessStatus::NotChecked,
        title: "Entry & travel requirements".to_owned(),
        detail: "Requirements depend on your nationality and change often. \
                 Confirm them at an official government source before you travel — \
                 Voyalier links to official sources and never asserts or clears \
                 entry rules."
            .to_owned(),
        links: official_source_links(),
    }
}

/// A link-only, high-stakes-safe health reference. Voyalier never asserts,
/// infers, or clears health requirements — it points at official sources.
fn health_notices_item() -> ReadinessItem {
    ReadinessItem {
        id: ReadinessCheck::HealthNotices,
        status: ReadinessStatus::NotChecked,
        title: "Health notices".to_owned(),
        detail: "Vaccination and health advice depends on your destination and \
                 health, and changes often. Check an official source before you \
                 travel — Voyalier links to official sources and never gives \
                 medical advice."
            .to_owned(),
        links: health_source_links(),
    }
}

/// Curated, stable official health-source starting points. Hard-coded here,
/// never derived from trip data or a model.
fn health_source_links() -> Vec<SourceLink> {
    vec![
        SourceLink {
            label: "US CDC — Travelers' Health, destination notices".to_owned(),
            url: "https://wwwnc.cdc.gov/travel/destinations/list".to_owned(),
        },
        SourceLink {
            label: "WHO — International travel and health".to_owned(),
            url: "https://www.who.int/travel-advice".to_owned(),
        },
    ]
}

/// Curated, stable official-source starting points. URLs are hard-coded here,
/// never derived from trip data or a model.
fn official_source_links() -> Vec<SourceLink> {
    vec![
        SourceLink {
            label: "UK FCDO travel advice — entry requirements by country".to_owned(),
            url: "https://www.gov.uk/foreign-travel-advice".to_owned(),
        },
        SourceLink {
            label: "US State Dept — travel advisories by country".to_owned(),
            url:
                "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html"
                    .to_owned(),
        },
        SourceLink {
            label: "US State Dept — international travel".to_owned(),
            url: "https://travel.state.gov/content/travel/en/international-travel.html".to_owned(),
        },
    ]
}

fn schedule_item(has_facts: bool, conflicts: &[ItineraryConflict]) -> ReadinessItem {
    let warnings = conflicts
        .iter()
        .filter(|conflict| conflict.severity == ConflictSeverity::Warning)
        .count();
    let notices = conflicts
        .iter()
        .filter(|conflict| conflict.severity == ConflictSeverity::Notice)
        .count();

    let (status, detail) = if !has_facts {
        (
            ReadinessStatus::NotChecked,
            "Add flights or stays to check for overlaps.".to_owned(),
        )
    } else if warnings > 0 {
        (
            ReadinessStatus::ActionNeeded,
            format!(
                "{warnings} scheduling {} to resolve.",
                noun(warnings, "conflict")
            ),
        )
    } else if notices > 0 {
        (
            ReadinessStatus::Monitor,
            format!(
                "{notices} scheduling {} to review.",
                noun(notices, "notice")
            ),
        )
    } else {
        (
            ReadinessStatus::Clear,
            "No overlaps in your confirmed plans.".to_owned(),
        )
    };

    ReadinessItem {
        id: ReadinessCheck::ScheduleConflicts,
        status,
        title: "Schedule conflicts".to_owned(),
        detail,
        links: Vec::new(),
    }
}

fn lodging_item(has_lodging: bool, conflicts: &[ItineraryConflict]) -> ReadinessItem {
    let gaps = conflicts
        .iter()
        .filter(|conflict| conflict.kind == ItineraryConflictKind::LodgingGap)
        .count();

    let (status, detail) = if !has_lodging {
        (
            ReadinessStatus::NotChecked,
            "No lodging added yet.".to_owned(),
        )
    } else if gaps > 0 {
        (
            ReadinessStatus::Monitor,
            "Some nights in your trip have no lodging booked.".to_owned(),
        )
    } else {
        (
            ReadinessStatus::Clear,
            "Every night of your trip has lodging.".to_owned(),
        )
    };

    ReadinessItem {
        id: ReadinessCheck::LodgingCoverage,
        status,
        title: "Lodging coverage".to_owned(),
        detail,
        links: Vec::new(),
    }
}

fn pending_item(pending_candidate_count: u32) -> ReadinessItem {
    let (status, detail) = if pending_candidate_count > 0 {
        (
            ReadinessStatus::Monitor,
            format!(
                "{pending_candidate_count} imported {} waiting for review.",
                noun(pending_candidate_count as usize, "suggestion")
            ),
        )
    } else {
        (
            ReadinessStatus::Clear,
            "Nothing is waiting for review.".to_owned(),
        )
    };

    ReadinessItem {
        id: ReadinessCheck::PendingReview,
        status,
        title: "Suggestions to review".to_owned(),
        detail,
        links: Vec::new(),
    }
}

fn overall_status(items: &[ReadinessItem], has_facts: bool) -> ReadinessStatus {
    let worst = items
        .iter()
        .map(|item| item.status)
        .max_by_key(|status| severity(*status))
        .unwrap_or(ReadinessStatus::NotChecked);

    // A plan with nothing confirmed is not "ready"; a lone "nothing to review"
    // clear item must not read as Clear.
    if !has_facts && worst == ReadinessStatus::Clear {
        ReadinessStatus::NotChecked
    } else {
        worst
    }
}

fn severity(status: ReadinessStatus) -> u8 {
    match status {
        ReadinessStatus::NotChecked => 0,
        ReadinessStatus::Clear => 1,
        ReadinessStatus::Monitor => 2,
        ReadinessStatus::ActionNeeded => 3,
        ReadinessStatus::Critical => 4,
    }
}

fn noun(count: usize, singular: &str) -> String {
    if count == 1 {
        singular.to_owned()
    } else {
        format!("{singular}s")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect_itinerary_conflicts;
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

    fn assess(trip: &Trip, facts: &[ConfirmedFact], pending: u32) -> ReadinessSummary {
        let conflicts = detect_itinerary_conflicts(trip, facts);
        assess_readiness(trip, facts, pending, &conflicts)
    }

    #[test]
    fn empty_plan_is_not_checked_not_clear() {
        let summary = assess(&trip("2026-11-03", "2026-11-12"), &[], 0);
        assert_eq!(summary.status, ReadinessStatus::NotChecked);
    }

    #[test]
    fn pending_suggestions_raise_monitor_even_with_no_facts() {
        let summary = assess(&trip("2026-11-03", "2026-11-12"), &[], 2);
        assert_eq!(summary.status, ReadinessStatus::Monitor);
    }

    #[test]
    fn overlapping_flights_drive_action_needed() {
        let facts = [
            flight("f1", "2026-11-03T09:00", "2026-11-03T13:00"),
            flight("f2", "2026-11-03T12:00", "2026-11-03T15:00"),
        ];
        let summary = assess(&trip("2026-11-03", "2026-11-05"), &facts, 0);
        assert_eq!(summary.status, ReadinessStatus::ActionNeeded);
    }

    #[test]
    fn fully_covered_reviewed_trip_is_clear() {
        let facts = [
            flight("f1", "2026-11-03T09:00", "2026-11-03T12:00"),
            lodging("l1", "2026-11-03", "2026-11-05"),
        ];
        let summary = assess(&trip("2026-11-03", "2026-11-05"), &facts, 0);
        assert_eq!(summary.status, ReadinessStatus::Clear);
        assert!(
            summary
                .items
                .iter()
                .all(|item| item.status != ReadinessStatus::ActionNeeded)
        );
    }

    #[test]
    fn entry_requirements_item_links_out_and_never_moves_the_rollup() {
        // Fully covered, reviewed trip: overall must stay Clear even though the
        // entry item itself is permanently NotChecked (link-only reference).
        let facts = [
            flight("f1", "2026-11-03T09:00", "2026-11-03T12:00"),
            lodging("l1", "2026-11-03", "2026-11-05"),
        ];
        let summary = assess(&trip("2026-11-03", "2026-11-05"), &facts, 0);
        assert_eq!(summary.status, ReadinessStatus::Clear);

        let entry = summary
            .items
            .iter()
            .find(|item| item.id == ReadinessCheck::EntryRequirements)
            .expect("entry item present");
        assert_eq!(entry.status, ReadinessStatus::NotChecked);
        assert!(!entry.links.is_empty());
        assert!(
            entry
                .links
                .iter()
                .all(|link| link.url.starts_with("https://"))
        );
        // The item explains that Voyalier never asserts entry rules.
        assert!(entry.detail.contains("never asserts"));
    }

    #[test]
    fn health_notices_item_links_out_and_never_moves_the_rollup() {
        let facts = [
            flight("f1", "2026-11-03T09:00", "2026-11-03T12:00"),
            lodging("l1", "2026-11-03", "2026-11-05"),
        ];
        let summary = assess(&trip("2026-11-03", "2026-11-05"), &facts, 0);
        // Fully covered trip stays Clear despite the link-only health item.
        assert_eq!(summary.status, ReadinessStatus::Clear);

        let health = summary
            .items
            .iter()
            .find(|item| item.id == ReadinessCheck::HealthNotices)
            .expect("health item present");
        assert_eq!(health.status, ReadinessStatus::NotChecked);
        assert!(!health.links.is_empty());
        assert!(
            health
                .links
                .iter()
                .all(|link| link.url.starts_with("https://"))
        );
        // Voyalier links out and never gives medical advice.
        assert!(health.detail.contains("never gives"));
    }

    #[test]
    fn lodging_gap_is_a_monitor_not_a_block() {
        let facts = [lodging("l1", "2026-11-05", "2026-11-08")];
        let summary = assess(&trip("2026-11-03", "2026-11-08"), &facts, 0);
        assert_eq!(summary.status, ReadinessStatus::Monitor);
        let lodging_item = summary
            .items
            .iter()
            .find(|item| item.id == ReadinessCheck::LodgingCoverage)
            .expect("lodging item present");
        assert_eq!(lodging_item.status, ReadinessStatus::Monitor);
    }
}
