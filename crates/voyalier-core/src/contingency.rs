//! What the itinerary's hand-offs cost if something slips (ADR-0016 §2).
//!
//! The existing itinerary checks report states that are already wrong: two
//! flights at once, a night with no room. This asks the forward question a
//! traveler asks the night before — *how much slack does this connection have,
//! and what sits behind it?*
//!
//! Three limits are the whole point of this module, and each has a test:
//!
//! 1. **It never proposes an alternative service.** It does not know that
//!    another sailing exists, that a seat is free, or that a route is possible.
//!    It reports exposure over the traveler's own confirmed evidence. Where a
//!    booking agent's "backup route" means *here is another way*, this means
//!    *here is what you would have to replace, and how long you would have*.
//! 2. **It never feeds readiness.** A tight connection is a choice some
//!    travelers make deliberately, so it must not turn a plan-completeness
//!    rollup amber.
//! 3. **It is offline and deterministic.** No network, no model, no
//!    probability. Slack is arithmetic over times the traveler confirmed. This
//!    crate has no delay dataset and is not acquiring one.
//!
//! The bands below are Voyalier's own rule of thumb, not any carrier's minimum
//! connection time — an interface must show the minutes, and may show the band
//! only as the caution it is.

use jiff::Unit;
use jiff::civil::DateTime;
use serde::{Deserialize, Serialize};

use crate::airports::NearbyAirport;
use crate::itinerary::fact_label;
use crate::missions::{Mission, MissionKind};
use crate::types::{ConfirmedFact, FactLabel, FactType};

/// Beyond this, two commitments are not a hand-off — they are just the trip
/// continuing. Without it, "your ferry lands Tuesday, your flight leaves
/// Friday" would be reported as a connection with 68 hours of slack.
const MAX_HANDOFF_MINUTES: i64 = 24 * 60;

/// Where one commitment has to be met after another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffKind {
    /// Arriving on one scheduled service and leaving on the next.
    Connection,
    /// Reaching a hire-car desk after arriving somewhere.
    RentalPickup,
    /// Returning a hire car before leaving on something scheduled.
    RentalReturn,
}

/// How tight a hand-off is. An app-authored caution, never a carrier's rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandoffBand {
    /// The second commitment starts before the first one ends.
    Impossible,
    Tight,
    Short,
    Comfortable,
    Ample,
}

/// One place the plan depends on the previous thing having gone right.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub kind: HandoffKind,
    /// What the traveler arrives on.
    pub from: FactLabel,
    /// What they then have to make.
    pub to: FactLabel,
    pub from_fact_id: String,
    pub to_fact_id: String,
    /// Minutes between the two. Negative when the second starts first.
    pub slack_minutes: i64,
    pub band: HandoffBand,
    /// When the first commitment ends, in its own local wall clock.
    pub at: String,
}

/// A leg other commitments are stacked behind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposedLeg {
    pub fact_id: String,
    pub label: FactLabel,
    /// How long this leg can run late before the next commitment is missed.
    /// Never negative: a leg already past its follow-on is reported at zero,
    /// because "you have -20 minutes" is not a thing a traveler can act on.
    pub absorbs_minutes: i64,
    /// How many later commitments sit behind it.
    pub dependents: u32,
}

/// Something in the workspace worth reaching for, assembled only from evidence
/// and bundled data the traveler already has (ADR-0016 §3).
///
/// Deliberately carries **no URL and no phone number**. This product does not
/// curate carrier contact channels: they change constantly and the failure
/// lands on someone standing in a terminal at 23:00.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "code",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum FallbackPointer {
    /// The operator named on the traveler's own confirmation. Whatever number
    /// reaches them is printed on that confirmation — which is current, and not
    /// this product's to get wrong.
    CarrierOnConfirmation { carrier: String, fact_id: String },
    /// Another airport near the destination, from the bundled table. Geography,
    /// never a route: nothing here says a service runs from it.
    AlternateAirport {
        name: String,
        iata: String,
        distance_km: u32,
    },
    /// The traveler's own consular post, under the same "somewhere to confirm,
    /// never somewhere to travel to" framing the visa panel uses.
    DiplomaticMission {
        sending_country: String,
        city: String,
        kind: MissionKind,
    },
}

