//! Public holidays at the destination during the trip, parsed from the
//! Nager.Date API and filtered to the trip's date window.
//!
//! IO-free: the parser reads a Nager.Date v3 `PublicHolidays/{year}/{country}`
//! response; the application layer owns the consent-gated fetch and the dated
//! snapshot. Only entries that are actual public holidays (Nager `types`
//! include `"Public"`) are kept — bank, observance, optional and school days
//! are not "everything is closed" days and would mislead a traveller.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// One public holiday at the destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicHoliday {
    /// ISO `YYYY-MM-DD`.
    pub date: String,
    /// English name.
    pub name: String,
    /// The holiday's name in the country's own language.
    pub local_name: String,
    /// National (`true`) versus regional / subdivision-only (`false`).
    pub global: bool,
}

/// A dated snapshot of the destination country's public holidays, as fetched.
/// Stores every holiday across the trip's years; the trip detail filters to the
/// travel window on read, so a date edit re-narrows without a re-fetch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicHolidaysSnapshot {
    /// ISO-3166-1 alpha-2 of the destination country.
    pub country_code: String,
    /// The destination country's English name, for labelling.
    pub country_name: String,
    /// Public holidays across the trip's years (unfiltered).
    pub holidays: Vec<PublicHoliday>,
    pub retrieved_at: String,
}

/// One raw Nager.Date entry — only the fields kept, plus `types` for the
/// public-holiday filter.
#[derive(Deserialize)]
struct NagerHoliday {
    date: String,
    #[serde(rename = "localName", default)]
    local_name: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    global: bool,
    #[serde(default)]
    types: Vec<String>,
}

/// Parse a Nager.Date v3 `PublicHolidays` array, keeping only entries that are
/// public holidays (their `types` include `"Public"`).
pub fn parse_nager_holidays(json: &str) -> Result<Vec<PublicHoliday>, AppError> {
    let raw: Vec<NagerHoliday> = serde_json::from_str(json).map_err(|_| unreadable())?;
    Ok(raw
        .into_iter()
        .filter(|holiday| holiday.types.iter().any(|kind| kind == "Public"))
        .map(|holiday| PublicHoliday {
            date: holiday.date,
            name: holiday.name,
            local_name: holiday.local_name,
            global: holiday.global,
        })
        .collect())
}

/// The holidays whose date falls within `[start, end]` inclusive, sorted by
/// date then name, with exact duplicates collapsed. ISO `YYYY-MM-DD` strings
/// compare in date order, so no date parsing is needed.
pub fn holidays_within(holidays: &[PublicHoliday], start: &str, end: &str) -> Vec<PublicHoliday> {
    let mut within: Vec<PublicHoliday> = holidays
        .iter()
        .filter(|holiday| holiday.date.as_str() >= start && holiday.date.as_str() <= end)
        .cloned()
        .collect();
    within.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.name.cmp(&b.name)));
    within.dedup_by(|a, b| a.date == b.date && a.name == b.name);
    within
}

fn unreadable() -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        "the public-holiday source returned something Voyalier could not read",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // A Public national holiday, a Public regional one, an Observance to drop,
    // and a Public one outside the sample trip window.
    const SAMPLE: &str = r#"[
      {"date":"2027-04-29","localName":"昭和の日","name":"Shōwa Day","countryCode":"JP","global":true,"counties":null,"types":["Public"]},
      {"date":"2027-05-03","localName":"憲法記念日","name":"Constitution Memorial Day","countryCode":"JP","global":true,"counties":null,"types":["Public"]},
      {"date":"2027-12-31","localName":"大晦日","name":"New Year's Eve","countryCode":"JP","global":true,"counties":null,"types":["Observance"]},
      {"date":"2027-07-04","localName":"Local Fete","name":"Local Fete","countryCode":"JP","global":false,"counties":["JP-01"],"types":["Public"]}
    ]"#;

    #[test]
    fn parses_public_holidays_and_drops_non_public_types() {
        let holidays = parse_nager_holidays(SAMPLE).expect("parsed");
        // The Observance (New Year's Eve) is dropped; three Public entries stay.
        assert_eq!(holidays.len(), 3);
        assert!(holidays.iter().all(|h| h.name != "New Year's Eve"));
        let showa = holidays
            .iter()
            .find(|h| h.date == "2027-04-29")
            .expect("shōwa day");
        assert_eq!(showa.name, "Shōwa Day");
        assert_eq!(showa.local_name, "昭和の日");
        assert!(showa.global);
        // The regional fete is kept but flagged non-global.
        let fete = holidays
            .iter()
            .find(|h| h.date == "2027-07-04")
            .expect("fete");
        assert!(!fete.global);
        // A malformed feed is an error, never a panic.
        assert!(parse_nager_holidays("<html>500</html>").is_err());
    }

    #[test]
    fn filters_holidays_to_the_trip_window_sorted() {
        let holidays = parse_nager_holidays(SAMPLE).expect("parsed");
        // A trip 2027-04-28 .. 2027-05-04 covers Shōwa Day (04-29) and
        // Constitution Day (05-03); the 07-04 fete is outside it.
        let within = holidays_within(&holidays, "2027-04-28", "2027-05-04");
        assert_eq!(within.len(), 2);
        assert_eq!(within[0].date, "2027-04-29");
        assert_eq!(within[1].date, "2027-05-03");
        // A window with no holidays yields nothing, never a panic.
        assert!(holidays_within(&holidays, "2027-06-01", "2027-06-30").is_empty());
    }
}
