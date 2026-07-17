//! Climate normals and the UV / air-quality day layer.
//!
//! Both come from Open-Meteo (keyless, free for non-commercial use; data
//! CC BY 4.0 — attribution "Weather data by Open-Meteo.com" required). This
//! module is IO-free.
//!
//! Normals describe **the past**, never the future: they answer "what have
//! these dates usually been like here" from observed history, and say how many
//! days and years that claim rests on so the reader can weigh it. Too little
//! history reports nothing rather than a confident-looking average of two days.

use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// The fewest observed days that can support a "typical" claim.
const MIN_SAMPLE_DAYS: u32 = 4;
/// The fewest distinct years those days must span.
const MIN_YEARS: u32 = 2;
/// A day counts as wet at or above this much rain.
const WET_DAY_MM: f64 = 1.0;
/// The most air-quality days to carry, bounding a misbehaving source.
const MAX_AIR_QUALITY_DAYS: usize = 32;

fn unreadable_source() -> AppError {
    AppError::new(
        ErrorCode::WeatherFetchFailed,
        "the weather source returned something Voyalier could not read",
    )
}

/// What the trip's calendar dates have usually been like at the destination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClimateNormals {
    /// Distinct years the samples came from, so the claim's weight is visible.
    pub years_sampled: u32,
    /// Observed days behind the averages.
    pub sample_days: u32,
    pub first_year: i16,
    pub last_year: i16,
    pub avg_high_c: f64,
    pub avg_low_c: f64,
    /// Share of sampled days with at least 1 mm of rain.
    pub wet_day_share_pct: f64,
    pub warmest_high_c: f64,
    pub coldest_low_c: f64,
}

/// One day's UV and air quality at the destination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AirQualityDay {
    /// ISO `YYYY-MM-DD` local to the destination.
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uv_index_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub us_aqi_max: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pm2_5_max: Option<f64>,
}

/// The archive date range that samples the trip's own dates in the `years`
/// whole years before it.
pub fn archive_window(start: &str, end: &str, years: u32) -> Result<(String, String), AppError> {
    let start_date: Date = start.parse().map_err(|_| {
        AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "invalid date",
            "field",
            "startDate",
        )
    })?;
    let end_date: Date = end.parse().map_err(|_| {
        AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "invalid date",
            "field",
            "endDate",
        )
    })?;
    let first = start_date.year() - years as i16;
    let last = end_date.year() - 1;
    Ok((
        format!(
            "{first:04}-{:02}-{:02}",
            start_date.month(),
            start_date.day()
        ),
        format!("{last:04}-{:02}-{:02}", end_date.month(), end_date.day()),
    ))
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// True when `month_day` falls inside the trip's month-day window, handling a
/// window that wraps the new year (a 28 Dec – 3 Jan trip).
fn in_month_day_window(month_day: (u8, u8), start: (u8, u8), end: (u8, u8)) -> bool {
    if start <= end {
        month_day >= start && month_day <= end
    } else {
        month_day >= start || month_day <= end
    }
}

