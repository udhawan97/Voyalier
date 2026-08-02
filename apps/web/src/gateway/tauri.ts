import routes from "@voyalier/contracts/parity/routes.json";

import type {
  AddManualFactInput,
  AddPackingItemInput,
  AdvisoryPanel,
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
  ChatMessage,
  ConfirmCandidateInput,
  ConfirmedFact,
  CreateResourceInput,
  CreateTripInput,
  CreateTripItemInput,
  DestinationFactsSnapshot,
  DocumentContent,
  DocumentSummary,
  DownloadedPack,
  FcdoCountry,
  FetchAdvisoriesInput,
  FieldSuggestion,
  HealthResponse,
  ImportDocumentInput,
  ImportResult,
  InterestProfile,
  KeyValidation,
  LocalAiStatus,
  LocalModelPullResult,
  OfflineMapArchive,
  OfflineMapChunk,
  PackInfo,
  PackingItem,
  PackSuggestion,
  PersonaWeights,
  PlaceSummary,
  ProviderConfig,
  ProviderId,
  PublicHolidaysSnapshot,
  Recommendation,
  ResearchSettings,
  Resource,
  SavedPlace,
  SavePlaceInput,
  SearchHit,
  SetInterestProfileInput,
  SetProviderKeyInput,
  SetProviderModelInput,
  SetResearchSettingsInput,
  SetVisaItemProgressInput,
  SetVisaNationalityInput,
  SuggestFieldValuesInput,
  TodayView,
  Trip,
  TripBrief,
  TripDetail,
  TripItem,
  TripNotes,
  TripSummary,
  UpdatePackingItemInput,
  UpdateResourceInput,
  UpdateSavedPlaceInput,
  UpdateTripInput,
  UpdateTripItemInput,
  VaultStatus,
  VisaPrep,
  WeatherSnapshot,
  WorkspaceSearchHit,
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
/**
 * The snake_case command for a gateway method, from `parity/routes.json`.
 *
 * ADR-0011: the manifest already declares it, and it was then restated here as
 * an untyped string. `generate_handler_registers_every_declared_command` holds
 * the manifest to what the desktop shell actually registers, so deriving from
 * it is what makes that guard reach this file.
 */
const COMMANDS = new Map(
  (routes.shared as { method: string; command: string }[]).map((row) => [
    row.method,
    row.command,
  ]),
);

function command(method: keyof AppGateway): string {
  const name = COMMANDS.get(method);
  if (!name) {
    throw new Error(`parity/routes.json declares no command for ${method}`);
  }
  return name;
}

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
    health: () => call<HealthResponse>(command("health"), {}),

    createTrip: (input: CreateTripInput) =>
      call<Trip>(command("createTrip"), input),

    listTrips: () => call<TripSummary[]>(command("listTrips"), {}),

    getTrip: (tripId: string) =>
      call<TripDetail>(command("getTrip"), { tripId }),

    updateTrip: (tripId: string, input: UpdateTripInput) =>
      call<Trip>(command("updateTrip"), { tripId, patch: input }),

    archiveTrip: (tripId: string) =>
      call<Trip>(command("archiveTrip"), { tripId }),

    unarchiveTrip: (tripId: string) =>
      call<Trip>(command("unarchiveTrip"), { tripId }),

    getTripBrief: (tripId: string) =>
      call<TripBrief>(command("getTripBrief"), { tripId }),

    getToday: (tripId: string) =>
      call<TodayView>(command("getToday"), { tripId }),

    getVaultStatus: () => call<VaultStatus>(command("getVaultStatus"), {}),

    setVaultPassphrase: (passphrase: string) =>
      call<VaultStatus>(command("setVaultPassphrase"), { passphrase }),

    unlockVault: (passphrase: string) =>
      call<VaultStatus>(command("unlockVault"), { passphrase }),

    removeVaultPassphrase: (passphrase: string) =>
      call<VaultStatus>(command("removeVaultPassphrase"), { passphrase }),

    detectLocalAi: () => call<LocalAiStatus>(command("detectLocalAi"), {}),

    pullLocalModel: (model: string) =>
      call<LocalModelPullResult>(command("pullLocalModel"), { model }),

    listProviders: () => call<ProviderConfig[]>(command("listProviders"), {}),

    setProviderKey: (input: SetProviderKeyInput) =>
      call<ProviderConfig>(command("setProviderKey"), input),

    validateProviderKey: (input: SetProviderKeyInput) =>
      call<KeyValidation>(command("validateProviderKey"), input),

    clearProviderKey: (provider: ProviderId) =>
      call<ProviderConfig>(command("clearProviderKey"), { provider }),

    setProviderModel: (input: SetProviderModelInput) =>
      call<ProviderConfig>(command("setProviderModel"), input),

    previewAssist: (tripId: string, provider: ProviderId) =>
      call<AssistRequestPreview>(command("previewAssist"), {
        tripId,
        provider,
      }),

    runAssist: (tripId: string, provider: ProviderId) =>
      call<AssistReply>(command("runAssist"), { tripId, provider }),

    previewAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      call<AssistRequestPreview>(command("previewAssistDraft"), {
        tripId,
        kind,
      }),

    runAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      call<AssistDraftResult>(command("runAssistDraft"), { tripId, kind }),

    listAssistActivity: (tripId: string) =>
      call<AssistActivityEntry[]>(command("listAssistActivity"), { tripId }),

    getAiPrompts: () => call<AiPromptSettings>(command("getAiPrompts"), {}),

    setAiPrompt: (kind: AiPromptKind, text: string | null) =>
      call<AiPromptSettings>(command("setAiPrompt"), { kind, text }),

    listPacks: () => call<PackInfo[]>(command("listPacks"), {}),

    suggestPacks: (tripId: string) =>
      call<PackSuggestion[]>(command("suggestPacks"), { tripId }),

    suggestFieldValues: (input: SuggestFieldValuesInput) =>
      call<FieldSuggestion[]>(command("suggestFieldValues"), input),

    suggestPlaces: (query: string) =>
      call<FieldSuggestion[]>(command("suggestPlaces"), { query }),

    downloadPack: (tripId: string, packId: string) =>
      call<DownloadedPack>(command("downloadPack"), { tripId, packId }),

    listDownloadedPacks: (tripId: string) =>
      call<DownloadedPack[]>(command("listDownloadedPacks"), { tripId }),

    deleteDownloadedPack: (tripId: string, packId: string) =>
      call<void>(command("deleteDownloadedPack"), { tripId, packId }),

    getOfflineMap: (tripId: string) =>
      call<OfflineMapArchive | null>(command("getOfflineMap"), { tripId }),

    readOfflineMapRange: (
      tripId: string,
      packId: string,
      offset: number,
      length: number,
    ) =>
      call<OfflineMapChunk>(command("readOfflineMapRange"), {
        tripId,
        packId,
        offset,
        length,
      }),

    getRecommendations: (tripId: string, weights: PersonaWeights) =>
      call<Recommendation[]>(command("getRecommendations"), {
        tripId,
        weights,
      }),

    setInterestProfile: (input: SetInterestProfileInput) =>
      call<InterestProfile>(command("setInterestProfile"), input),

    getVisaPrep: (tripId: string) =>
      call<VisaPrep>(command("getVisaPrep"), { tripId }),

    setVisaNationality: (input: SetVisaNationalityInput) =>
      call<VisaPrep>(command("setVisaNationality"), input),

    setVisaItemProgress: (input: SetVisaItemProgressInput) =>
      call<VisaPrep>(command("setVisaItemProgress"), input),

    refreshVisaStats: (tripId: string) =>
      call<VisaPrep>(command("refreshVisaStats"), { tripId }),

    savePlace: (input: SavePlaceInput) =>
      call<SavedPlace>(command("savePlace"), input),

    updateSavedPlace: (input: UpdateSavedPlaceInput) =>
      call<SavedPlace>(command("updateSavedPlace"), input),

    deleteSavedPlace: (savedPlaceId: string) =>
      call<void>(command("deleteSavedPlace"), { savedPlaceId }),

    addPackingItem: (input: AddPackingItemInput) =>
      call<PackingItem>(command("addPackingItem"), input),

    updatePackingItem: (input: UpdatePackingItemInput) =>
      call<PackingItem>(command("updatePackingItem"), input),

    deletePackingItem: (packingItemId: string) =>
      call<void>(command("deletePackingItem"), { packingItemId }),

    createTripItem: (input: CreateTripItemInput) =>
      call<TripItem>(command("createTripItem"), input),

    updateTripItem: (input: UpdateTripItemInput) =>
      call<TripItem>(command("updateTripItem"), input),

    deleteTripItem: (tripItemId: string) =>
      call<void>(command("deleteTripItem"), { tripItemId }),

    listAdviceCountries: () =>
      call<FcdoCountry[]>(command("listAdviceCountries"), {}),

    fetchAdvisories: (input: FetchAdvisoriesInput) =>
      call<AdvisoryPanel>(command("fetchAdvisories"), input),

    fetchWeather: (tripId: string) =>
      call<WeatherSnapshot>(command("fetchWeather"), { tripId }),

    fetchDestinationFacts: (tripId: string) =>
      call<DestinationFactsSnapshot>(command("fetchDestinationFacts"), {
        tripId,
      }),

    fetchPublicHolidays: (tripId: string) =>
      call<PublicHolidaysSnapshot>(command("fetchPublicHolidays"), { tripId }),

    fetchPlaceSummary: (tripId: string) =>
      call<PlaceSummary>(command("fetchPlaceSummary"), { tripId }),

    listResources: (tripId: string) =>
      call<Resource[]>(command("listResources"), { tripId }),

    createResource: (input: CreateResourceInput) =>
      call<Resource>(command("createResource"), input),

    updateResource: (input: UpdateResourceInput) =>
      call<Resource>(command("updateResource"), input),

    deleteResource: (resourceId: string) =>
      call<void>(command("deleteResource"), { resourceId }),

    fetchResourceDetails: (resourceId: string) =>
      call<Resource>(command("fetchResourceDetails"), { resourceId }),

    getResearchSettings: () =>
      call<ResearchSettings>(command("getResearchSettings"), {}),

    setResearchSettings: (input: SetResearchSettingsInput) =>
      call<ResearchSettings>(command("setResearchSettings"), input),

    listChatMessages: (tripId: string) =>
      call<ChatMessage[]>(command("listChatMessages"), { tripId }),

    sendChatMessage: (tripId: string, message: string) =>
      call<ChatMessage>(command("sendChatMessage"), { tripId, message }),

    clearChat: (tripId: string) => call<void>(command("clearChat"), { tripId }),

    searchTrip: (tripId: string, query: string) =>
      call<SearchHit[]>(command("searchTrip"), { tripId, query }),

    searchWorkspace: (query: string) =>
      call<WorkspaceSearchHit[]>(command("searchWorkspace"), { query }),

    suggestSearchTerms: (tripId: string, query: string) =>
      call<string[]>(command("suggestSearchTerms"), { tripId, query }),

    deleteTrip: (tripId: string) =>
      call<void>(command("deleteTrip"), { tripId }),

    importDocument: (input: ImportDocumentInput) =>
      call<ImportResult>(command("importDocument"), input),

    getTripNotes: (tripId: string) =>
      call<TripNotes>(command("getTripNotes"), { tripId }),

    setTripNotes: (tripId: string, body: string) =>
      call<TripNotes>(command("setTripNotes"), { tripId, body }),

    listDocuments: (tripId: string) =>
      call<DocumentSummary[]>(command("listDocuments"), { tripId }),

    getDocument: (documentId: string) =>
      call<DocumentContent>(command("getDocument"), { documentId }),

    deleteDocument: (documentId: string) =>
      call<void>(command("deleteDocument"), { documentId }),

    listCandidates: (tripId: string, status?: CandidateStatus) =>
      call<CandidateFact[]>(
        command("listCandidates"),
        status === undefined ? { tripId } : { tripId, status },
      ),

    confirmCandidate: (input: ConfirmCandidateInput) =>
      call<{ candidate: CandidateFact; confirmedFact: ConfirmedFact }>(
        command("confirmCandidate"),
        input,
      ),

    rejectCandidate: (candidateId: string) =>
      call<CandidateFact>(command("rejectCandidate"), { candidateId }),

    addManualFact: (input: AddManualFactInput) =>
      call<ConfirmedFact>(command("addManualFact"), input),

    unconfirmFact: (factId: string) =>
      call<void>(command("unconfirmFact"), { factId }),
  };
}
