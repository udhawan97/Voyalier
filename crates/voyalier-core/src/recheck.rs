//! What changed since the traveler last looked (ADR-0016 §4).
//!
//! Advisories, forecasts and alerts each already carry a retrieval stamp and a
//! staleness window, and each is refreshed one panel at a time by someone who
//! has to remember which ones they last read. This is the rule behind a single
//! explicit sweep: which stored snapshots are old enough to be worth asking
//! about, and — once a fresh copy is in hand — what actually moved.
//!
//! **This is not monitoring.** There is no timer, no daemon, and no wake-up.
//! The click is the consent, exactly as it is for each panel today. What this
//! module contributes is only the comparison, which is deterministic and
//! IO-free like everything else here, so what counts as a change is testable
//! and identical in both languages.
//!
//! A failed source is never an all-clear: the app layer keeps the old snapshot
//! and reports the failure, and no rule in here can turn that into `Unchanged`.

use serde::{Deserialize, Serialize};

use crate::advisories::{AdvisoryPanel, AdvisorySource};
use crate::weather::WeatherSnapshot;

/// How old an official advisory panel may be before a re-check offers to
/// refresh it. Seven days is the window the advice card already warns at, so
/// the sweep and the card cannot disagree about what "stale" means.
pub const ADVISORY_STALE_AFTER_MINUTES: i64 = 7 * 24 * 60;

/// A forecast goes off faster than an advisory does. Twelve hours matches the
/// staleness the weather card already shows.
pub const WEATHER_STALE_AFTER_MINUTES: i64 = 12 * 60;

/// Which consent-gated snapshot a sweep line is about.
///
/// Deliberately short. Destination facts, holidays, place summaries and visa
/// statistics are excluded: a bundled-fact snapshot does not change under the
/// traveler, and widening the sweep would contact hosts they did not have in
/// mind when they clicked (ADR-0016 §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecheckSource {
    Advisories,
    /// The forecast, and the official alerts that ride inside the same
    /// snapshot — they are fetched together, so they go stale together.
    Weather,
}

/// One thing that moved. A code plus the source's own words, never prose this
/// crate authored: the interface says it in the reader's language.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "code",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RecheckChange {
    /// A government's own level wording is not what it was. Never compared
    /// across governments — only against this same government's last words.
    AdvisoryLevel {
        source: AdvisorySource,
        from: Option<String>,
        to: Option<String>,
    },
    /// A government that said nothing about this country now does.
    AdvisoryAdded { source: AdvisorySource },
    /// A government that had an entry no longer publishes one.
    AdvisoryWithdrawn { source: AdvisorySource },
    /// A health notice appeared.
    HealthNoticeAdded { title: String },
    /// A health notice is no longer listed.
    HealthNoticeCleared { title: String },
    /// An official alert now covers the destination.
    AlertRaised { event: String, headline: String },
    /// An alert that was covering the destination is gone.
    AlertCleared { event: String },
    /// The outlook for one or more trip days is different.
    ForecastMoved { day_count: u32 },
}

/// What one source did during a sweep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "code",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RecheckOutcome {
    /// Still inside its staleness window, so nothing was fetched. Reported
    /// rather than silently refetched: the traveler asked what changed, and
    /// "we did not need to ask" is an honest answer.
    Skipped,
    /// Nothing stored yet, so there was nothing to compare against. A first
    /// fetch belongs to the panel that owns it, not to a sweep.
    NeverFetched,
    Unchanged,
    Changed {
        changes: Vec<RecheckChange>,
    },
    /// Could not be read this time. The stored snapshot is kept untouched —
    /// a failed re-check must never read as an all-clear.
    Failed {
        reason: String,
    },
}

/// One line of the sweep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecheckLine {
    pub source: RecheckSource,
    pub outcome: RecheckOutcome,
    /// When the snapshot this line is about was last retrieved, if there is
    /// one. RFC 3339.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previously_retrieved_at: Option<String>,
}

/// The whole sweep. Returned, rendered, and never stored: an answer must not
/// become retrievable later as established knowledge — the rule 0.7.0's chat
/// transcripts already follow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecheckReport {
    pub trip_id: String,
    /// When the sweep ran (RFC 3339).
    pub checked_at: String,
    pub lines: Vec<RecheckLine>,
    /// Every host contacted during this sweep, so the traveler can see exactly
    /// what their click reached. Empty when everything was fresh.
    pub hosts_contacted: Vec<String>,
}

