//! Storage for the records whose sensitive columns are sealed at rest.
//!
//! [`SEALED_COLUMNS`] is the one declaration of which columns the vault seals,
//! and it drives `sealed_columns_round_trip_through_the_vault`, which holds
//! every entry in it to being ciphertext on disk and plaintext through the
//! reads. Forgetting used to return `v1:<base64>` straight to the UI with
//! nothing objecting; now it fails a test.
//!
//! This module also owns the SQL and the row mapping for every one of them, so
//! the sealing happens where the columns are read and written rather than being
//! remembered at each `SELECT`. There is no `seal`/`open` escape hatch: a caller
//! that could reach one would be remembering to seal, which is the thing this
//! module exists to stop.
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
    AppError, CandidateFact, CandidateStatus, ConfirmedFact, DocumentContent, ErrorCode,
    InterestProfile, PackingItem, PersonaWeights, SavedPlace, SourceDocument, Trip, TripItem,
    TripItemKind, TripNotes, TripSummary,
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
    ("saved_places", "notes"),
    ("packing_items", "label"),
    ("trip_items", "title"),
    ("trip_items", "location"),
    ("trip_items", "notes"),
];

const TRIP_COLUMNS: &str =
    "id, title, origin, destination, start_date, end_date, status, created_at, updated_at";
const CANDIDATE_COLUMNS: &str = "id, trip_id, document_id, parser_run_id, fact_type, payload, \
     method, field_spans, warnings, status, created_at, resolved_at";
const CONFIRMED_COLUMNS: &str = "id, trip_id, fact_type, payload, method, candidate_id, \
     corrected_fields, confirmed_at, source_removed";
