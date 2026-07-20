import type {
  DocumentContent,
  DocumentSummary,
  AddManualFactInput,
  AiPromptKind,
  AiPromptSettings,
  AppGateway,
  AssistActivityEntry,
  AssistDraftKind,
  AssistDraftResult,
  AssistReply,
  AssistRequestPreview,
  CandidateFact,
  CandidateStatus,
  ConfirmCandidateInput,
  ConfirmedFact,
  CreateTripInput,
  DownloadedPack,
  FcdoCountry,
  FetchAdvisoriesInput,
  FieldSuggestion,
  HealthResponse,
  ImportDocumentInput,
  ImportResult,
  KeyValidation,
  LocalAiStatus,
  LocalModelPullResult,
  OfflineMapArchive,
  OfflineMapChunk,
  PackInfo,
  PackSuggestion,
  PersonaWeights,
  ProviderConfig,
  ProviderId,
  Recommendation,
  InterestProfile,
  SetInterestProfileInput,
  SavePlaceInput,
  SavedPlace,
  UpdateSavedPlaceInput,
  AddPackingItemInput,
  PackingItem,
  UpdatePackingItemInput,
  CreateTripItemInput,
  TripItem,
  UpdateTripItemInput,
  SearchHit,
  SetProviderKeyInput,
  SetProviderModelInput,
  SuggestFieldValuesInput,
  TodayView,
  AdvisoryPanel,
  Trip,
  TripBrief,
  TripDetail,
  TripNotes,
  TripSummary,
  UpdateTripInput,
  VaultStatus,
  DestinationFactsSnapshot,
  PlaceSummary,
  PublicHolidaysSnapshot,
  WeatherSnapshot,
} from "@voyalier/contracts";

import { toAppError } from "./errors";

type InvokeFn = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export interface TauriGatewayOptions {
  /** Injectable invoke, for tests. Defaults to window.__TAURI__.core.invoke. */
  invoke?: InvokeFn;
}

/**
 * Talks to the desktop shell over direct Tauri IPC (ADR-0002). Every command is
 * the snake_case contract name and takes exactly one arg named `input`. Invoke
 * rejections normalize to transport/failure unless they are already AppErrors.
 */