/// Everything the playbook has to say about one trip.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisruptionPlan {
    /// Tightest first, then in time order.
    pub handoffs: Vec<Handoff>,
    /// Least slack first.
    pub exposed_legs: Vec<ExposedLeg>,
    pub pointers: Vec<FallbackPointer>,
}

impl DisruptionPlan {
    pub fn is_empty(&self) -> bool {
        self.handoffs.is_empty() && self.exposed_legs.is_empty() && self.pointers.is_empty()
    }
}

/// What the app layer already has to hand, lent to the rule.
///
/// Both slices may be empty; the plan simply offers fewer pointers. Nothing
/// here is fetched — the airports are bundled and the missions are a bundled
/// Wikidata extract.
#[derive(Debug, Clone, Copy, Default)]
pub struct DisruptionContext<'a> {
    pub nearest_airports: &'a [NearbyAirport],
    pub missions: &'a [Mission],
}

/// A confirmed leg with both of its times resolved.
struct Leg<'a> {
    fact: &'a ConfirmedFact,
    departure: DateTime,
    arrival: DateTime,
}

/// Build the playbook. Pure, offline, and empty when the evidence is silent.
pub fn build_disruption_plan(
    facts: &[ConfirmedFact],
    context: DisruptionContext<'_>,
) -> DisruptionPlan {
    let scheduled = legs_of(facts, |fact_type| {
        fact_type.is_journey() && fact_type != FactType::CarRental
    });
    let rentals = legs_of(facts, |fact_type| fact_type == FactType::CarRental);

    let mut handoffs = Vec::new();
    handoffs.extend(connections(&scheduled));
    handoffs.extend(rental_handoffs(&scheduled, &rentals));

    let exposed_legs = exposed_legs(&scheduled, &handoffs);
    let pointers = pointers(facts, context);

    // Tightest first — that is the one worth reading — then stable by time and
    // by the ids, so the same trip always renders in the same order.
    handoffs.sort_by(|left, right| {
        left.slack_minutes
            .cmp(&right.slack_minutes)
            .then_with(|| left.at.cmp(&right.at))
            .then_with(|| left.from_fact_id.cmp(&right.from_fact_id))
            .then_with(|| left.to_fact_id.cmp(&right.to_fact_id))
    });

    DisruptionPlan {
        handoffs,
        exposed_legs,
        pointers,
    }
}

/// Legs of the requested kinds whose two times both parse, in departure order.
///
/// A missing or unreadable time yields no leg rather than an assumed one — the
/// rule the itinerary checks already follow.
fn legs_of(facts: &[ConfirmedFact], wanted: impl Fn(FactType) -> bool) -> Vec<Leg<'_>> {
    let mut legs: Vec<Leg<'_>> = facts
        .iter()
        .filter(|fact| wanted(fact.fact_type))
        .filter_map(|fact| {
            Some(Leg {
                fact,
                departure: parse_datetime(fact.payload.departure_local.as_deref()?)?,
                arrival: parse_datetime(fact.payload.arrival_local.as_deref()?)?,
            })
        })
        .collect();
    legs.sort_by(|left, right| {
        left.departure
            .cmp(&right.departure)
            .then_with(|| left.fact.id.cmp(&right.fact.id))
    });
    legs
}

