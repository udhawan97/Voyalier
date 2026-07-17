//! Tipping norms per country: a short, conservative rough guide compiled from
//! Wikivoyage and Wikipedia tipping guidance.
//!
//! Informational only. Customs vary within a country and change over time, so
//! each entry is deliberately cautious and the interface frames the whole thing
//! as a rough guide — never a rule. Bundled and resolved fresh from the country
//! code on each read, so a corrected value never freezes into a stored snapshot.
//! Keyed on the same ISO-3166-1 alpha-2 codes as the country-facts table.

/// A one-line tipping guide for a country, or `None` when not curated.
pub fn tipping_guidance(iso2: &str) -> Option<&'static str> {
    TIPPING
        .iter()
        .find(|(code, _)| *code == iso2)
        .map(|(_, guide)| *guide)
}

/// Conservative, widely-documented norms for the curated countries. Where the
/// custom is genuinely mixed the entry errs toward "optional / round up" — the
/// advice that is rarely wrong.
const TIPPING: &[(&str, &str)] = &[
    (
        "AU",
        "Not expected; rounding up for good service is a nice gesture, not an obligation.",
    ),
    (
        "AT",
        "Round up or add about 5–10% at restaurants, handed to the server as you pay.",
    ),
    (
        "BE",
        "Service is included; rounding up or a few euros for good service is plenty.",
    ),
    (
        "BR",
        "A service charge of about 10% is usually added; extra is not expected.",
    ),
    (
        "CA",
        "Tipping is expected: about 15–20% at restaurants and similar for taxis.",
    ),
    (
        "CN",
        "Not customary in most of the mainland, and tips are sometimes refused.",
    ),
    (
        "HR",
        "Round up or about 10% for good service; not obligatory.",
    ),
    ("DK", "Service is included by law; rounding up is optional."),
    (
        "EG",
        "Small tips (\"baksheesh\") are customary for many services; about 10% at restaurants.",
    ),
    (
        "FI",
        "Not expected; service is included, though rounding up is fine.",
    ),
    (
        "FR",
        "Service is included (\"service compris\"); round up or leave a few euros for good service.",
    ),
    (
        "DE",
        "Round up or add about 5–10%, told to the server as you pay rather than left on the table.",
    ),
    (
        "GR",
        "Round up or about 5–10% for good service; not obligatory.",
    ),
    ("IS", "Not expected; service is included."),
    (
        "IN",
        "About 5–10% at restaurants where service is not already added; small tips are appreciated.",
    ),
    (
        "ID",
        "A service charge is often added; otherwise rounding up is appreciated.",
    ),
    (
        "IE",
        "About 10–15% at restaurants if service is not included; not expected at the pub bar.",
    ),
    (
        "IT",
        "A cover charge (\"coperto\") is common; any extra tipping is modest and optional.",
    ),
    (
        "JP",
        "Not customary and can cause confusion — service is already included.",
    ),
    (
        "MY",
        "Not expected; a service charge is often added at restaurants.",
    ),
    ("MX", "About 10–15% at restaurants is customary."),
    (
        "MA",
        "Small tips are customary for many services; about 10% at restaurants.",
    ),
    (
        "NL",
        "Service is included; round up or a few euros for good service.",
    ),
    (
        "NZ",
        "Not expected; a tip for great service is a bonus, not the norm.",
    ),
    ("NO", "Not expected; rounding up for good service is fine."),
    (
        "PE",
        "About 10% at restaurants where service is not already included.",
    ),
    (
        "PL",
        "About 10% for good service; saying \"thank you\" as you pay can mean \"keep the change\".",
    ),
    (
        "PT",
        "Modest and optional; round up or about 5–10% for good service.",
    ),
    (
        "SG",
        "Not customary; a service charge is usually added and tipping is discouraged in some places.",
    ),
    ("ZA", "About 10–15% at restaurants is customary."),
    ("KR", "Not customary; tipping is generally not expected."),
    (
        "ES",
        "Modest and optional; round up or leave a few euros for good service.",
    ),
    ("SE", "Service is included; rounding up is optional."),
    (
        "CH",
        "Service is included by law; rounding up for good service is common.",
    ),
    (
        "TH",
        "Not obligatory; rounding up or about 10% at restaurants is appreciated.",
    ),
    (
        "TR",
        "About 10% at restaurants; a service charge is sometimes added.",
    ),
    (
        "AE",
        "A service charge is often added; an extra 10–15% is appreciated but not required.",
    ),
    (
        "US",
        "Tipping is expected and part of workers' pay: about 15–20% at restaurants and 15% for taxis.",
    ),
    (
        "VN",
        "Not obligatory but increasingly appreciated; small tips or rounding up.",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_tipping_guidance() {
        assert!(
            tipping_guidance("JP")
                .expect("japan")
                .to_lowercase()
                .contains("not customary")
        );
        assert!(
            tipping_guidance("US")
                .expect("usa")
                .to_lowercase()
                .contains("expected")
        );
        // An uncurated code has no guidance, never a wrong guess.
        assert!(tipping_guidance("ZZ").is_none());
    }

    #[test]
    fn every_country_with_facts_has_tipping() {
        // Any destination that can get country facts can also get a tipping note.
        for facts in crate::facts::COUNTRY_FACTS {
            assert!(
                tipping_guidance(facts.iso2).is_some(),
                "no tipping guidance for {}",
                facts.iso2
            );
        }
    }
}
