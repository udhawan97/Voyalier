//! Nearest airports to a point, offline.
//!
//! A compact list of scheduled-service airports (large and medium, with IATA
//! codes) is compiled in from OurAirports (public domain). Given a latitude and
//! longitude — the destination the facts snapshot already resolved — this
//! returns the closest airports by great-circle distance. Network-free and
//! deterministic: distance is a fact, and Voyalier does not editorialize which
//! airport is "best".

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The bundled airport list: `IATA,lat,lon,{L|M},name` per line, sorted by IATA.
/// Names carry no commas (the build step stripped them), so a split on the
/// first four commas is exact.
const AIRPORTS_CSV: &str = include_str!("data/airports.csv");

/// Mean Earth radius in kilometres, for the haversine distance.
const EARTH_RADIUS_KM: f64 = 6371.0;

/// How large an airport is, as OurAirports classifies it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AirportSize {
    Large,
    Medium,
}

/// One airport near a point, with its distance from that point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyAirport {
    pub iata: String,
    pub name: String,
    /// Great-circle distance from the query point, kilometres, one decimal.
    pub distance_km: f64,
    pub size: AirportSize,
}

/// A parsed row of the bundled list, borrowing from the embedded string.
struct Airport {
    iata: &'static str,
    name: &'static str,
    lat: f64,
    lon: f64,
    size: AirportSize,
}

/// Parse the embedded CSV once. A malformed line is skipped rather than
/// panicking — the list is compiled in, so this only guards a bad build.
fn airports() -> &'static [Airport] {
    static PARSED: OnceLock<Vec<Airport>> = OnceLock::new();
    PARSED.get_or_init(|| {
        AIRPORTS_CSV
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(5, ',');
                let iata = parts.next()?;
                let lat = parts.next()?.parse().ok()?;
                let lon = parts.next()?.parse().ok()?;
                let size = match parts.next()? {
                    "L" => AirportSize::Large,
                    "M" => AirportSize::Medium,
                    _ => return None,
                };
                let name = parts.next()?;
                Some(Airport {
                    iata,
                    name,
                    lat,
                    lon,
                    size,
                })
            })
            .collect()
    })
}

