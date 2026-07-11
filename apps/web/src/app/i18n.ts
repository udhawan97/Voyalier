import { APP_LOCALE } from "./locale";

/**
 * Minimal message catalog — the localization-readiness foundation.
 *
 * UI strings are keyed by stable ids, with English as the source of truth today.
 * Additional locales are additive (a partial catalog keyed by the same ids), and
 * lookups fall back along the locale chain to English, so a missing translation
 * never leaves a blank. `{name}` placeholders are interpolated by [[t]].
 *
 * Components move onto `t()` incrementally; the vault UI is the reference. Adding
 * a translated locale later is a data-only change — no component edits.
 */

type Vars = Record<string, string | number>;

// English catalog: the current, canonical copy. Values are verbatim so moving a
// component onto t() changes no rendered text.
const en = {
  "vault.section": "Encryption",
  "vault.inactive":
    "A device keychain isn't available here, so sensitive fields are stored as plaintext and a passphrase can't be added. On macOS and Windows, Voyalier encrypts them automatically.",
  "vault.intro.base":
    "Confirmation codes and traveler names are encrypted on this device.",
  "vault.intro.protected":
    " A passphrase you chose also guards the key — Voyalier asks for it when it launches.",
  "vault.intro.unprotected":
    " Add a passphrase for a second layer that protects your data even on an unlocked computer.",
  "vault.state.on": "Passphrase protection is on.",
  "vault.state.off": "Passphrase protection is off.",
  "vault.currentPassphrase": "Current passphrase",
  "vault.currentPassphrase.placeholder": "Enter your current passphrase",
  "vault.newPassphrase": "New passphrase",
  "vault.newPassphrase.placeholder": "New passphrase ({min}+ characters)",
  "vault.confirmPassphrase": "Confirm passphrase",
  "vault.confirmPassphrase.placeholder": "Confirm passphrase",
  "vault.warn.noRecovery":
    "There is no recovery if you forget it — Voyalier can't reset a passphrase it never stores.",
  "vault.action.add": "Add a passphrase",
  "vault.action.set": "Set passphrase",
  "vault.action.remove": "Remove passphrase",
  "vault.action.cancel": "Cancel",
  "vault.error.tooShort": "Use at least {min} characters.",
  "vault.error.mismatch": "The two passphrases don't match.",
  "vault.error.generic": "That didn't work.",
  "vault.announce.set": "Passphrase set.",
  "vault.announce.removed": "Passphrase removed.",
  "vault.unlock.title": "Your vault is locked",
  "vault.unlock.intro":
    "Enter your passphrase to open this workspace. It's used only on this device to unlock your encrypted trip data.",
  "vault.unlock.passphrase": "Passphrase",
  "vault.unlock.action": "Unlock",
  "vault.unlock.error": "That passphrase didn't work.",

  "error.transport.title": "Local core unreachable",
  "error.transport.body":
    "Voyalier can't reach the local core on this device right now. Your data is safe.",
  "error.storage.title": "Local storage is unavailable",
  "error.storage.body":
    "Voyalier couldn't read or write your local data. Nothing was changed.",
  "error.tripNotFound.title": "This trip is no longer here",
  "error.tripNotFound.body": "It may have been deleted on this device.",
  "error.candidateNotFound.title": "This suggestion is no longer here",
  "error.candidateNotFound.body":
    "It may have already been resolved. Refresh to see the current list.",
  "error.candidateResolved.title": "Already resolved",
  "error.candidateResolved.body":
    "This suggestion was already confirmed or dismissed.",
  "error.factNotFound.title": "This fact is no longer here",
  "error.factNotFound.body": "It may have already been removed.",
  "error.documentEmpty.title": "Nothing to import",
  "error.documentEmpty.body": "The pasted content was empty.",
  "error.documentTooLarge.title": "That document is too large",
  "error.documentTooLarge.body":
    "Documents are limited to 1,000,000 characters.",
  "error.documentDuplicate.title": "Already imported",
  "error.documentDuplicate.body": "This exact document was imported before.",
  "error.adviceFetch.title": "Couldn't reach the official source",
  "error.adviceFetch.body":
    "Voyalier couldn't fetch the advice page right now. Check your connection and try again — nothing was changed.",
  "error.assist.title": "Assist didn't finish",
  "error.assist.body":
    "Voyalier couldn't complete the request. Check the model and your connection (or that your local AI is running), then try again — nothing was changed.",
  "error.packDownload.title": "Couldn't download that city pack",
  "error.packDownload.body":
    "Voyalier couldn't fetch the pack right now. Check your connection and try again — nothing was changed.",
  "error.validation.title": "Check the highlighted fields",
  "error.unexpected.title": "Something went wrong",
  "error.unexpected.body": "An unexpected error occurred. Nothing was changed.",

  "topbar.home": "Voyalier — all trips",
  "health.checking": "Checking local core",
  "health.online": "Local core ready",
  "health.offline": "Local core offline",
  "action.retry": "Retry",
  "action.cancel": "Cancel",

  "deleteTrip.title": "Delete this trip?",
  "deleteTrip.description":
    "This permanently deletes “{title}” and everything in it. This can't be undone.",
  "deleteTrip.confirm": "Delete trip",
  "deleteTrip.confirmLabel": "Type delete to confirm",
  // The word the user must type is intentionally left as the literal "delete".
  "deleteTrip.placeholder": "delete",
  "deleteTrip.hint":
    "Prefer to keep it? Archiving hides the trip without removing anything.",

  "createTrip.title": "Create a trip",
  "createTrip.description":
    "Start with where you're going and when. Everything else can come later.",
  "createTrip.submit": "Create trip",
  "createTrip.origin.label": "From",
  "createTrip.origin.placeholder": "Chicago",
  "createTrip.origin.required": "Enter where the trip starts.",
  "createTrip.destination.label": "To",
  "createTrip.destination.placeholder": "Kyoto",
  "createTrip.destination.required": "Enter where the trip goes.",
  "createTrip.tooLong": "Keep this under 120 characters.",
  "createTrip.startDate": "Start date",
  "createTrip.endDate": "End date",
  "createTrip.dates.required": "Add both a start and end date.",
  "createTrip.dates.order": "The start date must be on or before the end date.",
  "createTrip.name.label": "Trip name (optional)",
  "createTrip.name.hint": "Defaults to “From → To”.",
  "createTrip.name.placeholder": "Kyoto autumn journey",

  "triplist.eyebrow": "Your workspace",
  "triplist.title": "Trips",
  "triplist.create": "Create a trip",
  "triplist.loading": "Loading trips…",
  "triplist.empty.title": "No trips yet",
  "triplist.empty.body":
    "Voyalier turns scattered confirmations and notes into one trustworthy journey — create a trip to begin.",
  "triplist.announce.archived": "{title} archived.",
  "triplist.announce.created": "Trip created: {title}.",
  "triplist.announce.deleted": "{title} deleted.",
  "tripcard.open": "Open {title}",
  "tripcard.archive": "Archive",
  "tripcard.delete": "Delete",

  "status.trip.draft": "Draft",
  "status.trip.active": "Active",
  "status.trip.archived": "Archived",
  "status.candidate.pending": "Pending",
  "status.candidate.confirmed": "Confirmed",
  "status.candidate.rejected": "Rejected",
  "factType.flight": "Flight",
  "factType.stay": "Stay",
  "fact.flightHeadline": "Flight {number}",
  "fact.flightSegment": "Flight segment",
  "fact.lodgingStay": "Lodging stay",
  "method.structured": "Structured",
  "method.inferred": "Inferred",
  "method.manual": "Manual",
  "method.structured.desc":
    "Read from structured data embedded in the document.",
  "method.inferred.desc":
    "Inferred from unstructured text — worth a closer look.",
  "method.manual.desc": "Entered by you.",
  "warning.missing_dates": "No dates were found for this item.",
  "warning.missing_locations": "No locations were found for this item.",
  "warning.ambiguous_date_format":
    "The date format was ambiguous and may be read wrong.",
  "warning.past_date": "This date is in the past.",
  "warning.outside_trip_window": "This falls outside your trip dates.",
  "warning.unrecognized_airport_code": "An airport code wasn't recognized.",
  "field.airlineName": "Airline",
  "field.airlineIata": "Airline code",
  "field.flightNumber": "Flight number",
  "field.departureAirportIata": "From (airport)",
  "field.arrivalAirportIata": "To (airport)",
  "field.departureLocal": "Departs (local)",
  "field.arrivalLocal": "Arrives (local)",
  "field.confirmationCode": "Confirmation code",
  "field.passengerName": "Passenger",
  "field.propertyName": "Property",
  "field.address": "Address",
  "field.checkinDate": "Check-in",
  "field.checkoutDate": "Check-out",
  "field.guestName": "Guest",

  "today.title": "Today",
  "today.phase.tomorrow": "Starts tomorrow",
  "today.phase.upcoming": "Starts in {days} days",
  "today.phase.active": "Day {day} of {total}",
  "today.phase.yesterday": "Ended yesterday",
  "today.phase.completed": "Ended {days} days ago",
  "today.schedule": "Today's schedule",
  "today.empty.active": "Nothing scheduled today.",
  "today.empty.other": "No plans for today.",
  "today.next": "Next",

  "localai.title": "On-device AI",
  "localai.badge.available": "Available",
  "localai.badge.notDetected": "Not detected",
  "localai.precheck":
    "Voyalier can use a local Ollama for optional, private assist — nothing would leave your device. Check whether one is running.",
  "localai.models.aria": "Installed models",
  // Split around the <code> command (which stays a literal).
  "localai.noModels.before":
    "Ollama is running but no models are installed. Pull one (for example ",
  "localai.noModels.after": ") to enable optional on-device assist.",
  // Split around the <a>Ollama</a> link.
  "localai.notDetected.before": "No on-device AI detected. Install ",
  "localai.notDetected.after":
    " to enable optional, private assist. Voyalier stays fully usable without it.",
  "localai.ollama": "Ollama",
  "localai.check": "Check for on-device AI",
  "localai.scope":
    "Detection only — a local check on this device. Assist that uses these models is a later milestone and will always be opt-in.",
  "action.checkAgain": "Check again",
  "a11y.opensInNewTab": " (opens in new tab)",

  "search.title": "Find in this trip",
  "search.label": "Search your documents and confirmed plans",
  "search.placeholder": "Shuttle, confirmation code, hotel…",
  "search.submit": "Search",
  "search.error.empty": "Type something to search for.",
  "search.announce.none": "No matches for {query}.",
  "search.none":
    "No matches for “{query}” in your documents or confirmed plans.",
  "search.results.aria": "Search results",
  "search.hit.document": "imported document",
  "search.hit.confirmed": "confirmed plan",
} as const;

export type MessageKey = keyof typeof en;

// Registry of locales. English is always present; others are added here.
const catalogs: Record<string, Partial<Record<MessageKey, string>>> = { en };

/** "fr-FR" → ["fr-fr", "fr", "en"]; always ends at English. */
function localeChain(locale: string): string[] {
  const parts = locale.toLowerCase().split("-");
  const chain: string[] = [];
  for (let count = parts.length; count > 0; count -= 1) {
    chain.push(parts.slice(0, count).join("-"));
  }
  if (!chain.includes("en")) chain.push("en");
  return chain;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Translate a message key for the active locale, interpolating `{name}` vars.
 * Falls back along the locale chain to the English source, which is exhaustive,
 * so a value is always returned.
 */
export function t(key: MessageKey, vars?: Vars): string {
  for (const locale of localeChain(APP_LOCALE)) {
    const value = catalogs[locale]?.[key];
    if (value != null) return interpolate(value, vars);
  }
  return interpolate(en[key], vars);
}
