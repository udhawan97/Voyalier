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
/// Solar altitude bounding the golden hour, deg. Above this the sun is high
/// enough that the low, warm light photographers plan around has gone.
const GOLDEN_ALTITUDE_DEG: f64 = 6.0;

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
    /// The day's two low-sun windows, when it has them.
    ///
    /// Absent for three different reasons, which [`AstroDay::polar`] tells
    /// apart: on a polar night the sun never rises; on a polar day it never
    /// sets, so any low-sun period straddles local midnight and belongs to no
    /// single civil day; and on a `Normal` day at high latitude the sun can
    /// rise without ever climbing past [`GOLDEN_ALTITUDE_DEG`], which leaves no
    /// *distinct* window to name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub golden_hour: Option<GoldenHour>,
    pub moon: MoonPhase,
}

/// The morning and evening low-sun windows of one local day.
///
/// The outer bounds are the day's own sunrise and sunset rather than a second
/// solve, so a window can never disagree with the sun times printed beside it.
/// All four times are local `HH:MM`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoldenHour {
    pub morning_start: String,
    pub morning_end: String,
    pub evening_start: String,
    pub evening_end: String,
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

/// Where the sun stands relative to one altitude over a whole day.
///
/// The sunrise equation's cosine falls outside ±1 when no crossing exists, and
/// the two ways it can do that mean opposite things — sun never that high
/// versus sun never that low. Naming them keeps the polar-day and polar-night
/// branches from being told apart by the sign of a cosine.
enum SunAltitude {
    /// The sun never climbs to this altitude.
    AlwaysBelow,
    /// The sun never drops to this altitude.
    AlwaysAbove,
    /// It crosses, this many degrees of hour angle either side of transit.
    Crosses(f64),
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
    let hour_angle = |altitude_deg: f64| {
        let cos_omega = (altitude_deg.to_radians().sin() - lat_rad.sin() * declination.sin())
            / (lat_rad.cos() * declination.cos());
        if cos_omega > 1.0 {
            SunAltitude::AlwaysBelow
        } else if cos_omega < -1.0 {
            SunAltitude::AlwaysAbove
        } else {
            SunAltitude::Crosses(cos_omega.acos().to_degrees())
        }
    };

    let omega = match hour_angle(SUN_ALTITUDE_DEG) {
        SunAltitude::AlwaysBelow => {
            return Ok(AstroDay {
                date: date.to_owned(),
                sunrise: None,
                sunset: None,
                day_length_minutes: Some(0),
                polar: PolarState::PolarNight,
                golden_hour: None,
                moon,
            });
        }
        SunAltitude::AlwaysAbove => {
            return Ok(AstroDay {
                date: date.to_owned(),
                sunrise: None,
                sunset: None,
                day_length_minutes: Some(1440),
                polar: PolarState::PolarDay,
                golden_hour: None,
                moon,
            });
        }
        SunAltitude::Crosses(value) => value,
    };

    let rise = transit - omega / 360.0;
    let set = transit + omega / 360.0;
    // Day length is 2ω in degrees → minutes (360° = 1440 min).
    let day_length = (2.0 * omega / 360.0 * 1440.0).round() as u32;
    let sunrise = to_local_hm(rise, utc_offset_minutes);
    let sunset = to_local_hm(set, utc_offset_minutes);

    // A day that never lifts the sun past the golden altitude has no distinct
    // window to name. `AlwaysAbove` cannot occur here — the sun demonstrably
    // reached a *lower* altitude a few lines up, so it is folded in with it.
    let golden_hour = match hour_angle(GOLDEN_ALTITUDE_DEG) {
        SunAltitude::Crosses(golden) => Some(GoldenHour {
            morning_start: sunrise.clone(),
            morning_end: to_local_hm(transit - golden / 360.0, utc_offset_minutes),
            evening_start: to_local_hm(transit + golden / 360.0, utc_offset_minutes),
            evening_end: sunset.clone(),
        }),
        SunAltitude::AlwaysBelow | SunAltitude::AlwaysAbove => None,
    };

