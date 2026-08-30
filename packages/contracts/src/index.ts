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
  /**
   * Where the plan depends on the previous thing having gone right, derived on
   * read from the confirmed facts. Advisory only: it never enters the readiness
   * rollup, and it never proposes an alternative service (ADR-0016 §2).
   */
  disruptionPlan: DisruptionPlan;
  /** The latest user-fetched official advisory panel, when one exists. */
  advisoryPanel?: AdvisoryPanel;
  /** The latest user-fetched destination weather outlook, when one exists. */
  weather?: WeatherSnapshot;
  /**
   * Deterministic packing suggestions derived from the stored weather and the
   * confirmed facts. Empty until there is evidence to derive them from; never
   * fetched, never model-authored.
   */
  packingList: PackingSuggestion[];
  /** The latest user-fetched destination-facts snapshot, when one exists. */
  destinationFacts?: DestinationFactsSnapshot;
  /**
   * Bundled facts for the destination's country, resolved fresh from the
   * snapshot's country code. Present only when the country is covered.
   */
  countryFacts?: CountryFacts;
  /**
   * Sunrise/sunset/day-length per trip day, computed offline from the
   * snapshot's coordinates. Empty without a destination-facts snapshot.
   */
  astro: AstroDay[];
  /**
   * The traveler's own visa-preparation tally, for the entry-requirements
   * readiness line. Absent until they pick a passport and a journey resolves.
   * Never feeds the rollup — see ADR-0006.
   */
  visaSelfReport?: VisaSelfReport;
  /**
   * The airports nearest the destination, by great-circle distance from the
   * snapshot's coordinates. Bundled and offline; empty without a snapshot.
   */
  nearestAirports: NearbyAirport[];
  /**
   * An offline carbon estimate for the trip's confirmed flights, derived on read
   * from their airport codes. Absent when the trip has no confirmed flight at
   * all — which is not the same as an estimate of zero.
   */
  flightEmissions?: FlightEmissions;
  /**
   * How far the destination clock runs ahead of (or behind) the trip's origin,
   * derived on read from the snapshot's two offsets. Present only once the
   * origin has been geocoded.
   */
  timeDifference?: TimeDifference;
  /**
   * Days inside the trip window when the destination's or the origin's clocks
   * move. Empty when neither changes, and for snapshots stored before the IANA
   * zones were kept. `timeDifference` above is anchored to the trip's start
   * date, so a change here is what tells a traveler that gap does not hold for
   * the whole stay.
   */
  clockChanges: ClockChange[];
  /**
   * Eclipses falling inside the trip window, from a bundled NASA table. Needs
   * no snapshot and no fetch — a function of the trip's dates alone.
   */
  skyEvents: SkyEvent[];
  /**
   * The destination country's public holidays that fall during the trip,
   * narrowed to the travel window on read. Present only once fetched; its
   * `holidays` list is empty when none land in the window.
   */
  publicHolidays?: PublicHolidaysSnapshot;
  /**
   * UNESCO World Heritage sites near the destination, by great-circle distance
   * from the snapshot's coordinates. Bundled and offline; empty without a
   * snapshot.
   */
  worldHeritage: HeritageSite[];
  /** The latest user-fetched Wikipedia summary of the destination (CC BY-SA). */
  placeSummary?: PlaceSummary;
  /**
   * A short, conservative tipping guide for the destination country, resolved
   * from the snapshot's country code. Present only when curated.
   */
  tipping?: string;
  /** Persisted recommendation weights; balanced until the traveler changes them. */
  interestProfile: InterestProfile;
  /** Shortlisted recommendations, distinct from scheduled trip items. */
  savedPlaces: SavedPlace[];
  /** Explicit traveler-owned packing checklist. */
  packingItems: PackingItem[];
  /** Manual activities, rail segments, and transfers; never confirmed evidence. */
  tripItems: TripItem[];
}
/** The destination-vs-origin wall-clock gap on the trip's dates. */
export interface TimeDifference {
  /** The origin place the gap is measured from (the geocoded name). */
  originPlace: string;
  /**
   * Signed minutes: destination offset minus origin offset. Positive means the
   * destination is ahead; negative behind; zero the same time. Minutes, not
   * hours, so sub-hour zones stay exact.
   */
  offsetMinutes: number;
}
export type SkyEventKind = "solarEclipse" | "lunarEclipse";
/** One dated eclipse, with the broad band NASA publishes it as visible from. */
export interface SkyEvent {
  /**
   * ISO `YYYY-MM-DD`, as the catalogue gives it — a Terrestrial/Universal Time
   * calendar date. Near the date line a local calendar date can differ by one,
   * so this is the event's date and not the traveler's.
   */
  date: string;
  kind: SkyEventKind;
  /** The catalogue's own phrasing, e.g. "Total solar eclipse". */
  label: string;
  /**
   * NASA's "Geographic Region of Eclipse Visibility", verbatim — a coarse band
   * where *some* phase is visible, not a local-circumstances calculation.
   * Never render this as "visible from your destination".
   */
  region: string;
}
/** A day inside the trip window when a place's clocks move. */
export interface ClockChange {
  /** ISO `YYYY-MM-DD`: the first local day that runs on the new offset. */
  date: string;
  fromOffsetMinutes: number;
  toOffsetMinutes: number;
  /**
   * Whose clocks move — the destination or the trip's origin, named so a
   * traveler knows which end of the trip it happens at.
   */
  place: string;
}
/** One public holiday at the destination. */
export interface PublicHoliday {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  /** English name. */
  name: string;
  /** The holiday's name in the country's own language. */
  localName: string;
  /** National (`true`) versus regional / subdivision-only (`false`). */
  global: boolean;
}
/**
 * One school-holiday period at the destination. A period, not a day: school
 * holidays run for weeks, so a trip "during" one overlaps it, never contains it.
 */
