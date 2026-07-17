//! Offline sun and moon facts for a place and date.
//!
//! IO-free and network-free: sunrise, sunset, day length and moon phase are
//! computed from latitude, longitude and a civil date. This is deterministic
//! astronomy, not a forecast — it carries no source and cannot be stale.
//!
//! The sun times use the standard NOAA sunrise equation; the moon phase uses
//! the synodic month from a known new-moon epoch. Times are the destination's
//! local wall clock, so the caller supplies the destination's UTC offset (from
//! its timezone) rather than this module guessing one.

use std::f64::consts::PI;

use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// The synodic month in days (new moon to new moon).
const SYNODIC_MONTH: f64 = 29.530_588_67;
/// Julian Date of the 2000-01-06 18:14 UTC new moon, the moon-phase epoch.
const MOON_EPOCH_JD: f64 = 2_451_550.1;
/// Standard solar altitude at sunrise/sunset, accounting for refraction, deg.
const SUN_ALTITUDE_DEG: f64 = -0.833;

/// Whether the sun rises and sets at all on this day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PolarState {
    /// The sun rises and sets normally.
    Normal,
    /// The sun stays up all day (high summer, high latitude).
    PolarDay,
    /// The sun never rises (deep winter, high latitude).
    PolarNight,
}

/// Sun and moon facts for one local calendar day.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AstroDay {
    /// ISO `YYYY-MM-DD`, local to the destination.
    pub date: String,
    /// Local `HH:MM`; absent on polar days and nights.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sunrise: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sunset: Option<String>,
    /// Minutes of daylight: 0 on a polar night, 1440 on a polar day.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub day_length_minutes: Option<u32>,
    pub polar: PolarState,
    pub moon: MoonPhase,
}

/// The eight named lunar phases, in order from new to waning crescent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoonPhaseName {
    NewMoon,
    WaxingCrescent,
    FirstQuarter,
    WaxingGibbous,
    FullMoon,
    WaningGibbous,
    LastQuarter,
    WaningCrescent,
}

/// The moon's state on a date.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonPhase {
    /// Days since the last new moon, 0..~29.53.
    pub age_days: f64,
    /// Illuminated fraction as a percentage, 0..100.
    pub illumination_pct: u8,
    pub name: MoonPhaseName,
}

fn invalid_date() -> AppError {
    AppError::with_detail(
        ErrorCode::ValidationInvalidInput,
        "invalid date",
        "field",
        "date",
    )
}

/// Julian day number for a civil date (at 00:00).
fn julian_day(date: Date) -> f64 {
    let (y, m, d) = (date.year() as i64, date.month() as i64, date.day() as i64);
    let a = (14 - m) / 12;
    let yy = y + 4800 - a;
    let mm = m + 12 * a - 3;
    (d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045) as f64
}

/// Turn a Julian date into a local `HH:MM` string given the UTC offset.
fn to_local_hm(julian_date: f64, utc_offset_minutes: i32) -> String {
    // The fractional part of (JD + 0.5) is the time past midnight UTC.
    let frac = (julian_date + 0.5).rem_euclid(1.0);
    let minutes_utc = frac * 1440.0;
    let minutes_local = (minutes_utc + utc_offset_minutes as f64).rem_euclid(1440.0);
    let total = minutes_local.round() as i32 % 1440;
    format!("{:02}:{:02}", total / 60, total % 60)
}

/// Compute the day's sun facts at the destination's local wall clock.
pub fn compute_astro_day(
    latitude: f64,
    longitude: f64,
    date: &str,
    utc_offset_minutes: i32,
) -> Result<AstroDay, AppError> {
    let civil: Date = date.parse().map_err(|_| invalid_date())?;
    let moon = moon_phase(date)?;
    let jdn = julian_day(civil);

    let n = jdn - 2_451_545.0 + 0.0008;
    let j_star = n - longitude / 360.0;
    let mean_anomaly = (357.5291 + 0.985_600_28 * j_star).rem_euclid(360.0);
    let m_rad = mean_anomaly.to_radians();
    let center = 1.9148 * m_rad.sin() + 0.0200 * (2.0 * m_rad).sin() + 0.0003 * (3.0 * m_rad).sin();
    let ecliptic_long = (mean_anomaly + center + 282.9372).rem_euclid(360.0);
    let l_rad = ecliptic_long.to_radians();
    let transit = 2_451_545.0 + j_star + 0.0053 * m_rad.sin() - 0.0069 * (2.0 * l_rad).sin();
    let declination = (l_rad.sin() * (23.4397_f64).to_radians().sin()).asin();

    let lat_rad = latitude.to_radians();
    let cos_omega = (SUN_ALTITUDE_DEG.to_radians().sin() - lat_rad.sin() * declination.sin())
        / (lat_rad.cos() * declination.cos());

    if cos_omega > 1.0 {
        return Ok(AstroDay {
            date: date.to_owned(),
            sunrise: None,
            sunset: None,
            day_length_minutes: Some(0),
            polar: PolarState::PolarNight,
            moon,
        });
    }
    if cos_omega < -1.0 {
        return Ok(AstroDay {
            date: date.to_owned(),
            sunrise: None,
            sunset: None,
            day_length_minutes: Some(1440),
            polar: PolarState::PolarDay,
            moon,
        });
    }

    let omega = cos_omega.acos().to_degrees();
    let rise = transit - omega / 360.0;
    let set = transit + omega / 360.0;
    // Day length is 2ω in degrees → minutes (360° = 1440 min).
    let day_length = (2.0 * omega / 360.0 * 1440.0).round() as u32;

    Ok(AstroDay {
        date: date.to_owned(),
        sunrise: Some(to_local_hm(rise, utc_offset_minutes)),
        sunset: Some(to_local_hm(set, utc_offset_minutes)),
        day_length_minutes: Some(day_length),
        polar: PolarState::Normal,
        moon,
    })
}

