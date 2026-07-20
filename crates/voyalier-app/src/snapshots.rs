//! Cross-source lifecycle for retrieved snapshots.
//!
//! Each source keeps ownership of its typed payload, provenance, fallback
//! rules, and SQL representation. This module owns the one policy they share:
//! which validated trip edits make a stored result describe the wrong journey.

use rusqlite::{Transaction, params};
use voyalier_core::{AppError, Trip, ValidatedTripInput};

use crate::storage_error;

/// What a trip edit changed. Every retrieved snapshot is stale because of one
/// of these, so this is the whole vocabulary staleness is expressed in.
#[derive(Debug, Clone, Copy, Default)]
struct TripEdit {
    destination: bool,
    origin: bool,
    dates: bool,
}

impl TripEdit {
    fn between(current: &Trip, updated: &ValidatedTripInput) -> Self {
        Self {
            destination: current.destination != updated.destination,
            origin: current.origin != updated.origin,
            dates: current.start_date != updated.start_date || current.end_date != updated.end_date,
        }
    }
}

/// What makes a stored snapshot stale.
///
/// A snapshot is stale once the trip stops being about the thing the snapshot
/// describes, and which thing that is differs per source: weather is about a
/// place on given days, advice is about a country, and facts compare endpoints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StaleWhen {
    /// About the destination alone.
    Destination,
    /// About the destination across the travel window.
    DestinationOrDates,
    /// About the journey's two endpoints.
    DestinationOrOrigin,
}

impl StaleWhen {
    fn triggered_by(self, edit: TripEdit) -> bool {
        match self {
            Self::Destination => edit.destination,
            Self::DestinationOrDates => edit.destination || edit.dates,
            Self::DestinationOrOrigin => edit.destination || edit.origin,
        }
    }
}

/// Every table holding a snapshot of somewhere, and what makes it stale.
///
/// A source states its staleness beside every other source. The schema test
/// below makes a missing declaration fail instead of leaving an old place on a
/// trip after an edit.
const SNAPSHOT_TABLES: &[(&str, StaleWhen)] = &[
    ("weather_snapshots", StaleWhen::DestinationOrDates),
    // Holidays are scoped to the destination country and travel window.
    ("public_holidays_snapshots", StaleWhen::DestinationOrDates),
    // Advice is about a destination; every stored government card goes stale.
    ("advisory_snapshots", StaleWhen::Destination),
    ("advisory_panels", StaleWhen::Destination),
    ("place_summaries", StaleWhen::Destination),
    // Facts describe the destination and compare its clock with the origin.
    (
        "destination_facts_snapshots",
        StaleWhen::DestinationOrOrigin,
    ),
];

/// Invalidate every retrieved snapshot affected by a validated trip edit.
///
/// The caller supplies its active trip-update transaction, so the new trip and
/// removal of facts about the old one commit atomically. Table names come only
/// from the compile-time registry above, never from user input.
pub(crate) fn invalidate_after_trip_edit(
    transaction: &Transaction<'_>,
    trip_id: &str,
    current: &Trip,
    updated: &ValidatedTripInput,
) -> Result<(), AppError> {
    let edit = TripEdit::between(current, updated);
    for (table, stale_when) in SNAPSHOT_TABLES {
        if stale_when.triggered_by(edit) {
            transaction
                .execute(
                    &format!("DELETE FROM {table} WHERE trip_id = ?1"),
                    params![trip_id],
                )
                .map_err(storage_error)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use rusqlite::Connection;

    use super::SNAPSHOT_TABLES;
    use crate::init_connection;

    /// Every table that stores a snapshot of somewhere declares what makes it
    /// stale, and nothing declares staleness for a table that is not one.
    #[test]
    fn every_snapshot_table_declares_when_it_goes_stale() {
        let connection = Connection::open_in_memory().expect("memory db");
        init_connection(&connection).expect("schema");

        let tables: Vec<String> = {
            let mut statement = connection
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
                .expect("tables");
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .expect("names")
                .collect::<rusqlite::Result<Vec<String>>>()
                .expect("collect")
        };

        let declared: BTreeSet<&str> = SNAPSHOT_TABLES.iter().map(|(name, _)| *name).collect();
        // Trip-keyed data that deliberately outlives a destination edit. The
        // traveller owns it, or it can be re-used/reviewed for the revised trip.
        let survives_an_edit: BTreeSet<&str> = [
            "trips",
            "trip_notes",
            "source_documents",
            "candidate_facts",
            "confirmed_facts",
            "parser_runs",
            "assist_activity",
            "downloaded_packs",
            // Traveler-owned planning remains useful after a destination edit;
            // the person decides what to revise or remove.
            "trip_interest_profiles",
            "saved_places",
            "packing_items",
            "trip_items",
        ]
        .into_iter()
        .collect();

        for table in &tables {
            let has_trip_id = {
                let mut statement = connection
                    .prepare(&format!("PRAGMA table_info({table})"))
                    .expect("table_info");
                statement
                    .query_map([], |row| row.get::<_, String>(1))
                    .expect("columns")
                    .collect::<rusqlite::Result<Vec<String>>>()
                    .expect("collect")
                    .iter()
                    .any(|column| column == "trip_id")
            };
            if !has_trip_id || survives_an_edit.contains(table.as_str()) {
                continue;
            }
            assert!(
                declared.contains(table.as_str()),
                "{table} stores something about a trip's destination but does not \
                 say what makes it stale: add it to SNAPSHOT_TABLES, or to this \
                 test's survives_an_edit list with the reason it outlives an edit"
            );
        }

        for (table, _) in SNAPSHOT_TABLES {
            assert!(
                tables.iter().any(|known| known == table),
                "SNAPSHOT_TABLES names {table}, which is not in the schema"
            );
        }
    }
}
