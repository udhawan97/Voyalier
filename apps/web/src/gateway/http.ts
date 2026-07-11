import type {
  AddManualFactInput,
  AppGateway,
  CandidateFact,
  CandidateStatus,
  ConfirmCandidateInput,
  ConfirmedFact,
  CreateTripInput,
  HealthResponse,
  ImportDocumentInput,
  ImportResult,
  Trip,
  TripBrief,
  TripDetail,
  TripSummary,
  UpdateTripInput,
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

    getTripBrief: (tripId: string) =>
      request<TripBrief>("GET", `/api/v1/trips/${enc(tripId)}/brief`),

    deleteTrip: (tripId: string) =>
      request<void>("DELETE", `/api/v1/trips/${enc(tripId)}`),

    importDocument: (input: ImportDocumentInput) =>
      request<ImportResult>(
        "POST",
        `/api/v1/trips/${enc(input.tripId)}/documents`,
        input,
      ),

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