/// Compute the moon's age and phase on a date.
pub fn moon_phase(date: &str) -> Result<MoonPhase, AppError> {
    let civil: Date = date.parse().map_err(|_| invalid_date())?;
    // Noon of the civil date, to sit mid-day rather than at a boundary.
    let jd = julian_day(civil) + 0.5;
    let age = (jd - MOON_EPOCH_JD).rem_euclid(SYNODIC_MONTH);

    let phase_angle = 2.0 * PI * age / SYNODIC_MONTH;
    let illumination = 50.0 * (1.0 - phase_angle.cos());

    // Eight equal octants of the cycle, centred so "new" and "full" straddle
    // their exact instants rather than starting at them.
    let octant = ((age / SYNODIC_MONTH * 8.0).round() as u32) % 8;
    let name = match octant {
        0 => MoonPhaseName::NewMoon,
        1 => MoonPhaseName::WaxingCrescent,
        2 => MoonPhaseName::FirstQuarter,
        3 => MoonPhaseName::WaxingGibbous,
        4 => MoonPhaseName::FullMoon,
        5 => MoonPhaseName::WaningGibbous,
        6 => MoonPhaseName::LastQuarter,
        _ => MoonPhaseName::WaningCrescent,
    };

    Ok(MoonPhase {
        age_days: (age * 100.0).round() / 100.0,
        illumination_pct: illumination.round() as u8,
        name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn near(actual: Option<&str>, expected: &str) {
        let a = actual.expect("time present");
        let to_min = |t: &str| {
            let (h, m) = t.split_once(':').expect("hh:mm");
            h.parse::<i32>().unwrap() * 60 + m.parse::<i32>().unwrap()
        };
        assert!(
            (to_min(a) - to_min(expected)).abs() <= 2,
            "{a} vs {expected}"
        );
    }

    #[test]
    fn computes_local_sunrise_and_sunset() {
        let kyoto = compute_astro_day(35.0116, 135.7681, "2026-11-03", 9 * 60).expect("kyoto");
        assert_eq!(kyoto.polar, PolarState::Normal);
        near(kyoto.sunrise.as_deref(), "06:20");
        near(kyoto.sunset.as_deref(), "17:03");
        assert!((kyoto.day_length_minutes.unwrap() as i32 - 643).abs() <= 3);
        // Each day carries its own moon, so the interface can show it per day.
        assert!(kyoto.moon.illumination_pct <= 100);

        let london = compute_astro_day(51.5074, -0.1278, "2026-06-21", 60).expect("london");
        near(london.sunrise.as_deref(), "04:44");
        near(london.sunset.as_deref(), "21:23");

        let sydney = compute_astro_day(-33.8688, 151.2093, "2026-01-15", 11 * 60).expect("sydney");
        near(sydney.sunrise.as_deref(), "06:00");
        near(sydney.sunset.as_deref(), "20:10");
    }

    #[test]
    fn reports_polar_day_and_night_without_pretending() {
        let winter = compute_astro_day(69.6492, 18.9553, "2026-12-21", 60).expect("tromso winter");
        assert_eq!(winter.polar, PolarState::PolarNight);
        assert_eq!(winter.sunrise, None);
        assert_eq!(winter.sunset, None);
        assert_eq!(winter.day_length_minutes, Some(0));

        let summer =
            compute_astro_day(69.6492, 18.9553, "2026-06-21", 2 * 60).expect("tromso summer");
        assert_eq!(summer.polar, PolarState::PolarDay);
        assert_eq!(summer.day_length_minutes, Some(1440));

        assert!(compute_astro_day(35.0, 135.0, "not-a-date", 0).is_err());
    }

    #[test]
    fn names_the_moon_phase_from_its_age() {
        let full = moon_phase("2026-01-03").expect("full-ish");
        assert!((full.age_days - 14.6).abs() < 0.5, "age {}", full.age_days);
        assert!(
            full.illumination_pct > 95,
            "illum {}",
            full.illumination_pct
        );
        assert_eq!(full.name, MoonPhaseName::FullMoon);

        let new = moon_phase("2000-01-06").expect("new");
        assert!(
            new.age_days < 1.0 || new.age_days > 28.5,
            "age {}",
            new.age_days
        );
        assert!(new.illumination_pct < 5, "illum {}", new.illumination_pct);
        assert_eq!(new.name, MoonPhaseName::NewMoon);
    }
}
