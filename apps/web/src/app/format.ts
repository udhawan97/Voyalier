import type {
  AppError,
  CandidateStatus,
  ExtractionMethod,
  FactPayload,
  FactType,
  TripStatus,
  WarningCode,
} from "@voyalier/contracts";

import { t, type MessageKey } from "./i18n";
import { APP_LOCALE } from "./locale";

// Re-exported for callers (and tests) that import it from here.
export { APP_LOCALE };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function dateFormatterFor(locale: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      // Contract dates are wall-clock strings with no offset. Anchor to UTC so
      // month/number names localize without any timezone shifting the day.
      timeZone: "UTC",
    });
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * Format a contract date ("YYYY-MM-DD") for a specific locale — e.g. "Nov 3,
 * 2026" (en-US) or "3 nov. 2026" (fr-FR). Anchored to UTC so the calendar day is
 * never shifted. Unparseable input is returned verbatim.
 */
export function formatDateIn(value: string, locale: string): string {
  const match = DATE_ONLY.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return dateFormatterFor(locale).format(
    new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))),
  );
}

/** Format a contract date for the active locale ([[formatDateIn]]). */
export function formatDate(value: string): string {
  return formatDateIn(value, APP_LOCALE);
}

/**
 * Format a local datetime ("2026-11-03T11:20") as "Nov 3, 2026 · 11:20". The
 * date localizes; the wall-clock time is kept verbatim (never through Date, so
 * no timezone conversion).
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
      return t("status.trip.draft");
    case "active":
      return t("status.trip.active");
    case "archived":
      return t("status.trip.archived");
  }
}

export function candidateStatusLabel(status: CandidateStatus): string {
  switch (status) {
    case "pending":
      return t("status.candidate.pending");
    case "confirmed":
      return t("status.candidate.confirmed");
    case "rejected":
      return t("status.candidate.rejected");
  }
}

export function factTypeLabel(factType: FactType): string {
  return factType === "flight_segment"
    ? t("factType.flight")
    : t("factType.stay");
}

/** A short headline for a fact/candidate ("Flight NS204" / "River Paper Inn"). */
export function factTitle(factType: FactType, payload: FactPayload): string {
  const values = payload as Record<string, string | undefined>;
  if (factType === "flight_segment") {
    return values.flightNumber
      ? t("fact.flightHeadline", { number: values.flightNumber })
      : t("factType.flight");
  }
  return values.propertyName ?? t("factType.stay");
}

/** A supporting line ("ORD → NRT" / an address). */
export function factSubtitle(factType: FactType, payload: FactPayload): string {
  const values = payload as Record<string, string | undefined>;
  if (factType === "flight_segment") {
    if (values.departureAirportIata && values.arrivalAirportIata) {
      return `${values.departureAirportIata} → ${values.arrivalAirportIata}`;
    }
    return t("fact.flightSegment");
  }
  return values.address ?? t("fact.lodgingStay");
}

export function methodLabel(method: ExtractionMethod): string {
  switch (method) {
    case "structured":
      return t("method.structured");
    case "inferred":
      return t("method.inferred");
    case "manual":
      return t("method.manual");
    case "assisted":
      return t("method.assisted");
  }
}

/** Plain-language explanation of an extraction method, for the chip's title/aria. */
export function methodDescription(method: ExtractionMethod): string {
  switch (method) {
    case "structured":
      return t("method.structured.desc");
    case "inferred":
      return t("method.inferred.desc");
    case "manual":
      return t("method.manual.desc");
    case "assisted":
      return t("method.assisted.desc");
  }
}

/** Human sentence for an enumerated parser warning. */
export function warningSentence(code: WarningCode): string {
  switch (code) {
    case "missing_dates":
      return t("warning.missing_dates");
    case "missing_locations":
      return t("warning.missing_locations");
    case "ambiguous_date_format":
      return t("warning.ambiguous_date_format");
    case "past_date":
      return t("warning.past_date");
    case "outside_trip_window":
      return t("warning.outside_trip_window");
    case "unrecognized_airport_code":
      return t("warning.unrecognized_airport_code");
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

// Field key → catalog key; the label itself comes from t() so it localizes.
const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  airlineName: "field.airlineName",
  airlineIata: "field.airlineIata",
  flightNumber: "field.flightNumber",
  departureAirportIata: "field.departureAirportIata",
  arrivalAirportIata: "field.arrivalAirportIata",
  departureLocal: "field.departureLocal",
  arrivalLocal: "field.arrivalLocal",
  confirmationCode: "field.confirmationCode",
  passengerName: "field.passengerName",
  propertyName: "field.propertyName",
  address: "field.address",
  checkinDate: "field.checkinDate",
  checkoutDate: "field.checkoutDate",
  guestName: "field.guestName",
};

const DATE_FIELDS = new Set(["checkinDate", "checkoutDate"]);
const DATETIME_FIELDS = new Set(["departureLocal", "arrivalLocal"]);

export function fieldsForType(factType: FactType): readonly string[] {
  return factType === "flight_segment" ? FLIGHT_FIELDS : LODGING_FIELDS;
}

/** "payload.flightNumber" or "flightNumber" → "Flight number". */
export function fieldLabel(fieldPathOrKey: string): string {
  const key = fieldPathOrKey.replace(/^payload\./, "");
  const messageKey = FIELD_LABEL_KEYS[key];
  return messageKey ? t(messageKey) : key;
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
        title: t("error.transport.title"),
        body: t("error.transport.body"),
      };
    case "storage/failure":
      return { title: t("error.storage.title"), body: t("error.storage.body") };
    case "trip/not_found":
      return {
        title: t("error.tripNotFound.title"),
        body: t("error.tripNotFound.body"),
      };
    case "candidate/not_found":
      return {
        title: t("error.candidateNotFound.title"),
        body: t("error.candidateNotFound.body"),
      };
    case "candidate/already_resolved":
      return {
        title: t("error.candidateResolved.title"),
        body: t("error.candidateResolved.body"),
      };
    case "fact/not_found":
      return {
        title: t("error.factNotFound.title"),
        body: t("error.factNotFound.body"),
      };
    case "document/empty":
      return {
        title: t("error.documentEmpty.title"),
        body: t("error.documentEmpty.body"),
      };
    case "document/too_large":
      return {
        title: t("error.documentTooLarge.title"),
        body: t("error.documentTooLarge.body"),
      };
    case "document/duplicate":
      return {
        title: t("error.documentDuplicate.title"),
        body: t("error.documentDuplicate.body"),
      };
    case "advice/fetch_failed":
      return {
        title: t("error.adviceFetch.title"),
        body: t("error.adviceFetch.body"),
      };
    case "weather/fetch_failed":
      // The body is the backend's specific, actionable message (e.g. "couldn't
      // find that destination" vs "couldn't reach the weather service").
      return { title: t("error.weatherFetch.title"), body: error.message };
    case "assist/failed":
      return { title: t("error.assist.title"), body: t("error.assist.body") };
    case "assist/unreachable":
      return {
        title: t("error.assistUnreachable.title"),
        body: t("error.assistUnreachable.body"),
      };
    case "pack/download_failed":
      return {
        title: t("error.packDownload.title"),
        body: t("error.packDownload.body"),
      };
    case "validation/invalid_input":
    case "validation/invalid_date_range":
      // The body is the server's field-level message, kept verbatim.
      return { title: t("error.validation.title"), body: error.message };
    case "internal/unexpected":
    default:
      return {
        title: t("error.unexpected.title"),
        body: t("error.unexpected.body"),
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
