//! Storage for the records whose sensitive columns are sealed at rest.
//!
//! [`SEALED_COLUMNS`] is the one declaration of which columns the vault seals,
//! and it drives `sealed_columns_round_trip_through_the_vault`, which holds
//! every entry in it to being ciphertext on disk and plaintext through the
//! reads. Forgetting used to return `v1:<base64>` straight to the UI with
//! nothing objecting; now it fails a test.
//!
//! For trips, candidates, and confirmed facts, this module also owns the SQL and
//! the row mapping, so the sealing happens where the columns are read rather
//! than being remembered at each `SELECT`. **`source_documents.raw_content` and
//! `trip_notes.body` are not there yet**: their SQL still lives in `lib.rs` and
//! calls [`Records::seal`] / [`Records::open`] by hand. The test covers them; the
//! structure does not.
//!
//! Two smaller consequences fall out of that:
//!
//! - Callers stop threading `&Vault` alongside `&Connection` to every read and
//!   write; [`Records`] binds the pair once.
//! - Vault work happens outside rusqlite's row closures, so an `AppError` no
//!   longer has to be smuggled through `rusqlite::Error` and downcast back out
//!   to keep a locked vault reading as `vault/locked`.
//!
//! Columns are addressed by name rather than position: the `SELECT` and the
//! mapper are built from the same list, so they cannot disagree about order.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde::de::DeserializeOwned;

use voyalier_core::{
    AppError, CandidateFact, CandidateStatus, ConfirmedFact, ErrorCode, Trip, TripSummary,
};

use crate::{DocumentText, Vault, storage_error};

/// The sensitive text columns the vault seals: the parsed confirmed-fact payload
/// AND the original imported document text it was extracted from — both carry
/// confirmation codes and traveler names, so both must be encrypted at rest.
///
/// This is the single declaration. It drives the legacy-encryption migration,
/// and `sealed_columns_round_trip_through_the_vault` holds every entry to it:
/// add a row here and the test fails until the read and write paths seal it.
pub(crate) const SEALED_COLUMNS: &[(&str, &str)] = &[
    ("confirmed_facts", "payload"),
    ("source_documents", "raw_content"),
    // Pending candidates hold the same parsed secrets, and their field spans
    // carry verbatim excerpts of the source text (often the code itself).
    ("candidate_facts", "payload"),
    ("candidate_facts", "field_spans"),
    // Notes are whatever the traveler chose to write down — treat them as
    // sensitive as the confirmations they sit beside.
    ("trip_notes", "body"),
];

const TRIP_COLUMNS: &str =
    "id, title, origin, destination, start_date, end_date, status, created_at, updated_at";
const CANDIDATE_COLUMNS: &str = "id, trip_id, document_id, parser_run_id, fact_type, payload, \
     method, field_spans, warnings, status, created_at, resolved_at";
const CONFIRMED_COLUMNS: &str = "id, trip_id, fact_type, payload, method, candidate_id, \
     corrected_fields, confirmed_at, source_removed";

/// Reads and writes for the sealed records, over a bound connection and vault.
///
/// Accepts anything that derefs to a `Connection`, so a caller inside a
/// transaction passes the transaction and gets the same interface.
pub(crate) struct Records<'a> {
    connection: &'a Connection,
    vault: &'a Vault,
}

impl<'a> Records<'a> {
    pub(crate) fn new(connection: &'a Connection, vault: &'a Vault) -> Self {
        Self { connection, vault }
    }

    // ---- trips -----------------------------------------------------------

