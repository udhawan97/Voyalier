use serde::{Deserialize, Serialize};
use tauri::State;
use voyalier_app::AppService;
use voyalier_core::{
    AddManualFactInput, AppError, AssistActivityEntry, AssistReply, AssistRequestPreview,
    CandidateFact, CandidateStatus, ConfirmCandidateInput, ConfirmedFact, CreateTripInput,
    DownloadedPack, FcdoCountry, HealthResponse, ImportDocumentInput, ImportResult, LocalAiStatus,
    PackInfo, ProviderConfig, SearchHit, TravelAdviceSnapshot, Trip, TripBrief, TripDetail,
    TripSummary, UpdateTripInput, WeatherSnapshot,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EmptyInput {}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TripIdInput {
    trip_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTripCommandInput {
    trip_id: String,
    patch: UpdateTripInput,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListCandidatesInput {
    trip_id: String,
    status: Option<CandidateStatus>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CandidateIdInput {
    candidate_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTripInput {
    trip_id: String,
    query: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewAssistInput {
    trip_id: String,
    provider: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunAssistInput {
    trip_id: String,
    provider: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FactIdInput {
    fact_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmCandidateOutput {
    candidate: CandidateFact,
    confirmed_fact: ConfirmedFact,
}

#[tauri::command]
fn health(input: EmptyInput, service: State<'_, AppService>) -> Result<HealthResponse, AppError> {
    let _ = input;
    service.health()
}

#[tauri::command]
fn create_trip(input: CreateTripInput, service: State<'_, AppService>) -> Result<Trip, AppError> {
    service.create_trip(input)
}

#[tauri::command]
fn list_trips(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<Vec<TripSummary>, AppError> {
    let _ = input;
    service.list_trips()
}

#[tauri::command]
fn get_trip(input: TripIdInput, service: State<'_, AppService>) -> Result<TripDetail, AppError> {
    service.get_trip(&input.trip_id)
}

#[tauri::command]
fn update_trip(
    input: UpdateTripCommandInput,
    service: State<'_, AppService>,
) -> Result<Trip, AppError> {
    service.update_trip(&input.trip_id, input.patch)
}

#[tauri::command]
fn archive_trip(input: TripIdInput, service: State<'_, AppService>) -> Result<Trip, AppError> {
    service.archive_trip(&input.trip_id)
}

#[tauri::command]
fn get_trip_brief(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<TripBrief, AppError> {
    service.get_trip_brief(&input.trip_id)
}

#[tauri::command]
fn search_trip(
    input: SearchTripInput,
    service: State<'_, AppService>,
) -> Result<Vec<SearchHit>, AppError> {
    service.search_trip(&input.trip_id, &input.query)
}

#[tauri::command]
fn preview_assist(
    input: PreviewAssistInput,
    service: State<'_, AppService>,
) -> Result<AssistRequestPreview, AppError> {
    service.preview_assist(&input.trip_id, &input.provider)
}

#[tauri::command]
fn run_assist(
    input: RunAssistInput,
    service: State<'_, AppService>,
) -> Result<AssistReply, AppError> {
    service.run_assist(&input.trip_id, &input.provider)
}

#[tauri::command]
fn list_assist_activity(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Vec<AssistActivityEntry>, AppError> {
    service.list_assist_activity(&input.trip_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchAdviceInput {
    trip_id: String,
    country_slug: String,
}

#[tauri::command]
fn list_advice_countries(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<Vec<FcdoCountry>, AppError> {
    let _ = input;
    Ok(service.list_advice_countries())
}

#[tauri::command]
fn list_packs(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<Vec<PackInfo>, AppError> {
    let _ = input;
    Ok(service.list_packs())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackForTripInput {
    trip_id: String,
    pack_id: String,
}

#[tauri::command]
fn download_pack(
    input: PackForTripInput,
    service: State<'_, AppService>,
) -> Result<DownloadedPack, AppError> {
    service.download_pack(&input.trip_id, &input.pack_id)
}

#[tauri::command]
fn list_downloaded_packs(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Vec<DownloadedPack>, AppError> {
    service.list_downloaded_packs(&input.trip_id)
}

#[tauri::command]
fn delete_downloaded_pack(
    input: PackForTripInput,
    service: State<'_, AppService>,
) -> Result<(), AppError> {
    service.delete_downloaded_pack(&input.trip_id, &input.pack_id)
}

#[tauri::command]
fn detect_local_ai(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<LocalAiStatus, AppError> {
    let _ = input;
    Ok(service.detect_local_ai())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetProviderKeyInput {
    provider: String,
    key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetProviderModelInput {
    provider: String,
    model: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderInput {
    provider: String,
}

#[tauri::command]
fn list_providers(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<Vec<ProviderConfig>, AppError> {
    let _ = input;
    service.list_providers()
}

#[tauri::command]
fn set_provider_key(
    input: SetProviderKeyInput,
    service: State<'_, AppService>,
) -> Result<ProviderConfig, AppError> {
    service.set_provider_key(&input.provider, &input.key)
}

#[tauri::command]
fn clear_provider_key(
    input: ProviderInput,
    service: State<'_, AppService>,
) -> Result<ProviderConfig, AppError> {
    service.clear_provider_key(&input.provider)
}

#[tauri::command]
fn set_provider_model(
    input: SetProviderModelInput,
    service: State<'_, AppService>,
) -> Result<ProviderConfig, AppError> {
    service.set_provider_model(&input.provider, &input.model)
}

#[tauri::command]
fn fetch_travel_advice(
    input: FetchAdviceInput,
    service: State<'_, AppService>,
) -> Result<TravelAdviceSnapshot, AppError> {
    service.fetch_travel_advice(&input.trip_id, &input.country_slug)
}

#[tauri::command]
fn fetch_weather(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<WeatherSnapshot, AppError> {
    service.fetch_weather(&input.trip_id)
}

#[tauri::command]
fn delete_trip(input: TripIdInput, service: State<'_, AppService>) -> Result<(), AppError> {
    service.delete_trip(&input.trip_id)
}

#[tauri::command]
fn import_document(
    input: ImportDocumentInput,
    service: State<'_, AppService>,
) -> Result<ImportResult, AppError> {
    service.import_document(input)
}

#[tauri::command]
fn list_candidates(
    input: ListCandidatesInput,
    service: State<'_, AppService>,
) -> Result<Vec<CandidateFact>, AppError> {
    service.list_candidates(&input.trip_id, input.status)
}

#[tauri::command]
fn confirm_candidate(
    input: ConfirmCandidateInput,
    service: State<'_, AppService>,
) -> Result<ConfirmCandidateOutput, AppError> {
    let (candidate, confirmed_fact) = service.confirm_candidate(input)?;
    Ok(ConfirmCandidateOutput {
        candidate,
        confirmed_fact,
    })
}

#[tauri::command]
fn reject_candidate(
    input: CandidateIdInput,
    service: State<'_, AppService>,
) -> Result<CandidateFact, AppError> {
    service.reject_candidate(&input.candidate_id)
}

#[tauri::command]
fn add_manual_fact(
    input: AddManualFactInput,
    service: State<'_, AppService>,
) -> Result<ConfirmedFact, AppError> {
    service.add_manual_fact(input)
}

#[tauri::command]
fn unconfirm_fact(input: FactIdInput, service: State<'_, AppService>) -> Result<(), AppError> {
    service.unconfirm_fact(&input.fact_id)
}

fn builder<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
    service: AppService,
) -> tauri::Builder<R> {
    builder
        .manage(service)
        .invoke_handler(tauri::generate_handler![
            health,
            create_trip,
            list_trips,
            get_trip,
            update_trip,
            archive_trip,
            get_trip_brief,
            search_trip,
            preview_assist,
            run_assist,
            list_assist_activity,
            list_advice_countries,
            list_packs,
            download_pack,
            list_downloaded_packs,
            delete_downloaded_pack,
            detect_local_ai,
            list_providers,
            set_provider_key,
            clear_provider_key,
            set_provider_model,
            fetch_travel_advice,
            fetch_weather,
            delete_trip,
            import_document,
            list_candidates,
            confirm_candidate,
            reject_candidate,
            add_manual_fact,
            unconfirm_fact
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let service = AppService::open_default().expect("Voyalier storage must initialize");
    builder(tauri::Builder::default(), service)
        .run(tauri::generate_context!())
        .expect("error while running Voyalier");
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use serde_json::{Value, json};
    use tauri::{
        WebviewWindowBuilder,
        ipc::{CallbackFn, InvokeBody},
        test::{
            INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
        },
        webview::InvokeRequest,
    };

    use super::*;

    #[test]
    fn tauri_commands_round_trip_with_single_input_arg() {
        let database = temp_database("roundtrip");
        let app = test_app(&database);
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview");

        let health = invoke(&webview, "health", json!({})).expect("health");
        assert_eq!(health["intelligenceMode"], "local");

        let trip = invoke(
            &webview,
            "create_trip",
            json!({
                "origin": "Chicago",
                "destination": "Kyoto",
                "startDate": "2027-04-01",
                "endDate": "2027-04-10"
            }),
        )
        .expect("create trip");
        let trip_id = trip["id"].as_str().expect("trip id").to_owned();

        assert!(
            invoke(&webview, "list_trips", json!({}))
                .expect("list trips")
                .as_array()
                .expect("trips")
                .len()
                == 1
        );
        assert_eq!(
            invoke(&webview, "get_trip", json!({ "tripId": trip_id })).expect("get trip")["trip"]["destination"],
            "Kyoto"
        );
        assert_eq!(
            invoke(
                &webview,
                "update_trip",
                json!({ "tripId": trip_id, "patch": { "title": "Kyoto spring" } }),
            )
            .expect("update trip")["title"],
            "Kyoto spring"
        );

        let imported = invoke(
            &webview,
            "import_document",
            json!({
                "tripId": trip_id,
                "kind": "pasted_text",
                "label": "Flight memo",
                "content": "Confirmation HOLD9\nRoute SFO-NRT\nDeparture 2027-04-02T10:00"
            }),
        )
        .expect("import document");
        assert!(imported["document"].get("content").is_none());
        let candidate_id = imported["candidates"][0]["id"]
            .as_str()
            .expect("candidate id")
            .to_owned();

        assert_eq!(
            invoke(
                &webview,
                "list_candidates",
                json!({ "tripId": trip_id, "status": "pending" }),
            )
            .expect("list candidates")
            .as_array()
            .expect("candidate array")
            .len(),
            1
        );

        let confirmed = invoke(
            &webview,
            "confirm_candidate",
            json!({ "candidateId": candidate_id }),
        )
        .expect("confirm candidate");
        let fact_id = confirmed["confirmedFact"]["id"]
            .as_str()
            .expect("fact id")
            .to_owned();

        invoke(&webview, "unconfirm_fact", json!({ "factId": fact_id })).expect("unconfirm fact");
        assert_eq!(
            invoke(
                &webview,
                "reject_candidate",
                json!({ "candidateId": candidate_id }),
            )
            .expect("reject candidate")["status"],
            "rejected"
        );

        let manual = invoke(
            &webview,
            "add_manual_fact",
            json!({
                "tripId": trip_id,
                "factType": "flight_segment",
                "payload": {
                    "departureAirportIata": "SFO",
                    "arrivalAirportIata": "NRT",
                    "departureLocal": "2027-04-02T10:00"
                }
            }),
        )
        .expect("manual fact");
        assert_eq!(manual["method"], "manual");

        let hits = invoke(
            &webview,
            "search_trip",
            json!({ "tripId": trip_id, "query": "SFO" }),
        )
        .expect("search trip");
        assert!(!hits.as_array().expect("hits").is_empty());

        // Assist preview is deterministic and keychain-free — safe to round-trip.
        let preview = invoke(
            &webview,
            "preview_assist",
            json!({ "tripId": trip_id, "provider": "ollama" }),
        )
        .expect("assist preview");
        assert_eq!(preview["leavesDevice"], false);
        assert!(
            preview["userContent"]
                .as_str()
                .expect("content")
                .contains("SFO")
        );

        // Activity log is reachable and empty until a call runs (run_assist
        // needs a live Ollama and is covered at the app layer with a stub).
        let activity = invoke(
            &webview,
            "list_assist_activity",
            json!({ "tripId": trip_id }),
        )
        .expect("assist activity");
        assert!(activity.as_array().expect("activity array").is_empty());

        // City pack catalog is static and includes the required seed cities.
        let packs = invoke(&webview, "list_packs", json!({})).expect("packs");
        let pack_ids: Vec<&str> = packs
            .as_array()
            .expect("packs array")
            .iter()
            .map(|pack| pack["id"].as_str().expect("id"))
            .collect();
        assert!(pack_ids.contains(&"us-nashville"));
        assert!(pack_ids.contains(&"us-hi-maui"));

        // No packs downloaded for this trip yet (download_pack is network-backed
        // and covered at the app/server layers with a stubbed fetcher).
        let downloaded = invoke(
            &webview,
            "list_downloaded_packs",
            json!({ "tripId": trip_id }),
        )
        .expect("downloaded packs");
        assert!(downloaded.as_array().expect("array").is_empty());

        // Countries list is local and static; the fetch command itself is
        // network-backed and is exercised at the app/server layers with stubs.
        let countries =
            invoke(&webview, "list_advice_countries", json!({})).expect("advice countries");
        assert!(
            countries
                .as_array()
                .expect("countries")
                .iter()
                .any(|country| country["slug"] == "japan")
        );

        let brief =
            invoke(&webview, "get_trip_brief", json!({ "tripId": trip_id })).expect("trip brief");
        assert!(brief.get("redactedFields").is_some());
        assert!(!brief["flights"].as_array().expect("flights").is_empty());

        assert_eq!(
            invoke(&webview, "archive_trip", json!({ "tripId": trip_id })).expect("archive trip")["status"],
            "archived"
        );
        invoke(&webview, "delete_trip", json!({ "tripId": trip_id })).expect("delete trip");
        cleanup_database(database);
    }

    #[test]
    fn every_tauri_command_requires_the_input_arg_key() {
        let database = temp_database("input-key");
        let app = test_app(&database);
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview");
        for command in [
            "health",
            "create_trip",
            "list_trips",
            "get_trip",
            "update_trip",
            "archive_trip",
            "get_trip_brief",
            "search_trip",
            "preview_assist",
            "run_assist",
            "list_assist_activity",
            "list_advice_countries",
            "list_packs",
            "download_pack",
            "list_downloaded_packs",
            "delete_downloaded_pack",
            "detect_local_ai",
            "list_providers",
            "set_provider_key",
            "clear_provider_key",
            "set_provider_model",
            "fetch_travel_advice",
            "fetch_weather",
            "delete_trip",
            "import_document",
            "list_candidates",
            "confirm_candidate",
            "reject_candidate",
            "add_manual_fact",
            "unconfirm_fact",
        ] {
            let error = invoke_with_body(&webview, command, json!({})).expect_err(command);
            assert!(
                error.to_string().contains("missing required key input"),
                "{command} did not pin the input key: {error}"
            );
        }
        cleanup_database(database);
    }

    fn test_app(database: &PathBuf) -> tauri::App<MockRuntime> {
        let service = AppService::open_path(database).expect("service");
        builder(mock_builder(), service)
            .build(mock_context(noop_assets()))
            .expect("app")
    }

    fn invoke(
        webview: &tauri::WebviewWindow<MockRuntime>,
        command: &str,
        input: Value,
    ) -> Result<Value, Value> {
        invoke_with_body(webview, command, json!({ "input": input }))
    }

    fn invoke_with_body(
        webview: &tauri::WebviewWindow<MockRuntime>,
        command: &str,
        body: Value,
    ) -> Result<Value, Value> {
        get_ipc_response(
            webview,
            InvokeRequest {
                cmd: command.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().expect("url"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_owned(),
            },
        )
        .map(|body| body.deserialize::<Value>().expect("response json"))
    }

    fn temp_database(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("voyalier-desktop-{name}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir.join("voyalier.sqlite3")
    }

    fn cleanup_database(database: PathBuf) {
        if let Some(parent) = database.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}