/// Arriving on one scheduled service and leaving on the next.
fn connections(scheduled: &[Leg<'_>]) -> Vec<Handoff> {
    let mut handoffs = Vec::new();
    for pair in scheduled.windows(2) {
        let (from, to) = (&pair[0], &pair[1]);
        let slack = minutes_between(from.arrival, to.departure);
        // A negative gap here is an overlap, which the itinerary checks already
        // report as a conflict. Reporting it twice, in two vocabularies, would
        // make the same defect look like two.
        if !(0..=MAX_HANDOFF_MINUTES).contains(&slack) {
            continue;
        }
        handoffs.push(Handoff {
            kind: HandoffKind::Connection,
            from: fact_label(from.fact),
            to: fact_label(to.fact),
            from_fact_id: from.fact.id.clone(),
            to_fact_id: to.fact.id.clone(),
            slack_minutes: slack,
            band: band_for(HandoffKind::Connection, from.fact.fact_type, slack),
            at: from.arrival.to_string(),
        });
    }
    handoffs
}

/// A hire car is not something the traveler rides between other legs — it sits
/// in a car park while they take a train — so it never joins the connection
/// chain. Its two ends are still commitments that have to be met, so each gets
/// measured against the nearest scheduled leg.
fn rental_handoffs(scheduled: &[Leg<'_>], rentals: &[Leg<'_>]) -> Vec<Handoff> {
    let mut handoffs = Vec::new();
    for rental in rentals {
        // Reaching the desk: the last scheduled arrival before the pickup, or
        // the one just after it, whichever is nearer. An arrival *after* the
        // pickup is the real defect — the car is booked for before the traveler
        // lands — and nothing else in the tree reports it, because hire cars are
        // exempt from the overlap check.
        if let Some(nearest) = nearest_by(scheduled, |leg| {
            minutes_between(leg.arrival, rental.departure)
        }) {
            let slack = minutes_between(nearest.arrival, rental.departure);
            handoffs.push(Handoff {
                kind: HandoffKind::RentalPickup,
                from: fact_label(nearest.fact),
                to: fact_label(rental.fact),
                from_fact_id: nearest.fact.id.clone(),
                to_fact_id: rental.fact.id.clone(),
                slack_minutes: slack,
                band: band_for(HandoffKind::RentalPickup, nearest.fact.fact_type, slack),
                at: nearest.arrival.to_string(),
            });
        }
        // Giving it back: the first scheduled departure after the return.
        if let Some(nearest) = nearest_by(scheduled, |leg| {
            minutes_between(rental.arrival, leg.departure)
        }) {
            let slack = minutes_between(rental.arrival, nearest.departure);
            handoffs.push(Handoff {
                kind: HandoffKind::RentalReturn,
                from: fact_label(rental.fact),
                to: fact_label(nearest.fact),
                from_fact_id: rental.fact.id.clone(),
                to_fact_id: nearest.fact.id.clone(),
                slack_minutes: slack,
                band: band_for(HandoffKind::RentalReturn, rental.fact.fact_type, slack),
                at: rental.arrival.to_string(),
            });
        }
    }
    handoffs
}

/// The leg whose gap to the commitment is smallest in absolute terms, within
/// the hand-off horizon. `None` when nothing is close enough to be related.
fn nearest_by<'a>(legs: &'a [Leg<'a>], gap: impl Fn(&Leg<'a>) -> i64) -> Option<&'a Leg<'a>> {
    legs.iter()
        .filter(|leg| gap(leg).abs() <= MAX_HANDOFF_MINUTES)
        .min_by_key(|leg| (gap(leg).abs(), leg.fact.id.clone()))
}