export function createTauriGateway(
  options: TauriGatewayOptions = {},
): AppGateway {
  const invoke: InvokeFn =
    options.invoke ??
    ((command, args) => {
      const bridge = window.__TAURI__;
      if (!bridge) {
        return Promise.reject(
          new Error("The desktop bridge is unavailable."),
        ) as Promise<never>;
      }
      return bridge.core.invoke(command, args);
    });

  async function call<T>(command: string, input: unknown): Promise<T> {
    try {
      return await invoke<T>(command, { input });
    } catch (error) {
      throw toAppError(error);
    }
  }

  return {
    health: () => call<HealthResponse>("health", {}),

    createTrip: (input: CreateTripInput) => call<Trip>("create_trip", input),

    listTrips: () => call<TripSummary[]>("list_trips", {}),

    getTrip: (tripId: string) => call<TripDetail>("get_trip", { tripId }),

    updateTrip: (tripId: string, input: UpdateTripInput) =>
      call<Trip>("update_trip", { tripId, patch: input }),

    archiveTrip: (tripId: string) => call<Trip>("archive_trip", { tripId }),

    unarchiveTrip: (tripId: string) => call<Trip>("unarchive_trip", { tripId }),

    getTripBrief: (tripId: string) =>
      call<TripBrief>("get_trip_brief", { tripId }),

    getToday: (tripId: string) => call<TodayView>("get_today", { tripId }),

    getVaultStatus: () => call<VaultStatus>("get_vault_status", {}),

    setVaultPassphrase: (passphrase: string) =>
      call<VaultStatus>("set_vault_passphrase", { passphrase }),

    unlockVault: (passphrase: string) =>
      call<VaultStatus>("unlock_vault", { passphrase }),

    removeVaultPassphrase: (passphrase: string) =>
      call<VaultStatus>("remove_vault_passphrase", { passphrase }),

    detectLocalAi: () => call<LocalAiStatus>("detect_local_ai", {}),

    pullLocalModel: (model: string) =>
      call<LocalModelPullResult>("pull_local_model", { model }),

    listProviders: () => call<ProviderConfig[]>("list_providers", {}),

    setProviderKey: (input: SetProviderKeyInput) =>
      call<ProviderConfig>("set_provider_key", input),

    validateProviderKey: (input: SetProviderKeyInput) =>
      call<KeyValidation>("validate_provider_key", input),

    clearProviderKey: (provider: ProviderId) =>
      call<ProviderConfig>("clear_provider_key", { provider }),

    setProviderModel: (input: SetProviderModelInput) =>
      call<ProviderConfig>("set_provider_model", input),

    previewAssist: (tripId: string, provider: ProviderId) =>
      call<AssistRequestPreview>("preview_assist", { tripId, provider }),

    runAssist: (tripId: string, provider: ProviderId) =>
      call<AssistReply>("run_assist", { tripId, provider }),

    previewAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      call<AssistRequestPreview>("preview_assist_draft", { tripId, kind }),

    runAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      call<AssistDraftResult>("run_assist_draft", { tripId, kind }),

    listAssistActivity: (tripId: string) =>
      call<AssistActivityEntry[]>("list_assist_activity", { tripId }),

    getAiPrompts: () => call<AiPromptSettings>("get_ai_prompts", {}),

    setAiPrompt: (kind: AiPromptKind, text: string | null) =>
      call<AiPromptSettings>("set_ai_prompt", { kind, text }),

    listPacks: () => call<PackInfo[]>("list_packs", {}),

    suggestPacks: (tripId: string) =>
      call<PackSuggestion[]>("suggest_packs", { tripId }),

    suggestFieldValues: (input: SuggestFieldValuesInput) =>
      call<FieldSuggestion[]>("suggest_field_values", input),

    suggestPlaces: (query: string) =>
      call<FieldSuggestion[]>("suggest_places", { query }),

    downloadPack: (tripId: string, packId: string) =>
      call<DownloadedPack>("download_pack", { tripId, packId }),

    listDownloadedPacks: (tripId: string) =>
      call<DownloadedPack[]>("list_downloaded_packs", { tripId }),

    deleteDownloadedPack: (tripId: string, packId: string) =>
      call<void>("delete_downloaded_pack", { tripId, packId }),

    getOfflineMap: (tripId: string) =>
      call<OfflineMapArchive | null>("get_offline_map", { tripId }),

    readOfflineMapRange: (
      tripId: string,
      packId: string,
      offset: number,
      length: number,
    ) =>
      call<OfflineMapChunk>("read_offline_map_range", {
        tripId,
        packId,
        offset,
        length,
      }),

    getRecommendations: (tripId: string, weights: PersonaWeights) =>
      call<Recommendation[]>("get_recommendations", { tripId, weights }),

    setInterestProfile: (input: SetInterestProfileInput) =>
      call<InterestProfile>("set_interest_profile", input),

    savePlace: (input: SavePlaceInput) =>
      call<SavedPlace>("save_place", input),

    updateSavedPlace: (input: UpdateSavedPlaceInput) =>
      call<SavedPlace>("update_saved_place", input),

    deleteSavedPlace: (savedPlaceId: string) =>
      call<void>("delete_saved_place", { savedPlaceId }),

    addPackingItem: (input: AddPackingItemInput) =>
      call<PackingItem>("add_packing_item", input),

    updatePackingItem: (input: UpdatePackingItemInput) =>
      call<PackingItem>("update_packing_item", input),

    deletePackingItem: (packingItemId: string) =>
      call<void>("delete_packing_item", { packingItemId }),

    createTripItem: (input: CreateTripItemInput) =>
      call<TripItem>("create_trip_item", input),

    updateTripItem: (input: UpdateTripItemInput) =>
      call<TripItem>("update_trip_item", input),

    deleteTripItem: (tripItemId: string) =>
      call<void>("delete_trip_item", { tripItemId }),

    listAdviceCountries: () => call<FcdoCountry[]>("list_advice_countries", {}),

    fetchAdvisories: (input: FetchAdvisoriesInput) =>
      call<AdvisoryPanel>("fetch_advisories", input),

    fetchWeather: (tripId: string) =>
      call<WeatherSnapshot>("fetch_weather", { tripId }),

    fetchDestinationFacts: (tripId: string) =>
      call<DestinationFactsSnapshot>("fetch_destination_facts", { tripId }),

    fetchPublicHolidays: (tripId: string) =>
      call<PublicHolidaysSnapshot>("fetch_public_holidays", { tripId }),

    fetchPlaceSummary: (tripId: string) =>
      call<PlaceSummary>("fetch_place_summary", { tripId }),

    searchTrip: (tripId: string, query: string) =>
      call<SearchHit[]>("search_trip", { tripId, query }),

    suggestSearchTerms: (tripId: string, query: string) =>
      call<string[]>("suggest_search_terms", { tripId, query }),

    deleteTrip: (tripId: string) => call<void>("delete_trip", { tripId }),

    importDocument: (input: ImportDocumentInput) =>
      call<ImportResult>("import_document", input),

    getTripNotes: (tripId: string) =>
      call<TripNotes>("get_trip_notes", { tripId }),

    setTripNotes: (tripId: string, body: string) =>
      call<TripNotes>("set_trip_notes", { tripId, body }),

    listDocuments: (tripId: string) =>
      call<DocumentSummary[]>("list_documents", { tripId }),

    getDocument: (documentId: string) =>
      call<DocumentContent>("get_document", { documentId }),

    deleteDocument: (documentId: string) =>
      call<void>("delete_document", { documentId }),

    listCandidates: (tripId: string, status?: CandidateStatus) =>
      call<CandidateFact[]>(
        "list_candidates",
        status === undefined ? { tripId } : { tripId, status },
      ),

    confirmCandidate: (input: ConfirmCandidateInput) =>
      call<{ candidate: CandidateFact; confirmedFact: ConfirmedFact }>(
        "confirm_candidate",
        input,
      ),

    rejectCandidate: (candidateId: string) =>
      call<CandidateFact>("reject_candidate", { candidateId }),

    addManualFact: (input: AddManualFactInput) =>
      call<ConfirmedFact>("add_manual_fact", input),

    unconfirmFact: (factId: string) => call<void>("unconfirm_fact", { factId }),
  };
}
