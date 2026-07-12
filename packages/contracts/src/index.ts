export type TripStatus = "draft" | "active" | "archived";
export interface Trip {
  id: string;
  title: string;
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  createdAt: string;
  updatedAt: string;
}
export interface TripSummary extends Trip {
  confirmedFactCount: number;
  pendingCandidateCount: number;
}
export interface TripDetail {
  trip: Trip;
  confirmedFacts: ConfirmedFact[];
  pendingCandidateCount: number;
  /** Deterministic advisory checks over the confirmed itinerary. Empty when coherent. */
  itineraryConflicts: ItineraryConflict[];
  /** Deterministic plan-completeness rollup (logistics only, no sourced/entry data). */
  readiness: ReadinessSummary;
  /** The latest user-fetched official travel-advice snapshot, when one exists. */
  travelAdvice?: TravelAdviceSnapshot;
  /** The latest user-fetched destination weather outlook, when one exists. */
  weather?: WeatherSnapshot;
}
export type ReadinessCheck =
  | "schedule_conflicts"
  | "lodging_coverage"
  | "pending_review"
  | "entry_requirements"
  | "health_notices";
/** A labelled link to an authoritative external source (curated, never model-derived). */
export interface SourceLink {
  label: string;
  url: string;
}
export interface ReadinessItem {
  id: ReadinessCheck;
  status: ReadinessStatus;
  title: string;
  detail: string;
  /** Curated official-source links; omitted when the item has none. */
  links?: SourceLink[];
}
export interface ReadinessSummary {
  status: ReadinessStatus;
  items: ReadinessItem[];
}
export type ItineraryConflictKind =
  "flight_overlap" | "lodging_overlap" | "lodging_gap";
export type ConflictSeverity = "notice" | "warning";
export interface ItineraryConflict {
  kind: ItineraryConflictKind;
  severity: ConflictSeverity;
  message: string;
  /** Confirmed-fact ids involved (sorted); empty for window-level findings like gaps. */
  factIds: string[];
  /** First affected night (ISO YYYY-MM-DD) for date-range findings. */
  startDate?: string;
  /** Last affected night inclusive (ISO YYYY-MM-DD) for date-range findings. */
  endDate?: string;
}
export type FactType = "flight_segment" | "lodging_stay";
export interface FlightSegmentPayload {
  airlineName?: string;
  airlineIata?: string;
  flightNumber?: string;
  departureAirportIata?: string;
  arrivalAirportIata?: string;
  departureLocal?: string;
  arrivalLocal?: string;
  confirmationCode?: string;
  passengerName?: string;
}
export interface LodgingStayPayload {
  propertyName?: string;
  address?: string;
  checkinDate?: string;
  checkoutDate?: string;
  confirmationCode?: string;
  guestName?: string;
}
export type FactPayload = FlightSegmentPayload | LodgingStayPayload;
export type ExtractionMethod = "structured" | "inferred" | "manual";
export type CandidateStatus = "pending" | "confirmed" | "rejected";
export type WarningCode =
  | "missing_dates"
  | "missing_locations"
  | "ambiguous_date_format"
  | "past_date"
  | "outside_trip_window"
  | "unrecognized_airport_code";