/// Parse an Open-Meteo archive response into normals for the trip's dates.
///
/// `Ok(None)` means the history is too thin to call anything typical — a
/// different answer from a failed fetch, and an honest one.
pub fn parse_climate_normals(
    json: &str,
    trip_start: &str,
    trip_end: &str,
) -> Result<Option<ClimateNormals>, AppError> {
    let start: Date = trip_start.parse().map_err(|_| unreadable_source())?;
    let end: Date = trip_end.parse().map_err(|_| unreadable_source())?;
    let window_start = (start.month() as u8, start.day() as u8);
    let window_end = (end.month() as u8, end.day() as u8);

    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let daily = value.get("daily").ok_or_else(unreadable_source)?;
    let times = daily
        .get("time")
        .and_then(|field| field.as_array())
        .ok_or_else(unreadable_source)?;
    let highs = daily.get("temperature_2m_max").and_then(|f| f.as_array());
    let lows = daily.get("temperature_2m_min").and_then(|f| f.as_array());
    let rain = daily.get("precipitation_sum").and_then(|f| f.as_array());

    let mut years = std::collections::BTreeSet::new();
    let mut high_sum = 0.0;
    let mut low_sum = 0.0;
    let mut wet_days = 0u32;
    let mut samples = 0u32;
    let mut warmest = f64::MIN;
    let mut coldest = f64::MAX;

    for (index, time) in times.iter().enumerate() {
        let Some(text) = time.as_str() else { continue };
        let Ok(date) = text.parse::<Date>() else {
            continue;
        };
        if !in_month_day_window(
            (date.month() as u8, date.day() as u8),
            window_start,
            window_end,
        ) {
            continue;
        }
        // A day counts only when every value behind it is present: a partial
        // row would average a real high against a missing low.
        let (Some(high), Some(low), Some(precipitation)) = (
            highs.and_then(|a| a.get(index)).and_then(|v| v.as_f64()),
            lows.and_then(|a| a.get(index)).and_then(|v| v.as_f64()),
            rain.and_then(|a| a.get(index)).and_then(|v| v.as_f64()),
        ) else {
            continue;
        };

        years.insert(date.year());
        high_sum += high;
        low_sum += low;
        samples += 1;
        if precipitation >= WET_DAY_MM {
            wet_days += 1;
        }
        warmest = warmest.max(high);
        coldest = coldest.min(low);
    }

    if samples < MIN_SAMPLE_DAYS || years.len() < MIN_YEARS as usize {
        return Ok(None);
    }

    Ok(Some(ClimateNormals {
        years_sampled: years.len() as u32,
        sample_days: samples,
        first_year: *years.first().expect("non-empty"),
        last_year: *years.last().expect("non-empty"),
        avg_high_c: round1(high_sum / samples as f64),
        avg_low_c: round1(low_sum / samples as f64),
        wet_day_share_pct: round1(wet_days as f64 * 100.0 / samples as f64),
        warmest_high_c: round1(warmest),
        coldest_low_c: round1(coldest),
    }))
}