impl RecheckReport {
    /// True when at least one source moved.
    pub fn has_changes(&self) -> bool {
        self.lines
            .iter()
            .any(|line| matches!(line.outcome, RecheckOutcome::Changed { .. }))
    }
}

/// Which hosts a sweep reaches for one source, for the consent sentence and
/// for the report's own record of what the click touched.
///
/// Hostnames, not URLs: the endpoints stay inside the modules that own them
/// (ADR-0008), and what a traveler consents to is *who* is contacted. Kept
/// beside the outcome type it is rendered with, and pinned by a test.
pub fn hosts_for(source: RecheckSource) -> &'static [&'static str] {
    match source {
        RecheckSource::Advisories => &[
            "www.gov.uk",
            "cadataapi.state.gov",
            "data.international.gc.ca",
            "www.auswaertiges-amt.de",
            "wwwnc.cdc.gov",
        ],
        RecheckSource::Weather => &["open-meteo.com", "api.weather.gov"],
    }
}

/// Is a snapshot old enough that a sweep should ask its source again?
///
/// A stamp that cannot be parsed is treated as stale: an unreadable date is not
/// evidence of freshness.
pub fn is_stale(retrieved_at: &str, now: &str, stale_after_minutes: i64) -> bool {
    let (Ok(then), Ok(now)) = (
        retrieved_at.parse::<jiff::Timestamp>(),
        now.parse::<jiff::Timestamp>(),
    ) else {
        return true;
    };
    (now - then).get_seconds() / 60 >= stale_after_minutes
}

/// What moved between two advisory panels for the same country.
pub fn diff_advisory_panel(old: &AdvisoryPanel, new: &AdvisoryPanel) -> Vec<RecheckChange> {
    let mut changes = Vec::new();

    let sources = [
        AdvisorySource::UkFcdo,
        AdvisorySource::UsState,
        AdvisorySource::CaGac,
        AdvisorySource::DeAa,
    ];
    for source in sources {
        let before = old.entries.iter().find(|entry| entry.source == source);
        let after = new.entries.iter().find(|entry| entry.source == source);
        match (before, after) {
            (None, Some(_)) => changes.push(RecheckChange::AdvisoryAdded { source }),
            (Some(_), None) => changes.push(RecheckChange::AdvisoryWithdrawn { source }),
            (Some(before), Some(after)) if before.level_label != after.level_label => {
                changes.push(RecheckChange::AdvisoryLevel {
                    source,
                    from: before.level_label.clone(),
                    to: after.level_label.clone(),
                });
            }
            _ => {}
        }
    }

    // Health notices are identified by title: the feed carries no stable id,
    // and a retitled notice is a different thing to read.
    for notice in &new.health_notices {
        if !old
            .health_notices
            .iter()
            .any(|before| before.title == notice.title)
        {
            changes.push(RecheckChange::HealthNoticeAdded {
                title: notice.title.clone(),
            });
        }
    }
    for notice in &old.health_notices {
        if !new
            .health_notices
            .iter()
            .any(|after| after.title == notice.title)
        {
            changes.push(RecheckChange::HealthNoticeCleared {
                title: notice.title.clone(),
            });
        }
    }

    changes
}

