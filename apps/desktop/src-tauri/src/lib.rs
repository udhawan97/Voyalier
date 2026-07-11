use serde::{Deserialize, Serialize};
use tauri::State;
use voyalier_app::{AppService, BackupInfo};
use voyalier_core::{
    AddManualFactInput, AppError, AssistActivityEntry, AssistReply, AssistRequestPreview,
    CandidateFact, CandidateStatus, ConfirmCandidateInput, ConfirmedFact, CreateTripInput,
    DownloadedPack, ErrorCode, FcdoCountry, HealthResponse, ImportDocumentInput, ImportResult,
    LocalAiStatus, PackInfo, PersonaWeights, ProviderConfig, Recommendation, SearchHit, TodayView,
    TravelAdviceSnapshot, Trip, TripBrief, TripDetail, TripSummary, UpdateTripInput, VaultStatus,
    WeatherSnapshot,
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
fn get_today(input: TripIdInput, service: State<'_, AppService>) -> Result<TodayView, AppError> {
    service.get_today(&input.trip_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PassphraseInput {
    passphrase: String,
}

#[tauri::command]
fn get_vault_status(
    _input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<VaultStatus, AppError> {
    service.get_vault_status()
}

#[tauri::command]
fn set_vault_passphrase(
    input: PassphraseInput,
    service: State<'_, AppService>,
) -> Result<VaultStatus, AppError> {
    service.set_vault_passphrase(&input.passphrase)
}

#[tauri::command]
fn unlock_vault(
    input: PassphraseInput,
    service: State<'_, AppService>,
) -> Result<VaultStatus, AppError> {
    service.unlock_vault(&input.passphrase)
}

#[tauri::command]
fn remove_vault_passphrase(
    input: PassphraseInput,
    service: State<'_, AppService>,
) -> Result<VaultStatus, AppError> {
    service.remove_vault_passphrase(&input.passphrase)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecommendationsInput {
    trip_id: String,
    weights: PersonaWeights,
}

#[tauri::command]
fn get_recommendations(
    input: RecommendationsInput,
    service: State<'_, AppService>,
) -> Result<Vec<Recommendation>, AppError> {
    service.get_recommendations(&input.trip_id, input.weights)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetAppSettingInput {
    key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetAppSettingInput {
    key: String,
    value: String,
}

#[tauri::command]
fn get_app_setting(
    input: GetAppSettingInput,
    service: State<'_, AppService>,
) -> Result<Option<String>, AppError> {
    service.get_app_setting(&input.key)
}

#[tauri::command]
fn set_app_setting(
    input: SetAppSettingInput,
    service: State<'_, AppService>,
) -> Result<(), AppError> {
    service.set_app_setting(&input.key, &input.value)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupDatabaseInput {
    label: String,
}

#[tauri::command]
fn backup_database(
    input: BackupDatabaseInput,
    service: State<'_, AppService>,
) -> Result<BackupInfo, AppError> {
    service.backup_database(&input.label)
}

#[tauri::command]
fn clear_backups(input: EmptyInput, service: State<'_, AppService>) -> Result<usize, AppError> {
    let _ = input;
    service.clear_backups()
}

// ---------------------------------------------------------------------------
// In-app updater — Rust-wrapped so the webview never holds the updater
// capability. The endpoint and signature pubkey are fixed in tauri.conf.json;
// these commands accept NO caller-supplied proxy or headers, so there is no
// hidden network path. Notes from GitHub are attacker-influencable, so the
// frontend renders them as inert plain text (never raw HTML) — here we only
// length-cap them. The updater plugin is registered only in packaged/release
// builds; in dev/source builds these commands report a disabled state.
// ---------------------------------------------------------------------------

/// Result of an update check. `status` is one of `"disabled"` (dev/source
/// build), `"upToDate"`, or `"available"`; the version/notes fields are set
/// only when an update is available.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateCheck {
    status: &'static str,
    current_version: String,
    available_version: Option<String>,
    notes: Option<String>,
}

/// Outcome of an install. On macOS/Linux the new bundle is swapped in place and
/// `status` is `"staged"` (a restart finishes the update). On Windows the
/// process exits during install and the installer relaunches the app, so this
/// rarely returns normally.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallOutcome {
    status: &'static str,
    version: String,
}

/// Release notes are length-capped before crossing to the frontend, which
/// renders them as inert plain text.
#[cfg(not(debug_assertions))]
const UPDATE_NOTES_MAX_CHARS: usize = 10_000;

/// Streamed download progress. `total` is present only when the server sent a
/// Content-Length; otherwise the frontend shows an indeterminate bar.
#[cfg(not(debug_assertions))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

/// Collapse any updater-plugin error to one coarse, safe AppError. The raw
/// plugin string is never surfaced (it is un-i18n-able and fragile to parse);
/// the frontend supplies its own honest copy and splits on `navigator.onLine`.
#[cfg(not(debug_assertions))]
fn updater_error(_error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::InternalUnexpected, "update operation failed")
}

/// Check GitHub Releases for a newer version. Endpoint + pubkey are fixed in
/// config; no caller input is accepted.
#[tauri::command]
async fn updater_check<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<UpdateCheck, AppError> {
    let current_version = app.package_info().version.to_string();
    #[cfg(debug_assertions)]
    {
        Ok(UpdateCheck {
            status: "disabled",
            current_version,
            available_version: None,
            notes: None,
        })
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(updater_error)?;
        match updater.check().await.map_err(updater_error)? {
            Some(update) => Ok(UpdateCheck {
                status: "available",
                current_version: update.current_version.clone(),
                available_version: Some(update.version.clone()),
                notes: update
                    .body
                    .as_ref()
                    .map(|body| body.chars().take(UPDATE_NOTES_MAX_CHARS).collect()),
            }),
            None => Ok(UpdateCheck {
                status: "upToDate",
                current_version,
                available_version: None,
                notes: None,
            }),
        }
    }
}

/// Download and install the available update, emitting `updater://progress`
/// events as bytes arrive. On success the bundle is staged (macOS/Linux) or the
/// process is replaced (Windows). Re-checks internally so no `Update` handle has
/// to be held across IPC calls.
#[tauri::command]
async fn updater_install<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<InstallOutcome, AppError> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Err(AppError::new(
            ErrorCode::InternalUnexpected,
            "updates are disabled in this build",
        ))
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri::Emitter;
        use tauri_plugin_updater::UpdaterExt;
        let updater = app.updater().map_err(updater_error)?;
        let update = updater
            .check()
            .await
            .map_err(updater_error)?
            .ok_or_else(|| {
                AppError::new(
                    ErrorCode::InternalUnexpected,
                    "no update available to install",
                )
            })?;
        let version = update.version.clone();
        let emitter = app.clone();
        let mut downloaded: u64 = 0;
        update
            .download_and_install(
                move |chunk, total| {
                    downloaded += chunk as u64;
                    let _ =
                        emitter.emit("updater://progress", UpdateProgress { downloaded, total });
                },
                || {},
            )
            .await
            .map_err(updater_error)?;
        Ok(InstallOutcome {
            status: "staged",
            version,
        })
    }
}

/// Restart the app to finish a staged update. Uses the core relaunch API (no
/// process-plugin capability granted to the webview). Never returns.
#[tauri::command]
fn updater_relaunch<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    app.restart();
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
            get_today,
            get_vault_status,
            set_vault_passphrase,
            unlock_vault,
            remove_vault_passphrase,
            search_trip,
            preview_assist,
            run_assist,
            list_assist_activity,
            list_advice_countries,
            list_packs,
            download_pack,
            list_downloaded_packs,
            delete_downloaded_pack,
            get_recommendations,
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
            unconfirm_fact,
            get_app_setting,
            set_app_setting,
            backup_database,
            clear_backups,
            updater_check,
            updater_install,
            updater_relaunch
        ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let service = AppService::open_default().expect("Voyalier storage must initialize");
    #[cfg_attr(debug_assertions, allow(unused_mut))]
    let mut app = builder(tauri::Builder::default(), service);
    // The updater plugin reads its fixed endpoint + pubkey from tauri.conf.json.
    // Registered only in packaged/release builds: a source/dev build has no
    // signing key, and its updater commands report the disabled state instead.
    #[cfg(not(debug_assertions))]
    {
        app = app.plugin(tauri_plugin_updater::Builder::new().build());
    }
    app.run(tauri::generate_context!())
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

        // Recommendations accept weights and are empty until a pack is downloaded.
        let recs = invoke(
            &webview,
            "get_recommendations",
            json!({ "tripId": trip_id, "weights": {
                "food": 1.0, "culture": 0.5, "nature": 0.2, "nightlife": 0.0, "shopping": 0.0
            } }),
        )
        .expect("recommendations");
        assert!(recs.as_array().expect("array").is_empty());

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

        let today =
            invoke(&webview, "get_today", json!({ "tripId": trip_id })).expect("today view");
        assert!(today["phase"]["state"].as_str().is_some());
        assert_eq!(today["referenceDate"].as_str().expect("date").len(), 10);

        // App-settings KV round-trips over IPC: unset → null, then set → read.
        assert!(
            invoke(
                &webview,
                "get_app_setting",
                json!({ "key": "updater.consent" })
            )
            .expect("get setting")
            .is_null()
        );
        invoke(
            &webview,
            "set_app_setting",
            json!({ "key": "updater.consent", "value": "yes" }),
        )
        .expect("set setting");
        assert_eq!(
            invoke(
                &webview,
                "get_app_setting",
                json!({ "key": "updater.consent" })
            )
            .expect("get setting"),
            "yes"
        );

        // Pre-update backup round-trips: returns a path to a .sqlite3 snapshot.
        let backup = invoke(
            &webview,
            "backup_database",
            json!({ "label": "v0.3.0-test" }),
        )
        .expect("backup database");
        assert_eq!(backup["label"], "v0.3.0-test");
        assert!(backup["path"].as_str().expect("path").ends_with(".sqlite3"));

        // Clearing removes the snapshot just created.
        let cleared = invoke(&webview, "clear_backups", json!({})).expect("clear backups");
        assert!(cleared.as_u64().expect("count") >= 1);

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
            "get_today",
            "get_vault_status",
            "set_vault_passphrase",
            "unlock_vault",
            "remove_vault_passphrase",
            "search_trip",
            "preview_assist",
            "run_assist",
            "list_assist_activity",
            "list_advice_countries",
            "list_packs",
            "download_pack",
            "list_downloaded_packs",
            "delete_downloaded_pack",
            "get_recommendations",
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
            "get_app_setting",
            "set_app_setting",
            "backup_database",
            "clear_backups",
        ] {
            let error = invoke_with_body(&webview, command, json!({})).expect_err(command);
            assert!(
                error.to_string().contains("missing required key input"),
                "{command} did not pin the input key: {error}"
            );
        }
        cleanup_database(database);
    }

    #[test]
    fn updater_commands_report_disabled_in_dev_builds() {
        // Tests run with debug_assertions on, so the updater plugin is never
        // registered and the commands take their dev/source branch. They also
        // take an AppHandle rather than an `input` arg, so they invoke with an
        // empty body (unlike every command in the input-key test).
        let database = temp_database("updater");
        let app = test_app(&database);
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview");

        let check = invoke_with_body(&webview, "updater_check", json!({})).expect("check");
        assert_eq!(check["status"], "disabled");
        assert!(
            check["currentVersion"].as_str().is_some(),
            "check reports the running version"
        );

        // Install is refused in a dev/source build (no signing key, no plugin).
        invoke_with_body(&webview, "updater_install", json!({}))
            .expect_err("install disabled in dev");
        // updater_relaunch is intentionally not invoked here: it restarts the
        // process, which would tear down the test runner.

        cleanup_database(database);
    }

    // In-memory secret store so tests never touch (or mutate) the real OS
    // keychain — the vault now reads/writes its data key there on every open.
    struct NoNetFetcher;
    impl voyalier_app::AdviceFetcher for NoNetFetcher {
        fn fetch_text(&self, _url: &str) -> Result<String, AppError> {
            Ok(String::new())
        }
    }

    fn test_app(database: &PathBuf) -> tauri::App<MockRuntime> {
        let service = AppService::open_path_with_deps(
            database,
            std::sync::Arc::new(NoNetFetcher),
            std::sync::Arc::new(voyalier_app::MemorySecretStore::default()),
        )
        .expect("service");
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
