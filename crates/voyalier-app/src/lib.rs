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
    FCDO_COUNTRIES, FcdoCountry, HealthResponse, ImportDocumentInput, ImportResult,
    IntelligenceMode, JsonLdParser, NormalizedDocument, ParsedCandidate, PlaintextParser,
    RedactionPolicy, SearchHit, SearchableDocument, SourceDocument, TravelAdviceSnapshot, Trip,
    TripBrief, TripDetail, TripStatus, TripSummary, UpdateTripInput, WeatherSnapshot,
    assess_readiness, build_trip_brief, changed_payload_fields, detect_itinerary_conflicts, new_id,
    now_rfc3339, parse_fcdo_content, parse_forecast_response, parse_geocoding_response,
    search_trip_corpus, validate_country_slug, validate_create_trip, validate_document_content,
    validate_fact_payload, validate_search_query, validate_update_trip,
};

const DATABASE_FILE: &str = "voyalier.sqlite3";

/// Fetches a URL's body as text. The only network seam in the application
/// layer — injectable so every test runs without touching the network.
pub trait AdviceFetcher: Send + Sync {
    fn fetch_text(&self, url: &str) -> Result<String, AppError>;
}

/// Production fetcher: ureq with a global timeout and an identifying
/// User-Agent, per API-citizenship norms for keyless government endpoints.
struct UreqFetcher;

impl AdviceFetcher for UreqFetcher {
    fn fetch_text(&self, url: &str) -> Result<String, AppError> {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(std::time::Duration::from_secs(15)))
            .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
            .build();
        let agent: ureq::Agent = config.into();
        let mut response = agent.get(url).call().map_err(fetch_failure)?;
        response.body_mut().read_to_string().map_err(fetch_failure)
    }
}

fn fetch_failure(cause: ureq::Error) -> AppError {
    AppError::new(
        ErrorCode::AdviceFetchFailed,
        format!("could not reach the official source: {cause}"),
    )
}

#[derive(Clone)]
pub struct AppService {
    connection: Arc<Mutex<Connection>>,
    fetcher: Arc<dyn AdviceFetcher>,
}

impl AppService {
    pub fn open_default() -> Result<Self, AppError> {
        Self::open_path(default_database_path()?)
    }

    pub fn open_path(path: impl AsRef<Path>) -> Result<Self, AppError> {
        Self::open_path_with_fetcher(path, Arc::new(UreqFetcher))
    }

    /// Test/embedding constructor with an injected fetcher.
    pub fn open_path_with_fetcher(
        path: impl AsRef<Path>,
        fetcher: Arc<dyn AdviceFetcher>,
    ) -> Result<Self, AppError> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let connection = Connection::open(path).map_err(storage_error)?;
        init_connection(&connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            fetcher,
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
        let travel_advice = fetch_travel_advice_snapshot(&connection, trip_id)?;
        let weather = fetch_weather_snapshot(&connection, trip_id)?;
        Ok(TripDetail {
            trip,
            confirmed_facts,
            pending_candidate_count,
            itinerary_conflicts,
            readiness,
            travel_advice,
            weather,
        })
    }

    /// The curated list of fetchable FCDO country pages.
    pub fn list_advice_countries(&self) -> Vec<FcdoCountry> {
        FCDO_COUNTRIES.to_vec()
    }