/// Parse an Open-Meteo air-quality response into the trip's days.
///
/// UV arrives daily; AQI and PM2.5 only hourly, so each day takes its worst
/// hour — an average would hide the peak that actually matters.
pub fn parse_air_quality(
    json: &str,
    trip_start: &str,
    trip_end: &str,
) -> Result<Vec<AirQualityDay>, AppError> {
    let start: Date = trip_start.parse().map_err(|_| unreadable_source())?;
    let end: Date = trip_end.parse().map_err(|_| unreadable_source())?;

    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let daily = value.get("daily").ok_or_else(unreadable_source)?;
    let times = daily
        .get("time")
        .and_then(|field| field.as_array())
        .ok_or_else(unreadable_source)?;
    let uv = daily.get("uv_index_max").and_then(|f| f.as_array());

    let mut aqi_by_day: std::collections::HashMap<String, u16> = std::collections::HashMap::new();
    let mut pm_by_day: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    if let Some(hourly) = value.get("hourly")
        && let Some(hours) = hourly.get("time").and_then(|f| f.as_array())
    {
        let aqi = hourly.get("us_aqi").and_then(|f| f.as_array());
        let pm = hourly.get("pm2_5").and_then(|f| f.as_array());
        for (index, hour) in hours.iter().enumerate() {
            let Some(stamp) = hour.as_str() else { continue };
            let day = stamp.split('T').next().unwrap_or_default().to_owned();
            if let Some(reading) = aqi.and_then(|a| a.get(index)).and_then(|v| v.as_u64()) {
                let reading = reading.min(u16::MAX as u64) as u16;
                aqi_by_day
                    .entry(day.clone())
                    .and_modify(|worst| *worst = (*worst).max(reading))
                    .or_insert(reading);
            }
            if let Some(reading) = pm.and_then(|a| a.get(index)).and_then(|v| v.as_f64()) {
                pm_by_day
                    .entry(day)
                    .and_modify(|worst| *worst = worst.max(reading))
                    .or_insert(reading);
            }
        }
    }

    let mut days = Vec::new();
    for (index, time) in times.iter().enumerate() {
        if days.len() >= MAX_AIR_QUALITY_DAYS {
            break;
        }
        let Some(text) = time.as_str() else { continue };
        let Ok(date) = text.parse::<Date>() else {
            continue;
        };
        if date < start || date > end {
            continue;
        }
        days.push(AirQualityDay {
            date: text.to_owned(),
            uv_index_max: uv
                .and_then(|a| a.get(index))
                .and_then(|v| v.as_f64())
                .map(round1),
            us_aqi_max: aqi_by_day.get(text).copied(),
            pm2_5_max: pm_by_day.get(text).copied().map(round1),
        });
    }
    Ok(days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_window_asks_for_whole_years_before_the_trip() {
        let (start, end) = archive_window("2026-11-03", "2026-11-12", 10).expect("window");
        assert_eq!(start, "2016-11-03");
        assert_eq!(end, "2025-11-12");
        assert!(archive_window("nonsense", "2026-11-12", 10).is_err());
        assert!(archive_window("2026-11-03", "nope", 10).is_err());
    }

    #[test]
    fn parses_normals_from_the_same_dates_in_past_years() {
        let json = r#"{"daily": {
            "time": ["2024-11-02","2024-11-03","2024-11-04","2024-11-05",
                     "2025-11-02","2025-11-03","2025-11-04","2025-11-05"],
            "temperature_2m_max": [30.0, 18.0, 20.0, 22.0, 30.0, 16.0, 18.0, 20.0],
            "temperature_2m_min": [1.0, 8.0, 10.0, 12.0, 1.0, 6.0, 8.0, 10.0],
            "precipitation_sum": [99.0, 0.0, 5.0, 0.2, 99.0, 1.5, 0.0, 0.0]
        }}"#;
        let normals = parse_climate_normals(json, "2026-11-03", "2026-11-05")
            .expect("parsed")
            .expect("enough samples");
        // The 11-02 rows sit outside the trip's month-day window: their
        // 30.0/1.0/99.0 values would visibly skew every field if counted.
        assert_eq!(normals.sample_days, 6);
        assert_eq!(normals.years_sampled, 2);
        assert_eq!(normals.first_year, 2024);
        assert_eq!(normals.last_year, 2025);
        assert_eq!(normals.avg_high_c, 19.0);
        assert_eq!(normals.avg_low_c, 9.0);
        assert_eq!(normals.warmest_high_c, 22.0);
        assert_eq!(normals.coldest_low_c, 6.0);
        // A wet day is >= 1mm: 5.0 and 1.5 qualify, 0.2 and 0.0 do not.
        assert_eq!(normals.wet_day_share_pct, 33.3);
    }

    #[test]
    fn normals_need_enough_history_to_be_worth_a_claim() {
        let json = r#"{"daily": {"time": ["2025-11-03"], "temperature_2m_max": [18.0],
                       "temperature_2m_min": [8.0], "precipitation_sum": [0.0]}}"#;
        assert!(
            parse_climate_normals(json, "2026-11-03", "2026-11-05")
                .expect("parsed")
                .is_none(),
            "too few samples reports nothing rather than a false typical"
        );

        // Gaps degrade rather than lie: a row with a null is skipped whole.
        let json = r#"{"daily": {
            "time": ["2023-11-03","2024-11-03","2025-11-03","2022-11-03","2021-11-03"],
            "temperature_2m_max": [18.0, null, 20.0, 19.0, 21.0],
            "temperature_2m_min": [8.0, null, 10.0, 9.0, 11.0],
            "precipitation_sum": [0.0, null, 0.0, 0.0, 0.0]
        }}"#;
        let normals = parse_climate_normals(json, "2026-11-03", "2026-11-05")
            .expect("parsed")
            .expect("four good samples");
        assert_eq!(normals.sample_days, 4);
        assert_eq!(normals.avg_high_c, 19.5);

        assert!(parse_climate_normals("<html>", "2026-11-03", "2026-11-05").is_err());
        assert!(parse_climate_normals("{}", "2026-11-03", "2026-11-05").is_err());
    }

    #[test]
    fn normals_handle_a_trip_that_wraps_the_new_year() {
        let json = r#"{"daily": {
            "time": ["2024-12-30","2025-01-02","2024-07-01","2025-12-30","2026-01-02"],
            "temperature_2m_max": [4.0, 6.0, 33.0, 5.0, 7.0],
            "temperature_2m_min": [-2.0, 0.0, 24.0, -1.0, 1.0],
            "precipitation_sum": [0.0, 2.0, 0.0, 0.0, 0.0]
        }}"#;
        let normals = parse_climate_normals(json, "2026-12-28", "2027-01-03")
            .expect("parsed")
            .expect("enough samples");
        // The July row is outside the wrapped window; the four winter rows count.
        assert_eq!(normals.sample_days, 4);
        assert_eq!(normals.avg_high_c, 5.5);
    }

    #[test]
    fn parses_daily_uv_and_folds_hourly_aqi_into_days() {
        let json = r#"{
          "daily": {"time": ["2026-11-03","2026-11-04"], "uv_index_max": [7.95, 8.5]},
          "hourly": {
            "time": ["2026-11-03T00:00","2026-11-03T13:00","2026-11-04T00:00","2026-11-05T00:00"],
            "us_aqi": [64, 91, 58, 200],
            "pm2_5": [19.0, 25.5, 17.3, 80.0]
          }
        }"#;
        let days = parse_air_quality(json, "2026-11-03", "2026-11-04").expect("parsed");
        assert_eq!(days.len(), 2);
        assert_eq!(days[0].date, "2026-11-03");
        assert_eq!(days[0].uv_index_max, Some(8.0));
        // The day's worst hour is the day's number: an average hides the peak.
        assert_eq!(days[0].us_aqi_max, Some(91));
        assert_eq!(days[0].pm2_5_max, Some(25.5));
        assert_eq!(days[1].us_aqi_max, Some(58));
        assert!(days.iter().all(|day| day.date != "2026-11-05"));
    }

    #[test]
    fn air_quality_degrades_rather_than_failing() {
        let json = r#"{"daily": {"time": ["2026-11-03"], "uv_index_max": [7.0]}}"#;
        let days = parse_air_quality(json, "2026-11-03", "2026-11-04").expect("parsed");
        assert_eq!(days.len(), 1);
        assert_eq!(days[0].uv_index_max, Some(7.0));
        assert_eq!(days[0].us_aqi_max, None);

        // Nulls are absent, not zero: 0 AQI would read as pristine air.
        let json = r#"{"daily": {"time": ["2026-11-03"], "uv_index_max": [null]},
                       "hourly": {"time": ["2026-11-03T00:00"], "us_aqi": [null], "pm2_5": [null]}}"#;
        let days = parse_air_quality(json, "2026-11-03", "2026-11-04").expect("parsed");
        assert_eq!(days[0].uv_index_max, None);
        assert_eq!(days[0].us_aqi_max, None);
        assert_eq!(days[0].pm2_5_max, None);

        assert!(parse_air_quality("<html>", "2026-11-03", "2026-11-04").is_err());
        assert!(parse_air_quality("{}", "2026-11-03", "2026-11-04").is_err());
    }

    #[test]
    fn air_quality_day_field_names_match_the_typescript_contract() {
        // `pm2_5_max` is the one field whose camelCase is not obvious, and a
        // silent rename here would break the wire without failing a type check.
        let json = serde_json::to_string(&AirQualityDay {
            date: "2026-11-03".into(),
            uv_index_max: Some(7.0),
            us_aqi_max: Some(42),
            pm2_5_max: Some(8.1),
        })
        .expect("serialize");
        assert!(json.contains("\"uvIndexMax\""), "{json}");
        assert!(json.contains("\"usAqiMax\""), "{json}");
        assert!(json.contains("\"pm25Max\""), "{json}");
    }
}