export interface FieldSpan {
  fieldPath: string;
  start: number;
  end: number;
  excerpt: string;
}
export interface CandidateFact {
  id: string;
  tripId: string;
  documentId: string;
  parserRunId: string;
  factType: FactType;
  payload: FactPayload;
  method: ExtractionMethod;
  fieldSpans: FieldSpan[];
  warnings: WarningCode[];
  status: CandidateStatus;
  createdAt: string;
  resolvedAt: string | null;
}
export interface ConfirmedFact {
  id: string;
  tripId: string;
  factType: FactType;
  payload: FactPayload;
  method: ExtractionMethod;
  candidateId: string | null;
  correctedFields: string[];
  confirmedAt: string;
}
// "email" is input-only for imports: the Rust core extracts the confirmation
// body and stores it as "html" or "pasted_text", so a stored document's kind is
// only ever one of those two.
export type DocumentKind = "pasted_text" | "html" | "email";
export interface SourceDocument {
  id: string;
  tripId: string;
  kind: DocumentKind;
  label: string;
  contentHash: string;
  charCount: number;
  importedAt: string;
}
export interface ImportResult {
  document: SourceDocument;
  parserRunId: string;
  candidates: CandidateFact[];
}
/** One fetchable FCDO country page (curated list; slugs are never free text). */
export interface FcdoCountry {
  slug: string;
  name: string;
}
/** A dated, verbatim snapshot of one country's FCDO travel advice (OGL v3.0). */
export interface TravelAdviceSnapshot {
  countrySlug: string;
  countryName: string;
  /** The human page this snapshot came from. */
  sourceUrl: string;
  /** Verbatim GOV.UK description. May be empty. */
  summary: string;
  /** Verbatim alert-status identifiers (often empty). */
  alertStatus: string[];
  /** GOV.UK's own public_updated_at, verbatim. */
  sourceUpdatedAt?: string;
  /** GOV.UK's latest change description, verbatim. */
  changeDescription?: string;
  /** When this device retrieved the snapshot (RFC 3339). */
  retrievedAt: string;
}
export interface FetchTravelAdviceInput {
  tripId: string;
  countrySlug: string;
}
/** How much of the trip window the forecast horizon could cover. */
export type WeatherCoverage = "full" | "partial" | "none";
/** One forecast day, metric units, verbatim from the source. */
export interface WeatherDay {
  /** ISO YYYY-MM-DD, local to the destination. */
  date: string;
  /** WMO weather interpretation code as sent by the source. */
  weatherCode: number;
  /** Deterministic human description of the code. */
  description: string;
  tempMaxC: number;
  tempMinC: number;
  /** Daily maximum precipitation probability, percent. */
  precipitationChancePct?: number;
}
/** A dated destination weather outlook (Open-Meteo, CC BY 4.0). */
export interface WeatherSnapshot {
  /** Geocoded place name, verbatim, so a wrong geocode is visible. */
  placeName: string;
  placeRegion: string;
  latitude: number;
  longitude: number;
  /** Days inside the trip window the forecast could cover, in order. */
  days: WeatherDay[];
  coverage: WeatherCoverage;
  sourceUrl: string;
  /** When this device retrieved the snapshot (RFC 3339). */
  retrievedAt: string;
}
export type ProviderId = "openai" | "anthropic" | "ollama";
/**
 * A provider's configuration. Never carries the API key — `hasKey` reports only
 * whether one is stored in the OS keychain. Keys are write-only via
 * `setProviderKey` and never returned.
 */
export interface ProviderConfig {
  id: ProviderId;
  label: string;
  keyRequired: boolean;
  hasKey: boolean;
  model?: string;
}
export interface SetProviderKeyInput {
  provider: ProviderId;
  key: string;
}
export interface SetProviderModelInput {
  provider: ProviderId;
  model: string;
}
/** One locally-installed on-device model reported by the runtime. */
export interface LocalAiModel {
  name: string;
}
/** Whether an optional on-device AI runtime was detected, and its models. */
export interface LocalAiStatus {
  /** The runtime probed. Currently always "ollama". */
  provider: string;
  /** True when the runtime answered the localhost probe. */
  available: boolean;
  /** Installed models (may be empty even when available). */
  models: LocalAiModel[];
}
/**
 * A deterministic, redacted preview of the request Voyalier would send to a
 * provider — the consent step before any assist call. Built entirely on-device;
 * confirmation codes and traveler names are excluded by construction, so they
 * could never reach a provider. Nothing here is transmitted.
 */
export interface AssistRequestPreview {
  provider: ProviderId;
  providerLabel: string;
  /** The model that would be used, if one is chosen. */
  model?: string;
  /** Where the request would go — shown for transparency. */
  endpoint: string;
  /** True when the request would leave this device (cloud); false for Ollama. */
  leavesDevice: boolean;
  /** The fixed system instruction. */
  systemPrompt: string;
  /** The exact user message: the traveler's own confirmed itinerary, redacted. */
  userContent: string;
  /** Field kinds excluded from the request, for transparency. */
  withheld: string[];
  /** A citation of what the request is grounded in (e.g. "2 confirmed flights"). */
  groundedIn: string[];
  /** A rough token estimate for cost awareness (not a billing figure). */
  estimatedTokens: number;
}
/**
 * The assistant's reply from a completed on-device run. `text` is model output
 * and is never authoritative — Voyalier surfaces high-stakes facts only from
 * cited sources.
 */
