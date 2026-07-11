use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderValue, Method, Request, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use voyalier_app::AppService;
use voyalier_core::{
    AddManualFactInput, AppError, CandidateFact, CandidateStatus, ConfirmCandidateInput,
    ConfirmedFact, CreateTripInput, ErrorCode, HealthResponse, ImportDocumentInput,
    UpdateTripInput,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmCandidateResponse {
    candidate: CandidateFact,
    confirmed_fact: ConfirmedFact,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateQuery {
    status: Option<CandidateStatus>,
}

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchAdviceBody {
    country_slug: String,
}

#[derive(Debug)]
struct ApiError(AppError);

impl From<AppError> for ApiError {
    fn from(error: AppError) -> Self {
        Self(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = status_for_error(self.0.code);
        (status, Json(self.0)).into_response()
    }
}

pub fn app(service: AppService) -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://127.0.0.1:5173"),
            HeaderValue::from_static("http://localhost:5173"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/v1/trips", post(create_trip).get(list_trips))
        .route(
            "/api/v1/trips/{trip_id}",
            get(get_trip).patch(update_trip).delete(delete_trip),
        )
        .route("/api/v1/trips/{trip_id}/archive", post(archive_trip))
        .route("/api/v1/advice/countries", get(list_advice_countries))
        .route("/api/v1/local-ai", get(detect_local_ai))
        .route("/api/v1/trips/{trip_id}/brief", get(get_trip_brief))
        .route(
            "/api/v1/trips/{trip_id}/travel-advice",
            post(fetch_travel_advice),
        )
        .route("/api/v1/trips/{trip_id}/weather", post(fetch_weather))
        .route("/api/v1/trips/{trip_id}/search", get(search_trip))
        .route("/api/v1/trips/{trip_id}/documents", post(import_document))
        .route("/api/v1/trips/{trip_id}/candidates", get(list_candidates))
        .route(
            "/api/v1/candidates/{candidate_id}/confirm",
            post(confirm_candidate),
        )
        .route(
            "/api/v1/candidates/{candidate_id}/reject",
            post(reject_candidate),
        )
        .route("/api/v1/trips/{trip_id}/facts", post(add_manual_fact))
        .route("/api/v1/facts/{fact_id}", delete(unconfirm_fact))
        .with_state(service)
        .layer(middleware::from_fn(validate_host_origin))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

async fn health(State(service): State<AppService>) -> Result<Json<HealthResponse>, ApiError> {
    Ok(Json(service.health()?))
}

async fn create_trip(
    State(service): State<AppService>,
    Json(input): Json<CreateTripInput>,
) -> Result<impl IntoResponse, ApiError> {
    Ok((StatusCode::CREATED, Json(service.create_trip(input)?)))
}

async fn list_trips(State(service): State<AppService>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_trips()?))
}

async fn get_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_trip(&trip_id)?))
}

async fn update_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(input): Json<UpdateTripInput>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.update_trip(&trip_id, input)?))
}

async fn archive_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.archive_trip(&trip_id)?))
}

async fn get_trip_brief(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_trip_brief(&trip_id)?))
}

async fn search_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.search_trip(&trip_id, &query.q)?))
}

async fn list_advice_countries(
    State(service): State<AppService>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_advice_countries()))
}

async fn detect_local_ai(State(service): State<AppService>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.detect_local_ai()))
}

async fn fetch_travel_advice(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(body): Json<FetchAdviceBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(
        service.fetch_travel_advice(&trip_id, &body.country_slug)?,
    ))
}

async fn fetch_weather(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.fetch_weather(&trip_id)?))
}

async fn delete_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    service.delete_trip(&trip_id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn import_document(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(input): Json<ImportDocumentInput>,
) -> Result<impl IntoResponse, ApiError> {
    ensure_path_trip_matches(&trip_id, &input.trip_id)?;
    Ok((StatusCode::CREATED, Json(service.import_document(input)?)))
}

async fn list_candidates(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<CandidateQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_candidates(&trip_id, query.status)?))
}

async fn confirm_candidate(
    State(service): State<AppService>,
    Path(candidate_id): Path<String>,
    Json(input): Json<ConfirmCandidateInput>,
) -> Result<impl IntoResponse, ApiError> {
    ensure_path_candidate_matches(&candidate_id, &input.candidate_id)?;
    let (candidate, confirmed_fact) = service.confirm_candidate(input)?;
    Ok(Json(ConfirmCandidateResponse {
        candidate,
        confirmed_fact,
    }))
}

async fn reject_candidate(
    State(service): State<AppService>,
    Path(candidate_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.reject_candidate(&candidate_id)?))
}

