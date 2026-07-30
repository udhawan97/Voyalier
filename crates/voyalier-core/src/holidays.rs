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

/// One school-holiday period at the destination.
///
/// A period, not a day: school holidays run for weeks, so a trip "during" one
/// overlaps it rather than containing it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchoolHoliday {
    /// ISO `YYYY-MM-DD`, inclusive.
    pub start_date: String,
    /// ISO `YYYY-MM-DD`, inclusive.
    pub end_date: String,
    /// English name ("Summer Holidays").
    pub name: String,
    /// Whether the period covers the whole country.
    pub nationwide: bool,
    /// The subdivisions it applies to when it is regional; empty when
    /// nationwide. Codes as the source publishes them ("DE-BY").
    #[serde(default)]
    pub subdivisions: Vec<String>,
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
    /// School-holiday periods across the trip's years (unfiltered). Empty both
    /// when the country has none in range and when it is not covered at all —
    /// [`Self::school_holidays_covered`] is what tells those apart.
    #[serde(default)]
    pub school_holidays: Vec<SchoolHoliday>,
    /// Whether the school-holiday source publishes this country at all.
    ///
    /// Its coverage is a subset of the public-holiday source's, so "no school
    /// holidays during your trip" and "nobody publishes school holidays for
    /// this country" are different answers and the interface must not merge
    /// them into one silent empty list.
    #[serde(default)]
    pub school_holidays_covered: bool,
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

/// Fetch a country's public holidays for each of `years`.
///
/// Which source answers, how a year and country address it, and what a year it
/// cannot cover means are this module's knowledge. A year that fails or parses
/// as nothing contributes nothing rather than failing the whole fetch: a trip
/// spanning a year the source has not published yet still gets the year it has.
pub fn public_holidays(
    country_code: &str,
    years: impl IntoIterator<Item = i32>,
    mut fetch: impl FnMut(&str) -> Result<String, AppError>,
) -> Vec<PublicHoliday> {
    let mut holidays = Vec::new();
    for year in years {
        let url = format!("https://date.nager.at/api/v3/PublicHolidays/{year}/{country_code}");
        if let Some(parsed) = fetch(&url)
            .ok()
            .and_then(|body| parse_nager_holidays(&body).ok())
        {
            holidays.extend(parsed);
        }
    }
    holidays
}

/// The countries the school-holiday source publishes, as ISO-3166-1 alpha-2.
///
/// A subset of the public-holiday source's coverage, so it is enumerated rather
/// than assumed: a country that is not here is never fetched for, and its
/// snapshot says "not covered" instead of "none found".
pub const SCHOOL_HOLIDAY_COUNTRIES: &[&str] = &[
    "AD", "AL", "AT", "BE", "BG", "BR", "BY", "CH", "CZ", "DE", "EE", "ES", "FR", "HR", "HU", "IE",
    "IT", "LI", "LT", "LU", "LV", "MC", "MD", "MT", "MX", "NL", "PL", "PT", "RO", "RS", "SE", "SI",
    "SK", "SM", "VA", "ZA",
];

/// Whether the school-holiday source covers a country.
pub fn school_holidays_covered(country_code: &str) -> bool {
    SCHOOL_HOLIDAY_COUNTRIES.contains(&country_code.trim().to_ascii_uppercase().as_str())
}

/// One raw OpenHolidays entry. Names arrive as a language-tagged list.
#[derive(Deserialize)]
struct OpenHolidaysEntry {
    #[serde(rename = "startDate", default)]
    start_date: String,
    #[serde(rename = "endDate", default)]
    end_date: String,
    #[serde(default)]
    name: Vec<OpenHolidaysName>,
    #[serde(default)]
    nationwide: bool,
    #[serde(default)]
    subdivisions: Vec<OpenHolidaysSubdivision>,
}

#[derive(Deserialize)]
struct OpenHolidaysName {
    #[serde(default)]
    language: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct OpenHolidaysSubdivision {
    #[serde(default)]
    code: String,
}

/// Parse an OpenHolidays `SchoolHolidays` array.
///
/// The English name is preferred and the first published name is the fallback,
/// so a country that publishes only in its own language still names its
/// holidays rather than showing a blank row. An entry without dates is dropped:
/// a period with no start and no end cannot be placed against a trip.
pub fn parse_openholidays_school(json: &str) -> Result<Vec<SchoolHoliday>, AppError> {
    let raw: Vec<OpenHolidaysEntry> = serde_json::from_str(json).map_err(|_| unreadable())?;
    Ok(raw
        .into_iter()
        .filter(|entry| !entry.start_date.is_empty() && !entry.end_date.is_empty())
        .map(|entry| {
            let name = entry
                .name
                .iter()
                .find(|name| name.language.eq_ignore_ascii_case("EN"))
                .or_else(|| entry.name.first())
                .map(|name| name.text.clone())
                .unwrap_or_default();
            SchoolHoliday {
                start_date: entry.start_date,
                end_date: entry.end_date,
                name,
                nationwide: entry.nationwide,
                subdivisions: entry
                    .subdivisions
                    .into_iter()
                    .map(|subdivision| subdivision.code)
                    .filter(|code| !code.is_empty())
                    .collect(),
            }
        })
        .collect())
}

/// Fetch a country's school holidays across a date range.
///
/// Returns an empty list for an uncovered country without contacting anything —
/// there is no reason to spend a request learning what the coverage list
/// already says. A failed or unreadable response also yields nothing, matching
/// [`public_holidays`]: school terms are texture, never a reason to fail the
/// whole holidays fetch.
pub fn school_holidays(
    country_code: &str,
    valid_from: &str,
    valid_to: &str,
    mut fetch: impl FnMut(&str) -> Result<String, AppError>,
) -> Vec<SchoolHoliday> {
    if !school_holidays_covered(country_code) {
        return Vec::new();
    }
    let url = format!(
        "https://openholidaysapi.org/SchoolHolidays\
         ?countryIsoCode={country_code}&languageIsoCode=EN&validFrom={valid_from}&validTo={valid_to}"
    );
    fetch(&url)
        .ok()
        .and_then(|body| parse_openholidays_school(&body).ok())
        .unwrap_or_default()
}

/// The school-holiday periods that **overlap** `[start, end]` inclusive.
///
/// Overlap, not containment: a six-week summer holiday is never contained in a
/// one-week trip, and containment would report nothing for exactly the trips
/// most affected by it.
pub fn school_holidays_within(
    holidays: &[SchoolHoliday],
    start: &str,
    end: &str,
) -> Vec<SchoolHoliday> {
    let mut within: Vec<SchoolHoliday> = holidays
        .iter()
        .filter(|holiday| holiday.start_date.as_str() <= end && holiday.end_date.as_str() >= start)
        .cloned()
        .collect();
    within.sort_by(|a, b| {
        a.start_date
            .cmp(&b.start_date)
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.subdivisions.cmp(&b.subdivisions))
    });
    within.dedup();
    within
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

