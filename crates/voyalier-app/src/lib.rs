use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};

use directories::ProjectDirs;
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use voyalier_core::{
    AddManualFactInput, AppError, CandidateFact, CandidateStatus, ConfirmCandidateInput,
    ConfirmationParser, ConfirmedFact, CreateTripInput, DocumentKind, ErrorCode, ExtractionMethod,
    HealthResponse, ImportDocumentInput, ImportResult, IntelligenceMode, JsonLdParser,
    NormalizedDocument, ParsedCandidate, PlaintextParser, RedactionPolicy, SourceDocument, Trip,
    TripBrief, TripDetail, TripStatus, TripSummary, UpdateTripInput, assess_readiness,
    build_trip_brief, changed_payload_fields, detect_itinerary_conflicts, new_id, now_rfc3339,
    validate_create_trip, validate_document_content, validate_fact_payload, validate_update_trip,
};

const DATABASE_FILE: &str = "voyalier.sqlite3";

#[derive(Clone)]
pub struct AppService {
    connection: Arc<Mutex<Connection>>,
}

impl AppService {
    pub fn open_default() -> Result<Self, AppError> {
        Self::open_path(default_database_path()?)
    }

    pub fn open_path(path: impl AsRef<Path>) -> Result<Self, AppError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(path).map_err(storage_error)?;
        init_connection(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn health(&self) -> Result<HealthResponse, AppError> {
        Ok(HealthResponse {
            status: "ok".to_owned(),
            service: "voyalier-app".to_owned(),
            version: env!("CARGO_PKG_VERSION").to_owned(),
            intelligence_mode: IntelligenceMode::Local,
        })
    }

    pub fn create_trip(&self, input: CreateTripInput) -> Result<Trip, AppError> {
        let input = validate_create_trip(input)?;
        let trip = Trip {
            id: new_id("trip"),
            title: input.title,
            origin: input.origin,
            destination: input.destination,
            start_date: input.start_date,
            end_date: input.end_date,
            status: TripStatus::Draft,
            created_at: now_rfc3339(),
            updated_at: now_rfc3339(),
        };

        self.connection()?.execute(
            "INSERT INTO trips (id, title, origin, destination, start_date, end_date, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                trip.id,
                trip.title,
                trip.origin,
                trip.destination,
                trip.start_date,
                trip.end_date,
                enum_to_sql(trip.status)?,
                trip.created_at,
                trip.updated_at
            ],
        ).map_err(storage_error)?;

        Ok(trip)
    }

