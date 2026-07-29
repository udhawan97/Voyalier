//! Cross-cutting tests for the whole `AppService` surface.
//!
//! Its own file rather than inline, following `voyalier-core`'s `mod tests;`
//! (ADR-0010). Still an inline `#[cfg(test)] mod tests` in the sense
//! `AGENTS.md` requires: no `tests/` directory, no integration harness.

use std::{fs, path::PathBuf};

use super::*;
use voyalier_core::KeyValidationStatus;
use voyalier_core::{CandidateStatus, DocumentKind, FactPayload, FactType};

#[test]
fn persists_trips_across_restarts() {
    let database = temp_database("persistence");
    let service = open_test_service(&database).expect("service");
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

    let reopened = open_test_service(&database).expect("reopen");
    let detail = reopened.get_trip(&trip.id).expect("read trip");
    assert_eq!(detail.trip.destination, "Kyoto");
    cleanup_database(database);
}

#[test]
fn traveler_planning_persists_without_becoming_confirmed_evidence() {
    struct PlanningPackFetcher;
    impl AdviceFetcher for PlanningPackFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Ok(serde_json::json!({
                "packId": "us-nashville",
                "places": [{
                    "name": "Frist Art Museum",
                    "category": "art_museum",
                    "lat": 36.156,
                    "lon": -86.783
                }],
                "articles": []
            })
            .to_string())
        }
    }

    let database = temp_database("traveler-planning");
    let secrets = Arc::new(MemorySecretStore::default());
    let service =
        AppService::open_path_with_deps(&database, Arc::new(PlanningPackFetcher), secrets.clone())
            .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .download_pack(&trip.id, "us-nashville")
        .expect("pack");

    let profile = service
        .set_interest_profile(SetInterestProfileInput {
            trip_id: trip.id.clone(),
            weights: PersonaWeights {
                culture: 1.0,
                ..PersonaWeights::balanced()
            },
        })
        .expect("profile");
    let recommendation = service
        .get_recommendations(&trip.id, profile.weights)
        .expect("recommendations")
        .remove(0);
    let mut forged = recommendation.clone();
    forged.category = "forged_category".to_owned();
    forged.dimension = "forged_dimension".to_owned();
    forged.source = "Forged source".to_owned();
    forged.license = "Forged license".to_owned();
    forged.reasons = vec!["Forged reason".to_owned()];
    let saved = service
        .save_place(SavePlaceInput {
            trip_id: trip.id.clone(),
            recommendation: forged,
            weights: profile.weights,
            notes: "Quiet morning option".to_owned(),
        })
        .expect("saved place");
    assert_eq!(saved.name, recommendation.name);
    assert_eq!(saved.category, recommendation.category);
    assert_eq!(saved.dimension, recommendation.dimension);
    assert_eq!(saved.source, recommendation.source);
    assert_eq!(saved.license, recommendation.license);
    assert_eq!(saved.reasons, recommendation.reasons);

    let mut folded_identity = recommendation.clone();
    folded_identity.name = recommendation.name.to_lowercase();
    let duplicate = service
        .save_place(SavePlaceInput {
            trip_id: trip.id.clone(),
            recommendation: folded_identity,
            weights: profile.weights,
            notes: String::new(),
        })
        .expect("folded duplicate");
    assert_eq!(duplicate.id, saved.id);
    let packing = service
        .add_packing_item(AddPackingItemInput {
            trip_id: trip.id.clone(),
            label: "Museum pass".to_owned(),
            suggestion_code: None,
        })
        .expect("packing item");
    let suggested = service
        .add_packing_item(AddPackingItemInput {
            trip_id: trip.id.clone(),
            label: "Rain shell".to_owned(),
            suggestion_code: Some("rain_shell".to_owned()),
        })
        .expect("suggested packing item");
    let duplicate_suggestion = service
        .add_packing_item(AddPackingItemInput {
            trip_id: trip.id.clone(),
            label: "Rain jacket".to_owned(),
            suggestion_code: Some("rain_shell".to_owned()),
        })
        .expect("idempotent suggested packing item");
    assert_eq!(duplicate_suggestion.id, suggested.id);
    let activity = service
        .create_trip_item(CreateTripItemInput {
            trip_id: trip.id.clone(),
            kind: voyalier_core::TripItemKind::Activity,
            title: "Visit Frist".to_owned(),
            location: Some("Frist Art Museum".to_owned()),
            start_at: Some("2027-04-04T15:00:00".to_owned()),
            end_at: None,
            notes: Some("Use the saved shortlist".to_owned()),
            saved_place_id: Some(saved.id.clone()),
        })
        .expect("activity");
    let other_trip = service.create_trip(valid_trip_input()).expect("other trip");
    let error = service
        .create_trip_item(CreateTripItemInput {
            trip_id: other_trip.id,
            kind: voyalier_core::TripItemKind::Activity,
            title: "Wrong-trip saved place".to_owned(),
            location: None,
            start_at: None,
            end_at: None,
            notes: None,
            saved_place_id: Some(saved.id.clone()),
        })
        .expect_err("cross-trip saved place must fail");
    assert_eq!(error.code, ErrorCode::ValidationInvalidInput);

    // Removing the source pack keeps the provenance snapshot, while making
    // its unavailable state explicit. Promotion remains a separate record.
    service
        .delete_downloaded_pack(&trip.id, "us-nashville")
        .expect("delete pack");
    let detail = service.get_trip(&trip.id).expect("detail");
    assert_eq!(detail.interest_profile.weights.culture, 1.0);
    assert_eq!(detail.saved_places[0].id, saved.id);
    assert!(!detail.saved_places[0].source_pack_available);
    assert_eq!(detail.packing_items[0].id, packing.id);
    assert_eq!(detail.trip_items[0].id, activity.id);
    assert!(detail.confirmed_facts.is_empty());
    let workspace_hits = service.search_workspace("quiet morning").expect("search");
    assert_eq!(workspace_hits[0].record_id, saved.id);
    assert_eq!(workspace_hits[0].trip_id, trip.id);
    assert!(
        service
            .search_workspace("Matches your interest")
            .expect("product reason query")
            .is_empty(),
        "generated recommendation reasons are not searchable content"
    );

    drop(service);
    let reopened =
        AppService::open_path_with_deps(&database, Arc::new(UreqFetcher), secrets).expect("reopen");
    let detail = reopened.get_trip(&trip.id).expect("persisted detail");
    assert_eq!(detail.saved_places[0].notes, "Quiet morning option");
    assert_eq!(detail.trip_items[0].title, "Visit Frist");
    cleanup_database(database);
}

#[test]
fn duplicate_import_returns_existing_document_id() {
    let database = temp_database("duplicate");
    let service = open_test_service(&database).expect("service");
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
fn imports_a_plain_text_email_using_the_subject_as_the_label() {
    let database = temp_database("email-import");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let raw_email = "From: airline@example.com\r\nSubject: Flight SFO to NRT\r\nContent-Type: text/plain\r\n\r\nConfirmation CODE7\nRoute SFO-NRT\n2027-04-02T10:00";
    let imported = service
        .import_document(ImportDocumentInput {
            trip_id: trip.id.clone(),
            kind: DocumentKind::Email,
            label: None,
            content: raw_email.to_owned(),
        })
        .expect("import email");

    // A candidate was extracted from the email body.
    assert!(!imported.candidates.is_empty());
    // Stored as a normal body kind (never Email), with the email subject as
    // the default label and the headers stripped from the stored body.
    assert_eq!(imported.document.kind, DocumentKind::PastedText);
    assert_eq!(imported.document.label, "Flight SFO to NRT");
    assert!(!imported.document.label.contains("airline@example.com"));

    cleanup_database(database);
}

#[test]
fn oversized_raw_email_is_rejected_before_it_is_parsed() {
    let database = temp_database("email-too-large");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // Raw email past the 1,000,000-char cap: rejected up front so the MIME
    // walker never sees a hostile payload.
    let huge = format!("Content-Type: text/plain\r\n\r\n{}", "x".repeat(1_100_000));
    let error = service
        .import_document(ImportDocumentInput {
            trip_id: trip.id,
            kind: DocumentKind::Email,
            label: None,
            content: huge,
        })
        .expect_err("too large");
    assert_eq!(error.code, ErrorCode::DocumentTooLarge);
    cleanup_database(database);
}

#[test]
fn unconfirm_fact_returns_linked_candidate_to_pending() {
    let database = temp_database("unconfirm");
    let service = open_test_service(&database).expect("service");
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
    let service = open_test_service(&database).expect("service");
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
    let service = open_test_service(&database).expect("service");
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
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let imported = service
        .import_document(ImportDocumentInput {
            trip_id: trip.id.clone(),
            kind: DocumentKind::PastedText,
            label: Some("Hotel email".to_owned()),
            content: "The airport shuttle leaves every 30 minutes.\nConfirmation SHTL77".to_owned(),
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
    assert!(hits.iter().any(
        |hit| hit.source == SearchHitSource::Document && hit.record_id == imported.document.id
    ));
    assert!(
        hits.iter()
            .any(|hit| hit.source == SearchHitSource::ConfirmedFact)
    );
    let workspace_hits = service
        .search_workspace("Shuttle Side Inn")
        .expect("workspace");
    assert!(
        workspace_hits
            .iter()
            .any(|hit| hit.source == WorkspaceSearchSource::ConfirmedFact)
    );
    assert!(
        service
            .search_workspace("propertyName")
            .expect("product field query")
            .is_empty(),
        "contract field names are not searchable content"
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
fn migration_v4_carries_a_legacy_uk_snapshot_into_the_advisory_panel() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(
            r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
               INSERT INTO trips (id) VALUES ('trip-1');
               CREATE TABLE travel_advice_snapshots (
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
               INSERT INTO travel_advice_snapshots VALUES (
                   'trip-1', 'japan', 'Japan',
                   'https://www.gov.uk/foreign-travel-advice/japan',
                   'FCDO travel advice for Japan.',
                   '["avoid_all_travel_to_parts"]',
                   '2026-06-30T11:02:00.000+01:00',
                   'Latest update: typhoon season.',
                   '2026-07-10T12:00:00Z'
               );
               PRAGMA user_version = 3;"#,
        )
        .expect("legacy shape");

    migrate(&connection).expect("migrate to v4");
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );

    let legacy_tables: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table'
             AND name = 'travel_advice_snapshots'",
            [],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(legacy_tables, 0, "the legacy table is dropped once copied");

    let panel = load_advisory_panel(&connection, "trip-1")
        .expect("load")
        .expect("the migrated panel exists");
    assert_eq!(panel.country_slug, "japan");
    assert_eq!(panel.country_name, "Japan");
    assert_eq!(panel.entries.len(), 1);
    let uk = &panel.entries[0];
    assert_eq!(uk.source, AdvisorySource::UkFcdo);
    assert_eq!(uk.summary, "FCDO travel advice for Japan.");
    assert_eq!(uk.level_label.as_deref(), Some("avoid_all_travel_to_parts"));
    assert_eq!(
        uk.change_description.as_deref(),
        Some("Latest update: typhoon season.")
    );
    assert_eq!(uk.attribution, "Open Government Licence v3.0");
    assert_eq!(uk.language, "en");
    assert_eq!(uk.retrieved_at, "2026-07-10T12:00:00Z");
    assert!(panel.health_notices.is_empty());
    // A migrated row is not the result of any fetch attempt, so it claims
    // no per-source state: the entry's own retrieved_at carries the truth.
    assert!(panel.source_status.is_empty());
    assert_eq!(panel.retrieved_at, "2026-07-10T12:00:00Z");
}

#[test]
fn advisory_panel_roundtrips_every_source_verbatim() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(
            "CREATE TABLE trips (id TEXT PRIMARY KEY);
             INSERT INTO trips VALUES ('trip-1');
             PRAGMA user_version = 3;",
        )
        .expect("trips");
    migrate(&connection).expect("migrate");

    let entry = |source, name: &str, rank| AdvisoryEntry {
        source,
        source_name: name.to_owned(),
        country_name: "Japan".to_owned(),
        level_label: Some("Level".to_owned()),
        level_rank: rank,
        summary: "Summary.".to_owned(),
        source_url: "https://example.invalid/japan".to_owned(),
        source_updated_at: Some("2026-07-16T00:00:00Z".to_owned()),
        change_description: None,
        language: "en".to_owned(),
        attribution: "Attribution".to_owned(),
        retrieved_at: "2026-07-17T12:00:00Z".to_owned(),
    };
    for (source, name, rank) in [
        (
            AdvisorySource::UkFcdo,
            "UK Foreign, Commonwealth & Development Office",
            None,
        ),
        (AdvisorySource::UsState, "U.S. Department of State", Some(1)),
        (
            AdvisorySource::CaGac,
            "Government of Canada — Global Affairs Canada",
            Some(0),
        ),
        (AdvisorySource::DeAa, "Auswärtiges Amt (Germany)", Some(2)),
    ] {
        store_advisory_entry(&connection, "trip-1", &entry(source, name, rank)).expect("store");
    }
    let notices = vec![HealthNotice {
        title: "Level 1 - Measles in Japan".to_owned(),
        url: "https://wwwnc.cdc.gov/travel/notices/level1/measles-japan".to_owned(),
        level_label: Some("Level 1".to_owned()),
        published_at: Some("Thu, 25 Jun 2026 04:00:00 GMT".to_owned()),
        summary: "There is an outbreak of measles.".to_owned(),
    }];
    let statuses = vec![
        SourceStatus {
            source: AdvisorySource::UkFcdo,
            state: SourceState::Fresh,
        },
        SourceStatus {
            source: AdvisorySource::CaGac,
            state: SourceState::Kept,
        },
    ];
    store_advisory_panel_meta(
        &connection,
        "trip-1",
        "japan",
        "Japan",
        &notices,
        &statuses,
        "2026-07-17T12:00:00Z",
    )
    .expect("store panel");

    let panel = load_advisory_panel(&connection, "trip-1")
        .expect("load")
        .expect("panel");
    // Entries come back in fixed source order, never feed order.
    assert_eq!(
        panel.entries.iter().map(|e| e.source).collect::<Vec<_>>(),
        vec![
            AdvisorySource::UkFcdo,
            AdvisorySource::UsState,
            AdvisorySource::CaGac,
            AdvisorySource::DeAa,
        ]
    );
    assert_eq!(panel.health_notices, notices);
    assert_eq!(panel.source_status, statuses);
    assert_eq!(panel.entries[1].level_rank, Some(1));

    // Storing the same source twice replaces rather than duplicates.
    store_advisory_entry(
        &connection,
        "trip-1",
        &entry(AdvisorySource::UkFcdo, "UK", None),
    )
    .expect("replace");
    let panel = load_advisory_panel(&connection, "trip-1")
        .expect("load")
        .expect("panel");
    assert_eq!(panel.entries.len(), 4);
    assert_eq!(panel.entries[0].source_name, "UK");

    delete_advisory_entry(&connection, "trip-1", AdvisorySource::DeAa).expect("delete");
    let panel = load_advisory_panel(&connection, "trip-1")
        .expect("load")
        .expect("panel");
    assert_eq!(panel.entries.len(), 3);

    assert!(
        load_advisory_panel(&connection, "trip-missing")
            .expect("load")
            .is_none()
    );
}

#[test]
fn fetch_advisories_stores_each_source_and_keeps_the_last_good_copy() {
    use std::sync::atomic::{AtomicBool, Ordering};

    struct RoutedFetcher {
        fail_canada: AtomicBool,
        calls: std::sync::Mutex<Vec<String>>,
    }
    impl AdviceFetcher for RoutedFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            self.calls.lock().expect("lock").push(url.to_owned());
            if url.contains("gov.uk") {
                return Ok(r#"{"description": "FCDO travel advice for Japan.",
                    "public_updated_at": "2026-06-30T11:02:00.000+01:00",
                    "details": {"alert_status": [], "change_description": "Latest update: typhoon season."}}"#.to_owned());
            }
            if url.contains("cadataapi.state.gov") {
                return Ok(r#"[{"Title": "Japan - Level 1: Exercise Normal Precautions",
                    "Link": "https://travel.state.gov/japan", "Category": ["JA"],
                    "Summary": "<p>Exercise normal precautions in <b>Japan</b>.</p>",
                    "Published": "2025-05-14T20:00:00-04:00", "Updated": "2025-05-14T20:00:00-04:00"}]"#.to_owned());
            }
            if url.contains("data.international.gc.ca") {
                if self.fail_canada.load(Ordering::SeqCst) {
                    return Err(AppError::new(ErrorCode::AdviceFetchFailed, "network down"));
                }
                return Ok(
                    r#"{"data": {"JP": {"country-iso": "JP", "country-eng": "Japan",
                    "advisory-state": 0, "date-published": {"asp": "2026-07-16T12:53:48.9-04:00"},
                    "eng": {"name": "Japan", "url-slug": "japan",
                            "advisory-text": "Exercise normal security precautions"}}}}"#
                        .to_owned(),
                );
            }
            if url.contains("auswaertiges-amt.de") {
                return Ok(r#"{"response": {"lastModified": 1757063288,
                    "213032": {"lastModified": 1783430993, "effective": 1783431000,
                    "title": "Japan: Reise- und Sicherheitshinweise", "countryCode": "JP",
                    "iso3CountryCode": "JPN", "countryName": "Japan", "warning": false,
                    "partialWarning": true, "situationWarning": false,
                    "situationPartWarning": false}}}"#
                    .to_owned());
            }
            if url.contains("wwwnc.cdc.gov") {
                return Ok(r#"<rss version="2.0"><channel><title>CDC</title><item>
                    <title>Level 1 - Measles in Japan</title>
                    <description><![CDATA[There is an outbreak of measles in Japan.]]></description>
                    <link>https://wwwnc.cdc.gov/travel/notices/level1/measles-japan</link>
                    <pubDate>Thu, 25 Jun 2026 04:00:00 GMT</pubDate></item></channel></rss>"#
                    .to_owned());
            }
            Err(AppError::new(
                ErrorCode::AdviceFetchFailed,
                "unexpected url",
            ))
        }
    }

    let database = temp_database("advisories");
    let fetcher = Arc::new(RoutedFetcher {
        fail_canada: AtomicBool::new(false),
        calls: std::sync::Mutex::new(Vec::new()),
    });
    let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // An unknown slug is rejected before any fetch happens.
    assert_eq!(
        service
            .fetch_advisories(&trip.id, "atlantis")
            .expect_err("unknown slug")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    assert!(fetcher.calls.lock().expect("lock").is_empty());

    let panel = service.fetch_advisories(&trip.id, "japan").expect("panel");
    assert_eq!(panel.country_name, "Japan");
    assert_eq!(
        panel.entries.iter().map(|e| e.source).collect::<Vec<_>>(),
        vec![
            AdvisorySource::UkFcdo,
            AdvisorySource::UsState,
            AdvisorySource::CaGac,
            AdvisorySource::DeAa
        ]
    );
    assert!(
        panel
            .source_status
            .iter()
            .all(|s| s.state == SourceState::Fresh)
    );
    assert_eq!(panel.health_notices.len(), 1);
    assert_eq!(
        panel.health_notices[0].level_label.as_deref(),
        Some("Level 1")
    );
    // The German card keeps its own language and its own words.
    let german = panel
        .entries
        .iter()
        .find(|e| e.source == AdvisorySource::DeAa)
        .expect("de");
    assert_eq!(german.language, "de");
    assert_eq!(german.level_label.as_deref(), Some("Teilreisewarnung"));

    // The panel persists and surfaces on the trip detail.
    let detail = service.get_trip(&trip.id).expect("detail");
    assert_eq!(
        detail.advisory_panel.expect("stored panel").entries.len(),
        4
    );

    // Canada now fails: its last good copy is kept and labelled as kept.
    fetcher.fail_canada.store(true, Ordering::SeqCst);
    let panel = service
        .fetch_advisories(&trip.id, "japan")
        .expect("panel despite CA failure");
    assert_eq!(
        panel.entries.len(),
        4,
        "the kept Canadian entry is still shown"
    );
    let canada = panel
        .entries
        .iter()
        .find(|e| e.source == AdvisorySource::CaGac)
        .expect("ca");
    assert_eq!(
        canada.level_label.as_deref(),
        Some("Exercise normal security precautions")
    );
    let state = |source| {
        panel
            .source_status
            .iter()
            .find(|s| s.source == source)
            .expect("status")
            .state
    };
    assert_eq!(state(AdvisorySource::CaGac), SourceState::Kept);
    assert_eq!(state(AdvisorySource::UkFcdo), SourceState::Fresh);

    // A destination edit still invalidates the whole panel.
    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: None,
                origin: None,
                destination: Some("Oslo".to_owned()),
                start_date: None,
                end_date: None,
            },
        )
        .expect("destination edit");
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail after destination edit")
            .advisory_panel
            .is_none()
    );

    // The curated country list still backs the picker.
    assert!(
        service
            .list_advice_countries()
            .iter()
            .any(|country| country.slug == "japan")
    );
    cleanup_database(database);
}

