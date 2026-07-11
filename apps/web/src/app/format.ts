import type {
  AppError,
  CandidateStatus,
  ExtractionMethod,
  FactPayload,
  FactType,
  TripStatus,
  WarningCode,
} from "@voyalier/contracts";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Format a contract date ("YYYY-MM-DD") as "Nov 3, 2026" WITHOUT constructing a
 * Date — contract datetimes are local wall-clock strings with no offset, so any
 * timezone conversion would shift them. Unparseable input is returned verbatim.
 */
export function formatDate(value: string): string {
  const match = DATE_ONLY.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * Format a local datetime ("2026-11-03T11:20") as "Nov 3, 2026 · 11:20",
 * verbatim — never through Date/timezone conversion.
 */
export function formatDateTimeLocal(value: string): string {
  const [datePart, timePart] = value.split("T");
  if (!timePart) return formatDate(value);
  return `${formatDate(datePart)} · ${timePart}`;
}

export function formatDateRange(startDate: string, endDate: string): string {
  return `${formatDate(startDate)} – ${formatDate(endDate)}`;
}

export function tripRoute(origin: string, destination: string): string {
  return `${origin} → ${destination}`;
}

export function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "active":
      return "Active";
    case "archived":
      return "Archived";
  }
}

export function candidateStatusLabel(status: CandidateStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "rejected":
      return "Rejected";
  }
}

export function factTypeLabel(factType: FactType): string {
  return factType === "flight_segment" ? "Flight" : "Stay";
}

/** A short headline for a fact/candidate ("Flight NS204" / "River Paper Inn"). */
export function factTitle(factType: FactType, payload: FactPayload): string {
  const values = payload as Record<string, string | undefined>;
  if (factType === "flight_segment") {
    return values.flightNumber ? `Flight ${values.flightNumber}` : "Flight";
  }
  return values.propertyName ?? "Stay";
}

/** A supporting line ("ORD → NRT" / an address). */
export function factSubtitle(factType: FactType, payload: FactPayload): string {
  const values = payload as Record<string, string | undefined>;
  if (factType === "flight_segment") {
    if (values.departureAirportIata && values.arrivalAirportIata) {
      return `${values.departureAirportIata} → ${values.arrivalAirportIata}`;
    }
    return "Flight segment";
  }
  return values.address ?? "Lodging stay";
}

export function methodLabel(method: ExtractionMethod): string {
  switch (method) {
    case "structured":
      return "Structured";
    case "inferred":
      return "Inferred";
    case "manual":
      return "Manual";
  }
}

/** Plain-language explanation of an extraction method, for the chip's title/aria. */
export function methodDescription(method: ExtractionMethod): string {
  switch (method) {
    case "structured":
      return "Read from structured data embedded in the document.";
    case "inferred":
      return "Inferred from unstructured text — worth a closer look.";
    case "manual":
      return "Entered by you.";
  }
}

/** Human sentence for an enumerated parser warning. */
export function warningSentence(code: WarningCode): string {
  switch (code) {
    case "missing_dates":
      return "No dates were found for this item.";
    case "missing_locations":
      return "No locations were found for this item.";
    case "ambiguous_date_format":
      return "The date format was ambiguous and may be read wrong.";
    case "past_date":
      return "This date is in the past.";
    case "outside_trip_window":
      return "This falls outside your trip dates.";
    case "unrecognized_airport_code":
      return "An airport code wasn't recognized.";
  }
}

// Field ordering + labels drive display, editing, and manual entry alike.
export const FLIGHT_FIELDS = [
  "airlineName",
  "airlineIata",
  "flightNumber",
  "departureAirportIata",
  "departureLocal",
  "arrivalAirportIata",
  "arrivalLocal",
  "confirmationCode",
  "passengerName",
] as const;

export const LODGING_FIELDS = [
  "propertyName",
  "address",
  "checkinDate",
  "checkoutDate",
  "confirmationCode",
  "guestName",
] as const;

const FIELD_LABELS: Record<string, string> = {
  airlineName: "Airline",
  airlineIata: "Airline code",
  flightNumber: "Flight number",
  departureAirportIata: "From (airport)",
  arrivalAirportIata: "To (airport)",
  departureLocal: "Departs (local)",
  arrivalLocal: "Arrives (local)",
  confirmationCode: "Confirmation code",
  passengerName: "Passenger",
  propertyName: "Property",
  address: "Address",
  checkinDate: "Check-in",
  checkoutDate: "Check-out",
  guestName: "Guest",
};

const DATE_FIELDS = new Set(["checkinDate", "checkoutDate"]);
const DATETIME_FIELDS = new Set(["departureLocal", "arrivalLocal"]);

export function fieldsForType(factType: FactType): readonly string[] {
  return factType === "flight_segment" ? FLIGHT_FIELDS : LODGING_FIELDS;
}