/// Great-circle distance in kilometres between two points.
fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let delta_lat = (lat2 - lat1).to_radians();
    let delta_lon = (lon2 - lon1).to_radians();
    let a = (delta_lat / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (delta_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().asin()
}

/// The `limit` airports nearest to the point, closest first.
pub fn nearest_airports(latitude: f64, longitude: f64, limit: usize) -> Vec<NearbyAirport> {
    if limit == 0 {
        return Vec::new();
    }
    let mut scored: Vec<(f64, &'static Airport)> = airports()
        .iter()
        .map(|airport| {
            (
                haversine_km(latitude, longitude, airport.lat, airport.lon),
                airport,
            )
        })
        .collect();
    // total_cmp orders NaN deterministically; there should be none, but this
    // never panics the way partial_cmp().unwrap() could.
    scored.sort_by(|a, b| a.0.total_cmp(&b.0));
    scored
        .into_iter()
        .take(limit)
        .map(|(distance, airport)| NearbyAirport {
            iata: airport.iata.to_owned(),
            name: airport.name.to_owned(),
            distance_km: (distance * 10.0).round() / 10.0,
            size: airport.size,
        })
        .collect()
}

/// One airport from the bundled list, identified rather than located relative
/// to a query point. Borrowed statics — the table is compiled in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AirportLocation {
    pub iata: &'static str,
    pub name: &'static str,
    pub latitude: f64,
    pub longitude: f64,
    pub size: AirportSize,
}

/// The bundled airport with this IATA code, case-insensitively.
pub fn airport_by_iata(code: &str) -> Option<AirportLocation> {
    let wanted = code.trim();
    if wanted.len() != 3 {
        return None;
    }
    airports()
        .iter()
        .find(|airport| airport.iata.eq_ignore_ascii_case(wanted))
        .map(|airport| AirportLocation {
            iata: airport.iata,
            name: airport.name,
            latitude: airport.lat,
            longitude: airport.lon,
            size: airport.size,
        })
}

/// Airports matching a typed query, best match first, capped at `limit`.
///
/// Ranked in four tiers — exact code, code prefix, name prefix, name substring
/// — because a traveler either knows the code or knows the airport, and the two
/// should not compete. Within a tier the order is by IATA code, so the list is
/// stable rather than dependent on the table's row order.
///
/// A blank query returns nothing: an airport field with three thousand entries
/// behind it should stay quiet until the traveler has said something.
pub fn matching_airports(query: &str, limit: usize) -> Vec<AirportLocation> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut tiered: Vec<(u8, &'static Airport)> = airports()
        .iter()
        .filter_map(|airport| {
            let code = airport.iata.to_lowercase();
            let name = airport.name.to_lowercase();
            let tier = if code == needle {
                0
            } else if code.starts_with(&needle) {
                1
            } else if name.starts_with(&needle) {
                2
            } else if name.contains(&needle) {
                3
            } else {
                return None;
            };
            Some((tier, airport))
        })
        .collect();
    tiered.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.iata.cmp(b.1.iata)));
    tiered
        .into_iter()
        .take(limit)
        .map(|(_, airport)| AirportLocation {
            iata: airport.iata,
            name: airport.name,
            latitude: airport.lat,
            longitude: airport.lon,
            size: airport.size,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_nearest_airports_by_distance() {
        let near = nearest_airports(35.0116, 135.7681, 3); // central Kyoto
        let codes: Vec<_> = near.iter().map(|a| a.iata.as_str()).collect();
        assert_eq!(codes, ["ITM", "UKB", "KIX"]);
        assert!(near[0].distance_km < near[1].distance_km);
        assert!(near[1].distance_km < near[2].distance_km);
        assert!(
            (near[0].distance_km - 39.0).abs() < 3.0,
            "{}",
            near[0].distance_km
        );
        assert_eq!(near[0].name, "Osaka Itami International Airport");
        assert_eq!(near[0].size, AirportSize::Large);
    }

    #[test]
    fn covers_other_regions_and_bounds_the_result() {
        let london = nearest_airports(51.5074, -0.1278, 4);
        assert_eq!(
            london.iter().map(|a| a.iata.as_str()).collect::<Vec<_>>(),
            ["LCY", "LHR", "LGW", "LTN"]
        );
        // A remote point still returns the closest, never panics or empties.
        let remote = nearest_airports(0.0, -140.0, 2);
        assert_eq!(remote.len(), 2);
        assert!(remote[0].distance_km > 500.0);
        // limit is honoured and never exceeds the dataset.
        assert_eq!(nearest_airports(35.0, 135.0, 0).len(), 0);
        assert!(nearest_airports(35.0, 135.0, 100_000).len() < 4000);
    }

    #[test]
    fn matches_airports_by_code_and_by_name() {
        // An exact code wins, even though other codes start with those letters.
        let exact = matching_airports("kix", 5);
        assert_eq!(exact[0].iata, "KIX");
        assert_eq!(exact[0].name, "Kansai International Airport");

        // A name query finds the airport whose code the traveler does not know
        // -- the whole point of the field, since nobody memorises "CDG".
        let by_name = matching_airports("charles de gaulle", 5);
        assert_eq!(by_name[0].iata, "CDG");

        // A code prefix ranks ahead of a name that merely contains the letters.
        let prefix = matching_airports("LHR", 5);
        assert_eq!(prefix[0].iata, "LHR");

        // Bounded, blank-safe, and never a panic on an unknown query.
        assert!(matching_airports("hanedaa", 5).is_empty());
        assert!(matching_airports("", 5).is_empty());
        assert!(matching_airports("a", 3).len() <= 3);
    }

    #[test]
    fn looks_an_airport_up_by_its_iata_code() {
        let haneda = airport_by_iata("HND").expect("haneda");
        assert_eq!(haneda.name, "Tokyo Haneda International Airport");
        assert!((haneda.latitude - 35.55).abs() < 0.1);
        assert!((haneda.longitude - 139.78).abs() < 0.1);

        // Case-insensitive, because a traveler types what is on their ticket.
        assert_eq!(airport_by_iata("hnd").map(|a| a.iata), Some("HND"));
        assert!(airport_by_iata("ZZZ").is_none());
        assert!(airport_by_iata("").is_none());
    }

    #[test]
    fn the_bundled_list_is_well_formed() {
        let all = airports();
        assert!(all.len() > 3000, "airports: {}", all.len());
        // Every row has a plausible IATA code and coordinates.
        for airport in all {
            assert_eq!(airport.iata.len(), 3, "iata {:?}", airport.iata);
            assert!((-90.0..=90.0).contains(&airport.lat));
            assert!((-180.0..=180.0).contains(&airport.lon));
            assert!(!airport.name.is_empty());
        }
    }
}
