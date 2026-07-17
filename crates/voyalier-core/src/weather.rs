//! Types and pure parsing for destination weather outlooks.
//!
//! Voyalier fetches a short-range daily forecast from Open-Meteo (keyless,
//! free for non-commercial use; data CC BY 4.0 — attribution "Weather data by
//! Open-Meteo.com" required). This module is IO-free: it parses the geocoding
//! and forecast responses and filters days to the trip window. Forecasts reach
//! at most ~16 days out, so a far-future trip honestly reports no coverage
//! instead of pretending. Weather is planning texture, never a safety claim.

use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use crate::alerts::WeatherAlert;
use crate::climate::{AirQualityDay, ClimateNormals};
use crate::types::{AppError, ErrorCode};

/// How much of the trip window the forecast could cover.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeatherCoverage {
    /// Every night of the trip window fell inside the forecast horizon.
    Full,
    /// Only the leading part of the trip is inside the horizon.
    Partial,
    /// The trip starts beyond the forecast horizon; no days available yet.
    None,
}

/// One forecast day, metric units, verbatim from the source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDay {
    /// ISO `YYYY-MM-DD` local to the destination.
    pub date: String,
    /// WMO weather interpretation code as sent by the source.
    pub weather_code: u8,
    /// Deterministic human description of `weather_code`.
    pub description: String,
    pub temp_max_c: f64,
    pub temp_min_c: f64,
    /// Daily maximum precipitation probability, percent, when provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub precipitation_chance_pct: Option<f64>,
}

/// A dated weather outlook for the trip's destination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherSnapshot {
    /// Geocoded place name, shown verbatim so a wrong geocode is visible.
    pub place_name: String,
    /// Country (and admin area when present) for disambiguation.
    pub place_region: String,
    pub latitude: f64,
    pub longitude: f64,
    /// Days inside the trip window that the forecast could cover, in order.
    pub days: Vec<WeatherDay>,
    pub coverage: WeatherCoverage,
    /// The human source page for attribution links.
    pub source_url: String,
    /// When this device retrieved the snapshot (RFC 3339).
    pub retrieved_at: String,
    /// What these calendar dates have usually been like here, when there is
    /// enough observed history to say. Describes the past, never the future.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normals: Option<ClimateNormals>,
    /// UV and air quality per trip day; empty when the layer was unavailable.
    #[serde(default)]
    pub air_quality: Vec<AirQualityDay>,
    /// Active official alerts for the destination. US destinations only (the
    /// NWS is the only keyless public-domain alert source Voyalier reaches),
    /// so empty elsewhere means "not covered", not "all clear".
    #[serde(default)]
    pub alerts: Vec<WeatherAlert>,
}

/// The place Open-Meteo's geocoder resolved a destination string to.
#[derive(Debug, Clone, PartialEq)]
pub struct GeocodedPlace {
    pub name: String,
    pub region: String,
    pub latitude: f64,
    pub longitude: f64,
    /// ISO-3166-1 alpha-2, verbatim from the geocoder. This is what decides
    /// whether a US-only source like the NWS applies — no second lookup.
    pub country_code: String,
    /// IANA timezone name (e.g. "Asia/Tokyo"), for resolving the local UTC
    /// offset without a second lookup. Empty when the geocoder omits it.
    pub timezone: String,
}

fn unreadable_source() -> AppError {
    AppError::new(
        ErrorCode::WeatherFetchFailed,
        "the weather source returned something Voyalier could not read",
    )
}

