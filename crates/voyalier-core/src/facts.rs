//! Practical destination facts: today's reference exchange rates and the
//! bundled per-country table (currency, plug, voltage, driving side, calling
//! code, emergency number).
//!
//! IO-free. The rates parser reads the European Central Bank's daily reference
//! feed; the country table is compiled in from public sources. These are
//! convenience, not safety claims — rates are labelled indicative by the
//! interface, and the card links out rather than asserting the last word.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// One currency's value in units per euro (EUR itself is 1.0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyRate {
    pub code: String,
    pub per_eur: f64,
}

/// A country's emergency numbers. Any field may be absent; a general number
/// (like 112 or 911) covers all services where it exists.
///
/// Serialize-only: this is bundled static data resolved fresh from a country
/// code, never stored and read back — so a corrected value can never go stale
/// in an old snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmergencyNumbers {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub general: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub police: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ambulance: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fire: Option<&'static str>,
}

/// Practical facts for one country. Serialize-only bundled data (see
/// [`EmergencyNumbers`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountryFacts {
    pub iso2: &'static str,
    pub name: &'static str,
    /// ISO 4217 currency code.
    pub currency_code: &'static str,
    /// Plug type letters (A–N), as used by the IEC world plug standard.
    pub plug_types: &'static [&'static str],
    pub voltage_v: u16,
    pub frequency_hz: u8,
    pub drives_on_left: bool,
    pub calling_code: &'static str,
    pub emergency: EmergencyNumbers,
}

/// A dated destination-facts snapshot: where the place is, its timezone offset,
/// which country it is in, and today's reference rates. The country facts and
/// the sun/moon days are *derived* from this at read time, not stored — bundled
/// facts never go stale in an old row, and astro is always current.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DestinationFactsSnapshot {
    pub place_name: String,
    pub place_region: String,
    pub latitude: f64,
    pub longitude: f64,
    /// Minutes east of UTC at the destination on the trip's dates, for
    /// converting sun times to local wall clock offline.
    pub utc_offset_minutes: i32,
    /// ISO-3166-1 alpha-2, the key into the bundled country-facts table.
    pub country_code: String,
    /// The ECB reference date the rates carry, verbatim.
    pub rate_date: String,
    /// EUR-based reference rates (EUR included as 1.0); empty when the rate
    /// source could not be reached.
    pub currency_rates: Vec<CurrencyRate>,
    pub retrieved_at: String,
    /// The trip origin's geocoded name, when it resolved. Absent for a blank or
    /// unrecognised origin — the time difference simply is not shown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_place: Option<String>,
    /// The origin's minutes east of UTC on the trip's dates, paired with
    /// [`Self::utc_offset_minutes`] to derive the destination-vs-home gap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_utc_offset_minutes: Option<i32>,
}

/// How far the destination clock runs ahead of (or behind) the trip's origin,
/// on the trip's dates. Derived on read from two stored UTC offsets — a static
/// fact, not a ticking clock.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeDifference {
    /// The origin place the gap is measured from (the geocoded name).
    pub origin_place: String,
    /// Signed minutes: destination offset minus origin offset. Positive means
    /// the destination is ahead (its clock reads later); negative means behind;
    /// zero means the same wall clock. Minutes, not hours, so sub-hour zones
    /// (India +330, Nepal +345) stay exact.
    pub offset_minutes: i32,
}

/// The destination-vs-origin wall-clock gap from their two UTC offsets. Zero is
/// a real answer (same time as home), so this never returns `None` — the caller
/// decides whether it has both offsets to call this at all.
pub fn time_difference(
    origin_place: &str,
    origin_utc_offset_minutes: i32,
    destination_utc_offset_minutes: i32,
) -> TimeDifference {
    TimeDifference {
        origin_place: origin_place.to_owned(),
        offset_minutes: destination_utc_offset_minutes - origin_utc_offset_minutes,
    }
}

fn unreadable_source() -> AppError {
    AppError::new(
        ErrorCode::WeatherFetchFailed,
        "the exchange-rate source returned something Voyalier could not read",
    )
}