    /// Read a trip, or [`ErrorCode::TripNotFound`].
    ///
    /// Also the existence guard: most methods open with this and discard the
    /// result purely to reject an unknown trip id.
    pub(crate) fn trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.connection
            .query_row(
                &format!("SELECT {TRIP_COLUMNS} FROM trips WHERE id = ?1"),
                params![trip_id],
                raw_trip,
            )
            .optional()
            .map_err(storage_error)?
            .map(open_trip)
            .transpose()?
            .ok_or_else(|| AppError::new(ErrorCode::TripNotFound, "trip not found"))
    }

    /// Read every trip with its fact and pending-candidate counts, newest first.
    pub(crate) fn trip_summaries(&self) -> Result<Vec<TripSummary>, AppError> {
        let sql = format!(
            "SELECT {},
                    (SELECT COUNT(*) FROM confirmed_facts f WHERE f.trip_id = t.id)
                        AS confirmed_fact_count,
                    (SELECT COUNT(*) FROM candidate_facts c
                     WHERE c.trip_id = t.id AND c.status = 'pending')
                        AS pending_candidate_count
             FROM trips t
             ORDER BY created_at DESC, id DESC",
            TRIP_COLUMNS
                .split(", ")
                .map(|column| format!("t.{column}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let mut statement = self.connection.prepare(&sql).map_err(storage_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    raw_trip(row)?,
                    row.get::<_, i64>("confirmed_fact_count")?,
                    row.get::<_, i64>("pending_candidate_count")?,
                ))
            })
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?;

        rows.into_iter()
            .map(|(raw, confirmed, pending)| {
                Ok(TripSummary {
                    trip: open_trip(raw)?,
                    confirmed_fact_count: confirmed as u32,
                    pending_candidate_count: pending as u32,
                })
            })
            .collect()
    }

    // ---- candidates ------------------------------------------------------

    /// Read a candidate, opening its sealed payload and field spans.
    pub(crate) fn candidate(&self, candidate_id: &str) -> Result<CandidateFact, AppError> {
        let raw = self
            .connection
            .query_row(
                &format!("SELECT {CANDIDATE_COLUMNS} FROM candidate_facts WHERE id = ?1"),
                params![candidate_id],
                raw_candidate,
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::CandidateNotFound, "candidate not found"))?;
        self.open_candidate(raw)
    }

    /// Read a trip's candidates, oldest first, optionally filtered by status.
    pub(crate) fn candidates(
        &self,
        trip_id: &str,
        status: Option<CandidateStatus>,
    ) -> Result<Vec<CandidateFact>, AppError> {
        let filter = if status.is_some() {
            "WHERE trip_id = ?1 AND status = ?2"
        } else {
            "WHERE trip_id = ?1"
        };
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT {CANDIDATE_COLUMNS} FROM candidate_facts
                 {filter}
                 ORDER BY created_at ASC, id ASC"
            ))
            .map_err(storage_error)?;
        let raws = match status {
            Some(status) => statement
                .query_map(params![trip_id, to_sql_enum(status)?], raw_candidate)
                .map_err(storage_error)?
                .collect::<rusqlite::Result<Vec<_>>>(),
            None => statement
                .query_map(params![trip_id], raw_candidate)
                .map_err(storage_error)?
                .collect::<rusqlite::Result<Vec<_>>>(),
        }
        .map_err(storage_error)?;
        raws.into_iter()
            .map(|raw| self.open_candidate(raw))
            .collect()
    }

    pub(crate) fn insert_candidate(&self, candidate: &CandidateFact) -> Result<(), AppError> {
        self.connection
            .execute(
                &format!(
                    "INSERT INTO candidate_facts ({CANDIDATE_COLUMNS})
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
                ),
                params![
                    candidate.id,
                    candidate.trip_id,
                    candidate.document_id,
                    candidate.parser_run_id,
                    to_sql_enum(candidate.fact_type)?,
                    // payload and field_spans are sealed: see SEALED_COLUMNS.
                    self.vault.seal_field(&to_sql_json(&candidate.payload)?)?,
                    to_sql_enum(candidate.method)?,
                    self.vault
                        .seal_field(&to_sql_json(&candidate.field_spans)?)?,
                    to_sql_json(&candidate.warnings)?,
                    to_sql_enum(candidate.status)?,
                    candidate.created_at,
                    candidate.resolved_at
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub(crate) fn update_candidate_resolution(
        &self,
        candidate: &CandidateFact,
    ) -> Result<(), AppError> {
        self.connection
            .execute(
                "UPDATE candidate_facts SET status = ?1, resolved_at = ?2 WHERE id = ?3",
                params![
                    to_sql_enum(candidate.status)?,
                    candidate.resolved_at,
                    candidate.id
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    // ---- confirmed facts -------------------------------------------------

    /// Read a trip's confirmed facts, oldest first, opening each sealed payload.
    pub(crate) fn confirmed_facts(&self, trip_id: &str) -> Result<Vec<ConfirmedFact>, AppError> {
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT {CONFIRMED_COLUMNS} FROM confirmed_facts
                 WHERE trip_id = ?1
                 ORDER BY confirmed_at ASC, id ASC"
            ))
            .map_err(storage_error)?;
        let raws = statement
            .query_map(params![trip_id], raw_confirmed)
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?;
        raws.into_iter()
            .map(|raw| self.open_confirmed(raw))
            .collect()
    }

    pub(crate) fn insert_confirmed_fact(&self, confirmed: &ConfirmedFact) -> Result<(), AppError> {
        self.connection
            .execute(
                &format!(
                    "INSERT INTO confirmed_facts ({CONFIRMED_COLUMNS})
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
                ),
                params![
                    confirmed.id,
                    confirmed.trip_id,
                    to_sql_enum(confirmed.fact_type)?,
                    // The payload carries confirmation codes and traveler names.
                    self.vault.seal_field(&to_sql_json(&confirmed.payload)?)?,
                    to_sql_enum(confirmed.method)?,
                    confirmed.candidate_id,
                    to_sql_json(&confirmed.corrected_fields)?,
                    confirmed.confirmed_at,
                    i64::from(confirmed.source_removed)
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    /// Read one string field from a trip's confirmed lodging facts, newest first.
    ///
    /// Scoped to a single trip so suggestions never cross trip boundaries. The
    /// sealed payload is opened here, so a locked vault surfaces as
    /// [`ErrorCode::VaultLocked`] for the caller to treat as "no confirmed
    /// source".
    pub(crate) fn confirmed_lodging_values(
        &self,
        field: &str,
        trip_id: &str,
    ) -> Result<Vec<String>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT payload FROM confirmed_facts
                 WHERE fact_type = 'lodging_stay' AND trip_id = ?1
                 ORDER BY confirmed_at DESC, id ASC",
            )
            .map_err(storage_error)?;
        let sealed = statement
            .query_map(params![trip_id], |row| row.get::<_, String>("payload"))
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?;

        let mut values = Vec::new();
        for sealed_payload in sealed {
            let payload: serde_json::Value =
                from_sql_json(&self.vault.open_field(&sealed_payload)?)?;
            if let Some(text) = payload.get(field).and_then(serde_json::Value::as_str) {
                let text = text.trim();
                if !text.is_empty() {
                    values.push(text.to_owned());
                }
            }
        }
        Ok(values)
    }

    // ---- documents -------------------------------------------------------

    /// Read a trip's imported documents as `(id, label, decrypted_text)`, oldest
    /// first. The raw content is sealed, so a locked vault surfaces as
    /// [`ErrorCode::VaultLocked`] — a draft needs the text, so that is a real
    /// error rather than an empty result.
    pub(crate) fn trip_document_texts(&self, trip_id: &str) -> Result<Vec<DocumentText>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, label, raw_content FROM source_documents
                 WHERE trip_id = ?1
                 ORDER BY imported_at ASC, id ASC",
            )
            .map_err(storage_error)?;
        let raws = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>("id")?,
                    row.get::<_, String>("label")?,
                    row.get::<_, String>("raw_content")?,
                ))
            })
            .map_err(storage_error)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage_error)?;

        raws.into_iter()
            .map(|(id, label, sealed)| Ok((id, label, self.vault.open_field(&sealed)?)))
            .collect()
    }

    // ---- vault-bound helpers ---------------------------------------------

    /// Seal a value for one of [`SEALED_COLUMNS`].
    ///
    /// The escape hatch for the two sealed columns whose SQL is still in
    /// `lib.rs` (`source_documents.raw_content`, `trip_notes.body`) — a caller
    /// using this is remembering to seal, which is the thing this module exists
    /// to stop. Move that SQL here and this goes away.
    pub(crate) fn seal(&self, plaintext: &str) -> Result<String, AppError> {
        self.vault.seal_field(plaintext)
    }

    /// Open a value from one of [`SEALED_COLUMNS`]. See [`Records::seal`].
    pub(crate) fn open(&self, stored: &str) -> Result<String, AppError> {
        self.vault.open_field(stored)
    }

    fn open_candidate(&self, raw: RawCandidate) -> Result<CandidateFact, AppError> {
        Ok(CandidateFact {
            id: raw.id,
            trip_id: raw.trip_id,
            document_id: raw.document_id,
            parser_run_id: raw.parser_run_id,
            fact_type: from_sql_enum(&raw.fact_type)?,
            payload: from_sql_json(&self.vault.open_field(&raw.payload)?)?,
            method: from_sql_enum(&raw.method)?,
            field_spans: from_sql_json(&self.vault.open_field(&raw.field_spans)?)?,
            warnings: from_sql_json(&raw.warnings)?,
            status: from_sql_enum(&raw.status)?,
            created_at: raw.created_at,
            resolved_at: raw.resolved_at,
        })
    }

    fn open_confirmed(&self, raw: RawConfirmed) -> Result<ConfirmedFact, AppError> {
        Ok(ConfirmedFact {
            id: raw.id,
            trip_id: raw.trip_id,
            fact_type: from_sql_enum(&raw.fact_type)?,
            payload: from_sql_json(&self.vault.open_field(&raw.payload)?)?,
            method: from_sql_enum(&raw.method)?,
            candidate_id: raw.candidate_id,
            corrected_fields: from_sql_json(&raw.corrected_fields)?,
            confirmed_at: raw.confirmed_at,
            source_removed: raw.source_removed != 0,
        })
    }
}

