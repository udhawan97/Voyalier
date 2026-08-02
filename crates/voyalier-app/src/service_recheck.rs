//! One explicit sweep over the trip's stale consent-gated snapshots
//! (ADR-0016 §4).
//!
//! No timer, no daemon, no background thread: this runs when — and only when —
//! the traveler asks. It reuses the same per-panel fetches they could run by
//! hand, so nothing new is contacted; what it adds is doing them together and
//! saying what moved.
//!
//! Two rules make the report trustworthy, and both are tested:
//!
//! - a source still inside its staleness window is reported `Skipped`, not
//!   silently refetched;
//! - a source that fails keeps its stored snapshot and is reported `Failed`,
//!   because a failed re-check must never read as an all-clear.

use voyalier_core::{
    ADVISORY_STALE_AFTER_MINUTES, AppError, RecheckLine, RecheckOutcome, RecheckReport,
    RecheckSource, WEATHER_STALE_AFTER_MINUTES, diff_advisory_panel, diff_weather, hosts_for,
    is_stale, now_rfc3339,
};

use crate::{AppService, fetch_weather_snapshot, load_advisory_panel};

impl AppService {
    /// Refresh whatever has gone stale, and report what changed.
    ///
    /// The report is returned and never stored. An answer that could be
    /// retrieved later would become established knowledge, which is exactly
    /// what a dated snapshot is careful not to be — the rule 0.7.0's chat
    /// transcripts already follow.
    pub fn recheck_trip(&self, trip_id: &str) -> Result<RecheckReport, AppError> {
        // Validate the trip before anything reaches the network.
        {
            let connection = self.connection()?;
            self.records(&connection).trip(trip_id)?;
        }
        let checked_at = now_rfc3339();
        let mut lines = Vec::new();
        let mut hosts_contacted: Vec<String> = Vec::new();
        let contacted = |source: RecheckSource, hosts: &mut Vec<String>| {
            for host in hosts_for(source) {
                if !hosts.iter().any(|seen| seen == host) {
                    hosts.push((*host).to_owned());
                }
            }
        };

        // --- Official advisories -------------------------------------------
        let previous_panel = {
            let connection = self.connection()?;
            load_advisory_panel(&connection, trip_id)?
        };
        let advisory_line = match previous_panel {
            None => RecheckLine {
                source: RecheckSource::Advisories,
                // A first fetch belongs to the panel that owns it: this sweep
                // has no country slug of its own and must not choose one.
                outcome: RecheckOutcome::NeverFetched,
                previously_retrieved_at: None,
            },
            Some(previous)
                if !is_stale(
                    &previous.retrieved_at,
                    &checked_at,
                    ADVISORY_STALE_AFTER_MINUTES,
                ) =>
            {
                RecheckLine {
                    source: RecheckSource::Advisories,
                    outcome: RecheckOutcome::Skipped,
                    previously_retrieved_at: Some(previous.retrieved_at.clone()),
                }
            }
            Some(previous) => {
                contacted(RecheckSource::Advisories, &mut hosts_contacted);
                let retrieved_at = previous.retrieved_at.clone();
                // The stored panel remembers which country it is about, so the
                // sweep re-asks exactly what was asked before.
                let outcome = match self.fetch_advisories(trip_id, &previous.country_slug) {
                    Ok(fresh) => changed_or_unchanged(diff_advisory_panel(&previous, &fresh)),
                    Err(error) => RecheckOutcome::Failed {
                        reason: error.message,
                    },
                };
                RecheckLine {
                    source: RecheckSource::Advisories,
                    outcome,
                    previously_retrieved_at: Some(retrieved_at),
                }
            }
        };
        lines.push(advisory_line);

        // --- Forecast, and the alerts riding inside it ----------------------
        let previous_weather = {
            let connection = self.connection()?;
            fetch_weather_snapshot(&connection, trip_id)?
        };
        let weather_line = match previous_weather {
            None => RecheckLine {
                source: RecheckSource::Weather,
                outcome: RecheckOutcome::NeverFetched,
                previously_retrieved_at: None,
            },
            Some(previous)
                if !is_stale(
                    &previous.retrieved_at,
                    &checked_at,
                    WEATHER_STALE_AFTER_MINUTES,
                ) =>
            {
                RecheckLine {
                    source: RecheckSource::Weather,
                    outcome: RecheckOutcome::Skipped,
                    previously_retrieved_at: Some(previous.retrieved_at.clone()),
                }
            }
            Some(previous) => {
                contacted(RecheckSource::Weather, &mut hosts_contacted);
                let retrieved_at = previous.retrieved_at.clone();
                let outcome = match self.fetch_weather(trip_id) {
                    Ok(fresh) => changed_or_unchanged(diff_weather(&previous, &fresh)),
                    Err(error) => RecheckOutcome::Failed {
                        reason: error.message,
                    },
                };
                RecheckLine {
                    source: RecheckSource::Weather,
                    outcome,
                    previously_retrieved_at: Some(retrieved_at),
                }
            }
        };
        lines.push(weather_line);

        Ok(RecheckReport {
            trip_id: trip_id.to_owned(),
            checked_at,
            lines,
            hosts_contacted,
        })
    }
}

fn changed_or_unchanged(changes: Vec<voyalier_core::RecheckChange>) -> RecheckOutcome {
    if changes.is_empty() {
        RecheckOutcome::Unchanged
    } else {
        RecheckOutcome::Changed { changes }
    }
}