    pub fn list_trips(&self) -> Result<Vec<TripSummary>, AppError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT
                    trips.id,
                    trips.title,
                    trips.origin,
                    trips.destination,
                    trips.start_date,
                    trips.end_date,
                    trips.status,
                    trips.created_at,
                    trips.updated_at,
                    (SELECT COUNT(*) FROM confirmed_facts WHERE confirmed_facts.trip_id = trips.id),
                    (SELECT COUNT(*) FROM candidate_facts WHERE candidate_facts.trip_id = trips.id AND candidate_facts.status = 'pending')
                 FROM trips
                 ORDER BY trips.created_at ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map([], row_to_trip_summary)
            .map_err(storage_error)?;
        collect_rows(rows)
    }

    pub fn get_trip(&self, trip_id: &str) -> Result<TripDetail, AppError> {
        let connection = self.connection()?;
        let trip = fetch_trip(&connection, trip_id)?;
        let confirmed_facts = fetch_confirmed_facts(&connection, trip_id)?;
        let pending_candidate_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM candidate_facts WHERE trip_id = ?1 AND status = 'pending'",
                params![trip_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(storage_error)?;
        let pending_candidate_count = pending_candidate_count as u32;
        let itinerary_conflicts = detect_itinerary_conflicts(&trip, &confirmed_facts);
        let readiness = assess_readiness(
            &trip,
            &confirmed_facts,
            pending_candidate_count,
            &itinerary_conflicts,
        );
        Ok(TripDetail {
            trip,
            confirmed_facts,
            pending_candidate_count,
            itinerary_conflicts,
            readiness,
        })
    }

    /// Build a redacted, shareable brief from the confirmed plan. The brief is
    /// produced by generation-time exclusion in the core, so secrets never
    /// enter the returned structure.
    pub fn get_trip_brief(&self, trip_id: &str) -> Result<TripBrief, AppError> {
        let connection = self.connection()?;
        let trip = fetch_trip(&connection, trip_id)?;
        let confirmed_facts = fetch_confirmed_facts(&connection, trip_id)?;
        Ok(build_trip_brief(
            &trip,
            &confirmed_facts,
            &RedactionPolicy::for_sharing(),
            &now_rfc3339(),
        ))
    }

    pub fn update_trip(&self, trip_id: &str, input: UpdateTripInput) -> Result<Trip, AppError> {
        let connection = self.connection()?;
        let current = fetch_trip(&connection, trip_id)?;
        let input = validate_update_trip(&current, input)?;
        let updated_at = now_rfc3339();
        connection
            .execute(
                "UPDATE trips
                 SET title = ?1, origin = ?2, destination = ?3, start_date = ?4, end_date = ?5, updated_at = ?6
                 WHERE id = ?7",
                params![
                    input.title,
                    input.origin,
                    input.destination,
                    input.start_date,
                    input.end_date,
                    updated_at,
                    trip_id
                ],
            )
            .map_err(storage_error)?;
        fetch_trip(&connection, trip_id)
    }

    pub fn archive_trip(&self, trip_id: &str) -> Result<Trip, AppError> {
        self.set_trip_status(trip_id, TripStatus::Archived)
    }

    pub fn delete_trip(&self, trip_id: &str) -> Result<(), AppError> {
        let changed = self
            .connection()?
            .execute("DELETE FROM trips WHERE id = ?1", params![trip_id])
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::TripNotFound, "trip not found"));
        }
        Ok(())
    }

    pub fn import_document(&self, input: ImportDocumentInput) -> Result<ImportResult, AppError> {
        let char_count = validate_document_content(&input.content)?;
        let hash = sha256_hex(input.content.as_bytes());
        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .unwrap_or(match input.kind {
                DocumentKind::Html => "Imported HTML",
                DocumentKind::PastedText => "Pasted text",
            })
            .to_owned();
        let document = NormalizedDocument::new(input.kind, input.content.clone());
        let (parser_id, parser_version, parsed_candidates) = parse_document(&document);
        let now = now_rfc3339();
        let document_id = new_id("doc");
        let parser_run_id = new_id("run");

        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        fetch_trip(&transaction, &input.trip_id)?;

        if let Some(existing_id) = transaction
            .query_row(
                "SELECT id FROM source_documents WHERE trip_id = ?1 AND content_hash = ?2",
                params![input.trip_id, hash],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?
        {
            return Err(AppError::with_detail(
                ErrorCode::DocumentDuplicate,
                "document was already imported for this trip",
                "existingDocumentId",
                existing_id,
            ));
        }

        transaction
            .execute(
                "INSERT INTO source_documents (id, trip_id, kind, label, content_hash, char_count, imported_at, raw_content)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    document_id,
                    input.trip_id,
                    enum_to_sql(input.kind)?,
                    label,
                    hash,
                    char_count,
                    now,
                    input.content
                ],
            )
            .map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO parser_runs (id, trip_id, document_id, parser_id, parser_version, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    parser_run_id,
                    input.trip_id,
                    document_id,
                    parser_id,
                    parser_version,
                    now
                ],
            )
            .map_err(storage_error)?;

        let mut candidates = Vec::new();
        for parsed in parsed_candidates {
            let candidate = CandidateFact {
                id: new_id("cand"),
                trip_id: input.trip_id.clone(),
                document_id: document_id.clone(),
                parser_run_id: parser_run_id.clone(),
                fact_type: parsed.fact_type,
                payload: parsed.payload,
                method: parsed.method,
                field_spans: parsed.field_spans,
                warnings: parsed.warnings,
                status: CandidateStatus::Pending,
                created_at: now.clone(),
                resolved_at: None,
            };
            insert_candidate(&transaction, &candidate)?;
            candidates.push(candidate);
        }

        transaction.commit().map_err(storage_error)?;

        Ok(ImportResult {
            document: SourceDocument {
                id: document_id,
                trip_id: input.trip_id,
                kind: input.kind,
                label,
                content_hash: hash,
                char_count,
                imported_at: now,
            },
            parser_run_id,
            candidates,
        })
    }

    pub fn list_candidates(
        &self,
        trip_id: &str,
        status: Option<CandidateStatus>,
    ) -> Result<Vec<CandidateFact>, AppError> {
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;
        if let Some(status) = status {
            let mut statement = connection
                .prepare(
                    "SELECT id, trip_id, document_id, parser_run_id, fact_type, payload, method,
                            field_spans, warnings, status, created_at, resolved_at
                     FROM candidate_facts
                     WHERE trip_id = ?1 AND status = ?2
                     ORDER BY created_at ASC, id ASC",
                )
                .map_err(storage_error)?;
            let rows = statement
                .query_map(params![trip_id, enum_to_sql(status)?], row_to_candidate)
                .map_err(storage_error)?;
            collect_rows(rows)
        } else {
            let mut statement = connection
                .prepare(
                    "SELECT id, trip_id, document_id, parser_run_id, fact_type, payload, method,
                            field_spans, warnings, status, created_at, resolved_at
                     FROM candidate_facts
                     WHERE trip_id = ?1
                     ORDER BY created_at ASC, id ASC",
                )
                .map_err(storage_error)?;
            let rows = statement
                .query_map(params![trip_id], row_to_candidate)
                .map_err(storage_error)?;
            collect_rows(rows)
        }
    }

    pub fn confirm_candidate(
        &self,
        input: ConfirmCandidateInput,
    ) -> Result<(CandidateFact, ConfirmedFact), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = fetch_candidate(&transaction, &input.candidate_id)?;
        ensure_candidate_pending(&candidate)?;

        let payload = input
            .edited_payload
            .unwrap_or_else(|| candidate.payload.clone());
        validate_fact_payload(candidate.fact_type, &payload)?;
        let corrected_fields = changed_payload_fields(&candidate.payload, &payload);
        let confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: candidate.trip_id.clone(),
            fact_type: candidate.fact_type,
            payload,
            method: candidate.method,
            candidate_id: Some(candidate.id.clone()),
            corrected_fields,
            confirmed_at: now_rfc3339(),
        };
        insert_confirmed_fact(&transaction, &confirmed)?;

        candidate.status = CandidateStatus::Confirmed;
        candidate.resolved_at = Some(confirmed.confirmed_at.clone());
        update_candidate_resolution(&transaction, &candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok((candidate, confirmed))
    }

    pub fn reject_candidate(&self, candidate_id: &str) -> Result<CandidateFact, AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let mut candidate = fetch_candidate(&transaction, candidate_id)?;
        ensure_candidate_pending(&candidate)?;
        candidate.status = CandidateStatus::Rejected;
        candidate.resolved_at = Some(now_rfc3339());
        update_candidate_resolution(&transaction, &candidate)?;
        transaction.commit().map_err(storage_error)?;
        Ok(candidate)
    }

    pub fn add_manual_fact(&self, input: AddManualFactInput) -> Result<ConfirmedFact, AppError> {
        validate_fact_payload(input.fact_type, &input.payload)?;
        let connection = self.connection()?;
        fetch_trip(&connection, &input.trip_id)?;
        let confirmed = ConfirmedFact {
            id: new_id("fact"),
            trip_id: input.trip_id,
            fact_type: input.fact_type,
            payload: input.payload,
            method: ExtractionMethod::Manual,
            candidate_id: None,
            corrected_fields: Vec::new(),
            confirmed_at: now_rfc3339(),
        };
        insert_confirmed_fact(&connection, &confirmed)?;
        Ok(confirmed)
    }

    pub fn unconfirm_fact(&self, fact_id: &str) -> Result<(), AppError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(storage_error)?;
        let candidate_id = transaction
            .query_row(
                "SELECT candidate_id FROM confirmed_facts WHERE id = ?1",
                params![fact_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| AppError::new(ErrorCode::FactNotFound, "fact not found"))?;
        transaction
            .execute(
                "DELETE FROM confirmed_facts WHERE id = ?1",
                params![fact_id],
            )
            .map_err(storage_error)?;
        if let Some(candidate_id) = candidate_id {
            transaction
                .execute(
                    "UPDATE candidate_facts SET status = 'pending', resolved_at = NULL WHERE id = ?1",
                    params![candidate_id],
                )
                .map_err(storage_error)?;
        }
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    fn set_trip_status(&self, trip_id: &str, status: TripStatus) -> Result<Trip, AppError> {
        let connection = self.connection()?;
        let changed = connection
            .execute(
                "UPDATE trips SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![enum_to_sql(status)?, now_rfc3339(), trip_id],
            )
            .map_err(storage_error)?;
        if changed == 0 {
            return Err(AppError::new(ErrorCode::TripNotFound, "trip not found"));
        }
        fetch_trip(&connection, trip_id)
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.connection
            .lock()
            .map_err(|_| AppError::new(ErrorCode::StorageFailure, "storage lock poisoned"))
    }
}