async fn add_manual_fact(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(input): Json<AddManualFactInput>,
) -> Result<impl IntoResponse, ApiError> {
    ensure_path_trip_matches(&trip_id, &input.trip_id)?;
    Ok((StatusCode::CREATED, Json(service.add_manual_fact(input)?)))
}

async fn unconfirm_fact(
    State(service): State<AppService>,
    Path(fact_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    service.unconfirm_fact(&fact_id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn validate_host_origin(request: Request<Body>, next: Next) -> Response {
    if !host_is_allowed(&request) || !origin_is_allowed(&request) {
        return ApiError(AppError::new(
            ErrorCode::TransportFailure,
            "request host or origin is not allowed",
        ))
        .into_response();
    }
    next.run(request).await
}

fn ensure_path_trip_matches(path_trip_id: &str, body_trip_id: &str) -> Result<(), ApiError> {
    if path_trip_id != body_trip_id {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "path tripId does not match body tripId",
            "field",
            "tripId",
        )
        .into());
    }
    Ok(())
}

fn ensure_path_candidate_matches(
    path_candidate_id: &str,
    body_candidate_id: &str,
) -> Result<(), ApiError> {
    if path_candidate_id != body_candidate_id {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "path candidateId does not match body candidateId",
            "field",
            "candidateId",
        )
        .into());
    }
    Ok(())
}

fn host_is_allowed(request: &Request<Body>) -> bool {
    let Some(host) = request.headers().get(header::HOST) else {
        return true;
    };
    let Ok(host) = host.to_str() else {
        return false;
    };
    matches!(
        host,
        "127.0.0.1:8787" | "localhost:8787" | "127.0.0.1" | "localhost"
    )
}

fn origin_is_allowed(request: &Request<Body>) -> bool {
    let Some(origin) = request.headers().get(header::ORIGIN) else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    matches!(origin, "http://127.0.0.1:5173" | "http://localhost:5173")
}