/// Which legs carry weight: something later depends on them arriving on time.
fn exposed_legs(scheduled: &[Leg<'_>], handoffs: &[Handoff]) -> Vec<ExposedLeg> {
    let mut exposed: Vec<ExposedLeg> = scheduled
        .iter()
        .filter_map(|leg| {
            let from_here: Vec<&Handoff> = handoffs
                .iter()
                .filter(|handoff| handoff.from_fact_id == leg.fact.id)
                .collect();
            let absorbs = from_here
                .iter()
                .map(|handoff| handoff.slack_minutes.max(0))
                .min()?;
            // Everything that has to happen after this leg lands, whether or not
            // it hangs off this leg directly.
            let dependents = handoffs
                .iter()
                .filter(|handoff| handoff.at >= leg.arrival.to_string())
                .count() as u32;
            Some(ExposedLeg {
                fact_id: leg.fact.id.clone(),
                label: fact_label(leg.fact),
                absorbs_minutes: absorbs,
                dependents,
            })
        })
        .collect();
    exposed.sort_by(|left, right| {
        left.absorbs_minutes
            .cmp(&right.absorbs_minutes)
            .then_with(|| right.dependents.cmp(&left.dependents))
            .then_with(|| left.fact_id.cmp(&right.fact_id))
    });
    exposed
}

/// Everything worth reaching for, from what the workspace already holds.
fn pointers(facts: &[ConfirmedFact], context: DisruptionContext<'_>) -> Vec<FallbackPointer> {
    let mut pointers = Vec::new();
    let mut seen_carriers: Vec<String> = Vec::new();
    for fact in facts {
        if !fact.fact_type.is_journey() {
            continue;
        }
        let carrier = fact
            .payload
            .carrier_name
            .as_deref()
            .or(fact.payload.airline_name.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(carrier) = carrier else { continue };
        if seen_carriers.iter().any(|seen| seen == carrier) {
            continue;
        }
        seen_carriers.push(carrier.to_owned());
        pointers.push(FallbackPointer::CarrierOnConfirmation {
            carrier: carrier.to_owned(),
            fact_id: fact.id.clone(),
        });
    }
    for airport in context.nearest_airports {
        pointers.push(FallbackPointer::AlternateAirport {
            name: airport.name.clone(),
            iata: airport.iata.clone(),
            distance_km: airport.distance_km.round() as u32,
        });
    }
    for mission in context.missions {
        pointers.push(FallbackPointer::DiplomaticMission {
            sending_country: mission.sending_country.clone(),
            city: mission.city.clone(),
            kind: mission.kind,
        });
    }
    pointers
}

/// Thresholds, in minutes, for (tight, short, comfortable).
///
/// They differ by what the traveler is getting off, because the walk out of a
/// wide-body arrival with a hold bag is not the walk off a regional train.
/// These are cautions this product authored, not any operator's published
/// minimum connection time — which this product does not have and does not
/// claim to.
fn band_for(kind: HandoffKind, from_type: FactType, slack: i64) -> HandoffBand {
    if slack < 0 {
        return HandoffBand::Impossible;
    }
    let (tight, short, comfortable) = match kind {
        HandoffKind::Connection if from_type == FactType::FlightSegment => (75, 150, 300),
        HandoffKind::Connection => (20, 45, 120),
        HandoffKind::RentalPickup => (30, 60, 120),
        HandoffKind::RentalReturn => (45, 90, 180),
    };
    if slack < tight {
        HandoffBand::Tight
    } else if slack < short {
        HandoffBand::Short
    } else if slack < comfortable {
        HandoffBand::Comfortable
    } else {
        HandoffBand::Ample
    }
}

/// Whole minutes from one local wall clock to another, negative when `to` is
/// first.
///
/// Asked for in minutes directly rather than read off a span's hour and minute
/// fields, which would silently drop the day component and report a leg leaving
/// 25 hours later as leaving in one.
fn minutes_between(from: DateTime, to: DateTime) -> i64 {
    from.until((Unit::Minute, to))
        .map(|span| span.get_minutes())
        .unwrap_or(0)
}

fn parse_datetime(value: &str) -> Option<DateTime> {
    value.trim().parse::<DateTime>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactPayload};

    fn leg(id: &str, fact_type: FactType, departure: &str, arrival: &str) -> ConfirmedFact {
        ConfirmedFact {
            id: id.to_owned(),
            trip_id: "trip_1".to_owned(),
            fact_type,
            payload: FactPayload {
                departure_local: Some(departure.to_owned()),
                arrival_local: Some(arrival.to_owned()),
                ..payload_for(fact_type)
            },
            method: ExtractionMethod::Structured,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-08-01T00:00:00Z".to_owned(),
            source_removed: false,
        }
    }

    fn payload_for(fact_type: FactType) -> FactPayload {
        match fact_type {
            FactType::FlightSegment => FactPayload {
                airline_name: Some("Nimbus Air".to_owned()),
                flight_number: Some("412".to_owned()),
                ..FactPayload::default()
            },
            _ => FactPayload {
                carrier_name: Some("Meridian Rail".to_owned()),
                ..FactPayload::default()
            },
        }
    }

    #[test]
    fn an_empty_trip_yields_an_empty_plan() {
        let plan = build_disruption_plan(&[], DisruptionContext::default());
        assert!(plan.is_empty());
    }

    #[test]
    fn a_connection_reports_its_real_slack() {
        let facts = [
            leg(
                "fact_a",
                FactType::FlightSegment,
                "2026-08-03T08:00",
                "2026-08-03T10:00",
            ),
            leg(
                "fact_b",
                FactType::RailJourney,
                "2026-08-03T10:45",
                "2026-08-03T12:30",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        assert_eq!(plan.handoffs.len(), 1);
        let handoff = &plan.handoffs[0];
        assert_eq!(handoff.kind, HandoffKind::Connection);
        assert_eq!(handoff.slack_minutes, 45);
        // 45 minutes off a flight is tight; the same 45 off a train would not be.
        assert_eq!(handoff.band, HandoffBand::Tight);
        assert_eq!(handoff.from_fact_id, "fact_a");
        assert_eq!(handoff.to_fact_id, "fact_b");
    }

    #[test]
    fn the_band_depends_on_what_the_traveler_is_getting_off() {
        assert_eq!(
            band_for(HandoffKind::Connection, FactType::FlightSegment, 45),
            HandoffBand::Tight
        );
        assert_eq!(
            band_for(HandoffKind::Connection, FactType::RailJourney, 45),
            HandoffBand::Comfortable
        );
    }

    #[test]
    fn slack_is_measured_across_midnight() {
        let facts = [
            leg(
                "fact_a",
                FactType::CoachJourney,
                "2026-08-03T21:00",
                "2026-08-03T23:40",
            ),
            leg(
                "fact_b",
                FactType::RailJourney,
                "2026-08-04T00:20",
                "2026-08-04T03:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        assert_eq!(plan.handoffs[0].slack_minutes, 40);
    }

    #[test]
    fn a_gap_past_a_day_is_not_a_handoff() {
        let facts = [
            leg(
                "fact_a",
                FactType::FerryCrossing,
                "2026-08-03T08:00",
                "2026-08-03T12:00",
            ),
            leg(
                "fact_b",
                FactType::FlightSegment,
                "2026-08-05T09:00",
                "2026-08-05T11:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        assert!(
            plan.handoffs.is_empty(),
            "two days apart is the trip continuing, not a connection"
        );
    }

    #[test]
    fn an_unreadable_time_yields_no_handoff_rather_than_an_assumed_one() {
        let mut broken = leg(
            "fact_a",
            FactType::RailJourney,
            "2026-08-03T08:00",
            "2026-08-03T10:00",
        );
        broken.payload.arrival_local = Some("sometime tuesday".to_owned());
        let facts = [
            broken,
            leg(
                "fact_b",
                FactType::RailJourney,
                "2026-08-03T10:45",
                "2026-08-03T12:30",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        assert!(plan.handoffs.is_empty());
    }

    #[test]
    fn an_overlap_is_left_to_the_itinerary_checks() {
        let facts = [
            leg(
                "fact_a",
                FactType::FlightSegment,
                "2026-08-03T08:00",
                "2026-08-03T12:00",
            ),
            leg(
                "fact_b",
                FactType::FlightSegment,
                "2026-08-03T10:00",
                "2026-08-03T14:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        assert!(
            plan.handoffs.is_empty(),
            "a negative connection is a conflict, and reporting it twice in two \
             vocabularies makes one defect look like two"
        );
    }

    #[test]
    fn a_hire_car_gets_its_two_ends_measured_without_joining_the_chain() {
        let facts = [
            leg(
                "fact_air",
                FactType::FlightSegment,
                "2026-08-03T08:00",
                "2026-08-03T10:00",
            ),
            leg(
                "fact_car",
                FactType::CarRental,
                "2026-08-03T10:40",
                "2026-08-06T07:30",
            ),
            leg(
                "fact_home",
                FactType::FlightSegment,
                "2026-08-06T09:00",
                "2026-08-06T13:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        let kinds: Vec<HandoffKind> = plan.handoffs.iter().map(|handoff| handoff.kind).collect();
        assert!(kinds.contains(&HandoffKind::RentalPickup));
        assert!(kinds.contains(&HandoffKind::RentalReturn));
        // The car spans three days, so it must never read as a leg the traveler
        // is riding between the two flights.
        assert!(
            !kinds.contains(&HandoffKind::Connection),
            "a parked hire car is not a connection"
        );
        let pickup = plan
            .handoffs
            .iter()
            .find(|handoff| handoff.kind == HandoffKind::RentalPickup)
            .expect("pickup");
        assert_eq!(pickup.slack_minutes, 40);
        let ret = plan
            .handoffs
            .iter()
            .find(|handoff| handoff.kind == HandoffKind::RentalReturn)
            .expect("return");
        assert_eq!(ret.slack_minutes, 90);
    }

    #[test]
    fn a_car_booked_from_before_the_traveler_lands_is_reported() {
        // Nothing else in the tree catches this: hire cars are exempt from the
        // overlap check precisely because their window legitimately spans.
        let facts = [
            leg(
                "fact_air",
                FactType::FlightSegment,
                "2026-08-03T08:00",
                "2026-08-03T14:00",
            ),
            leg(
                "fact_car",
                FactType::CarRental,
                "2026-08-03T11:00",
                "2026-08-06T07:30",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        let pickup = plan
            .handoffs
            .iter()
            .find(|handoff| handoff.kind == HandoffKind::RentalPickup)
            .expect("pickup");
        assert_eq!(pickup.slack_minutes, -180);
        assert_eq!(pickup.band, HandoffBand::Impossible);
    }

    #[test]
    fn the_tightest_handoff_is_reported_first() {
        let facts = [
            leg(
                "fact_a",
                FactType::RailJourney,
                "2026-08-03T06:00",
                "2026-08-03T08:00",
            ),
            leg(
                "fact_b",
                FactType::RailJourney,
                "2026-08-03T11:00",
                "2026-08-03T12:00",
            ),
            leg(
                "fact_c",
                FactType::RailJourney,
                "2026-08-03T12:10",
                "2026-08-03T13:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        assert_eq!(plan.handoffs.len(), 2);
        assert_eq!(plan.handoffs[0].slack_minutes, 10);
        assert_eq!(plan.handoffs[1].slack_minutes, 180);
    }

    #[test]
    fn an_exposed_leg_says_what_it_can_absorb_and_what_waits_on_it() {
        let facts = [
            leg(
                "fact_a",
                FactType::FlightSegment,
                "2026-08-03T06:00",
                "2026-08-03T08:00",
            ),
            leg(
                "fact_b",
                FactType::RailJourney,
                "2026-08-03T08:30",
                "2026-08-03T10:00",
            ),
            leg(
                "fact_c",
                FactType::RailJourney,
                "2026-08-03T11:00",
                "2026-08-03T12:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        let first = &plan.exposed_legs[0];
        assert_eq!(first.fact_id, "fact_a");
        assert_eq!(first.absorbs_minutes, 30);
        assert!(first.dependents >= 1);
        // The last leg has nothing behind it, so it is not exposed.
        assert!(
            plan.exposed_legs
                .iter()
                .all(|exposed| exposed.fact_id != "fact_c")
        );
    }

    #[test]
    fn pointers_carry_no_url_and_no_invented_carrier() {
        let facts = [
            leg(
                "fact_air",
                FactType::FlightSegment,
                "2026-08-03T08:00",
                "2026-08-03T10:00",
            ),
            leg(
                "fact_rail",
                FactType::RailJourney,
                "2026-08-03T11:00",
                "2026-08-03T12:00",
            ),
        ];
        let plan = build_disruption_plan(&facts, DisruptionContext::default());
        let serialized = serde_json::to_string(&plan.pointers).expect("json");
        assert!(
            !serialized.contains("http"),
            "the playbook must not carry a URL: {serialized}"
        );
        // Exactly the two operators the traveler's own confirmations name.
        assert_eq!(plan.pointers.len(), 2);
        assert!(serialized.contains("Nimbus Air"));
        assert!(serialized.contains("Meridian Rail"));
    }

    #[test]
    fn a_leg_with_no_named_operator_offers_no_carrier_pointer() {
        let mut anonymous = leg(
            "fact_rail",
            FactType::RailJourney,
            "2026-08-03T11:00",
            "2026-08-03T12:00",
        );
        anonymous.payload.carrier_name = None;
        let plan = build_disruption_plan(&[anonymous], DisruptionContext::default());
        assert!(
            plan.pointers.is_empty(),
            "an unnamed operator must not be guessed at"
        );
    }

    #[test]
    fn a_stay_is_not_a_leg() {
        let mut stay = leg(
            "fact_stay",
            FactType::LodgingStay,
            "2026-08-03T11:00",
            "2026-08-03T12:00",
        );
        // A stay carries dates, not departure stamps.
        stay.payload = FactPayload {
            property_name: Some("Hotel Example".to_owned()),
            checkin_date: Some("2026-08-03".to_owned()),
            checkout_date: Some("2026-08-06".to_owned()),
            ..FactPayload::default()
        };
        let plan = build_disruption_plan(&[stay], DisruptionContext::default());
        assert!(plan.is_empty());
    }
}
