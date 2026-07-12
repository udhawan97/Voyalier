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
  "method.assisted": "AI-suggested",
  "method.structured.desc":
    "Read from structured data embedded in the document.",
  "method.inferred.desc":
    "Inferred from unstructured text — worth a closer look.",
  "method.manual.desc": "Entered by you.",
  "method.assisted.desc":
    "Drafted by your on-device AI from your imported text — check it before confirming.",
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

  // Guided setup shown when no runtime is detected, and the model cards.
  "localai.setup.lead":
    "Set it up in a few steps — it's free, runs entirely on your device, and stays optional.",
  "localai.step.install.title": "1. Install Ollama",
  // Split around the <a>Ollama</a> link.
  "localai.step.install.before": "Download and install ",
  "localai.step.install.after": " — it's free and runs locally.",
  "localai.step.start.title": "2. Start Ollama",
  "localai.step.start.body":
    "Open the Ollama app. On macOS it lives in your menu bar and usually starts on its own after installing.",
  "localai.step.model.title": "3. Get a model",
  "localai.step.model.body":
    "Pick one below. Copy the command into your terminal, or — once Ollama is running — download it right here.",
  "localai.nomodels.lead":
    "Ollama is running. Add a model to enable optional, private assist.",
  "localai.recommended.aria": "Recommended models",
  "localai.addAnother": "Add another model",
  "localai.card.tag": "Model tag for {model}",
  "localai.card.copy": "Copy command",
  "localai.card.copied": "Copied",
  "localai.card.download": "Download",
  "localai.card.downloading":
    "Downloading… keep the app open (this can take several minutes)",
  "localai.card.needsRunning": "Start Ollama to download from here.",

  "action.checkAgain": "Check again",
  "a11y.opensInNewTab": " (opens in new tab)",
  "a11y.skipToContent": "Skip to content",

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

  "addFact.title": "Add a fact",
  "addFact.description":
    "Enter a flight or a stay by hand. Manual facts are yours and appear in the Blueprint right away.",
  "addFact.submit": "Add to Blueprint",
  "addFact.type": "Type",
  "addFact.typeChoice": "Fact type",
  "addFact.empty": "Add at least one detail before saving.",

  "action.done": "Done",
  "import.title": "Import a document",
  "import.description":
    "Paste a confirmation email or booking page. Voyalier reads it on this device and shows you what it found before anything is saved.",
  "import.submit": "Import",
  "import.error.empty": "Paste some content to import.",
  "import.error.tooLarge":
    "This document is over the 1,000,000 character limit.",
  "import.error.wasEmpty": "The pasted content was empty.",
  "import.duplicate.title": "Already imported",
  "import.duplicate.body":
    "This exact content was imported before{doc}. Edit the content to import something new.",
  "import.duplicate.docSuffix": " (document {id})",
  "import.format": "Format",
  "import.formatChoice": "Document format",
  "import.format.text": "Plain text",
  "import.format.html": "HTML",
  "import.format.email": "Email",
  "import.label": "Label (optional)",
  "import.label.placeholder": "Flight confirmation",
  "import.content": "Content",
  "import.content.placeholder": "Paste your confirmation here…",
  "import.content.placeholder.email":
    "Paste the whole confirmation email — headers and all. Voyalier reads the body and ignores the rest.",
  "import.charcount": "{count} / {max} characters",
  "import.done.title": "Imported",
  "import.done.label": "“{label}” imported.",
  "import.done.none": "No new suggestions were found in this document.",

  "action.close": "Close",
  "brief.title": "Shareable brief",
  "brief.description":
    "A copy you can share. Confirmation codes and traveler names are removed before it leaves this device.",
  "brief.print": "Print / Save as PDF",
  "brief.loading": "Preparing the brief…",
  "brief.flights": "Flights",
  "brief.stays": "Stays",
  "brief.empty":
    "No confirmed flights or stays yet. Confirm some plans to fill the brief.",
  "brief.redaction": "Hidden from this brief: {fields}.",

  "review.title": "Review suggestions",
  "review.description":
    "Voyalier found these in your documents. Nothing is saved until you confirm — check the quoted evidence for each field.",
  "review.announce.confirmed": "Confirmed {fact}.",
  "review.announce.dismissed": "Dismissed {fact}.",
  "review.editnote":
    "Edit any field, then confirm. Changed fields are recorded on the saved fact.",
  "review.evidence": "From the document",
  "review.cancelEdit": "Cancel edit",
  "review.saveConfirm": "Save & confirm",
  "review.confirm": "Confirm",
  "review.editConfirm": "Edit & confirm",
  "review.dismiss": "Dismiss",
  "review.empty.title": "All caught up",
  "review.empty.body": "Every suggestion has been confirmed or dismissed.",

  "providers.title": "AI providers",
  "providers.intro":
    "Bring your own OpenAI or Anthropic key for optional cloud assist. Keys are stored in your device's keychain — never in Voyalier's files or any shared server.",
  "providers.manage": "Manage AI providers",
  "providers.scope":
    "Keys stay in your OS keychain and never leave your device. A key is only used to send a request you preview and choose to send, under “Preview an AI request”.",
  "providers.status.onDevice": "On-device",
  "providers.status.keyStored": "Key stored",
  "providers.status.noKey": "No key",
  "providers.error": "That didn't work — nothing changed.",
  "providers.stored": "API key stored in your keychain.",
  "providers.removeKey": "Remove key",
  "providers.apiKey": "{provider} API key",
  "providers.apiKey.placeholder": "Paste your API key",
  "providers.saveKey": "Save key",
  "providers.onDeviceNote": "Runs locally on this device — no key needed.",
  "providers.model.label": "{provider} model",
  "providers.model.placeholder": "Model (optional)",
  "providers.saveModel": "Save model",
  "providers.announce.keyRemoved": "{provider} key removed.",
  "providers.announce.keySaved": "{provider} key saved.",
  "providers.announce.keyVerified": "{provider} key saved and verified.",
  "providers.announce.keySavedUnverified":
    "{provider} key saved, but it couldn't be verified right now.",
  "providers.announce.modelSaved": "{provider} model saved.",
  "providers.validateSave": "Validate & save",
  "providers.help.summary": "How to get a key",
  "providers.help.intro": "Get an API key from {provider}:",
  "providers.help.step.account": "Sign in or create a {provider} account.",
  // Split around the <a>API keys page</a> link.
  "providers.help.step.create.before": "Open the ",
  "providers.help.step.create.link": "API keys page",
  "providers.help.step.create.after": " and create a new secret key.",
  "providers.help.step.paste": "Paste it above, then choose Validate & save.",

  "packs.suggested.title": "Recommended for this trip",
  "packs.suggested.matchExact": "Matches your destination",
  "packs.suggested.matchAlias": "Matches your destination",
  "packs.suggested.matchPartial": "In this region",
  "packs.suggested.download": "Download {name} city data",
  "packs.suggested.ambiguous": "More than one pack could match — choose one:",
  "packs.suggested.none":
    "No city pack matches “{destination}” yet. Browse all packs below.",
  "packs.suggested.downloaded": "Downloaded for this trip.",
  "packs.suggested.consent":
    "Downloading pulls this pack's data in; nothing about your trip is sent except the request for the pack file.",

  "combobox.listLabel": "{label} suggestions",
  "combobox.available.one": "{count} suggestion available.",
  "combobox.available.other": "{count} suggestions available.",
  "suggest.source.confirmed_fact": "from this trip",
  "suggest.source.trip_history": "from a previous stay",
  "suggest.source.pack_place": "from a city pack",
  "suggest.source.catalog": "city pack",

  "packs.title": "Offline city data",
  "packs.intro":
    "Download local place data and travel notes for a city to use offline. Downloading pulls a pack in from GitHub and stores it on this device for this trip — nothing about your trip is sent. Each pack pairs Overture places with a separate Wikivoyage notes layer, each under its own license.",
  "packs.browse": "Browse city packs",
  "packs.layers.aria": "{name} data layers",
  "packs.remove": "Remove",
  "packs.download": "Download for this trip",
  "packs.scope":
    "Packs are stored on this device for this trip. Downloading pulls data in from GitHub; nothing about your trip is sent.",
  "packs.announce.downloaded": "{name} pack downloaded.",
  "packs.announce.removed": "{name} pack removed.",

  "recs.title": "Recommendations",
  "recs.intro":
    "Ranked picks from a downloaded city pack, weighted by your interests. The scoring is a transparent rule — not a model — and each pick keeps its source and license.",
  "recs.presets.aria": "Persona presets",
  "recs.get": "Get recommendations",
  "recs.list.aria": "Recommended places",
  "recs.wildcard": "wildcard",
  "recs.announce.none": "No recommendations yet.",
  "recs.none":
    "No recommendations yet — download a city pack for this trip (under “Offline city data”), or widen your interests.",
  "recs.scope":
    "Suggestions from open place data — never authoritative for prices, hours, or safety. Nothing leaves your device.",
  "recs.dim.food": "Food",
  "recs.dim.culture": "Culture",
  "recs.dim.nature": "Nature",
  "recs.dim.nightlife": "Nightlife",
  "recs.dim.shopping": "Shopping",
  "recs.preset.balanced": "Balanced",
  "recs.preset.foodie": "Foodie",
  "recs.preset.explorer": "Explorer",

  "advice.title": "Official travel advice",
  "advice.announce.saved": "Official advice for {country} saved.",
  "advice.stale": "Fetched {days} days ago — fetch again before you rely on it",
  "advice.fresh": "Recently fetched",
  "advice.readMore": "Read the full advice on GOV.UK",
  "advice.retrieved": "Retrieved {stamp}",
  "advice.sourceUpdated": "Source updated {stamp}",
  "advice.licence":
    "Written for UK passport holders. Contains public sector information licensed under the Open Government Licence v3.0.",
  "advice.selectLabel": "Country to fetch official advice for",
  "advice.chooseCountry": "Choose a country…",
  "advice.fetchAgain": "Fetch again",
  "advice.fetch": "Fetch official advice",
  "advice.consent":
    "Fetching contacts www.gov.uk once from this device and stores a dated copy locally. Nothing else is sent, and nothing about your trip leaves this device.",

  "weather.title": "Weather outlook",
  "weather.announce.saved": "Weather outlook for {place} saved.",
  "weather.stale":
    "Fetched {hours} hours ago — fetch again for current numbers",
  "weather.fresh": "Recently fetched",
  "weather.rain": "{pct}% rain",
  "weather.coverage.none":
    "Your trip starts beyond the ~16-day forecast horizon, so no days are available yet. Fetch again closer to departure.",
  "weather.coverage.partial":
    "The forecast horizon covers only the first part of your trip. Later days will appear as departure gets closer.",
  "weather.attribution": "Weather data by Open-Meteo.com",
  "weather.retrieved": "Retrieved {stamp}",
  "weather.fetchAgain": "Fetch again",
  "weather.fetch": "Fetch weather outlook",
  "weather.consent":
    "Fetching sends your destination name (“{destination}”) to open-meteo.com to place it on the map, then retrieves the forecast. Nothing else about your trip leaves this device.",

  "assist.title": "Preview an AI request",
  "assist.intro":
    "See exactly what Voyalier would send to a provider for this trip. Confirmation codes and traveler names are never included, and nothing is sent.",
  "assist.provider.ollama": "Ollama (on-device)",
  "assist.provider.openai": "OpenAI",
  "assist.provider.anthropic": "Anthropic",
  "assist.selectLabel": "Provider to preview",
  "assist.preview": "Preview request",
  "assist.announce.previewCloud":
    "Preview ready. This request would leave your device to {provider}.",
  "assist.announce.previewLocal":
    "Preview ready. This request would run locally on this device.",
  "assist.route.cloud": "This request would leave your device to {provider}.",
  "assist.route.local":
    "This request would run locally on this device via {provider}.",
  "assist.model": "Model: {model}",
  "assist.grounded": "Grounded in {sources}",
  "assist.noGrounding": "No confirmed plans to ground in yet",
  "assist.tokens": "~{tokens} tokens",
  "assist.systemInstruction": "System instruction",
  "assist.tripDetails": "Trip details it would include",
  "assist.withheld": "Withheld from the request",
  "assist.send": "Send to {provider}",
  "assist.runLocal": "Run on-device assist",
  "assist.note":
    "This sends the request above to {provider} using your stored key. Add one under AI providers first if you haven’t.",
  "assist.reply": "Reply from {model}",
  "assist.disclaimer":
    "AI-generated from your confirmed plans. Voyalier never treats this as authoritative — verify anything important (entry rules, health, safety) against an official source.",
  "assist.announce.finished": "Assist finished with {model}.",
  "assist.recentRuns": "Recent assist runs",
  "assist.log.aria": "Assist activity log",
  "assist.scope":
    "Preview shows exactly what would be sent. On-device runs stay on this device via Ollama; cloud runs send the previewed request to your chosen provider using your stored key. Each completed run is listed above.",

  "draft.title": "Fill gaps with on-device AI",
  "draft.intro":
    "If a booking you imported has lodging dates that weren't picked up, your on-device AI can propose them from the text. It runs on this device — nothing leaves — and every suggestion is a draft you review before anything is saved.",
  "draft.route": "Runs on this device via Ollama — nothing leaves your device.",
  "draft.preview": "Preview what it reads",
  "draft.reads": "What it would read",
  "draft.instruction": "Instruction",
  "draft.run": "Draft lodging dates",
  "draft.none": "No missing lodging dates were found in your imported text.",
  "draft.needDocs":
    "Import a booking first — there's no text for the AI to read yet.",
  "draft.announce.drafted.one": "Drafted {count} lodging suggestion to review.",
  "draft.announce.drafted.other":
    "Drafted {count} lodging suggestions to review.",
  "draft.scope":
    "On-device only. Voyalier drafts dates from your own imported text; it never invents prices, visas, health, or safety details, and nothing is saved until you review it.",

  // Plural messages (see plural()). ".one"/".other" are the English CLDR forms.
  // The trip-card noun phrases omit the count (it renders bold, separately).
  "tripcard.facts.one": "confirmed fact",
  "tripcard.facts.other": "confirmed facts",
  "tripcard.pending.one": "pending suggestion",
  "tripcard.pending.other": "pending suggestions",
  "localai.running.one":
    "Ollama is running with {count} model installed. Voyalier can use it for optional, private assist — nothing leaves your device.",
  "localai.running.other":
    "Ollama is running with {count} models installed. Voyalier can use them for optional, private assist — nothing leaves your device.",
  "search.matches.one": "{count} match for {query}.",
  "search.matches.other": "{count} matches for {query}.",
  "import.review.one": "Review {count} suggestion",
  "import.review.other": "Review {count} suggestions",
  "import.found.one":
    "Voyalier found {count} new suggestion to review — nothing changes until you confirm.",
  "import.found.other":
    "Voyalier found {count} new suggestions to review — nothing changes until you confirm.",
  "review.count.one": "{count} suggestion to review",
  "review.count.other": "{count} suggestions to review",
  "packs.places.one": "{count} place",
  "packs.places.other": "{count} places",
  "packs.notes.one": "{count} note",
  "packs.notes.other": "{count} notes",
  "packs.offline": "offline",
  "recs.announce.count.one": "{count} recommendation.",
  "recs.announce.count.other": "{count} recommendations.",

  "detail.back": "All trips",
  "detail.loading": "Loading trip…",
  "detail.backToTrips": "Back to trips",
  "detail.status": "Status: ",
  "detail.import": "Import",
  "detail.addFact": "Add a fact",
  "detail.shareBrief": "Share brief",
  "detail.archive": "Archive",
  "detail.delete": "Delete",
  "detail.pending.desc":
    "Confirm or dismiss what Voyalier found in your documents.",
  "detail.nopending": "No suggestions waiting. Import a document to find more.",
  "detail.blueprint": "Blueprint",
  "detail.empty.title": "Your Blueprint is empty",
  "detail.importDocument": "Import a document",
  "detail.empty.body":
    "Confirmed flights and stays land here in itinerary order. Import a confirmation or add a fact by hand to begin.",
  "detail.edited": "Edited before confirming: {fields}",
  "detail.unconfirm": "Unconfirm",
  "detail.announce.archived": "Trip archived.",
  "detail.announce.unconfirmed": "{fact} moved back to review.",
  "detail.announce.added": "{fact} added.",
  "readiness.title": "Readiness",
  "readiness.checkYourself": "Check yourself",
  "readiness.scope":
    "Plan completeness plus official starting points. Voyalier never asserts or clears entry, health, or safety requirements — sourced, dated readiness arrives in a later milestone.",
  "readiness.label.not_checked": "Not started",
  "readiness.label.clear": "On track",
  "readiness.label.monitor": "Worth a look",
  "readiness.label.action_needed": "Needs attention",
  "readiness.label.critical": "Critical",
  "schedule.title": "Schedule check",
  "schedule.clear": "No schedule conflicts found in your confirmed plans.",
  "schedule.conflict": "Conflict",
  "schedule.notice": "Notice",

  "map.title": "Map",
  "map.intro":
    "See your destination and recommended places on a map. Showing it fetches map tiles from OpenFreeMap — an explicit, one-time network request, like the weather outlook. Nothing about your trip is sent.",
  "map.show": "Show map",
  "map.aria": "Trip map",
  "map.scope": "Basemap © OpenFreeMap · map data © OpenStreetMap contributors.",
  "map.scope.empty":
    " Download a city pack and get recommendations to see places here.",

  "theme.label": "Color theme",
  "theme.light": "Light",
  "theme.system": "System",
  "theme.dark": "Dark",

  "dialog.close": "Close dialog",

  "updates.title": "Updates",
  "updates.current": "Version {version}",
  "updates.check": "Check for updates",
  "updates.checking": "Checking for updates…",
  "updates.upToDate": "You're on the latest version ({version}).",
  "updates.consent.title": "Check for updates automatically?",
  "updates.consent.body":
    "Voyalier can check GitHub once a day for new releases. Only release metadata is fetched — nothing about you or your trips is sent.",
  "updates.consent.yes": "Yes, check automatically",
  "updates.consent.no": "No, I'll check manually",
  "updates.available.title": "Update available: {version}",
  "updates.available.body":
    "A new version is ready to download and install. Your trips stay on this device.",
  "updates.install": "Download and install",
  "updates.installWin": "Update and restart",
  "updates.installWin.note":
    "Voyalier will close, update, and reopen (under a minute).",
  "updates.installing": "Downloading update…",
  "updates.installingWin": "Installing — Voyalier will close and reopen.",
  "updates.progress.aria": "Update download progress",
  "updates.progress.percent": "{percent}% downloaded",
  "updates.progress.indeterminate": "Downloading…",
  "updates.skip": "Skip this version",
  "updates.skipped": "You skipped this version.",
  "updates.unskip": "Un-skip",
  "updates.notes.heading": "Notes from GitHub (unverified)",
  "updates.staged.title": "Update installed",
  "updates.staged.body": "Restart Voyalier to finish updating to {version}.",
  "updates.restart": "Restart Voyalier",
  "updates.error.offline": "You're offline. Reconnect and try again.",
  "updates.error.generic":
    "Couldn't check for updates — GitHub may be busy or unreachable.",
  "updates.retry": "Try again",
  "updates.releases": "View releases on GitHub",
  "updates.disabled":
    "This is a development build — in-app updates are disabled.",
  "updates.unsupported.title": "In-app updates aren't available here",
  "updates.unsupported.source":
    "Running from source? Update with git pull, then make bootstrap.",
  "updates.unsupported.download": "Or download the packaged desktop app.",
  "updates.pill.available": "Update available",
  "updates.pill.staged": "Restart to update",
  "updates.autocheck": "Check for updates automatically",
  "updates.clearBackups": "Clear update backups",
  "updates.backupsCleared.one": "Cleared {count} backup.",
  "updates.backupsCleared.other": "Cleared {count} backups.",
  "updates.justUpdated": "Updated to Voyalier {version}.",
  "updates.dismiss": "Dismiss",
} as const;

