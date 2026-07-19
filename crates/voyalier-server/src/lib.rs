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
    ConfirmedFact, CreateTripInput, ErrorCode, HealthResponse, ImportDocumentInput, PersonaWeights,
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
struct AssistPreviewQuery {
    provider: String,
}

#[derive(Debug, Deserialize)]
struct FieldSuggestionsQuery {
    field: String,
    #[serde(default)]
    q: String,
}

#[derive(Debug, Deserialize)]
struct RunAssistBody {
    provider: String,
}

#[derive(Debug, Deserialize)]
struct AssistDraftQuery {
    kind: String,
}

#[derive(Debug, Deserialize)]
struct AssistDraftBody {
    kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetAiPromptBody {
    kind: String,
    #[serde(default)]
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchAdviceBody {
    country_slug: String,
}

#[derive(Debug, Deserialize)]
struct SetProviderKeyBody {
    key: String,
}

#[derive(Debug, Deserialize)]
struct SetProviderModelBody {
    model: String,
}

#[derive(Debug, Deserialize)]
struct PullModelBody {
    model: String,
}

#[derive(Debug, Deserialize)]
struct PassphraseBody {
    passphrase: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineMapRangeBody {
    pack_id: String,
    offset: u64,
    length: u32,
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
        .route("/api/v1/trips/{trip_id}/unarchive", post(unarchive_trip))
        .route("/api/v1/advice/countries", get(list_advice_countries))
        .route("/api/v1/packs", get(list_packs))
        .route(
            "/api/v1/trips/{trip_id}/pack-suggestions",
            get(suggest_packs),
        )
        .route(
            "/api/v1/trips/{trip_id}/field-suggestions",
            get(suggest_field_values),
        )
        .route("/api/v1/places/suggest", get(suggest_places))
        .route("/api/v1/trips/{trip_id}/packs", get(list_downloaded_packs))
        .route(
            "/api/v1/trips/{trip_id}/packs/{pack_id}",
            post(download_pack).delete(delete_downloaded_pack),
        )
        .route("/api/v1/trips/{trip_id}/offline-map", get(get_offline_map))
        .route(
            "/api/v1/trips/{trip_id}/offline-map/range",
            post(read_offline_map_range),
        )
        .route("/api/v1/local-ai", get(detect_local_ai))
        .route("/api/v1/local-ai/pull", post(pull_local_model))
        .route("/api/v1/providers", get(list_providers))
        .route(
            "/api/v1/providers/{provider}/key",
            post(set_provider_key).delete(clear_provider_key),
        )
        .route(
            "/api/v1/providers/{provider}/validate",
            post(validate_provider_key),
        )
        .route(
            "/api/v1/providers/{provider}/model",
            post(set_provider_model),
        )
        .route("/api/v1/trips/{trip_id}/brief", get(get_trip_brief))
        .route("/api/v1/trips/{trip_id}/today", get(get_today))
        .route("/api/v1/vault", get(get_vault_status))
        .route("/api/v1/vault/passphrase", post(set_vault_passphrase))
        .route("/api/v1/vault/unlock", post(unlock_vault))
        .route(
            "/api/v1/vault/remove-passphrase",
            post(remove_vault_passphrase),
        )
        .route(
            "/api/v1/trips/{trip_id}/assist-preview",
            get(preview_assist),
        )
        .route("/api/v1/trips/{trip_id}/assist", post(run_assist))
        .route(
            "/api/v1/trips/{trip_id}/assist-draft-preview",
            get(preview_assist_draft),
        )
        .route(
            "/api/v1/trips/{trip_id}/assist-draft",
            post(run_assist_draft),
        )
        .route(
            "/api/v1/ai/prompts",
            get(get_ai_prompts).post(set_ai_prompt),
        )
        .route(
            "/api/v1/trips/{trip_id}/assist-activity",
            get(list_assist_activity),
        )
        .route("/api/v1/trips/{trip_id}/advisories", post(fetch_advisories))
        .route("/api/v1/trips/{trip_id}/weather", post(fetch_weather))
        .route(
            "/api/v1/trips/{trip_id}/destination-facts",
            post(fetch_destination_facts),
        )
        .route(
            "/api/v1/trips/{trip_id}/holidays",
            post(fetch_public_holidays),
        )
        .route("/api/v1/trips/{trip_id}/summary", post(fetch_place_summary))
        .route("/api/v1/trips/{trip_id}/search", get(search_trip))
        .route(
            "/api/v1/trips/{trip_id}/search-suggestions",
            get(suggest_search_terms),
        )
        .route(
            "/api/v1/trips/{trip_id}/recommendations",
            post(get_recommendations),
        )
        .route(
            "/api/v1/trips/{trip_id}/notes",
            get(get_trip_notes).post(set_trip_notes),
        )
        .route(
            "/api/v1/trips/{trip_id}/documents",
            post(import_document).get(list_documents),
        )
        .route(
            "/api/v1/documents/{document_id}",
            get(get_document).delete(delete_document),
        )
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

async fn unarchive_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.unarchive_trip(&trip_id)?))
}

async fn get_trip_brief(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_trip_brief(&trip_id)?))
}

async fn get_today(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_today(&trip_id)?))
}

async fn get_vault_status(
    State(service): State<AppService>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_vault_status()?))
}