/// What moved between two weather snapshots, alerts included.
///
/// Only days present in *both* snapshots are compared. A forecast window that
/// has rolled forward drops days off the back and gains them at the front, and
/// reporting those as "changed" would make every sweep look eventful.
pub fn diff_weather(old: &WeatherSnapshot, new: &WeatherSnapshot) -> Vec<RecheckChange> {
    let mut changes = Vec::new();

    for alert in &new.alerts {
        if !old.alerts.iter().any(|before| before.event == alert.event) {
            changes.push(RecheckChange::AlertRaised {
                event: alert.event.clone(),
                headline: alert.headline.clone(),
            });
        }
    }
    for alert in &old.alerts {
        if !new.alerts.iter().any(|after| after.event == alert.event) {
            changes.push(RecheckChange::AlertCleared {
                event: alert.event.clone(),
            });
        }
    }

    let moved = new
        .days
        .iter()
        .filter(|day| {
            old.days
                .iter()
                .find(|before| before.date == day.date)
                .is_some_and(|before| {
                    before.weather_code != day.weather_code
                        // Whole degrees: a forecast that ticks 0.1 °C is not
                        // news, and reporting it as news trains a reader to
                        // ignore the line that matters.
                        || before.temp_max_c.round() != day.temp_max_c.round()
                        || before.temp_min_c.round() != day.temp_min_c.round()
                })
        })
        .count() as u32;
    if moved > 0 {
        changes.push(RecheckChange::ForecastMoved { day_count: moved });
    }

    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::advisories::{AdvisoryEntry, HealthNotice};
    use crate::alerts::WeatherAlert;
    use crate::weather::{WeatherCoverage, WeatherDay};

    fn entry(source: AdvisorySource, level: Option<&str>) -> AdvisoryEntry {
        AdvisoryEntry {
            source,
            source_name: "Source".to_owned(),
            country_name: "Japan".to_owned(),
            level_label: level.map(ToOwned::to_owned),
            level_rank: None,
            summary: "Summary".to_owned(),
            source_url: "https://example.test/advice".to_owned(),
            source_updated_at: None,
            change_description: None,
            language: "en".to_owned(),
            attribution: "Attribution".to_owned(),
            retrieved_at: "2026-08-01T00:00:00Z".to_owned(),
        }
    }

    fn panel(entries: Vec<AdvisoryEntry>, notices: Vec<&str>) -> AdvisoryPanel {
        AdvisoryPanel {
            country_slug: "japan".to_owned(),
            country_name: "Japan".to_owned(),
            entries,
            health_notices: notices
                .into_iter()
                .map(|title| HealthNotice {
                    title: title.to_owned(),
                    url: "https://example.test/notice".to_owned(),
                    level_label: None,
                    published_at: None,
                    summary: String::new(),
                })
                .collect(),
            source_status: Vec::new(),
            retrieved_at: "2026-08-01T00:00:00Z".to_owned(),
        }
    }

    fn snapshot(days: Vec<WeatherDay>, alerts: Vec<WeatherAlert>) -> WeatherSnapshot {
        WeatherSnapshot {
            place_name: "Kyoto".to_owned(),
            place_region: "Japan".to_owned(),
            latitude: 35.0,
            longitude: 135.7,
            days,
            coverage: WeatherCoverage::Full,
            source_url: "https://open-meteo.com".to_owned(),
            retrieved_at: "2026-08-01T00:00:00Z".to_owned(),
            normals: None,
            air_quality: Vec::new(),
            alerts,
        }
    }

    fn day(date: &str, code: u8, max: f64, min: f64) -> WeatherDay {
        WeatherDay {
            date: date.to_owned(),
            weather_code: code,
            description: "Clear".to_owned(),
            temp_max_c: max,
            temp_min_c: min,
            precipitation_chance_pct: None,
        }
    }

    fn alert(event: &str) -> WeatherAlert {
        WeatherAlert {
            event: event.to_owned(),
            severity: "Severe".to_owned(),
            headline: format!("{event} in effect"),
            area: "Kyoto".to_owned(),
            onset: None,
            ends: None,
            sender: "NWS".to_owned(),
            url: "https://example.test/alert".to_owned(),
        }
    }

    #[test]
    fn an_unreadable_stamp_counts_as_stale() {
        assert!(is_stale("not a date", "2026-08-01T00:00:00Z", 60));
        assert!(is_stale("2026-08-01T00:00:00Z", "also not a date", 60));
    }

    #[test]
    fn staleness_is_measured_against_the_window() {
        let then = "2026-08-01T00:00:00Z";
        assert!(!is_stale(
            then,
            "2026-08-01T06:00:00Z",
            WEATHER_STALE_AFTER_MINUTES
        ));
        assert!(is_stale(
            then,
            "2026-08-01T12:00:00Z",
            WEATHER_STALE_AFTER_MINUTES
        ));
        assert!(!is_stale(
            then,
            "2026-08-05T00:00:00Z",
            ADVISORY_STALE_AFTER_MINUTES
        ));
        assert!(is_stale(
            then,
            "2026-08-08T00:00:00Z",
            ADVISORY_STALE_AFTER_MINUTES
        ));
    }

    #[test]
    fn an_identical_panel_reports_nothing() {
        let before = panel(
            vec![entry(AdvisorySource::UkFcdo, Some("Advise against"))],
            vec!["Measles"],
        );
        assert!(diff_advisory_panel(&before, &before.clone()).is_empty());
    }

    #[test]
    fn a_level_change_names_the_government_and_both_wordings() {
        let before = panel(
            vec![entry(AdvisorySource::UsState, Some("Level 2"))],
            vec![],
        );
        let after = panel(
            vec![entry(AdvisorySource::UsState, Some("Level 3"))],
            vec![],
        );
        assert_eq!(
            diff_advisory_panel(&before, &after),
            vec![RecheckChange::AdvisoryLevel {
                source: AdvisorySource::UsState,
                from: Some("Level 2".to_owned()),
                to: Some("Level 3".to_owned()),
            }]
        );
    }

    #[test]
    fn a_government_appearing_or_withdrawing_is_reported() {
        let empty = panel(vec![], vec![]);
        let present = panel(
            vec![entry(
                AdvisorySource::CaGac,
                Some("Take normal precautions"),
            )],
            vec![],
        );
        assert_eq!(
            diff_advisory_panel(&empty, &present),
            vec![RecheckChange::AdvisoryAdded {
                source: AdvisorySource::CaGac
            }]
        );
        assert_eq!(
            diff_advisory_panel(&present, &empty),
            vec![RecheckChange::AdvisoryWithdrawn {
                source: AdvisorySource::CaGac
            }]
        );
    }

    #[test]
    fn health_notices_are_compared_in_both_directions() {
        let before = panel(vec![], vec!["Dengue"]);
        let after = panel(vec![], vec!["Measles"]);
        let changes = diff_advisory_panel(&before, &after);
        assert!(changes.contains(&RecheckChange::HealthNoticeAdded {
            title: "Measles".to_owned()
        }));
        assert!(changes.contains(&RecheckChange::HealthNoticeCleared {
            title: "Dengue".to_owned()
        }));
    }

    #[test]
    fn a_raised_alert_carries_the_sources_own_words() {
        let before = snapshot(vec![], vec![]);
        let after = snapshot(vec![], vec![alert("Flood Warning")]);
        assert_eq!(
            diff_weather(&before, &after),
            vec![RecheckChange::AlertRaised {
                event: "Flood Warning".to_owned(),
                headline: "Flood Warning in effect".to_owned(),
            }]
        );
        assert_eq!(
            diff_weather(&after, &before),
            vec![RecheckChange::AlertCleared {
                event: "Flood Warning".to_owned()
            }]
        );
    }

    #[test]
    fn a_rolled_forward_forecast_window_is_not_a_change() {
        // The old snapshot covered the 1st–3rd; the new one covers the 2nd–4th
        // with identical readings for the overlap. Nothing moved.
        let before = snapshot(
            vec![
                day("2026-08-01", 0, 30.0, 20.0),
                day("2026-08-02", 0, 31.0, 21.0),
                day("2026-08-03", 0, 32.0, 22.0),
            ],
            vec![],
        );
        let after = snapshot(
            vec![
                day("2026-08-02", 0, 31.0, 21.0),
                day("2026-08-03", 0, 32.0, 22.0),
                day("2026-08-04", 0, 33.0, 23.0),
            ],
            vec![],
        );
        assert!(diff_weather(&before, &after).is_empty());
    }

    #[test]
    fn a_tenth_of_a_degree_is_not_news_but_a_changed_outlook_is() {
        let before = snapshot(vec![day("2026-08-02", 0, 31.0, 21.0)], vec![]);
        let jitter = snapshot(vec![day("2026-08-02", 0, 31.1, 20.9)], vec![]);
        assert!(diff_weather(&before, &jitter).is_empty());

        let stormy = snapshot(vec![day("2026-08-02", 95, 31.0, 21.0)], vec![]);
        assert_eq!(
            diff_weather(&before, &stormy),
            vec![RecheckChange::ForecastMoved { day_count: 1 }]
        );
    }

    #[test]
    fn a_report_knows_whether_anything_moved() {
        let quiet = RecheckReport {
            trip_id: "trip_1".to_owned(),
            checked_at: "2026-08-01T00:00:00Z".to_owned(),
            lines: vec![
                RecheckLine {
                    source: RecheckSource::Advisories,
                    outcome: RecheckOutcome::Unchanged,
                    previously_retrieved_at: None,
                },
                // A failure must never read as an all-clear.
                RecheckLine {
                    source: RecheckSource::Weather,
                    outcome: RecheckOutcome::Failed {
                        reason: "unreachable".to_owned(),
                    },
                    previously_retrieved_at: None,
                },
            ],
            hosts_contacted: vec!["open-meteo.com".to_owned()],
        };
        assert!(!quiet.has_changes());
    }
}
