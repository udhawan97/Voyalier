//! Deterministic packing suggestions.
//!
//! IO-free and offline: every suggestion is a rule over what the trip already
//! knows — the stored weather snapshot's normals and air-quality days, and the
//! confirmed facts. Nothing here fetches, guesses, or asks a model.
//!
//! Following ADR-0003's standing amendment, this module reports **codes and the
//! numbers behind them**; the interface owns the words. Every suggestion names
//! the reading that produced it, so a reader can check the reasoning instead of
//! taking a vibe on faith. No evidence means no suggestion.

use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use crate::climate::{AirQualityDay, ClimateNormals};
use crate::types::{ConfirmedFact, FactType, Trip};
use crate::weather::WeatherSnapshot;

// The numbers the rules turn on are declared once, in
// `packages/contracts/parity/packing.json`. These mirror that file and
// `parity_packing_matches_the_contract` holds them to it; the mock imports the
// same file rather than restating the numbers, so there is one declaration and
// a red test on either side if it moves.
//
/// Below this average low, warm layers are worth naming.
pub(crate) const COLD_LOW_C: f64 = 5.0;
/// At or above this average high, light clothing is worth naming.
pub(crate) const WARM_HIGH_C: f64 = 22.0;
/// At or above this share of wet days, rain gear is worth naming.
pub(crate) const WET_SHARE_PCT: f64 = 40.0;
/// At or above this UV index, sun protection is worth naming.
pub(crate) const HIGH_UV: f64 = 8.0;
/// At or above this US AQI, a mask is worth naming.
pub(crate) const POOR_AQI: u16 = 100;
/// At or above this many nights, laundry is worth naming.
pub(crate) const LAUNDRY_NIGHTS: i64 = 7;

/// What to consider packing. A closed set: each maps to exactly one sentence in
/// the interface's message catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackingCode {
    WarmLayers,
    LightClothing,
    RainShell,
    SunProtection,
    Mask,
    TravelDocuments,
    Laundry,
}

/// Why a suggestion fired. Each maps to one sentence, and carries the reading.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PackingReasonCode {
    /// `value` is the typical low in °C.
    AvgLow,
    /// `value` is the typical high in °C.
    AvgHigh,
    /// `value` is the share of typical days with rain, percent.
    WetDayShare,
    /// `value` is the highest UV index across the trip's days.
    UvIndex,
    /// `value` is the worst US AQI across the trip's days.
    Aqi,
    /// A confirmed flight is on the itinerary.
    HasFlight,
    /// `value` is the number of nights.
    Nights,
}

/// The reading behind one suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackingReason {
    pub code: PackingReasonCode,
    /// The number that produced the suggestion; absent for reasons that count
    /// nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackingSuggestion {
    pub code: PackingCode,
    pub reason: PackingReason,
}

fn suggestion(
    code: PackingCode,
    reason: PackingReasonCode,
    value: Option<f64>,
) -> PackingSuggestion {
    PackingSuggestion {
        code,
        reason: PackingReason {
            code: reason,
            value,
        },
    }
}

fn nights_between(start: &str, end: &str) -> Option<i64> {
    let start: Date = start.parse().ok()?;
    let end: Date = end.parse().ok()?;
    Some((end - start).get_days() as i64)
}

/// Build the trip's packing suggestions from the evidence it already holds.
///
/// Returns empty when there is no weather snapshot: without it there is no
/// evidence about the destination, and a guessed list would be worse than none.
pub fn build_packing_list(
    trip: &Trip,
    facts: &[ConfirmedFact],
    weather: Option<&WeatherSnapshot>,
) -> Vec<PackingSuggestion> {
    let Some(weather) = weather else {
        return Vec::new();
    };
    let mut list = Vec::new();

    if let Some(normals) = weather.normals.as_ref() {
        push_climate_suggestions(&mut list, normals);
    }
    push_air_suggestions(&mut list, &weather.air_quality);

    if facts
        .iter()
        .any(|fact| fact.fact_type == FactType::FlightSegment)
    {
        list.push(suggestion(
            PackingCode::TravelDocuments,
            PackingReasonCode::HasFlight,
            None,
        ));
    }
    if let Some(nights) = nights_between(&trip.start_date, &trip.end_date)
        && nights >= LAUNDRY_NIGHTS
    {
        list.push(suggestion(
            PackingCode::Laundry,
            PackingReasonCode::Nights,
            Some(nights as f64),
        ));
    }

    list.sort_by_key(|item| item.code);
    list
}

fn push_climate_suggestions(list: &mut Vec<PackingSuggestion>, normals: &ClimateNormals) {
    if normals.avg_low_c < COLD_LOW_C {
        list.push(suggestion(
            PackingCode::WarmLayers,
            PackingReasonCode::AvgLow,
            Some(normals.avg_low_c),
        ));
    }
    if normals.avg_high_c >= WARM_HIGH_C {
        list.push(suggestion(
            PackingCode::LightClothing,
            PackingReasonCode::AvgHigh,
            Some(normals.avg_high_c),
        ));
    }
    if normals.wet_day_share_pct >= WET_SHARE_PCT {
        list.push(suggestion(
            PackingCode::RainShell,
            PackingReasonCode::WetDayShare,
            Some(normals.wet_day_share_pct),
        ));
    }
}