#[test]
fn fetch_advisories_reports_a_government_that_does_not_publish_and_a_total_failure() {
    struct SilentFetcher {
        fail_everything: std::sync::atomic::AtomicBool,
    }
    impl AdviceFetcher for SilentFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            if self
                .fail_everything
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return Err(AppError::new(ErrorCode::AdviceFetchFailed, "offline"));
            }
            if url.contains("gov.uk") {
                return Ok(r#"{"description": "FCDO travel advice for the USA."}"#.to_owned());
            }
            // Every other government publishes nothing about the USA.
            if url.contains("cadataapi.state.gov") {
                return Ok("[]".to_owned());
            }
            if url.contains("data.international.gc.ca") {
                return Ok(r#"{"data": {}}"#.to_owned());
            }
            if url.contains("auswaertiges-amt.de") {
                return Ok(r#"{"response": {"lastModified": 1757063288}}"#.to_owned());
            }
            Ok(r#"<rss version="2.0"><channel><title>CDC</title></channel></rss>"#.to_owned())
        }
    }

    let database = temp_database("advisories_absent");
    let fetcher = Arc::new(SilentFetcher {
        fail_everything: std::sync::atomic::AtomicBool::new(false),
    });
    let service = open_test_service_with_fetcher(&database, fetcher).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let panel = service.fetch_advisories(&trip.id, "usa").expect("panel");
    assert_eq!(
        panel.entries.len(),
        1,
        "only the UK publishes advice about the USA"
    );
    assert_eq!(panel.entries[0].source, AdvisorySource::UkFcdo);
    let state = |source| {
        panel
            .source_status
            .iter()
            .find(|s| s.source == source)
            .expect("status")
            .state
    };
    assert_eq!(state(AdvisorySource::UsState), SourceState::NotPublished);
    assert_eq!(state(AdvisorySource::CaGac), SourceState::NotPublished);
    assert_eq!(state(AdvisorySource::DeAa), SourceState::NotPublished);

    // Everything failing with nothing stored is an honest error, not an
    // empty panel that reads as "no government has anything to say".
    let database2 = temp_database("advisories_offline");
    let fetcher2 = Arc::new(SilentFetcher {
        fail_everything: std::sync::atomic::AtomicBool::new(true),
    });
    let service2 = open_test_service_with_fetcher(&database2, fetcher2).expect("service");
    let trip2 = service2.create_trip(valid_trip_input()).expect("trip");
    assert_eq!(
        service2
            .fetch_advisories(&trip2.id, "japan")
            .expect_err("all sources down")
            .code,
        ErrorCode::AdviceFetchFailed
    );
    assert!(
        service2
            .get_trip(&trip2.id)
            .expect("detail")
            .advisory_panel
            .is_none(),
        "a total failure leaves the database untouched"
    );
    cleanup_database(database);
    cleanup_database(database2);
}

/// The forecast is what the click is for; normals, air quality and alerts
/// are extras hung off the same click. This pins both halves: they arrive
/// when the sources answer, and their absence never costs the forecast.
fn weather_bodies(url: &str, country_code: &str) -> Option<String> {
    if url.contains("geocoding-api.open-meteo.com") {
        return Some(format!(
            r#"{{ "results": [ {{ "name": "Kyoto", "latitude": 35.02107,
                "longitude": 135.75385, "country": "Japan", "admin1": "Kyoto",
                "country_code": "{country_code}" }} ] }}"#
        ));
    }
    if url.contains("api.open-meteo.com/v1/forecast") {
        return Some(
            r#"{ "daily": {
                "time": ["2027-04-01", "2027-04-02"],
                "weather_code": [0, 61],
                "temperature_2m_max": [18.4, 15.1],
                "temperature_2m_min": [9.2, 8.7],
                "precipitation_probability_max": [5, 80]
            } }"#
                .to_owned(),
        );
    }
    if url.contains("archive-api.open-meteo.com") {
        return Some(
            r#"{ "daily": {
                "time": ["2025-04-01","2025-04-02","2026-04-01","2026-04-02"],
                "temperature_2m_max": [17.0, 19.0, 18.0, 20.0],
                "temperature_2m_min": [7.0, 9.0, 8.0, 10.0],
                "precipitation_sum": [0.0, 4.0, 0.0, 0.0]
            } }"#
                .to_owned(),
        );
    }
    if url.contains("air-quality-api.open-meteo.com") {
        return Some(
            r#"{ "daily": {"time": ["2027-04-01"], "uv_index_max": [6.5]},
                 "hourly": {"time": ["2027-04-01T12:00"], "us_aqi": [42], "pm2_5": [8.1]} }"#
                .to_owned(),
        );
    }
    if url.contains("api.weather.gov") {
        return Some(
            r#"{"features": [{"properties": {"id": "urn:oid:9", "event": "Flood Watch",
                "severity": "Severe", "headline": "Flood Watch", "areaDesc": "Davidson, TN",
                "senderName": "NWS Nashville", "status": "Actual"}}]}"#
                .to_owned(),
        );
    }
    None
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
            weather_bodies(url, "JP")
                .ok_or_else(|| AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
        }
    }

    let database = temp_database("weather");
    let fetcher = Arc::new(RoutedFetcher {
        calls: std::sync::Mutex::new(Vec::new()),
    });
    let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service.fetch_weather(&trip.id).expect("snapshot");
    assert_eq!(snapshot.place_name, "Kyoto");
    assert_eq!(snapshot.place_region, "Kyoto, Japan");
    assert_eq!(snapshot.days.len(), 2);
    // Trip runs 2027-04-01..10 but the horizon covered only two days.
    assert_eq!(snapshot.coverage, WeatherCoverage::Partial);

    // The extra layers ride the same click.
    let normals = snapshot.normals.as_ref().expect("normals");
    assert_eq!(normals.sample_days, 4);
    assert_eq!(normals.years_sampled, 2);
    assert_eq!(normals.avg_high_c, 18.5);
    assert_eq!(snapshot.air_quality.len(), 1);
    assert_eq!(snapshot.air_quality[0].uv_index_max, Some(6.5));
    assert_eq!(snapshot.air_quality[0].us_aqi_max, Some(42));

    let calls = fetcher.calls.lock().expect("lock").clone();
    assert!(calls[0].contains("geocoding-api.open-meteo.com"));
    assert!(calls[0].contains("name=Kyoto"));
    assert!(calls[1].contains("api.open-meteo.com/v1/forecast"));
    assert!(calls[1].contains("latitude=35.02107"));
    assert!(
        calls
            .iter()
            .any(|url| url.contains("archive-api.open-meteo.com"))
    );
    assert!(
        calls
            .iter()
            .any(|url| url.contains("air-quality-api.open-meteo.com"))
    );
    // Kyoto is not in the United States, so the NWS is never asked at all —
    // an empty alert list abroad means "not covered", not "all clear".
    assert!(
        !calls.iter().any(|url| url.contains("api.weather.gov")),
        "the NWS covers the US only and must not be called for {}",
        snapshot.place_region
    );
    assert!(snapshot.alerts.is_empty());

    // Persists and rides on the trip detail.
    let detail = service.get_trip(&trip.id).expect("detail");
    let stored = detail.weather.expect("stored weather");
    assert_eq!(stored.days[1].description, "Light rain");
    assert_eq!(stored.days[1].precipitation_chance_pct, Some(80.0));
    assert_eq!(stored.normals.expect("stored normals").sample_days, 4);
    assert_eq!(stored.air_quality.len(), 1);
    // Derived from the stored evidence, without another fetch.
    assert!(
        !detail.packing_list.is_empty(),
        "a stored outlook should imply at least one suggestion"
    );

    // Cosmetic edits retain the snapshot, but place/window edits must not
    // leave weather for the old trip attached to the updated trip.
    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: Some("Renamed journey".to_owned()),
                origin: None,
                destination: None,
                start_date: None,
                end_date: None,
            },
        )
        .expect("rename");
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail after rename")
            .weather
            .is_some()
    );
    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: None,
                origin: None,
                destination: Some("Oslo".to_owned()),
                start_date: None,
                end_date: None,
            },
        )
        .expect("destination edit");
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail after destination edit")
            .weather
            .is_none()
    );
    cleanup_database(database);
}

#[test]
fn a_us_destination_gets_alerts_and_a_dead_layer_never_costs_the_forecast() {
    struct PickyFetcher {
        calls: std::sync::Mutex<Vec<String>>,
    }
    impl AdviceFetcher for PickyFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            self.calls.lock().expect("lock").push(url.to_owned());
            // The archive is down and the air-quality body is garbage.
            if url.contains("archive-api.open-meteo.com") {
                return Err(AppError::new(ErrorCode::WeatherFetchFailed, "down"));
            }
            if url.contains("air-quality-api.open-meteo.com") {
                return Ok("<html>502</html>".to_owned());
            }
            weather_bodies(url, "US")
                .ok_or_else(|| AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
        }
    }

    let database = temp_database("weather_us");
    let fetcher = Arc::new(PickyFetcher {
        calls: std::sync::Mutex::new(Vec::new()),
    });
    let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service
        .fetch_weather(&trip.id)
        .expect("the forecast survives");
    // The thing the user clicked for is still here...
    assert_eq!(snapshot.days.len(), 2);
    // ...and the two broken layers are simply absent rather than fatal.
    assert!(snapshot.normals.is_none());
    assert!(snapshot.air_quality.is_empty());
    // The US destination reached the NWS.
    let calls = fetcher.calls.lock().expect("lock").clone();
    assert!(
        calls
            .iter()
            .any(|url| url.contains("api.weather.gov/alerts/active?point="))
    );
    assert_eq!(snapshot.alerts.len(), 1);
    assert_eq!(snapshot.alerts[0].event, "Flood Watch");
    assert_eq!(
        snapshot.alerts[0].url,
        "https://api.weather.gov/alerts/urn:oid:9"
    );
    cleanup_database(database);
}

#[test]
fn migration_v5_keeps_a_pre_layer_weather_row() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(
            r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
               INSERT INTO trips (id) VALUES ('trip-1');
               CREATE TABLE weather_snapshots (
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
               INSERT INTO weather_snapshots VALUES (
                   'trip-1', 'Kyoto', 'Kyoto, Japan', 35.0, 135.8, '[]', 'none',
                   'https://open-meteo.com/', '2026-07-10T12:00:00Z'
               );
               PRAGMA user_version = 4;"#,
        )
        .expect("pre-v5 shape");

    migrate(&connection).expect("migrate to v5");
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );

    // The stored outlook is still true; it just carries no extra layers
    // until the next fetch.
    let stored = fetch_weather_snapshot(&connection, "trip-1")
        .expect("load")
        .expect("row survived");
    assert_eq!(stored.place_name, "Kyoto");
    assert_eq!(stored.retrieved_at, "2026-07-10T12:00:00Z");
    assert!(stored.normals.is_none());
    assert!(stored.air_quality.is_empty());
    assert!(stored.alerts.is_empty());
}

/// The facts card fetches once: a geocode (name, coords, country, tz) and
/// the ECB rates. From that it derives country facts and per-day sun/moon,
/// none of which is re-fetched. A rate-source failure still keeps the rest.
fn facts_geocode_body(country_code: &str, timezone: &str) -> String {
    format!(
        r#"{{ "results": [ {{ "name": "Kyoto", "latitude": 35.0116,
            "longitude": 135.7681, "country": "Japan", "admin1": "Kyoto",
            "country_code": "{country_code}", "timezone": "{timezone}" }} ] }}"#
    )
}

/// A geocoding body for the trip origin "Chicago" (America/Chicago).
fn chicago_geocode_body() -> String {
    r#"{ "results": [ { "name": "Chicago", "latitude": 41.85,
        "longitude": -87.65, "country": "United States", "admin1": "Illinois",
        "country_code": "US", "timezone": "America/Chicago" } ] }"#
        .to_owned()
}

/// Routes the destination geocode (name=Kyoto) to Japan and every other
/// geocode (the origin) to Chicago, plus the ECB feed.
/// The standard destination-facts routing: Kyoto as the destination,
/// Chicago as the origin, and the ECB rate feed. Routes match in
/// registration order, so the Kyoto geocode is declared before the general
/// one that stands in for the origin.
fn routed_facts_fetcher() -> FakeFetcher {
    FakeFetcher::new()
        .route("name=Kyoto", &facts_geocode_body("JP", "Asia/Tokyo"))
        .route("geocoding-api.open-meteo.com", &chicago_geocode_body())
        .route("ecb.europa.eu", ECB_BODY)
}

const ECB_BODY: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
 xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time='2026-07-17'>
<Cube currency='USD' rate='1.1435'/>
<Cube currency='JPY' rate='185.65'/>
<Cube currency='GBP' rate='0.85098'/>
  </Cube></Cube>
</gesmes:Envelope>"#;