    /// Fetch and store a dated snapshot of official FCDO travel advice for a
    /// curated country. Called only from an explicit user action — the click
    /// is the consent for this single, named, keyless fetch. The snapshot is
    /// stored verbatim with its retrieval time and replaces the trip's
    /// previous snapshot.
    pub fn fetch_travel_advice(
        &self,
        trip_id: &str,
        country_slug: &str,
    ) -> Result<TravelAdviceSnapshot, AppError> {
        let country = validate_country_slug(country_slug)?;
        // Validate the trip before any network call.
        {
            let connection = self.connection()?;
            fetch_trip(&connection, trip_id)?;
        }
        let url = format!(
            "https://www.gov.uk/api/content/foreign-travel-advice/{}",
            country.slug
        );
        let body = self.fetcher.fetch_text(&url)?;
        let snapshot = parse_fcdo_content(country, &body, &now_rfc3339())?;

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO travel_advice_snapshots
                 (trip_id, country_slug, country_name, source_url, summary, alert_status,
                  source_updated_at, change_description, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   country_slug = excluded.country_slug,
                   country_name = excluded.country_name,
                   source_url = excluded.source_url,
                   summary = excluded.summary,
                   alert_status = excluded.alert_status,
                   source_updated_at = excluded.source_updated_at,
                   change_description = excluded.change_description,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.country_slug,
                    snapshot.country_name,
                    snapshot.source_url,
                    snapshot.summary,
                    json_to_sql(&snapshot.alert_status)?,
                    snapshot.source_updated_at,
                    snapshot.change_description,
                    snapshot.retrieved_at
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
    }

    /// Deterministic search over this trip's stored documents and confirmed
    /// facts. Purely local; ranking is transparent occurrence counting.
    pub fn search_trip(&self, trip_id: &str, query: &str) -> Result<Vec<SearchHit>, AppError> {
        let query = validate_search_query(query)?;
        let connection = self.connection()?;
        fetch_trip(&connection, trip_id)?;

        let mut statement = connection
            .prepare(
                "SELECT id, label, raw_content FROM source_documents
                 WHERE trip_id = ?1 ORDER BY imported_at ASC, id ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![trip_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(storage_error)?;
        let documents: Vec<(String, String, String)> = collect_rows(rows)?;
        let searchable: Vec<SearchableDocument<'_>> = documents
            .iter()
            .map(|(id, label, content)| SearchableDocument { id, label, content })
            .collect();
        let facts = fetch_confirmed_facts(&connection, trip_id)?;

        Ok(search_trip_corpus(&query, &searchable, &facts))
    }

    /// Fetch and store a dated weather outlook for the trip's destination.
    /// Called only from an explicit user action — the click is the consent for
    /// two keyless requests to open-meteo.com (geocode the destination name,
    /// then the daily forecast). The snapshot replaces the trip's previous one.
    pub fn fetch_weather(&self, trip_id: &str) -> Result<WeatherSnapshot, AppError> {
        let trip = {
            let connection = self.connection()?;
            fetch_trip(&connection, trip_id)?
        };

        let geocode_url = format!(
            "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=en&format=json",
            percent_encode(&trip.destination)
        );
        let place = parse_geocoding_response(&self.fetcher.fetch_text(&geocode_url)?)?;

        let forecast_url = format!(
            "https://api.open-meteo.com/v1/forecast?latitude={:.5}&longitude={:.5}\
             &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max\
             &timezone=auto&forecast_days=16",
            place.latitude, place.longitude
        );
        let snapshot = parse_forecast_response(
            &place,
            &self.fetcher.fetch_text(&forecast_url)?,
            &trip.start_date,
            &trip.end_date,
            &now_rfc3339(),
        )?;

        let connection = self.connection()?;
        connection
            .execute(
                "INSERT INTO weather_snapshots
                 (trip_id, place_name, place_region, latitude, longitude, days, coverage,
                  source_url, retrieved_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(trip_id) DO UPDATE SET
                   place_name = excluded.place_name,
                   place_region = excluded.place_region,
                   latitude = excluded.latitude,
                   longitude = excluded.longitude,
                   days = excluded.days,
                   coverage = excluded.coverage,
                   source_url = excluded.source_url,
                   retrieved_at = excluded.retrieved_at",
                params![
                    trip_id,
                    snapshot.place_name,
                    snapshot.place_region,
                    snapshot.latitude,
                    snapshot.longitude,
                    json_to_sql(&snapshot.days)?,
                    enum_to_sql(snapshot.coverage)?,
                    snapshot.source_url,
                    snapshot.retrieved_at
                ],
            )
            .map_err(storage_error)?;
        Ok(snapshot)
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

            CREATE TABLE IF NOT EXISTS travel_advice_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                country_slug TEXT NOT NULL,
                country_name TEXT NOT NULL,
                source_url TEXT NOT NULL,
                summary TEXT NOT NULL,
                alert_status TEXT NOT NULL,
                source_updated_at TEXT,
                change_description TEXT,
                retrieved_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS weather_snapshots (
                trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
                place_name TEXT NOT NULL,
                place_region TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                days TEXT NOT NULL,
                coverage TEXT NOT NULL,
                source_url TEXT NOT NULL,
                retrieved_at TEXT NOT NULL
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

fn fetch_travel_advice_snapshot(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<TravelAdviceSnapshot>, AppError> {
    connection
        .query_row(
            "SELECT country_slug, country_name, source_url, summary, alert_status,
                    source_updated_at, change_description, retrieved_at
             FROM travel_advice_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(TravelAdviceSnapshot {
                    country_slug: row.get(0)?,
                    country_name: row.get(1)?,
                    source_url: row.get(2)?,
                    summary: row.get(3)?,
                    alert_status: sql_to_json(row.get::<_, String>(4)?)?,
                    source_updated_at: row.get(5)?,
                    change_description: row.get(6)?,
                    retrieved_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

fn fetch_weather_snapshot(
    connection: &Connection,
    trip_id: &str,
) -> Result<Option<WeatherSnapshot>, AppError> {
    connection
        .query_row(
            "SELECT place_name, place_region, latitude, longitude, days, coverage,
                    source_url, retrieved_at
             FROM weather_snapshots WHERE trip_id = ?1",
            params![trip_id],
            |row| {
                Ok(WeatherSnapshot {
                    place_name: row.get(0)?,
                    place_region: row.get(1)?,
                    latitude: row.get(2)?,
                    longitude: row.get(3)?,
                    days: sql_to_json(row.get::<_, String>(4)?)?,
                    coverage: sql_to_enum(row.get::<_, String>(5)?)?,
                    source_url: row.get(6)?,
                    retrieved_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(storage_error)
}

/// Minimal RFC 3986 percent-encoding for a single query value.
fn percent_encode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => {
                encoded.push('%');
                encoded.push_str(&format!("{byte:02X}"));
            }
        }
    }
    encoded
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
    fn search_trip_finds_documents_and_facts_with_provenance() {
        use voyalier_core::SearchHitSource;

        let database = temp_database("search");
        let service = AppService::open_path(&database).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");
        let imported = service
            .import_document(ImportDocumentInput {
                trip_id: trip.id.clone(),
                kind: DocumentKind::PastedText,
                label: Some("Hotel email".to_owned()),
                content: "The airport shuttle leaves every 30 minutes.\nConfirmation SHTL77"
                    .to_owned(),
            })
            .expect("import");
        service
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload {
                    property_name: Some("Shuttle Side Inn".to_owned()),
                    ..FactPayload::default()
                },
            })
            .expect("manual fact");

        let hits = service.search_trip(&trip.id, "shuttle").expect("hits");
        assert_eq!(hits.len(), 2);
        assert!(
            hits.iter()
                .any(|hit| hit.source == SearchHitSource::Document
                    && hit.record_id == imported.document.id)
        );
        assert!(
            hits.iter()
                .any(|hit| hit.source == SearchHitSource::ConfirmedFact)
        );

        // Validation and unknown-trip errors are deterministic.
        assert_eq!(
            service
                .search_trip(&trip.id, "   ")
                .expect_err("empty")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert_eq!(
            service
                .search_trip("trip_missing", "shuttle")
                .expect_err("missing trip")
                .code,
            ErrorCode::TripNotFound
        );
        cleanup_database(database);
    }

    #[test]
    fn fetch_travel_advice_stores_a_dated_snapshot_without_network_in_tests() {
        struct StubFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for StubFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                Ok(r#"{
                    "description": "FCDO travel advice for Japan.",
                    "public_updated_at": "2026-06-30T11:02:00.000+01:00",
                    "details": { "alert_status": [], "change_description": "Latest update: typhoon season." }
                }"#
                .to_owned())
            }
        }

        let database = temp_database("advice");
        let fetcher = Arc::new(StubFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service =
            AppService::open_path_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        // Unknown slug is rejected before any fetch happens.
        assert_eq!(
            service
                .fetch_travel_advice(&trip.id, "atlantis")
                .expect_err("unknown slug")
                .code,
            ErrorCode::ValidationInvalidInput
        );
        assert!(fetcher.calls.lock().expect("lock").is_empty());

        let snapshot = service
            .fetch_travel_advice(&trip.id, "japan")
            .expect("snapshot");
        assert_eq!(snapshot.country_name, "Japan");
        assert!(!snapshot.retrieved_at.is_empty());
        assert_eq!(
            fetcher.calls.lock().expect("lock").as_slice(),
            ["https://www.gov.uk/api/content/foreign-travel-advice/japan"]
        );

        // The snapshot persists and surfaces on the trip detail.
        let detail = service.get_trip(&trip.id).expect("detail");
        let stored = detail.travel_advice.expect("stored snapshot");
        assert_eq!(stored.country_slug, "japan");
        assert_eq!(stored.summary, "FCDO travel advice for Japan.");
        assert_eq!(
            stored.change_description.as_deref(),
            Some("Latest update: typhoon season.")
        );

        // The curated country list is exposed for the picker.
        assert!(
            service
                .list_advice_countries()
                .iter()
                .any(|country| country.slug == "japan")
        );
        cleanup_database(database);
    }

    #[test]
    fn fetch_weather_geocodes_the_destination_and_stores_the_outlook() {
        use voyalier_core::WeatherCoverage;

        struct RoutedFetcher {
            calls: std::sync::Mutex<Vec<String>>,
        }
        impl AdviceFetcher for RoutedFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                self.calls.lock().expect("lock").push(url.to_owned());
                if url.contains("geocoding-api.open-meteo.com") {
                    Ok(r#"{ "results": [ { "name": "Kyoto", "latitude": 35.02107,
                        "longitude": 135.75385, "country": "Japan", "admin1": "Kyoto" } ] }"#
                        .to_owned())
                } else {
                    Ok(r#"{ "daily": {
                        "time": ["2027-04-01", "2027-04-02"],
                        "weather_code": [0, 61],
                        "temperature_2m_max": [18.4, 15.1],
                        "temperature_2m_min": [9.2, 8.7],
                        "precipitation_probability_max": [5, 80]
                    } }"#
                        .to_owned())
                }
            }
        }

        let database = temp_database("weather");
        let fetcher = Arc::new(RoutedFetcher {
            calls: std::sync::Mutex::new(Vec::new()),
        });
        let service =
            AppService::open_path_with_fetcher(&database, fetcher.clone()).expect("service");
        let trip = service.create_trip(valid_trip_input()).expect("trip");

        let snapshot = service.fetch_weather(&trip.id).expect("snapshot");
        assert_eq!(snapshot.place_name, "Kyoto");
        assert_eq!(snapshot.place_region, "Kyoto, Japan");
        assert_eq!(snapshot.days.len(), 2);
        // Trip runs 2027-04-01..10 but the horizon covered only two days.
        assert_eq!(snapshot.coverage, WeatherCoverage::Partial);

        let calls = fetcher.calls.lock().expect("lock").clone();
        assert_eq!(calls.len(), 2);
        assert!(calls[0].contains("geocoding-api.open-meteo.com"));
        assert!(calls[0].contains("name=Kyoto"));
        assert!(calls[1].contains("api.open-meteo.com/v1/forecast"));
        assert!(calls[1].contains("latitude=35.02107"));

        // Persists and rides on the trip detail.
        let detail = service.get_trip(&trip.id).expect("detail");
        let stored = detail.weather.expect("stored weather");
        assert_eq!(stored.days[1].description, "Light rain");
        assert_eq!(stored.days[1].precipitation_chance_pct, Some(80.0));
        cleanup_database(database);
    }

    #[test]
    fn percent_encoding_covers_spaces_and_unicode() {
        assert_eq!(percent_encode("Kyoto"), "Kyoto");
        assert_eq!(percent_encode("New York"), "New%20York");
        assert_eq!(percent_encode("São Paulo"), "S%C3%A3o%20Paulo");
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