/// A document's metadata. `raw_content` is deliberately not here: it is sealed,
/// and only `document_content` returns it.
const DOCUMENT_COLUMNS: &str = "id, trip_id, kind, label, content_hash, char_count, imported_at";

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

    /// Insert an imported document, sealing its body.
    pub(crate) fn insert_document(
        &self,
        document: &SourceDocument,
        content: &str,
    ) -> Result<(), AppError> {
        self.connection
            .execute(
                &format!(
                    "INSERT INTO source_documents ({DOCUMENT_COLUMNS}, raw_content)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
                ),
                params![
                    document.id,
                    document.trip_id,
                    to_sql_enum(document.kind)?,
                    document.label,
                    document.content_hash,
                    document.char_count,
                    document.imported_at,
                    // raw_content is sealed: see SEALED_COLUMNS.
                    self.vault.seal_field(content)?
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    /// Read one document with its body opened, or [`ErrorCode::DocumentNotFound`].
    ///
    /// The only path that returns an imported body. `documents` deliberately has
    /// no counterpart: a listing has no business carrying one.
    pub(crate) fn document_content(&self, document_id: &str) -> Result<DocumentContent, AppError> {
        let (document, sealed) = self
            .connection
            .query_row(
                &format!(
                    "SELECT {DOCUMENT_COLUMNS}, raw_content FROM source_documents WHERE id = ?1"
                ),
                params![document_id],
                |row| Ok((raw_document(row)?, row.get::<_, String>("raw_content")?)),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::DocumentNotFound,
                    "that document no longer exists",
                )
            })?;
        Ok(DocumentContent {
            document: open_document(document)?,
            content: self.vault.open_field(&sealed)?,
        })
    }

    // ---- notes -----------------------------------------------------------

    /// A trip's notes, body opened. Absent notes are an empty body, not an
    /// error — "nothing written yet" is the normal first state.
    pub(crate) fn trip_notes(&self, trip_id: &str) -> Result<TripNotes, AppError> {
        let stored: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT body, updated_at FROM trip_notes WHERE trip_id = ?1",
                params![trip_id],
                |row| Ok((row.get("body")?, row.get("updated_at")?)),
            )
            .optional()
            .map_err(storage_error)?;
        match stored {
            Some((sealed, updated_at)) => Ok(TripNotes {
                trip_id: trip_id.to_owned(),
                body: self.vault.open_field(&sealed)?,
                updated_at: Some(updated_at),
            }),
            None => Ok(TripNotes {
                trip_id: trip_id.to_owned(),
                body: String::new(),
                updated_at: None,
            }),
        }
    }

    /// Store a trip's notes, sealing the body. `updated_at` is the caller's
    /// clock — this module does not have one.
    pub(crate) fn upsert_trip_notes(
        &self,
        trip_id: &str,
        body: &str,
        id: &str,
        updated_at: &str,
    ) -> Result<(), AppError> {
        self.connection
            .execute(
                "INSERT INTO trip_notes (id, trip_id, body, updated_at)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(trip_id) DO UPDATE SET body = ?3, updated_at = ?4",
                // body is sealed: see SEALED_COLUMNS.
                params![id, trip_id, self.vault.seal_field(body)?, updated_at],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    /// Remove a trip's notes. Clearing drops the row rather than storing an
    /// empty string, so "no notes" is one state and not two.
    pub(crate) fn delete_trip_notes(&self, trip_id: &str) -> Result<(), AppError> {
        self.connection
            .execute(
                "DELETE FROM trip_notes WHERE trip_id = ?1",
                params![trip_id],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    // ---- traveler-owned planning ---------------------------------------

    pub(crate) fn interest_profile(&self, trip_id: &str) -> Result<InterestProfile, AppError> {
        let row = self
            .connection
            .query_row(
                "SELECT food, culture, nature, nightlife, shopping, updated_at
                 FROM trip_interest_profiles WHERE trip_id = ?1",
                params![trip_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .optional()
            .map_err(storage_error)?;
        Ok(match row {
            Some((food, culture, nature, nightlife, shopping, updated_at)) => InterestProfile {
                trip_id: trip_id.to_owned(),
                weights: PersonaWeights {
                    food,
                    culture,
                    nature,
                    nightlife,
                    shopping,
                },
                updated_at: Some(updated_at),
            },
            None => InterestProfile::balanced(trip_id),
        })
    }

    pub(crate) fn upsert_interest_profile(
        &self,
        profile: &InterestProfile,
    ) -> Result<(), AppError> {
        self.connection
            .execute(
                "INSERT INTO trip_interest_profiles
                    (trip_id, food, culture, nature, nightlife, shopping, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(trip_id) DO UPDATE SET
                    food=?2, culture=?3, nature=?4, nightlife=?5, shopping=?6, updated_at=?7",
                params![
                    profile.trip_id,
                    profile.weights.food,
                    profile.weights.culture,
                    profile.weights.nature,
                    profile.weights.nightlife,
                    profile.weights.shopping,
                    profile.updated_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub(crate) fn saved_places(&self, trip_id: &str) -> Result<Vec<SavedPlace>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT s.id, s.trip_id, s.pack_id,
                        EXISTS(SELECT 1 FROM downloaded_packs d
                               WHERE d.trip_id=s.trip_id AND d.pack_id=s.pack_id),
                        s.name, s.category, s.dimension, s.lat, s.lon, s.source, s.license,
                        s.reasons_json, s.wildcard, s.notes, s.created_at, s.updated_at
                 FROM saved_places s WHERE s.trip_id=?1 ORDER BY s.created_at DESC, s.id DESC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, f64>(7)?,
                    row.get::<_, f64>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, String>(14)?,
                    row.get::<_, String>(15)?,
                ))
            })
            .map_err(storage_error)?;
        rows.map(|row| {
            let (
                id,
                trip_id,
                pack_id,
                available,
                name,
                category,
                dimension,
                lat,
                lon,
                source,
                license,
                reasons,
                wildcard,
                notes,
                created_at,
                updated_at,
            ) = row.map_err(storage_error)?;
            Ok(SavedPlace {
                id,
                trip_id,
                pack_id,
                source_pack_available: available != 0,
                name,
                category,
                dimension,
                lat,
                lon,
                source,
                license,
                reasons: from_sql_json(&reasons)?,
                wildcard: wildcard != 0,
                notes: self.vault.open_field(&notes)?,
                created_at,
                updated_at,
            })
        })
        .collect()
    }

    pub(crate) fn insert_saved_place(&self, place: &SavedPlace) -> Result<(), AppError> {
        self.connection
            .execute(
                "INSERT INTO saved_places
                    (id, trip_id, pack_id, name, category, dimension, lat, lon, source, license,
                     reasons_json, wildcard, notes, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
                params![
                    place.id,
                    place.trip_id,
                    place.pack_id,
                    place.name,
                    place.category,
                    place.dimension,
                    place.lat,
                    place.lon,
                    place.source,
                    place.license,
                    to_sql_json(&place.reasons)?,
                    i64::from(place.wildcard),
                    self.vault.seal_field(&place.notes)?,
                    place.created_at,
                    place.updated_at,
                ],
            )
            .map_err(storage_error)?;
        Ok(())
    }

    pub(crate) fn update_saved_place_notes(
        &self,
        saved_place_id: &str,
        notes: &str,
        updated_at: &str,
    ) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute(
                "UPDATE saved_places SET notes=?2, updated_at=?3 WHERE id=?1",
                params![saved_place_id, self.vault.seal_field(notes)?, updated_at],
            )
            .map_err(storage_error)?;
        require_changed(changed, "saved place")
    }

    pub(crate) fn delete_saved_place(&self, saved_place_id: &str) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute(
                "DELETE FROM saved_places WHERE id=?1",
                params![saved_place_id],
            )
            .map_err(storage_error)?;
        require_changed(changed, "saved place")
    }

    pub(crate) fn packing_items(&self, trip_id: &str) -> Result<Vec<PackingItem>, AppError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT id, trip_id, label, checked, suggestion_code, created_at, updated_at
             FROM packing_items WHERE trip_id=?1 ORDER BY checked, created_at, id",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })
            .map_err(storage_error)?;
        rows.map(|row| {
            let (id, trip_id, label, checked, suggestion_code, created_at, updated_at) =
                row.map_err(storage_error)?;
            Ok(PackingItem {
                id,
                trip_id,
                label: self.vault.open_field(&label)?,
                checked: checked != 0,
                suggestion_code,
                created_at,
                updated_at,
            })
        })
        .collect()
    }

    pub(crate) fn insert_packing_item(&self, item: &PackingItem) -> Result<(), AppError> {
        self.connection.execute(
            "INSERT INTO packing_items (id, trip_id, label, checked, suggestion_code, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![item.id, item.trip_id, self.vault.seal_field(&item.label)?, i64::from(item.checked),
                item.suggestion_code, item.created_at, item.updated_at],
        ).map_err(storage_error)?;
        Ok(())
    }

    pub(crate) fn update_packing_item(&self, item: &PackingItem) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute(
                "UPDATE packing_items SET label=?2, checked=?3, updated_at=?4 WHERE id=?1",
                params![
                    item.id,
                    self.vault.seal_field(&item.label)?,
                    i64::from(item.checked),
                    item.updated_at
                ],
            )
            .map_err(storage_error)?;
        require_changed(changed, "packing item")
    }

    pub(crate) fn delete_packing_item(&self, id: &str) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute("DELETE FROM packing_items WHERE id=?1", params![id])
            .map_err(storage_error)?;
        require_changed(changed, "packing item")
    }

    pub(crate) fn trip_items(&self, trip_id: &str) -> Result<Vec<TripItem>, AppError> {
        let mut statement = self.connection.prepare(
            "SELECT id, trip_id, kind, title, location, start_at, end_at, notes, saved_place_id,
                    created_at, updated_at FROM trip_items WHERE trip_id=?1
             ORDER BY COALESCE(start_at, '9999'), created_at, id"
        ).map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            })
            .map_err(storage_error)?;
        rows.map(|row| {
            let (
                id,
                trip_id,
                kind,
                title,
                location,
                start_at,
                end_at,
                notes,
                saved_place_id,
                created_at,
                updated_at,
            ) = row.map_err(storage_error)?;
            Ok(TripItem {
                id,
                trip_id,
                kind: from_sql_enum::<TripItemKind>(&kind)?,
                title: self.vault.open_field(&title)?,
                location: location
                    .map(|value| self.vault.open_field(&value))
                    .transpose()?,
                start_at,
                end_at,
                notes: notes
                    .map(|value| self.vault.open_field(&value))
                    .transpose()?,
                saved_place_id,
                created_at,
                updated_at,
            })
        })
        .collect()
    }

    pub(crate) fn insert_trip_item(&self, item: &TripItem) -> Result<(), AppError> {
        self.connection.execute(
            "INSERT INTO trip_items (id, trip_id, kind, title, location, start_at, end_at, notes,
                                     saved_place_id, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![item.id, item.trip_id, to_sql_enum(item.kind)?, self.vault.seal_field(&item.title)?,
                item.location.as_deref().map(|value| self.vault.seal_field(value)).transpose()?,
                item.start_at, item.end_at,
                item.notes.as_deref().map(|value| self.vault.seal_field(value)).transpose()?,
                item.saved_place_id, item.created_at, item.updated_at],
        ).map_err(storage_error)?;
        Ok(())
    }

    pub(crate) fn update_trip_item(&self, item: &TripItem) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute(
                "UPDATE trip_items SET kind=?2, title=?3, location=?4, start_at=?5, end_at=?6,
                                   notes=?7, saved_place_id=?8, updated_at=?9 WHERE id=?1",
                params![
                    item.id,
                    to_sql_enum(item.kind)?,
                    self.vault.seal_field(&item.title)?,
                    item.location
                        .as_deref()
                        .map(|value| self.vault.seal_field(value))
                        .transpose()?,
                    item.start_at,
                    item.end_at,
                    item.notes
                        .as_deref()
                        .map(|value| self.vault.seal_field(value))
                        .transpose()?,
                    item.saved_place_id,
                    item.updated_at
                ],
            )
            .map_err(storage_error)?;
        require_changed(changed, "trip item")
    }

    pub(crate) fn delete_trip_item(&self, id: &str) -> Result<(), AppError> {
        let changed = self
            .connection
            .execute("DELETE FROM trip_items WHERE id=?1", params![id])
            .map_err(storage_error)?;
        require_changed(changed, "trip item")
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

fn require_changed(changed: usize, record: &str) -> Result<(), AppError> {
    if changed == 0 {
        Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            format!("{record} not found"),
        ))
    } else {
        Ok(())
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

struct RawDocument {
    id: String,
    trip_id: String,
    kind: String,
    label: String,
    content_hash: String,
    char_count: u32,
    imported_at: String,
}

fn raw_document(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawDocument> {
    Ok(RawDocument {
        id: row.get("id")?,
        trip_id: row.get("trip_id")?,
        kind: row.get("kind")?,
        label: row.get("label")?,
        content_hash: row.get("content_hash")?,
        char_count: row.get("char_count")?,
        imported_at: row.get("imported_at")?,
    })
}

/// A document row carries no sealed metadata; only its kind needs decoding.
fn open_document(raw: RawDocument) -> Result<SourceDocument, AppError> {
    Ok(SourceDocument {
        id: raw.id,
        trip_id: raw.trip_id,
        kind: from_sql_enum(&raw.kind)?,
        label: raw.label,
        content_hash: raw.content_hash,
        char_count: raw.char_count,
        imported_at: raw.imported_at,
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