#[test]
fn fetch_destination_facts_stores_place_rates_and_derives_facts_and_astro() {
    use voyalier_core::{PolarState, cross_rate};

    struct RoutedFetcher {
        calls: std::sync::Mutex<Vec<String>>,
    }
    impl AdviceFetcher for RoutedFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            self.calls.lock().expect("lock").push(url.to_owned());
            if url.contains("geocoding-api.open-meteo.com") {
                return Ok(facts_geocode_body("JP", "Asia/Tokyo"));
            }
            if url.contains("ecb.europa.eu") {
                return Ok(ECB_BODY.to_owned());
            }
            Err(AppError::new(
                ErrorCode::WeatherFetchFailed,
                "unexpected url",
            ))
        }
    }

    let database = temp_database("facts");
    let fetcher = Arc::new(RoutedFetcher {
        calls: std::sync::Mutex::new(Vec::new()),
    });
    let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
    assert_eq!(snapshot.place_name, "Kyoto");
    assert_eq!(snapshot.country_code, "JP");
    // Asia/Tokyo is UTC+9 all year, so the offset is 540 minutes.
    assert_eq!(snapshot.utc_offset_minutes, 540);
    assert_eq!(snapshot.rate_date, "2026-07-17");
    // The rates round-trip and convert: 1 USD ≈ 162.35 JPY via EUR.
    let usd_jpy = cross_rate(&snapshot.currency_rates, "USD", "JPY").expect("usd->jpy");
    assert!((usd_jpy - 162.35).abs() < 0.1, "{usd_jpy}");

    let calls = fetcher.calls.lock().expect("lock").clone();
    assert!(
        calls
            .iter()
            .any(|url| url.contains("geocoding-api.open-meteo.com"))
    );
    assert!(calls.iter().any(|url| url.contains("ecb.europa.eu")));

    // The detail derives the country facts (bundled) and the sun/moon days
    // (computed) from the stored snapshot — no second fetch.
    let detail = service.get_trip(&trip.id).expect("detail");
    assert_eq!(detail.destination_facts.expect("stored").country_code, "JP");
    let facts = detail.country_facts.expect("resolved facts");
    assert_eq!(facts.currency_code, "JPY");
    assert_eq!(facts.voltage_v, 100);
    assert!(facts.drives_on_left);
    assert!(
        !detail.astro.is_empty(),
        "astro derived for the trip window"
    );
    let first = &detail.astro[0];
    assert_eq!(first.polar, PolarState::Normal);
    assert!(first.sunrise.is_some());
    // The nearest airports fall out of the same stored coordinates.
    assert!(!detail.nearest_airports.is_empty(), "airports derived");
    assert_eq!(detail.nearest_airports[0].iata, "ITM");
    // As do the World Heritage sites near the destination.
    assert!(!detail.world_heritage.is_empty(), "heritage derived");
    assert_eq!(
        detail.world_heritage[0].name,
        "Historic Monuments of Ancient Kyoto"
    );
    // And a tipping note, resolved from the country code (Japan: no tipping).
    assert!(
        detail
            .tipping
            .as_deref()
            .expect("tipping")
            .to_lowercase()
            .contains("not customary")
    );

    // A destination edit invalidates the facts, like weather and advice.
    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: None,
                origin: None,
                destination: Some("Oslo".to_owned()),
                start_date: None,
                end_date: None,
            },
        )
        .expect("destination edit");
    let after = service.get_trip(&trip.id).expect("detail after edit");
    assert!(after.destination_facts.is_none());
    assert!(after.astro.is_empty());
    assert!(after.nearest_airports.is_empty());
    assert!(after.world_heritage.is_empty());
    cleanup_database(database);
}

#[test]
fn facts_degrade_when_the_rate_source_is_down_and_are_absent_for_uncovered_countries() {
    // A country with no bundled facts (Antarctica) and no tz, and a rate
    // feed that is down.
    let fetcher = FakeFetcher::new()
        .route(
            "geocoding-api.open-meteo.com",
            &facts_geocode_body("AQ", ""),
        )
        .route_fail("ecb.europa.eu", ErrorCode::WeatherFetchFailed, "rates down");

    let database = temp_database("facts_degraded");
    let service = open_test_service_with_fetcher(&database, Arc::new(fetcher)).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // The rate feed is down, but the geocode succeeded: the snapshot is
    // still worth storing, just with no rates.
    let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
    assert!(snapshot.currency_rates.is_empty());
    assert_eq!(snapshot.rate_date, "");
    // An unknown timezone leaves the offset at UTC rather than guessing.
    assert_eq!(snapshot.utc_offset_minutes, 0);

    let detail = service.get_trip(&trip.id).expect("detail");
    // Antarctica has no bundled facts, so the card shows none — but astro
    // still computes from coordinates alone.
    assert!(detail.country_facts.is_none());
    assert!(!detail.astro.is_empty());
    cleanup_database(database);
}

#[test]
fn migration_v6_keeps_a_database_without_a_facts_table() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(
            r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
               INSERT INTO trips (id) VALUES ('trip-1');
               PRAGMA user_version = 5;"#,
        )
        .expect("pre-v6 shape");

    migrate(&connection).expect("migrate to v6");
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );
    // The table now exists and a trip with no facts loads as None.
    assert!(
        load_destination_facts_snapshot(&connection, "trip-1")
            .expect("load")
            .is_none()
    );
}

#[test]
fn fetch_destination_facts_resolves_origin_for_a_time_difference() {
    let database = temp_database("facts_timediff");
    let service = open_test_service_with_fetcher(&database, Arc::new(routed_facts_fetcher()))
        .expect("service");
    // valid_trip_input: origin Chicago, destination Kyoto, start 2027-04-01.
    // Chicago is CDT (−300) that day, Tokyo +540 → 840 min ahead.
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
    assert_eq!(snapshot.origin_place.as_deref(), Some("Chicago"));
    assert_eq!(snapshot.origin_utc_offset_minutes, Some(-300));

    let detail = service.get_trip(&trip.id).expect("detail");
    let diff = detail.time_difference.expect("time difference derived");
    assert_eq!(diff.origin_place, "Chicago");
    assert_eq!(diff.offset_minutes, 840);
    cleanup_database(database);
}

#[test]
fn an_unresolvable_origin_yields_no_time_difference() {
    // The destination geocodes; the origin matches nothing on the map.
    let empty_origin_fetcher = || {
        FakeFetcher::new()
            .route("name=Kyoto", &facts_geocode_body("JP", "Asia/Tokyo"))
            .route("geocoding-api.open-meteo.com", r#"{ "results": [] }"#)
            .route("ecb.europa.eu", ECB_BODY)
    };

    let database = temp_database("facts_no_origin");
    let service = open_test_service_with_fetcher(&database, Arc::new(empty_origin_fetcher()))
        .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
    // The destination still resolves; only the time difference is absent.
    assert_eq!(snapshot.place_name, "Kyoto");
    assert_eq!(snapshot.origin_place, None);
    assert_eq!(snapshot.origin_utc_offset_minutes, None);
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail")
            .time_difference
            .is_none()
    );
    cleanup_database(database);
}

#[test]
fn editing_the_origin_invalidates_the_facts_snapshot() {
    let database = temp_database("facts_origin_edit");
    let service = open_test_service_with_fetcher(&database, Arc::new(routed_facts_fetcher()))
        .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service.fetch_destination_facts(&trip.id).expect("snapshot");
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail")
            .time_difference
            .is_some()
    );

    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: None,
                origin: Some("Denver".to_owned()),
                destination: None,
                start_date: None,
                end_date: None,
            },
        )
        .expect("origin edit");

    let after = service.get_trip(&trip.id).expect("detail after edit");
    // The snapshot's time difference was measured from the old home, so the
    // whole facts snapshot is invalidated on an origin change.
    assert!(after.destination_facts.is_none());
    assert!(after.time_difference.is_none());
    cleanup_database(database);
}

#[test]
fn migration_v7_adds_origin_columns_to_the_facts_table() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(
            r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
               CREATE TABLE destination_facts_snapshots (
                 trip_id TEXT PRIMARY KEY,
                 place_name TEXT NOT NULL,
                 place_region TEXT NOT NULL,
                 latitude REAL NOT NULL,
                 longitude REAL NOT NULL,
                 utc_offset_minutes INTEGER NOT NULL,
                 country_code TEXT NOT NULL,
                 rate_date TEXT NOT NULL,
                 currency_rates TEXT NOT NULL DEFAULT '[]',
                 retrieved_at TEXT NOT NULL);
               PRAGMA user_version = 6;"#,
        )
        .expect("pre-v7 shape");

    migrate(&connection).expect("migrate to v7");
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );
    let columns: Vec<String> = {
        let mut statement = connection
            .prepare("PRAGMA table_info(destination_facts_snapshots)")
            .expect("table_info");
        statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("columns")
            .collect::<rusqlite::Result<Vec<String>>>()
            .expect("collect")
    };
    assert!(columns.iter().any(|c| c == "origin_place"));
    assert!(columns.iter().any(|c| c == "origin_utc_offset_minutes"));
}

#[test]
fn fetch_public_holidays_stores_all_years_and_filters_to_the_window() {
    // name "Kyoto", country "Japan", country_code "JP".
    let fetcher = FakeFetcher::new()
        .route(
            "geocoding-api.open-meteo.com",
            &facts_geocode_body("JP", "Asia/Tokyo"),
        )
        .route(
            "date.nager.at/api/v3/PublicHolidays/2027/JP",
            r#"[
              {"date":"2027-04-05","localName":"テスト祝日","name":"Test Holiday","global":true,"types":["Public"]},
              {"date":"2027-04-29","localName":"昭和の日","name":"Shōwa Day","global":true,"types":["Public"]}
            ]"#,
        );

    let database = temp_database("holidays");
    let service = open_test_service_with_fetcher(&database, Arc::new(fetcher)).expect("service");
    // valid_trip_input: Kyoto, 2027-04-01 .. 2027-04-10.
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service.fetch_public_holidays(&trip.id).expect("snapshot");
    assert_eq!(snapshot.country_code, "JP");
    assert_eq!(snapshot.country_name, "Japan");
    // Both fetched holidays are stored, unfiltered.
    assert_eq!(snapshot.holidays.len(), 2);

    let detail = service.get_trip(&trip.id).expect("detail");
    let panel = detail.public_holidays.expect("holidays panel");
    // Only 2027-04-05 falls inside the 04-01..04-10 window.
    assert_eq!(panel.holidays.len(), 1);
    assert_eq!(panel.holidays[0].date, "2027-04-05");
    assert_eq!(panel.holidays[0].name, "Test Holiday");
    assert_eq!(panel.country_name, "Japan");

    // Moving the window off every holiday invalidates the snapshot.
    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: None,
                origin: None,
                destination: None,
                start_date: Some("2027-06-01".to_owned()),
                end_date: Some("2027-06-10".to_owned()),
            },
        )
        .expect("date edit");
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail")
            .public_holidays
            .is_none()
    );
    cleanup_database(database);
}

#[test]
fn fetch_place_summary_stores_and_derives_on_detail() {
    let fetcher = FakeFetcher::new().route(
        "en.wikipedia.org/api/rest_v1/page/summary/Kyoto",
        r#"{"type":"standard","title":"Kyoto","description":"City in Japan",
        "extract":"Kyoto is the capital city of Kyoto Prefecture.",
        "content_urls":{"desktop":{"page":"https://en.wikipedia.org/wiki/Kyoto"}}}"#,
    );
    let database = temp_database("place_summary");
    let service = open_test_service_with_fetcher(&database, Arc::new(fetcher)).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let summary = service.fetch_place_summary(&trip.id).expect("summary");
    assert_eq!(summary.title, "Kyoto");
    assert!(summary.extract.contains("capital city"));

    let detail = service.get_trip(&trip.id).expect("detail");
    assert_eq!(
        detail.place_summary.expect("stored").url,
        "https://en.wikipedia.org/wiki/Kyoto"
    );

    // A destination edit invalidates it — it is about the old place.
    service
        .update_trip(
            &trip.id,
            UpdateTripInput {
                title: None,
                origin: None,
                destination: Some("Oslo".to_owned()),
                start_date: None,
                end_date: None,
            },
        )
        .expect("edit");
    assert!(
        service
            .get_trip(&trip.id)
            .expect("detail")
            .place_summary
            .is_none()
    );
    cleanup_database(database);
}

#[test]
fn migration_v9_adds_the_place_summaries_table() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(r#"CREATE TABLE trips (id TEXT PRIMARY KEY); PRAGMA user_version = 8;"#)
        .expect("pre-v9 shape");
    migrate(&connection).expect("migrate to v9");
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );
    assert!(
        load_place_summary(&connection, "trip-1")
            .expect("load")
            .is_none()
    );
}

#[test]
fn migration_v8_adds_the_public_holidays_table() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(r#"CREATE TABLE trips (id TEXT PRIMARY KEY); PRAGMA user_version = 7;"#)
        .expect("pre-v8 shape");
    migrate(&connection).expect("migrate to v8");
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );
    assert!(
        load_public_holidays_snapshot(&connection, "trip-1")
            .expect("load")
            .is_none()
    );
}

