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
  "vault.error.generic":
    "That didn't work. Check the passphrase and try again — nothing was changed.",
  "vault.announce.set": "Passphrase set.",
  "vault.announce.removed": "Passphrase removed.",
  "vault.unlock.title": "Your vault is locked",
  "vault.unlock.intro":
    "Enter your passphrase to open this workspace. It's used only on this device to unlock your encrypted trip data.",
  "vault.unlock.passphrase": "Passphrase",
  "vault.unlock.action": "Unlock",
  "vault.unlock.error": "That passphrase didn't work.",
  "vault.unlock.forgot": "Forgot your passphrase?",
  "vault.unlock.forgot.body":
    "There's no recovery, by design — the passphrase is never stored or sent, so Voyalier can't reset it. If you backed up your local data directory before turning the passphrase on, restoring that backup returns you to an unprotected copy. Otherwise the encrypted trip data can't be opened.",

  "error.transport.title": "Voyalier can't reach its engine",
  "error.transport.body":
    "The part of Voyalier that runs on this device isn't responding right now. Your data is safe.",
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
  "error.assistUnreachable.title": "Couldn't reach your AI",
  "error.assistUnreachable.body":
    "Voyalier couldn't reach the AI. If you're using on-device AI, make sure Ollama is running (and a model is pulled), then try again. For a cloud provider, check your connection. Nothing was changed.",
  "error.weatherFetch.title": "Couldn't get the weather outlook",
  "error.packDownload.title": "Couldn't download that city pack",
  "error.packDownload.body":
    "Voyalier couldn't fetch the pack right now. Check your connection and try again — nothing was changed.",
  "error.validation.title": "Check the highlighted fields",
  "error.unexpected.title": "Something went wrong",
  "error.unexpected.body": "An unexpected error occurred. Nothing was changed.",

  "topbar.home": "Voyalier — all trips",
  "health.checking": "Starting up…",
  "health.online": "Ready",
  "health.offline": "Offline",
  "action.retry": "Retry",
  "action.cancel": "Cancel",
  "confirm.arm": "{label} — sure?",

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

  "editTrip.title": "Edit trip",
  "editTrip.description":
    "Fix the destination, dates, or name. Your imported documents, facts, and plans stay.",
  "editTrip.submit": "Save changes",

  "triplist.eyebrow": "Your workspace",
  "triplist.title": "Trips",
  "triplist.create": "Create a trip",
  "triplist.loading": "Loading trips…",
  "triplist.empty.title": "No trips yet",
  "triplist.empty.body":
    "Voyalier turns scattered confirmations and notes into one trustworthy journey — create a trip to begin.",
  "triplist.announce.archived": "{title} archived.",
  "triplist.announce.unarchived": "{title} unarchived.",
  "triplist.announce.created": "Trip created: {title}.",
  "triplist.announce.deleted": "{title} deleted.",
  "triplist.hideArchived": "Hide archived",
  "triplist.allArchived":
    "No active trips — your trips are archived. Show them below to reopen one.",
  "tripcard.open": "Open {title}",
  "tripcard.archive": "Archive",
  "tripcard.unarchive": "Unarchive",
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
  "today.error":
    "Today couldn't load right now. The rest of your trip is fine.",

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
    "Detection runs only on this device. Once a model is installed, the AI features below can use it — always on this device, always your choice.",

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
  "search.hint":
    "Type to search as you go — partial words work, and any word matches. Pick a suggestion, or copy a result to reuse it.",
  "search.error.empty": "Type something to search for.",
  "search.announce.none": "No matches for {query}.",
  "search.none":
    "No matches for “{query}” in your documents or confirmed plans.",
  "search.results.aria": "Search results",
  "search.suggestions.aria": "Search suggestions",
  "search.suggestions.label": "Try:",
  "search.copy": "Copy",
  "search.copied": "Copied",
  "search.copy.aria": "Copy “{value}”",
  "search.announce.copied": "Copied to clipboard.",
  "search.hit.document": "imported document",
  "search.hit.confirmed": "confirmed plan",

  "addFact.title": "Add a flight or stay",
  "addFact.description":
    "Enter a flight or a stay by hand. Manual entries are yours and appear in the Blueprint right away.",
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
  "import.file.label": "Add a file",
  "import.file.button": "Choose a file",
  "import.file.drop": "Drop a file here",
  "import.file.hint":
    "Drop a .eml, .html, or .txt file — or paste the content below. It's read on this device; nothing is uploaded.",
  "import.file.tooLarge": "That file is over the 1,000,000 character limit.",
  "import.file.unreadable": "That file couldn't be read. Try pasting instead.",
  "import.file.loaded": "Loaded “{name}”. Review it below, then import.",
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
  "providers.error": "Couldn't save that — nothing was changed.",
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

  "prompts.title": "Customize AI instructions",
  "prompts.intro":
    "Advanced: change what Voyalier tells the AI. The date draft still only accepts dates, whatever you write here. Loosening the assist instruction can make replies riskier — either way, Voyalier still marks AI replies as not official.",
  "prompts.kind.assist": "Assist & preview instruction",
  "prompts.kind.draft_lodging_dates": "Lodging-date draft instruction",
  "prompts.desc.assist":
    "Used when you preview or run an AI request for a trip.",
  "prompts.desc.draft_lodging_dates":
    "Used when the on-device AI drafts missing lodging dates.",
  "prompts.badge.custom": "Customized",
  "prompts.badge.default": "Default",
  "prompts.save": "Save instruction",
  "prompts.reset": "Reset to default",
  "prompts.error": "Couldn't save that — nothing was changed.",
  "prompts.announce.saved": "{name} saved.",
  "prompts.announce.reset": "{name} reset to default.",
  "prompts.scope":
    "Stored on this device. Applies to future AI requests you make; it never changes what leaves your device beyond the instruction text you see in the preview.",

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
    "Download a city's places and travel notes to use offline. The pack is pulled from GitHub and stored on this device for this trip — nothing about your trip is sent. Each pack pairs Overture places with a separate Wikivoyage notes layer, each under its own license.",
  "packs.browse": "Browse city packs",
  "packs.layers.aria": "{name} data layers",
  "packs.remove": "Remove",
  "packs.download": "Download for this trip",
  "packs.includesOfflineMap":
    "Includes a verified offline map download (about 16 MB).",
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
    "Forecasts only reach about 16 days out, so your trip isn't covered yet. Fetch again closer to departure.",
  "weather.coverage.partial":
    "Forecasts only reach about 16 days out, so only the first part of your trip is covered. Later days will appear as departure gets closer.",
  "weather.attribution": "Weather data by Open-Meteo.com",
  "weather.retrieved": "Retrieved {stamp}",
  "weather.fetchAgain": "Fetch again",
  "weather.fetch": "Fetch weather outlook",
  "weather.consent":
    "Fetching sends your destination name (“{destination}”) to open-meteo.com to place it on the map, then retrieves the forecast. Nothing else about your trip leaves this device.",

  "assist.title": "Preview an AI request",
  "assist.intro":
    "See exactly what Voyalier would send to a provider for this trip. Confirmation codes and traveler names are never included, and nothing is sent.",
  "assist.readonly":
    "This gives you a read-only answer — it won't change your trip. To have the AI fill in lodging dates from a booking you imported, use “Fill gaps with on-device AI” below.",
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
  "assist.grounded": "Based on {sources}",
  "assist.noGrounding": "No confirmed plans to draw on yet",
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
    "AI-generated from your confirmed plans. Voyalier never treats this as authoritative. Verify anything important — entry rules, health, safety — against an official source.",
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
  "triplist.showArchived.one": "Show {count} archived trip",
  "triplist.showArchived.other": "Show {count} archived trips",
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
  "packs.offlineMap": "offline map ready",
  "recs.announce.count.one": "{count} recommendation.",
  "recs.announce.count.other": "{count} recommendations.",

  "detail.back": "All trips",
  "detail.loading": "Loading trip…",
  "detail.backToTrips": "Back to trips",
  "detail.status": "Status: ",
  "detail.import": "Import",
  "detail.edit": "Edit",
  "detail.unarchive": "Unarchive",
  "detail.announce.updated": "Trip updated.",
  "detail.announce.unarchived": "Trip unarchived.",
  "detail.addFact": "Add flight or stay",
  "detail.shareBrief": "Share brief",
  "detail.archive": "Archive",
  "detail.delete": "Delete",
  "detail.pending.desc":
    "Confirm or dismiss what Voyalier found in your documents.",
  "detail.nopending": "No suggestions waiting. Import a document to find more.",
  "detail.blueprint": "Blueprint",
  "detail.blueprint.sub": "Your confirmed flights and stays, in order.",
  "detail.empty.title": "Your Blueprint is empty",
  "detail.importDocument": "Import a document",
  "detail.empty.body":
    "Confirmed flights and stays land here in itinerary order. Import a confirmation or add a fact by hand to begin.",
  "detail.edited": "Edited before confirming: {fields}",
  "detail.unconfirm": "Back to review",
  "detail.remove": "Remove",
  "detail.announce.archived": "Trip archived.",
  "detail.announce.unconfirmed": "{fact} moved back to review.",
  "detail.announce.removed": "{fact} removed.",
  "detail.announce.added": "{fact} added.",
  "readiness.title": "Readiness",
  "readiness.checkYourself": "Check yourself",
  "readiness.scope":
    "This checks how complete your plan is and points you to official sources. Voyalier never asserts or clears entry, health, or safety rules — always confirm those with the official source.",
  "readiness.label.not_checked": "Not started",
  "readiness.label.clear": "On track",
  "readiness.label.monitor": "Check soon",
  "readiness.label.action_needed": "Needs attention",
  "readiness.label.critical": "Critical",

  // Item titles, keyed by ReadinessCheck. The core sends the check id; the words
  // are ours.
  "readiness.check.schedule_conflicts": "Schedule conflicts",
  "readiness.check.lodging_coverage": "Lodging coverage",
  "readiness.check.pending_review": "Suggestions to review",
  "readiness.check.entry_requirements": "Entry & travel requirements",
  "readiness.check.health_notices": "Health notices",

  // Item details, keyed by ReadinessFindingCode. The core sends the finding and
  // its count; pluralization happens here, through Intl.PluralRules.
  "readiness.finding.no_facts_yet":
    "Add flights or stays to check for overlaps.",
  "readiness.finding.schedule_conflicts.one":
    "{count} scheduling conflict to resolve.",
  "readiness.finding.schedule_conflicts.other":
    "{count} scheduling conflicts to resolve.",
  "readiness.finding.schedule_notices.one":
    "{count} scheduling notice to review.",
  "readiness.finding.schedule_notices.other":
    "{count} scheduling notices to review.",
  "readiness.finding.schedule_clear": "No overlaps in your confirmed plans.",
  "readiness.finding.no_lodging_yet": "No lodging added yet.",
  "readiness.finding.lodging_gaps":
    "Some nights in your trip have no lodging booked.",
  "readiness.finding.lodging_clear": "Every night of your trip has lodging.",
  "readiness.finding.pending_review.one":
    "{count} imported suggestion waiting for review.",
  "readiness.finding.pending_review.other":
    "{count} imported suggestions waiting for review.",
  "readiness.finding.nothing_pending": "Nothing is waiting for review.",

  // A link-only item asserts nothing, so its text describes the check rather
  // than a finding — keyed by ReadinessCheck, not ReadinessFindingCode.
  "readiness.linkOnly.entry_requirements":
    "Requirements depend on your nationality and change often. Confirm them at an official government source before you travel — Voyalier links to official sources and never asserts or clears entry rules.",
  "readiness.linkOnly.health_notices":
    "Vaccination and health advice depends on your destination and health, and changes often. Check an official source before you travel — Voyalier links to official sources and never gives medical advice.",
  "schedule.title": "Schedule check",
  "schedule.clear": "No schedule conflicts found in your confirmed plans.",
  "schedule.conflict": "Conflict",
  "schedule.notice": "Notice",

  "map.title": "Map",
  "map.intro":
    "See your destination and recommended places on a map. A downloaded offline basemap stays on this device; otherwise showing the map fetches tiles from OpenFreeMap. Nothing about your trip is sent.",
  "map.show": "Show map",
  "map.aria": "Trip map",
  "map.scope": "Basemap © OpenFreeMap · map data © OpenStreetMap contributors.",
  "map.scope.offline":
    "Offline basemap from {source} · map data © OpenStreetMap contributors. No tile request left this device.",
  "map.scope.empty":
    " Download a city pack and get recommendations to see places here.",
  "map.error.load":
    "The map couldn't start here. Everything else on your trip still works.",
  "map.error.webgl":
    "This device or browser can't show the map (no WebGL). Everything else on your trip still works.",

  "theme.label": "Color theme",
  "theme.light": "Light",
  "theme.system": "System",
  "theme.dark": "Dark",

  "settings.title": "Settings",
  "settings.intro":
    "Everything here applies to Voyalier as a whole, not to one trip.",
  "settings.appearance": "Appearance",
  "settings.appearance.hint":
    "System follows whatever your computer is set to.",
  "settings.back": "Back",
  "topbar.settings": "Settings",
  "assist.needsSetup": "Set up AI in Settings to use this.",
  "assist.needsSetup.link": "Open Settings",

  "sample.explore": "Explore a sample trip",
  "sample.hint": "Made-up data you can delete. Nothing is sent anywhere.",
  "sample.building": "Building it…",
  "sample.error": "Couldn't build the sample trip.",
  // "Sample:" stays in the title so it is never mistaken for a real booking.
  "sample.title": "Sample: Kyoto long weekend",
  "sample.origin": "San Francisco",
  "sample.destination": "Kyoto",
  "sample.document": "Sample confirmation email",

  "notes.title": "Notes",
  "notes.intro":
    "Anything you want to remember: half-made plans, a restaurant someone mentioned, what to book next.",
  // Stated because it is a real guarantee, not a nicety: the brief and every AI
  // request are built from the trip and its confirmed facts, and notes are
  // neither, so they cannot reach either one.
  "notes.excluded":
    "Kept on this device and encrypted. Never included in a shared brief or sent to an AI provider.",
  "notes.label": "Trip notes",
  "notes.placeholder": "Start typing…",
  "notes.saving": "Saving…",
  "notes.saved": "Saved",
  "notes.error": "Couldn't save your notes — they're still here, untouched.",
  "notes.tooLong": "That's longer than Voyalier can store. Nothing was saved.",

  "ics.export": "Export calendar",
  "ics.exporting": "Preparing…",
  "ics.error": "Couldn't build the calendar file.",
  "ics.done": "Calendar file saved.",
  "ics.summary.flight": "Flight {flight}",
  "ics.summary.stay": "Stay — {property}",
  // Said inside every exported event, because the file outlives this screen and
  // the caveat has to travel with it.
  "ics.description":
    "Exported from Voyalier. Times are as printed on your confirmation, with no timezone — Voyalier doesn't guess one, so your calendar shows them in its own local time. Confirmation codes and traveler names are not included.",

  "documents.title": "Imported documents",
  "documents.intro":
    "The confirmations you brought in. Voyalier keeps the original text so you can check what it read — and remove it whenever you like.",
  "documents.empty": "Nothing imported yet.",
  "documents.empty.hint":
    "Import a confirmation and the original will be kept here.",
  "documents.error": "Couldn't load your documents.",
  "documents.imported": "Imported {date}",
  "documents.size.one": "{count} character",
  "documents.size.other": "{count} characters",
  "documents.counts.pending.one": "{count} awaiting review",
  "documents.counts.pending.other": "{count} awaiting review",
  "documents.counts.confirmed.one": "{count} confirmed",
  "documents.counts.confirmed.other": "{count} confirmed",
  "documents.view": "Show original",
  "documents.hide": "Hide original",
  "documents.viewError": "Couldn't open that document.",
  "documents.remove": "Remove",
  "documents.removeError": "Couldn't remove that document.",
  "documents.removed": "Removed {label}.",
  // Said before deleting, because the consequences differ per candidate state
  // and the user should not have to guess which of their facts survive.
  "documents.removeWarning.pending.one":
    "Its suggestion still awaiting review goes too.",
  "documents.removeWarning.pending.other":
    "Its {count} suggestions still awaiting review go too.",
  "documents.removeWarning.confirmed":
    "Facts you already confirmed from it stay on your trip, but lose their evidence.",
  "documents.sourceRemoved": "Source document removed",
  "documents.kind.pasted_text": "Pasted text",
  "documents.kind.html": "HTML",
  "documents.kind.email": "Email",

  "tripnav.label": "Jump to a section",
  "tripnav.plan": "Plan",
  "tripnav.prepare": "Prepare",
  "tripnav.discover": "Discover",
  "tripnav.ai": "AI",

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
    "Running from source? Update from the repository: git pull, then make bootstrap.",
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