export interface AssistReply {
  provider: ProviderId;
  model: string;
  text: string;
  generatedAt: string;
}
/**
 * A record that an assist call happened, for the visible per-trip activity log.
 * Metadata only — prompts and replies are never stored.
 */
export interface AssistActivityEntry {
  id: string;
  provider: ProviderId;
  model: string;
  createdAt: string;
}
/** A geographic bounding box in decimal degrees (WGS84). */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}
/** License + attribution for one layer of a city pack. */
export interface PackLayerLicense {
  layer: string;
  source: string;
  license: string;
  attribution: string;
}
/**
 * Catalog metadata for one downloadable city pack. Describes coverage and terms
 * — not the pack contents. Overture places and Wikivoyage prose are kept as
 * separate layers with their own licenses.
 */
export interface PackInfo {
  id: string;
  name: string;
  region: string;
  bbox: BoundingBox;
  wikivoyageArticle: string;
  layers: PackLayerLicense[];
}
/** A pack downloaded and stored locally for a trip. Summary metadata. */
export interface DownloadedPack {
  packId: string;
  name: string;
  region: string;
  placeCount: number;
  articleCount: number;
  downloadedAt: string;
}
/** Per-trip persona interest weights (each 0.0–1.0). Presets map onto these. */
export interface PersonaWeights {
  food: number;
  culture: number;
  nature: number;
  nightlife: number;
  shopping: number;
}
/**
 * A recommended place from a downloaded pack, with the provenance and the
 * transparent reasoning behind its rank. Suggestions from open place data —
 * never authoritative for prices, hours, or safety.
 */
export interface Recommendation {
  name: string;
  category: string;
  dimension: string;
  lat: number;
  lon: number;
  source: string;
  license: string;
  score: number;
  reasons: string[];
  wildcard: boolean;
}
export type TripPhaseState = "upcoming" | "active" | "completed";
/** Where a trip sits relative to today; day counts present per state. */
export interface TripPhase {
  state: TripPhaseState;
  daysUntil?: number;
  day?: number;
  totalDays?: number;
  daysAgo?: number;
}
export type TodayItemKind =
  | "flight_departure"
  | "flight_arrival"
  | "checkin"
  | "checkout"
  | "staying_tonight";
/** One dated entry in the Today view. */
export interface TodayItem {
  kind: TodayItemKind;
  title: string;
  detail?: string;
  date: string;
  time?: string;
}
/** A deterministic "now / next" projection of a trip against the current date. */
export interface TodayView {
  referenceDate: string;
  phase: TripPhase;
  today: TodayItem[];
  next?: TodayItem;
}
export type SearchHitSource = "document" | "confirmed_fact";
export interface SearchHit {
  source: SearchHitSource;
  /** The document or confirmed-fact id, depending on `source`. */
  recordId: string;
  label: string;
  /** Verbatim excerpt around the first match. */
  snippet: string;
  /** Transparent relevance: query-term occurrence count. */
  score: number;
}
export interface TripBrief {
  title: string;
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
  /** Redacted flight entries in departure order. */
  flights: FlightSegmentPayload[];
  /** Redacted lodging entries in check-in order. */
  stays: LodgingStayPayload[];
  /** Human-readable list of the field kinds removed from this brief. */
  redactedFields: string[];
  generatedAt: string;
}
export type IntelligenceMode =
  "local" | "on_device_ai" | "cloud_ai" | "offline_snapshot";
export type ReadinessStatus =
  "not_checked" | "clear" | "monitor" | "action_needed" | "critical";
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  intelligenceMode: IntelligenceMode;
}
/**
 * The encrypted vault's state. Carries no key material.
 *
 * - `active`: sensitive fields are encrypted at rest and readable (keychain
 *   mode, or a passphrase vault after unlock).
 * - `protected`: the optional passphrase is on.
 * - `locked`: a passphrase is set but not yet entered this session, so encrypted
 *   data cannot be read or written until the vault is unlocked.
 */