#[test]
fn provider_keys_live_in_the_secret_store_never_the_config_or_db() {
    use voyalier_core::ProviderId;

    // Provider config never touches the network.
    let database = temp_database("providers");
    let secrets = Arc::new(MemorySecretStore::default());
    let service = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("service");

    // Fresh: nothing has a key.
    let providers = service.list_providers().expect("list");
    assert_eq!(providers.len(), 3);
    assert!(providers.iter().all(|config| !config.has_key));

    // Set an OpenAI key: has_key flips, and the key is in the store only.
    let config = service
        .set_provider_key("openai", "  sk-fake-123  ")
        .expect("set key");
    assert!(config.has_key);
    assert_eq!(config.id, ProviderId::OpenAi);
    assert!(secrets.has("api_key.openai"));
    // The returned config must not carry the key anywhere.
    let serialized = serde_json::to_string(&config).expect("ser");
    assert!(!serialized.contains("sk-fake-123"));

    // Model is stored in the db, surfaced on the config.
    let config = service
        .set_provider_model("openai", "some-model")
        .expect("set model");
    assert_eq!(config.model.as_deref(), Some("some-model"));

    // Ollama is local and rejects a key.
    assert_eq!(
        service
            .set_provider_key("ollama", "nope")
            .expect_err("no key for ollama")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    // Empty key and unknown provider are validation errors.
    assert_eq!(
        service
            .set_provider_key("openai", "   ")
            .expect_err("empty")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    assert!(service.set_provider_key("bard", "x").is_err());

    // Clearing removes the secret; model persists.
    let config = service.clear_provider_key("openai").expect("clear");
    assert!(!config.has_key);
    assert_eq!(config.model.as_deref(), Some("some-model"));
    assert!(!secrets.has("api_key.openai"));
    cleanup_database(database);
}

#[test]
fn app_settings_kv_reads_writes_upserts_and_persists() {
    let database = temp_database("app-settings");
    let service = open_test_service(&database).expect("service");

    // Unset keys read as None.
    assert_eq!(
        service.get_app_setting("updater.consent").expect("get"),
        None
    );

    // Set then read back.
    service
        .set_app_setting("updater.consent", "yes")
        .expect("set");
    assert_eq!(
        service.get_app_setting("updater.consent").expect("get"),
        Some("yes".to_owned())
    );

    // Upsert overwrites in place (no duplicate rows, latest wins).
    service
        .set_app_setting("updater.consent", "no")
        .expect("upsert");
    assert_eq!(
        service.get_app_setting("updater.consent").expect("get"),
        Some("no".to_owned())
    );

    // A distinct key is independent.
    service
        .set_app_setting("updater.skipped_version", "0.3.1")
        .expect("set");
    assert_eq!(
        service
            .get_app_setting("updater.skipped_version")
            .expect("get"),
        Some("0.3.1".to_owned())
    );

    // Values survive a reopen (durable, unencrypted app metadata).
    drop(service);
    let reopened = open_test_service(&database).expect("reopen");
    assert_eq!(
        reopened.get_app_setting("updater.consent").expect("get"),
        Some("no".to_owned())
    );

    // Key validation: empty, bad charset, and over-long are rejected.
    assert_eq!(
        reopened.get_app_setting("  ").expect_err("empty key").code,
        ErrorCode::ValidationInvalidInput
    );
    assert_eq!(
        reopened
            .set_app_setting("bad key!", "x")
            .expect_err("bad charset")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    let long_key = "k".repeat(MAX_SETTING_KEY_LEN + 1);
    assert_eq!(
        reopened
            .set_app_setting(&long_key, "x")
            .expect_err("long key")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    // Value length is bounded too.
    let long_value = "v".repeat(MAX_SETTING_VALUE_LEN + 1);
    assert_eq!(
        reopened
            .set_app_setting("updater.consent", &long_value)
            .expect_err("long value")
            .code,
        ErrorCode::ValidationInvalidInput
    );

    cleanup_database(database);
}

#[test]
fn backup_database_snapshots_data_and_prunes_old_backups() {
    let database = temp_database("backup");
    let service = open_test_service(&database).expect("service");

    // Seed a trip so we can prove the backup captured real committed data.
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let info = service.backup_database("v0.3.0").expect("backup");
    assert_eq!(info.label, "v0.3.0");
    assert!(!info.created_at.is_empty());
    assert!(info.path.ends_with(".sqlite3"));
    let backup_path = PathBuf::from(&info.path);
    assert!(backup_path.exists(), "backup file must exist");

    // The backup is a readable SQLite copy that holds the seeded trip. Open
    // it immutable/read-only so the read never spawns -wal/-shm sidecars
    // (the copy inherits WAL mode) that would pollute the stray check below.
    let uri = format!("file:{}?immutable=1", backup_path.display());
    let reader = Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .expect("open backup");
    let count: i64 = reader
        .query_row(
            "SELECT COUNT(*) FROM trips WHERE id = ?1",
            params![trip.id],
            |row| row.get(0),
        )
        .expect("query backup");
    assert_eq!(count, 1);
    drop(reader);

    let backups_dir = database.parent().expect("parent").join("backups");
    // Retention: exceeding MAX_BACKUPS prunes the oldest to the cap, and
    // backup_database itself leaves only single .sqlite3 files (no strays).
    for n in 0..(MAX_BACKUPS + 2) {
        service
            .backup_database(&format!("v0.3.{n}"))
            .expect("extra backup");
    }
    let names: Vec<String> = fs::read_dir(&backups_dir)
        .expect("read backups")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    let snapshots = names
        .iter()
        .filter(|name| name.starts_with("pre-update-") && name.ends_with(".sqlite3"))
        .count();
    assert_eq!(
        snapshots, MAX_BACKUPS,
        "prunes down to the retention cap; saw {snapshots}: {names:?}"
    );
    assert!(
        !names
            .iter()
            .any(|name| name.ends_with("-wal") || name.ends_with("-shm")),
        "backup_database leaves no WAL/SHM strays: {names:?}"
    );

    // Label validation: empty and unsafe charsets are rejected (the label is
    // interpolated into the filename).
    assert_eq!(
        service.backup_database("  ").expect_err("empty").code,
        ErrorCode::ValidationInvalidInput
    );
    assert_eq!(
        service
            .backup_database("bad label!")
            .expect_err("charset")
            .code,
        ErrorCode::ValidationInvalidInput
    );

    cleanup_database(database);
}

#[test]
fn clear_backups_removes_every_snapshot() {
    let database = temp_database("clear-backups");
    let service = open_test_service(&database).expect("service");
    service.create_trip(valid_trip_input()).expect("trip");

    // No backups yet → nothing to clear.
    assert_eq!(service.clear_backups().expect("clear empty"), 0);

    service.backup_database("v0.3.0").expect("backup 1");
    service.backup_database("v0.3.1").expect("backup 2");
    assert_eq!(service.clear_backups().expect("clear"), 2);

    // The directory is emptied of snapshots and a second clear is a no-op.
    let backups_dir = database.parent().expect("parent").join("backups");
    let remaining = fs::read_dir(&backups_dir)
        .expect("read backups")
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("pre-update-")
        })
        .count();
    assert_eq!(remaining, 0);
    assert_eq!(service.clear_backups().expect("clear again"), 0);

    cleanup_database(database);
}

#[test]
fn exports_the_workspace_as_a_portable_encrypted_backup() {
    let database = temp_database("export-backup");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                flight_number: Some("FP18".to_owned()),
                confirmation_code: Some("SECRET-PNR".to_owned()),
                passenger_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("manual flight");

    let container = service
        .export_backup("correct horse battery staple")
        .expect("export");

    let opened = voyalier_core::open_backup("correct horse battery staple", &container)
        .expect("open the backup");
    assert_eq!(opened.manifest.schema_version, target_schema_version());
    assert_eq!(opened.manifest.format_version, BACKUP_FORMAT_VERSION);
    // Without the data key the sealed rows would be undecryptable on another
    // machine, so a backup from an active vault must carry it.
    assert!(opened.data_key.is_some(), "the vault key must ride along");
    assert!(
        opened.snapshot.starts_with(b"SQLite format 3\0"),
        "the snapshot should be the SQLite file"
    );
    // The snapshot is a real workspace, not an empty database.
    assert!(
        opened
            .snapshot
            .windows(trip.id.len())
            .any(|window| window == trip.id.as_bytes()),
        "the exported snapshot should contain the trip"
    );

    // The traveler's secrets are not readable in the exported file.
    for secret in [b"SECRET-PNR".as_slice(), b"Jamie Traveler".as_slice()] {
        assert!(
            container
                .windows(secret.len())
                .all(|window| window != secret),
            "a secret leaked into the backup in the clear"
        );
    }

    assert!(
        voyalier_core::open_backup("the wrong passphrase", &container).is_err(),
        "a wrong passphrase must not open the backup"
    );
    assert_eq!(
        service.export_backup("short").expect_err("too short").code,
        ErrorCode::ValidationInvalidInput
    );

    cleanup_database(database);
}

#[test]
fn restores_a_backup_onto_another_machine_at_the_next_launch() {
    // Workspace A — the machine being backed up.
    let database_a = temp_database("restore-source");
    let service_a = open_test_service(&database_a).expect("service a");
    let trip_a = service_a.create_trip(valid_trip_input()).expect("trip a");
    service_a
        .add_manual_fact(AddManualFactInput {
            trip_id: trip_a.id.clone(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                flight_number: Some("FP18".to_owned()),
                confirmation_code: Some("SECRET-PNR".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("fact a");
    let container = service_a
        .export_backup("correct horse battery")
        .expect("export");

    // Workspace B — a different machine: its own database and its own
    // keychain, so nothing but the container carries A's data across.
    let database_b = temp_database("restore-target");
    let secrets_b = Arc::new(MemorySecretStore::default());
    let service_b =
        AppService::open_path_with_deps(&database_b, Arc::new(UreqFetcher), secrets_b.clone())
            .expect("service b");
    let trip_b = service_b.create_trip(valid_trip_input()).expect("trip b");

    let preview = service_b
        .stage_restore("correct horse battery", &container)
        .expect("stage");
    assert_eq!(preview.schema_version, target_schema_version());

    // Staging is inert — B keeps its own data until the app restarts, so a
    // crash between staging and applying loses nothing.
    assert!(
        service_b
            .list_trips()
            .expect("trips b")
            .iter()
            .any(|summary| summary.trip.id == trip_b.id),
        "staging must not touch the live workspace"
    );

    // Restart.
    drop(service_b);
    let reopened =
        AppService::open_path_with_deps(&database_b, Arc::new(UreqFetcher), secrets_b.clone())
            .expect("reopen b");

    let trips = reopened.list_trips().expect("trips");
    assert!(
        trips.iter().any(|summary| summary.trip.id == trip_a.id),
        "A's trip should be restored onto B"
    );
    assert!(
        !trips.iter().any(|summary| summary.trip.id == trip_b.id),
        "restore replaces the workspace rather than merging into it"
    );

    // The sealed payload decrypts, which is only possible because the data
    // key travelled inside the container — B's keychain never had it.
    let detail = reopened.get_trip(&trip_a.id).expect("detail");
    assert!(
        detail
            .confirmed_facts
            .iter()
            .any(|fact| fact.payload.confirmation_code.as_deref() == Some("SECRET-PNR")),
        "the restored sealed fact should decrypt"
    );

    // B's pre-restore data is snapshotted, so a mistaken restore is reversible.
    let backups = database_b.parent().expect("parent").join("backups");
    let safety = fs::read_dir(&backups)
        .expect("backups dir")
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("pre-restore-")
        })
        .count();
    assert_eq!(safety, 1, "a pre-restore safety snapshot should exist");

    // The staging marker is consumed, so the restore does not repeat.
    assert!(!database_b.with_file_name("pending-restore.json").exists());

    cleanup_database(database_a);
    cleanup_database(database_b);
}

#[test]
fn refuses_to_stage_a_restore_it_cannot_trust() {
    let database = temp_database("restore-refused");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let container = service
        .export_backup("correct horse battery")
        .expect("export");
    let marker = database.with_file_name("pending-restore.json");

    // A wrong passphrase cannot stage anything.
    assert!(service.stage_restore("not the one", &container).is_err());
    assert!(!marker.exists(), "a failed restore must leave no marker");

    // Nor can a backup written by a newer Voyalier, whose schema this build
    // cannot migrate backwards to understand.
    let future = voyalier_core::seal_backup(
        "correct horse battery",
        &BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            schema_version: target_schema_version() + 1,
            app_version: "99.0.0".to_owned(),
            created_at: now_rfc3339(),
        },
        None,
        b"SQLite format 3\0not really",
        &[1u8; VAULT_SALT_LEN],
        &[2u8; VAULT_NONCE_LEN],
    )
    .expect("future container");
    assert!(
        service
            .stage_restore("correct horse battery", &future)
            .is_err()
    );
    assert!(!marker.exists(), "a refused restore must leave no marker");

    // The live workspace is untouched throughout.
    assert!(
        service
            .list_trips()
            .expect("trips")
            .iter()
            .any(|summary| summary.trip.id == trip.id)
    );

    cleanup_database(database);
}

#[test]
fn storage_identity_is_stable_so_dev_and_packaged_builds_share_data() {
    // These identifiers are compiled into the binary, so a source (dev)
    // build and the packaged app resolve to the SAME SQLite file and OS
    // keychain service — a user who tries Voyalier from source and later
    // installs the packaged app keeps their trips and vault key. Changing
    // either would silently orphan every existing user's data, so pin them:
    // a deliberate change must update this test in the same commit.
    assert_eq!(DATABASE_FILE, "voyalier.sqlite3");
    assert_eq!(KEYRING_SERVICE, "com.voyalier.keys");
    let dirs = ProjectDirs::from("com", "voyalier", "Voyalier").expect("project dirs");
    assert!(
        dirs.data_dir()
            .to_string_lossy()
            .to_lowercase()
            .contains("voyalier"),
        "data dir must encode the stable app identity: {:?}",
        dirs.data_dir()
    );
}

#[test]
fn detect_local_ai_reports_models_when_reachable_and_unavailable_when_not() {
    struct OllamaFetcher {
        reachable: bool,
    }
    impl AdviceFetcher for OllamaFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            assert!(url.contains("11434"));
            if self.reachable {
                Ok(
                    r#"{ "models": [ { "name": "llama3.2:latest" }, { "name": "qwen2.5:7b" } ] }"#
                        .to_owned(),
                )
            } else {
                Err(AppError::new(
                    ErrorCode::AdviceFetchFailed,
                    "connection refused",
                ))
            }
        }
    }

    let database = temp_database("local-ai-up");
    let up = open_test_service_with_fetcher(&database, Arc::new(OllamaFetcher { reachable: true }))
        .expect("service");
    let status = up.detect_local_ai();
    assert!(status.available);
    assert_eq!(status.provider, "ollama");
    assert_eq!(status.models.len(), 2);
    assert_eq!(status.models[0].name, "llama3.2:latest");
    cleanup_database(database);

    let database = temp_database("local-ai-down");
    let down =
        open_test_service_with_fetcher(&database, Arc::new(OllamaFetcher { reachable: false }))
            .expect("service");
    let status = down.detect_local_ai();
    assert!(!status.available);
    assert!(status.models.is_empty());
    cleanup_database(database);
}

#[test]
fn validate_provider_key_maps_status_and_never_stores_the_key() {
    struct StatusFetcher {
        status: Option<u16>, // None models a transport failure (offline).
    }
    impl AdviceFetcher for StatusFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Err(AppError::new(ErrorCode::AdviceFetchFailed, "n/a"))
        }
        fn get_status(&self, url: &str, headers: &[(&str, &str)]) -> Result<u16, AppError> {
            // The key rides only in the auth header, to the provider endpoint.
            assert!(url.starts_with("https://"));
            assert!(headers.iter().any(|(name, value)| {
                (*name == "Authorization" && value.contains("test-key"))
                    || (*name == "x-api-key" && *value == "test-key")
            }));
            match self.status {
                Some(code) => Ok(code),
                None => Err(AppError::new(ErrorCode::AssistFailed, "offline")),
            }
        }
    }

    // A 200 is a valid key — and validation must never persist it.
    let database = temp_database("validate-ok");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(StatusFetcher { status: Some(200) }))
            .expect("service");
    let verdict = service
        .validate_provider_key("openai", "test-key")
        .expect("verdict");
    assert_eq!(verdict.status, KeyValidationStatus::Valid);
    let openai = service
        .list_providers()
        .expect("providers")
        .into_iter()
        .find(|config| config.id == ProviderId::OpenAi)
        .expect("openai");
    assert!(!openai.has_key, "validation must not store the key");
    cleanup_database(database);

    // A 401 is an authoritative rejection (exercises the x-api-key header).
    let database = temp_database("validate-401");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(StatusFetcher { status: Some(401) }))
            .expect("service");
    assert_eq!(
        service
            .validate_provider_key("anthropic", "test-key")
            .expect("verdict")
            .status,
        KeyValidationStatus::Rejected
    );
    cleanup_database(database);

    // A reach failure is inconclusive, not a rejection; keyless is invalid input.
    let database = temp_database("validate-down");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(StatusFetcher { status: None }))
            .expect("service");
    assert_eq!(
        service
            .validate_provider_key("openai", "test-key")
            .expect("verdict")
            .status,
        KeyValidationStatus::Unreachable
    );
    assert_eq!(
        service
            .validate_provider_key("ollama", "test-key")
            .expect_err("keyless")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    cleanup_database(database);
}

#[test]
fn pull_local_model_reports_success_and_failure() {
    struct PullFetcher {
        response: Option<String>, // None models Ollama not running.
    }
    impl AdviceFetcher for PullFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Err(AppError::new(ErrorCode::AdviceFetchFailed, "n/a"))
        }
        fn post_json_long(&self, url: &str, body: &str) -> Result<String, AppError> {
            assert!(url.contains("11434/api/pull"));
            assert!(body.contains("gemma"));
            match &self.response {
                Some(response) => Ok(response.clone()),
                None => Err(AppError::new(ErrorCode::AssistFailed, "connection refused")),
            }
        }
    }

    let database = temp_database("pull-ok");
    let service = open_test_service_with_fetcher(
        &database,
        Arc::new(PullFetcher {
            response: Some(r#"{"status":"success"}"#.to_owned()),
        }),
    )
    .expect("service");
    let result = service
        .pull_local_model("gemma4:12b-it-qat")
        .expect("result");
    assert!(result.ok);
    cleanup_database(database);

    // A provider error body surfaces its reason verbatim.
    let database = temp_database("pull-err");
    let service = open_test_service_with_fetcher(
        &database,
        Arc::new(PullFetcher {
            response: Some(r#"{"error":"model not found"}"#.to_owned()),
        }),
    )
    .expect("service");
    let result = service.pull_local_model("gemma4:nope").expect("result");
    assert!(!result.ok);
    assert!(result.message.contains("model not found"));
    cleanup_database(database);

    // Ollama not running is a friendly failure, not an error the UI must decode.
    let database = temp_database("pull-down");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(PullFetcher { response: None }))
            .expect("service");
    let result = service
        .pull_local_model("gemma4:12b-it-qat")
        .expect("result");
    assert!(!result.ok);
    assert!(result.message.contains("Ollama"));
    cleanup_database(database);
}