    // Two real-shaped OpenHolidays entries: a regional summer period and a
    // nationwide autumn one, plus a dateless entry that cannot be placed.
    const SCHOOL_SAMPLE: &str = r#"[
      {"id":"a","startDate":"2027-06-29","endDate":"2027-08-07","type":"School",
       "name":[{"language":"DE","text":"Sommerferien"},{"language":"EN","text":"Summer Holidays"}],
       "nationwide":false,"subdivisions":[{"code":"DE-SL","shortName":"SL"}]},
      {"id":"b","startDate":"2027-10-12","endDate":"2027-10-24","type":"School",
       "name":[{"language":"EN","text":"Autumn Holidays"}],"nationwide":true,"subdivisions":[]},
      {"id":"c","type":"School","name":[{"language":"EN","text":"Undated"}],"nationwide":true}
    ]"#;

    #[test]
    fn parses_school_holidays_preferring_the_english_name() {
        let holidays = parse_openholidays_school(SCHOOL_SAMPLE).expect("parsed");
        // The dateless entry is dropped; it cannot be placed against a trip.
        assert_eq!(holidays.len(), 2);
        assert_eq!(holidays[0].name, "Summer Holidays");
        assert_eq!(holidays[0].start_date, "2027-06-29");
        assert!(!holidays[0].nationwide);
        assert_eq!(holidays[0].subdivisions, vec!["DE-SL"]);
        assert!(holidays[1].nationwide);
        assert!(holidays[1].subdivisions.is_empty());

        // Only-local names still name the holiday rather than rendering blank.
        let local_only = parse_openholidays_school(
            r#"[{"startDate":"2027-01-02","endDate":"2027-01-06",
                 "name":[{"language":"HU","text":"Téli szünet"}],"nationwide":true}]"#,
        )
        .expect("parsed");
        assert_eq!(local_only[0].name, "Téli szünet");

        assert!(parse_openholidays_school("not json").is_err());
    }

    #[test]
    fn a_trip_inside_a_long_school_holiday_still_finds_it() {
        let holidays = parse_openholidays_school(SCHOOL_SAMPLE).expect("parsed");

        // The whole point: a one-week July trip is *inside* the six-week summer
        // period, so containment would report nothing for exactly the traveler
        // most affected by it.
        let inside = school_holidays_within(&holidays, "2027-07-10", "2027-07-17");
        assert_eq!(inside.len(), 1);
        assert_eq!(inside[0].name, "Summer Holidays");

        // Touching either edge counts; clearing it does not.
        assert_eq!(
            school_holidays_within(&holidays, "2027-08-07", "2027-08-20").len(),
            1
        );
        assert_eq!(
            school_holidays_within(&holidays, "2027-08-08", "2027-08-20").len(),
            0
        );
        // A window spanning both periods gets both, earliest first.
        let both = school_holidays_within(&holidays, "2027-06-01", "2027-12-01");
        assert_eq!(both.len(), 2);
        assert_eq!(both[0].start_date, "2027-06-29");
    }

    #[test]
    fn an_uncovered_country_is_never_fetched_for() {
        let mut calls = 0;
        let fetched = school_holidays("JP", "2027-01-01", "2027-12-31", |_| {
            calls += 1;
            Ok(SCHOOL_SAMPLE.to_owned())
        });
        // Japan is not in the source's list, so nothing is spent finding out.
        assert!(fetched.is_empty());
        assert_eq!(calls, 0);
        assert!(!school_holidays_covered("JP"));

        let covered = school_holidays("de", "2027-01-01", "2027-12-31", |url| {
            assert!(url.contains("countryIsoCode=de"), "{url}");
            assert!(url.contains("validFrom=2027-01-01"), "{url}");
            Ok(SCHOOL_SAMPLE.to_owned())
        });
        assert_eq!(covered.len(), 2);
        // Case-insensitive, because the geocoder's code casing is not ours.
        assert!(school_holidays_covered("de"));

        // An unreachable source contributes nothing rather than erroring: school
        // terms are texture, never a reason to fail the holidays fetch.
        let failed = school_holidays("DE", "2027-01-01", "2027-12-31", |_| Err(unreadable()));
        assert!(failed.is_empty());
    }

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
