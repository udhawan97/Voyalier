//! Bundled diplomatic missions: which country keeps an embassy or consulate
//! where, and roughly at what coordinates.
//!
//! **This is a pointer, never a destination.** A mission address is exactly the
//! kind of fact this product does not get to be the authority on: posts move,
//! posts close, and someone reads this in an emergency. Wikidata records closure
//! unevenly — the extract still returned embassies of states that ceased to
//! exist in 1990 until they were filtered out by hand — so if a sender that has
//! not existed for decades survives a `P576` filter, an ordinary post that
//! quietly closed last year certainly can too.
//!
//! What that buys, and all it buys: "your country keeps a mission in this
//! country, in this city, roughly here — now confirm it with your own foreign
//! ministry." Every caller must render the sending country's own mission list
//! beside this. Nothing here is an address to travel to.
//!
//! IO-free like the rest of core: the table is compiled in.

use serde::{Deserialize, Serialize};

/// One row per mission: sender, host, kind, city, latitude, longitude.
///
/// Extracted from Wikidata (CC0) with `P137` as the **sending** country — not
/// `P17`, which is the host, and is the trap that makes a naive extract point
/// every mission at the wrong government. Honorary consulates are excluded:
/// they are private appointments rather than staffed career posts, and mixing
/// them in would offer a traveler a lawyer's office as a consulate.
const MISSIONS_TSV: &str = include_str!("data/missions.tsv");

/// What kind of post it is, normalized off Wikidata's own classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MissionKind {
    Embassy,
    ConsulateGeneral,
    Consulate,
    HighCommission,
}

/// One diplomatic mission a country keeps in another country.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mission {
    /// ISO-3166-1 alpha-2 of the country whose mission this is.
    pub sending_country: String,
    /// ISO-3166-1 alpha-2 of the country it sits in.
    pub host_country: String,
    pub kind: MissionKind,
    /// The city as Wikidata records it. Sometimes a district rather than the
    /// city proper, because the location is the finest-grained admin unit
    /// recorded. Empty when nothing usable was recorded.
    pub city: String,
    pub latitude: f64,
    pub longitude: f64,
}

fn parse_kind(raw: &str) -> Option<MissionKind> {
    match raw {
        "embassy" => Some(MissionKind::Embassy),
        "consulate_general" => Some(MissionKind::ConsulateGeneral),
        "consulate" => Some(MissionKind::Consulate),
        "high_commission" => Some(MissionKind::HighCommission),
        _ => None,
    }
}

/// Every bundled mission, in table order.
fn all_missions() -> impl Iterator<Item = Mission> {
    MISSIONS_TSV.lines().filter_map(|line| {
        let mut fields = line.split('\t');
        let sending_country = fields.next()?;
        let host_country = fields.next()?;
        let kind = parse_kind(fields.next()?)?;
        let city = fields.next()?;
        let latitude: f64 = fields.next()?.parse().ok()?;
        let longitude: f64 = fields.next()?.parse().ok()?;
        Some(Mission {
            sending_country: sending_country.to_owned(),
            host_country: host_country.to_owned(),
            kind,
            city: city.to_owned(),
            latitude,
            longitude,
        })
    })
}