#[test]
fn trip_brief_excludes_secrets() {
    let database = temp_database("brief");
    let service = open_test_service(&database).expect("service");
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

#[test]
fn vault_encrypts_confirmed_fact_payloads_at_rest_and_migrates_legacy_rows() {
    let database = temp_database("vault");
    let secrets = Arc::new(MemorySecretStore::default());
    let service = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("service");
    assert!(
        service.vault.is_active(),
        "memory store makes the vault active"
    );

    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                flight_number: Some("FP18".to_owned()),
                confirmation_code: Some("SECRET-PNR".to_owned()),
                passenger_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("manual flight");

    // At rest the payload is sealed: tagged, and free of the plaintext secrets.
    let raw: String = {
        let reader = Connection::open(&database).expect("reader");
        reader
            .query_row(
                "SELECT payload FROM confirmed_facts WHERE trip_id = ?1",
                params![trip.id],
                |row| row.get(0),
            )
            .expect("payload")
    };
    assert!(
        raw.starts_with("v1:"),
        "payload should be sealed, got: {raw}"
    );
    assert!(!raw.contains("SECRET-PNR"));
    assert!(!raw.contains("Jamie Traveler"));

    // Read back through the service decrypts transparently.
    let detail = service.get_trip(&trip.id).expect("detail");
    assert!(
        detail
            .confirmed_facts
            .iter()
            .any(|fact| fact.payload.confirmation_code.as_deref() == Some("SECRET-PNR"))
    );

    // The raw imported document text is sealed at rest too — it carries the
    // same secrets, so encrypting only the parsed facts would not be enough.
    service
        .import_document(ImportDocumentInput {
            trip_id: trip.id.clone(),
            kind: DocumentKind::PastedText,
            label: Some("Booking email".to_owned()),
            content: "Reservation RAWSECRET99 for guest Morgan Rivers.".to_owned(),
        })
        .expect("import");
    let raw_doc: String = {
        let reader = Connection::open(&database).expect("reader");
        reader
            .query_row(
                "SELECT raw_content FROM source_documents WHERE trip_id = ?1",
                params![trip.id],
                |row| row.get(0),
            )
            .expect("raw_content")
    };
    assert!(
        raw_doc.starts_with("v1:"),
        "raw content should be sealed, got: {raw_doc}"
    );
    assert!(!raw_doc.contains("RAWSECRET99"));
    assert!(!raw_doc.contains("Morgan Rivers"));
    // Search reads it back through the vault transparently.
    assert!(
        !service
            .search_trip(&trip.id, "RAWSECRET99")
            .expect("search")
            .is_empty()
    );

    // A legacy plaintext row is sealed by the migration on the next open.
    {
        let writer = Connection::open(&database).expect("writer");
        writer
            .execute(
                "INSERT INTO confirmed_facts
                 (id, trip_id, fact_type, payload, method, corrected_fields, confirmed_at)
                 VALUES ('legacy', ?1, 'lodging_stay', ?2, 'manual', '[]', '2027-01-01T00:00:00Z')",
                params![
                    trip.id,
                    r#"{"propertyName":"Old Inn","confirmationCode":"LEGACY9"}"#
                ],
            )
            .expect("legacy insert");
    }
    let reopened = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("reopen");
    let migrated: String = {
        let reader = Connection::open(&database).expect("reader");
        reader
            .query_row(
                "SELECT payload FROM confirmed_facts WHERE id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .expect("payload")
    };
    assert!(migrated.starts_with("v1:"), "legacy row should be sealed");
    assert!(!migrated.contains("LEGACY9"));
    // And it still reads back correctly.
    assert!(
        reopened
            .get_trip(&trip.id)
            .expect("detail")
            .confirmed_facts
            .iter()
            .any(|fact| fact.payload.confirmation_code.as_deref() == Some("LEGACY9"))
    );
    cleanup_database(database);
}

#[test]
fn optional_passphrase_locks_the_vault_and_unlock_restores_access() {
    let database = temp_database("vault-passphrase");
    let secrets = Arc::new(MemorySecretStore::default());
    let service = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("service");

    // Keychain mode to start: active, no passphrase.
    let status = service.get_vault_status().expect("status");
    assert!(status.active && !status.protected && !status.locked);

    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                confirmation_code: Some("SECRET-PNR".to_owned()),
                passenger_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("manual flight");

    // A too-short passphrase is rejected before any key is derived.
    assert_eq!(
        service
            .set_vault_passphrase("short")
            .expect_err("short")
            .code,
        ErrorCode::ValidationInvalidInput
    );

    // Setting a passphrase protects the key and removes it from the keychain,
    // but the vault stays unlocked for this session.
    let status = service
        .set_vault_passphrase("correct horse battery")
        .expect("set passphrase");
    assert!(status.active && status.protected && !status.locked);
    assert!(
        !secrets.has(VAULT_KEY_ACCOUNT),
        "the raw key must leave the keychain once a passphrase guards it"
    );
    assert_eq!(
        service
            .set_vault_passphrase("another one entirely")
            .expect_err("already set")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    // Still readable this session.
    assert!(service.get_trip(&trip.id).is_ok());

    // Reopening finds the wrapped key: the vault opens LOCKED and refuses to
    // read or write sealed data until unlocked.
    let reopened = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("reopen");
    let status = reopened.get_vault_status().expect("status");
    assert!(status.protected && status.locked && !status.active);
    assert_eq!(
        reopened.get_trip(&trip.id).expect_err("locked read").code,
        ErrorCode::VaultLocked
    );
    assert_eq!(
        reopened
            .add_manual_fact(AddManualFactInput {
                trip_id: trip.id.clone(),
                fact_type: FactType::LodgingStay,
                payload: FactPayload::default(),
            })
            .expect_err("locked write")
            .code,
        ErrorCode::VaultLocked
    );
    // list_trips only counts rows, so it still works while locked.
    assert!(reopened.list_trips().is_ok());

    // Wrong passphrase is rejected; the correct one unlocks for the session.
    assert_eq!(
        reopened
            .unlock_vault("not the passphrase")
            .expect_err("wrong")
            .code,
        ErrorCode::VaultPassphraseIncorrect
    );
    let status = reopened
        .unlock_vault("correct horse battery")
        .expect("unlock");
    assert!(status.active && status.protected && !status.locked);
    assert!(
        reopened
            .get_trip(&trip.id)
            .expect("read after unlock")
            .confirmed_facts
            .iter()
            .any(|fact| fact.payload.confirmation_code.as_deref() == Some("SECRET-PNR"))
    );

    // Removing the passphrase returns the key to the keychain (transparent
    // unlock again) and a fresh open needs no passphrase.
    let status = reopened
        .remove_vault_passphrase("correct horse battery")
        .expect("remove");
    assert!(status.active && !status.protected && !status.locked);
    assert!(secrets.has(VAULT_KEY_ACCOUNT));
    let reopened_plain = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("reopen plain");
    assert!(reopened_plain.get_vault_status().expect("status").active);
    assert!(reopened_plain.get_trip(&trip.id).is_ok());

    cleanup_database(database);
}

#[test]
fn get_today_builds_a_view_for_the_current_date() {
    let database = temp_database("today");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let view = service.get_today(&trip.id).expect("today");
    // Reference date is a YYYY-MM-DD (clock-independent structural check).
    assert_eq!(view.reference_date.len(), 10);
    assert_eq!(view.reference_date.matches('-').count(), 2);

    assert_eq!(
        service.get_today("nope").expect_err("missing").code,
        ErrorCode::TripNotFound
    );
    cleanup_database(database);
}

#[test]
fn preview_assist_excludes_secrets_and_reflects_chosen_provider_and_model() {
    let database = temp_database("assist-preview");
    let service = open_test_service(&database).expect("service");
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
    service
        .set_provider_model("openai", "gpt-x")
        .expect("set model");

    let preview = service.preview_assist(&trip.id, "openai").expect("preview");
    let serialized = serde_json::to_string(&preview).expect("serialize");
    assert!(!serialized.contains("SECRET-PNR"));
    assert!(!serialized.contains("Jamie Traveler"));
    assert!(preview.user_content.contains("FP18"));
    assert!(preview.leaves_device);
    assert_eq!(preview.model.as_deref(), Some("gpt-x"));

    // Unknown provider is a validation error; unknown trip is TripNotFound.
    assert_eq!(
        service
            .preview_assist(&trip.id, "bard")
            .expect_err("bad provider")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    assert_eq!(
        service
            .preview_assist("trip_missing", "openai")
            .expect_err("missing trip")
            .code,
        ErrorCode::TripNotFound
    );
    cleanup_database(database);
}

#[test]
fn run_assist_posts_a_redacted_request_to_ollama_and_returns_the_reply() {
    // Captures the POST so the test never needs a running Ollama.
    struct OllamaStub {
        last_body: std::sync::Mutex<String>,
    }
    impl AdviceFetcher for OllamaStub {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            panic!("assist must POST, not GET");
        }
        fn post_json(
            &self,
            url: &str,
            body: &str,
            _headers: &[(&str, &str)],
        ) -> Result<String, AppError> {
            assert_eq!(url, "http://localhost:11434/api/chat");
            *self.last_body.lock().expect("lock") = body.to_owned();
            Ok(r#"{ "message": { "role": "assistant", "content": "Your Kyoto plans look ready." } }"#
                .to_owned())
        }
    }

    let database = temp_database("run-assist");
    let stub = Arc::new(OllamaStub {
        last_body: std::sync::Mutex::new(String::new()),
    });
    let service = open_test_service_with_fetcher(&database, stub.clone()).expect("service");
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

    let reply = service.run_assist(&trip.id, "ollama").expect("reply");
    assert_eq!(reply.text, "Your Kyoto plans look ready.");
    assert_eq!(reply.model, "llama3.2");
    assert!(!reply.generated_at.is_empty());

    // The posted body carried the redacted itinerary, not the secrets.
    let body = stub.last_body.lock().expect("lock").clone();
    assert!(body.contains("FP18"));
    assert!(!body.contains("SECRET-PNR"));
    assert!(!body.contains("Jamie Traveler"));

    // The successful call was logged (metadata only).
    let activity = service.list_assist_activity(&trip.id).expect("activity");
    assert_eq!(activity.len(), 1);
    assert_eq!(activity[0].provider, ProviderId::Ollama);
    assert_eq!(activity[0].model, "llama3.2");
    cleanup_database(database);
}

#[test]
fn run_assist_sends_cloud_requests_with_the_key_only_in_the_auth_header() {
    // Captures the outgoing request; the key must ride only in the header.
    // (url, body, headers)
    type Captured = (String, String, Vec<(String, String)>);
    struct CloudStub {
        last: std::sync::Mutex<Captured>,
    }
    impl AdviceFetcher for CloudStub {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            panic!("cloud assist must POST, not GET");
        }
        fn post_json(
            &self,
            url: &str,
            body: &str,
            headers: &[(&str, &str)],
        ) -> Result<String, AppError> {
            *self.last.lock().expect("lock") = (
                url.to_owned(),
                body.to_owned(),
                headers
                    .iter()
                    .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
                    .collect(),
            );
            if url.contains("openai") {
                Ok(r#"{ "choices": [{ "message": { "content": "OpenAI reply." } }] }"#.to_owned())
            } else {
                Ok(r#"{ "content": [{ "type": "text", "text": "Anthropic reply." }] }"#.to_owned())
            }
        }
    }

    let database = temp_database("run-assist-cloud");
    let stub = Arc::new(CloudStub {
        last: std::sync::Mutex::new((String::new(), String::new(), Vec::new())),
    });
    let secrets = Arc::new(MemorySecretStore::default());
    let service =
        AppService::open_path_with_deps(&database, stub.clone(), secrets.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::FlightSegment,
            payload: FactPayload {
                flight_number: Some("FP18".to_owned()),
                confirmation_code: Some("SECRET-PNR".to_owned()),
                passenger_name: Some("Jamie Traveler".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("flight");

    // Without a stored key, a cloud run is refused before any request.
    assert_eq!(
        service
            .run_assist(&trip.id, "openai")
            .expect_err("no key")
            .code,
        ErrorCode::ValidationInvalidInput
    );

    // OpenAI: key rides in the Authorization header, never the body.
    service
        .set_provider_key("openai", "sk-openai-live")
        .expect("set key");
    let reply = service.run_assist(&trip.id, "openai").expect("reply");
    assert_eq!(reply.text, "OpenAI reply.");
    assert_eq!(reply.provider, ProviderId::OpenAi);
    let (url, body, headers) = stub.last.lock().expect("lock").clone();
    assert!(url.contains("api.openai.com"));
    assert!(body.contains("FP18"));
    assert!(!body.contains("SECRET-PNR"));
    assert!(!body.contains("sk-openai-live"));
    assert!(headers.contains(&(
        "Authorization".to_owned(),
        "Bearer sk-openai-live".to_owned()
    )));

    // Anthropic: key in x-api-key plus the version header.
    service
        .set_provider_key("anthropic", "sk-anthropic-live")
        .expect("set key");
    let reply = service.run_assist(&trip.id, "anthropic").expect("reply");
    assert_eq!(reply.text, "Anthropic reply.");
    let (_, body, headers) = stub.last.lock().expect("lock").clone();
    assert!(!body.contains("sk-anthropic-live"));
    assert!(headers.contains(&("x-api-key".to_owned(), "sk-anthropic-live".to_owned())));
    assert!(headers.iter().any(|(name, _)| name == "anthropic-version"));

    // Both successful calls are logged, and the log never carries a key.
    let activity = service.list_assist_activity(&trip.id).expect("activity");
    assert_eq!(activity.len(), 2);
    let serialized = serde_json::to_string(&activity).expect("ser");
    assert!(!serialized.contains("sk-openai-live"));
    assert!(!serialized.contains("sk-anthropic-live"));
    cleanup_database(database);
}

#[test]
fn run_assist_surfaces_provider_error_bodies() {
    // A provider returns an error JSON body (as it does on 401/429/etc.);
    // post_json passes the body through and the parser surfaces the cause.
    struct ErrorStub;
    impl AdviceFetcher for ErrorStub {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            panic!("must POST");
        }
        fn post_json(
            &self,
            _url: &str,
            _body: &str,
            _headers: &[(&str, &str)],
        ) -> Result<String, AppError> {
            Ok(r#"{ "error": { "message": "Incorrect API key provided" } }"#.to_owned())
        }
    }

    let database = temp_database("assist-provider-error");
    let secrets = Arc::new(MemorySecretStore::default());
    let service = AppService::open_path_with_deps(&database, Arc::new(ErrorStub), secrets.clone())
        .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service.set_provider_key("openai", "sk-bad").expect("key");

    let error = service
        .run_assist(&trip.id, "openai")
        .expect_err("provider error");
    assert_eq!(error.code, ErrorCode::AssistFailed);
    assert!(
        error.message.contains("Incorrect API key provided"),
        "provider cause should surface, got: {}",
        error.message
    );
    // A failed call is not logged (nothing completed).
    assert!(
        service
            .list_assist_activity(&trip.id)
            .expect("activity")
            .is_empty()
    );
    cleanup_database(database);
}

#[test]
fn download_pack_stores_contents_and_lists_them_per_trip() {
    struct PackFetcher {
        calls: std::sync::Mutex<Vec<String>>,
    }
    impl AdviceFetcher for PackFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            self.calls.lock().expect("lock").push(url.to_owned());
            Ok(r#"{
                "packId": "us-nashville",
                "places": [
                    { "name": "Ryman Auditorium", "category": "venue", "lat": 36.16, "lon": -86.78 },
                    { "name": "Centennial Park", "category": "park", "lat": 36.15, "lon": -86.81 }
                ],
                "articles": [
                    { "title": "Nashville", "sourceUrl": "https://en.wikivoyage.org/wiki/Nashville", "text": "Music City." }
                ]
            }"#
            .to_owned())
        }
    }

    let database = temp_database("packs-download");
    let fetcher = Arc::new(PackFetcher {
        calls: std::sync::Mutex::new(Vec::new()),
    });
    let service = open_test_service_with_fetcher(&database, fetcher.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // Unknown pack is rejected before any fetch happens.
    assert_eq!(
        service
            .download_pack(&trip.id, "atlantis")
            .expect_err("unknown pack")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    assert!(fetcher.calls.lock().expect("lock").is_empty());

    let pack = service
        .download_pack(&trip.id, "us-nashville")
        .expect("download");
    assert_eq!(pack.name, "Nashville");
    assert_eq!(pack.place_count, 2);
    assert_eq!(pack.article_count, 1);
    assert!(!pack.offline_map_ready);
    assert_eq!(
        fetcher.calls.lock().expect("lock").as_slice(),
        ["https://github.com/udhawan97/Voyalier/releases/download/packs-v1/us-nashville.json"]
    );

    let downloaded = service.list_downloaded_packs(&trip.id).expect("list");
    assert_eq!(downloaded.len(), 1);
    assert_eq!(downloaded[0].pack_id, "us-nashville");
    assert!(!downloaded[0].offline_map_ready);

    service
        .delete_downloaded_pack(&trip.id, "us-nashville")
        .expect("delete");
    assert!(
        service
            .list_downloaded_packs(&trip.id)
            .expect("list")
            .is_empty()
    );
    cleanup_database(database);
}

#[test]
fn offline_map_download_is_verified_stored_ranged_and_removed() {
    struct OfflinePackFetcher {
        bytes: Vec<u8>,
        sha256: String,
    }
    impl AdviceFetcher for OfflinePackFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            assert!(url.ends_with("/us-nashville.json"));
            Ok(format!(
                r#"{{
                  "packId":"us-nashville","places":[],"articles":[],
                  "offlineMap":{{
                    "assetName":"us-nashville.pmtiles","byteLength":{},
                    "sha256":"{}","sourceName":"Protomaps Basemap",
                    "sourceUrl":"https://build.protomaps.com/20260715.pmtiles",
                    "license":"ODbL-1.0","attribution":"© OpenStreetMap contributors",
                    "fetchedAt":"2026-07-16T00:27:07Z","minZoom":0,"maxZoom":15
                  }}
                }}"#,
                self.bytes.len(),
                self.sha256
            ))
        }

        fn fetch_bytes(&self, url: &str, limit: usize) -> Result<Vec<u8>, AppError> {
            assert!(url.ends_with("/us-nashville.pmtiles"));
            assert_eq!(limit, MAX_OFFLINE_MAP_BYTES as usize);
            Ok(self.bytes.clone())
        }
    }

    let bytes = b"PMTiles fixture bytes".to_vec();
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let database = temp_database("offline-map");
    let service = open_test_service_with_fetcher(
        &database,
        Arc::new(OfflinePackFetcher {
            bytes: bytes.clone(),
            sha256: sha256.clone(),
        }),
    )
    .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let downloaded = service
        .download_pack(&trip.id, "us-nashville")
        .expect("download");
    assert!(downloaded.offline_map_ready);
    let archive = service
        .get_offline_map(&trip.id)
        .expect("offline map")
        .expect("archive");
    assert_eq!(archive.pack_id, "us-nashville");
    assert_eq!(archive.sha256, sha256);
    assert_eq!(archive.byte_length, bytes.len() as u64);
    assert_eq!(archive.bbox.west, -87.06);

    let chunk = service
        .read_offline_map_range(&trip.id, "us-nashville", 2, 7)
        .expect("range");
    assert_eq!(
        BASE64.decode(chunk.data_base64).expect("base64"),
        bytes[2..9]
    );
    assert_eq!(chunk.etag, archive.sha256);
    assert_eq!(
        service
            .read_offline_map_range(&trip.id, "us-nashville", 0, MAX_OFFLINE_MAP_RANGE + 1,)
            .expect_err("oversize range")
            .code,
        ErrorCode::ValidationInvalidInput
    );

    let descriptor = service
        .connection()
        .expect("connection")
        .query_row(
            "SELECT content FROM downloaded_packs WHERE trip_id = ?1 AND pack_id = ?2",
            params![trip.id, "us-nashville"],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|content| serde_json::from_str::<PackContent>(&content).ok())
        .and_then(|content| content.offline_map)
        .expect("descriptor");
    let path = offline_map_path(&database, "us-nashville", &descriptor).expect("map path");
    fs::write(path, b"tampered map archive").expect("tamper fixture");
    assert!(service.get_offline_map(&trip.id).expect("map").is_none());

    service
        .delete_downloaded_pack(&trip.id, "us-nashville")
        .expect("delete");
    assert!(service.get_offline_map(&trip.id).expect("map").is_none());
    cleanup_database(database);
}

#[test]
fn get_recommendations_ranks_downloaded_pack_places_by_persona() {
    struct PackFetcher;
    impl AdviceFetcher for PackFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Ok(r#"{ "packId": "us-nashville", "articles": [], "places": [
                { "name": "Hattie B's", "category": "restaurant", "lat": 36.16, "lon": -86.79 },
                { "name": "Frist Museum", "category": "art_museum", "lat": 36.15, "lon": -86.78 },
                { "name": "Green Park", "category": "public_park", "lat": 36.14, "lon": -86.80 }
            ] }"#
                .to_owned())
        }
    }

    let database = temp_database("recommendations");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(PackFetcher)).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // No packs downloaded yet → no recommendations.
    assert!(
        service
            .get_recommendations(&trip.id, PersonaWeights::balanced())
            .expect("recs")
            .is_empty()
    );

    service
        .download_pack(&trip.id, "us-nashville")
        .expect("download");

    // A food-forward persona ranks the restaurant first.
    let weights = PersonaWeights {
        food: 1.0,
        culture: 0.3,
        nature: 0.0,
        nightlife: 0.0,
        shopping: 0.0,
    };
    let recs = service
        .get_recommendations(&trip.id, weights)
        .expect("recs");
    assert_eq!(recs.first().map(|r| r.name.as_str()), Some("Hattie B's"));
    // Nature weight is zero → the park is excluded.
    assert!(!recs.iter().any(|r| r.name == "Green Park"));
    assert!(recs.iter().all(|r| r.source == "Overture Maps"));
    cleanup_database(database);
}