export interface VaultStatus {
  active: boolean;
  protected: boolean;
  locked: boolean;
}
export type ErrorCode =
  | "validation/invalid_input"
  | "validation/invalid_date_range"
  | "trip/not_found"
  | "candidate/not_found"
  | "candidate/already_resolved"
  | "fact/not_found"
  | "document/too_large"
  | "document/duplicate"
  | "document/empty"
  | "advice/fetch_failed"
  | "assist/failed"
  | "pack/download_failed"
  | "vault/locked"
  | "vault/passphrase_incorrect"
  | "storage/failure"
  | "transport/failure"
  | "internal/unexpected";
export interface AppError {
  code: ErrorCode;
  message: string;
  details?: Record<string, string>;
}
export interface CreateTripInput {
  title?: string;
  origin: string;
  destination: string;
  startDate: string;
  endDate: string;
}
export interface UpdateTripInput {
  title?: string;
  origin?: string;
  destination?: string;
  startDate?: string;
  endDate?: string;
}
export interface ImportDocumentInput {
  tripId: string;
  kind: DocumentKind;
  label?: string;
  content: string;
}
export interface ConfirmCandidateInput {
  candidateId: string;
  editedPayload?: FactPayload;
}
export interface AddManualFactInput {
  tripId: string;
  factType: FactType;
  payload: FactPayload;
}
export interface AppGateway {
  health(): Promise<HealthResponse>;
  createTrip(input: CreateTripInput): Promise<Trip>;
  listTrips(): Promise<TripSummary[]>;
  getTrip(tripId: string): Promise<TripDetail>;
  updateTrip(tripId: string, input: UpdateTripInput): Promise<Trip>;
  archiveTrip(tripId: string): Promise<Trip>;
  getTripBrief(tripId: string): Promise<TripBrief>;
  getToday(tripId: string): Promise<TodayView>;
  getVaultStatus(): Promise<VaultStatus>;
  setVaultPassphrase(passphrase: string): Promise<VaultStatus>;
  unlockVault(passphrase: string): Promise<VaultStatus>;
  removeVaultPassphrase(passphrase: string): Promise<VaultStatus>;
  detectLocalAi(): Promise<LocalAiStatus>;
  listProviders(): Promise<ProviderConfig[]>;
  setProviderKey(input: SetProviderKeyInput): Promise<ProviderConfig>;
  clearProviderKey(provider: ProviderId): Promise<ProviderConfig>;
  setProviderModel(input: SetProviderModelInput): Promise<ProviderConfig>;
  previewAssist(
    tripId: string,
    provider: ProviderId,
  ): Promise<AssistRequestPreview>;
  runAssist(tripId: string, provider: ProviderId): Promise<AssistReply>;
  listAssistActivity(tripId: string): Promise<AssistActivityEntry[]>;
  listPacks(): Promise<PackInfo[]>;
  downloadPack(tripId: string, packId: string): Promise<DownloadedPack>;
  listDownloadedPacks(tripId: string): Promise<DownloadedPack[]>;
  deleteDownloadedPack(tripId: string, packId: string): Promise<void>;
  getRecommendations(
    tripId: string,
    weights: PersonaWeights,
  ): Promise<Recommendation[]>;
  listAdviceCountries(): Promise<FcdoCountry[]>;
  fetchTravelAdvice(
    input: FetchTravelAdviceInput,
  ): Promise<TravelAdviceSnapshot>;
  fetchWeather(tripId: string): Promise<WeatherSnapshot>;
  searchTrip(tripId: string, query: string): Promise<SearchHit[]>;
  deleteTrip(tripId: string): Promise<void>;
  importDocument(input: ImportDocumentInput): Promise<ImportResult>;
  listCandidates(
    tripId: string,
    status?: CandidateStatus,
  ): Promise<CandidateFact[]>;
  confirmCandidate(
    input: ConfirmCandidateInput,
  ): Promise<{ candidate: CandidateFact; confirmedFact: ConfirmedFact }>;
  rejectCandidate(candidateId: string): Promise<CandidateFact>;
  addManualFact(input: AddManualFactInput): Promise<ConfirmedFact>;
  unconfirmFact(factId: string): Promise<void>;
}

export { createMockGateway } from "./mock";