fn push_air_suggestions(list: &mut Vec<PackingSuggestion>, days: &[AirQualityDay]) {
    let peak_uv = days
        .iter()
        .filter_map(|day| day.uv_index_max)
        .fold(f64::MIN, f64::max);
    if peak_uv >= HIGH_UV {
        list.push(suggestion(
            PackingCode::SunProtection,
            PackingReasonCode::UvIndex,
            Some(peak_uv),
        ));
    }
    let worst_aqi = days.iter().filter_map(|day| day.us_aqi_max).max();
    if let Some(worst) = worst_aqi
        && worst >= POOR_AQI
    {
        list.push(suggestion(
            PackingCode::Mask,
            PackingReasonCode::Aqi,
            Some(worst as f64),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ExtractionMethod, FactPayload, TripStatus};
    use crate::weather::WeatherCoverage;

    fn trip(start: &str, end: &str) -> Trip {
        Trip {
            id: "trip-1".into(),
            title: "Trip".into(),
            origin: "Chicago".into(),
            destination: "Kyoto".into(),
            start_date: start.into(),
            end_date: end.into(),
            status: TripStatus::Active,
            created_at: "2026-07-17T12:00:00Z".into(),
            updated_at: "2026-07-17T12:00:00Z".into(),
        }
    }

    fn flight() -> ConfirmedFact {
        ConfirmedFact {
            id: "fact-1".into(),
            trip_id: "trip-1".into(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload::default(),
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: "2026-07-17T12:00:00Z".into(),
            source_removed: false,
        }
    }

    fn normals(avg_high_c: f64, avg_low_c: f64, wet_day_share_pct: f64) -> ClimateNormals {
        ClimateNormals {
            years_sampled: 10,
            sample_days: 100,
            first_year: 2016,
            last_year: 2025,
            avg_high_c,
            avg_low_c,
            wet_day_share_pct,
            warmest_high_c: avg_high_c + 5.0,
            coldest_low_c: avg_low_c - 5.0,
        }
    }

    fn snapshot(
        normals: Option<ClimateNormals>,
        air_quality: Vec<AirQualityDay>,
    ) -> WeatherSnapshot {
        WeatherSnapshot {
            place_name: "Kyoto".into(),
            place_region: "Japan".into(),
            latitude: 35.0,
            longitude: 135.8,
            days: Vec::new(),
            coverage: WeatherCoverage::None,
            source_url: "https://open-meteo.com/".into(),
            retrieved_at: "2026-07-17T12:00:00Z".into(),
            normals,
            air_quality,
            alerts: Vec::new(),
        }
    }

    fn air(uv: Option<f64>, aqi: Option<u16>) -> AirQualityDay {
        AirQualityDay {
            date: "2026-11-03".into(),
            uv_index_max: uv,
            us_aqi_max: aqi,
            pm2_5_max: None,
        }
    }

    #[test]
    fn suggests_from_what_the_weather_and_the_itinerary_actually_say() {
        let weather = snapshot(
            Some(normals(8.0, -2.0, 55.0)),
            vec![air(Some(9.0), Some(120))],
        );
        let list = build_packing_list(
            &trip("2026-11-03", "2026-11-12"),
            &[flight()],
            Some(&weather),
        );
        let codes: Vec<_> = list.iter().map(|item| item.code).collect();
        assert!(codes.contains(&PackingCode::WarmLayers));
        assert!(codes.contains(&PackingCode::RainShell));
        assert!(codes.contains(&PackingCode::SunProtection));
        assert!(codes.contains(&PackingCode::Mask));
        assert!(codes.contains(&PackingCode::TravelDocuments));
        assert!(codes.contains(&PackingCode::Laundry)); // 9 nights
        // It is 8C typical: light clothing would be wrong.
        assert!(!codes.contains(&PackingCode::LightClothing));

        // Every suggestion carries the number that produced it, so the reason
        // is checkable rather than a vibe.
        let rain = list
            .iter()
            .find(|item| item.code == PackingCode::RainShell)
            .expect("rain");
        assert_eq!(rain.reason.code, PackingReasonCode::WetDayShare);
        assert_eq!(rain.reason.value, Some(55.0));
        let laundry = list
            .iter()
            .find(|item| item.code == PackingCode::Laundry)
            .expect("laundry");
        assert_eq!(laundry.reason.value, Some(9.0));
        let documents = list
            .iter()
            .find(|item| item.code == PackingCode::TravelDocuments)
            .expect("documents");
        assert_eq!(documents.reason.code, PackingReasonCode::HasFlight);
        assert_eq!(documents.reason.value, None);
    }

    #[test]
    fn a_warm_dry_short_trip_suggests_only_what_fits_it() {
        let weather = snapshot(
            Some(normals(28.0, 19.0, 5.0)),
            vec![air(Some(3.0), Some(20))],
        );
        let list = build_packing_list(&trip("2026-07-01", "2026-07-04"), &[], Some(&weather));
        let codes: Vec<_> = list.iter().map(|item| item.code).collect();
        assert_eq!(codes, vec![PackingCode::LightClothing]);
    }

    #[test]
    fn suggests_nothing_without_evidence() {
        // No weather snapshot means no claim about what to pack.
        assert!(
            build_packing_list(&trip("2026-11-03", "2026-11-12"), &[flight()], None).is_empty()
        );

        // A snapshot with no normals and no air readings still yields only what
        // the itinerary itself proves.
        let weather = snapshot(None, Vec::new());
        let list = build_packing_list(
            &trip("2026-11-03", "2026-11-04"),
            &[flight()],
            Some(&weather),
        );
        assert_eq!(
            list.iter().map(|item| item.code).collect::<Vec<_>>(),
            vec![PackingCode::TravelDocuments]
        );
    }
}