#[test]
fn download_pack_rejects_a_mismatched_body() {
    struct WrongPackFetcher;
    impl AdviceFetcher for WrongPackFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Ok(r#"{ "packId": "us-hi-maui", "places": [], "articles": [] }"#.to_owned())
        }
    }

    let database = temp_database("packs-mismatch");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(WrongPackFetcher)).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    assert_eq!(
        service
            .download_pack(&trip.id, "us-nashville")
            .expect_err("mismatch")
            .code,
        ErrorCode::PackDownloadFailed
    );
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

/// Open a service for tests with an in-memory secret store, so tests never
/// touch (or mutate) the real OS keychain — which is both slow and a real
/// side effect now that the vault reads/writes its data key there on open.
/// The vault is active (a key is available), exercising the encrypted path.
fn open_test_service(database: &Path) -> Result<AppService, AppError> {
    AppService::open_path_with_deps(
        database,
        Arc::new(UreqFetcher),
        Arc::new(MemorySecretStore::default()),
    )
}

fn open_test_service_with_fetcher(
    database: &Path,
    fetcher: Arc<dyn AdviceFetcher>,
) -> Result<AppService, AppError> {
    AppService::open_path_with_deps(database, fetcher, Arc::new(MemorySecretStore::default()))
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

#[test]
fn suggest_packs_matches_the_trip_destination() {
    let database = temp_database("suggest-packs");
    let service = open_test_service(&database).expect("service");
    // valid_trip_input's destination is "Kyoto".
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let suggestions = service.suggest_packs(&trip.id).expect("suggest");
    assert_eq!(suggestions[0].pack.id, "jp-kyoto");
    assert!(matches!(
        suggestions[0].match_kind,
        voyalier_core::PackMatchKind::Exact
    ));

    assert_eq!(
        service
            .suggest_packs("nope")
            .expect_err("unknown trip")
            .code,
        ErrorCode::TripNotFound
    );
    cleanup_database(database);
}

#[test]
fn suggest_places_offers_gazetteer_cities_and_prefers_the_users_own() {
    let database = temp_database("suggest_places");
    let service = open_test_service(&database).expect("service");

    // With no trips yet, a prefix surfaces gazetteer cities, labelled by
    // country — the create-trip dialog works before any trip exists. Osaka
    // is a gazetteer city with no pack, so its source is the gazetteer.
    let hits = service.suggest_places("osa").expect("suggest");
    let osaka = hits
        .iter()
        .find(|s| s.value == "Osaka")
        .expect("Osaka suggested");
    assert_eq!(osaka.source, voyalier_core::SuggestionSource::Gazetteer);
    assert_eq!(osaka.detail.as_deref(), Some("Japan"));

    // A blank query (focus) still offers the pack catalog / trip history,
    // as before — but never dumps the 34k-city gazetteer.
    let blank = service.suggest_places("   ").expect("blank");
    assert!(!blank.is_empty(), "focus shows pack destinations");
    assert!(blank.len() <= FIELD_SUGGESTION_LIMIT);
    assert!(
        blank
            .iter()
            .all(|s| s.source != voyalier_core::SuggestionSource::Gazetteer),
        "the gazetteer only fires on a typed prefix"
    );

    // Once the user has a trip to Kyoto, their own copy wins the dedup:
    // one "Kyoto", sourced from trip history, not the gazetteer.
    service
        .create_trip(CreateTripInput {
            title: None,
            origin: "Chicago".to_owned(),
            destination: "Kyoto".to_owned(),
            start_date: "2027-04-01".to_owned(),
            end_date: "2027-04-05".to_owned(),
        })
        .expect("trip");
    let hits = service.suggest_places("kyo").expect("suggest");
    let kyotos: Vec<_> = hits.iter().filter(|s| s.value == "Kyoto").collect();
    assert_eq!(kyotos.len(), 1, "deduped to one Kyoto");
    assert_eq!(
        kyotos[0].source,
        voyalier_core::SuggestionSource::TripHistory
    );
    cleanup_database(database);
}

#[test]
fn suggest_field_values_draws_on_confirmed_facts_and_pack_places() {
    // A stub that serves one Kyoto pack with a single named place.
    struct PackFetcher;
    impl AdviceFetcher for PackFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            assert!(url.contains("jp-kyoto.json"));
            Ok(r#"{"packId":"jp-kyoto","places":[{"name":"Nishiki Market",
                   "category":"market","lat":35.0,"lon":135.76}],"articles":[]}"#
                .to_owned())
        }
    }

    let database = temp_database("suggest-fields");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(PackFetcher)).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some("River Paper Inn".to_owned()),
                address: Some("7 Paper Street, Kyoto".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("manual stay");
    service
        .download_pack(&trip.id, "jp-kyoto")
        .expect("download");

    // Property-name suggestions combine confirmed values and pack places.
    let property = service
        .suggest_field_values(&trip.id, "propertyName", "")
        .expect("property suggestions");
    let values: Vec<&str> = property.iter().map(|s| s.value.as_str()).collect();
    assert!(values.contains(&"River Paper Inn"));
    assert!(values.contains(&"Nishiki Market"));
    assert!(
        property
            .iter()
            .any(|s| s.source == SuggestionSource::ConfirmedFact)
    );
    assert!(
        property
            .iter()
            .any(|s| s.source == SuggestionSource::PackPlace)
    );

    // Address suggestions come only from confirmed facts (places carry none),
    // and the query filters case-insensitively.
    let address = service
        .suggest_field_values(&trip.id, "address", "paper")
        .expect("address suggestions");
    assert_eq!(address.len(), 1);
    assert_eq!(address[0].value, "7 Paper Street, Kyoto");
    assert!(
        address
            .iter()
            .all(|s| s.source != SuggestionSource::PackPlace)
    );

    // An unsupported field is a validation error, not a silent empty list.
    assert_eq!(
        service
            .suggest_field_values(&trip.id, "confirmationCode", "")
            .expect_err("unsupported field")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    cleanup_database(database);
}

#[test]
fn suggest_field_values_skips_confirmed_source_when_the_vault_is_locked() {
    let database = temp_database("suggest-fields-locked");
    let secrets = Arc::new(MemorySecretStore::default());
    let service = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                address: Some("7 Paper Street, Kyoto".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("manual stay");
    service
        .set_vault_passphrase("correct horse battery")
        .expect("set passphrase");

    // Reopen: the vault is locked, so the confirmed-fact source is unreadable.
    // Suggestions must degrade to empty rather than surfacing a locked error.
    let reopened = AppService::open_path_with_deps(
        &database,
        Arc::new(FakeFetcher::offline()),
        secrets.clone(),
    )
    .expect("reopen");
    assert!(reopened.get_vault_status().expect("status").locked);
    let address = reopened
        .suggest_field_values(&trip.id, "address", "")
        .expect("suggestions must not error when locked");
    assert!(address.is_empty());
    cleanup_database(database);
}

/// An Ollama stub that returns a fixed chat reply and records the posted body.
struct DraftOllamaStub {
    reply: String,
    last_body: std::sync::Mutex<String>,
}
impl AdviceFetcher for DraftOllamaStub {
    fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
        panic!("draft must POST, not GET");
    }
    fn post_json(
        &self,
        url: &str,
        body: &str,
        _headers: &[(&str, &str)],
    ) -> Result<String, AppError> {
        assert_eq!(url, "http://localhost:11434/api/chat");
        *self.last_body.lock().expect("lock") = body.to_owned();
        Ok(serde_json::json!({
            "message": { "role": "assistant", "content": self.reply }
        })
        .to_string())
    }
}

/// Import a flight memo that the plaintext parser actually extracts from,
/// and return (document id, its candidate ids). `import_stay_text` is
/// deliberately unparseable — it exists for the gap-filling draft tests — so
/// it is useless anywhere the candidates themselves matter.
fn import_flight_memo(service: &AppService, trip_id: &str) -> (String, Vec<String>) {
    let imported = service
        .import_document(ImportDocumentInput {
            trip_id: trip_id.to_owned(),
            kind: DocumentKind::PastedText,
            label: Some("Flight memo".to_owned()),
            content: "Confirmation HOLD9\nRoute SFO-NRT\n2027-04-02T10:00".to_owned(),
        })
        .expect("import");
    assert!(
        !imported.candidates.is_empty(),
        "fixture must produce candidates"
    );
    (
        imported.document.id,
        imported.candidates.iter().map(|c| c.id.clone()).collect(),
    )
}

fn import_stay_text(service: &AppService, trip_id: &str) -> String {
    service
        .import_document(ImportDocumentInput {
            trip_id: trip_id.to_owned(),
            kind: DocumentKind::PastedText,
            label: Some("Hotel email".to_owned()),
            content: "River Paper Inn — check in 2027-04-02, check out 2027-04-08.".to_owned(),
        })
        .expect("import")
        .document
        .id
}

#[test]
fn run_assist_draft_turns_a_valid_reply_into_pending_assisted_candidates() {
    let reply = r#"{"stays":[
        {"propertyName":"River Paper Inn","checkinDate":"2027-04-02","checkoutDate":"2027-04-08"},
        {"propertyName":"Late Inn","checkinDate":"2027-05-01","checkoutDate":"2027-05-03"}
    ]}"#;
    let database = temp_database("draft-run");
    let stub = Arc::new(DraftOllamaStub {
        reply: reply.to_owned(),
        last_body: std::sync::Mutex::new(String::new()),
    });
    let service = open_test_service_with_fetcher(&database, stub.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let document_id = import_stay_text(&service, &trip.id);

    let result = service
        .run_assist_draft(&trip.id, "lodging_dates")
        .expect("draft");
    assert_eq!(result.candidates.len(), 2);

    let in_window = &result.candidates[0];
    assert_eq!(in_window.method, ExtractionMethod::Assisted);
    assert_eq!(in_window.status, CandidateStatus::Pending);
    assert_eq!(in_window.fact_type, FactType::LodgingStay);
    assert_eq!(in_window.document_id, document_id);
    assert_eq!(
        in_window.payload.checkin_date.as_deref(),
        Some("2027-04-02")
    );
    assert!(in_window.warnings.is_empty());
    // The out-of-window stay is flagged for the reviewer, not dropped.
    assert!(
        result.candidates[1]
            .warnings
            .contains(&WarningCode::OutsideTripWindow)
    );

    // The proposals are now reviewable pending candidates.
    let pending = service
        .list_candidates(&trip.id, Some(CandidateStatus::Pending))
        .expect("pending");
    assert_eq!(pending.len(), 2);

    // The posted request carried the imported text and the trip dates.
    let body = stub.last_body.lock().expect("lock").clone();
    assert!(body.contains("River Paper Inn"));
    assert!(body.contains("2027-04-01 to 2027-04-10"));
    cleanup_database(database);
}

#[test]
fn run_assist_draft_rejects_a_malformed_reply_and_saves_nothing() {
    let database = temp_database("draft-bad");
    let stub = Arc::new(DraftOllamaStub {
        reply: "I couldn't find any dates in there.".to_owned(),
        last_body: std::sync::Mutex::new(String::new()),
    });
    let service = open_test_service_with_fetcher(&database, stub).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    import_stay_text(&service, &trip.id);

    assert_eq!(
        service
            .run_assist_draft(&trip.id, "lodging_dates")
            .expect_err("malformed")
            .code,
        ErrorCode::AssistFailed
    );
    // Nothing was persisted from the bad reply.
    assert!(
        service
            .list_candidates(&trip.id, Some(CandidateStatus::Pending))
            .expect("pending")
            .is_empty()
    );
    cleanup_database(database);
}

#[test]
fn run_assist_draft_without_documents_calls_no_model() {
    // Panics if the model is ever contacted: with no documents to read there
    // is nothing to ask it about.
    let database = temp_database("draft-empty");
    let service = open_test_service_with_fetcher(&database, Arc::new(FakeFetcher::offline()))
        .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let result = service
        .run_assist_draft(&trip.id, "lodging_dates")
        .expect("draft");
    assert!(result.candidates.is_empty());

    // An unknown draft kind is a validation error.
    assert_eq!(
        service
            .run_assist_draft(&trip.id, "made_up_kind")
            .expect_err("unknown kind")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    cleanup_database(database);
}

/// A database in the shape shipped before this ledger existed: the fact
/// tables reject 'assisted', confirmed_facts has no source_removed, and
/// user_version is 1 because every build stamped it on open regardless.
fn legacy_database() -> Connection {
    let connection = Connection::open_in_memory().expect("db");
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE trips (id TEXT PRIMARY KEY);
             CREATE TABLE source_documents (id TEXT PRIMARY KEY,
                 trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE);
             CREATE TABLE parser_runs (id TEXT PRIMARY KEY,
                 document_id TEXT REFERENCES source_documents(id) ON DELETE CASCADE);
             CREATE TABLE candidate_facts (
                 id TEXT PRIMARY KEY,
                 trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                 document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                 parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                 fact_type TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                 field_spans TEXT NOT NULL,
                 warnings TEXT NOT NULL,
                 status TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 resolved_at TEXT
             );
             CREATE TABLE confirmed_facts (
                 id TEXT PRIMARY KEY,
                 trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                 fact_type TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                 candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                 corrected_fields TEXT NOT NULL,
                 confirmed_at TEXT NOT NULL
             );
             INSERT INTO trips (id) VALUES ('t1');
             INSERT INTO source_documents (id, trip_id) VALUES ('d1', 't1');
             INSERT INTO parser_runs (id, document_id) VALUES ('r1', 'd1');
             INSERT INTO candidate_facts VALUES
                 ('c1','t1','d1','r1','lodging_stay','{}','manual','[]','[]','pending','now',NULL);
             INSERT INTO confirmed_facts VALUES
                 ('f1','t1','lodging_stay','{}','manual',NULL,'[]','now');
             PRAGMA user_version = 1;",
        )
        .expect("legacy schema");
    connection
}

fn columns_of(connection: &Connection, table: &str) -> Vec<String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("table_info");
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .expect("columns")
        .collect::<rusqlite::Result<Vec<String>>>()
        .expect("columns")
}

/// Every column declared in [`SEALED_COLUMNS`] must actually be ciphertext on
/// disk and plaintext through the record reads.
///
/// Driven by the declaration itself: add a pair there and this fails until
/// the read and write paths seal it. That is the whole point of having one
/// list — before, the list only drove the legacy migration and each SELECT
/// re-decided sealing by hand, so a forgotten open returned "v1:<base64>" to
/// the UI with nothing objecting.
/// A trip bound for Canada, so the curated journey has something to resolve
/// against without a network fetch.
fn canada_trip_input() -> CreateTripInput {
    CreateTripInput {
        title: None,
        origin: "Mumbai".to_owned(),
        destination: "Toronto, Canada".to_owned(),
        start_date: "2027-04-01".to_owned(),
        end_date: "2027-04-10".to_owned(),
    }
}