export type MessageKey = keyof typeof en;

// Distributes over the MessageKey union, keeping only keys with a `.one`
// plural form and stripping the suffix — so `PluralBase` is exactly the set of
// valid `plural()` bases, auto-derived from the catalog. A typo'd base is now a
// compile error (previously `plural(base: string)` silently returned the base).
type PluralBaseOf<K> = K extends `${infer Base}.one` ? Base : never;
export type PluralBase = PluralBaseOf<MessageKey>;

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

const pluralRules = new Map<string, Intl.PluralRules>();

function rulesFor(locale: string): Intl.PluralRules {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules;
}

/**
 * Pick and interpolate a plural message. The locale's CLDR plural rules choose
 * the form — `{base}.{category}` (e.g. `{base}.one` / `{base}.other`) — falling
 * back to `{base}.other`, then to the English source. `count` is always exposed
 * as a `{count}` variable in addition to any passed `vars`.
 */
export function plural(base: PluralBase, count: number, vars?: Vars): string {
  const category = rulesFor(APP_LOCALE).select(count);
  const merged: Vars = { count, ...vars };
  const candidates = [`${base}.${category}`, `${base}.other`];
  for (const locale of localeChain(APP_LOCALE)) {
    const catalog = catalogs[locale] as Record<string, string> | undefined;
    for (const candidate of candidates) {
      const value = catalog?.[candidate];
      if (value != null) return interpolate(value, merged);
    }
  }
  const source = en as Record<string, string>;
  for (const candidate of candidates) {
    if (source[candidate] != null)
      return interpolate(source[candidate], merged);
  }
  return base;
}