async fn set_vault_passphrase(
    State(service): State<AppService>,
    Json(body): Json<PassphraseBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.set_vault_passphrase(&body.passphrase)?))
}

async fn unlock_vault(
    State(service): State<AppService>,
    Json(body): Json<PassphraseBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.unlock_vault(&body.passphrase)?))
}

async fn remove_vault_passphrase(
    State(service): State<AppService>,
    Json(body): Json<PassphraseBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.remove_vault_passphrase(&body.passphrase)?))
}

async fn search_trip(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.search_trip(&trip_id, &query.q)?))
}

async fn suggest_search_terms(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.suggest_search_terms(&trip_id, &query.q)?))
}

async fn get_recommendations(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(weights): Json<PersonaWeights>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_recommendations(&trip_id, weights)?))
}

async fn preview_assist(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<AssistPreviewQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.preview_assist(&trip_id, &query.provider)?))
}

async fn run_assist(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(body): Json<RunAssistBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.run_assist(&trip_id, &body.provider)?))
}

async fn preview_assist_draft(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<AssistDraftQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.preview_assist_draft(&trip_id, &query.kind)?))
}

async fn run_assist_draft(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(body): Json<AssistDraftBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.run_assist_draft(&trip_id, &body.kind)?))
}

async fn get_ai_prompts(State(service): State<AppService>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_ai_prompts()?))
}

async fn set_ai_prompt(
    State(service): State<AppService>,
    Json(body): Json<SetAiPromptBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(
        service.set_ai_prompt(&body.kind, body.text.as_deref())?,
    ))
}

async fn list_assist_activity(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_assist_activity(&trip_id)?))
}

async fn list_advice_countries(
    State(service): State<AppService>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_advice_countries()))
}

async fn list_packs(State(service): State<AppService>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_packs()))
}

async fn suggest_packs(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.suggest_packs(&trip_id)?))
}

async fn suggest_field_values(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Query(query): Query<FieldSuggestionsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.suggest_field_values(
        &trip_id,
        &query.field,
        &query.q,
    )?))
}

async fn suggest_places(
    State(service): State<AppService>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.suggest_places(&query.q)?))
}

async fn list_downloaded_packs(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_downloaded_packs(&trip_id)?))
}

async fn download_pack(
    State(service): State<AppService>,
    Path((trip_id, pack_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.download_pack(&trip_id, &pack_id)?))
}

async fn delete_downloaded_pack(
    State(service): State<AppService>,
    Path((trip_id, pack_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, ApiError> {
    service.delete_downloaded_pack(&trip_id, &pack_id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_offline_map(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_offline_map(&trip_id)?))
}

async fn read_offline_map_range(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(body): Json<OfflineMapRangeBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.read_offline_map_range(
        &trip_id,
        &body.pack_id,
        body.offset,
        body.length,
    )?))
}

async fn detect_local_ai(State(service): State<AppService>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.detect_local_ai()))
}

async fn pull_local_model(
    State(service): State<AppService>,
    Json(body): Json<PullModelBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.pull_local_model(&body.model)?))
}

async fn validate_provider_key(
    State(service): State<AppService>,
    Path(provider): Path<String>,
    Json(body): Json<SetProviderKeyBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.validate_provider_key(&provider, &body.key)?))
}

async fn list_providers(State(service): State<AppService>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_providers()?))
}

async fn set_provider_key(
    State(service): State<AppService>,
    Path(provider): Path<String>,
    Json(body): Json<SetProviderKeyBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.set_provider_key(&provider, &body.key)?))
}

async fn clear_provider_key(
    State(service): State<AppService>,
    Path(provider): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.clear_provider_key(&provider)?))
}

async fn set_provider_model(
    State(service): State<AppService>,
    Path(provider): Path<String>,
    Json(body): Json<SetProviderModelBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.set_provider_model(&provider, &body.model)?))
}

async fn fetch_advisories(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(body): Json<FetchAdviceBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(
        service.fetch_advisories(&trip_id, &body.country_slug)?,
    ))
}

async fn fetch_weather(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.fetch_weather(&trip_id)?))
}

async fn fetch_destination_facts(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.fetch_destination_facts(&trip_id)?))
}

async fn fetch_public_holidays(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.fetch_public_holidays(&trip_id)?))
}

async fn fetch_place_summary(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.fetch_place_summary(&trip_id)?))
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

async fn get_trip_notes(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_trip_notes(&trip_id)?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesBody {
    body: String,
}

async fn set_trip_notes(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
    Json(input): Json<NotesBody>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.set_trip_notes(&trip_id, &input.body)?))
}

async fn list_documents(
    State(service): State<AppService>,
    Path(trip_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.list_documents(&trip_id)?))
}

async fn get_document(
    State(service): State<AppService>,
    Path(document_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(service.get_document(&document_id)?))
}