#[test]
fn visa_preparation_resolves_a_journey_and_keeps_progress() {
    let database = temp_database("visa-prep");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(canada_trip_input()).expect("trip");

    // Nothing is assumed before a passport is picked.
    let empty = service.get_visa_prep(&trip.id).expect("empty");
    assert_eq!(empty.nationality_iso2, None);
    assert!(empty.journey.is_none());
    assert!(empty.entry_path.is_none());
    assert!(empty.items.is_empty());

    let prep = service
        .set_visa_nationality(SetVisaNationalityInput {
            trip_id: trip.id.clone(),
            nationality_iso2: "in".to_owned(),
        })
        .expect("nationality");
    // Normalized on the way in, so storage never holds a code the resolver
    // would then refuse to read.
    assert_eq!(prep.nationality_iso2.as_deref(), Some("IN"));
    let journey = prep.journey.expect("India needs a visa for Canada");
    assert_eq!(journey.steps.len(), 8);
    assert_eq!(journey.destination_iso2, "CA");
    // The quote carries its source, never a bare assertion.
    let quote = prep.entry_path.expect("quote");
    assert_eq!(quote.path, voyalier_core::EntryPath::VisaRequired);
    assert!(quote.source_url.starts_with("https://"));
    assert!(!quote.curated_as_of.is_empty());

    let ticked = service
        .set_visa_item_progress(SetVisaItemProgressInput {
            trip_id: trip.id.clone(),
            document_id: "ca.trv.funds.statements".to_owned(),
            checked: true,
            note: Some("  asked HDFC 12 Jul  ".to_owned()),
        })
        .expect("tick");
    assert_eq!(ticked.items.len(), 1);
    assert!(ticked.items[0].checked);
    assert_eq!(ticked.items[0].note.as_deref(), Some("asked HDFC 12 Jul"));

    // ADR-0005: clearing both fields removes the row rather than leaving an
    // empty tick behind, so "untouched" stays one state.
    let cleared = service
        .set_visa_item_progress(SetVisaItemProgressInput {
            trip_id: trip.id.clone(),
            document_id: "ca.trv.funds.statements".to_owned(),
            checked: false,
            note: None,
        })
        .expect("clear");
    assert!(cleared.items.is_empty());

    drop(service);
    cleanup_database(database);
}

#[test]
fn visa_preparation_refuses_bad_input_and_follows_the_trip() {
    let database = temp_database("visa-prep-guards");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(canada_trip_input()).expect("trip");

    for bad in ["", "I", "IND", "12"] {
        let error = service
            .set_visa_nationality(SetVisaNationalityInput {
                trip_id: trip.id.clone(),
                nationality_iso2: bad.to_owned(),
            })
            .expect_err("invalid nationality");
        assert_eq!(error.code, ErrorCode::ValidationInvalidInput);
    }

    service
        .set_visa_nationality(SetVisaNationalityInput {
            trip_id: trip.id.clone(),
            nationality_iso2: "IN".to_owned(),
        })
        .expect("nationality");
    let long = "x".repeat(voyalier_core::MAX_VISA_NOTE_CHARS + 1);
    let error = service
        .set_visa_item_progress(SetVisaItemProgressInput {
            trip_id: trip.id.clone(),
            document_id: "ca.trv.funds.statements".to_owned(),
            checked: true,
            note: Some(long),
        })
        .expect_err("note too long");
    assert_eq!(error.code, ErrorCode::ValidationInvalidInput);

    // A second trip prefills the picker from the first, but never applies it
    // -- the trip may not be for the same traveler.
    let second = service.create_trip(canada_trip_input()).expect("second");
    let prep = service.get_visa_prep(&second.id).expect("second prep");
    assert_eq!(prep.nationality_iso2, None);
    assert_eq!(prep.suggested_nationality_iso2.as_deref(), Some("IN"));

    // Deleting the trip takes its preparation with it.
    service.delete_trip(&trip.id).expect("delete");
    assert!(service.get_visa_prep(&trip.id).is_err());

    drop(service);
    cleanup_database(database);
}

#[test]
fn visa_preparation_stays_silent_without_a_resolvable_destination() {
    let database = temp_database("visa-prep-unknown");
    let service = open_test_service(&database).expect("service");
    // Kyoto is not curated: the traveler gets their passport back and
    // nothing invented about Japanese entry rules.
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let prep = service
        .set_visa_nationality(SetVisaNationalityInput {
            trip_id: trip.id.clone(),
            nationality_iso2: "IN".to_owned(),
        })
        .expect("nationality");
    assert_eq!(prep.nationality_iso2.as_deref(), Some("IN"));
    assert!(prep.journey.is_none());
    // "Nothing invented" has to include the attribution. This used to hand
    // back an Unknown quote wearing Canada's authority and canada.ca's URL,
    // which the interface then printed as "the official source" for a trip
    // to Japan (ADR-0006, amended 2026-07-29).
    assert!(prep.entry_path.is_none());

    drop(service);
    cleanup_database(database);
}

/// A NULL in a nullable sealed column must not stop the workspace opening.
///
/// Found by running the real server rather than the suite: ticking a visa
/// document without writing a note leaves `note` NULL, and the re-seal pass
/// read every sealed column as `String`. The result was
/// `storage/failure: Invalid column type Null` from `open_path` -- the whole
/// workspace refused to open, not just the panel. `trip_items.location` and
/// `trip_items.notes` are nullable and sealed too, so the same bug was
/// already reachable through a manual plan with no location; the visa
/// columns only made it the common case.
#[test]
fn a_null_in_a_sealed_column_still_opens_the_workspace() {
    let database = temp_database("sealed-null");
    // One store across both opens: the data key lives there, so a fresh one
    // would fail to open sealed data for reasons unrelated to this test.
    let secrets = Arc::new(MemorySecretStore::default());
    {
        let service =
            AppService::open_path_with_deps(&database, Arc::new(UreqFetcher), secrets.clone())
                .expect("service");
        let trip = service.create_trip(canada_trip_input()).expect("trip");
        service
            .set_visa_nationality(SetVisaNationalityInput {
                trip_id: trip.id.clone(),
                nationality_iso2: "IN".to_owned(),
            })
            .expect("nationality");
        // Ticked, deliberately unnoted: `note` stays NULL.
        service
            .set_visa_item_progress(SetVisaItemProgressInput {
                trip_id: trip.id.clone(),
                document_id: "ca.trv.funds.statements".to_owned(),
                checked: true,
                note: None,
            })
            .expect("tick");
        service
            .create_trip_item(CreateTripItemInput {
                trip_id: trip.id.clone(),
                kind: voyalier_core::TripItemKind::Activity,
                title: "Walk the ravine".to_owned(),
                location: None,
                start_at: None,
                end_at: None,
                notes: None,
                saved_place_id: None,
            })
            .expect("trip item");

        let connection = service.connection().expect("connection");
        let nulls: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM visa_prep_items WHERE note IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(nulls, 1, "the fixture must actually leave a NULL behind");
    }

    // Reopening runs the re-seal pass over every sealed column again.
    let reopened = AppService::open_path_with_deps(&database, Arc::new(UreqFetcher), secrets)
        .expect("reopen with a NULL present");
    let trips = reopened.list_trips().expect("trips");
    assert_eq!(trips.len(), 1);
    let visa = reopened
        .get_visa_prep(&trips[0].trip.id)
        .expect("visa prep still readable");
    assert!(visa.items[0].checked);
    assert_eq!(visa.items[0].note, None);

    drop(reopened);
    cleanup_database(database);
}

#[test]
fn sealed_columns_round_trip_through_the_vault() {
    let database = temp_database("sealed-columns");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // Populate every sealed column: a document, its candidates, a confirmed
    // fact, and notes.
    let (_document_id, candidate_ids) = import_flight_memo(&service, &trip.id);
    service
        .confirm_candidate(ConfirmCandidateInput {
            candidate_id: candidate_ids[0].clone(),
            edited_payload: None,
        })
        .expect("confirm");
    service
        .set_trip_notes(&trip.id, "Gate code 5150, ask for Rin")
        .expect("notes");
    // Populate every traveler-planning sealed column through the public
    // service. The direct insert is only the non-sensitive downloaded-pack
    // prerequisite for the saved recommendation.
    service
        .connection()
        .expect("connection")
        .execute(
            r#"INSERT INTO downloaded_packs
                (trip_id, pack_id, name, region, place_count, article_count, content, downloaded_at)
             VALUES (?1, 'us-nashville', 'Nashville', 'Tennessee', 1, 0,
                '{"packId":"us-nashville","places":[{"name":"Frist Art Museum","category":"art_museum","lat":36.156,"lon":-86.783}],"articles":[]}',
                'now')"#,
            params![trip.id],
        )
        .expect("pack prerequisite");
    let saved = service
        .save_place(SavePlaceInput {
            trip_id: trip.id.clone(),
            recommendation: Recommendation {
                pack_id: "us-nashville".to_owned(),
                name: "Frist Art Museum".to_owned(),
                category: "art_museum".to_owned(),
                dimension: "culture".to_owned(),
                lat: 36.156,
                lon: -86.783,
                source: "Overture Maps".to_owned(),
                license: "CDLA-Permissive-2.0".to_owned(),
                score: 1.0,
                reasons: vec!["Matches your interest in culture".to_owned()],
                wildcard: false,
            },
            weights: PersonaWeights {
                culture: 1.0,
                ..PersonaWeights::balanced()
            },
            notes: "Meet Hana by the side entrance".to_owned(),
        })
        .expect("saved place");
    service
        .add_packing_item(AddPackingItemInput {
            trip_id: trip.id.clone(),
            label: "Passport copy".to_owned(),
            suggestion_code: None,
        })
        .expect("packing");
    service
        .create_trip_item(CreateTripItemInput {
            trip_id: trip.id.clone(),
            kind: voyalier_core::TripItemKind::Activity,
            title: "Private studio visit".to_owned(),
            location: Some("12 Secret Lane".to_owned()),
            start_at: None,
            end_at: None,
            notes: Some("Door code 8080".to_owned()),
            saved_place_id: Some(saved.id),
        })
        .expect("trip item");

    service
        .set_visa_nationality(SetVisaNationalityInput {
            trip_id: trip.id.clone(),
            nationality_iso2: "IN".to_owned(),
        })
        .expect("nationality");
    service
        .set_visa_item_progress(SetVisaItemProgressInput {
            trip_id: trip.id.clone(),
            document_id: "ca.trv.funds.statements".to_owned(),
            checked: true,
            note: Some("HDFC statements requested 12 Jul".to_owned()),
        })
        .expect("visa progress");

    let connection = service.connection().expect("connection");
    for (table, column) in SEALED_COLUMNS {
        let stored: Vec<String> = {
            let mut statement = connection
                .prepare(&format!("SELECT {column} FROM {table}"))
                .expect("prepare");
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .expect("query")
                .collect::<rusqlite::Result<Vec<_>>>()
                .expect("rows")
        };
        assert!(
            !stored.is_empty(),
            "{table}.{column} has no rows — the fixture must exercise every sealed column"
        );
        for value in stored {
            assert!(
                value.starts_with(VAULT_PREFIX),
                "{table}.{column} is stored in the clear: {value:.40}"
            );
        }
    }
    drop(connection);

    // ...and the read paths hand back plaintext, not the stored envelope.
    let notes = service.get_trip_notes(&trip.id).expect("notes");
    assert_eq!(notes.body, "Gate code 5150, ask for Rin");
    assert!(!notes.body.starts_with(VAULT_PREFIX));

    let detail = service.get_trip(&trip.id).expect("detail");
    let payload = serde_json::to_string(&detail.confirmed_facts[0].payload).expect("json");
    assert!(!payload.contains(VAULT_PREFIX));
    assert_eq!(
        detail.saved_places[0].notes,
        "Meet Hana by the side entrance"
    );
    assert_eq!(detail.packing_items[0].label, "Passport copy");
    assert_eq!(
        detail.trip_items[0].location.as_deref(),
        Some("12 Secret Lane")
    );
    let visa = service.get_visa_prep(&trip.id).expect("visa prep");
    assert_eq!(visa.nationality_iso2.as_deref(), Some("IN"));
    assert_eq!(
        visa.items[0].note.as_deref(),
        Some("HDFC statements requested 12 Jul")
    );

    drop(service);
    cleanup_database(database);
}

#[test]
fn a_legacy_database_migrates_in_order_and_keeps_its_rows() {
    let connection = legacy_database();
    migrate(&connection).expect("migrate");

    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );
    // add_source_removed ran after widen_method_check rebuilt the table, so
    // the column is present rather than dropped by the rebuild's copy.
    assert!(columns_of(&connection, "confirmed_facts").contains(&"source_removed".to_owned()));
    // Both pre-existing rows survived the rebuild.
    let kept: i64 = connection
        .query_row("SELECT count(*) FROM confirmed_facts", [], |row| row.get(0))
        .expect("count");
    assert_eq!(kept, 1);
    // The widened constraint took effect.
    connection
        .execute(
            "INSERT INTO candidate_facts VALUES
             ('c2','t1','d1','r1','lodging_stay','{}','assisted','[]','[]','pending','now',NULL)",
            [],
        )
        .expect("assisted now allowed");
}

#[test]
fn migrating_twice_is_a_no_op() {
    let connection = legacy_database();
    migrate(&connection).expect("first");
    connection
        .execute(
            "UPDATE confirmed_facts SET source_removed = 1 WHERE id = 'f1'",
            [],
        )
        .expect("mark");

    migrate(&connection).expect("second");

    // The steps did not run again: the row and its new column value stand.
    assert_eq!(
        user_version(&connection).expect("version"),
        target_schema_version()
    );
    let removed: i64 = connection
        .query_row(
            "SELECT source_removed FROM confirmed_facts WHERE id = 'f1'",
            [],
            |row| row.get(0),
        )
        .expect("value");
    assert_eq!(removed, 1);
}

#[test]
fn a_fresh_database_is_stamped_at_the_target_version() {
    let path = temp_database("migrate-fresh");
    let service = open_test_service(&path).expect("service");
    {
        let connection = service.connection().expect("connection");
        assert_eq!(
            user_version(&connection).expect("version"),
            target_schema_version()
        );
        assert!(columns_of(&connection, "confirmed_facts").contains(&"source_removed".to_owned()));
    }
    drop(service);
    cleanup_database(path);
}

#[test]
fn migration_versions_are_ordered_and_unique() {
    // The list is the ordering, so a bad edit must fail here rather than in
    // a user's database.
    let versions: Vec<i64> = MIGRATIONS.iter().map(|migration| migration.to).collect();
    let mut sorted = versions.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(versions, sorted, "migration versions ascend and are unique");
    assert!(versions.first().is_some_and(|first| *first > 1));
}

