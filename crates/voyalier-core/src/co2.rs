//! An offline carbon estimate for a trip's confirmed flights.
//!
//! IO-free and network-free: great-circle distance between two bundled airport
//! coordinates, multiplied by a published per-passenger-kilometre factor. It is
//! an estimate and is labelled as one everywhere it is shown — actual emissions
//! depend on the aircraft, the load factor, the routing and the cabin, none of
//! which a confirmed flight fact carries.
//!
//! **Why one factor rather than haul bands.** DESNZ publishes separate domestic,
//! short-haul and long-haul factors, but its own definition of those bands is
//! territorial rather than metric: domestic is within the UK, short-haul within
//! Europe, long-haul outside it. The bundled airport table carries coordinates
//! and no country, so those bands cannot be applied without inventing a
//! kilometre threshold DESNZ does not publish. The factor used here is instead
//! the row DESNZ added for exactly this case — flights between non-UK
//! destinations — which its own notes describe as a high-level analysis.
//!
//! ponytail: one average factor, no cabin class and no haul banding. Adding a
//! country column to the airport table would allow the real bands; the estimate
//! is labelled high-level until then.

use serde::{Deserialize, Serialize};

use crate::airports::airport_by_iata;

/// Kilograms of CO₂-equivalent per passenger-kilometre.
///
/// UK Department for Energy Security and Net Zero, *Greenhouse gas reporting:
/// conversion factors 2026* (published 11 June 2026), "Business travel- air" →
/// "International, to/from non-UK" → "Average passenger", **with** radiative
/// forcing. Open Government Licence v3.0.
///
/// The with-RF figure is the one carried because it accounts for the extra
/// warming caused by emitting at altitude, which is the number a traveler asking
/// about a flight's climate impact is actually asking for. DESNZ reissues these
/// annually — see [`FACTOR_YEAR`].
const KG_CO2E_PER_PASSENGER_KM: f64 = 0.14253;

/// The publication year of [`KG_CO2E_PER_PASSENGER_KM`], shown beside the
/// estimate so a stale factor is visible rather than silent.
pub const FACTOR_YEAR: u16 = 2026;

/// Mean Earth radius in kilometres, matching `airports.rs`.
const EARTH_RADIUS_KM: f64 = 6371.0;

/// A trip's estimated flight emissions, and how much of the trip it covers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlightEmissions {
    /// Estimated kilograms of CO₂-equivalent, one passenger, counted legs only.
    pub kg_co2e: u32,
    /// Total great-circle distance of the counted legs, kilometres.
    pub distance_km: u32,
    /// Confirmed flights included in the estimate.
    pub counted_flights: u32,
    /// Confirmed flights left out because their airport codes were missing or
    /// not in the bundled table. Non-zero means the estimate is a floor, and the
    /// interface must say so rather than presenting a short total as the trip's.
    pub unresolved_flights: u32,
    /// The DESNZ factor year behind the estimate.
    pub factor_year: u16,
}