    Ok(AstroDay {
        date: date.to_owned(),
        sunrise: Some(sunrise),
        sunset: Some(sunset),
        day_length_minutes: Some(day_length),
        polar: PolarState::Normal,
        golden_hour,
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

/// Eclipse dates, transcribed from NASA GSFC's five-millennium catalogues and
/// cross-checked against the matching decade tables.
///
/// Bundled rather than computed. Eclipse geometry does not drift, so a table
/// shipped today is still right in 2032 — which is the property that makes this
/// worth bundling at all — and transcribing beats implementing Besselian
/// elements for thirty-one rows.
///
/// Meteor showers were considered and dropped. The IMO working list and the
/// American Meteor Society's tables are both all-rights-reserved and neither
/// grants reuse, and NASA's own page carries no rates and had not been rolled
/// forward past the previous year when it was read. There was no public-domain
/// source to bundle, so nothing is bundled.
const SKY_EVENTS_TSV: &str = include_str!("data/sky_events.tsv");

/// Which body the event happens to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkyEventKind {
    SolarEclipse,
    LunarEclipse,
}

/// One dated sky event, with the broad band NASA publishes it as visible from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkyEvent {
    /// ISO `YYYY-MM-DD`, as the catalogue gives it — a Terrestrial/Universal
    /// Time calendar date. Near the date line a local calendar date can differ
    /// by one, so this is the event's date and not the traveler's.
    pub date: String,
    pub kind: SkyEventKind,
    /// The catalogue's own phrasing, e.g. "Total solar eclipse".
    pub label: String,
    /// NASA's "Geographic Region of Eclipse Visibility", verbatim.
    ///
    /// A coarse band where *some* phase is visible — not a local-circumstances
    /// calculation, and never to be rendered as "visible from your
    /// destination". The bracketed part, where present, is the central path.
    pub region: String,
}

/// The attribution NASA's eclipse site requires of anything reproducing its
/// predictions. Carried with the data rather than left to a UI to remember.
pub const SKY_EVENTS_CREDIT: &str = "Eclipse predictions courtesy of Fred Espenak, NASA/Goddard Space Flight Center, from eclipse.gsfc.nasa.gov.";

/// Bundled sky events falling inside an inclusive date window, in date order.
///
/// An unparseable or reversed window yields nothing rather than a guess, the
/// same choice every other windowed reader in the tree makes.
pub fn sky_events_within(start: &str, end: &str) -> Vec<SkyEvent> {
    let (Ok(start), Ok(end)) = (start.parse::<Date>(), end.parse::<Date>()) else {
        return Vec::new();
    };
    if end < start {
        return Vec::new();
    }
    SKY_EVENTS_TSV
        .lines()
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let date = fields.next()?;
            let kind = match fields.next()? {
                "solar" => SkyEventKind::SolarEclipse,
                "lunar" => SkyEventKind::LunarEclipse,
                _ => return None,
            };
            let label = fields.next()?;
            let region = fields.next()?;
            let parsed: Date = date.parse().ok()?;
            (parsed >= start && parsed <= end).then(|| SkyEvent {
                date: date.to_owned(),
                kind,
                label: label.to_owned(),
                region: region.to_owned(),
            })
        })
        .collect()
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
    fn brackets_golden_hour_inside_the_day_it_belongs_to() {
        let kyoto = compute_astro_day(35.0116, 135.7681, "2026-11-03", 9 * 60).expect("kyoto");
        let golden = kyoto.golden_hour.as_ref().expect("kyoto has a golden hour");

        // The windows are anchored on the day's own sun times, not recomputed
        // from a different equation that could disagree with them.
        assert_eq!(
            Some(golden.morning_start.as_str()),
            kyoto.sunrise.as_deref()
        );
        assert_eq!(Some(golden.evening_end.as_str()), kyoto.sunset.as_deref());

        let minutes = |t: &str| {
            let (h, m) = t.split_once(':').expect("hh:mm");
            h.parse::<i32>().unwrap() * 60 + m.parse::<i32>().unwrap()
        };
        let morning = minutes(&golden.morning_end) - minutes(&golden.morning_start);
        let evening = minutes(&golden.evening_end) - minutes(&golden.evening_start);
        assert!(morning > 0 && evening > 0, "{golden:?}");
        // Symmetric about solar noon, so the two windows are the same length.
        assert!((morning - evening).abs() <= 1, "{morning} vs {evening}");
        // The sun climbs 6.8 degrees at roughly 12 degrees an hour at this
        // latitude and date, so both windows land near half an hour.
        assert!((25..=45).contains(&morning), "morning {morning} min");
        // And they do not overlap: morning ends well before evening begins.
        assert!(minutes(&golden.morning_end) < minutes(&golden.evening_start));
    }

    #[test]
    fn withholds_golden_hour_when_the_sun_never_climbs_out_of_it() {
        // Tromso in late January: the sun rises, so this is not a polar night,
        // but it never reaches 6 degrees. There is no *distinct* golden hour to
        // report, and inventing one that spans the whole short day would be a
        // worse answer than none.
        let low = compute_astro_day(69.6492, 18.9553, "2026-01-25", 60).expect("tromso");
        assert_eq!(low.polar, PolarState::Normal);
        assert!(low.sunrise.is_some());
        assert_eq!(low.golden_hour, None);

        // A polar night has no sun at all, and a polar day never sets, so
        // neither carries a window either.
        let night = compute_astro_day(69.6492, 18.9553, "2026-12-21", 60).expect("night");
        assert_eq!(night.golden_hour, None);
        let day = compute_astro_day(69.6492, 18.9553, "2026-06-21", 2 * 60).expect("day");
        assert_eq!(day.golden_hour, None);
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

    #[test]
    fn an_eclipse_inside_the_window_is_returned() {
        // The total solar eclipse over Iceland and Spain.
        let events = sky_events_within("2026-08-01", "2026-08-31");
        assert!(
            events
                .iter()
                .any(|event| event.date == "2026-08-12"
                    && event.kind == SkyEventKind::SolarEclipse),
            "{events:?}"
        );
        // And the partial lunar eclipse later the same month.
        assert!(events.iter().any(|event| event.date == "2026-08-28"
            && event.kind == SkyEventKind::LunarEclipse));
    }

    #[test]
    fn a_window_with_no_events_is_empty_rather_than_an_error() {
        assert!(sky_events_within("2026-09-01", "2026-09-30").is_empty());
    }

    #[test]
    fn the_window_is_inclusive_at_both_ends() {
        assert_eq!(sky_events_within("2026-08-12", "2026-08-12").len(), 1);
        assert_eq!(sky_events_within("2026-08-28", "2026-08-28").len(), 1);
    }

    #[test]
    fn a_reversed_or_unparseable_window_returns_nothing() {
        assert!(sky_events_within("2026-08-31", "2026-08-01").is_empty());
        assert!(sky_events_within("not-a-date", "2026-08-31").is_empty());
        assert!(sky_events_within("2026-08-01", "").is_empty());
    }

    #[test]
    fn events_come_back_in_date_order() {
        let events = sky_events_within("2026-01-01", "2032-12-31");
        let dates: Vec<&str> = events.iter().map(|event| event.date.as_str()).collect();
        let mut sorted = dates.clone();
        sorted.sort_unstable();
        assert_eq!(dates, sorted);
    }

    /// The bundle is a transcription of two NASA catalogues, so the guard is
    /// that every row survived it intact rather than that the astronomy is
    /// right — nothing here is computed.
    #[test]
    fn every_bundled_event_is_well_formed() {
        let events = sky_events_within("1900-01-01", "2100-01-01");
        assert_eq!(events.len(), 31, "15 solar and 16 lunar were transcribed");
        for event in &events {
            assert!(
                event.date.len() == 10 && event.date.parse::<Date>().is_ok(),
                "bad date {:?}",
                event.date
            );
            assert!(!event.label.is_empty(), "{:?} has no label", event.date);
            assert!(!event.region.is_empty(), "{:?} has no region", event.date);
        }
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == SkyEventKind::SolarEclipse)
                .count(),
            15
        );
    }
}
