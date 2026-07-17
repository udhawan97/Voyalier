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
  WeatherSnapshot,
} from "@voyalier/contracts";

import { toAppError } from "./errors";

export interface HttpGatewayOptions {
  /** Base origin for requests. "" (default) is same-origin, proxied in dev. */
  baseUrl?: string;
  /** Injectable fetch, for tests. */
  fetch?: typeof fetch;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

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

  return {
    health: () => request<HealthResponse>("GET", "/api/health"),

    createTrip: (input: CreateTripInput) =>
      request<Trip>("POST", "/api/v1/trips", input),

    listTrips: () => request<TripSummary[]>("GET", "/api/v1/trips"),

    getTrip: (tripId: string) =>
      request<TripDetail>("GET", `/api/v1/trips/${enc(tripId)}`),

    updateTrip: (tripId: string, input: UpdateTripInput) =>
      request<Trip>("PATCH", `/api/v1/trips/${enc(tripId)}`, input),

    archiveTrip: (tripId: string) =>
      request<Trip>("POST", `/api/v1/trips/${enc(tripId)}/archive`),

    unarchiveTrip: (tripId: string) =>
      request<Trip>("POST", `/api/v1/trips/${enc(tripId)}/unarchive`),

    getTripBrief: (tripId: string) =>
      request<TripBrief>("GET", `/api/v1/trips/${enc(tripId)}/brief`),

    getToday: (tripId: string) =>
      request<TodayView>("GET", `/api/v1/trips/${enc(tripId)}/today`),

    getVaultStatus: () => request<VaultStatus>("GET", "/api/v1/vault"),

    setVaultPassphrase: (passphrase: string) =>
      request<VaultStatus>("POST", "/api/v1/vault/passphrase", { passphrase }),

    unlockVault: (passphrase: string) =>
      request<VaultStatus>("POST", "/api/v1/vault/unlock", { passphrase }),

    removeVaultPassphrase: (passphrase: string) =>
      request<VaultStatus>("POST", "/api/v1/vault/remove-passphrase", {
        passphrase,
      }),

    detectLocalAi: () => request<LocalAiStatus>("GET", "/api/v1/local-ai"),

    pullLocalModel: (model: string) =>
      request<LocalModelPullResult>("POST", "/api/v1/local-ai/pull", { model }),

    listProviders: () => request<ProviderConfig[]>("GET", "/api/v1/providers"),

    setProviderKey: (input: SetProviderKeyInput) =>
      request<ProviderConfig>(
        "POST",
        `/api/v1/providers/${enc(input.provider)}/key`,
        { key: input.key },
      ),

    validateProviderKey: (input: SetProviderKeyInput) =>
      request<KeyValidation>(
        "POST",
        `/api/v1/providers/${enc(input.provider)}/validate`,
        { key: input.key },
      ),

    clearProviderKey: (provider: ProviderId) =>
      request<ProviderConfig>(
        "DELETE",
        `/api/v1/providers/${enc(provider)}/key`,
      ),

    setProviderModel: (input: SetProviderModelInput) =>
      request<ProviderConfig>(
        "POST",
        `/api/v1/providers/${enc(input.provider)}/model`,
        { model: input.model },
      ),

    previewAssist: (tripId: string, provider: ProviderId) =>
      request<AssistRequestPreview>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/assist-preview?provider=${enc(provider)}`,
      ),

    runAssist: (tripId: string, provider: ProviderId) =>
      request<AssistReply>("POST", `/api/v1/trips/${enc(tripId)}/assist`, {
        provider,
      }),

    previewAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      request<AssistRequestPreview>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/assist-draft-preview?kind=${enc(kind)}`,
      ),

    runAssistDraft: (tripId: string, kind: AssistDraftKind) =>
      request<AssistDraftResult>(
        "POST",
        `/api/v1/trips/${enc(tripId)}/assist-draft`,
        { kind },
      ),