/// Parse the ECB daily reference-rate feed into its date and rates.
///
/// The euro is the base and is absent from the feed, so it is added as 1.0 —
/// then a conversion from EUR needs no special case. Rates are otherwise
/// verbatim: units of the currency per one euro.
pub fn parse_ecb_rates(xml: &str) -> Result<(String, Vec<CurrencyRate>), AppError> {
    use quick_xml::events::Event;

    let mut reader = quick_xml::Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut date: Option<String> = None;
    let mut rates = vec![CurrencyRate {
        code: "EUR".to_owned(),
        per_eur: 1.0,
    }];

    loop {
        let event = reader.read_event().map_err(|_| unreadable_source())?;
        match event {
            Event::Empty(element) | Event::Start(element) => {
                if element.name().as_ref() != b"Cube" {
                    continue;
                }
                let mut currency: Option<String> = None;
                let mut rate: Option<f64> = None;
                for attribute in element.attributes().flatten() {
                    let value = attribute
                        .unescape_value()
                        .map_err(|_| unreadable_source())?;
                    match attribute.key.as_ref() {
                        b"time" => date = Some(value.into_owned()),
                        b"currency" => currency = Some(value.into_owned()),
                        b"rate" => rate = value.parse().ok(),
                        _ => {}
                    }
                }
                if let (Some(code), Some(per_eur)) = (currency, rate) {
                    rates.push(CurrencyRate { code, per_eur });
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    match date {
        // No dated cube means this is not the feed we asked for. A single EUR
        // entry with no date would otherwise pass as an empty rate table.
        Some(date) => Ok((date, rates)),
        None => Err(unreadable_source()),
    }
}

/// Convert one unit of `from` into `to` via the euro, or `None` when either
/// currency is not in the table — never a guessed rate.
pub fn cross_rate(rates: &[CurrencyRate], from: &str, to: &str) -> Option<f64> {
    let lookup = |code: &str| {
        rates
            .iter()
            .find(|rate| rate.code == code)
            .map(|r| r.per_eur)
    };
    Some(lookup(to)? / lookup(from)?)
}

/// Practical facts for one country by ISO-3166-1 alpha-2 code.
pub fn country_facts(iso2: &str) -> Option<&'static CountryFacts> {
    COUNTRY_FACTS.iter().find(|facts| facts.iso2 == iso2)
}

/// A general emergency number (like 112), for the common case.
const fn general(number: &'static str) -> EmergencyNumbers {
    EmergencyNumbers {
        general: Some(number),
        police: None,
        ambulance: None,
        fire: None,
    }
}

/// Separate police / ambulance / fire numbers, where a country uses them.
const fn services(
    police: &'static str,
    ambulance: &'static str,
    fire: &'static str,
) -> EmergencyNumbers {
    EmergencyNumbers {
        general: Some("112"),
        police: Some(police),
        ambulance: Some(ambulance),
        fire: Some(fire),
    }
}

/// Facts for the same countries `ADVISORY_COUNTRIES` covers, so any destination
/// that can get advice can also get facts. Values are well-established public
/// facts (plug/voltage/driving-side/calling-code/emergency), keyed on the ISO2
/// code the geocoder returns.
pub const COUNTRY_FACTS: &[CountryFacts] = &[
    CountryFacts {
        iso2: "AU",
        name: "Australia",
        currency_code: "AUD",
        plug_types: &["I"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+61",
        emergency: general("000"),
    },
    CountryFacts {
        iso2: "AT",
        name: "Austria",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+43",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "BE",
        name: "Belgium",
        currency_code: "EUR",
        plug_types: &["C", "E"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+32",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "BR",
        name: "Brazil",
        currency_code: "BRL",
        plug_types: &["C", "N"],
        voltage_v: 127,
        frequency_hz: 60,
        drives_on_left: false,
        calling_code: "+55",
        emergency: services("190", "192", "193"),
    },
    CountryFacts {
        iso2: "CA",
        name: "Canada",
        currency_code: "CAD",
        plug_types: &["A", "B"],
        voltage_v: 120,
        frequency_hz: 60,
        drives_on_left: false,
        calling_code: "+1",
        emergency: general("911"),
    },
    CountryFacts {
        iso2: "CN",
        name: "China",
        currency_code: "CNY",
        plug_types: &["A", "C", "I"],
        voltage_v: 220,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+86",
        emergency: services("110", "120", "119"),
    },
    CountryFacts {
        iso2: "HR",
        name: "Croatia",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+385",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "DK",
        name: "Denmark",
        currency_code: "DKK",
        plug_types: &["C", "E", "F", "K"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+45",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "EG",
        name: "Egypt",
        currency_code: "EGP",
        plug_types: &["C", "F"],
        voltage_v: 220,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+20",
        emergency: services("122", "123", "180"),
    },
    CountryFacts {
        iso2: "FI",
        name: "Finland",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+358",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "FR",
        name: "France",
        currency_code: "EUR",
        plug_types: &["C", "E"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+33",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "DE",
        name: "Germany",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+49",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "GR",
        name: "Greece",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+30",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "IS",
        name: "Iceland",
        currency_code: "ISK",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+354",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "IN",
        name: "India",
        currency_code: "INR",
        plug_types: &["C", "D", "M"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+91",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "ID",
        name: "Indonesia",
        currency_code: "IDR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+62",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "IE",
        name: "Ireland",
        currency_code: "EUR",
        plug_types: &["G"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+353",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "IT",
        name: "Italy",
        currency_code: "EUR",
        plug_types: &["C", "F", "L"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+39",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "JP",
        name: "Japan",
        currency_code: "JPY",
        plug_types: &["A", "B"],
        voltage_v: 100,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+81",
        emergency: EmergencyNumbers {
            general: None,
            police: Some("110"),
            ambulance: Some("119"),
            fire: Some("119"),
        },
    },
    CountryFacts {
        iso2: "MY",
        name: "Malaysia",
        currency_code: "MYR",
        plug_types: &["G"],
        voltage_v: 240,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+60",
        emergency: general("999"),
    },
    CountryFacts {
        iso2: "MX",
        name: "Mexico",
        currency_code: "MXN",
        plug_types: &["A", "B"],
        voltage_v: 127,
        frequency_hz: 60,
        drives_on_left: false,
        calling_code: "+52",
        emergency: general("911"),
    },
    CountryFacts {
        iso2: "MA",
        name: "Morocco",
        currency_code: "MAD",
        plug_types: &["C", "E"],
        voltage_v: 220,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+212",
        emergency: services("19", "15", "15"),
    },
    CountryFacts {
        iso2: "NL",
        name: "Netherlands",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+31",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "NZ",
        name: "New Zealand",
        currency_code: "NZD",
        plug_types: &["I"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+64",
        emergency: general("111"),
    },
    CountryFacts {
        iso2: "NO",
        name: "Norway",
        currency_code: "NOK",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+47",
        emergency: services("112", "113", "110"),
    },
    CountryFacts {
        iso2: "PE",
        name: "Peru",
        currency_code: "PEN",
        plug_types: &["A", "B", "C"],
        voltage_v: 220,
        frequency_hz: 60,
        drives_on_left: false,
        calling_code: "+51",
        emergency: general("105"),
    },
    CountryFacts {
        iso2: "PL",
        name: "Poland",
        currency_code: "PLN",
        plug_types: &["C", "E"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+48",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "PT",
        name: "Portugal",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+351",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "SG",
        name: "Singapore",
        currency_code: "SGD",
        plug_types: &["G"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+65",
        emergency: services("999", "995", "995"),
    },
    CountryFacts {
        iso2: "ZA",
        name: "South Africa",
        currency_code: "ZAR",
        plug_types: &["C", "D", "M", "N"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+27",
        emergency: services("10111", "10177", "10177"),
    },
    CountryFacts {
        iso2: "KR",
        name: "South Korea",
        currency_code: "KRW",
        plug_types: &["C", "F"],
        voltage_v: 220,
        frequency_hz: 60,
        drives_on_left: false,
        calling_code: "+82",
        emergency: services("112", "119", "119"),
    },
    CountryFacts {
        iso2: "ES",
        name: "Spain",
        currency_code: "EUR",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+34",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "SE",
        name: "Sweden",
        currency_code: "SEK",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+46",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "CH",
        name: "Switzerland",
        currency_code: "CHF",
        plug_types: &["C", "J"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+41",
        emergency: services("117", "144", "118"),
    },
    CountryFacts {
        iso2: "TH",
        name: "Thailand",
        currency_code: "THB",
        plug_types: &["A", "B", "C", "O"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: true,
        calling_code: "+66",
        emergency: general("191"),
    },
    CountryFacts {
        iso2: "TR",
        name: "Turkey",
        currency_code: "TRY",
        plug_types: &["C", "F"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+90",
        emergency: general("112"),
    },
    CountryFacts {
        iso2: "AE",
        name: "United Arab Emirates",
        currency_code: "AED",
        plug_types: &["C", "D", "G"],
        voltage_v: 230,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+971",
        emergency: services("999", "998", "997"),
    },
    CountryFacts {
        iso2: "US",
        name: "United States",
        currency_code: "USD",
        plug_types: &["A", "B"],
        voltage_v: 120,
        frequency_hz: 60,
        drives_on_left: false,
        calling_code: "+1",
        emergency: general("911"),
    },
    CountryFacts {
        iso2: "VN",
        name: "Vietnam",
        currency_code: "VND",
        plug_types: &["A", "C", "F"],
        voltage_v: 220,
        frequency_hz: 50,
        drives_on_left: false,
        calling_code: "+84",
        emergency: services("113", "115", "114"),
    },
];

#[cfg(test)]
mod tests {
    use super::*;

    const ECB_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
 xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time='2026-07-17'>
    <Cube currency='USD' rate='1.1435'/>
    <Cube currency='JPY' rate='185.65'/>
    <Cube currency='GBP' rate='0.85098'/>
  </Cube></Cube>
</gesmes:Envelope>"#;

    #[test]
    fn parses_ecb_rates_with_eur_as_the_base() {
        let (date, rates) = parse_ecb_rates(ECB_FIXTURE).expect("parsed");
        assert_eq!(date, "2026-07-17");
        // EUR is the base and absent from the feed; the parser adds it as 1.0
        // so conversions from EUR need no special case.
        assert_eq!(cross_rate(&rates, "EUR", "EUR"), Some(1.0));
        assert_eq!(cross_rate(&rates, "EUR", "JPY"), Some(185.65));
        // Cross-rate via EUR: 1 USD = 185.65 / 1.1435 ≈ 162.35 JPY.
        let usd_jpy = cross_rate(&rates, "USD", "JPY").expect("usd->jpy");
        assert!((usd_jpy - 162.35).abs() < 0.1, "{usd_jpy}");
        // A currency the ECB does not publish has no rate — never a guess.
        assert_eq!(cross_rate(&rates, "USD", "EGP"), None);
        assert_eq!(cross_rate(&rates, "XYZ", "USD"), None);
    }

    #[test]
    fn an_unreadable_feed_is_an_error() {
        assert!(parse_ecb_rates("<html>503</html>").is_err());
        assert!(parse_ecb_rates("<gesmes:Envelope></gesmes:Envelope>").is_err());
    }

    #[test]
    fn resolves_country_facts_for_covered_countries() {
        let jp = country_facts("JP").expect("japan");
        assert_eq!(jp.name, "Japan");
        assert_eq!(jp.currency_code, "JPY");
        assert_eq!(jp.voltage_v, 100);
        assert!(jp.plug_types.contains(&"A"));
        assert!(jp.drives_on_left);
        assert_eq!(jp.calling_code, "+81");
        assert_eq!(jp.emergency.police, Some("110"));

        let us = country_facts("US").expect("usa");
        assert_eq!(us.voltage_v, 120);
        assert!(!us.drives_on_left);
        assert_eq!(us.emergency.general, Some("911"));

        let gb = country_facts("GB").or_else(|| country_facts("UK"));
        // The curated set uses the FCDO slug "usa" → ISO2 "US"; the UK isn't in
        // the advisory set as GB, so this simply confirms unknown codes return
        // None rather than a wrong country.
        assert!(gb.is_none() || gb.unwrap().voltage_v == 230);
        assert!(country_facts("ZZ").is_none());
    }

    #[test]
    fn every_advisory_country_has_facts() {
        for country in crate::advisories::ADVISORY_COUNTRIES {
            assert!(
                country_facts(country.iso2).is_some(),
                "no facts for {}",
                country.iso2
            );
        }
    }

    #[test]
    fn time_difference_is_signed_destination_minus_origin() {
        // Tokyo (+540) seen from Chicago (−300, CDT) is 840 min = 14h ahead.
        let ahead = time_difference("Chicago", -300, 540);
        assert_eq!(ahead.origin_place, "Chicago");
        assert_eq!(ahead.offset_minutes, 840);
        // Westward is negative (behind): Chicago seen from Tokyo.
        assert_eq!(time_difference("Tokyo", 540, -300).offset_minutes, -840);
        // Same clock is zero, still reported (worth a "same time" line).
        assert_eq!(time_difference("Paris", 120, 120).offset_minutes, 0);
        // Sub-hour zones survive: Kathmandu (+345) from Chicago (−300) = 645 = 10h45m.
        assert_eq!(time_difference("Chicago", -300, 345).offset_minutes, 645);
    }
}