async fn delete_document(
    State(service): State<AppService>,
    Path(document_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    service.delete_document(&document_id)?;
    Ok(StatusCode::NO_CONTENT)
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
        // A blocked host/origin is an authorization rejection (the DNS-rebinding
        // guard), not a server fault — respond 403, not 500.
        return (
            StatusCode::FORBIDDEN,
            Json(AppError::new(
                ErrorCode::TransportFailure,
                "request host or origin is not allowed",
            )),
        )
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
        ErrorCode::TripNotFound
        | ErrorCode::CandidateNotFound
        | ErrorCode::FactNotFound
        | ErrorCode::DocumentNotFound => StatusCode::NOT_FOUND,
        ErrorCode::CandidateAlreadyResolved | ErrorCode::DocumentDuplicate => StatusCode::CONFLICT,
        ErrorCode::DocumentTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        ErrorCode::AdviceFetchFailed
        | ErrorCode::WeatherFetchFailed
        | ErrorCode::AssistFailed
        | ErrorCode::AssistUnreachable
        | ErrorCode::PackDownloadFailed => StatusCode::BAD_GATEWAY,
        ErrorCode::VaultLocked => StatusCode::LOCKED,
        ErrorCode::VaultPassphraseIncorrect => StatusCode::UNAUTHORIZED,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use axum::body::to_bytes;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn http_contract_endpoints_work() {
        let database = temp_database("contract");
        let service = open_test_service(&database).expect("service");
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

        // The documents manager over HTTP: list, read one back, then delete.
        let documents = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/documents"),
            None,
        )
        .await;
        assert_eq!(documents.status, StatusCode::OK);
        assert_eq!(documents.json.as_array().expect("documents").len(), 1);
        let document_id = documents.json[0]["document"]["id"]
            .as_str()
            .expect("document id")
            .to_owned();

        let body = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/documents/{document_id}"),
            None,
        )
        .await;
        assert_eq!(body.status, StatusCode::OK);
        assert!(
            body.json["content"]
                .as_str()
                .expect("content")
                .contains("HOLD9")
        );

        let removed = request(
            router.clone(),
            Method::DELETE,
            &format!("/api/v1/documents/{document_id}"),
            None,
        )
        .await;
        assert_eq!(removed.status, StatusCode::NO_CONTENT);
        // A second delete is a 404, not a silent success.
        let again = request(
            router.clone(),
            Method::DELETE,
            &format!("/api/v1/documents/{document_id}"),
            None,
        )
        .await;
        assert_eq!(again.status, StatusCode::NOT_FOUND);

        // Re-import so the rest of the walkthrough still has its candidates.
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
        let service = open_test_service(&database).expect("service");
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
                if url.contains("cadataapi.state.gov") {
                    return Ok(
                        r#"[{ "Title": "Japan - Level 1: Exercise Normal Precautions",
                        "Link": "https://travel.state.gov/japan", "Category": ["JA"],
                        "Summary": "<p>Exercise normal precautions.</p>",
                        "Updated": "2025-05-14T20:00:00-04:00" }]"#
                            .to_owned(),
                    );
                }
                if url.contains("data.international.gc.ca") {
                    return Ok(r#"{ "data": { "JP": { "country-iso": "JP",
                        "advisory-state": 0, "date-published": { "asp": "2026-07-16T12:53:48.9-04:00" },
                        "eng": { "url-slug": "japan",
                                 "advisory-text": "Exercise normal security precautions" } } } }"#
                        .to_owned());
                }
                if url.contains("auswaertiges-amt.de") {
                    return Ok(r#"{ "response": { "lastModified": 1757063288,
                        "213032": { "title": "Japan: Reise- und Sicherheitshinweise",
                        "countryCode": "JP", "countryName": "Japan", "warning": false,
                        "partialWarning": false, "situationWarning": false,
                        "situationPartWarning": false } } }"#
                        .to_owned());
                }
                if url.contains("wwwnc.cdc.gov") {
                    return Ok(
                        r#"<rss version="2.0"><channel><title>CDC</title></channel></rss>"#
                            .to_owned(),
                    );
                }
                Ok(
                    r#"{ "description": "FCDO travel advice for Japan.", "details": {} }"#
                        .to_owned(),
                )
            }
        }

        let database = temp_database("advice");
        let service =
            open_test_service_with_fetcher(&database, Arc::new(StubFetcher)).expect("service");
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
            &format!("/api/v1/trips/{trip_id}/advisories"),
            Some(json!({ "countrySlug": "japan" })),
        )
        .await;
        assert_eq!(fetched.status, StatusCode::OK);
        assert_eq!(fetched.json["countryName"], "Japan");
        assert!(fetched.json.get("retrievedAt").is_some());
        // Every government reaches the wire on one click, each in its own card.
        let sources = fetched.json["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .map(|entry| entry["source"].as_str().expect("source").to_owned())
            .collect::<Vec<_>>();
        assert_eq!(sources, ["uk-fcdo", "us-state", "ca-gac", "de-aa"]);
        assert_eq!(fetched.json["entries"][1]["levelRank"], 1);
        // The German card carries its own language tag, untranslated.
        assert_eq!(fetched.json["entries"][3]["language"], "de");

        // The panel rides on the trip detail afterwards.
        let detail = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}"),
            None,
        )
        .await;
        assert_eq!(detail.json["advisoryPanel"]["countrySlug"], "japan");

        let bad_slug = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/advisories"),
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
    async fn provider_endpoints_manage_keys_without_touching_the_keychain() {
        use std::sync::Arc;
        use voyalier_app::MemorySecretStore;

        struct NoFetcher;
        impl voyalier_app::AdviceFetcher for NoFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Ok(String::new())
            }
            // Canned responses (no real network) so the validate/pull routes can be
            // exercised end-to-end: a 200 accepts the key, a success body installs.
            fn get_status(&self, _url: &str, _headers: &[(&str, &str)]) -> Result<u16, AppError> {
                Ok(200)
            }
            fn post_json_long(&self, _url: &str, _body: &str) -> Result<String, AppError> {
                Ok(r#"{"status":"success"}"#.to_owned())
            }
        }

        let database = temp_database("providers");
        let service = AppService::open_path_with_deps(
            &database,
            Arc::new(NoFetcher),
            Arc::new(MemorySecretStore::default()),
        )
        .expect("service");
        let router = app(service);

        let list = request(router.clone(), Method::GET, "/api/v1/providers", None).await;
        assert_eq!(list.status, StatusCode::OK);
        assert_eq!(list.json.as_array().expect("providers").len(), 3);

        let set = request(
            router.clone(),
            Method::POST,
            "/api/v1/providers/openai/key",
            Some(json!({ "key": "sk-fake-server" })),
        )
        .await;
        assert_eq!(set.status, StatusCode::OK);
        assert_eq!(set.json["hasKey"], true);
        // The key must never echo back.
        assert!(
            !serde_json::to_string(&set.json)
                .unwrap()
                .contains("sk-fake-server")
        );

        let bad = request(
            router.clone(),
            Method::POST,
            "/api/v1/providers/ollama/key",
            Some(json!({ "key": "x" })),
        )
        .await;
        assert_eq!(bad.status, StatusCode::BAD_REQUEST);

        // Validate a key without storing it — the key must never echo back.
        let validated = request(
            router.clone(),
            Method::POST,
            "/api/v1/providers/openai/validate",
            Some(json!({ "key": "sk-validate-me" })),
        )
        .await;
        assert_eq!(validated.status, StatusCode::OK);
        assert_eq!(validated.json["status"], "valid");
        assert!(
            !serde_json::to_string(&validated.json)
                .unwrap()
                .contains("sk-validate-me")
        );

        // A keyless provider has no key to validate.
        let keyless = request(
            router.clone(),
            Method::POST,
            "/api/v1/providers/ollama/validate",
            Some(json!({ "key": "x" })),
        )
        .await;
        assert_eq!(keyless.status, StatusCode::BAD_REQUEST);

        // Pull an on-device model (canned success).
        let pulled = request(
            router.clone(),
            Method::POST,
            "/api/v1/local-ai/pull",
            Some(json!({ "model": "gemma4:12b-it-qat" })),
        )
        .await;
        assert_eq!(pulled.status, StatusCode::OK);
        assert_eq!(pulled.json["ok"], true);

        let cleared = request(router, Method::DELETE, "/api/v1/providers/openai/key", None).await;
        assert_eq!(cleared.status, StatusCode::OK);
        assert_eq!(cleared.json["hasKey"], false);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn assist_preview_route_returns_a_redacted_request_preview() {
        // A fetcher that panics on any network use, plus an in-memory secret
        // store, so this test can never make a real cloud call or read a real
        // keychain — even if a key happened to be stored on this machine.
        struct NoNetwork;
        impl voyalier_app::AdviceFetcher for NoNetwork {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                panic!("no network in this test");
            }
        }

        let database = temp_database("assist-preview");
        let service = AppService::open_path_with_deps(
            &database,
            std::sync::Arc::new(NoNetwork),
            std::sync::Arc::new(voyalier_app::MemorySecretStore::default()),
        )
        .expect("service");
        let router = app(service);
        let trip = create_trip_direct(&router).await;
        let trip_id = trip["id"].as_str().expect("trip id");

        let ok = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/assist-preview?provider=openai"),
            None,
        )
        .await;
        assert_eq!(ok.status, StatusCode::OK);
        assert_eq!(ok.json["leavesDevice"], true);
        assert_eq!(
            ok.json["endpoint"],
            "https://api.openai.com/v1/chat/completions"
        );

        let bad = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/assist-preview?provider=bard"),
            None,
        )
        .await;
        assert_eq!(bad.status, StatusCode::BAD_REQUEST);

        // Cloud assist with no key stored is refused with a 400 before any
        // request — nothing leaves the device (the fetcher would panic if it
        // did). The happy path is covered at the app layer with a stub fetcher.
        let cloud = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/assist"),
            Some(json!({ "provider": "openai" })),
        )
        .await;
        assert_eq!(cloud.status, StatusCode::BAD_REQUEST);

        // The activity log route is reachable and starts empty (the cloud
        // attempt was refused before any call, so nothing is logged).
        let activity = request(
            router,
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/assist-activity"),
            None,
        )
        .await;
        assert_eq!(activity.status, StatusCode::OK);
        assert_eq!(activity.json.as_array().expect("array").len(), 0);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn today_route_returns_a_phase_for_the_trip() {
        let database = temp_database("today");
        let service = open_test_service(&database).expect("service");
        let router = app(service);
        let trip = create_trip_direct(&router).await;
        let trip_id = trip["id"].as_str().expect("id");

        let response = request(
            router,
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/today"),
            None,
        )
        .await;
        assert_eq!(response.status, StatusCode::OK);
        assert!(response.json["referenceDate"].as_str().is_some());
        assert!(response.json["phase"]["state"].as_str().is_some());
        cleanup_database(database);
    }

    #[tokio::test]
    async fn vault_routes_set_lock_and_unlock_with_a_passphrase() {
        use std::sync::Arc;
        use voyalier_app::MemorySecretStore;

        struct NoFetcher;
        impl voyalier_app::AdviceFetcher for NoFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Ok(String::new())
            }
        }

        // In-memory secret store so the vault is active and the test never
        // touches (or wipes) the real OS keychain.
        let database = temp_database("vault");
        let secrets = Arc::new(MemorySecretStore::default());
        let router =
            app(
                AppService::open_path_with_deps(&database, Arc::new(NoFetcher), secrets.clone())
                    .expect("service"),
            );

        let status = request(router.clone(), Method::GET, "/api/v1/vault", None).await;
        assert_eq!(status.status, StatusCode::OK);
        assert_eq!(status.json["active"], true);
        assert_eq!(status.json["protected"], false);

        // A too-short passphrase is rejected.
        let short = request(
            router.clone(),
            Method::POST,
            "/api/v1/vault/passphrase",
            Some(json!({ "passphrase": "short" })),
        )
        .await;
        assert_eq!(short.status, StatusCode::BAD_REQUEST);

        let set = request(
            router.clone(),
            Method::POST,
            "/api/v1/vault/passphrase",
            Some(json!({ "passphrase": "river-paper-inn" })),
        )
        .await;
        assert_eq!(set.status, StatusCode::OK);
        assert_eq!(set.json["protected"], true);

        // Reopening the same database finds the wrapped key and opens locked.
        let reopened =
            app(
                AppService::open_path_with_deps(&database, Arc::new(NoFetcher), secrets.clone())
                    .expect("reopen"),
            );
        let locked = request(reopened.clone(), Method::GET, "/api/v1/vault", None).await;
        assert_eq!(locked.json["locked"], true);

        // Wrong passphrase → 401; correct passphrase → 200 and unlocked.
        let wrong = request(
            reopened.clone(),
            Method::POST,
            "/api/v1/vault/unlock",
            Some(json!({ "passphrase": "not-the-one" })),
        )
        .await;
        assert_eq!(wrong.status, StatusCode::UNAUTHORIZED);

        let unlock = request(
            reopened,
            Method::POST,
            "/api/v1/vault/unlock",
            Some(json!({ "passphrase": "river-paper-inn" })),
        )
        .await;
        assert_eq!(unlock.status, StatusCode::OK);
        assert_eq!(unlock.json["locked"], false);
        assert_eq!(unlock.json["active"], true);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn recommendations_route_accepts_weights_and_is_empty_without_packs() {
        let database = temp_database("recommendations");
        let service = open_test_service(&database).expect("service");
        let router = app(service);
        let trip = create_trip_direct(&router).await;
        let trip_id = trip["id"].as_str().expect("id");

        let response = request(
            router,
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/recommendations"),
            Some(json!({
                "food": 1.0, "culture": 0.5, "nature": 0.2,
                "nightlife": 0.0, "shopping": 0.0
            })),
        )
        .await;
        assert_eq!(response.status, StatusCode::OK);
        assert_eq!(response.json.as_array().expect("array").len(), 0);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn packs_route_lists_the_required_seed_cities() {
        let database = temp_database("packs");
        let service = open_test_service(&database).expect("service");
        let router = app(service);

        let response = request(router, Method::GET, "/api/v1/packs", None).await;
        assert_eq!(response.status, StatusCode::OK);
        let ids: Vec<&str> = response
            .json
            .as_array()
            .expect("packs")
            .iter()
            .map(|pack| pack["id"].as_str().expect("id"))
            .collect();
        for required in ["us-nashville", "us-hi-oahu", "us-hi-maui", "us-hi-kauai"] {
            assert!(ids.contains(&required), "missing {required}");
        }
        cleanup_database(database);
    }

    #[tokio::test]
    async fn pack_download_routes_store_and_list_per_trip() {
        struct PackFetcher;
        impl voyalier_app::AdviceFetcher for PackFetcher {
            fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
                Ok(r#"{ "packId": "us-nashville",
                        "places": [{ "name": "Ryman", "category": "venue", "lat": 36.16, "lon": -86.78 }],
                        "articles": [] }"#
                    .to_owned())
            }
        }

        let database = temp_database("pack-dl");
        let service = open_test_service_with_fetcher(&database, std::sync::Arc::new(PackFetcher))
            .expect("service");
        let router = app(service);
        let trip = create_trip_direct(&router).await;
        let trip_id = trip["id"].as_str().expect("id");

        let empty = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/packs"),
            None,
        )
        .await;
        assert_eq!(empty.status, StatusCode::OK);
        assert_eq!(empty.json.as_array().expect("arr").len(), 0);

        let downloaded = request(
            router.clone(),
            Method::POST,
            &format!("/api/v1/trips/{trip_id}/packs/us-nashville"),
            None,
        )
        .await;
        assert_eq!(downloaded.status, StatusCode::OK);
        assert_eq!(downloaded.json["placeCount"], 1);

        let listed = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/packs"),
            None,
        )
        .await;
        assert_eq!(listed.json.as_array().expect("arr").len(), 1);

        let offline_map = request(
            router.clone(),
            Method::GET,
            &format!("/api/v1/trips/{trip_id}/offline-map"),
            None,
        )
        .await;
        assert_eq!(offline_map.status, StatusCode::OK);
        assert!(offline_map.json.is_null());

        let removed = request(
            router,
            Method::DELETE,
            &format!("/api/v1/trips/{trip_id}/packs/us-nashville"),
            None,
        )
        .await;
        assert_eq!(removed.status, StatusCode::NO_CONTENT);
        cleanup_database(database);
    }

    #[tokio::test]
    async fn rejects_tauri_origins_and_unexpected_hosts() {
        let database = temp_database("origin");
        let service = open_test_service(&database).expect("service");
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
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

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
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
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

    struct NoNetFetcher;
    impl voyalier_app::AdviceFetcher for NoNetFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Ok(String::new())
        }
    }

    /// Open a service for tests with an in-memory secret store, so tests never
    /// touch (or mutate) the real OS keychain — the vault now reads/writes its
    /// data key there on every open, which would be slow and a real side effect.
    fn open_test_service(database: &std::path::Path) -> Result<AppService, AppError> {
        open_test_service_with_fetcher(database, std::sync::Arc::new(NoNetFetcher))
    }

    fn open_test_service_with_fetcher(
        database: &std::path::Path,
        fetcher: std::sync::Arc<dyn voyalier_app::AdviceFetcher>,
    ) -> Result<AppService, AppError> {
        AppService::open_path_with_deps(
            database,
            fetcher,
            std::sync::Arc::new(voyalier_app::MemorySecretStore::default()),
        )
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

    /// Only the fields this crate asserts on. serde ignores the rest.
    /// `command` is read by `the_router_declares_exactly_the_manifest`, which
    /// folds it into the comparison key alongside `(verb, path)` so a same-verb
    /// handler swap between two routes fails instead of comparing as two
    /// identical keys.
    #[derive(serde::Deserialize)]
    struct SharedRoute {
        method: String,
        verb: String,
        path: String,
        command: String,
    }

    #[derive(serde::Deserialize)]
    struct ManifestCounts {
        shared: usize,
        #[serde(rename = "desktopOnly")]
        desktop_only: usize,
    }

    #[derive(serde::Deserialize)]
    struct RouteManifest {
        shared: Vec<SharedRoute>,
        #[serde(rename = "desktopOnly")]
        desktop_only: Vec<String>,
        counts: ManifestCounts,
    }

    /// `packages/contracts/parity/routes.json` is the one declaration of the API
    /// surface. `apps/web/src/routeParity.test.ts` holds the two web gateways to
    /// the same file.
    fn load_route_manifest() -> RouteManifest {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../packages/contracts/parity/routes.json");
        let raw = fs::read_to_string(&path).expect("parity/routes.json");
        serde_json::from_str(&raw).expect("parity/routes.json parses")
    }

    /// Substitute the manifest's path placeholders with the same sample values
    /// `routeParity.test.ts` uses, so both sides probe identical URLs.
    fn resolve_path(path: &str) -> String {
        path.replace("{tripId}", "trip_1")
            .replace("{packId}", "pack_1")
            .replace("{documentId}", "doc_1")
            .replace("{factId}", "fact_1")
            .replace("{candidateId}", "cand_1")
            .replace("{provider}", "openai")
    }

    /// A routing probe: status plus whether the body was empty, and deliberately
    /// no body parsing. `request` would panic here, because Axum's extractor
    /// rejections to an empty body answer in plain text rather than AppError JSON.
    async fn route_probe(router: Router, method: Method, uri: &str) -> (StatusCode, bool) {
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::HOST, "127.0.0.1:8787")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::empty())
            .expect("request");
        let response = router.oneshot(request).await.expect("response");
        let status = response.status();
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("bytes");
        (status, body.is_empty())
    }

    #[tokio::test]
    async fn every_declared_route_is_served_by_the_router() {
        let manifest = load_route_manifest();
        assert_eq!(
            manifest.shared.len(),
            manifest.counts.shared,
            "parity/routes.json declares counts.shared = {} but carries {} rows",
            manifest.counts.shared,
            manifest.shared.len()
        );

        let database = temp_database("route_parity");
        let service = open_test_service(&database).expect("service");
        let router = app(service);

        for route in &manifest.shared {
            let uri = resolve_path(&route.path);
            assert!(
                !uri.contains('{'),
                "parity/routes.json path {} has a placeholder with no sample value in resolve_path",
                route.path
            );
            let method = Method::from_bytes(route.verb.as_bytes()).unwrap_or_else(|_| {
                panic!("parity/routes.json verb {} is not a method", route.verb)
            });

            let (status, body_empty) = route_probe(router.clone(), method, &uri).await;

            // An unmatched route is 404 with an empty body; a handler saying
            // "trip not found" is 404 with an AppError body. Only the first is
            // a routing failure. A verb mismatch on a matched path is 405.
            assert!(
                !(status == StatusCode::NOT_FOUND && body_empty),
                "parity/routes.json declares {} -> {} {} but the Axum router has no such route \
                 (404, empty body). Add it in crates/voyalier-server, or fix the manifest.",
                route.method,
                route.verb,
                route.path
            );
            assert_ne!(
                status,
                StatusCode::METHOD_NOT_ALLOWED,
                "parity/routes.json declares {} -> {} {} but the Axum router serves that path \
                 under a different verb (405).",
                route.method,
                route.verb,
                route.path
            );
        }

        cleanup_database(database);
    }

    /// True if `byte` can appear inside a Rust identifier. Every name this
    /// module scans — handler idents in `declared_routes`, desktop-only command
    /// names in `source_names_identifier` — is ASCII, so a byte check is
    /// enough; there is no need to decode UTF-8.
    fn is_identifier_byte(byte: u8) -> bool {
        byte.is_ascii_alphanumeric() || byte == b'_'
    }

    /// True if `source` mentions `name` as a whole-word identifier: not preceded
    /// or followed by an ASCII alphanumeric or `_`. Wiring a handler requires
    /// naming it — under any verb (`get`, `put`, `any`, `on(MethodFilter, ..)`,
    /// `route_service`, ...), through a nested or merged `Router`, or via a local
    /// binding — so this check is robust to every wiring form without parsing
    /// Axum's routing API at all.
    fn source_names_identifier(source: &str, name: &str) -> bool {
        let bytes = source.as_bytes();
        let mut start = 0;
        while let Some(offset) = source[start..].find(name) {
            let index = start + offset;
            let before_ok = index == 0 || !is_identifier_byte(bytes[index - 1]);
            let after = index + name.len();
            let after_ok = after == bytes.len() || !is_identifier_byte(bytes[after]);
            if before_ok && after_ok {
                return true;
            }
            start = index + 1;
        }
        false
    }

    /// The updater, backup/restore, and settings commands are reachable only over
    /// Tauri IPC. For the updater that separation is a stated security property
    /// (docs/architecture/UPDATES.md: the webview holds no network path to it), so
    /// this crate's source must never even name one of these commands — naming a
    /// command is the one precondition every wiring form shares.
    #[test]
    fn desktop_only_commands_never_gain_an_http_route() {
        let manifest = load_route_manifest();
        assert_eq!(
            manifest.desktop_only.len(),
            manifest.counts.desktop_only,
            "parity/routes.json declares counts.desktopOnly = {} but carries {} entries",
            manifest.counts.desktop_only,
            manifest.desktop_only.len()
        );

        let sources = [include_str!("lib.rs"), include_str!("main.rs")];
        for command in &manifest.desktop_only {
            let named = sources
                .iter()
                .any(|source| source_names_identifier(source, command));
            assert!(
                !named,
                "SECURITY: `{command}` is declared desktop-only in parity/routes.json, but \
                 crates/voyalier-server's source names it — a handler cannot be wired to a route \
                 without being named. The updater, backup/restore, and settings commands must \
                 stay off the loopback HTTP surface (docs/architecture/UPDATES.md). Remove the \
                 wiring, or move the command out of desktopOnly with an ADR."
            );
        }
    }

    /// `pub fn app`'s body, so route parsing never strays into the test module
    /// below it (which mentions `.route(` in its own assertion messages).
    ///
    /// Bounds the slice by depth-counting braces from the opening `{` of the
    /// function body to its matching close, rather than assuming the body ends
    /// at the first `"\n}\n"` — a heuristic that silently truncates as soon as
    /// any nested block (a `#[rustfmt::skip]`-preserved one, a `let` with a
    /// block body, ...) closes at column 0. This does not special-case braces
    /// inside string or char literals; it is correct today only because every
    /// `{param}` route placeholder is a balanced pair on a single line, so it
    /// never perturbs the running depth. A future string literal with an
    /// unbalanced brace would defeat it the same way the old heuristic could
    /// be defeated — that residual risk is real and intentionally not handled
    /// here, rather than papered over with a false claim of robustness.
    fn router_source(source: &str) -> &str {
        let start = source.find("pub fn app(").expect("pub fn app in lib.rs");
        let rest = &source[start..];
        let body_start = rest.find('{').expect("opening brace of pub fn app");
        let mut depth = 0i32;
        let mut end = None;
        for (offset, ch) in rest[body_start..].char_indices() {
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(body_start + offset + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
        let end = end.expect("matching close brace for pub fn app");
        &rest[..end]
    }

    /// Convert an Axum path's snake_case placeholders to the manifest's camelCase,
    /// so `/api/v1/trips/{trip_id}` compares equal to `/api/v1/trips/{tripId}`.
    fn normalize_placeholders(path: &str) -> String {
        let mut out = String::with_capacity(path.len());
        let mut rest = path;
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            let after = &rest[open + 1..];
            let close = after
                .find('}')
                .expect("unclosed placeholder in a route path");
            out.push('{');
            let mut capitalize = false;
            for character in after[..close].chars() {
                if character == '_' {
                    capitalize = true;
                } else if capitalize {
                    out.extend(character.to_uppercase());
                    capitalize = false;
                } else {
                    out.push(character);
                }
            }
            out.push('}');
            rest = &after[close + 1..];
        }
        out.push_str(rest);
        out
    }

    /// Every `(VERB, path, handler)` the router declares. Complete only because
    /// (a) `the_router_uses_only_wiring_forms_the_parity_parser_understands`
    /// holds the crate to `.route(path, verb(handler))` — if that test fails,
    /// this one is blind and must be taught the new form — (b) `router_source`
    /// bounds the scan to exactly `pub fn app`'s body via brace counting, so
    /// nothing past the function leaks in and nothing inside it is cut off —
    /// and (c) every `.route(` call must carry a string literal path, and every
    /// whole-word `verb(` occurrence in its body must resolve to a bare
    /// identifier followed by `)`, or this function panics rather than
    /// silently dropping the route.
    fn declared_routes(source: &str) -> std::collections::HashSet<(String, String, String)> {
        let mut routes = std::collections::HashSet::new();
        for chunk in router_source(source).split(".route(").skip(1) {
            let open = chunk.find('"').expect(
                "declared_routes: a `.route(` call has no string literal path — a `const` or \
                 expression path is invisible to this parser. Use a literal path, or teach \
                 declared_routes this form before using it.",
            );
            let length = chunk[open + 1..].find('"').expect(
                "declared_routes: a `.route(` call has an unterminated string literal path.",
            );
            let path = normalize_placeholders(&chunk[open + 1..open + 1 + length]);
            let body = &chunk[open + 1 + length + 1..];

            // Every whole-word `verb(` occurrence must be understood (a bare
            // identifier immediately closed by `)`), or a handler wired some
            // other way (a closure, a module path, ...) would otherwise just
            // vanish from `routes` with no signal. `total_calls` counts the
            // whole-word occurrences; `understood_calls` counts the ones the
            // simple identifier scan below could actually parse.
            let mut total_calls = 0usize;
            let mut understood_calls = 0usize;
            for verb in ["get", "post", "patch", "delete"] {
                let needle = format!("{verb}(");
                let mut search_from = 0usize;
                while let Some(found) = body[search_from..].find(&needle) {
                    let at = search_from + found;
                    search_from = at + needle.len();

                    // Require a non-identifier byte before the needle, so
                    // e.g. `widget(` does not read as a `get(` call.
                    let before_ok = at == 0 || !is_identifier_byte(body.as_bytes()[at - 1]);
                    if !before_ok {
                        continue;
                    }
                    total_calls += 1;

                    let start = at + needle.len();
                    let end = body[start..]
                        .find(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                        .map_or(body.len(), |offset| start + offset);
                    if end > start && body[end..].starts_with(')') {
                        let handler = body[start..end].to_string();
                        routes.insert((verb.to_ascii_uppercase(), path.clone(), handler));
                        understood_calls += 1;
                    }
                }
            }
            assert_eq!(
                total_calls, understood_calls,
                "declared_routes understood {understood_calls} of {total_calls} verb(...) \
                 call(s) in the `.route(\"{path}\", ...)` body. A closure, a module path, or any \
                 handler form other than a bare identifier is invisible to this parser — teach \
                 declared_routes the new form before using it."
            );
        }
        routes
    }

    /// The parser above understands `.route(path, verb(handler))` and nothing else.
    /// Axum offers plenty more — this keeps the crate inside what the guard can
    /// actually see, so a new wiring form fails here rather than slipping past
    /// `the_router_declares_exactly_the_manifest`.
    #[test]
    fn the_router_uses_only_wiring_forms_the_parity_parser_understands() {
        let router = router_source(include_str!("lib.rs"));
        for form in [
            "put(",
            "head(",
            "options(",
            "trace(",
            "connect(",
            "any(",
            ".on(",
            "_service",
            "MethodFilter",
            ".merge(",
            ".nest",
            "fallback",
        ] {
            assert!(
                !router.contains(form),
                "pub fn app uses `{form}`, which declared_routes cannot see. The parity guard would \
                 stop noticing routes wired that way. Teach declared_routes the new form before \
                 using it."
            );
        }
    }

    /// The reverse of `every_declared_route_is_served_by_the_router`: the router
    /// must serve nothing the manifest does not declare, under the same
    /// handler. Without this, a route added to Axum and never declared drifts
    /// silently (the forward test only walks the manifest), and two same-verb
    /// handlers swapped between routes would compare as two identical
    /// `(verb, path)` keys and pass unnoticed.
    #[test]
    fn the_router_declares_exactly_the_manifest() {
        let manifest = load_route_manifest();
        let declared: std::collections::HashSet<(String, String, String)> = manifest
            .shared
            .iter()
            .map(|route| {
                (
                    route.verb.clone(),
                    route.path.clone(),
                    route.command.clone(),
                )
            })
            .collect();
        let routed = declared_routes(include_str!("lib.rs"));

        let mut undeclared: Vec<_> = routed.difference(&declared).collect();
        undeclared.sort();
        let mut unrouted: Vec<_> = declared.difference(&routed).collect();
        unrouted.sort();

        // One assertion covering both directions, so a mismatch that shows up
        // on both sides (e.g. two handlers swapped between routes) prints the
        // expected (manifest) and actual (routed) handler for each affected
        // path together, rather than only whichever direction happened to be
        // checked first.
        assert!(
            undeclared.is_empty() && unrouted.is_empty(),
            "route parity between crates/voyalier-server and parity/routes.json has drifted.\n\
             Routed as (verb, path, handler) but not declared in the manifest: {undeclared:?}\n\
             Declared in the manifest as (verb, path, command) but not routed: {unrouted:?}\n\
             Every route needs a manifest row naming the same handler as its `command`, or the \
             web gateways can drift from it unnoticed."
        );
    }
}