export interface SchoolHoliday {
  /** ISO `YYYY-MM-DD`, inclusive. */
  startDate: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  endDate: string;
  /** English name ("Summer Holidays"), or the local name where that is all
   * the source publishes. */
  name: string;
  /** Whether the period covers the whole country. */
  nationwide: boolean;
  /** Subdivision codes when it is regional ("DE-BY"); empty when nationwide. */
  subdivisions: string[];
}
/** A dated snapshot of the destination country's public holidays. */
export interface PublicHolidaysSnapshot {
  /** ISO-3166-1 alpha-2 of the destination country. */
  countryCode: string;
  /** The destination country's English name, for labelling. */
  countryName: string;
  /** Public holidays (on `TripDetail`, already narrowed to the travel window). */
  holidays: PublicHoliday[];
  /**
   * School-holiday periods overlapping the travel window. Empty both when none
   * overlap and when the country is not covered — `schoolHolidaysCovered` is
   * what tells those apart, and the interface must not merge them.
   */
  schoolHolidays: SchoolHoliday[];
  /** Whether the school-holiday source publishes this country at all. */
  schoolHolidaysCovered: boolean;
  retrievedAt: string;
}
/** How large an airport is, as OurAirports classifies it. */
export type AirportSize = "large" | "medium";
/** One airport near the destination, with its distance from it. */
export interface NearbyAirport {
  iata: string;
  name: string;
  /** Great-circle distance from the destination, kilometres. */
  distanceKm: number;
  size: AirportSize;
}
/**
 * A trip's estimated flight emissions, and how much of the trip it covers.
 *
 * One average factor, not haul bands: DESNZ defines domestic/short/long haul by
 * territory relative to the UK, and the bundled airport table carries no
 * country, so this uses the row DESNZ publishes for flights between non-UK
 * destinations. Always presented as an estimate.
 */
export interface FlightEmissions {
  /** Estimated kilograms of CO₂-equivalent, one passenger, counted legs only. */
  kgCo2e: number;
  /** Total great-circle distance of the counted legs, kilometres. */
  distanceKm: number;
  /** Confirmed flights included in the estimate. */
  countedFlights: number;
  /**
   * Confirmed flights left out because their airport codes were missing or
   * unknown. Non-zero means the total is a floor and must be labelled partial.
   */
  unresolvedFlights: number;
  /** The DESNZ conversion-factor year behind the estimate. */
  factorYear: number;
}
/** One UNESCO World Heritage site near the destination. */
export interface HeritageSite {
  name: string;
  /** Great-circle distance from the destination, kilometres. */
  distanceKm: number;
  /** Year the site was inscribed, when known. */
  year?: number;
}
/** A dated Wikipedia summary of the destination (CC BY-SA). */
export interface PlaceSummary {
  /** The article title (the place name Wikipedia resolved to). */
  title: string;
  /** The short one-line description, when present. */
  description: string;
  /** The plain-text lead summary. */
  extract: string;
  /** The canonical article URL, for attribution and "read more". */
  url: string;
  retrievedAt: string;
}
/** Whether the sun rises and sets at all on a day. */
export type PolarState = "normal" | "polarDay" | "polarNight";
/** Sun and moon facts for one local calendar day. Times are local `HH:MM`. */
export interface AstroDay {
  date: string;
  sunrise?: string;
  sunset?: string;
  /** Minutes of daylight: 0 on a polar night, 1440 on a polar day. */
  dayLengthMinutes?: number;
  polar: PolarState;
  /**
   * The day's two low-sun windows, when it has them. Absent on a polar night
   * (no sun), on a polar day (the low-sun period straddles local midnight and
   * belongs to no one civil day), and on a high-latitude `normal` day where the
   * sun rises but never climbs out of the golden band.
   */
  goldenHour?: GoldenHour;
  moon: MoonPhase;
}
/**
 * The morning and evening low-sun windows of one local day, `HH:MM` local. The
 * outer bounds are that day's own sunrise and sunset, so they never disagree
 * with the sun times shown beside them.
 */
export interface GoldenHour {
  morningStart: string;
  morningEnd: string;
  eveningStart: string;
  eveningEnd: string;
}
/** The eight named lunar phases, new to waning crescent. */
export type MoonPhaseName =
  | "new_moon"
  | "waxing_crescent"
  | "first_quarter"
  | "waxing_gibbous"
  | "full_moon"
  | "waning_gibbous"
  | "last_quarter"
  | "waning_crescent";
