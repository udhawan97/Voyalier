import type {
  AddManualFactInput,
  AppGateway,
  CandidateFact,
  CandidateStatus,
  ConfirmCandidateInput,
  ConfirmedFact,
  CreateTripInput,
  FcdoCountry,
  FetchTravelAdviceInput,
  HealthResponse,
  ImportDocumentInput,
  ImportResult,
  LocalAiStatus,
  SearchHit,
  TravelAdviceSnapshot,
  Trip,
  TripBrief,
  TripDetail,
  TripSummary,
  UpdateTripInput,
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

    getTripBrief: (tripId: string) =>
      call<TripBrief>("get_trip_brief", { tripId }),

    detectLocalAi: () => call<LocalAiStatus>("detect_local_ai", {}),

    listAdviceCountries: () => call<FcdoCountry[]>("list_advice_countries", {}),

    fetchTravelAdvice: (input: FetchTravelAdviceInput) =>
      call<TravelAdviceSnapshot>("fetch_travel_advice", input),

    fetchWeather: (tripId: string) =>
      call<WeatherSnapshot>("fetch_weather", { tripId }),

    searchTrip: (tripId: string, query: string) =>
      call<SearchHit[]>("search_trip", { tripId, query }),

    deleteTrip: (tripId: string) => call<void>("delete_trip", { tripId }),

    importDocument: (input: ImportDocumentInput) =>
      call<ImportResult>("import_document", input),

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