#[test]
fn saved_place_identity_migration_merges_folded_duplicates_and_is_retry_safe() {
    let connection = Connection::open_in_memory().expect("db");
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE trips (id TEXT PRIMARY KEY);
             INSERT INTO trips VALUES ('trip');",
        )
        .expect("base");
    migrate_traveler_planning(&connection).expect("planning schema");
    connection
        .execute_batch(
            "INSERT INTO saved_places VALUES
                ('old','trip','kyoto','Café Place','food','food',35.0,135.0,
                 'source','license','[]',0,'notes','2026-01-01','2026-01-01'),
                ('new','trip','kyoto','cafe-place','food','food',35.0,135.0,
                 'source','license','[]',0,'notes','2026-01-02','2026-01-02');
             INSERT INTO trip_items VALUES
                ('item','trip','activity','Visit',NULL,NULL,NULL,NULL,'old','2026-01-01','2026-01-01');",
        )
        .expect("legacy rows");

    migrate_saved_place_folded_identity(&connection).expect("first migration");
    migrate_saved_place_folded_identity(&connection).expect("retry migration");

    let places: i64 = connection
        .query_row(
            "SELECT count(*) FROM saved_places WHERE merged_into IS NULL",
            [],
            |row| row.get(0),
        )
        .expect("place count");
    assert_eq!(places, 1);
    let kept: (String, String) = connection
        .query_row(
            "SELECT id, name_folded FROM saved_places WHERE merged_into IS NULL",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("keeper");
    assert_eq!(kept, ("new".to_owned(), "cafe place".to_owned()));
    let linked: String = connection
        .query_row(
            "SELECT saved_place_id FROM trip_items WHERE id='item'",
            [],
            |row| row.get(0),
        )
        .expect("linked item");
    assert_eq!(linked, "new");
    let retired: (String, String) = connection
        .query_row(
            "SELECT merged_into, notes FROM saved_places WHERE id='old'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("retired duplicate");
    assert_eq!(retired, ("new".to_owned(), "notes".to_owned()));

    let duplicate = connection.execute(
        "INSERT INTO saved_places
            (id,trip_id,pack_id,name,name_folded,category,dimension,lat,lon,source,license,
             reasons_json,wildcard,notes,created_at,updated_at)
         VALUES ('third','trip','kyoto','CAFÉ PLACE','cafe place','food','food',35.0,135.0,
                 'source','license','[]',0,'notes','2026-01-03','2026-01-03')",
        [],
    );
    assert!(
        duplicate.is_err(),
        "the folded identity is database-enforced"
    );
    let missing_identity = connection.execute(
        "INSERT INTO saved_places
            (id,trip_id,pack_id,name,category,dimension,lat,lon,source,license,
             reasons_json,wildcard,notes,created_at,updated_at)
         VALUES ('missing','trip','other','Place','food','food',35.0,135.0,
                 'source','license','[]',0,'notes','2026-01-03','2026-01-03')",
        [],
    );
    assert!(
        missing_identity.is_err(),
        "the folded identity cannot be omitted"
    );
    for (id, name) in [("tokyo", "東京"), ("osaka", "大阪")] {
        connection
            .execute(
                "INSERT INTO saved_places
                    (id,trip_id,pack_id,name,name_folded,category,dimension,lat,lon,
                     source,license,reasons_json,wildcard,notes,created_at,updated_at)
                 VALUES (?1,'trip','jp',?2,?3,'sight','culture',35.0,135.0,
                         'source','license','[]',0,'notes','2026-01-03','2026-01-03')",
                params![id, name, saved_place_identity(name)],
            )
            .expect("distinct non-Latin identity");
    }
}

#[test]
fn migrate_method_check_widens_an_old_constraint_and_keeps_rows() {
    // A pre-drafts database: the fact tables reject 'assisted'.
    let connection = Connection::open_in_memory().expect("db");
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE trips (id TEXT PRIMARY KEY);
             CREATE TABLE source_documents (id TEXT PRIMARY KEY,
                 trip_id TEXT REFERENCES trips(id) ON DELETE CASCADE);
             CREATE TABLE parser_runs (id TEXT PRIMARY KEY,
                 document_id TEXT REFERENCES source_documents(id) ON DELETE CASCADE);
             CREATE TABLE candidate_facts (
                 id TEXT PRIMARY KEY,
                 trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                 document_id TEXT NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
                 parser_run_id TEXT NOT NULL REFERENCES parser_runs(id) ON DELETE CASCADE,
                 fact_type TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                 field_spans TEXT NOT NULL,
                 warnings TEXT NOT NULL,
                 status TEXT NOT NULL,
                 created_at TEXT NOT NULL,
                 resolved_at TEXT
             );
             CREATE TABLE confirmed_facts (
                 id TEXT PRIMARY KEY,
                 trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
                 fact_type TEXT NOT NULL,
                 payload TEXT NOT NULL,
                 method TEXT NOT NULL CHECK (method IN ('structured', 'inferred', 'manual')),
                 candidate_id TEXT REFERENCES candidate_facts(id) ON DELETE SET NULL,
                 corrected_fields TEXT NOT NULL,
                 confirmed_at TEXT NOT NULL
             );
             INSERT INTO trips (id) VALUES ('t1');
             INSERT INTO source_documents (id, trip_id) VALUES ('d1', 't1');
             INSERT INTO parser_runs (id, document_id) VALUES ('r1', 'd1');
             INSERT INTO candidate_facts VALUES
                 ('c1','t1','d1','r1','lodging_stay','{}','manual','[]','[]','pending','now',NULL);",
        )
        .expect("old schema");

    // Before the migration, an assisted method is rejected.
    assert!(
        connection
            .execute(
                "INSERT INTO candidate_facts VALUES
                 ('c2','t1','d1','r1','lodging_stay','{}','assisted','[]','[]','pending','now',NULL)",
                [],
            )
            .is_err()
    );

    migrate_method_check(&connection).expect("migrate");

    // The pre-existing row survived...
    let kept: i64 = connection
        .query_row("SELECT count(*) FROM candidate_facts", [], |row| row.get(0))
        .expect("count");
    assert_eq!(kept, 1);
    // ...and an assisted row now inserts into both fact tables.
    connection
        .execute(
            "INSERT INTO candidate_facts VALUES
             ('c2','t1','d1','r1','lodging_stay','{}','assisted','[]','[]','pending','now',NULL)",
            [],
        )
        .expect("assisted candidate now allowed");
    connection
        .execute(
            "INSERT INTO confirmed_facts VALUES
             ('cf1','t1','lodging_stay','{}','assisted','c2','[]','now')",
            [],
        )
        .expect("assisted confirmed fact now allowed");
    // Re-running is a no-op (the constraint already allows 'assisted').
    migrate_method_check(&connection).expect("idempotent");

    // The two migrations run in this order for real, and the order is load
    // bearing: migrate_method_check rebuilds confirmed_facts with
    // `INSERT ... SELECT *`, so source_removed must arrive after it or the
    // copy would push nine columns into an eight-column table.
    migrate_source_removed(&connection).expect("add source_removed");
    let flag: i64 = connection
        .query_row(
            "SELECT source_removed FROM confirmed_facts WHERE id = 'cf1'",
            [],
            |row| row.get(0),
        )
        .expect("column exists");
    // A fact that predates the documents manager still has its source.
    assert_eq!(flag, 0);
    // Adding the column twice must not fail.
    migrate_source_removed(&connection).expect("idempotent");
}

#[test]
fn ai_prompt_overrides_and_reset_flow_into_requests() {
    // Captures the draft POST so we can see which instruction was sent.
    struct CaptureStub {
        last_body: std::sync::Mutex<String>,
    }
    impl AdviceFetcher for CaptureStub {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            panic!("assist must POST, not GET");
        }
        fn post_json(
            &self,
            _url: &str,
            body: &str,
            _headers: &[(&str, &str)],
        ) -> Result<String, AppError> {
            *self.last_body.lock().expect("lock") = body.to_owned();
            Ok(serde_json::json!({ "message": { "content": "{\"stays\":[]}" } }).to_string())
        }
    }

    let database = temp_database("ai-prompts");
    let stub = Arc::new(CaptureStub {
        last_body: std::sync::Mutex::new(String::new()),
    });
    let service = open_test_service_with_fetcher(&database, stub.clone()).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // Defaults out of the box, no overrides.
    let prompts = service.get_ai_prompts().expect("prompts");
    assert_eq!(prompts.prompts.len(), 2);
    assert!(prompts.prompts.iter().all(|p| p.custom_text.is_none()));

    // A custom assist instruction flows into the assist preview (which run reuses).
    service
        .set_ai_prompt("assist", Some("ASSIST-CUSTOM-RULE"))
        .expect("set assist");
    let preview = service.preview_assist(&trip.id, "ollama").expect("preview");
    assert_eq!(preview.system_prompt, "ASSIST-CUSTOM-RULE");

    // Resetting restores the default, which forbids inventing high-stakes facts.
    service.set_ai_prompt("assist", None).expect("reset assist");
    let preview = service.preview_assist(&trip.id, "ollama").expect("preview");
    assert!(preview.system_prompt.contains("Do not invent"));

    // A custom draft instruction is what actually gets POSTed to the model.
    import_stay_text(&service, &trip.id);
    service
        .set_ai_prompt("draft_lodging_dates", Some("DRAFT-CUSTOM-RULE"))
        .expect("set draft");
    let draft_preview = service
        .preview_assist_draft(&trip.id, "lodging_dates")
        .expect("draft preview");
    assert_eq!(draft_preview.system_prompt, "DRAFT-CUSTOM-RULE");
    service
        .run_assist_draft(&trip.id, "lodging_dates")
        .expect("run draft");
    assert!(
        stub.last_body
            .lock()
            .expect("lock")
            .contains("DRAFT-CUSTOM-RULE")
    );

    // A blank override and an unknown kind are validation errors.
    assert_eq!(
        service
            .set_ai_prompt("assist", Some("   "))
            .expect_err("blank")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    assert_eq!(
        service
            .set_ai_prompt("made_up", None)
            .expect_err("kind")
            .code,
        ErrorCode::ValidationInvalidInput
    );
    cleanup_database(database);
}

#[test]
fn preview_assist_draft_stays_on_device_and_shows_the_text() {
    let database = temp_database("draft-preview");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    import_stay_text(&service, &trip.id);

    let preview = service
        .preview_assist_draft(&trip.id, "lodging_dates")
        .expect("preview");
    assert!(!preview.leaves_device);
    assert_eq!(preview.endpoint, "http://localhost:11434/api/chat");
    assert!(preview.withheld.is_empty());
    assert!(preview.user_content.contains("River Paper Inn"));
    assert!(preview.grounded_in.iter().any(|g| g.contains("imported")));
    cleanup_database(database);
}

/// The exact confirmation the web app's "Explore a sample trip" imports.
/// Included from the shared fixture rather than copied, so this test fails
/// if the shipped sample ever stops parsing.
const SAMPLE_CONFIRMATION: &str =
    include_str!("../../../packages/contracts/fixtures/sample-confirmation.html");

#[test]
fn the_sample_confirmation_parses_into_a_flight_and_a_stay() {
    // The sample is a newcomer's first impression: if its JSON-LD is wrong,
    // "Explore a sample trip" lands them on an empty trip with nothing to
    // review — the exact opposite of the point — and no UI test would notice,
    // because parsing happens here, not in the web layer.
    let database = temp_database("sample-parse");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let imported = service
        .import_document(ImportDocumentInput {
            trip_id: trip.id.clone(),
            kind: DocumentKind::Html,
            label: Some("Sample confirmation email".to_owned()),
            content: SAMPLE_CONFIRMATION.to_owned(),
        })
        .expect("import sample");

    let flights = imported
        .candidates
        .iter()
        .filter(|c| c.fact_type == FactType::FlightSegment)
        .count();
    let stays = imported
        .candidates
        .iter()
        .filter(|c| c.fact_type == FactType::LodgingStay)
        .count();
    assert_eq!(flights, 1, "sample must yield exactly one flight");
    assert_eq!(stays, 1, "sample must yield exactly one stay");
    // Left pending on purpose: the demo IS the review.
    assert!(
        imported
            .candidates
            .iter()
            .all(|c| c.status == CandidateStatus::Pending)
    );
    // Structured, not guessed — proving it took the JSON-LD path a real
    // airline email takes.
    assert!(
        imported
            .candidates
            .iter()
            .all(|c| c.method == ExtractionMethod::Structured)
    );
    cleanup_database(database);
}

#[test]
fn trip_notes_round_trip_and_are_sealed_at_rest() {
    let database = temp_database("notes-seal");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    // Never written is an empty body, not an error.
    let empty = service.get_trip_notes(&trip.id).expect("get");
    assert_eq!(empty.body, "");
    assert!(empty.updated_at.is_none());

    let saved = service
        .set_trip_notes(&trip.id, "Ask about the tea house")
        .expect("set");
    assert_eq!(saved.body, "Ask about the tea house");
    assert!(saved.updated_at.is_some());
    assert_eq!(
        service.get_trip_notes(&trip.id).expect("get").body,
        "Ask about the tea house"
    );

    // The row on disk must not hold the plaintext.
    let connection = Connection::open(&database).expect("open db");
    let stored: String = connection
        .query_row("SELECT body FROM trip_notes", [], |row| row.get(0))
        .expect("stored row");
    assert!(
        !stored.contains("tea house"),
        "notes must be sealed at rest"
    );
    drop(connection);
    cleanup_database(database);
}

#[test]
fn clearing_trip_notes_removes_them_rather_than_storing_blank() {
    let database = temp_database("notes-clear");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service.set_trip_notes(&trip.id, "Temporary").expect("set");

    let cleared = service.set_trip_notes(&trip.id, "").expect("clear");
    assert_eq!(cleared.body, "");
    // Cleared and never-written are one state, not two.
    assert!(cleared.updated_at.is_none());
    assert!(
        service
            .get_trip_notes(&trip.id)
            .expect("get")
            .updated_at
            .is_none()
    );
    cleanup_database(database);
}

#[test]
fn trip_notes_are_bounded_and_never_reach_a_brief() {
    let database = temp_database("notes-bounds");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let too_long = "x".repeat(MAX_NOTES_CHARS + 1);
    assert_eq!(
        service
            .set_trip_notes(&trip.id, &too_long)
            .unwrap_err()
            .code,
        ErrorCode::ValidationInvalidInput
    );

    // The brief is built from the trip and its facts, so notes have no path
    // into it. Assert the property rather than trusting the shape.
    service
        .set_trip_notes(&trip.id, "SECRET-NOTE-TEXT")
        .expect("set");
    let brief = service.get_trip_brief(&trip.id).expect("brief");
    let rendered = serde_json::to_string(&brief).expect("json");
    assert!(!rendered.contains("SECRET-NOTE-TEXT"));
    cleanup_database(database);
}

#[test]
fn documents_are_listed_newest_first_with_their_candidate_counts() {
    let database = temp_database("documents-list");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let (document_id, _) = import_flight_memo(&service, &trip.id);

    let documents = service.list_documents(&trip.id).expect("list");
    assert_eq!(documents.len(), 1);
    assert_eq!(documents[0].document.id, document_id);
    assert_eq!(documents[0].document.label, "Flight memo");
    // The import produced candidates, none reviewed yet.
    assert!(documents[0].pending_count > 0);
    assert_eq!(documents[0].confirmed_count, 0);

    // Confirming one moves it across the two counters.
    let pending = service
        .list_candidates(&trip.id, Some(CandidateStatus::Pending))
        .expect("candidates");
    let before = documents[0].pending_count;
    service
        .confirm_candidate(ConfirmCandidateInput {
            candidate_id: pending[0].id.clone(),
            edited_payload: None,
        })
        .expect("confirm");
    let documents = service.list_documents(&trip.id).expect("list");
    assert_eq!(documents[0].pending_count, before - 1);
    assert_eq!(documents[0].confirmed_count, 1);
    cleanup_database(database);
}

#[test]
fn a_document_body_is_readable_back_and_gone_after_deletion() {
    let database = temp_database("documents-read");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let document_id = import_stay_text(&service, &trip.id);

    // The body is sealed at rest but must come back intact — this is the
    // whole point of the manager: seeing what you handed over.
    let stored = service.get_document(&document_id).expect("get");
    assert!(stored.content.contains("River Paper Inn"));
    assert_eq!(stored.document.id, document_id);

    service.delete_document(&document_id).expect("delete");
    assert_eq!(
        service.get_document(&document_id).unwrap_err().code,
        ErrorCode::DocumentNotFound
    );
    assert!(service.list_documents(&trip.id).expect("list").is_empty());
    cleanup_database(database);
}

#[test]
fn deleting_a_document_drops_pending_candidates_but_keeps_confirmed_facts() {
    let database = temp_database("documents-cascade");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let (document_id, candidates) = import_flight_memo(&service, &trip.id);

    // Confirm one candidate; anything else stays pending.
    service
        .confirm_candidate(ConfirmCandidateInput {
            candidate_id: candidates[0].clone(),
            edited_payload: None,
        })
        .expect("confirm");

    service.delete_document(&document_id).expect("delete");

    // Pending candidates were unreviewed derivatives of a discarded body.
    assert!(
        service
            .list_candidates(&trip.id, Some(CandidateStatus::Pending))
            .expect("candidates")
            .is_empty()
    );
    // The confirmed fact survives — the traveler approved it — but it is
    // flagged, so the UI stops offering evidence that no longer exists.
    let detail = service.get_trip(&trip.id).expect("detail");
    assert_eq!(detail.confirmed_facts.len(), 1);
    assert!(detail.confirmed_facts[0].source_removed);
    // And it must not be mistaken for a fact the traveler typed by hand.
    assert_ne!(detail.confirmed_facts[0].method, ExtractionMethod::Manual);
    cleanup_database(database);
}

#[test]
fn a_manual_fact_is_never_flagged_as_source_removed() {
    let database = temp_database("documents-manual");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let (document_id, _) = import_flight_memo(&service, &trip.id);
    let manual = service
        .add_manual_fact(AddManualFactInput {
            trip_id: trip.id.clone(),
            fact_type: FactType::LodgingStay,
            payload: FactPayload {
                property_name: Some("Hand typed".to_owned()),
                checkin_date: Some("2027-04-02".to_owned()),
                checkout_date: Some("2027-04-08".to_owned()),
                ..FactPayload::default()
            },
        })
        .expect("manual");

    // Deleting an unrelated document must not touch a hand-typed fact: it
    // has no candidate, so nothing links it to the document.
    service.delete_document(&document_id).expect("delete");
    let detail = service.get_trip(&trip.id).expect("detail");
    let stored = detail
        .confirmed_facts
        .iter()
        .find(|fact| fact.id == manual.id)
        .expect("manual fact survives");
    assert!(!stored.source_removed);
    assert!(stored.candidate_id.is_none());
    cleanup_database(database);
}

#[test]
fn deleting_a_document_that_does_not_exist_is_an_error_not_a_silent_success() {
    let database = temp_database("documents-missing");
    let service = open_test_service(&database).expect("service");
    assert_eq!(
        service.delete_document("document_nope").unwrap_err().code,
        ErrorCode::DocumentNotFound
    );
    cleanup_database(database);
}

#[test]
fn unarchive_restores_an_archived_trip_to_draft() {
    let database = temp_database("unarchive");
    let service = open_test_service(&database).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    assert_eq!(
        service.archive_trip(&trip.id).expect("archive").status,
        TripStatus::Archived
    );
    assert_eq!(
        service.unarchive_trip(&trip.id).expect("unarchive").status,
        TripStatus::Draft
    );
    cleanup_database(database);
}

#[test]
fn a_weather_network_failure_is_a_weather_error_not_an_advice_one() {
    let database = temp_database("weather-neterr");
    let service =
        open_test_service_with_fetcher(&database, Arc::new(FakeFetcher::new())).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    // fetch_weather re-flavors the fetch failure so the panel never wears
    // travel-advice wording.
    assert_eq!(
        service
            .fetch_weather(&trip.id)
            .expect_err("weather fails")
            .code,
        ErrorCode::WeatherFetchFailed
    );
    cleanup_database(database);
}