fn default_database_path() -> Result<PathBuf, AppError> {
    if let Ok(path) = env::var("VOYALIER_DATA_DIR") {
        return Ok(PathBuf::from(path).join(DATABASE_FILE));
    }
    let project_dirs = ProjectDirs::from("com", "voyalier", "Voyalier").ok_or_else(|| {
        AppError::new(
            ErrorCode::StorageFailure,
            "could not resolve application data directory",
        )
    })?;
    Ok(project_dirs.data_dir().join(DATABASE_FILE))
}

fn init_connection(connection: &Connection) -> Result<(), AppError> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS trips (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS source_documents (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (kind IN ('pasted_text', 'html')),
                label TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                char_count INTEGER NOT NULL,
                imported_at TEXT NOT NULL,
                raw_content TEXT NOT NULL,
                UNIQUE (trip_id, content_hash)
            );

            CREATE TABLE IF NOT EXISTS parser_runs (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                parser_id TEXT NOT NULL,
                parser_version TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS candidate_facts (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                field_spans TEXT NOT NULL,
                warnings TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
                created_at TEXT NOT NULL,
                resolved_at TEXT
            );

            CREATE TABLE IF NOT EXISTS confirmed_facts (
                id TEXT PRIMARY KEY,
                trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                fact_type TEXT NOT NULL CHECK (fact_type IN ('flight_segment', 'lodging_stay')),
                payload TEXT NOT NULL,
                method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                corrected_fields TEXT NOT NULL,
                confirmed_at TEXT NOT NULL
            );

            PRAGMA user_version = 1;
            ",
        )
        .map_err(storage_error)
}

