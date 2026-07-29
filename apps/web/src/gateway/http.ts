import routes from "@voyalier/contracts/parity/routes.json";

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
  SetVisaItemProgressInput,
  SetVisaNationalityInput,
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
  WorkspaceSearchHit,
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
  VisaPrep,
  UpdateTripInput,
  VaultStatus,
  DestinationFactsSnapshot,
  PlaceSummary,
  PublicHolidaysSnapshot,
  WeatherSnapshot,
} from "@voyalier/contracts";

import { toAppError } from "./errors";

export interface HttpGatewayOptions {
  /** Base origin for requests. "" (default) is same-origin, proxied in dev. */
  baseUrl?: string;
  /** Injectable fetch, for tests. */
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Every shared route, keyed by gateway method.
 *
 * ADR-0011: the manifest was already the one declaration of verb and path, and
 * both were then restated here as literals. Reading it instead removes the
 * hand-maintained link — what keeps this honest is the Rust side, where
 * `the_router_declares_exactly_the_manifest` holds the manifest to the router
 * in both directions.
 */
const MANIFEST = new Map(
  (routes.shared as { method: string; verb: string; path: string }[]).map(
    (row) => [row.method, row],
  ),
);

/**
 * Talks to the loopback Axum API over same-origin fetch. Routes mirror
 * crates/voyalier-server exactly. Non-2xx bodies are AppError; 204s carry no
 * body; network failures normalize to transport/failure.
 */
export function createHttpGateway(
  options: HttpGatewayOptions = {},
): AppGateway {
  const baseUrl = options.baseUrl ?? "";
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const enc = encodeURIComponent;

  async function request<T>(
    method: Method,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // Network-level failure — the core is unreachable.
      throw toAppError(error);
    }

    if (response.status === 204) return undefined as T;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (response.ok) return undefined as T;
      throw toAppError(error);
    }

