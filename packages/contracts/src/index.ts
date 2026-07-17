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
  /** The latest user-fetched official advisory panel, when one exists. */
  advisoryPanel?: AdvisoryPanel;
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
/**
 * The closed set of readiness findings. Each maps to exactly one sentence in the
 * interface's message catalog.
 *
 * The core reports what it found and how many; the interface owns the words and
 * their pluralization. Mirrors `voyalier-core::types::ReadinessFindingCode`.
 */
export type ReadinessFindingCode =
  | "no_facts_yet"
  | "schedule_conflicts"
  | "schedule_notices"
  | "schedule_clear"
  | "no_lodging_yet"
  | "lodging_gaps"
  | "lodging_clear"
  | "pending_review"
  | "nothing_pending"
  | "link_only";
/** What a readiness check found, and the number that describes it. */
export interface ReadinessFinding {
  code: ReadinessFindingCode;
  /** What the finding counts; absent for findings that count nothing. */
  count?: number;
}
export interface ReadinessItem {
  id: ReadinessCheck;
  status: ReadinessStatus;
  /** What the check found. There is no title: it is derivable from `id`. */
  finding: ReadinessFinding;
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
export type ExtractionMethod =
  | "structured"
  | "inferred"
  | "manual"
  // Drafted by an on-device model from the trip's own imported text, then
  // reviewed by the user. Never authoritative on its own.
  | "assisted";
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
  /**
   * True when this fact came from an imported document the user has since
   * deleted. The fact itself survives — the user approved it — but its evidence
   * is gone, so the UI must stop offering to show it.
   *
   * This is why deleting a document cannot simply null out `candidateId`: a null
   * candidate already means "added by hand", and a fact whose source was removed
   * is not the same thing.
   */
  sourceRemoved: boolean;
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
/**
 * A stored document plus what it produced, for the documents manager. The counts
 * are what make deletion an informed choice: they say what is about to be
 * discarded (pending) and what will outlive the document (confirmed).
 */
export interface DocumentSummary {
  document: SourceDocument;
  /** Candidates from this import still awaiting review. Deleted with it. */
  pendingCount: number;
  /** Candidates from this import already confirmed. These facts survive. */
  confirmedCount: number;
}
/** One document's original text, unsealed from the vault for display. */
export interface DocumentContent {
  document: SourceDocument;
  content: string;
}
/**
 * A trip's free-text notes.
 *
 * Sealed at rest like any other traveler-authored text, and excluded from the
 * brief and from AI requests **by construction**: both are built from the trip
 * plus its confirmed facts, and notes are neither, so no filter has to remember
 * to leave them out.
 */
export interface TripNotes {
  tripId: string;
  body: string;
  /** null until the traveler first saves something. */
  updatedAt: string | null;
}
/**
 * Validation limits the core and this contract must agree on.
 *
 * These are not "mirrors" on the honour system: `parity/limits.json` holds the
 * values, a Rust test holds the core to it, and `apps/web/src/parity.test.ts`
 * holds these to it. Change one and both fail.
 *
 * Every limit counts **characters** (Unicode scalar values), matching Rust's
 * `.chars().count()`. Use {@link countChars}, never `text.length` — that counts
 * UTF-16 code units, so a string of emoji counts double and the check rejects
 * input the core accepts.
 */
/** The most a trip's notes may hold. */
export const MAX_NOTES_CHARS = 100_000;
/** The longest origin or destination accepted. */
export const MAX_LOCATION_LEN = 120;
/** The most an imported document may hold. */
export const MAX_DOCUMENT_CHARS = 1_000_000;
/** The longest in-trip search query accepted. */
export const MAX_QUERY_LEN = 200;
/** The longest custom AI instruction accepted. */
export const MAX_AI_PROMPT_LEN = 6000;

/**
 * Count characters the way the core does — Unicode scalar values, not UTF-16
 * code units.
 *
 * `"😀".length` is 2; `countChars("😀")` is 1, which is what Rust's
 * `.chars().count()` reports. Every limit above is expressed in these units.
 */
export function countChars(text: string): number {
  return [...text].length;
}
/** One fetchable FCDO country page (curated list; slugs are never free text). */
export interface FcdoCountry {
  slug: string;
  name: string;
}
/** One government whose advisories Voyalier fetches. */
export type AdvisorySource = "uk-fcdo" | "us-state" | "ca-gac" | "de-aa";
/** What happened to one source on the last fetch attempt. */
export type SourceState = "fresh" | "kept" | "unavailable" | "notPublished";
/**
 * One government's dated, verbatim advisory for one country.
 *
 * Levels are source-native: `levelLabel` is that government's own wording and
 * `levelRank` tones only that card's own badge. They are never compared,
 * merged, or ranked across governments — a US "Level 2" and a Canadian
 * advisory-state 2 are not the same claim.
 */
export interface AdvisoryEntry {
  source: AdvisorySource;
  sourceName: string;
  countryName: string;
  levelLabel?: string;
  levelRank?: number;
  summary: string;
  sourceUrl: string;
  sourceUpdatedAt?: string;
  changeDescription?: string;
  /** Content language tag ("en", "de"). The source is never translated. */
  language: string;
  attribution: string;
  /** When this device retrieved the entry (RFC 3339). */
  retrievedAt: string;
}
/** One CDC travel-health notice. Informational only; never clears readiness. */
export interface HealthNotice {
  title: string;
  url: string;
  levelLabel?: string;
  publishedAt?: string;
  summary: string;
}
export interface SourceStatus {
  source: AdvisorySource;
  state: SourceState;
}
/** Every government's advice for one country, assembled from stored snapshots. */
export interface AdvisoryPanel {
  countrySlug: string;
  countryName: string;
  entries: AdvisoryEntry[];
  healthNotices: HealthNotice[];
  /**
   * Annotates entries; never gates them. A source with no status here (a
   * snapshot migrated from before the panel existed) claims nothing about a
   * fetch that never happened.
   */
  sourceStatus: SourceStatus[];
  /** When the panel-level fetch happened (RFC 3339). */
  retrievedAt: string;
}
export interface FetchAdvisoriesInput {
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
/** The kinds of on-device AI draft Voyalier can produce. */
export type AssistDraftKind = "lodging_dates";
/** The candidates an on-device draft produced, for review (pending, never confirmed). */
export interface AssistDraftResult {
  candidates: CandidateFact[];
}
/** Which AI system instruction a user override applies to. */
export type AiPromptKind = "assist" | "draft_lodging_dates";
/** One editable AI instruction: its built-in default plus the user's override if set. */
export interface AiPrompt {
  kind: AiPromptKind;
  defaultText: string;
  /** Present when the user has overridden the default. */
  customText?: string;
}
export interface AiPromptSettings {
  prompts: AiPrompt[];
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
/** The outcome of an in-app model download (an Ollama pull). Carries no secrets. */
export interface LocalModelPullResult {
  /** True when the model finished downloading and is ready to use. */
  ok: boolean;
  /** A short, human-readable status — a confirmation or the reason it failed. */
  message: string;
}
/**
 * The verdict of a live check of a BYOK key against its provider.
 * - "valid": the provider accepted the key.
 * - "rejected": the provider actively rejected it (a bad or revoked key).
 * - "unreachable": couldn't verify (offline/transient) — the key may still work.
 */
export type KeyValidationStatus = "valid" | "rejected" | "unreachable";
/** The outcome of validating a provider key. Never carries the key itself. */
export interface KeyValidation {
  status: KeyValidationStatus;
  message: string;
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
  offlineMapAvailable?: boolean;
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
  offlineMapReady: boolean;
}
/** Metadata for a verified PMTiles archive stored locally for a trip. */
export interface OfflineMapArchive {
  packId: string;
  name: string;
  bbox: BoundingBox;
  byteLength: number;
  sha256: string;
  sourceName: string;
  sourceUrl: string;
  license: string;
  attribution: string;
  fetchedAt: string;
  minZoom: number;
  maxZoom: number;
}
/** A bounded base64-encoded range from a local PMTiles archive. */
export interface OfflineMapChunk {
  dataBase64: string;
  etag: string;
}
/** How strongly a trip destination matched a catalog pack. */
export type PackMatchKind = "exact" | "alias" | "partial";
/**
 * A catalog pack suggested for a trip's destination, with why it matched. Built
 * on-device from the compiled-in catalog — suggesting sends nothing and
 * downloads nothing; downloading stays an explicit user action.
 */
export interface PackSuggestion {
  pack: PackInfo;
  matchKind: PackMatchKind;
  /** The pack-side term that matched (its name, alias, or region). */
  matchedText: string;
}
/** Where a field-value suggestion came from, so the UI can label it honestly. */
export type SuggestionSource =
  "catalog" | "pack_place" | "confirmed_fact" | "trip_history";
/** One suggested value for a form field, from local data only. */
export interface FieldSuggestion {
  value: string;
  source: SuggestionSource;
  /** A short human note ("from a previous stay"), when useful. */
  detail?: string;
}
/** Lodging fields that support local suggestions. */
export type SuggestableField = "address" | "propertyName";
export interface SuggestFieldValuesInput {
  tripId: string;
  field: SuggestableField;
  query: string;
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
  | "document/not_found"
  | "document/too_large"
  | "document/duplicate"
  | "document/empty"
  | "advice/fetch_failed"
  | "weather/fetch_failed"
  | "assist/failed"
  | "assist/unreachable"
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
  /** Bring an archived trip back into the workspace (restores it to draft). */
  unarchiveTrip(tripId: string): Promise<Trip>;
  getTripBrief(tripId: string): Promise<TripBrief>;
  getToday(tripId: string): Promise<TodayView>;
  getVaultStatus(): Promise<VaultStatus>;
  setVaultPassphrase(passphrase: string): Promise<VaultStatus>;
  unlockVault(passphrase: string): Promise<VaultStatus>;
  removeVaultPassphrase(passphrase: string): Promise<VaultStatus>;
  detectLocalAi(): Promise<LocalAiStatus>;
  pullLocalModel(model: string): Promise<LocalModelPullResult>;
  listProviders(): Promise<ProviderConfig[]>;
  setProviderKey(input: SetProviderKeyInput): Promise<ProviderConfig>;
  validateProviderKey(input: SetProviderKeyInput): Promise<KeyValidation>;
  clearProviderKey(provider: ProviderId): Promise<ProviderConfig>;
  setProviderModel(input: SetProviderModelInput): Promise<ProviderConfig>;
  previewAssist(
    tripId: string,
    provider: ProviderId,
  ): Promise<AssistRequestPreview>;
  runAssist(tripId: string, provider: ProviderId): Promise<AssistReply>;
  previewAssistDraft(
    tripId: string,
    kind: AssistDraftKind,
  ): Promise<AssistRequestPreview>;
  runAssistDraft(
    tripId: string,
    kind: AssistDraftKind,
  ): Promise<AssistDraftResult>;
  listAssistActivity(tripId: string): Promise<AssistActivityEntry[]>;
  getAiPrompts(): Promise<AiPromptSettings>;
  /** Set an AI instruction, or pass `null` text to reset it to the default. */
  setAiPrompt(
    kind: AiPromptKind,
    text: string | null,
  ): Promise<AiPromptSettings>;
  listPacks(): Promise<PackInfo[]>;
  suggestPacks(tripId: string): Promise<PackSuggestion[]>;
  suggestFieldValues(
    input: SuggestFieldValuesInput,
  ): Promise<FieldSuggestion[]>;
  downloadPack(tripId: string, packId: string): Promise<DownloadedPack>;
  listDownloadedPacks(tripId: string): Promise<DownloadedPack[]>;
  deleteDownloadedPack(tripId: string, packId: string): Promise<void>;
  getOfflineMap(tripId: string): Promise<OfflineMapArchive | null>;
  readOfflineMapRange(
    tripId: string,
    packId: string,
    offset: number,
    length: number,
  ): Promise<OfflineMapChunk>;
  getRecommendations(
    tripId: string,
    weights: PersonaWeights,
  ): Promise<Recommendation[]>;
  listAdviceCountries(): Promise<FcdoCountry[]>;
  fetchAdvisories(input: FetchAdvisoriesInput): Promise<AdvisoryPanel>;
  fetchWeather(tripId: string): Promise<WeatherSnapshot>;
  searchTrip(tripId: string, query: string): Promise<SearchHit[]>;
  /** Typeahead term suggestions for the query's last word, from the trip corpus. */
  suggestSearchTerms(tripId: string, query: string): Promise<string[]>;
  deleteTrip(tripId: string): Promise<void>;
  importDocument(input: ImportDocumentInput): Promise<ImportResult>;
  /** A trip's notes. Never written yet is an empty body, not an error. */
  getTripNotes(tripId: string): Promise<TripNotes>;
  /** Replace a trip's notes; an empty body clears them. */
  setTripNotes(tripId: string, body: string): Promise<TripNotes>;
  /** Every document imported into a trip, newest first, with its candidate counts. */
  listDocuments(tripId: string): Promise<DocumentSummary[]>;
  /** One document's original text, unsealed on demand — never listed in bulk. */
  getDocument(documentId: string): Promise<DocumentContent>;
  /**
   * Delete an imported document and its still-pending candidates. Facts already
   * confirmed from it survive, flagged `sourceRemoved` — the user approved those,
   * so they are theirs to keep.
   */
  deleteDocument(documentId: string): Promise<void>;
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
// Exported for the cross-language parity tests, which hold this and the Rust
// core to the same golden file. Not part of the gateway surface.
export {
  assessReadiness as mockAssessReadiness,
  detectItineraryConflicts as mockDetectItineraryConflicts,
  mockNormalizePlace,
} from "./mock";
