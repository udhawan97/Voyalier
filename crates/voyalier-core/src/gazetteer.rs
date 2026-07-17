//! Offline city gazetteer for destination autocomplete.
//!
//! ~34,000 cities (GeoNames `cities15000`, CC BY 4.0 — attribution "GeoNames")
//! are compiled in, sorted by population so the biggest match surfaces first.
//! Given a prefix, this returns matching cities with their country — network-
//! free and deterministic. Ranking is population then file order, never a model.
//!
//! The city names and their folded ascii forms are lower-cased **once** at
//! parse time, so a keystroke only lower-cases the short query and scans
//! `starts_with`.

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// `name⇥ascii⇥cc⇥population`, ascii empty when equal to name, population-sorted.
const CITIES_TSV: &str = include_str!("data/cities.tsv");
/// `cc⇥country name`, ISO-3166-1 alpha-2.
const COUNTRIES_TSV: &str = include_str!("data/countries.tsv");

/// One city match, ready to label a suggestion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CitySuggestion {
    pub name: String,
    pub country_code: String,
    pub country: String,
}

/// A parsed city, borrowing its display fields from the embedded string and
/// carrying pre-folded lower-case forms for matching.
struct City {
    name: &'static str,
    cc: &'static str,
    name_lower: String,
    /// GeoNames' own ascii transliteration, when it differs from the name.
    /// This is how German "Zürich" → "Zuerich" (ü→ue) matches a query of "zue".
    ascii_lower: Option<String>,
    /// The name with diacritics naively stripped (ü→u, é→e, …), when it differs
    /// from both forms above. This is what a query typed on a plain keyboard
    /// hits: "zur" → "Zürich" via "zurich", which GeoNames' "zuerich" would
    /// miss. Together the two folds accept both habits.
    stripped_lower: Option<String>,
}

/// Strip common Latin diacritics from one character to its ASCII base, so a
/// query typed without accents still matches. Not exhaustive: it covers the
/// Latin-1 letters that appear in place names, and leaves anything else alone.
fn strip_diacritic(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' | 'ĉ' | 'ċ' => 'c',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ę' | 'ě' => 'e',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' | 'ı' => 'i',
        'ñ' | 'ń' | 'ň' | 'ņ' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => 'u',
        'ý' | 'ÿ' => 'y',
        'ß' => 's',
        'ł' => 'l',
        'ð' => 'd',
        _ => c,
    }
}

fn strip_diacritics(value: &str) -> String {
    value.chars().map(strip_diacritic).collect()
}

fn countries() -> &'static HashMap<&'static str, &'static str> {
    static PARSED: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    PARSED.get_or_init(|| {
        COUNTRIES_TSV
            .lines()
            .filter_map(|line| line.split_once('\t'))
            .collect()
    })
}

fn cities() -> &'static [City] {
    static PARSED: OnceLock<Vec<City>> = OnceLock::new();
    PARSED.get_or_init(|| {
        CITIES_TSV
            .lines()
            .filter_map(|line| {
                let mut parts = line.splitn(4, '\t');
                let name = parts.next()?;
                let ascii = parts.next()?;
                let cc = parts.next()?;
                // The fourth field (population) is only used for the pre-sort.
                let name_lower = name.to_lowercase();
                let ascii_lower = if ascii.is_empty() || ascii == name {
                    None
                } else {
                    Some(ascii.to_lowercase())
                };
                let stripped = strip_diacritics(&name_lower);
                let stripped_lower = if stripped == name_lower
                    || ascii_lower.as_deref() == Some(stripped.as_str())
                {
                    None
                } else {
                    Some(stripped)
                };
                Some(City {
                    name,
                    cc,
                    name_lower,
                    ascii_lower,
                    stripped_lower,
                })
            })
            .collect()
    })
}

/// The `limit` cities whose name (or folded ascii name) starts with `query`,
/// biggest first. A blank query returns nothing rather than the whole world.
pub fn search_cities(query: &str, limit: usize) -> Vec<CitySuggestion> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }
    let countries = countries();
    cities()
        .iter()
        .filter(|city| {
            let matches = |form: &str| form.starts_with(&needle);
            matches(&city.name_lower)
                || city.ascii_lower.as_deref().is_some_and(matches)
                || city.stripped_lower.as_deref().is_some_and(matches)
        })
        .take(limit)
        .map(|city| CitySuggestion {
            name: city.name.to_owned(),
            country_code: city.cc.to_owned(),
            // An unknown country code degrades to the code itself, never blank.
            country: countries
                .get(city.cc)
                .map_or(city.cc, |name| name)
                .to_owned(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_cities_by_prefix_biggest_first() {
        let kyoto = search_cities("kyoto", 5);
        assert_eq!(kyoto[0].name, "Kyoto");
        assert_eq!(kyoto[0].country, "Japan");

        // Population sort surfaces the big Paris (France, 2.1M) first, not a
        // smaller same-named town.
        let paris = search_cities("paris", 5);
        assert_eq!(paris[0].name, "Paris");
        assert_eq!(paris[0].country, "France");

        // Prefix, not contains: "york" must not surface "New York".
        assert!(
            search_cities("york", 8)
                .iter()
                .all(|c| c.name != "New York")
        );
    }

    #[test]
    fn matches_accents_via_the_ascii_name_and_bounds_the_result() {
        // "zur" matches "Zürich" through its folded ascii name.
        assert!(search_cities("zur", 8).iter().any(|c| c.name == "Zürich"));
        // A blank query suggests nothing rather than dumping the whole world.
        assert!(search_cities("   ", 8).is_empty());
        assert!(search_cities("kyoto", 0).is_empty());
        // The cap holds.
        assert!(search_cities("san", 8).len() <= 8);
        // Nonsense yields nothing, never a panic.
        assert!(search_cities("zzzzzznotacity", 8).is_empty());
    }

    #[test]
    fn the_bundled_gazetteer_is_well_formed() {
        assert!(cities().len() > 30_000, "cities: {}", cities().len());
        assert!(countries().len() > 200, "countries: {}", countries().len());
        assert_eq!(countries().get("JP").copied(), Some("Japan"));
    }
}
