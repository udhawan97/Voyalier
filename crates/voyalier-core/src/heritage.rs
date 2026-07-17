//! UNESCO World Heritage sites near a point, offline.
//!
//! A compact list of World Heritage sites (name, coordinates, inscription year)
//! is compiled in from Wikidata (CC0). Given the destination coordinates the
//! facts snapshot already resolved, this returns the sites within a radius by
//! great-circle distance. Network-free and deterministic; a convenience list of
//! notable places nearby, never a claim of completeness.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// The bundled site list: `name<TAB>lat<TAB>lon<TAB>year` per line, sorted by
/// name. Names carry no tabs, so a split on tabs is exact; the year may be empty.
const WHS_TSV: &str = include_str!("data/whs.tsv");

/// Mean Earth radius in kilometres, for the haversine distance.
const EARTH_RADIUS_KM: f64 = 6371.0;

/// One World Heritage site near a point, with its distance from that point.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeritageSite {
    pub name: String,
    /// Great-circle distance from the query point, kilometres, one decimal.
    pub distance_km: f64,
    /// Year the site was inscribed, when Wikidata records it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<u16>,
}

/// A parsed row of the bundled list, borrowing from the embedded string.
struct Site {
    name: &'static str,
    lat: f64,
    lon: f64,
    year: Option<u16>,
}

/// Parse the embedded TSV once. A malformed line is skipped rather than
/// panicking — the list is compiled in, so this only guards a bad build.
fn sites() -> &'static [Site] {
    static PARSED: OnceLock<Vec<Site>> = OnceLock::new();
    PARSED.get_or_init(|| {
        WHS_TSV
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(4, '\t');
                let name = parts.next()?;
                let lat = parts.next()?.parse().ok()?;
                let lon = parts.next()?.parse().ok()?;
                // The year field may be empty; that is a `None`, not a skip.
                let year = parts.next().and_then(|field| field.parse().ok());
                if name.is_empty() {
                    return None;
                }
                Some(Site {
                    name,
                    lat,
                    lon,
                    year,
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

/// The `limit` World Heritage sites within `radius_km` of the point, closest
/// first. Empty when nothing is in range.
pub fn world_heritage_near(
    latitude: f64,
    longitude: f64,
    radius_km: f64,
    limit: usize,
) -> Vec<HeritageSite> {
    if limit == 0 {
        return Vec::new();
    }
    let mut scored: Vec<(f64, &'static Site)> = sites()
        .iter()
        .map(|site| (haversine_km(latitude, longitude, site.lat, site.lon), site))
        .filter(|(distance, _)| *distance <= radius_km)
        .collect();
    // total_cmp orders any NaN deterministically instead of panicking.
    scored.sort_by(|a, b| a.0.total_cmp(&b.0));
    scored
        .into_iter()
        .take(limit)
        .map(|(distance, site)| HeritageSite {
            name: site.name.to_owned(),
            distance_km: (distance * 10.0).round() / 10.0,
            year: site.year,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_world_heritage_sites_near_a_point() {
        // Right at Aachen Cathedral (a bundled site, inscribed 1978).
        let near = world_heritage_near(50.7747, 6.0839, 200.0, 5);
        assert!(!near.is_empty());
        assert_eq!(near[0].name, "Aachen Cathedral");
        assert!(near[0].distance_km < 2.0, "{}", near[0].distance_km);
        assert_eq!(near[0].year, Some(1978));
        // Sorted by distance, all within radius, bounded by the limit.
        assert!(
            near.windows(2)
                .all(|w| w[0].distance_km <= w[1].distance_km)
        );
        assert!(near.iter().all(|s| s.distance_km <= 200.0));
        assert!(near.len() <= 5);
    }

    #[test]
    fn bounds_and_empties_correctly() {
        // Middle of the Pacific: nothing within a tight radius.
        assert!(world_heritage_near(0.0, -150.0, 100.0, 5).is_empty());
        // A zero limit yields nothing, never a panic.
        assert!(world_heritage_near(50.7747, 6.0839, 200.0, 0).is_empty());
    }

    #[test]
    fn the_bundled_list_is_well_formed() {
        let all = sites();
        assert!(all.len() > 800, "sites: {}", all.len());
        for site in all {
            assert!((-90.0..=90.0).contains(&site.lat));
            assert!((-180.0..=180.0).contains(&site.lon));
            assert!(!site.name.is_empty());
        }
    }
}