    listAssistActivity: (tripId: string) =>
      request<AssistActivityEntry[]>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/assist-activity`,
      ),

    getAiPrompts: () => request<AiPromptSettings>("GET", "/api/v1/ai/prompts"),

    setAiPrompt: (kind: AiPromptKind, text: string | null) =>
      request<AiPromptSettings>("POST", "/api/v1/ai/prompts", { kind, text }),

    listPacks: () => request<PackInfo[]>("GET", "/api/v1/packs"),

    suggestPacks: (tripId: string) =>
      request<PackSuggestion[]>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/pack-suggestions`,
      ),

    suggestFieldValues: (input: SuggestFieldValuesInput) =>
      request<FieldSuggestion[]>(
        "GET",
        `/api/v1/trips/${enc(input.tripId)}/field-suggestions?field=${enc(
          input.field,
        )}&q=${enc(input.query)}`,
      ),

    suggestPlaces: (query: string) =>
      request<FieldSuggestion[]>(
        "GET",
        `/api/v1/places/suggest?q=${enc(query)}`,
      ),

    downloadPack: (tripId: string, packId: string) =>
      request<DownloadedPack>(
        "POST",
        `/api/v1/trips/${enc(tripId)}/packs/${enc(packId)}`,
      ),

    listDownloadedPacks: (tripId: string) =>
      request<DownloadedPack[]>("GET", `/api/v1/trips/${enc(tripId)}/packs`),

    deleteDownloadedPack: (tripId: string, packId: string) =>
      request<void>(
        "DELETE",
        `/api/v1/trips/${enc(tripId)}/packs/${enc(packId)}`,
      ),

    getOfflineMap: (tripId: string) =>
      request<OfflineMapArchive | null>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/offline-map`,
      ),

    readOfflineMapRange: (
      tripId: string,
      packId: string,
      offset: number,
      length: number,
    ) =>
      request<OfflineMapChunk>(
        "POST",
        `/api/v1/trips/${enc(tripId)}/offline-map/range`,
        { packId, offset, length },
      ),

    getRecommendations: (tripId: string, weights: PersonaWeights) =>
      request<Recommendation[]>(
        "POST",
        `/api/v1/trips/${enc(tripId)}/recommendations`,
        weights,
      ),

    listAdviceCountries: () =>
      request<FcdoCountry[]>("GET", "/api/v1/advice/countries"),

    fetchAdvisories: (input: FetchAdvisoriesInput) =>
      request<AdvisoryPanel>(
        "POST",
        `/api/v1/trips/${enc(input.tripId)}/advisories`,
        { countrySlug: input.countrySlug },
      ),

    fetchWeather: (tripId: string) =>
      request<WeatherSnapshot>("POST", `/api/v1/trips/${enc(tripId)}/weather`),

    fetchDestinationFacts: (tripId: string) =>
      request<DestinationFactsSnapshot>(
        "POST",
        `/api/v1/trips/${enc(tripId)}/destination-facts`,
      ),

    searchTrip: (tripId: string, query: string) =>
      request<SearchHit[]>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/search?q=${enc(query)}`,
      ),

    suggestSearchTerms: (tripId: string, query: string) =>
      request<string[]>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/search-suggestions?q=${enc(query)}`,
      ),

    deleteTrip: (tripId: string) =>
      request<void>("DELETE", `/api/v1/trips/${enc(tripId)}`),

    importDocument: (input: ImportDocumentInput) =>
      request<ImportResult>(
        "POST",
        `/api/v1/trips/${enc(input.tripId)}/documents`,
        input,
      ),

    getTripNotes: (tripId: string) =>
      request<TripNotes>("GET", `/api/v1/trips/${enc(tripId)}/notes`),

    setTripNotes: (tripId: string, body: string) =>
      request<TripNotes>("POST", `/api/v1/trips/${enc(tripId)}/notes`, {
        body,
      }),

    listDocuments: (tripId: string) =>
      request<DocumentSummary[]>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/documents`,
      ),

    getDocument: (documentId: string) =>
      request<DocumentContent>("GET", `/api/v1/documents/${enc(documentId)}`),

    deleteDocument: (documentId: string) =>
      request<void>("DELETE", `/api/v1/documents/${enc(documentId)}`),

    listCandidates: (tripId: string, status?: CandidateStatus) =>
      request<CandidateFact[]>(
        "GET",
        `/api/v1/trips/${enc(tripId)}/candidates${
          status ? `?status=${enc(status)}` : ""
        }`,
      ),

    confirmCandidate: (input: ConfirmCandidateInput) =>
      request<{ candidate: CandidateFact; confirmedFact: ConfirmedFact }>(
        "POST",
        `/api/v1/candidates/${enc(input.candidateId)}/confirm`,
        input,
      ),

    rejectCandidate: (candidateId: string) =>
      request<CandidateFact>(
        "POST",
        `/api/v1/candidates/${enc(candidateId)}/reject`,
      ),

    addManualFact: (input: AddManualFactInput) =>
      request<ConfirmedFact>(
        "POST",
        `/api/v1/trips/${enc(input.tripId)}/facts`,
        input,
      ),

    unconfirmFact: (factId: string) =>
      request<void>("DELETE", `/api/v1/facts/${enc(factId)}`),
  };
}