/// Reject a candidate that is no longer pending.
pub(crate) fn ensure_candidate_pending(candidate: &CandidateFact) -> Result<(), AppError> {
    if candidate.status != CandidateStatus::Pending {
        return Err(AppError::new(
            ErrorCode::CandidateAlreadyResolved,
            "candidate has already been resolved",
        ));
    }
    Ok(())
}

/// A candidate row as stored: sealed columns still sealed, enums still strings.
///
/// The split exists so vault and JSON work happen after rusqlite is done with
/// the row, where an `AppError` can just be returned.
struct RawCandidate {
    id: String,
    trip_id: String,
    document_id: String,
    parser_run_id: String,
    fact_type: String,
    payload: String,
    method: String,
    field_spans: String,
    warnings: String,
    status: String,
    created_at: String,
    resolved_at: Option<String>,
}

struct RawConfirmed {
    id: String,
    trip_id: String,
    fact_type: String,
    payload: String,
    method: String,
    candidate_id: Option<String>,
    corrected_fields: String,
    confirmed_at: String,
    source_removed: i64,
}

fn raw_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawCandidate> {
    Ok(RawCandidate {
        id: row.get("id")?,
        trip_id: row.get("trip_id")?,
        document_id: row.get("document_id")?,
        parser_run_id: row.get("parser_run_id")?,
        fact_type: row.get("fact_type")?,
        payload: row.get("payload")?,
        method: row.get("method")?,
        field_spans: row.get("field_spans")?,
        warnings: row.get("warnings")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        resolved_at: row.get("resolved_at")?,
    })
}