export interface MoonPhase {
  ageDays: number;
  illuminationPct: number;
  name: MoonPhaseName;
}
/** One currency's value in units per euro (EUR itself is 1.0). */
export interface CurrencyRate {
  code: string;
  perEur: number;
}
/** A country's emergency numbers; a general number covers all where present. */
export interface EmergencyNumbers {
  general?: string;
  police?: string;
  ambulance?: string;
  fire?: string;
}
/** Practical facts for one country (bundled, serialize-only). */
export interface CountryFacts {
  iso2: string;
  name: string;
  /**
   * Official languages in the order the country lists them, or — where it
   * declares none in law — the language its government works in. English names.
   */
  languages: string[];
  currencyCode: string;
  /** Plug type letters (A–N). */
  plugTypes: string[];
  voltageV: number;
  frequencyHz: number;
  drivesOnLeft: boolean;
  callingCode: string;
  emergency: EmergencyNumbers;
}
/** A dated destination-facts snapshot: place, timezone offset, country, rates. */
export interface DestinationFactsSnapshot {
  placeName: string;
  placeRegion: string;
  latitude: number;
  longitude: number;
  /**
   * Minutes east of UTC at the destination **on the trip's start date** — the
   * fallback for snapshots stored before `timezone` was kept, and the anchor
   * the time difference is measured at. Not a fact about the whole trip: a
   * window spanning a DST transition has two offsets.
   */
  utcOffsetMinutes: number;
  /**
   * The destination's IANA zone id (`Europe/Paris`). Empty on snapshots stored
   * before it was kept, which is why readers fall back to `utcOffsetMinutes`.
   */
  timezone: string;
  /** The origin's IANA zone id, when the origin geocoded. */
  originTimezone?: string;
  /** ISO-3166-1 alpha-2, the key into the bundled country-facts table. */
  countryCode: string;
  /** The ECB reference date the rates carry, verbatim. */
  rateDate: string;
  /** EUR-based rates (EUR = 1.0); empty when the rate source was unreachable. */
  currencyRates: CurrencyRate[];
  retrievedAt: string;
  /** The trip origin's geocoded name, when it resolved (else the gap is unshown). */
  originPlace?: string;
  /** The origin's minutes east of UTC on the trip's dates, paired with utcOffsetMinutes. */
  originUtcOffsetMinutes?: number;
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
  | "flight_overlap"
  | "lodging_overlap"
  | "lodging_gap"
  | "planned_item_overlap"
  /**
   * Two scheduled services overlap and at least one is a surface leg. Named
   * apart from `flight_overlap` so an interface can say "train" when it means
   * train; both are equally impossible.
   */
  | "journey_overlap";
export type ConflictSeverity = "notice" | "warning";
/**
 * How to name a confirmed fact, for the interface to render in its own words.
 *
 * Which identifying detail a fact actually has — a flight number if there is
 * one, otherwise the airports, otherwise nothing — is a rule over the payload
 * and stays in the core. Turning the answer into a noun phrase does not:
 * "Flight AA100" is a sentence fragment in one language.
 */
export type FactLabel =
  | { code: "flight_number"; number: string }
  | { code: "flight_route"; from: string; to: string }
  | { code: "flight" }
  | { code: "lodging_property"; property: string }
  | { code: "lodging" }
  | { code: "journey_service"; mode: TransportMode; service: string }
  | { code: "journey_route"; mode: TransportMode; from: string; to: string }
  | { code: "journey"; mode: TransportMode }
  | { code: "rental_company"; company: string }
  | { code: "rental" };
/**
 * Which surface mode a journey fact runs on. One label family covers three fact
 * types because the identifying rule is the same for all three — a service name
 * if there is one, otherwise the places, otherwise nothing. Only the noun
 * differs, and choosing the noun is this interface's job, not the core's.
 */
export type TransportMode = "rail" | "coach" | "ferry";
export interface ItineraryConflict {
  kind: ItineraryConflictKind;
  severity: ConflictSeverity;
  /**
   * The facts this finding is about, named for the interface to render. Empty
   * for window-level findings like gaps, which carry `startDate`/`endDate`
   * instead — and whether that reads as one night or several is the plural
   * rules' decision, not the core's.
   */
  subjects: FactLabel[];
  /** Confirmed-fact ids involved (sorted); empty for window-level findings like gaps. */
  factIds: string[];
  /** Traveler-authored record ids involved in a planning-only finding. */
  plannedItemIds?: string[];
  /** Titles for a planning-only finding. */
  plannedItemTitles?: string[];
  /** First affected night (ISO YYYY-MM-DD) for date-range findings. */
  startDate?: string;
  /** Last affected night inclusive (ISO YYYY-MM-DD) for date-range findings. */
  endDate?: string;
}
/**
 * What kind of thing a confirmed fact records. Every variant is evidence the
 * traveler approved, never a reservation this product made or can make
 * (ADR-0016 §1).
 */
export type FactType =
  | "flight_segment"
  | "lodging_stay"
  | "rail_journey"
  | "coach_journey"
  | "ferry_crossing"
  | "car_rental";
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
/**
 * Rail, coach and ferry share one shape. They carry the same timestamps a
 * flight does but name their endpoints in words rather than airport codes:
 * there is no IATA for a bus stop, and inventing a code space this product does
 * not own would be a claim about identity it cannot back.
 */
export interface SurfaceJourneyPayload {
  carrierName?: string;
  serviceNumber?: string;
  departurePlace?: string;
  arrivalPlace?: string;
  departureLocal?: string;
  arrivalLocal?: string;
  confirmationCode?: string;
  passengerName?: string;
}
/**
 * A hire car is a journey between two places at two times, so it reads the same
 * departure/arrival pair as pickup and drop-off rather than growing a second
 * pair that would mean the same thing.
 */
export interface CarRentalPayload {
  carrierName?: string;
  vehicleDescription?: string;
  departurePlace?: string;
  arrivalPlace?: string;
  departureLocal?: string;
  arrivalLocal?: string;
  confirmationCode?: string;
  passengerName?: string;
}
export type FactPayload =
  | FlightSegmentPayload
  | LodgingStayPayload
  | SurfaceJourneyPayload
  | CarRentalPayload;
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
/** Traveler notes on one visa document. Counted with {@link countChars}. */
export const MAX_VISA_NOTE_CHARS = 2_000;
export const MAX_QUERY_LEN = 200;
/** The longest custom AI instruction accepted. */
export const MAX_AI_PROMPT_LEN = 6000;
/** One chat message. Counted with {@link countChars}. */
export const MAX_CHAT_MESSAGE_CHARS = 4_000;
/** A resource's title. Counted with {@link countChars}. */
export const MAX_RESOURCE_TITLE_CHARS = 240;
/** The traveler's note on a resource. Counted with {@link countChars}. */
export const MAX_RESOURCE_NOTE_CHARS = 20_000;
/** A saved link's address. Counted with {@link countChars}. */
export const MAX_RESOURCE_URL_CHARS = 2_000;

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

/** Match the ASCII-folded place text used by catalog matching. */
export function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/ß/g, "s")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['`´‘’ʻ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Stable saved-place key shared with the Rust core. It preserves every script,
 * including mixed-script names, and lowercases one scalar at a time so JS's
 * context-sensitive casing cannot disagree with Rust.
 */
export function savedPlaceIdentity(value: string): string {
  let identity = "";
  let separated = true;
  const replacements: Readonly<Record<string, string>> = {
    ß: "s",
    ø: "o",
    æ: "ae",
    œ: "oe",
    ł: "l",
    đ: "d",
    ð: "d",
    þ: "th",
    ı: "i",
    ς: "σ",
  };
  for (const decomposed of value.normalize("NFKD")) {
    for (const character of decomposed.toLowerCase()) {
      if (/^\p{M}$/u.test(character)) continue;
      if (/^['`´‘’ʻ]$/u.test(character)) continue;
      const replacement = replacements[character];
      if (replacement !== undefined) {
        identity += replacement;
        separated = false;
      } else if (/^[\p{L}\p{N}]$/u.test(character)) {
        identity += character;
        separated = false;
      } else if (!separated) {
        identity += " ";
        separated = true;
      }
    }
  }
  identity = identity.trimEnd();
  if (identity) return identity;
  return `codepoints:${[...value]
    .map((character) => character.codePointAt(0)!.toString(16))
    .join("-")}`;
}

/**
 * One unit of `from` in `to`, via the euro, or `null` if either is absent.
 *
 * The ECB feed quotes everything per euro, so a rate between two other
 * currencies is a division. This lived twice — here in the destination-facts
 * panel and as `cross_rate` in the Rust core, whose only caller was a test —
 * with nothing holding the two to the same answer. `parity/trip-facts.json`
 * now does.
 */
export function crossRate(
  rates: CurrencyRate[],
  from: string,
  to: string,
): number | null {
  const perEur = (code: string) =>
    rates.find((rate) => rate.code === code)?.perEur ?? null;
  const a = perEur(from);
  const b = perEur(to);
  if (a === null || b === null) return null;
  return b / a;
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
  /**
   * What these calendar dates have usually been like here. Describes observed
   * history, never a forecast; absent when there is too little of it to say.
   */
  normals?: ClimateNormals;
  /** UV and air quality per trip day; empty when the layer was unavailable. */
  airQuality: AirQualityDay[];
  /**
   * Active official alerts. The US National Weather Service is the only
   * keyless public-domain alert source Voyalier reaches, so an empty list
   * outside the US means "not covered", not "all clear".
   */
  alerts: WeatherAlert[];
}
/**
 * Observed history for the trip's calendar dates.
 *
 * `yearsSampled` and `sampleDays` are on the wire so the interface can show
 * what the claim rests on rather than presenting an average as a fact.
 */
export interface ClimateNormals {
  yearsSampled: number;
  sampleDays: number;
  firstYear: number;
  lastYear: number;
  avgHighC: number;
  avgLowC: number;
  /** Share of sampled days with at least 1 mm of rain. */
  wetDaySharePct: number;
  warmestHighC: number;
  coldestLowC: number;
}
/** One day's UV and air quality. Absent readings are absent, never zero. */
export interface AirQualityDay {
  date: string;
  uvIndexMax?: number;
  usAqiMax?: number;
  pm25Max?: number;
}
/** One active NWS alert, in the source's own words. */
export interface WeatherAlert {
  event: string;
  /** Source-native: Extreme | Severe | Moderate | Minor | Unknown. */
  severity: string;
  headline: string;
  area: string;
  onset?: string;
  ends?: string;
  sender: string;
  url: string;
}
/** What to consider packing. Each maps to one sentence in the catalog. */
export type PackingCode =
  | "warm_layers"
  | "light_clothing"
  | "rain_shell"
  | "sun_protection"
  | "mask"
  | "travel_documents"
  | "laundry";
/** Why a suggestion fired. Each maps to one sentence in the catalog. */
export type PackingReasonCode =
  | "avg_low"
  | "avg_high"
  | "wet_day_share"
  | "uv_index"
  | "aqi"
  | "has_flight"
  | "nights";
/** The reading behind one suggestion, so the reasoning is checkable. */
export interface PackingReason {
  code: PackingReasonCode;
  value?: number;
}
export interface PackingSuggestion {
  code: PackingCode;
  reason: PackingReason;
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
  withheld: WithheldField[];
  /** A citation of what the request is grounded in (e.g. "2 confirmed flights"). */
  groundedIn: string[];
  /** A rough token estimate for cost awareness (not a billing figure). */
  estimatedTokens: number;
}
export type RedactedField =
  "Confirmation codes" | "Traveler names" | "Addresses";
export type WithheldField = RedactedField | "Imported document text";
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
  /**
   * Practical amenities in the pack. Counted from the stored contents on read,
   * so a pack downloaded before the amenities layer shipped reports zero.
   */
  amenityCount: number;
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
  | "catalog"
  | "pack_place"
  | "confirmed_fact"
  | "trip_history"
  | "gazetteer"
  | "airport";
/** One suggested value for a form field, from local data only. */
export interface FieldSuggestion {
  value: string;
  source: SuggestionSource;
  /** A short human note ("from a previous stay"), when useful. */
  detail?: string;
}
/**
 * Fields that support local suggestions: the two lodging fields, and the two
 * flight airport codes (matched on code *or* airport name).
 */
export type SuggestableField =
  "address" | "propertyName" | "departureAirportIata" | "arrivalAirportIata";
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
  packId: string;
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
export interface InterestProfile extends PersonaWeights {
  tripId: string;
  updatedAt?: string;
}
export interface SetInterestProfileInput extends PersonaWeights {
  tripId: string;
}
export interface SavedPlace {
  id: string;
  tripId: string;
  packId: string;
  sourcePackAvailable: boolean;
  name: string;
  category: string;
  dimension: string;
  lat: number;
  lon: number;
  source: string;
  license: string;
  reasons: string[];
  wildcard: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}
export interface SavePlaceInput {
  tripId: string;
  recommendation: Recommendation;
  /** Weights used to derive this recommendation; the service recomputes it. */
  weights: PersonaWeights;
  notes?: string;
}
export interface UpdateSavedPlaceInput {
  savedPlaceId: string;
  notes: string;
}
export interface PackingItem {
  id: string;
  tripId: string;
  label: string;
  checked: boolean;
  suggestionCode?: string;
  createdAt: string;
  updatedAt: string;
}
export interface AddPackingItemInput {
  tripId: string;
  label: string;
  suggestionCode?: string;
}
export interface UpdatePackingItemInput {
  packingItemId: string;
  label: string;
  checked: boolean;
}
export type TripItemKind = "activity" | "rail" | "transfer";
export interface TripItem {
  id: string;
  tripId: string;
  kind: TripItemKind;
  title: string;
  location?: string;
  startAt?: string;
  endAt?: string;
  notes?: string;
  savedPlaceId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface CreateTripItemInput {
  tripId: string;
  kind: TripItemKind;
  title: string;
  location?: string;
  startAt?: string;
  endAt?: string;
  notes?: string;
  savedPlaceId?: string;
}
export interface UpdateTripItemInput extends Omit<
  CreateTripItemInput,
  "tripId"
> {
  tripItemId: string;
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
  /**
   * A confirmed surface departure — rail, coach, ferry, or a hire-car pickup.
   * Distinct from `rail`, which is a traveler-authored *plan*: one is evidence
   * and one is an intention, and they must not merge.
   */
  | "journey_departure"
  /** A confirmed surface arrival, or a hire car going back. */
  | "journey_arrival"
  | "staying_tonight"
  | "activity"
  | "rail"
  | "transfer";
/** One dated entry in the Today view. */
export interface TodayItem {
  kind: TodayItemKind;
  /** Source/traveler text inserted into a localized label when available. */
  subject?: string;
  title: string;
  detail?: string;
  date: string;
  time?: string;
  /** The local record behind this projection; absent on older gateways. */
  target?: {
    source: "confirmed_fact" | "trip_item";
    recordId: string;
  };
}
/** A deterministic "now / next" projection of a trip against the current date. */
export interface TodayView {
  referenceDate: string;
  phase: TripPhase;
  today: TodayItem[];
  next?: TodayItem;
}
/**
 * `resource` is deliberately not folded into `document`: a source document is
 * imported evidence that gets parsed, and a resource is reading material that
 * never is. The interface has to be able to say which one matched.
 */
export type SearchHitSource = "document" | "confirmed_fact" | "resource";
export interface SearchHit {
  source: SearchHitSource;
  factType?: FactType;
  /** Source/traveler text inserted into a localized fact label. */
  subject?: string;
  /** The document or confirmed-fact id, depending on `source`. */
  recordId: string;
  label: string;
  /** Verbatim excerpt around the first match. */
  snippet: string;
  /** Transparent relevance: query-term occurrence count. */
  score: number;
}
export type WorkspaceSearchSource =
  | "document"
  | "confirmed_fact"
  | "note"
  | "saved_place"
  | "trip_item"
  | "resource";
export interface WorkspaceSearchHit {
  source: WorkspaceSearchSource;
  tripId: string;
  tripTitle: string;
  tripStatus: TripStatus;
  tripUpdatedAt: string;
  recordId: string;
  label: string;
  snippet: string;
  score: number;
}
/** How a resource arrived: pasted as a link, or dropped in as a file. */
export type ResourceKind = "link" | "file";

/**
 * A dated copy of what a link said when the traveler asked for it. The same
 * category as any other retrieved snapshot: attributed, able to go stale, and
 * never promoted into evidence.
 */
export interface ResourceSnapshot {
  /** What the page calls itself. */
  title?: string;
  description?: string;
  /** Readable text with script and style content removed. */
  text: string;
  fetchedAt: string;
  contentHash: string;
  /** True when the page ran past the stored limit. */
  truncated: boolean;
}

/**
 * A link or file the traveler deliberately kept with a trip for reading.
 *
 * Reading material, not evidence: it yields no candidate facts and affects no
 * readiness item. See `CONTEXT.md`.
 */
export interface Resource {
  id: string;
  tripId: string;
  kind: ResourceKind;
  /** Present on links. */
  url?: string;
  /** Present on files. */
  fileName?: string;
  title: string;
  note: string;
  tags: string[];
  /** Present once the traveler has fetched the page. */
  snapshot?: ResourceSnapshot;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResourceInput {
  tripId: string;
  kind: ResourceKind;
  url?: string;
  fileName?: string;
  /** Blank derives a readable name from the address. */
  title?: string;
  note?: string;
  tags?: string[];
}

export interface UpdateResourceInput {
  resourceId: string;
  title: string;
  note?: string;
  tags?: string[];
}

/** Standing preferences for research capture. */
export interface ResearchSettings {
  /**
   * Whether saving a link may also fetch what the page says. Off until the
   * traveler turns it on, and reversible at any time.
   */
  autoFetchDetails: boolean;
}

export interface SetResearchSettingsInput {
  autoFetchDetails: boolean;
}

export type ChatRole = "user" | "assistant";

/**
 * A subject Voyalier refuses to be the authority on. The interface answers
 * these itself, above the model's reply — it never suppresses the reply.
 */
export type HighStakesTopic = "entry" | "health" | "safety" | "prices";

/** One record an answer was grounded in. */
export interface ChatGrounding {
  source: SearchHitSource;
  recordId: string;
  label: string;
}

export interface ChatMessage {
  id: string;
  tripId: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  /** Populated on assistant messages. */
  grounding: ChatGrounding[];
  pointers: HighStakesTopic[];
  /** How many confirmed facts formed the itinerary baseline. */
  itineraryFacts: number;
}

/**
 * Where one commitment has to be met after another (ADR-0016 §2).
 *
 * This is exposure, never availability: nothing here knows that another sailing
 * exists, that a seat is free, or that a route is possible. Where a booking
 * agent's "backup route" means *here is another way*, this means *here is what
 * you would have to replace, and how long you would have*.
 */
export type HandoffKind = "connection" | "rental_pickup" | "rental_return";
/**
 * How tight a hand-off is. An app-authored caution, **not** any carrier's
 * minimum connection time — render the minutes, and the band only as the
 * caution it is.
 */
export type HandoffBand =
  "impossible" | "tight" | "short" | "comfortable" | "ample";
export interface Handoff {
  kind: HandoffKind;
  /** What the traveler arrives on. */
  from: FactLabel;
  /** What they then have to make. */
  to: FactLabel;
  fromFactId: string;
  toFactId: string;
  /** Minutes between the two. Negative when the second starts first. */
  slackMinutes: number;
  band: HandoffBand;
  /** When the first commitment ends, in its own local wall clock. */
  at: string;
}
/** A leg other commitments are stacked behind. */
export interface ExposedLeg {
  factId: string;
  label: FactLabel;
  /** How long this leg can run late before the next commitment is missed. */
  absorbsMinutes: number;
  /** How many later commitments sit behind it. */
  dependents: number;
}
/**
 * Something in the workspace worth reaching for, assembled only from evidence
 * and bundled data the traveler already has.
 *
 * Deliberately carries no URL and no phone number: this product does not curate
 * carrier contact channels, because they change constantly and the failure
 * lands on someone standing in a terminal at 23:00 (ADR-0016 §3).
 */
export type FallbackPointer =
  | { code: "carrier_on_confirmation"; carrier: string; factId: string }
  | {
      code: "alternate_airport";
      name: string;
      iata: string;
      distanceKm: number;
    }
  | {
      code: "diplomatic_mission";
      sendingCountry: string;
      city: string;
      kind: MissionKind;
    };
/** Everything the playbook has to say about one trip. Advisory only. */
export interface DisruptionPlan {
  /** Tightest first, then in time order. */
  handoffs: Handoff[];
  /** Least slack first. */
  exposedLegs: ExposedLeg[];
  pointers: FallbackPointer[];
}
/**
 * Which consent-gated snapshot a sweep line is about (ADR-0016 §4).
 *
 * `weather` covers the forecast and the official alerts that ride inside the
 * same snapshot — they are fetched together, so they go stale together.
 */
export type RecheckSource = "advisories" | "weather";
/** One thing that moved, in the source's own words. */
export type RecheckChange =
  | {
      code: "advisory_level";
      source: AdvisorySource;
      from?: string;
      to?: string;
    }
  | { code: "advisory_added"; source: AdvisorySource }
  | { code: "advisory_withdrawn"; source: AdvisorySource }
  | { code: "health_notice_added"; title: string }
  | { code: "health_notice_cleared"; title: string }
  | { code: "alert_raised"; event: string; headline: string }
  | { code: "alert_cleared"; event: string }
  | { code: "forecast_moved"; dayCount: number };
/** What one source did during a sweep. */
export type RecheckOutcome =
  /** Still fresh, so nothing was fetched — reported rather than hidden. */
  | { code: "skipped" }
  /** Nothing stored yet; a first fetch belongs to the panel that owns it. */
  | { code: "never_fetched" }
  | { code: "unchanged" }
  | { code: "changed"; changes: RecheckChange[] }
  /**
   * Could not be read this time. The stored snapshot is kept untouched — a
   * failed re-check must never read as an all-clear.
   */
  | { code: "failed"; reason: string };
export interface RecheckLine {
  source: RecheckSource;
  outcome: RecheckOutcome;
  /** When the snapshot this line is about was last retrieved. */
  previouslyRetrievedAt?: string;
}
/**
 * The result of one explicit sweep. Returned, rendered, and never stored: an
 * answer must not become retrievable later as established knowledge.
 */
export interface RecheckReport {
  tripId: string;
  checkedAt: string;
  lines: RecheckLine[];
  /** Every host this sweep contacted, so the click's reach is visible. */
  hostsContacted: string[];
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
  /**
   * Redacted rail, coach, ferry and hire-car legs in departure order. Its own
   * list rather than a key per mode: whoever reads a brief wants the surface
   * legs together, and the mode is already in the payload's own words.
   */
  journeys: (SurfaceJourneyPayload | CarRentalPayload)[];
  /** Traveler-authored itinerary entries; private notes are excluded. */
  tripItems: BriefTripItem[];
  /** Human-readable list of the field kinds removed from this brief. */
  redactedFields: RedactedField[];
  generatedAt: string;
}
export interface BriefTripItem {
  id: string;
  kind: TripItemKind;
  title: string;
  location?: string;
  startAt?: string;
  endAt?: string;
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
  /**
   * The stored value was found and its plaintext could not be recovered — a
   * wrong or missing vault key, or a row that no longer authenticates. Storage
   * is working; only decryption failed, and no retry can fix it (ADR-0018).
   */
  | "vault/unreadable"
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
/**
 * Visa **preparation**, never visa advice. Per ADR-0006 every factual claim
 * about a requirement is a link, and every sentence Voyalier authors is a
 * translation of the authority's own term or a caution about a common
 * execution mistake. Nothing here decides whether a traveler needs a visa.
 */
export type EntryPath =
  "visaRequired" | "electronicAuthorization" | "exempt" | "unknown";
/** An entry path with where it was read from and when. Quoted, never derived. */
export interface EntryPathQuote {
  path: EntryPath;
  sourceName: string;
  sourceUrl: string;
  curatedAsOf: string;
  /** Content language of the curated prose, so the interface can mark it up. */
  language: string;
}
export interface VisaDocument {
  /** Stable across curation edits — traveler progress is keyed on it. */
  id: string;
  label: string;
  plainExplanation: string;
  /** The specific ways people get this document wrong. */
  gotchas: string[];
  links: SourceLink[];
}
export interface VisaStep {
  id: string;
  /** 1-based, contiguous within a journey. */
  ordinal: number;
  title: string;
  /** What the authority calls this, when its term differs from plain language. */
  authorityTerm?: string;
  plainExplanation: string;
  documents: VisaDocument[];
  links: SourceLink[];
}
export interface VisaJourney {
  destinationIso2: string;
  nationalityIso2: string;
  routeLabel: string;
  entryPath: EntryPathQuote;
  steps: VisaStep[];
  curatedAsOf: string;
  language: string;
}
/**
 * One traveler-owned tick or note. Following ADR-0005 a row exists only after an
 * explicit action — the curated checklist is computed output and never stores
 * itself, exactly as `PackingSuggestion` never becomes a `PackingItem` on its own.
 */
/**
 * The traveler's own tally of visa preparation, attributed to them in the copy
 * that renders it. Voyalier has verified none of it.
 */
export interface VisaSelfReport {
  done: number;
  total: number;
}
export interface VisaPrepItem {
  documentId: string;
  checked: boolean;
  note?: string;
  updatedAt: string;
}
/** The resolved journey and the traveler's progress, always fetched together. */
export interface VisaPrep {
  tripId: string;
  nationalityIso2?: string;
  /**
   * The passport this trip would prefill with, from the traveler's most recent
   * choice on another trip. A suggestion for the picker only — never applied on
   * their behalf, because a trip may not be for them.
   */
  suggestedNationalityIso2?: string;
  /** Absent until a nationality is set. */
  entryPath?: EntryPathQuote;
  /** Absent when the pair is uncurated, conditional, or needs nothing. */
  journey?: VisaJourney;
  /**
   * The universal route map, present exactly when a passport is set, a
   * destination resolved, and no curated journey overrides it. Never both
   * this and `journey`.
   */
  playbook?: VisaPlaybook;
  /**
   * ADR-0014's statistics zone; absent for a destination with no named
   * authority — honest absence, not an error.
   */
  stats?: VisaStatsPanel;
  items: VisaPrepItem[];
  /**
   * The traveler's own country's missions in the destination country, from a
   * bundled Wikidata extract. A pointer and nothing more — render it beside
   * the sending country's own mission list, because closure is recorded
   * unevenly and an address read in an emergency must be confirmed with the
   * ministry that keeps it. Empty means absent from the extract, not absent
   * from the world.
   */
  missions: Mission[];
}
export type MissionKind =
  "embassy" | "consulateGeneral" | "consulate" | "highCommission";
/** One diplomatic mission a country keeps in another country. */
export interface Mission {
  /** ISO-3166-1 alpha-2 of the country whose mission this is. */
  sendingCountry: string;
  /** ISO-3166-1 alpha-2 of the country it sits in. */
  hostCountry: string;
  kind: MissionKind;
  /**
   * The city as Wikidata records it — sometimes a district rather than the
   * city proper, because the location is the finest-grained admin unit held.
   * Empty when nothing usable was recorded.
   */
  city: string;
  latitude: number;
  longitude: number;
}
export interface SetVisaNationalityInput {
  tripId: string;
  /** ISO-3166-1 alpha-2, uppercase. */
  nationalityIso2: string;
}
export interface SetVisaItemProgressInput {
  tripId: string;
  documentId: string;
  checked: boolean;
  note?: string;
}
/**
 * A general route map for a pair Voyalier has not curated. Authored by
 * Voyalier, not read from any authority — the interface says so in those
 * words. Same step shape as a curated journey, so ticks and notes work
 * identically and survive a route later gaining real curation.
 */
export interface VisaPlaybook {
  destinationIso2: string;
  nationalityIso2: string;
  steps: VisaStep[];
  language: string;
}
/**
 * Whether figures came back from the authority in this very call, or from the
 * copy this device kept. Defined by delivery: only the direct return of a
 * successful refresh says "fetched" — a stamp can never look fresher than the
 * fetch behind it.
 */
export type VisaStatsProvenance = "fetched" | "keptCopy";
/** One quoted figure, exactly as the source labels it. */
export interface VisaStatMetric {
  id: string;
  /** The source's own product term for the row. */
  label: string;
  /**
   * The source's own row key when the publication is per-country ("IN") —
   * matched by key equality, never mapped through names.
   */
  audience?: string;
  /** Verbatim, units and all. Never parsed, converted, or averaged. */
  value: string;
}
/**
 * Figures read from one authority at one moment (ADR-0014), with everything a
 * reader needs to check them at the source.
 */
export interface VisaStatsSnapshot {
  destinationIso2: string;
  authorityName: string;
  /** The human page to verify at — never the dataset endpoint. */
  sourceUrl: string;
  /** The source's own reuse terms, rendered beside the figures. */
  attribution: string;
  retrievedAt: string;
  /** The source's own "updated" stamp, where the publication carries one. */
  publishedAt?: string;
  metrics: VisaStatMetric[];
  provenance: VisaStatsProvenance;
}
/** Where one destination authority publishes decision statistics. */
export interface VisaStatsSource {
  destinationIso2: string;
  authorityName: string;
  /** The human page — where the traveler reads the current answer. */
  pageUrl: string;
  /** True only where core carries a parser for a published dataset. */
  fetchable: boolean;
}
/**
 * The statistics zone of the cockpit: the source row always, the snapshot only
 * when this device holds one.
 */
export interface VisaStatsPanel {
  source: VisaStatsSource;
  snapshot?: VisaStatsSnapshot;
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
  /** Place-name suggestions (origin/destination) from the offline gazetteer,
   * pack catalog, and the user's trip history. Not trip-scoped. */
  suggestPlaces(query: string): Promise<FieldSuggestion[]>;
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
  setInterestProfile(input: SetInterestProfileInput): Promise<InterestProfile>;
  savePlace(input: SavePlaceInput): Promise<SavedPlace>;
  updateSavedPlace(input: UpdateSavedPlaceInput): Promise<SavedPlace>;
  deleteSavedPlace(savedPlaceId: string): Promise<void>;
  addPackingItem(input: AddPackingItemInput): Promise<PackingItem>;
  updatePackingItem(input: UpdatePackingItemInput): Promise<PackingItem>;
  deletePackingItem(packingItemId: string): Promise<void>;
  createTripItem(input: CreateTripItemInput): Promise<TripItem>;
  updateTripItem(input: UpdateTripItemInput): Promise<TripItem>;
  deleteTripItem(tripItemId: string): Promise<void>;
  /**
   * The curated journey for the stored nationality plus this trip's saved
   * progress. Returned together so the interface cannot pair a journey with
   * another trip's checkboxes.
   */
  getVisaPrep(tripId: string): Promise<VisaPrep>;
  setVisaNationality(input: SetVisaNationalityInput): Promise<VisaPrep>;
  setVisaItemProgress(input: SetVisaItemProgressInput): Promise<VisaPrep>;
  /**
   * Fetch the destination authority's published processing times, on the
   * traveler's explicit click (ADR-0014 — the click is the consent). Fails
   * loudly; a kept copy survives every failure.
   */
  refreshVisaStats(tripId: string): Promise<VisaPrep>;
  listAdviceCountries(): Promise<FcdoCountry[]>;
  fetchAdvisories(input: FetchAdvisoriesInput): Promise<AdvisoryPanel>;
  fetchWeather(tripId: string): Promise<WeatherSnapshot>;
  /**
   * Refresh whatever the trip has let go stale, and report what moved
   * (ADR-0016 §4). One explicit sweep — no timer, no daemon — reaching only
   * hosts the traveler could already reach panel by panel. A source that is
   * still fresh is skipped; a source that fails keeps its snapshot and says so.
   */
  recheckTrip(tripId: string): Promise<RecheckReport>;
  fetchDestinationFacts(tripId: string): Promise<DestinationFactsSnapshot>;
  /** Fetch the destination country's public holidays (Nager.Date), consent-gated. */
  fetchPublicHolidays(tripId: string): Promise<PublicHolidaysSnapshot>;
  /** Fetch a Wikipedia summary of the destination (Wikimedia REST), consent-gated. */
  fetchPlaceSummary(tripId: string): Promise<PlaceSummary>;
  listResources(tripId: string): Promise<Resource[]>;
  /** Keep a link or file. Saving the same address twice returns the original. */
  createResource(input: CreateResourceInput): Promise<Resource>;
  updateResource(input: UpdateResourceInput): Promise<Resource>;
  deleteResource(resourceId: string): Promise<void>;
  /**
   * Fetch what a saved link says and keep it as a dated snapshot. Refused
   * unless `ResearchSettings.autoFetchDetails` is on — this is the only
   * research method that can reach the network.
   */
  fetchResourceDetails(resourceId: string): Promise<Resource>;
  getResearchSettings(): Promise<ResearchSettings>;
  setResearchSettings(
    input: SetResearchSettingsInput,
  ): Promise<ResearchSettings>;
  listChatMessages(tripId: string): Promise<ChatMessage[]>;
  /**
   * Ask the on-device model one question about this trip, and return its reply.
   *
   * Local only: Ollama answers, and nothing leaves the device. Cloud providers
   * keep the one-shot `previewAssist`/`runAssist` path instead — per-message
   * cloud consent is unusable and a standing one is a trust-contract change.
   */
  sendChatMessage(tripId: string, message: string): Promise<ChatMessage>;
  clearChat(tripId: string): Promise<void>;
  searchTrip(tripId: string, query: string): Promise<SearchHit[]>;
  /** Search traveler-visible local records across every trip. */
  searchWorkspace(query: string): Promise<WorkspaceSearchHit[]>;
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
  mockCountryFacts,
  mockHighStakesTopics,
  mockHolidaysWithin,
  mockNormalizePlace,
  mockPackingList,
  mockQueryTokens,
  mockRankFieldSuggestions,
  mockScoreHaystack,
  mockSuggestPacks,
  mockBuildShareBrief,
  mockBuildTodayView,
  mockTimeDifference,
  mockTippingGuidance,
} from "./mock";