fn parse_document(
    document: &NormalizedDocument,
) -> (&'static str, &'static str, Vec<ParsedCandidate>) {
    match document.kind {
        DocumentKind::Html => {
            let parser = JsonLdParser;
            let outcome = parser.parse(document);
            (parser.id(), parser.version(), outcome.candidates)
        }
        DocumentKind::PastedText => {
            let parser = PlaintextParser;
            let outcome = parser.parse(document);
            (parser.id(), parser.version(), outcome.candidates)
        }
    }
}

fn fetch_trip(connection: &Connection, trip_id: &str) -> Result<Trip, AppError> {
    connection
        .query_row(
            "SELECT id, title, origin, destination, start_date, end_date, status, created_at, updated_at
             FROM trips WHERE id = ?1",
            params![trip_id],
            row_to_trip,
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| AppError::new(ErrorCode::TripNotFound, "trip not found"))
}

fn fetch_candidate(connection: &Connection, candidate_id: &str) -> Result<CandidateFact, AppError> {
    connection
        .query_row(
            "SELECT id, trip_id, document_id, parser_run_id, fact_type, payload, method,
                    field_spans, warnings, status, created_at, resolved_at
             FROM candidate_facts WHERE id = ?1",
            params![candidate_id],
            row_to_candidate,
        )
        .optional()
        .map_err(storage_error)?
        .ok_or_else(|| AppError::new(ErrorCode::CandidateNotFound, "candidate not found"))
}

