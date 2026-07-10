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
export type DocumentKind = "pasted_text" | "html";
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