    // Non-2xx bodies are AppError; toAppError passes them through unchanged.
    if (!response.ok) throw toAppError(payload);
    return payload as T;
  }

  /**
   * The verb and path for a gateway method, from `parity/routes.json`.
   *
   * ADR-0011: the manifest already declares both, so this is the only place
   * either is written. `params` fills the `{placeholder}` segments by name —
   * which argument fills which is the one genuinely per-method fact, so it
   * stays at the call site. An unfilled placeholder throws rather than sending
   * a literal `{tripId}` to the server, and `routeParity.test.ts` drives every
   * method, so a bad binding fails there.
   */
  function route(
    method: keyof AppGateway,
    params: Record<string, string> = {},
    query: Record<string, string | undefined> = {},
  ): [Method, string] {
    const row = MANIFEST.get(method);
    if (!row) {
      throw new Error(`parity/routes.json declares no route for ${method}`);
    }
    const path = row.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name];
      if (value === undefined) {
        throw new Error(`${method}: nothing bound to path parameter {${name}}`);
      }
      return enc(value);
    });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) search.set(key, value);
    }
    const suffix = search.toString();
    return [row.verb as Method, suffix ? `${path}?${suffix}` : path];
  }

  return {
    health: () => request<HealthResponse>(...route("health")),

    createTrip: (input: CreateTripInput) =>
      request<Trip>(...route("createTrip"), input),

    listTrips: () => request<TripSummary[]>(...route("listTrips")),

    getTrip: (tripId: string) =>
      request<TripDetail>(...route("getTrip", { tripId })),

    updateTrip: (tripId: string, input: UpdateTripInput) =>
      request<Trip>(...route("updateTrip", { tripId }), input),

    archiveTrip: (tripId: string) =>
      request<Trip>(...route("archiveTrip", { tripId })),

    unarchiveTrip: (tripId: string) =>
      request<Trip>(...route("unarchiveTrip", { tripId })),

    getTripBrief: (tripId: string) =>
      request<TripBrief>(...route("getTripBrief", { tripId })),

    getToday: (tripId: string) =>
      request<TodayView>(...route("getToday", { tripId })),

    getVaultStatus: () => request<VaultStatus>(...route("getVaultStatus")),

    setVaultPassphrase: (passphrase: string) =>
      request<VaultStatus>(...route("setVaultPassphrase"), { passphrase }),

    unlockVault: (passphrase: string) =>
      request<VaultStatus>(...route("unlockVault"), { passphrase }),

    removeVaultPassphrase: (passphrase: string) =>
      request<VaultStatus>(...route("removeVaultPassphrase"), {
        passphrase,
      }),

    detectLocalAi: () => request<LocalAiStatus>(...route("detectLocalAi")),

    pullLocalModel: (model: string) =>
      request<LocalModelPullResult>(...route("pullLocalModel"), { model }),

    listProviders: () => request<ProviderConfig[]>(...route("listProviders")),

    setProviderKey: (input: SetProviderKeyInput) =>
      request<ProviderConfig>(
        ...route("setProviderKey", { provider: input.provider }),
        { key: input.key },
      ),

    validateProviderKey: (input: SetProviderKeyInput) =>
      request<KeyValidation>(
        ...route("validateProviderKey", { provider: input.provider }),
        { key: input.key },
      ),

    clearProviderKey: (provider: ProviderId) =>
      request<ProviderConfig>(...route("clearProviderKey", { provider })),

    setProviderModel: (input: SetProviderModelInput) =>
      request<ProviderConfig>(
        ...route("setProviderModel", { provider: input.provider }),
        { model: input.model },
      ),

    previewAssist: (tripId: string, provider: ProviderId) =>
      request<AssistRequestPreview>(
        ...route("previewAssist", { tripId }, { provider: provider }),
      ),

    runAssist: (tripId: string, provider: ProviderId) =>
      request<AssistReply>(...route("runAssist", { tripId }), {
        provider,
      }),

    previewAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      request<AssistRequestPreview>(
        ...route("previewAssistDraft", { tripId }, { kind: kind }),
      ),

    runAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      request<AssistDraftResult>(...route("runAssistDraft", { tripId }), {
        kind,
      }),

    listAssistActivity: (tripId: string) =>
      request<AssistActivityEntry[]>(
        ...route("listAssistActivity", { tripId }),
      ),

    getAiPrompts: () => request<AiPromptSettings>(...route("getAiPrompts")),

    setAiPrompt: (kind: AiPromptKind, text: string | null) =>
      request<AiPromptSettings>(...route("setAiPrompt"), { kind, text }),

    listPacks: () => request<PackInfo[]>(...route("listPacks")),

    suggestPacks: (tripId: string) =>
      request<PackSuggestion[]>(...route("suggestPacks", { tripId })),

    suggestFieldValues: (input: SuggestFieldValuesInput) =>
      request<FieldSuggestion[]>(
        ...route(
          "suggestFieldValues",
          { tripId: input.tripId },
          { field: input.field, q: input.query },
        ),
      ),

    suggestPlaces: (query: string) =>
      request<FieldSuggestion[]>(...route("suggestPlaces", {}, { q: query })),

    downloadPack: (tripId: string, packId: string) =>
      request<DownloadedPack>(...route("downloadPack", { tripId, packId })),

    listDownloadedPacks: (tripId: string) =>
      request<DownloadedPack[]>(...route("listDownloadedPacks", { tripId })),

    deleteDownloadedPack: (tripId: string, packId: string) =>
      request<void>(...route("deleteDownloadedPack", { tripId, packId })),

    getOfflineMap: (tripId: string) =>
      request<OfflineMapArchive | null>(...route("getOfflineMap", { tripId })),

    readOfflineMapRange: (
      tripId: string,
      packId: string,
      offset: number,
      length: number,
    ) =>
      request<OfflineMapChunk>(...route("readOfflineMapRange", { tripId }), {
        packId,
        offset,
        length,
      }),

    getRecommendations: (tripId: string, weights: PersonaWeights) =>
      request<Recommendation[]>(
        ...route("getRecommendations", { tripId }),
        weights,
      ),

    setInterestProfile: (input: SetInterestProfileInput) =>
      request<InterestProfile>(
        ...route("setInterestProfile", { tripId: input.tripId }),
        input,
      ),

    getVisaPrep: (tripId: string) =>
      request<VisaPrep>(...route("getVisaPrep", { tripId })),

    setVisaNationality: (input: SetVisaNationalityInput) =>
      request<VisaPrep>(
        ...route("setVisaNationality", { tripId: input.tripId }),
        input,
      ),

    setVisaItemProgress: (input: SetVisaItemProgressInput) =>
      request<VisaPrep>(
        ...route("setVisaItemProgress", {
          tripId: input.tripId,
          visaDocumentId: input.documentId,
        }),
        input,
      ),

    savePlace: (input: SavePlaceInput) =>
      request<SavedPlace>(
        ...route("savePlace", { tripId: input.tripId }),
        input,
      ),

    updateSavedPlace: (input: UpdateSavedPlaceInput) =>
      request<SavedPlace>(
        ...route("updateSavedPlace", { savedPlaceId: input.savedPlaceId }),
        input,
      ),

    deleteSavedPlace: (savedPlaceId: string) =>
      request<void>(...route("deleteSavedPlace", { savedPlaceId })),

    addPackingItem: (input: AddPackingItemInput) =>
      request<PackingItem>(
        ...route("addPackingItem", { tripId: input.tripId }),
        input,
      ),

    updatePackingItem: (input: UpdatePackingItemInput) =>
      request<PackingItem>(
        ...route("updatePackingItem", { packingItemId: input.packingItemId }),
        input,
      ),

    deletePackingItem: (packingItemId: string) =>
      request<void>(...route("deletePackingItem", { packingItemId })),

    createTripItem: (input: CreateTripItemInput) =>
      request<TripItem>(
        ...route("createTripItem", { tripId: input.tripId }),
        input,
      ),

    updateTripItem: (input: UpdateTripItemInput) =>
      request<TripItem>(
        ...route("updateTripItem", { tripItemId: input.tripItemId }),
        input,
      ),

    deleteTripItem: (tripItemId: string) =>
      request<void>(...route("deleteTripItem", { tripItemId })),

    listAdviceCountries: () =>
      request<FcdoCountry[]>(...route("listAdviceCountries")),

    fetchAdvisories: (input: FetchAdvisoriesInput) =>
      request<AdvisoryPanel>(
        ...route("fetchAdvisories", { tripId: input.tripId }),
        { countrySlug: input.countrySlug },
      ),

    fetchWeather: (tripId: string) =>
      request<WeatherSnapshot>(...route("fetchWeather", { tripId })),

    fetchDestinationFacts: (tripId: string) =>
      request<DestinationFactsSnapshot>(
        ...route("fetchDestinationFacts", { tripId }),
      ),

    fetchPublicHolidays: (tripId: string) =>
      request<PublicHolidaysSnapshot>(
        ...route("fetchPublicHolidays", { tripId }),
      ),

    fetchPlaceSummary: (tripId: string) =>
      request<PlaceSummary>(...route("fetchPlaceSummary", { tripId })),

    searchTrip: (tripId: string, query: string) =>
      request<SearchHit[]>(...route("searchTrip", { tripId }, { q: query })),

    searchWorkspace: (query: string) =>
      request<WorkspaceSearchHit[]>(
        ...route("searchWorkspace", {}, { q: query }),
      ),

    suggestSearchTerms: (tripId: string, query: string) =>
      request<string[]>(
        ...route("suggestSearchTerms", { tripId }, { q: query }),
      ),

    deleteTrip: (tripId: string) =>
      request<void>(...route("deleteTrip", { tripId })),

    importDocument: (input: ImportDocumentInput) =>
      request<ImportResult>(
        ...route("importDocument", { tripId: input.tripId }),
        input,
      ),

    getTripNotes: (tripId: string) =>
      request<TripNotes>(...route("getTripNotes", { tripId })),

    setTripNotes: (tripId: string, body: string) =>
      request<TripNotes>(...route("setTripNotes", { tripId }), {
        body,
      }),

    listDocuments: (tripId: string) =>
      request<DocumentSummary[]>(...route("listDocuments", { tripId })),

    getDocument: (documentId: string) =>
      request<DocumentContent>(...route("getDocument", { documentId })),

    deleteDocument: (documentId: string) =>
      request<void>(...route("deleteDocument", { documentId })),

    listCandidates: (tripId: string, status?: CandidateStatus) =>
      // `status` is optional, and `route` drops an undefined query value rather
      // than sending `?status=undefined`.
      request<CandidateFact[]>(
        ...route("listCandidates", { tripId }, { status }),
      ),

    confirmCandidate: (input: ConfirmCandidateInput) =>
      request<{ candidate: CandidateFact; confirmedFact: ConfirmedFact }>(
        ...route("confirmCandidate", { candidateId: input.candidateId }),
        input,
      ),

    rejectCandidate: (candidateId: string) =>
      request<CandidateFact>(...route("rejectCandidate", { candidateId })),

    addManualFact: (input: AddManualFactInput) =>
      request<ConfirmedFact>(
        ...route("addManualFact", { tripId: input.tripId }),
        input,
      ),

    unconfirmFact: (factId: string) =>
      request<void>(...route("unconfirmFact", { factId })),
  };
}