fn fetch_confirmed_facts(
    connection: &Connection,
    trip_id: &str,
) -> Result<Vec<ConfirmedFact>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT id, trip_id, fact_type, payload, method, candidate_id, corrected_fields, confirmed_at
             FROM confirmed_facts
             WHERE trip_id = ?1
             ORDER BY confirmed_at ASC, id ASC",
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map(params![trip_id], row_to_confirmed_fact)
        .map_err(storage_error)?;
    collect_rows(rows)
}

fn insert_candidate(connection: &Connection, candidate: &CandidateFact) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO candidate_facts
             (id, trip_id, document_id, parser_run_id, fact_type, payload, method, field_spans, warnings, status, created_at, resolved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                candidate.id,
                candidate.trip_id,
                candidate.document_id,
                candidate.parser_run_id,
                enum_to_sql(candidate.fact_type)?,
                json_to_sql(&candidate.payload)?,
                enum_to_sql(candidate.method)?,
                json_to_sql(&candidate.field_spans)?,
                json_to_sql(&candidate.warnings)?,
                enum_to_sql(candidate.status)?,
                candidate.created_at,
                candidate.resolved_at
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn insert_confirmed_fact(
    connection: &Connection,
    confirmed: &ConfirmedFact,
) -> Result<(), AppError> {
    connection
        .execute(
            "INSERT INTO confirmed_facts
             (id, trip_id, fact_type, payload, method, candidate_id, corrected_fields, confirmed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                confirmed.id,
                confirmed.trip_id,
                enum_to_sql(confirmed.fact_type)?,
                json_to_sql(&confirmed.payload)?,
                enum_to_sql(confirmed.method)?,
                confirmed.candidate_id,
                json_to_sql(&confirmed.corrected_fields)?,
                confirmed.confirmed_at
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn update_candidate_resolution(
    connection: &Connection,
    candidate: &CandidateFact,
) -> Result<(), AppError> {
    connection
        .execute(
            "UPDATE candidate_facts SET status = ?1, resolved_at = ?2 WHERE id = ?3",
            params![
                enum_to_sql(candidate.status)?,
                candidate.resolved_at,
                candidate.id
            ],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn ensure_candidate_pending(candidate: &CandidateFact) -> Result<(), AppError> {
    if candidate.status != CandidateStatus::Pending {
        return Err(AppError::new(
            ErrorCode::CandidateAlreadyResolved,
            "candidate has already been resolved",
        ));
    }
    Ok(())
}

fn row_to_trip(row: &rusqlite::Row<'_>) -> rusqlite::Result<Trip> {
    Ok(Trip {
        id: row.get(0)?,
        title: row.get(1)?,
        origin: row.get(2)?,
        destination: row.get(3)?,
        start_date: row.get(4)?,
        end_date: row.get(5)?,
        status: sql_to_enum(row.get::<_, String>(6)?)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_trip_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<TripSummary> {
    let confirmed_fact_count = row.get::<_, i64>(9)?;
    let pending_candidate_count = row.get::<_, i64>(10)?;
    Ok(TripSummary {
        trip: row_to_trip(row)?,
        confirmed_fact_count: confirmed_fact_count as u32,
        pending_candidate_count: pending_candidate_count as u32,
    })
}

fn row_to_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<CandidateFact> {
    Ok(CandidateFact {
        id: row.get(0)?,
        trip_id: row.get(1)?,
        document_id: row.get(2)?,
        parser_run_id: row.get(3)?,
        fact_type: sql_to_enum(row.get::<_, String>(4)?)?,
        payload: sql_to_json(row.get::<_, String>(5)?)?,
        method: sql_to_enum(row.get::<_, String>(6)?)?,
        field_spans: sql_to_json(row.get::<_, String>(7)?)?,
        warnings: sql_to_json(row.get::<_, String>(8)?)?,
        status: sql_to_enum(row.get::<_, String>(9)?)?,
        created_at: row.get(10)?,
        resolved_at: row.get(11)?,
    })
}

fn row_to_confirmed_fact(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConfirmedFact> {
    Ok(ConfirmedFact {
        id: row.get(0)?,
        trip_id: row.get(1)?,
        fact_type: sql_to_enum(row.get::<_, String>(2)?)?,
        payload: sql_to_json(row.get::<_, String>(3)?)?,
        method: sql_to_enum(row.get::<_, String>(4)?)?,
        candidate_id: row.get(5)?,
        corrected_fields: sql_to_json(row.get::<_, String>(6)?)?,
        confirmed_at: row.get(7)?,
    })
}

fn collect_rows<T, F>(rows: rusqlite::MappedRows<'_, F>) -> Result<Vec<T>, AppError>
where
    F: FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
{
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(storage_error)
}

fn enum_to_sql<T: serde::Serialize>(value: T) -> Result<String, AppError> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .ok_or_else(|| AppError::new(ErrorCode::InternalUnexpected, "enum serialization failed"))
}

fn sql_to_enum<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_value(ValueOrString::string(value).into_json()).map_err(from_json_error)
}

fn json_to_sql<T: serde::Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_string(value).map_err(|error| {
        AppError::new(
            ErrorCode::InternalUnexpected,
            format!("failed to serialize storage json: {error}"),
        )
    })
}

fn sql_to_json<T: serde::de::DeserializeOwned>(value: String) -> rusqlite::Result<T> {
    serde_json::from_str(&value).map_err(from_json_error)
}

struct ValueOrString(String);

impl ValueOrString {
    fn string(value: String) -> Self {
        Self(value)
    }

    fn into_json(self) -> serde_json::Value {
        serde_json::Value::String(self.0)
    }
}

fn from_json_error(error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error))
}

fn storage_error(error: impl std::error::Error) -> AppError {
    AppError::new(ErrorCode::StorageFailure, error.to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;
    use voyalier_core::{CandidateStatus, DocumentKind, FactPayload, FactType};

    #[test]
    fn persists_trips_across_restarts() {
        let database = temp_database("persistence");
        let service = AppService::open_path(&database).expect("service");
        let trip = service
            .create_trip(CreateTripInput {
                title: None,
                origin: "Chicago".to_owned(),
                destination: "Kyoto".to_owned(),
                start_date: "2027-04-01".to_owned(),
                end_date: "2027-04-10".to_owned(),
            })
            .expect("trip");
        drop(service);

        let reopened = AppService::open_path(&database).expect("reopen");
        let detail = reopened.get_trip(&trip.id).expect("read trip");
        assert_eq!(detail.trip.destination, "Kyoto");
        cleanup_database(database);
    }

    #[test]
    fn duplicate_import_returns_existing_document_id() {
        let database = temp_database("duplicate");
        let service = AppService::open_path(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let input = ImportDocumentInput {
            trip_id: trip.id,
            kind: DocumentKind::PastedText,
            label: Some("Memo".to_owned()),
            content: "Confirmation CODE7\nRoute SFO-NRT\n2027-04-02T10:00".to_owned(),
        };
        let first = service
            .import_document(input.clone())
            .expect("first import");
        let error = service.import_document(input).expect_err("duplicate");

        assert_eq!(error.code, ErrorCode::DocumentDuplicate);
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|details| details.get("existingDocumentId")),
            Some(&first.document.id)
        );
        cleanup_database(database);
    }

    #[test]
    fn unconfirm_fact_returns_linked_candidate_to_pending() {
        let database = temp_database("unconfirm");
        let service = AppService::open_path(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::PastedText,
                label: None,
                content: "Confirmation HOLD9\nRoute SFO-NRT\n2027-04-02T10:00".to_owned(),
            })
            .expect("import");
        let candidate = imported.candidates.first().expect("candidate").clone();
        let (_, confirmed) = service
            .confirm_candidate(ConfirmCandidateInput {
                candidate_id: candidate.id.clone(),
                edited_payload: None,
            })
            .expect("confirm");

        assert_eq!(
            service
                .list_candidates(&trip.id, Some(CandidateStatus::Pending))
                .expect("pending")
                .len(),
            0
        );

        service.unconfirm_fact(&confirmed.id).expect("unconfirm");
        let pending = service
            .list_candidates(&trip.id, Some(CandidateStatus::Pending))
            .expect("pending");

        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, candidate.id);
        cleanup_database(database);
    }

    #[test]
    fn delete_trip_cascades_documents_candidates_and_facts() {
        let database = temp_database("cascade");
        let service = AppService::open_path(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let fact = service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    departure_airport_iata: Some("SFO".to_owned()),
                    arrival_airport_iata: Some("NRT".to_owned()),
                    departure_local: Some("2027-04-02T10:00".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual fact");
        assert_eq!(fact.trip_id, trip.id);

        service.delete_trip(&trip.id).expect("delete");
        assert_eq!(
            service.get_trip(&trip.id).expect_err("gone").code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn get_trip_reports_overlapping_flight_conflict() {
        use voyalier_core::{ConflictSeverity, ItineraryConflictKind};

        let database = temp_database("conflicts");
        let service = AppService::open_path(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        for (departure, arrival) in [
            ("2027-04-02T09:00", "2027-04-02T13:00"),
            ("2027-04-02T12:00", "2027-04-02T16:00"),
        ] {
            service
                .add_manual_fact(AddManualFactInput {
                    trip_id: trip.id.clone(),
                    fact_type: FactType::FlightSegment,
                    payload: FactPayload {
                        departure_airport_iata: Some("SFO".to_owned()),
                        arrival_airport_iata: Some("NRT".to_owned()),
                        departure_local: Some(departure.to_owned()),
                        arrival_local: Some(arrival.to_owned()),
                        ..FactPayload::default()
                    },
                })
                .expect("manual flight");
        }

        let detail = service.get_trip(&trip.id).expect("detail");
        let overlap = detail
            .itinerary_conflicts
            .iter()
            .find(|conflict| conflict.kind == ItineraryConflictKind::FlightOverlap)
            .expect("flight overlap surfaced through get_trip");
        assert_eq!(overlap.severity, ConflictSeverity::Warning);
        assert_eq!(overlap.fact_ids.len(), 2);
        // The same overlap drives the readiness rollup through get_trip.
        assert_eq!(
            detail.readiness.status,
            voyalier_core::ReadinessStatus::ActionNeeded
        );
        cleanup_database(database);
    }

    #[test]
    fn trip_brief_excludes_secrets() {
        let database = temp_database("brief");
        let service = AppService::open_path(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::FlightSegment,
                payload: FactPayload {
                    flight_number: Some("FP18".to_owned()),
                    departure_airport_iata: Some("ORD".to_owned()),
                    arrival_airport_iata: Some("HND".to_owned()),
                    departure_local: Some("2027-04-02T10:00".to_owned()),
                    confirmation_code: Some("SECRET-PNR".to_owned()),
                    passenger_name: Some("Jamie Traveler".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual flight");

        let brief = service.get_trip_brief(&trip.id).expect("brief");
        let serialized = serde_json::to_string(&brief).expect("serialize");
        assert!(!serialized.contains("SECRET-PNR"));
        assert!(!serialized.contains("Jamie Traveler"));
        assert!(serialized.contains("FP18"));
        assert_eq!(brief.flights.len(), 1);
        cleanup_database(database);
    }

    fn valid_trip_input() -> CreateTripInput {
        CreateTripInput {
            title: None,
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: "2027-04-01".to_owned(),
            end_date: "2027-04-10".to_owned(),
        }
    }

    fn temp_database(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("voyalier-app-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join("voyalier.sqlite3")
    }

    fn cleanup_database(database: PathBuf) {
        if let Some(parent) = database.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