/** "payload.flightNumber" or "flightNumber" → "Flight number". */
export function fieldLabel(fieldPathOrKey: string): string {
  const key = fieldPathOrKey.replace(/^payload\./, "");
  return FIELD_LABELS[key] ?? key;
}

/** Render a payload value for display, keeping contract datetimes verbatim. */
export function formatFieldValue(key: string, value: string): string {
  if (DATETIME_FIELDS.has(key)) return formatDateTimeLocal(value);
  if (DATE_FIELDS.has(key)) return formatDate(value);
  return value;
}

/**
 * The HTML input type for a manual-entry field. datetime-local and date both
 * emit exactly the contract's local wall-clock format ("YYYY-MM-DDTHH:mm" /
 * "YYYY-MM-DD"), so no timezone conversion ever happens.
 */
export function fieldInputType(
  key: string,
): "date" | "datetime-local" | "text" {
  if (DATETIME_FIELDS.has(key)) return "datetime-local";
  if (DATE_FIELDS.has(key)) return "date";
  return "text";
}

export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** A payload as editable strings (contract payloads are all optional strings). */
export type PayloadDraft = Record<string, string>;

export function payloadToDraft(payload: FactPayload): PayloadDraft {
  const draft: PayloadDraft = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value != null) draft[key] = String(value);
  }
  return draft;
}

/** Build a payload from a draft, dropping empty fields (all fields are optional). */
export function draftToPayload(
  factType: FactType,
  draft: PayloadDraft,
): FactPayload {
  const payload: Record<string, string> = {};
  for (const key of fieldsForType(factType)) {
    const value = draft[key]?.trim();
    if (value) payload[key] = value;
  }
  return payload as FactPayload;
}

/** True when the draft has no non-empty field. */
export function isDraftEmpty(factType: FactType, draft: PayloadDraft): boolean {
  return fieldsForType(factType).every((key) => !draft[key]?.trim());
}

export interface ErrorCopy {
  title: string;
  body: string;
}

/** Banner-level copy for an AppError. Field-level validation is mapped separately. */
export function describeError(error: AppError): ErrorCopy {
  switch (error.code) {
    case "transport/failure":
      return {
        title: "Local core unreachable",
        body: "Voyalier can't reach the local core on this device right now. Your data is safe.",
      };
    case "storage/failure":
      return {
        title: "Local storage is unavailable",
        body: "Voyalier couldn't read or write your local data. Nothing was changed.",
      };
    case "trip/not_found":
      return {
        title: "This trip is no longer here",
        body: "It may have been deleted on this device.",
      };
    case "candidate/not_found":
      return {
        title: "This suggestion is no longer here",
        body: "It may have already been resolved. Refresh to see the current list.",
      };
    case "candidate/already_resolved":
      return {
        title: "Already resolved",
        body: "This suggestion was already confirmed or dismissed.",
      };
    case "fact/not_found":
      return {
        title: "This fact is no longer here",
        body: "It may have already been removed.",
      };
    case "document/empty":
      return {
        title: "Nothing to import",
        body: "The pasted content was empty.",
      };
    case "document/too_large":
      return {
        title: "That document is too large",
        body: "Documents are limited to 1,000,000 characters.",
      };
    case "document/duplicate":
      return {
        title: "Already imported",
        body: "This exact document was imported before.",
      };
    case "advice/fetch_failed":
      return {
        title: "Couldn't reach the official source",
        body: "Voyalier couldn't fetch the advice page right now. Check your connection and try again — nothing was changed.",
      };
    case "assist/failed":
      return {
        title: "Assist didn't finish",
        body: "Voyalier couldn't complete the request. Check the model and your connection (or that your local AI is running), then try again — nothing was changed.",
      };
    case "pack/download_failed":
      return {
        title: "Couldn't download that city pack",
        body: "Voyalier couldn't fetch the pack right now. Check your connection and try again — nothing was changed.",
      };
    case "validation/invalid_input":
    case "validation/invalid_date_range":
      return {
        title: "Check the highlighted fields",
        body: error.message,
      };
    case "internal/unexpected":
    default:
      return {
        title: "Something went wrong",
        body: "An unexpected error occurred. Nothing was changed.",
      };
  }
}

export type TripFieldKey =
  "origin" | "destination" | "startDate" | "endDate" | "dates";

/**
 * Map a server/mock validation AppError back onto trip form fields. Mirrors the
 * contract's details shape ({ field: "origin" | "destination" | "startDate,endDate" }).
 */
export function tripFieldError(
  error: AppError,
): { field: TripFieldKey; message: string } | null {
  if (error.code === "validation/invalid_date_range") {
    return { field: "dates", message: error.message };
  }
  if (error.code === "validation/invalid_input") {
    const field = error.details?.field ?? "";
    if (field.includes("origin"))
      return { field: "origin", message: error.message };
    if (field.includes("destination")) {
      return { field: "destination", message: error.message };
    }
    if (field.includes("Date") || field.includes("date")) {
      return { field: "dates", message: error.message };
    }
  }
  return null;
}