/// The missions `sending_iso2` keeps in `host_iso2`, embassies first.
///
/// Embassies lead because an embassy is the post a traveler in trouble is
/// normally directed to; consulates follow in table order. An uncovered pair
/// returns nothing, which the caller must render as "we do not have this"
/// rather than as "there is none" — absence here is absence from Wikidata, not
/// from the world.
pub fn missions_in(host_iso2: &str, sending_iso2: &str) -> Vec<Mission> {
    let mut found: Vec<Mission> = all_missions()
        .filter(|mission| {
            mission.host_country == host_iso2 && mission.sending_country == sending_iso2
        })
        .collect();
    found.sort_by_key(|mission| match mission.kind {
        MissionKind::Embassy | MissionKind::HighCommission => 0,
        MissionKind::ConsulateGeneral => 1,
        MissionKind::Consulate => 2,
    });
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_senders_missions_in_a_host_country() {
        let found = missions_in("JP", "CA");
        assert!(!found.is_empty());
        // Osaka and Nagoya are recorded as cities; the Tokyo embassy is
        // recorded as "Akasaka", the ward it sits in, because Wikidata's
        // location is the finest-grained admin unit it holds. That is a
        // documented property of the source, not a bug to assert away.
        assert!(found.iter().any(|mission| mission.city == "Osaka"));
        assert!(
            found
                .iter()
                .all(|mission| mission.sending_country == "CA" && mission.host_country == "JP")
        );
    }

    /// The direction that is easy to get backwards is checked by geography
    /// rather than by names: Canada's missions in Japan must sit at Japanese
    /// coordinates, and Japan's in Canada at Canadian ones. Reading Wikidata's
    /// `P17` as the sender would swap both sets.
    #[test]
    fn the_sending_and_host_countries_are_not_reversed() {
        let in_japan = missions_in("JP", "CA");
        let in_canada = missions_in("CA", "JP");
        assert!(!in_japan.is_empty() && !in_canada.is_empty());
        for mission in &in_japan {
            assert!(
                (30.0..46.0).contains(&mission.latitude)
                    && (128.0..146.0).contains(&mission.longitude),
                "not in Japan: {mission:?}"
            );
        }
        for mission in &in_canada {
            assert!(
                (41.0..84.0).contains(&mission.latitude)
                    && (-142.0..-52.0).contains(&mission.longitude),
                "not in Canada: {mission:?}"
            );
        }
    }

    #[test]
    fn an_uncovered_pair_returns_nothing_rather_than_a_guess() {
        assert!(missions_in("ZZ", "CA").is_empty());
        assert!(missions_in("JP", "ZZ").is_empty());
        assert!(missions_in("", "").is_empty());
    }

    #[test]
    fn an_embassy_sorts_ahead_of_a_consulate() {
        let found = missions_in("US", "JP");
        let first_consulate = found
            .iter()
            .position(|mission| mission.kind == MissionKind::Consulate);
        let last_embassy = found
            .iter()
            .rposition(|mission| mission.kind == MissionKind::Embassy);
        if let (Some(consulate), Some(embassy)) = (first_consulate, last_embassy) {
            assert!(embassy < consulate);
        }
    }

    /// The bundle is a filtered transcription, so the guard is that every row
    /// survived it intact.
    #[test]
    fn every_bundled_row_is_well_formed() {
        let mut count = 0;
        for mission in all_missions() {
            count += 1;
            assert_eq!(mission.sending_country.len(), 2, "{mission:?}");
            assert_eq!(mission.host_country.len(), 2, "{mission:?}");
            assert_ne!(
                mission.sending_country, mission.host_country,
                "a country does not send a mission to itself: {mission:?}"
            );
            assert!(
                (-90.0..=90.0).contains(&mission.latitude),
                "bad latitude {mission:?}"
            );
            assert!(
                (-180.0..=180.0).contains(&mission.longitude),
                "bad longitude {mission:?}"
            );
        }
        assert!(count > 9000, "expected the full bundle, got {count}");
    }

    /// Every country named must be one the bundled country-name table knows,
    /// or the panel would name a state that no longer exists. The extract
    /// really did return embassies of East Germany and Yugoslavia before this
    /// filter; both are absent from that table, which is what removed them.
    #[test]
    fn every_country_named_is_a_current_country() {
        let current: std::collections::BTreeSet<&str> = include_str!("data/countries.tsv")
            .lines()
            .filter_map(|line| line.split('\t').next())
            .collect();
        for mission in all_missions() {
            assert!(
                current.contains(mission.sending_country.as_str()),
                "unknown sending country {}",
                mission.sending_country
            );
            assert!(
                current.contains(mission.host_country.as_str()),
                "unknown host country {}",
                mission.host_country
            );
        }
    }
}