/// Parse the top geocoding result. No result is an error the user can act on
/// (edit the destination), not a silent guess.
pub fn parse_geocoding_response(json: &str) -> Result<GeocodedPlace, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let Some(first) = value
        .get("results")
        .and_then(|results| results.as_array())
        .and_then(|results| results.first())
    else {
        return Err(AppError::new(
            ErrorCode::WeatherFetchFailed,
            "the weather source could not find that destination on the map",
        ));
    };

    let name = first
        .get("name")
        .and_then(|field| field.as_str())
        .unwrap_or_default()
        .to_owned();
    let latitude = first
        .get("latitude")
        .and_then(|field| field.as_f64())
        .ok_or_else(unreadable_source)?;
    let longitude = first
        .get("longitude")
        .and_then(|field| field.as_f64())
        .ok_or_else(unreadable_source)?;
    let admin = first
        .get("admin1")
        .and_then(|field| field.as_str())
        .unwrap_or_default();
    let country = first
        .get("country")
        .and_then(|field| field.as_str())
        .unwrap_or_default();
    let region = match (admin.is_empty(), country.is_empty()) {
        (false, false) => format!("{admin}, {country}"),
        (true, false) => country.to_owned(),
        (false, true) => admin.to_owned(),
        (true, true) => String::new(),
    };

    if name.is_empty() {
        return Err(unreadable_source());
    }
    Ok(GeocodedPlace {
        name,
        region,
        latitude,
        longitude,
        country_code: first
            .get("country_code")
            .and_then(|field| field.as_str())
            .unwrap_or_default()
            .to_owned(),
        timezone: first
            .get("timezone")
            .and_then(|field| field.as_str())
            .unwrap_or_default()
            .to_owned(),
    })
}

/// Parse a daily forecast response and keep only days inside the trip window.
/// Coverage reports honestly how much of the trip the horizon reached.
pub fn parse_forecast_response(
    place: &GeocodedPlace,
    json: &str,
    trip_start_date: &str,
    trip_end_date: &str,
    retrieved_at: &str,
) -> Result<WeatherSnapshot, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let daily = value.get("daily").ok_or_else(unreadable_source)?;
    let dates = string_array(daily, "time")?;
    let codes = number_array(daily, "weather_code")?;
    let max_temps = number_array(daily, "temperature_2m_max")?;
    let min_temps = number_array(daily, "temperature_2m_min")?;
    let precip = daily
        .get("precipitation_probability_max")
        .and_then(|field| field.as_array())
        .map(|entries| {
            entries
                .iter()
                .map(|entry| entry.as_f64())
                .collect::<Vec<Option<f64>>>()
        })
        .unwrap_or_default();

    let trip_start = trip_start_date
        .parse::<Date>()
        .map_err(|_| unreadable_source())?;
    let trip_end = trip_end_date
        .parse::<Date>()
        .map_err(|_| unreadable_source())?;

    let mut days = Vec::new();
    for (index, date) in dates.iter().enumerate() {
        let Some(date) = date.as_deref() else {
            continue;
        };
        let Ok(day_date) = date.parse::<Date>() else {
            continue;
        };
        if day_date < trip_start || day_date > trip_end {
            continue;
        }
        let (Some(code), Some(max_temp), Some(min_temp)) = (
            codes.get(index).copied().flatten(),
            max_temps.get(index).copied().flatten(),
            min_temps.get(index).copied().flatten(),
        ) else {
            continue;
        };
        if !(0.0..=u8::MAX as f64).contains(&code) || code.fract() != 0.0 {
            continue;
        }
        let code = code as u8;
        days.push(WeatherDay {
            date: day_date.to_string(),
            weather_code: code,
            description: describe_weather_code(code).to_owned(),
            temp_max_c: max_temp,
            temp_min_c: min_temp,
            precipitation_chance_pct: precip.get(index).copied().flatten(),
        });
    }
    days.sort_by(|left, right| left.date.cmp(&right.date));
    days.dedup_by(|left, right| left.date == right.date);

    let coverage = if days.is_empty() {
        WeatherCoverage::None
    } else if covers_every_day(&days, trip_start, trip_end) {
        WeatherCoverage::Full
    } else {
        WeatherCoverage::Partial
    };

    Ok(WeatherSnapshot {
        place_name: place.name.clone(),
        place_region: place.region.clone(),
        latitude: place.latitude,
        longitude: place.longitude,
        days,
        coverage,
        source_url: "https://open-meteo.com/".to_owned(),
        retrieved_at: retrieved_at.to_owned(),
        // The forecast is the thing the user clicked for; the extra layers are
        // fetched separately and attached by the caller, so one of them being
        // unavailable never costs the forecast.
        normals: None,
        air_quality: Vec::new(),
        alerts: Vec::new(),
    })
}