/// Great-circle distance in kilometres between two points.
fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let delta_lat = (lat2 - lat1).to_radians();
    let delta_lon = (lon2 - lon1).to_radians();
    let a = (delta_lat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (delta_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().asin()
}

/// Estimate a trip's flight emissions from its confirmed legs.
///
/// Each leg is the pair of IATA codes on a confirmed flight fact. A leg whose
/// codes are absent, unknown to the bundled table, or identical contributes
/// nothing to the total and is counted as unresolved — an estimate that quietly
/// skipped a leg would read as the whole trip's footprint while being a fraction
/// of it.
///
/// Returns `None` when the trip has no confirmed flights at all, which is a
/// different thing from an estimate of zero.
pub fn estimate_flight_emissions<'a>(
    legs: impl IntoIterator<Item = (Option<&'a str>, Option<&'a str>)>,
) -> Option<FlightEmissions> {
    let mut distance_km = 0.0_f64;
    let mut counted = 0_u32;
    let mut unresolved = 0_u32;

    for (departure, arrival) in legs {
        let resolved = departure
            .and_then(airport_by_iata)
            .zip(arrival.and_then(airport_by_iata))
            // A leg that departs and arrives at the same airport is a data
            // error, not a zero-kilometre flight.
            .filter(|(from, to)| from.iata != to.iata);
        match resolved {
            Some((from, to)) => {
                distance_km +=
                    haversine_km(from.latitude, from.longitude, to.latitude, to.longitude);
                counted += 1;
            }
            None => unresolved += 1,
        }
    }

    if counted == 0 && unresolved == 0 {
        return None;
    }

    Some(FlightEmissions {
        kg_co2e: (distance_km * KG_CO2E_PER_PASSENGER_KM).round() as u32,
        distance_km: distance_km.round() as u32,
        counted_flights: counted,
        unresolved_flights: unresolved,
        factor_year: FACTOR_YEAR,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimates_a_long_haul_leg_from_its_airports() {
        let estimate = estimate_flight_emissions([(Some("ORD"), Some("KIX"))]).expect("one flight");
        // Chicago to Osaka is a little over 10,000 km great-circle.
        assert!(
            (10_000..=10_600).contains(&estimate.distance_km),
            "{} km",
            estimate.distance_km
        );
        // At 0.14253 kg/passenger-km that is roughly 1.5 tonnes.
        assert!(
            (1_400..=1_520).contains(&estimate.kg_co2e),
            "{} kg",
            estimate.kg_co2e
        );
        assert_eq!(estimate.counted_flights, 1);
        assert_eq!(estimate.unresolved_flights, 0);
        assert_eq!(estimate.factor_year, FACTOR_YEAR);
    }

    #[test]
    fn adds_legs_together_and_is_symmetric() {
        let out = estimate_flight_emissions([(Some("LHR"), Some("CDG"))]).expect("out");
        let back = estimate_flight_emissions([(Some("CDG"), Some("LHR"))]).expect("back");
        assert_eq!(out.kg_co2e, back.kg_co2e);

        let round_trip =
            estimate_flight_emissions([(Some("LHR"), Some("CDG")), (Some("CDG"), Some("LHR"))])
                .expect("round trip");
        assert_eq!(round_trip.counted_flights, 2);
        // Distance is summed and rounded once at the end rather than per leg, so
        // the round trip is within a kilogram of twice one leg without being
        // required to equal a doubled rounding error.
        assert!(
            round_trip.kg_co2e.abs_diff(out.kg_co2e * 2) <= 1,
            "{} vs {}",
            round_trip.kg_co2e,
            out.kg_co2e * 2
        );
    }

    #[test]
    fn counts_what_it_could_not_resolve_rather_than_dropping_it() {
        // A missing code, an unknown code, and a leg that goes nowhere. None of
        // them may silently shrink the total into looking like the whole trip.
        let estimate = estimate_flight_emissions([
            (Some("ORD"), Some("KIX")),
            (None, Some("KIX")),
            (Some("ZZZ"), Some("KIX")),
            (Some("KIX"), Some("KIX")),
        ])
        .expect("estimate");
        assert_eq!(estimate.counted_flights, 1);
        assert_eq!(estimate.unresolved_flights, 3);

        // Lower case is what a traveler types; it must not become unresolved.
        let lower = estimate_flight_emissions([(Some("ord"), Some("kix"))]).expect("lower");
        assert_eq!(lower.counted_flights, 1);
    }

    #[test]
    fn no_flights_is_not_an_estimate_of_zero() {
        assert!(estimate_flight_emissions([]).is_none());

        // But a trip whose only flight cannot be resolved still reports, so the
        // interface can say the estimate is unavailable rather than say nothing.
        let unresolved = estimate_flight_emissions([(None, None)]).expect("unresolved");
        assert_eq!(unresolved.kg_co2e, 0);
        assert_eq!(unresolved.counted_flights, 0);
        assert_eq!(unresolved.unresolved_flights, 1);
    }
}
