use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use voyalier_app::{AppService, BackupInfo, RestorePreview};
use voyalier_core::{
    AddManualFactInput, AddPackingItemInput, AdvisoryPanel, AiPromptSettings, AppError,
    AssistActivityEntry, AssistDraftResult, AssistReply, AssistRequestPreview, CandidateFact,
    CandidateStatus, ChatMessage, ConfirmCandidateInput, ConfirmedFact, CreateResourceInput,
    CreateTripInput, CreateTripItemInput, DestinationFactsSnapshot, DocumentContent,
    DocumentSummary, DownloadedPack, ErrorCode, FcdoCountry, FieldSuggestion, HealthResponse,
    ImportDocumentInput, ImportResult, InterestProfile, KeyValidation, LocalAiStatus,
    LocalModelPullResult, OfflineMapArchive, OfflineMapChunk, PackInfo, PackSuggestion,
    PackingItem, PersonaWeights, PlaceSummary, ProviderConfig, PublicHolidaysSnapshot,
    RecheckReport, Recommendation, ResearchSettings, Resource, SavePlaceInput, SavedPlace,
    SearchHit, SetInterestProfileInput, SetResearchSettingsInput, SetVisaItemProgressInput,
    SetVisaNationalityInput, TodayView, Trip, TripBrief, TripDetail, TripItem, TripNotes,
    TripSummary, UpdatePackingItemInput, UpdateResourceInput, UpdateSavedPlaceInput,
    UpdateTripInput, UpdateTripItemInput, VaultStatus, VisaPrep, WeatherSnapshot,
    WorkspaceSearchHit,
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
struct DocumentIdInput {
    document_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTripInput {
    trip_id: String,
    query: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QueryInput {
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
fn unarchive_trip(input: TripIdInput, service: State<'_, AppService>) -> Result<Trip, AppError> {
    service.unarchive_trip(&input.trip_id)
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
fn search_workspace(
    input: QueryInput,
    service: State<'_, AppService>,
) -> Result<Vec<WorkspaceSearchHit>, AppError> {
    service.search_workspace(&input.query)
}

#[tauri::command]
fn suggest_search_terms(
    input: SearchTripInput,
    service: State<'_, AppService>,
) -> Result<Vec<String>, AppError> {
    service.suggest_search_terms(&input.trip_id, &input.query)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssistDraftInput {
    trip_id: String,
    kind: String,
}

#[tauri::command]
fn preview_assist_draft(
    input: AssistDraftInput,
    service: State<'_, AppService>,
) -> Result<AssistRequestPreview, AppError> {
    service.preview_assist_draft(&input.trip_id, &input.kind)
}

#[tauri::command]
fn run_assist_draft(
    input: AssistDraftInput,
    service: State<'_, AppService>,
) -> Result<AssistDraftResult, AppError> {
    service.run_assist_draft(&input.trip_id, &input.kind)
}

#[tauri::command]
fn get_ai_prompts(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<AiPromptSettings, AppError> {
    let _ = input;
    service.get_ai_prompts()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetAiPromptInput {
    kind: String,
    /// The override text, or null to reset the instruction to its default.
    text: Option<String>,
}

#[tauri::command]
fn set_ai_prompt(
    input: SetAiPromptInput,
    service: State<'_, AppService>,
) -> Result<AiPromptSettings, AppError> {
    service.set_ai_prompt(&input.kind, input.text.as_deref())
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
fn suggest_packs(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Vec<PackSuggestion>, AppError> {
    service.suggest_packs(&input.trip_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuggestFieldValuesInput {
    trip_id: String,
    field: String,
    query: String,
}

#[tauri::command]
fn suggest_field_values(
    input: SuggestFieldValuesInput,
    service: State<'_, AppService>,
) -> Result<Vec<FieldSuggestion>, AppError> {
    service.suggest_field_values(&input.trip_id, &input.field, &input.query)
}

#[tauri::command]
fn suggest_places(
    input: QueryInput,
    service: State<'_, AppService>,
) -> Result<Vec<FieldSuggestion>, AppError> {
    service.suggest_places(&input.query)
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
fn get_offline_map(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Option<OfflineMapArchive>, AppError> {
    service.get_offline_map(&input.trip_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineMapRangeInput {
    trip_id: String,
    pack_id: String,
    offset: u64,
    length: u32,
}

#[tauri::command]
fn read_offline_map_range(
    input: OfflineMapRangeInput,
    service: State<'_, AppService>,
) -> Result<OfflineMapChunk, AppError> {
    service.read_offline_map_range(&input.trip_id, &input.pack_id, input.offset, input.length)
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
fn set_interest_profile(
    input: SetInterestProfileInput,
    service: State<'_, AppService>,
) -> Result<InterestProfile, AppError> {
    service.set_interest_profile(input)
}

#[tauri::command]
fn get_visa_prep(input: TripIdInput, service: State<'_, AppService>) -> Result<VisaPrep, AppError> {
    service.get_visa_prep(&input.trip_id)
}

#[tauri::command]
fn set_visa_nationality(
    input: SetVisaNationalityInput,
    service: State<'_, AppService>,
) -> Result<VisaPrep, AppError> {
    service.set_visa_nationality(input)
}

#[tauri::command]
fn set_visa_item_progress(
    input: SetVisaItemProgressInput,
    service: State<'_, AppService>,
) -> Result<VisaPrep, AppError> {
    service.set_visa_item_progress(input)
}

#[tauri::command]
fn save_place(
    input: SavePlaceInput,
    service: State<'_, AppService>,
) -> Result<SavedPlace, AppError> {
    service.save_place(input)
}

#[tauri::command]
fn update_saved_place(
    input: UpdateSavedPlaceInput,
    service: State<'_, AppService>,
) -> Result<SavedPlace, AppError> {
    service.update_saved_place(input)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedPlaceIdInput {
    saved_place_id: String,
}

#[tauri::command]
fn delete_saved_place(
    input: SavedPlaceIdInput,
    service: State<'_, AppService>,
) -> Result<(), AppError> {
    service.delete_saved_place(&input.saved_place_id)
}

#[tauri::command]
fn add_packing_item(
    input: AddPackingItemInput,
    service: State<'_, AppService>,
) -> Result<PackingItem, AppError> {
    service.add_packing_item(input)
}

#[tauri::command]
fn update_packing_item(
    input: UpdatePackingItemInput,
    service: State<'_, AppService>,
) -> Result<PackingItem, AppError> {
    service.update_packing_item(input)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PackingItemIdInput {
    packing_item_id: String,
}

#[tauri::command]
fn delete_packing_item(
    input: PackingItemIdInput,
    service: State<'_, AppService>,
) -> Result<(), AppError> {
    service.delete_packing_item(&input.packing_item_id)
}

#[tauri::command]
fn create_trip_item(
    input: CreateTripItemInput,
    service: State<'_, AppService>,
) -> Result<TripItem, AppError> {
    service.create_trip_item(input)
}

#[tauri::command]
fn update_trip_item(
    input: UpdateTripItemInput,
    service: State<'_, AppService>,
) -> Result<TripItem, AppError> {
    service.update_trip_item(input)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TripItemIdInput {
    trip_item_id: String,
}

#[tauri::command]
fn delete_trip_item(
    input: TripItemIdInput,
    service: State<'_, AppService>,
) -> Result<(), AppError> {
    service.delete_trip_item(&input.trip_item_id)
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
struct PullModelInput {
    model: String,
}

#[tauri::command]
fn pull_local_model(
    input: PullModelInput,
    service: State<'_, AppService>,
) -> Result<LocalModelPullResult, AppError> {
    service.pull_local_model(&input.model)
}

#[tauri::command]
fn validate_provider_key(
    input: SetProviderKeyInput,
    service: State<'_, AppService>,
) -> Result<KeyValidation, AppError> {
    service.validate_provider_key(&input.provider, &input.key)
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
fn fetch_advisories(
    input: FetchAdviceInput,
    service: State<'_, AppService>,
) -> Result<AdvisoryPanel, AppError> {
    service.fetch_advisories(&input.trip_id, &input.country_slug)
}

#[tauri::command]
fn fetch_weather(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<WeatherSnapshot, AppError> {
    service.fetch_weather(&input.trip_id)
}

#[tauri::command]
fn refresh_visa_stats(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<VisaPrep, AppError> {
    service.refresh_visa_stats(&input.trip_id)
}

#[tauri::command]
fn recheck_trip(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<RecheckReport, AppError> {
    service.recheck_trip(&input.trip_id)
}

#[tauri::command]
fn fetch_destination_facts(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<DestinationFactsSnapshot, AppError> {
    service.fetch_destination_facts(&input.trip_id)
}

#[tauri::command]
fn fetch_public_holidays(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<PublicHolidaysSnapshot, AppError> {
    service.fetch_public_holidays(&input.trip_id)
}

#[tauri::command]
fn fetch_place_summary(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<PlaceSummary, AppError> {
    service.fetch_place_summary(&input.trip_id)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResourceIdInput {
    resource_id: String,
}

#[tauri::command]
fn list_resources(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Vec<Resource>, AppError> {
    service.list_resources(&input.trip_id)
}

#[tauri::command]
fn create_resource(
    input: CreateResourceInput,
    service: State<'_, AppService>,
) -> Result<Resource, AppError> {
    service.create_resource(input)
}

#[tauri::command]
fn update_resource(
    input: UpdateResourceInput,
    service: State<'_, AppService>,
) -> Result<Resource, AppError> {
    service.update_resource(input)
}

#[tauri::command]
fn delete_resource(input: ResourceIdInput, service: State<'_, AppService>) -> Result<(), AppError> {
    service.delete_resource(&input.resource_id)
}

#[tauri::command]
fn fetch_resource_details(
    input: ResourceIdInput,
    service: State<'_, AppService>,
) -> Result<Resource, AppError> {
    service.fetch_resource_details(&input.resource_id)
}

#[tauri::command]
fn get_research_settings(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<ResearchSettings, AppError> {
    let _ = input;
    service.get_research_settings()
}

#[tauri::command]
fn set_research_settings(
    input: SetResearchSettingsInput,
    service: State<'_, AppService>,
) -> Result<ResearchSettings, AppError> {
    service.set_research_settings(input)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendChatMessageInput {
    trip_id: String,
    message: String,
}

#[tauri::command]
fn list_chat_messages(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Vec<ChatMessage>, AppError> {
    service.list_chat_messages(&input.trip_id)
}

#[tauri::command]
fn send_chat_message(
    input: SendChatMessageInput,
    service: State<'_, AppService>,
) -> Result<ChatMessage, AppError> {
    service.send_chat_message(&input.trip_id, &input.message)
}

#[tauri::command]
fn clear_chat(input: TripIdInput, service: State<'_, AppService>) -> Result<(), AppError> {
    service.clear_chat(&input.trip_id)
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetTripNotesInput {
    trip_id: String,
    body: String,
}

#[tauri::command]
fn get_trip_notes(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<TripNotes, AppError> {
    service.get_trip_notes(&input.trip_id)
}

#[tauri::command]
fn set_trip_notes(
    input: SetTripNotesInput,
    service: State<'_, AppService>,
) -> Result<TripNotes, AppError> {
    service.set_trip_notes(&input.trip_id, &input.body)
}

#[tauri::command]
fn list_documents(
    input: TripIdInput,
    service: State<'_, AppService>,
) -> Result<Vec<DocumentSummary>, AppError> {
    service.list_documents(&input.trip_id)
}

#[tauri::command]
fn get_document(
    input: DocumentIdInput,
    service: State<'_, AppService>,
) -> Result<DocumentContent, AppError> {
    service.get_document(&input.document_id)
}

#[tauri::command]
fn delete_document(input: DocumentIdInput, service: State<'_, AppService>) -> Result<(), AppError> {
    service.delete_document(&input.document_id)
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
// Workspace backup and restore. The native picker runs Rust-side and hands back
// only a path; the webview never reads or writes a file itself, which keeps the
// same posture as the updater. The passphrase arrives as a command argument and
// is never written anywhere — it only ever derives a key in voyalier-core.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPassphraseInput {
    passphrase: String,
}

const WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME: &str = "voyalier-portable-acceptance.vbk";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsDialogPurpose {
    Export,
    Restore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WindowsAcceptancePickerPhase {
    ExportCommandEntered,
    ExportContainerReady,
    ExportPresetValid,
    ExportBeforeDialog,
    ExportDialogReturnedNone,
    ExportDialogReturnedSome,
    ExportReturnedPathValid,
    ExportWriteComplete,
    RestoreCommandEntered,
    RestorePresetValid,
    RestoreBeforeDialog,
    RestoreDialogReturnedNone,
    RestoreDialogReturnedSome,
    RestoreReturnedPathValid,
    RestoreBackupRead,
    RestoreStaged,
}

impl WindowsAcceptancePickerPhase {
    fn marker_file_name(self) -> &'static str {
        match self {
            Self::ExportCommandEntered => "voyalier-picker-phase-export-01-command-entered",
            Self::ExportContainerReady => "voyalier-picker-phase-export-02-container-ready",
            Self::ExportPresetValid => "voyalier-picker-phase-export-03-preset-valid",
            Self::ExportBeforeDialog => "voyalier-picker-phase-export-04-before-dialog",
            Self::ExportDialogReturnedNone => {
                "voyalier-picker-phase-export-05-dialog-returned-none"
            }
            Self::ExportDialogReturnedSome => {
                "voyalier-picker-phase-export-06-dialog-returned-some"
            }
            Self::ExportReturnedPathValid => "voyalier-picker-phase-export-07-returned-path-valid",
            Self::ExportWriteComplete => "voyalier-picker-phase-export-08-write-complete",
            Self::RestoreCommandEntered => "voyalier-picker-phase-restore-01-command-entered",
            Self::RestorePresetValid => "voyalier-picker-phase-restore-02-preset-valid",
            Self::RestoreBeforeDialog => "voyalier-picker-phase-restore-03-before-dialog",
            Self::RestoreDialogReturnedNone => {
                "voyalier-picker-phase-restore-04-dialog-returned-none"
            }
            Self::RestoreDialogReturnedSome => {
                "voyalier-picker-phase-restore-05-dialog-returned-some"
            }
            Self::RestoreReturnedPathValid => {
                "voyalier-picker-phase-restore-06-returned-path-valid"
            }
            Self::RestoreBackupRead => "voyalier-picker-phase-restore-07-backup-read",
            Self::RestoreStaged => "voyalier-picker-phase-restore-08-staged",
        }
    }

    fn required_previous(self) -> Option<Self> {
        Some(match self {
            Self::ExportCommandEntered => return None,
            Self::ExportContainerReady => Self::ExportCommandEntered,
            Self::ExportPresetValid => Self::ExportContainerReady,
            Self::ExportBeforeDialog => Self::ExportPresetValid,
            Self::ExportDialogReturnedNone | Self::ExportDialogReturnedSome => {
                Self::ExportBeforeDialog
            }
            Self::ExportReturnedPathValid => Self::ExportDialogReturnedSome,
            Self::ExportWriteComplete => Self::ExportReturnedPathValid,
            Self::RestoreCommandEntered => Self::ExportWriteComplete,
            Self::RestorePresetValid => Self::RestoreCommandEntered,
            Self::RestoreBeforeDialog => Self::RestorePresetValid,
            Self::RestoreDialogReturnedNone | Self::RestoreDialogReturnedSome => {
                Self::RestoreBeforeDialog
            }
            Self::RestoreReturnedPathValid => Self::RestoreDialogReturnedSome,
            Self::RestoreBackupRead => Self::RestoreReturnedPathValid,
            Self::RestoreStaged => Self::RestoreBackupRead,
        })
    }

    fn exclusive_peer(self) -> Option<Self> {
        match self {
            Self::ExportDialogReturnedNone => Some(Self::ExportDialogReturnedSome),
            Self::ExportDialogReturnedSome => Some(Self::ExportDialogReturnedNone),
            Self::RestoreDialogReturnedNone => Some(Self::RestoreDialogReturnedSome),
            Self::RestoreDialogReturnedSome => Some(Self::RestoreDialogReturnedNone),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WindowsAcceptanceDialogPreset {
    directory: std::path::PathBuf,
    file_name: String,
    target: std::path::PathBuf,
}

#[derive(Debug)]
struct WindowsDialogAutomation {
    preset: Result<Option<WindowsAcceptanceDialogPreset>, String>,
}

impl WindowsDialogAutomation {
    fn inactive() -> Self {
        Self { preset: Ok(None) }
    }

    fn for_purpose(
        &self,
        purpose: WindowsDialogPurpose,
    ) -> Result<Option<&WindowsAcceptanceDialogPreset>, AppError> {
        let preset = self.preset.as_ref().map_err(|detail| {
            AppError::new(
                ErrorCode::StorageFailure,
                format!("Windows acceptance picker configuration was rejected: {detail}"),
            )
        })?;
        if let Some(preset) = preset {
            preset.validate_before_dialog(purpose).map_err(|detail| {
                AppError::new(
                    ErrorCode::StorageFailure,
                    format!("Windows acceptance picker target was rejected: {detail}"),
                )
            })?;
        }
        Ok(preset.as_ref())
    }

    fn record_phase(&self, phase: WindowsAcceptancePickerPhase) -> Result<(), AppError> {
        let Some(preset) = self.preset.as_ref().ok().and_then(Option::as_ref) else {
            return Ok(());
        };
        preset.record_phase(phase).map_err(|detail| {
            AppError::new(
                ErrorCode::StorageFailure,
                format!("Windows acceptance picker diagnostics failed: {detail}"),
            )
        })
    }
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug)]
struct WindowsStartupAutomation {
    webview: Option<WindowsAutomationConfig>,
    dialog: WindowsDialogAutomation,
}

#[cfg(any(target_os = "windows", test))]
impl WindowsStartupAutomation {
    fn from_values(
        automation: Option<&str>,
        browser_args: Option<&str>,
        profile: Option<&str>,
        runner_temp: Option<&std::path::Path>,
        target: Option<&std::path::Path>,
    ) -> Self {
        let webview = windows_automation_config(automation, browser_args, profile);
        let dialog = WindowsDialogAutomation {
            preset: windows_acceptance_dialog_preset(webview.is_some(), runner_temp, target),
        };
        Self { webview, dialog }
    }

    #[cfg(target_os = "windows")]
    fn from_environment() -> Self {
        let automation = std::env::var("TAURI_WEBVIEW_AUTOMATION").ok();
        let browser_args = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").ok();
        let profile = std::env::var("VOYALIER_WINDOWS_WEBDRIVER_PROFILE").ok();
        let runner_temp = std::env::var_os("RUNNER_TEMP").map(std::path::PathBuf::from);
        let target = std::env::var_os("VOYALIER_WINDOWS_ACCEPTANCE_BACKUP_PATH")
            .map(std::path::PathBuf::from);
        Self::from_values(
            automation.as_deref(),
            browser_args.as_deref(),
            profile.as_deref(),
            runner_temp.as_deref(),
            target.as_deref(),
        )
    }
}

fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        metadata.file_type().is_symlink()
    }
}

fn has_ambiguous_components(path: &std::path::Path) -> bool {
    path.components().any(|component| {
        matches!(
            component,
            std::path::Component::CurDir | std::path::Component::ParentDir
        )
    })
}

#[cfg(any(target_os = "windows", test))]
fn windows_acceptance_dialog_preset(
    complete_gate: bool,
    runner_temp: Option<&std::path::Path>,
    requested_target: Option<&std::path::Path>,
) -> Result<Option<WindowsAcceptanceDialogPreset>, String> {
    if !complete_gate {
        return Ok(None);
    }
    let runner_temp = runner_temp.ok_or("RUNNER_TEMP is missing")?;
    let requested_target = requested_target.ok_or("the dedicated backup target is missing")?;
    if !runner_temp.is_absolute() || !requested_target.is_absolute() {
        return Err("the runner root and backup target must be absolute".to_owned());
    }
    if has_ambiguous_components(requested_target) {
        return Err("the backup target contains ambiguous path components".to_owned());
    }
    if requested_target
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        != Some(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME)
    {
        return Err("the backup target has an unexpected filename".to_owned());
    }
    let requested_parent = requested_target
        .parent()
        .ok_or("the backup target has no parent directory")?;
    let parent_metadata = std::fs::symlink_metadata(requested_parent)
        .map_err(|_| "the backup target parent is unavailable".to_owned())?;
    if !parent_metadata.is_dir() || is_reparse_point(&parent_metadata) {
        return Err("the backup target parent must be a non-reparse directory".to_owned());
    }
    let canonical_root = std::fs::canonicalize(runner_temp)
        .map_err(|_| "the runner temporary root could not be canonicalized".to_owned())?;
    let canonical_parent = std::fs::canonicalize(requested_parent)
        .map_err(|_| "the backup target parent could not be canonicalized".to_owned())?;
    let relative_parent = canonical_parent
        .strip_prefix(&canonical_root)
        .map_err(|_| "the backup target is outside the runner temporary root".to_owned())?;
    let mut components = relative_parent.components();
    let acceptance_directory = components
        .next()
        .and_then(|component| component.as_os_str().to_str())
        .ok_or("the backup target is not inside an acceptance directory")?;
    if components.next().is_some()
        || !acceptance_directory.starts_with("voyalier-windows-acceptance-")
        || acceptance_directory
            .strip_prefix("voyalier-windows-acceptance-")
            .is_none_or(|suffix| {
                suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit())
            })
    {
        return Err("the backup target parent is not the exact acceptance directory".to_owned());
    }
    let target = canonical_parent.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME);
    Ok(Some(WindowsAcceptanceDialogPreset {
        directory: canonical_parent,
        file_name: WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME.to_owned(),
        target,
    }))
}

impl WindowsAcceptanceDialogPreset {
    fn record_phase(&self, phase: WindowsAcceptancePickerPhase) -> Result<(), String> {
        let metadata = std::fs::symlink_metadata(&self.directory)
            .map_err(|_| "the diagnostic directory is unavailable".to_owned())?;
        if !metadata.is_dir() || is_reparse_point(&metadata) {
            return Err("the diagnostic directory is not a regular directory".to_owned());
        }
        let canonical = std::fs::canonicalize(&self.directory)
            .map_err(|_| "the diagnostic directory could not be canonicalized".to_owned())?;
        if canonical != self.directory {
            return Err("the diagnostic directory changed after configuration".to_owned());
        }
        if let Some(previous) = phase.required_previous() {
            let metadata =
                std::fs::symlink_metadata(self.directory.join(previous.marker_file_name()))
                    .map_err(|_| "the previous diagnostic phase is missing".to_owned())?;
            if !metadata.is_file() || is_reparse_point(&metadata) || metadata.len() != 0 {
                return Err("the previous diagnostic phase is invalid".to_owned());
            }
        }
        if let Some(peer) = phase.exclusive_peer() {
            match std::fs::symlink_metadata(self.directory.join(peer.marker_file_name())) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err("a conflicting diagnostic phase already exists".to_owned()),
            }
        }
        let marker = self.directory.join(phase.marker_file_name());
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(marker)
            .map_err(|_| "an exact diagnostic marker could not be created".to_owned())?;
        file.sync_all()
            .map_err(|_| "an exact diagnostic marker could not be persisted".to_owned())
    }

    fn validate_before_dialog(&self, purpose: WindowsDialogPurpose) -> Result<(), String> {
        match (purpose, std::fs::symlink_metadata(&self.target)) {
            (WindowsDialogPurpose::Export, Err(error))
                if error.kind() == std::io::ErrorKind::NotFound =>
            {
                Ok(())
            }
            (WindowsDialogPurpose::Export, _) => Err("the export target already exists".to_owned()),
            (WindowsDialogPurpose::Restore, Ok(metadata))
                if metadata.is_file() && !is_reparse_point(&metadata) =>
            {
                let canonical = std::fs::canonicalize(&self.target)
                    .map_err(|_| "the restore target could not be canonicalized".to_owned())?;
                if canonical == self.target {
                    Ok(())
                } else {
                    Err("the restore target changed after configuration".to_owned())
                }
            }
            (WindowsDialogPurpose::Restore, _) => {
                Err("the restore target must be an existing regular file".to_owned())
            }
        }
    }

    fn validate_chosen_path(
        &self,
        purpose: WindowsDialogPurpose,
        chosen: &std::path::Path,
    ) -> Result<(), String> {
        if !chosen.is_absolute()
            || has_ambiguous_components(chosen)
            || chosen.file_name().and_then(std::ffi::OsStr::to_str)
                != Some(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME)
        {
            return Err("the picker returned an unexpected backup path".to_owned());
        }
        let parent = chosen
            .parent()
            .ok_or("the picker returned a path without a parent")?;
        let canonical_parent = std::fs::canonicalize(parent)
            .map_err(|_| "the chosen parent could not be canonicalized".to_owned())?;
        if canonical_parent != self.directory
            || canonical_parent.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME) != self.target
        {
            return Err("the picker returned a target outside the configured directory".to_owned());
        }
        self.validate_before_dialog(purpose)
    }
}

fn write_new_backup_file(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)
}

/// A picker outcome with no selected file is `None`, not an error. This covers
/// the traveler's normal cancel action; the dialog backend does not expose why
/// it returned no selection.
#[tauri::command]
async fn export_backup<R: tauri::Runtime>(
    input: BackupPassphraseInput,
    app: tauri::AppHandle<R>,
    service: State<'_, AppService>,
    dialog_automation: State<'_, WindowsDialogAutomation>,
) -> Result<Option<String>, AppError> {
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportCommandEntered)?;
    // Build the container first, so a refused passphrase or a locked vault
    // fails before a file picker ever appears.
    let bytes = service.export_backup(&input.passphrase)?;
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportContainerReady)?;
    let preset = dialog_automation.for_purpose(WindowsDialogPurpose::Export)?;
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportPresetValid)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Save Voyalier backup")
        .add_filter("Voyalier backup", &["vbk"])
        .set_file_name(default_backup_file_name());
    if let Some(preset) = preset {
        dialog = dialog
            .set_directory(&preset.directory)
            .set_file_name(&preset.file_name);
    }
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportBeforeDialog)?;
    let Some(chosen) = dialog.blocking_save_file() else {
        dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportDialogReturnedNone)?;
        return Ok(None);
    };
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportDialogReturnedSome)?;
    let path = chosen.into_path().map_err(|error| {
        AppError::new(
            ErrorCode::StorageFailure,
            format!("the chosen location could not be used: {error}"),
        )
    })?;
    if let Some(preset) = preset {
        preset
            .validate_chosen_path(WindowsDialogPurpose::Export, &path)
            .map_err(|detail| AppError::new(ErrorCode::StorageFailure, detail))?;
    }
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportReturnedPathValid)?;
    let write_result = if preset.is_some() {
        write_new_backup_file(&path, &bytes)
    } else {
        std::fs::write(&path, &bytes)
    };
    write_result.map_err(|error| {
        AppError::new(
            ErrorCode::StorageFailure,
            format!("the backup could not be written: {error}"),
        )
    })?;
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::ExportWriteComplete)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn stage_restore<R: tauri::Runtime>(
    input: BackupPassphraseInput,
    app: tauri::AppHandle<R>,
    service: State<'_, AppService>,
    dialog_automation: State<'_, WindowsDialogAutomation>,
) -> Result<Option<RestorePreview>, AppError> {
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreCommandEntered)?;
    let preset = dialog_automation.for_purpose(WindowsDialogPurpose::Restore)?;
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestorePresetValid)?;
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Choose a Voyalier backup")
        .add_filter("Voyalier backup", &["vbk"]);
    if let Some(preset) = preset {
        dialog = dialog
            .set_directory(&preset.directory)
            .set_file_name(&preset.file_name);
    }
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreBeforeDialog)?;
    let Some(chosen) = dialog.blocking_pick_file() else {
        dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreDialogReturnedNone)?;
        return Ok(None);
    };
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreDialogReturnedSome)?;
    let path = chosen.into_path().map_err(|error| {
        AppError::new(
            ErrorCode::StorageFailure,
            format!("the chosen file could not be used: {error}"),
        )
    })?;
    if let Some(preset) = preset {
        preset
            .validate_chosen_path(WindowsDialogPurpose::Restore, &path)
            .map_err(|detail| AppError::new(ErrorCode::StorageFailure, detail))?;
    }
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreReturnedPathValid)?;
    let bytes = std::fs::read(&path).map_err(|error| {
        AppError::new(
            ErrorCode::StorageFailure,
            format!("the backup could not be read: {error}"),
        )
    })?;
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreBackupRead)?;
    let preview = service.stage_restore(&input.passphrase, &bytes)?;
    dialog_automation.record_phase(WindowsAcceptancePickerPhase::RestoreStaged)?;
    Ok(Some(preview))
}

#[tauri::command]
fn has_pending_restore(
    input: EmptyInput,
    service: State<'_, AppService>,
) -> Result<bool, AppError> {
    let _ = input;
    Ok(service.has_pending_restore())
}

/// A dated default filename, so consecutive backups do not silently overwrite
/// each other in the picker.
fn default_backup_file_name() -> String {
    let today = voyalier_core::now_rfc3339();
    let day = today.split('T').next().unwrap_or("backup");
    format!("voyalier-backup-{day}.vbk")
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
    dialog_automation: WindowsDialogAutomation,
) -> tauri::Builder<R> {
    builder
        .manage(service)
        .manage(dialog_automation)
        .invoke_handler(tauri::generate_handler![
            health,
            create_trip,
            list_trips,
            get_trip,
            update_trip,
            archive_trip,
            unarchive_trip,
            get_trip_brief,
            get_today,
            get_vault_status,
            set_vault_passphrase,
            unlock_vault,
            remove_vault_passphrase,
            search_trip,
            search_workspace,
            suggest_search_terms,
            preview_assist,
            run_assist,
            preview_assist_draft,
            run_assist_draft,
            get_ai_prompts,
            set_ai_prompt,
            list_assist_activity,
            list_advice_countries,
            list_packs,
            suggest_packs,
            suggest_field_values,
            suggest_places,
            download_pack,
            list_downloaded_packs,
            delete_downloaded_pack,
            get_offline_map,
            read_offline_map_range,
            get_recommendations,
            set_interest_profile,
            get_visa_prep,
            set_visa_nationality,
            set_visa_item_progress,
            refresh_visa_stats,
            save_place,
            update_saved_place,
            delete_saved_place,
            add_packing_item,
            update_packing_item,
            delete_packing_item,
            create_trip_item,
            update_trip_item,
            delete_trip_item,
            detect_local_ai,
            pull_local_model,
            list_providers,
            set_provider_key,
            validate_provider_key,
            clear_provider_key,
            set_provider_model,
            fetch_advisories,
            fetch_weather,
            recheck_trip,
            fetch_destination_facts,
            fetch_public_holidays,
            fetch_place_summary,
            list_resources,
            create_resource,
            update_resource,
            delete_resource,
            fetch_resource_details,
            get_research_settings,
            set_research_settings,
            list_chat_messages,
            send_chat_message,
            clear_chat,
            delete_trip,
            import_document,
            get_trip_notes,
            set_trip_notes,
            list_documents,
            get_document,
            delete_document,
            list_candidates,
            confirm_candidate,
            reject_candidate,
            add_manual_fact,
            unconfirm_fact,
            get_app_setting,
            set_app_setting,
            backup_database,
            clear_backups,
            export_backup,
            stage_restore,
            has_pending_restore,
            updater_check,
            updater_install,
            updater_relaunch
        ])
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, PartialEq, Eq)]
struct WindowsAutomationConfig {
    additional_browser_args: String,
    data_directory: String,
}

#[cfg(any(target_os = "windows", test))]
fn windows_automation_config(
    automation: Option<&str>,
    browser_args: Option<&str>,
    profile: Option<&str>,
) -> Option<WindowsAutomationConfig> {
    // WebView2 Runtime 150 ignores EdgeDriver's environment-supplied port for
    // elevated hosts. Forward only the numeric port through the WebView2 API;
    // never expose arbitrary browser flags from the environment.
    if automation != Some("true") {
        return None;
    }
    let profile = profile?;
    if profile.len() > 64
        || !profile.starts_with("voyalier-acceptance-")
        || !profile
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return None;
    }
    let ports = browser_args?
        .split_ascii_whitespace()
        .filter_map(|argument| argument.strip_prefix("--remote-debugging-port="))
        .map(str::parse::<u16>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if ports.len() != 1 {
        return None;
    }

    Some(WindowsAutomationConfig {
        additional_browser_args: format!(
            "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={}",
            ports[0]
        ),
        data_directory: profile.to_owned(),
    })
}

#[cfg(target_os = "windows")]
fn apply_windows_automation_config(
    context: &mut tauri::Context<tauri::Wry>,
    config: Option<&WindowsAutomationConfig>,
) {
    let Some(config) = config else {
        return;
    };
    let window = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
        .expect("main window configuration must exist");
    window.additional_browser_args = Some(config.additional_browser_args.clone());
    window.data_directory = Some(config.data_directory.clone().into());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let service = AppService::open_default().expect("Voyalier storage must initialize");
    let context = tauri::generate_context!();
    #[cfg(target_os = "windows")]
    let (context, dialog_automation) = {
        let startup_automation = WindowsStartupAutomation::from_environment();
        let mut context = context;
        apply_windows_automation_config(&mut context, startup_automation.webview.as_ref());
        (context, startup_automation.dialog)
    };
    #[cfg(not(target_os = "windows"))]
    let dialog_automation = WindowsDialogAutomation::inactive();
    #[cfg_attr(debug_assertions, allow(unused_mut))]
    let mut app = builder(tauri::Builder::default(), service, dialog_automation);
    // Native pickers for backup/restore. Registered in every build (unlike the
    // updater) because backing your workspace up is not a release-only concern.
    // Only our Rust commands call it; the webview holds no dialog capability.
    app = app.plugin(tauri_plugin_dialog::init());
    // The updater plugin reads its fixed endpoint + pubkey from tauri.conf.json.
    // Registered only in packaged/release builds: a source/dev build has no
    // signing key, and its updater commands report the disabled state instead.
    #[cfg(not(debug_assertions))]
    {
        app = app.plugin(tauri_plugin_updater::Builder::new().build());
    }
    app.run(context).expect("error while running Voyalier");
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
    fn windows_automation_is_explicit_and_fail_closed() {
        let expected = WindowsAutomationConfig {
            additional_browser_args: "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=0".to_owned(),
            data_directory: "voyalier-acceptance-base".to_owned(),
        };
        assert_eq!(
            windows_automation_config(
                Some("true"),
                Some("--remote-debugging-port=0 --ignored-flag"),
                Some("voyalier-acceptance-base"),
            ),
            Some(expected)
        );
        assert_eq!(
            windows_automation_config(
                Some("false"),
                Some("--remote-debugging-port=0"),
                Some("voyalier-acceptance-base"),
            ),
            None
        );
        assert_eq!(
            windows_automation_config(
                Some("true"),
                Some("--remote-debugging-port=70000"),
                Some("voyalier-acceptance-base"),
            ),
            None
        );
        assert_eq!(
            windows_automation_config(
                Some("true"),
                Some("--remote-debugging-port=0 --remote-debugging-port=1"),
                Some("voyalier-acceptance-base"),
            ),
            None
        );
        assert_eq!(
            windows_automation_config(
                Some("true"),
                Some("--remote-debugging-port=0"),
                Some("voyalier-acceptance-../escape"),
            ),
            None
        );
    }

    #[test]
    fn windows_startup_automation_reuses_one_complete_gate() {
        let database = temp_database("startup-automation");
        let runner_temp = database.parent().expect("runner temp").to_path_buf();
        let acceptance = runner_temp.join("voyalier-windows-acceptance-812");
        fs::create_dir_all(&acceptance).expect("acceptance directory");
        let target = acceptance.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME);

        let active = WindowsStartupAutomation::from_values(
            Some("true"),
            Some("--remote-debugging-port=0"),
            Some("voyalier-acceptance-journey"),
            Some(&runner_temp),
            Some(&target),
        );
        assert!(active.webview.is_some());
        assert!(active.dialog.preset.expect("active preset").is_some());

        let inactive = WindowsStartupAutomation::from_values(
            Some("false"),
            Some("--remote-debugging-port=0"),
            Some("voyalier-acceptance-journey"),
            Some(&runner_temp),
            Some(&target),
        );
        assert!(inactive.webview.is_none());
        assert_eq!(inactive.dialog.preset, Ok(None));

        let malformed = WindowsStartupAutomation::from_values(
            Some("true"),
            Some("--remote-debugging-port=0"),
            Some("voyalier-acceptance-journey"),
            Some(&runner_temp),
            None,
        );
        assert!(malformed.webview.is_some());
        assert!(malformed.dialog.preset.is_err());
        cleanup_database(database);
    }

    #[test]
    fn windows_picker_preset_is_explicit_and_checks_each_file_lifecycle() {
        let database = temp_database("picker-preset");
        let runner_temp = database.parent().expect("runner temp").to_path_buf();
        let acceptance = runner_temp.join("voyalier-windows-acceptance-123");
        fs::create_dir_all(&acceptance).expect("acceptance directory");
        let target = acceptance.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME);

        assert_eq!(
            windows_acceptance_dialog_preset(false, Some(&runner_temp), Some(&target)),
            Ok(None),
            "a stray target must not mutate an ordinary launch",
        );
        assert!(
            windows_acceptance_dialog_preset(true, Some(&runner_temp), None).is_err(),
            "the complete automation gate must not silently lose its target",
        );
        assert!(
            windows_acceptance_dialog_preset(true, None, Some(&target)).is_err(),
            "the complete automation gate must not accept an unknown temporary root",
        );

        let preset = windows_acceptance_dialog_preset(true, Some(&runner_temp), Some(&target))
            .expect("valid preset")
            .expect("active preset");
        assert_eq!(preset.file_name, WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME);
        assert_eq!(preset.target, preset.directory.join(&preset.file_name));
        assert_eq!(
            preset.validate_before_dialog(WindowsDialogPurpose::Export),
            Ok(())
        );
        assert_eq!(
            preset.validate_chosen_path(WindowsDialogPurpose::Export, &preset.target),
            Ok(())
        );

        write_new_backup_file(&preset.target, b"portable backup").expect("backup fixture");
        assert!(
            write_new_backup_file(&preset.target, b"replacement").is_err(),
            "the acceptance export must atomically refuse a competing file",
        );
        assert_eq!(
            fs::read(&preset.target).expect("preserved backup fixture"),
            b"portable backup",
        );
        assert!(
            preset
                .validate_before_dialog(WindowsDialogPurpose::Export)
                .is_err(),
            "export must never overwrite a pre-existing acceptance target",
        );
        assert_eq!(
            preset.validate_before_dialog(WindowsDialogPurpose::Restore),
            Ok(())
        );
        assert_eq!(
            preset.validate_chosen_path(WindowsDialogPurpose::Restore, &preset.target),
            Ok(())
        );

        fs::remove_file(&preset.target).expect("remove backup fixture");
        assert!(
            preset
                .validate_before_dialog(WindowsDialogPurpose::Restore)
                .is_err(),
            "restore requires the exported regular file",
        );
        fs::create_dir(&preset.target).expect("directory target fixture");
        assert!(
            preset
                .validate_before_dialog(WindowsDialogPurpose::Restore)
                .is_err(),
            "restore must reject a directory at the configured target",
        );
        fs::remove_dir(&preset.target).expect("remove directory target fixture");
        cleanup_database(database);
    }

    #[test]
    fn windows_picker_phase_markers_are_dormant_content_free_and_atomic() {
        let database = temp_database("picker-phase-markers");
        let runner_temp = database.parent().expect("runner temp").to_path_buf();
        let acceptance = runner_temp.join("voyalier-windows-acceptance-901");
        fs::create_dir_all(&acceptance).expect("acceptance directory");
        let target = acceptance.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME);

        WindowsDialogAutomation::inactive()
            .record_phase(WindowsAcceptancePickerPhase::ExportCommandEntered)
            .expect("inactive diagnostics are a no-op");
        assert!(
            fs::read_dir(&acceptance)
                .expect("inactive acceptance directory")
                .next()
                .is_none(),
            "an ordinary launch must not emit acceptance diagnostics",
        );

        let preset = windows_acceptance_dialog_preset(true, Some(&runner_temp), Some(&target))
            .expect("valid preset")
            .expect("active preset");
        let automation = WindowsDialogAutomation {
            preset: Ok(Some(preset.clone())),
        };
        assert!(
            automation
                .record_phase(WindowsAcceptancePickerPhase::ExportContainerReady)
                .is_err(),
            "a later marker must not appear before its exact predecessor",
        );
        automation
            .record_phase(WindowsAcceptancePickerPhase::ExportCommandEntered)
            .expect("first phase marker");
        let marker = preset
            .directory
            .join(WindowsAcceptancePickerPhase::ExportCommandEntered.marker_file_name());
        assert_eq!(fs::metadata(&marker).expect("phase marker").len(), 0);
        assert!(
            automation
                .record_phase(WindowsAcceptancePickerPhase::ExportCommandEntered)
                .is_err(),
            "a phase marker must never overwrite an existing filesystem entry",
        );
        automation
            .record_phase(WindowsAcceptancePickerPhase::ExportContainerReady)
            .expect("next phase marker");
        assert_eq!(
            fs::metadata(
                preset
                    .directory
                    .join(WindowsAcceptancePickerPhase::ExportContainerReady.marker_file_name(),),
            )
            .expect("next phase marker")
            .len(),
            0,
        );
        automation
            .record_phase(WindowsAcceptancePickerPhase::ExportPresetValid)
            .expect("preset phase marker");
        automation
            .record_phase(WindowsAcceptancePickerPhase::ExportBeforeDialog)
            .expect("before-dialog phase marker");
        automation
            .record_phase(WindowsAcceptancePickerPhase::ExportDialogReturnedNone)
            .expect("returned-none phase marker");
        assert!(
            automation
                .record_phase(WindowsAcceptancePickerPhase::ExportDialogReturnedSome)
                .is_err(),
            "returned-none and returned-some dialog branches must be mutually exclusive",
        );
        cleanup_database(database);
    }

    #[test]
    fn windows_picker_preset_rejects_ambiguous_or_unowned_targets() {
        let database = temp_database("picker-preset-invalid");
        let runner_temp = database.parent().expect("runner temp").to_path_buf();
        let acceptance = runner_temp.join("voyalier-windows-acceptance-456");
        let nested = acceptance.join("nested");
        let unowned = runner_temp.join("not-voyalier-owned");
        fs::create_dir_all(&nested).expect("nested directory");
        fs::create_dir_all(&unowned).expect("unowned directory");

        let invalid_targets = [
            std::path::PathBuf::from(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME),
            runner_temp.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME),
            nested.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME),
            unowned.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME),
            acceptance.join("wrong-name.vbk"),
            acceptance.join("voyalier-portable-acceptance.zip"),
            acceptance
                .join("..")
                .join("voyalier-windows-acceptance-456")
                .join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME),
        ];
        for target in invalid_targets {
            assert!(
                windows_acceptance_dialog_preset(true, Some(&runner_temp), Some(&target),).is_err(),
                "invalid target was accepted",
            );
        }

        let outside_root = runner_temp.with_file_name(format!(
            "{}-sibling",
            runner_temp
                .file_name()
                .expect("root name")
                .to_string_lossy()
        ));
        let outside_acceptance = outside_root.join("voyalier-windows-acceptance-789");
        fs::create_dir_all(&outside_acceptance).expect("outside directory");
        assert!(
            windows_acceptance_dialog_preset(
                true,
                Some(&runner_temp),
                Some(&outside_acceptance.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME)),
            )
            .is_err(),
            "a prefix sibling must not pass segment-aware containment",
        );
        let _ = fs::remove_dir_all(outside_root);

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;

            let real_parent = runner_temp.join("real-parent");
            let reparse_parent = runner_temp.join("voyalier-windows-acceptance-999");
            fs::create_dir_all(&real_parent).expect("real parent");
            symlink(&real_parent, &reparse_parent).expect("reparse fixture");
            assert!(
                windows_acceptance_dialog_preset(
                    true,
                    Some(&runner_temp),
                    Some(&reparse_parent.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME)),
                )
                .is_err(),
                "a reparse target parent must fail closed",
            );
        }

        cleanup_database(database);
    }

    #[test]
    fn windows_picker_preset_rejects_a_different_returned_path() {
        let database = temp_database("picker-preset-mismatch");
        let runner_temp = database.parent().expect("runner temp").to_path_buf();
        let acceptance = runner_temp.join("voyalier-windows-acceptance-321");
        let other_acceptance = runner_temp.join("voyalier-windows-acceptance-654");
        fs::create_dir_all(&acceptance).expect("acceptance directory");
        fs::create_dir_all(&other_acceptance).expect("other acceptance directory");
        let target = acceptance.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME);
        let preset = windows_acceptance_dialog_preset(true, Some(&runner_temp), Some(&target))
            .expect("valid preset")
            .expect("active preset");

        assert!(
            preset
                .validate_chosen_path(
                    WindowsDialogPurpose::Export,
                    &other_acceptance.join(WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME),
                )
                .is_err(),
            "the configured preset is not authority for a different returned path",
        );
        assert!(
            preset
                .validate_chosen_path(
                    WindowsDialogPurpose::Export,
                    &acceptance.join("different.vbk"),
                )
                .is_err(),
        );
        cleanup_database(database);
    }

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

        // The documents manager over real IPC: list, read the body back, delete.
        let documents = invoke(&webview, "list_documents", json!({ "tripId": trip_id }))
            .expect("list documents");
        assert_eq!(documents.as_array().expect("documents").len(), 1);
        assert_eq!(documents[0]["document"]["label"], "Flight memo");
        assert_eq!(documents[0]["pendingCount"], 1);
        assert_eq!(documents[0]["confirmedCount"], 0);
        let document_id = documents[0]["document"]["id"]
            .as_str()
            .expect("document id")
            .to_owned();
        assert!(
            invoke(
                &webview,
                "get_document",
                json!({ "documentId": document_id }),
            )
            .expect("get document")["content"]
                .as_str()
                .expect("content")
                .contains("HOLD9")
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

        // Relaxed typeahead suggestions come back for a partial word.
        let terms = invoke(
            &webview,
            "suggest_search_terms",
            json!({ "tripId": trip_id, "query": "SF" }),
        )
        .expect("suggest search terms");
        assert!(terms.as_array().expect("terms").iter().any(|term| {
            term.as_str()
                .is_some_and(|value| value.eq_ignore_ascii_case("SFO"))
        }));

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
            "unarchive_trip",
            "get_trip_brief",
            "get_today",
            "get_vault_status",
            "set_vault_passphrase",
            "unlock_vault",
            "remove_vault_passphrase",
            "search_trip",
            "suggest_search_terms",
            "preview_assist",
            "run_assist",
            "preview_assist_draft",
            "run_assist_draft",
            "get_ai_prompts",
            "set_ai_prompt",
            "list_assist_activity",
            "list_advice_countries",
            "list_packs",
            "suggest_packs",
            "suggest_field_values",
            "suggest_places",
            "download_pack",
            "list_downloaded_packs",
            "delete_downloaded_pack",
            "get_offline_map",
            "read_offline_map_range",
            "get_recommendations",
            "detect_local_ai",
            "pull_local_model",
            "list_providers",
            "set_provider_key",
            "validate_provider_key",
            "clear_provider_key",
            "set_provider_model",
            "fetch_advisories",
            "fetch_weather",
            "recheck_trip",
            "refresh_visa_stats",
            "fetch_destination_facts",
            "fetch_public_holidays",
            "fetch_place_summary",
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
            "export_backup",
            "stage_restore",
            "has_pending_restore",
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
        builder(mock_builder(), service, WindowsDialogAutomation::inactive())
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

    /// What a method puts inside the Tauri `input` envelope: either the whole
    /// typed input object (`"input"`), or a literal list of keys the gateway
    /// hand-writes. See ADR-0012.
    #[derive(serde::Deserialize)]
    #[serde(untagged)]
    enum PayloadKeys {
        /// `"input"`: forwarded whole onto a shared voyalier-core type.
        Whole(String),
        /// A literal list the gateway writes itself.
        Keys(Vec<String>),
        /// Forwarded whole, but read here through a locally re-declared
        /// struct -- so the key set is checkable and worth checking.
        WholeRedeclared { whole: Vec<String> },
    }

    #[derive(serde::Deserialize)]
    struct RoutePayload {
        command: PayloadKeys,
    }

    #[derive(serde::Deserialize)]
    struct SharedRoute {
        method: String,
        command: String,
        payload: RoutePayload,
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

    fn load_route_manifest() -> RouteManifest {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/contracts/parity/routes.json");
        let raw = std::fs::read_to_string(&path).expect("parity/routes.json");
        serde_json::from_str(&raw).expect("parity/routes.json parses")
    }

    /// The identifiers inside `tauri::generate_handler![...]`. The macro leaves no
    /// runtime value to enumerate, so the list is read out of the source. A
    /// proc-macro or a registry would be real machinery for a list that changes a
    /// few times a year.
    fn registered_commands(source: &str) -> Vec<&str> {
        let marker = "generate_handler![";
        let start = source
            .find(marker)
            .expect("generate_handler! block in lib.rs");
        let after = &source[start + marker.len()..];
        let end = after.find(']').expect("generate_handler! closing bracket");
        after[..end]
            .lines()
            .map(|line| line.split("//").next().unwrap_or(""))
            .flat_map(|line| line.split(','))
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .collect()
    }

    /// The type of a command's `input` parameter, read out of its signature.
    ///
    /// Every shared command in this file is written as `fn name(input: T,` or
    /// `fn name(\n    input: T,` -- `get_vault_status` alone uses `_input`.
    /// `command_signatures_stay_in_a_form_the_payload_parser_understands` fails
    /// if that stops being true, so this cannot go blind quietly.
    fn command_input_type<'a>(source: &'a str, command: &str) -> Option<&'a str> {
        let marker = format!("fn {command}(");
        let start = source.find(&marker)? + marker.len();
        let rest = &source[start..];
        let colon = rest.find(':')?;
        let head = rest[..colon].trim();
        if head != "input" && head != "_input" {
            return None;
        }
        let after = &rest[colon + 1..];
        let end = after.find(',')?;
        Some(after[..end].trim())
    }

    /// The JSON keys a locally-declared input struct accepts.
    ///
    /// Returns `None` when the type is not declared in this file, which is how
    /// a shared `voyalier-core` type is told apart from a desktop wrapper.
    /// Every struct here carries `#[serde(rename_all = "camelCase")]`; the
    /// parser requires it rather than assuming it, because a struct without one
    /// expects snake_case on the wire and the gateway sends camelCase.
    fn struct_json_keys(source: &str, type_name: &str) -> Option<Vec<String>> {
        let marker = format!("struct {type_name} {{");
        let start = source.find(&marker)?;
        let head = &source[..start];
        let attrs = head.rsplit("#[derive").next().unwrap_or("");
        let camel = attrs.contains(r#"rename_all = "camelCase""#);
        let body_start = start + marker.len();
        // Brace-match rather than looking for a closing line: `struct
        // EmptyInput {}` has no closing line of its own, and searching for one
        // swallowed the rest of the file.
        let mut depth = 1usize;
        let mut end = body_start;
        for (offset, character) in source[body_start..].char_indices() {
            match character {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = body_start + offset;
                        break;
                    }
                }
                _ => {}
            }
        }
        let mut keys = Vec::new();
        for line in source[body_start..end].lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with("//") || line.starts_with("#[") {
                continue;
            }
            let Some(name) = line.split(':').next() else {
                continue;
            };
            let name = name.trim();
            if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                continue;
            }
            keys.push(if camel {
                to_camel(name)
            } else {
                name.to_owned()
            });
        }
        Some(keys)
    }

    fn to_camel(field: &str) -> String {
        let mut out = String::with_capacity(field.len());
        let mut upper = false;
        for character in field.chars() {
            if character == '_' {
                upper = true;
            } else if upper {
                out.extend(character.to_uppercase());
                upper = false;
            } else {
                out.push(character);
            }
        }
        out
    }

    /// Guards the parser above, the way the router's wiring-form test guards
    /// the route parser: if a command signature stops matching, this fails
    /// loudly instead of the payload test silently checking nothing.
    #[test]
    fn command_signatures_stay_in_a_form_the_payload_parser_understands() {
        let manifest = load_route_manifest();
        let source = include_str!("lib.rs");
        for route in &manifest.shared {
            assert!(
                command_input_type(source, &route.command).is_some(),
                "`{}` ({}) does not declare its argument as `input: T` on one line, so the \
                 payload parity guard cannot read its type. Keep the signature in that form.",
                route.command,
                route.method
            );
        }
    }

    /// The keys tauri.ts writes by hand must be the keys the command's struct
    /// reads by name, and nothing compared them.
    ///
    /// 50 of the 81 shared calls hand-construct their argument object --
    /// `{ tripId, patch: input }` for `update_trip`, and so on. Renaming
    /// `patch` on either side alone compiled clean and passed every guard here:
    /// the argument is typed `Record<string, unknown>` in TypeScript,
    /// `generate_handler_registers_every_declared_command` compares names, and
    /// `every_shared_command_binds_its_argument_to_input` sends no envelope at
    /// all. The desktop trip editor would have been dead with `make check`
    /// green. ADR-0012.
    #[test]
    fn every_command_reads_the_keys_the_manifest_declares() {
        let manifest = load_route_manifest();
        let source = include_str!("lib.rs");
        let mut checked_locally = 0usize;

        for route in &manifest.shared {
            let type_name =
                command_input_type(source, &route.command).expect("signature form is guarded");
            let declared = struct_json_keys(source, type_name);

            // A re-declared forward is checked exactly like a hand-built one:
            // from this side the only question is whether the struct's keys are
            // the ones the gateway puts on the wire. Whether the gateway wrote
            // them or forwarded them is the web suite's half.
            if let PayloadKeys::Whole(spelling) = &route.payload.command {
                assert_eq!(
                    spelling, "input",
                    "the only whole-payload spelling is \"input\" ({})",
                    route.method
                );
            }
            let expected_keys = match &route.payload.command {
                PayloadKeys::WholeRedeclared { whole } => Some(whole.as_slice()),
                PayloadKeys::Keys(keys) => Some(keys.as_slice()),
                PayloadKeys::Whole(_) => None,
            };

            match (expected_keys, declared) {
                (Some(expected), Some(actual)) => {
                    let mut expected = expected.to_vec();
                    let mut actual = actual;
                    expected.sort();
                    actual.sort();
                    assert_eq!(
                        actual, expected,
                        "`{}` ({}) reads {type_name}, whose JSON keys are {actual:?}, but \
                         parity/routes.json declares the gateway sends {expected:?}",
                        route.command, route.method
                    );
                    checked_locally += 1;
                }
                (Some(expected), None) => panic!(
                    "parity/routes.json declares literal keys {expected:?} for {} ({}), but its \
                     input type {type_name} is not declared in voyalier-desktop -- a shared \
                     voyalier-core type means the row should say \"input\"",
                    route.command, route.method
                ),
                (None, None) => {}
                (None, Some(actual)) => panic!(
                    "parity/routes.json says {} ({}) forwards the whole input object, but its \
                     type {type_name} is a desktop-local wrapper with keys {actual:?} -- declare \
                     those keys instead",
                    route.command, route.method
                ),
            }
        }

        // Mechanically checked against a struct in this file, rather than
        // classified as a passthrough: 58 that hand-build an argument object,
        // plus the 9 that send an empty envelope against `EmptyInput`. Bump it
        // when a row changes kind.
        assert_eq!(
            checked_locally, 67,
            "expected 67 commands with desktop-declared input structs, found {checked_locally}"
        );
    }

    /// `packages/contracts/parity/routes.json` is the one declaration of the API
    /// surface. tauri.ts invokes these names as untyped strings, so without this
    /// a renamed or dropped command compiled clean and failed at runtime.
    #[test]
    fn generate_handler_registers_every_declared_command() {
        let manifest = load_route_manifest();
        let registered = registered_commands(include_str!("lib.rs"));

        for route in &manifest.shared {
            assert!(
                registered.contains(&route.command.as_str()),
                "parity/routes.json declares command `{}` for {}, but voyalier-desktop's \
                 generate_handler! does not register it",
                route.command,
                route.method
            );
        }

        for command in &manifest.desktop_only {
            assert!(
                registered.contains(&command.as_str()),
                "parity/routes.json declares desktop-only command `{command}`, but \
                 voyalier-desktop's generate_handler! does not register it"
            );
        }

        // Catches the other direction: a command the manifest does not describe.
        assert_eq!(
            registered.len(),
            manifest.counts.shared + manifest.counts.desktop_only,
            "generate_handler! registers {} commands but parity/routes.json declares {} \
             ({} shared + {} desktop-only). Every Tauri command must appear in the manifest, \
             as a shared row or a desktopOnly entry.",
            registered.len(),
            manifest.counts.shared + manifest.counts.desktop_only,
            manifest.counts.shared,
            manifest.counts.desktop_only
        );
    }

    /// ADR-0002: every command takes exactly one argument named `input`, and
    /// `tauri.ts` invokes all of them as `invoke(command, { input })`.
    ///
    /// A command that names its argument anything else still registers, still
    /// matches the manifest by name, and still passes every guard above — it
    /// just rejects every call the web package makes. `get_visa_prep` shipped
    /// that way: one command in eighty-one, and the visa panel was dead on the
    /// desktop while the name-only checks stayed green.
    ///
    /// Sending no envelope at all is what separates the two failures. Tauri
    /// names the argument it could not bind, so a conforming command complains
    /// about `input` and a non-conforming one names its own parameter. Driving
    /// it from the manifest rather than a hand-written list is the point: a
    /// curated list only ever covers what someone remembered to add.
    #[test]
    fn every_shared_command_binds_its_argument_to_input() {
        let manifest = load_route_manifest();
        let database = temp_database("envelope");
        let app = test_app(&database);
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("webview");

        for route in &manifest.shared {
            let Err(error) = invoke_with_body(&webview, &route.command, json!({})) else {
                continue;
            };
            // An `AppError` payload means the argument bound and the command
            // body ran; only Tauri's own argument binding answers with a string.
            let Some(reported) = error.as_str() else {
                continue;
            };
            assert!(
                reported.contains("`input`"),
                "`{}` ({}) does not take its argument as `input`: {reported}",
                route.command,
                route.method
            );
        }

        cleanup_database(database);
    }
}