fn raw_confirmed(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawConfirmed> {
    Ok(RawConfirmed {
        id: row.get("id")?,
        trip_id: row.get("trip_id")?,
        fact_type: row.get("fact_type")?,
        payload: row.get("payload")?,
        method: row.get("method")?,
        candidate_id: row.get("candidate_id")?,
        corrected_fields: row.get("corrected_fields")?,
        confirmed_at: row.get("confirmed_at")?,
        source_removed: row.get("source_removed")?,
    })
}

struct RawTrip {
    id: String,
    title: String,
    origin: String,
    destination: String,
    start_date: String,
    end_date: String,
    status: String,
    created_at: String,
    updated_at: String,
}

fn raw_trip(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawTrip> {
    Ok(RawTrip {
        id: row.get("id")?,
        title: row.get("title")?,
        origin: row.get("origin")?,
        destination: row.get("destination")?,
        start_date: row.get("start_date")?,
        end_date: row.get("end_date")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// A trip row carries no sealed columns; only its status needs decoding.
fn open_trip(raw: RawTrip) -> Result<Trip, AppError> {
    Ok(Trip {
        id: raw.id,
        title: raw.title,
        origin: raw.origin,
        destination: raw.destination,
        start_date: raw.start_date,
        end_date: raw.end_date,
        status: from_sql_enum(&raw.status)?,
        created_at: raw.created_at,
        updated_at: raw.updated_at,
    })
}

fn to_sql_enum<T: Serialize>(value: T) -> Result<String, AppError> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| AppError::new(ErrorCode::InternalUnexpected, "unencodable enum value"))
}

fn from_sql_enum<T: DeserializeOwned>(value: &str) -> Result<T, AppError> {
    serde_json::from_value(serde_json::Value::String(value.to_owned()))
        .map_err(|_| AppError::new(ErrorCode::StorageFailure, "unreadable stored value"))
}

fn to_sql_json<T: Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_string(value)
        .map_err(|_| AppError::new(ErrorCode::InternalUnexpected, "unencodable stored value"))
}

fn from_sql_json<T: DeserializeOwned>(value: &str) -> Result<T, AppError> {
    serde_json::from_str(value)
        .map_err(|_| AppError::new(ErrorCode::StorageFailure, "unreadable stored value"))
}