fn string_array(parent: &serde_json::Value, key: &str) -> Result<Vec<Option<String>>, AppError> {
    parent
        .get(key)
        .and_then(|field| field.as_array())
        .map(|entries| {
            entries
                .iter()
                .map(|entry| entry.as_str().map(str::to_owned))
                .collect()
        })
        .ok_or_else(unreadable_source)
}

fn number_array(parent: &serde_json::Value, key: &str) -> Result<Vec<Option<f64>>, AppError> {
    parent
        .get(key)
        .and_then(|field| field.as_array())
        .map(|entries| entries.iter().map(|entry| entry.as_f64()).collect())
        .ok_or_else(unreadable_source)
}

fn covers_every_day(days: &[WeatherDay], start: Date, end: Date) -> bool {
    let mut expected = start;
    for day in days {
        let Ok(actual) = day.date.parse::<Date>() else {
            return false;
        };
        if actual != expected {
            return false;
        }
        if actual == end {
            return true;
        }
        let Ok(next) = expected.tomorrow() else {
            return false;
        };
        expected = next;
    }
    false
}

/// Deterministic descriptions for WMO weather interpretation codes as
/// documented by Open-Meteo. Unknown codes degrade to a neutral phrase.
pub fn describe_weather_code(code: u8) -> &'static str {
    match code {
        0 => "Clear sky",
        1 => "Mainly clear",
        2 => "Partly cloudy",
        3 => "Overcast",
        45 | 48 => "Fog",
        51 | 53 | 55 => "Drizzle",
        56 | 57 => "Freezing drizzle",
        61 => "Light rain",
        63 => "Rain",
        65 => "Heavy rain",
        66 | 67 => "Freezing rain",
        71 => "Light snow",
        73 => "Snow",
        75 => "Heavy snow",
        77 => "Snow grains",
        80 | 81 => "Rain showers",
        82 => "Violent rain showers",
        85 | 86 => "Snow showers",
        95 => "Thunderstorm",
        96 | 99 => "Thunderstorm with hail",
        _ => "Mixed conditions",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GEOCODE_JSON: &str = r#"{
        "results": [
            {
                "name": "Kyoto",
                "latitude": 35.02107,
                "longitude": 135.75385,
                "country": "Japan",
                "admin1": "Kyoto"
            }
        ]
    }"#;

    fn forecast_json() -> String {
        r#"{
            "daily": {
                "time": ["2026-11-02", "2026-11-03", "2026-11-04"],
                "weather_code": [0, 61, 3],
                "temperature_2m_max": [18.4, 15.1, 16.0],
                "temperature_2m_min": [9.2, 8.7, 7.9],
                "precipitation_probability_max": [5, 80, 30]
            }
        }"#
        .to_owned()
    }

    #[test]
    fn parses_the_top_geocoding_result() {
        let place = parse_geocoding_response(GEOCODE_JSON).expect("place");
        assert_eq!(place.name, "Kyoto");
        assert_eq!(place.region, "Kyoto, Japan");
        assert!((place.latitude - 35.02107).abs() < 1e-9);
    }

    #[test]
    fn empty_geocoding_results_are_an_actionable_error() {
        let error =
            parse_geocoding_response(r#"{ "generationtime_ms": 0.5 }"#).expect_err("no results");
        assert_eq!(error.code, ErrorCode::WeatherFetchFailed);
        assert!(error.message.contains("find that destination"));
    }

    #[test]
    fn filters_forecast_days_to_the_trip_window() {
        let place = parse_geocoding_response(GEOCODE_JSON).expect("place");
        let snapshot = parse_forecast_response(
            &place,
            &forecast_json(),
            "2026-11-03",
            "2026-11-04",
            "2026-11-01T00:00:00Z",
        )
        .expect("snapshot");
        assert_eq!(snapshot.days.len(), 2);
        assert_eq!(snapshot.days[0].date, "2026-11-03");
        assert_eq!(snapshot.days[0].description, "Light rain");
        assert_eq!(snapshot.days[0].precipitation_chance_pct, Some(80.0));
        assert_eq!(snapshot.coverage, WeatherCoverage::Full);
        assert_eq!(snapshot.place_name, "Kyoto");
    }

    #[test]
    fn a_trip_beyond_the_horizon_reports_no_coverage() {
        let place = parse_geocoding_response(GEOCODE_JSON).expect("place");
        let snapshot = parse_forecast_response(
            &place,
            &forecast_json(),
            "2026-12-20",
            "2026-12-28",
            "2026-11-01T00:00:00Z",
        )
        .expect("snapshot");
        assert!(snapshot.days.is_empty());
        assert_eq!(snapshot.coverage, WeatherCoverage::None);
    }

    #[test]
    fn a_trip_ending_past_the_horizon_is_partial() {
        let place = parse_geocoding_response(GEOCODE_JSON).expect("place");
        let snapshot = parse_forecast_response(
            &place,
            &forecast_json(),
            "2026-11-04",
            "2026-11-12",
            "2026-11-01T00:00:00Z",
        )
        .expect("snapshot");
        assert_eq!(snapshot.days.len(), 1);
        assert_eq!(snapshot.coverage, WeatherCoverage::Partial);
    }

    #[test]
    fn nullable_daily_values_do_not_shift_later_dates_or_claim_full_coverage() {
        let place = parse_geocoding_response(GEOCODE_JSON).expect("place");
        let snapshot = parse_forecast_response(
            &place,
            r#"{
                "daily": {
                    "time": ["2026-11-03", "2026-11-04", "2026-11-05"],
                    "weather_code": [0, null, 61],
                    "temperature_2m_max": [18.4, 15.1, 16.0],
                    "temperature_2m_min": [9.2, 8.7, 7.9],
                    "precipitation_probability_max": [5, null, 80]
                }
            }"#,
            "2026-11-03",
            "2026-11-05",
            "2026-11-01T00:00:00Z",
        )
        .expect("snapshot");

        assert_eq!(
            snapshot
                .days
                .iter()
                .map(|day| (day.date.as_str(), day.description.as_str()))
                .collect::<Vec<_>>(),
            vec![("2026-11-03", "Clear sky"), ("2026-11-05", "Light rain")]
        );
        assert_eq!(snapshot.days[1].precipitation_chance_pct, Some(80.0));
        assert_eq!(snapshot.coverage, WeatherCoverage::Partial);
    }

    #[test]
    fn bad_json_is_a_fetch_failure_not_a_panic() {
        let place = parse_geocoding_response(GEOCODE_JSON).expect("place");
        assert_eq!(
            parse_forecast_response(&place, "<html>", "2026-11-03", "2026-11-04", "now")
                .expect_err("bad json")
                .code,
            ErrorCode::WeatherFetchFailed
        );
        assert_eq!(
            parse_geocoding_response("nope").expect_err("bad json").code,
            ErrorCode::WeatherFetchFailed
        );
    }

    #[test]
    fn weather_codes_have_stable_descriptions() {
        assert_eq!(describe_weather_code(0), "Clear sky");
        assert_eq!(describe_weather_code(95), "Thunderstorm");
        assert_eq!(describe_weather_code(42), "Mixed conditions");
    }
}
