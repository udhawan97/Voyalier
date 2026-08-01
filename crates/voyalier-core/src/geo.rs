//! Great-circle distance, in one place.
//!
//! Three modules need the distance between two points — the nearest airports,
//! the World Heritage sites in range, and the flight-emissions estimate — and
//! each carried its own copy of the same eight lines and its own
//! `EARTH_RADIUS_KM`. Identical copies stay identical only by luck: `co2.rs`'s
//! const already carried a comment saying it matched `airports.rs`, which is a
//! note where a dependency belongs.
//!
//! Nothing here is re-exported. Distance is how those three modules do their
//! work, not something a caller of the crate needs to know about.

/// Mean Earth radius in kilometres, for the haversine distance.
const EARTH_RADIUS_KM: f64 = 6371.0;

/// Great-circle distance in kilometres between two points.
pub(crate) fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let delta_lat = (lat2 - lat1).to_radians();
    let delta_lon = (lon2 - lon1).to_radians();
    let a = (delta_lat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (delta_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().asin()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_point_is_no_distance_from_itself() {
        assert_eq!(haversine_km(35.011, 135.768, 35.011, 135.768), 0.0);
    }

    #[test]
    fn kyoto_to_tokyo_is_about_three_hundred_and_sixty_kilometres() {
        let distance = haversine_km(35.011, 135.768, 35.690, 139.692);
        assert!(
            (360.0..368.0).contains(&distance),
            "expected ~364 km, got {distance}"
        );
    }

    #[test]
    fn the_distance_is_the_same_in_either_direction() {
        let there = haversine_km(51.507, -0.128, -33.868, 151.209);
        let back = haversine_km(-33.868, 151.209, 51.507, -0.128);
        assert_eq!(there, back);
    }

    /// Antipodes are the case a naive `acos` formulation loses to floating-point
    /// error, and the case `asin` on a value a hair over 1.0 would turn into NaN.
    #[test]
    fn antipodes_are_half_the_circumference_and_not_nan() {
        let distance = haversine_km(0.0, 0.0, 0.0, 180.0);
        assert!(distance.is_finite(), "antipodal distance was {distance}");
        assert!(
            (20_010.0..20_020.0).contains(&distance),
            "expected ~20015 km, got {distance}"
        );
    }
}
