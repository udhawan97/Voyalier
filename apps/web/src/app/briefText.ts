import type {
  BriefTripItem,
  CarRentalPayload,
  FlightSegmentPayload,
  LodgingStayPayload,
  RedactedField,
  SurfaceJourneyPayload,
  TripBrief,
} from "@voyalier/contracts";

import {
  factSubtitle,
  factTitle,
  fieldLabel,
  formatDateRange,
  formatDateTimeLocal,
  formatFieldValue,
  tripRoute,
} from "./format";

type SafeFlight = Pick<
  FlightSegmentPayload,
  | "airlineName"
  | "airlineIata"
  | "flightNumber"
  | "departureAirportIata"
  | "arrivalAirportIata"
  | "departureLocal"
  | "arrivalLocal"
>;

type SafeStay = Pick<
  LodgingStayPayload,
  "propertyName" | "address" | "checkinDate" | "checkoutDate"
>;

type SafeJourney = Pick<
  SurfaceJourneyPayload & CarRentalPayload,
  | "carrierName"
  | "serviceNumber"
  | "vehicleDescription"
  | "departurePlace"
  | "arrivalPlace"
  | "departureLocal"
  | "arrivalLocal"
>;

type SafePlan = Pick<
  BriefTripItem,
  "id" | "kind" | "title" | "location" | "startAt" | "endAt"
>;

/**
 * The clipboard formatter's input deliberately cannot name confirmation codes,
 * traveler names, imported text, resource content, or private plan notes.
 */
export type ShareSafeBriefText = Pick<
  TripBrief,
  | "title"
  | "origin"
  | "destination"
  | "startDate"
  | "endDate"
  | "redactedFields"
> & {
  flights: SafeFlight[];
  stays: SafeStay[];
  journeys: SafeJourney[];
  tripItems: SafePlan[];
};

export interface BriefTextLabels {
  flights: string;
  stays: string;
  journeys: string;
  plans: string;
  journey: string;
  empty: string;
  redaction: (fields: RedactedField[]) => string;
}

export type BriefContentMode = "full" | "essentials";

/**
 * Select from the already-redacted allowlist. Essentials keeps confirmed
 * transport and stays while leaving traveler-authored activities out.
 */
export function selectBriefContent(
  brief: TripBrief,
  mode: BriefContentMode,
): ShareSafeBriefText {
  return {
    title: brief.title,
    origin: brief.origin,
    destination: brief.destination,
    startDate: brief.startDate,
    endDate: brief.endDate,
    flights: brief.flights,
    stays: brief.stays,
    journeys: brief.journeys,
    tripItems: mode === "full" ? brief.tripItems : [],
    redactedFields: brief.redactedFields,
  };
}

type SafeValues = Record<string, string | undefined>;

function detailLines(values: SafeValues, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = values[key];
    return value ? [`${fieldLabel(key)}: ${formatFieldValue(key, value)}`] : [];
  });
}

function factLines(
  factType: "flight_segment" | "lodging_stay",
  payload: SafeFlight | SafeStay,
): string[] {
  const values = payload as SafeValues;
  const details =
    factType === "flight_segment"
      ? detailLines(values, [
          "airlineName",
          "airlineIata",
          "departureLocal",
          "arrivalLocal",
        ])
      : detailLines(values, ["checkinDate", "checkoutDate"]);
  return [
    factTitle(factType, payload),
    factSubtitle(factType, payload),
    ...details,
  ].filter(Boolean);
}

function journeyLines(journey: SafeJourney, fallback: string): string[] {
  const title =
    journey.serviceNumber ??
    journey.carrierName ??
    journey.vehicleDescription ??
    fallback;
  const route =
    journey.departurePlace && journey.arrivalPlace
      ? `${journey.departurePlace} → ${journey.arrivalPlace}`
      : (journey.departurePlace ?? journey.arrivalPlace);
  return [
    title,
    route,
    ...detailLines(journey as SafeValues, [
      "carrierName",
      "vehicleDescription",
      "departureLocal",
      "arrivalLocal",
    ]),
  ].filter((line): line is string => Boolean(line));
}

function planLines(plan: SafePlan): string[] {
  const timing = plan.startAt
    ? `${formatDateTimeLocal(plan.startAt)}${
        plan.endAt ? ` – ${formatDateTimeLocal(plan.endAt)}` : ""
      }`
    : undefined;
  return [plan.title, plan.location, timing].filter((line): line is string =>
    Boolean(line),
  );
}

function section(label: string, entries: string[][]): string[] {
  if (entries.length === 0) return [];
  return [label, ...entries.flatMap((entry) => [...entry, ""])];
}

/** Build readable plain text from the already-redacted, allowlisted brief. */
export function buildBriefText(
  brief: ShareSafeBriefText,
  labels: BriefTextLabels,
): string {
  const body = [
    ...section(
      labels.flights,
      brief.flights.map((flight) => factLines("flight_segment", flight)),
    ),
    ...section(
      labels.stays,
      brief.stays.map((stay) => factLines("lodging_stay", stay)),
    ),
    ...section(
      labels.journeys,
      brief.journeys.map((journey) => journeyLines(journey, labels.journey)),
    ),
    ...section(labels.plans, brief.tripItems.map(planLines)),
  ];
  if (body.length === 0) body.push(labels.empty, "");
  if (brief.redactedFields.length > 0) {
    body.push(labels.redaction(brief.redactedFields));
  }
  return [
    tripRoute(brief.origin, brief.destination),
    brief.title,
    formatDateRange(brief.startDate, brief.endDate),
    "",
    ...body,
  ]
    .join("\n")
    .trimEnd();
}