fn status_for_error(code: ErrorCode) -> StatusCode {
    match code {
        ErrorCode::ValidationInvalidInput | ErrorCode::ValidationInvalidDateRange => {
            StatusCode::BAD_REQUEST
        }
        ErrorCode::TripNotFound | ErrorCode::CandidateNotFound | ErrorCode::FactNotFound => {
            StatusCode::NOT_FOUND
        }
        ErrorCode::CandidateAlreadyResolved | ErrorCode::DocumentDuplicate => StatusCode::CONFLICT,
        ErrorCode::DocumentTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        ErrorCode::AdviceFetchFailed => StatusCode::BAD_GATEWAY,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use axum::body::to_bytes;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn http_contract_endpoints_work() {
        let database = temp_database("contract");
        let service = AppService::open_path(&database).expect("service");
        let router = app(service);

        let health = request(router.clone(), Method::GET, "/api/health", None).await;
        assert_eq!(health.status, StatusCode::OK);
        assert_eq!(health.json["intelligenceMode"], "local");

        let create = request(
            router.clone(),
            Method::POST,
            "/api/v1/trips",
            Some(json!({
                "origin": "Chicago",
                "destination": "Kyoto",
                "startDate": "2027-04-01",
                "endDate": "2027-04-10"
            })),
        )
        .await;
        assert_eq!(create.status, StatusCode::CREATED);
        let trip_id = create.json["id"].as_str().expect("trip id").to_owned();

        assert_eq!(
            request(router.clone(), Method::GET, "/api/v1/trips", None)
                .await
                .status,
            StatusCode::OK
        );
        assert_eq!(
            request(
                router.clone(),
                Method::GET,
                &format!("/api/v1/trips/{trip_id}"),
                None,
            )
            .await
            .status,
            StatusCode::OK
        );

        let patch = request(
            router.clone(),
            Method::PATCH,
            &format!("/api/v1/trips/{trip_id}"),
            Some(json!({ "title": "Kyoto spring" })),
        )
        .await;
        assert_eq!(patch.status, StatusCode::OK);
        assert_eq!(patch.json["title"], "Kyoto spring");

        let imported = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/documents"),
            Some(json!({
                "tripId": trip_id,
                "kind": "pasted_text",
                "label": "Flight memo",
                "content": "Confirmation HOLD9\nRoute SFO-NRT\nDeparture 2027-04-02T10:00"
            })),
        )
        .await;
        assert_eq!(imported.status, StatusCode::CREATED);
        assert!(imported.json.get("document").is_some());
        assert!(imported.json["document"].get("content").is_none());
        let candidate_id = imported.json["candidates"][0]["id"]
            .as_str()
            .expect("candidate id")
            .to_owned();

        let candidates = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/candidates?status=pending"),
            None,
        )
        .await;
        assert_eq!(candidates.status, StatusCode::OK);
        assert_eq!(candidates.json.as_array().expect("array").len(), 1);

        let confirmed = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/candidates/{candidate_id}/confirm"),
            Some(json!({ "candidateId": candidate_id })),
        )
        .await;
        assert_eq!(confirmed.status, StatusCode::OK);
        let fact_id = confirmed.json["confirmedFact"]["id"]
            .as_str()
            .expect("fact id")
            .to_owned();

        let unconfirm = request(
            router.clone(),
            Method::DELETE,
            &format!("/api/v1/facts/{fact_id}"),
            None,
        )
        .await;
        assert_eq!(unconfirm.status, StatusCode::NO_CONTENT);

        let rejected = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/candidates/{candidate_id}/reject"),
            None,
        )
        .await;
        assert_eq!(rejected.status, StatusCode::OK);
        assert_eq!(rejected.json["status"], "rejected");

        let manual = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/facts"),
            Some(json!({
                "tripId": trip_id,
                "factType": "flight_segment",
                "payload": {
                    "departureAirportIata": "SFO",
                    "arrivalAirportIata": "NRT",
                    "departureLocal": "2027-04-02T10:00",
                    "confirmationCode": "PNR-SECRET",
                    "passengerName": "Test Traveler"
                }
            })),
        )
        .await;
        assert_eq!(manual.status, StatusCode::CREATED);

        // Local search reaches documents and facts with provenance.
        let search = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/search?q=SFO"),
            None,
        )
        .await;
        assert_eq!(search.status, StatusCode::OK);
        let search_hits = search.json.as_array().expect("hits");
        assert!(!search_hits.is_empty());
        assert!(search_hits.iter().all(|hit| hit.get("recordId").is_some()));
        let empty_query = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/search?q=%20"),
            None,
        )
        .await;
        assert_eq!(empty_query.status, StatusCode::BAD_REQUEST);

        // The shareable brief is served redacted: secrets never reach the wire.
        let brief = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/brief"),
            None,
        )
        .await;
        assert_eq!(brief.status, StatusCode::OK);
        assert!(brief.json.get("redactedFields").is_some());
        let brief_text = brief.json.to_string();
        assert!(!brief_text.contains("PNR-SECRET"));
        assert!(!brief_text.contains("Test Traveler"));

        assert_eq!(
            request(
                router.clone(),
                Method::POST,
                &format!("/api/v1/trips/{trip_id}/archive"),
                None,
            )
            .await
            .json["status"],
            "archived"
        );

        let deleted = request(
            router,
            Method::DELETE,
            &format!("/api/v1/trips/{trip_id}"),
            None,
        )
        .await;
        assert_eq!(deleted.status, StatusCode::NO_CONTENT);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn http_error_paths_match_contract_status_map() {
        let database = temp_database("errors");
        let service = AppService::open_path(&database).expect("service");
        let router = app(service);

        assert_eq!(
            request(router.clone(), Method::GET, "/api/v1/trips/missing", None)
                .await
                .status,
            StatusCode::NOT_FOUND
        );

        let invalid = request(
            router.clone(),
            Method::POST,
            "/api/v1/trips",
            Some(json!({
                "origin": "Chicago",
                "destination": "Kyoto",
                "startDate": "2027-04-11",
                "endDate": "2027-04-10"
            })),
        )
        .await;
        assert_eq!(invalid.status, StatusCode::BAD_REQUEST);

        let trip = create_trip_direct(&router).await;
        let document = json!({
            "tripId": trip["id"],
            "kind": "pasted_text",
            "content": "Confirmation DUP77\nRoute SFO-NRT\nDeparture 2027-04-02T10:00"
        });
        assert_eq!(
            request(
                router.clone(),
                Method::POST,
                &format!("/api/v1/trips/{}/documents", trip["id"].as_str().unwrap()),
                Some(document.clone()),
            )
            .await
            .status,
            StatusCode::CREATED
        );
        assert_eq!(
            request(
                router.clone(),
                Method::POST,
                &format!("/api/v1/trips/{}/documents", trip["id"].as_str().unwrap()),
                Some(document),
            )
            .await
            .status,
            StatusCode::CONFLICT
        );

        let too_large = request(
            router,
            Method::POST,
            &format!("/api/v1/trips/{}/documents", trip["id"].as_str().unwrap()),
            Some(json!({
                "tripId": trip["id"],
                "kind": "pasted_text",
                "content": "x".repeat(1_000_001)
            })),
        )
        .await;
        assert_eq!(too_large.status, StatusCode::PAYLOAD_TOO_LARGE);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn advice_endpoints_serve_countries_and_stubbed_snapshots() {
        use std::sync::Arc;
        use voyalier_app::AdviceFetcher;

        struct StubFetcher;
        impl AdviceFetcher for StubFetcher {
            fn fetch_text(&self, url: &str) -> Result<String, AppError> {
                if url.contains("11434") {
                    return Ok(r#"{ "models": [ { "name": "llama3.2:latest" } ] }"#.to_owned());
                }
                if url.contains("geocoding-api.open-meteo.com") {
                    return Ok(r#"{ "results": [ { "name": "Kyoto", "latitude": 35.0,
                        "longitude": 135.8, "country": "Japan" } ] }"#
                        .to_owned());
                }
                if url.contains("api.open-meteo.com") {
                    return Ok(r#"{ "daily": {
                        "time": ["2027-04-01"],
                        "weather_code": [2],
                        "temperature_2m_max": [17.0],
                        "temperature_2m_min": [8.0],
                        "precipitation_probability_max": [10]
                    } }"#
                        .to_owned());
                }
                Ok(
                    r#"{ "description": "FCDO travel advice for Japan.", "details": {} }"#
                        .to_owned(),
                )
            }
        }

        let database = temp_database("advice");
        let service =
            AppService::open_path_with_fetcher(&database, Arc::new(StubFetcher)).expect("service");
        let router = app(service);

        let local_ai = request(router.clone(), Method::GET, "/api/v1/local-ai", None).await;
        assert_eq!(local_ai.status, StatusCode::OK);
        assert_eq!(local_ai.json["available"], true);
        assert_eq!(local_ai.json["provider"], "ollama");
        assert_eq!(local_ai.json["models"][0]["name"], "llama3.2:latest");

        let countries = request(
            router.clone(),
            Method::GET,
            "/api/v1/advice/countries",
            None,
        )
        .await;
        assert_eq!(countries.status, StatusCode::OK);
        assert!(
            countries
                .json
                .as_array()
                .expect("countries")
                .iter()
                .any(|country| country["slug"] == "japan")
        );

        let trip = create_trip_direct(&router).await;
        let trip_id = trip["id"].as_str().expect("trip id");

        let fetched = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/travel-advice"),
            Some(json!({ "countrySlug": "japan" })),
        )
        .await;
        assert_eq!(fetched.status, StatusCode::OK);
        assert_eq!(fetched.json["countryName"], "Japan");
        assert!(fetched.json.get("retrievedAt").is_some());

        // The snapshot rides on the trip detail afterwards.
        let detail = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}"),
            None,
        )
        .await;
        assert_eq!(detail.json["travelAdvice"]["countrySlug"], "japan");

        let bad_slug = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/travel-advice"),
            Some(json!({ "countrySlug": "atlantis" })),
        )
        .await;
        assert_eq!(bad_slug.status, StatusCode::BAD_REQUEST);

        // Weather rides the same consent-gated pattern, no request body needed.
        let weather = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/weather"),
            None,
        )
        .await;
        assert_eq!(weather.status, StatusCode::OK);
        assert_eq!(weather.json["placeName"], "Kyoto");
        assert_eq!(weather.json["days"][0]["description"], "Partly cloudy");

        let detail = request(
            router,
            Method::GET,
            &format!("/api/v1/trips/{trip_id}"),
            None,
        )
        .await;
        assert_eq!(detail.json["weather"]["placeName"], "Kyoto");
        cleanup_database(database);
    }

    #[tokio::test]
    async fn rejects_tauri_origins_and_unexpected_hosts() {
        let database = temp_database("origin");
        let service = AppService::open_path(&database).expect("service");
        let router = app(service);
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .header(header::HOST, "127.0.0.1:8787")
                    .header(header::ORIGIN, "tauri://localhost")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        let response = router
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/api/health")
                    .header(header::HOST, "example.invalid")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        cleanup_database(database);
    }

    async fn create_trip_direct(router: &Router) -> Value {
        request(
            router.clone(),
            Method::POST,
            "/api/v1/trips",
            Some(json!({
                "origin": "Chicago",
                "destination": "Kyoto",
                "startDate": "2027-04-01",
                "endDate": "2027-04-10"
            })),
        )
        .await
        .json
    }

    struct TestResponse {
        status: StatusCode,
        json: Value,
    }

    async fn request(
        router: Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> TestResponse {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "127.0.0.1:8787")
            .header(header::CONTENT_TYPE, "application/json")
            .body(match body {
                Some(body) => Body::from(serde_json::to_vec(&body).expect("body")),
                None => Body::empty(),
            })
            .expect("request");
        let response = router.oneshot(request).await.expect("response");
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("bytes");
        let json = if body.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&body).expect("json response")
        };
        TestResponse { status, json }
    }

    fn temp_database(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("voyalier-server-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join("voyalier.sqlite3")
    }

    fn cleanup_database(database: PathBuf) {
        if let Some(parent) = database.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
