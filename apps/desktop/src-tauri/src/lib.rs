use serde::{Deserialize, Serialize};
use tauri::State;
use voyalier_app::AppService;
use voyalier_core::{
    AddManualFactInput, AppError, CandidateFact, CandidateStatus, ConfirmCandidateInput,
    ConfirmedFact, CreateTripInput, HealthResponse, ImportDocumentInput, ImportResult, Trip,
    TripDetail, TripSummary, UpdateTripInput,
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
