import { APP_LOCALE } from "./locale";

/**
 * Exhaustive English and Spanish message catalogs.
 *
 * English remains the source of truth, while `Record<MessageKey, string>` makes
 * every shipped locale provide every UI key. Source and traveler-authored text
 * stays unchanged; named `{name}` placeholders are interpolated by `t()`.
 */

type Vars = Record<string, string | number>;

// English catalog: the current, canonical copy. Values are verbatim so moving a
// component onto t() changes no rendered text.
const en = {
  "backup.section": "Back up & restore",
  "backup.intro":
    "Save your whole workspace — trips, imported confirmations, and offline packs — to a single encrypted file you can keep somewhere safe or move to another computer.",
  "backup.unsupported":
    "Backing up needs the desktop app, which is where your data actually lives. In a browser there is no local database to save.",
  "backup.export.title": "Save a backup",
  "backup.export.hint":
    "You choose a passphrase for the file. It travels with the backup, so the same file opens on any computer.",
  "backup.export.action": "Save a backup",
  "backup.export.confirm": "Save backup",
  "backup.export.done": "Backup saved to {path}",
  "backup.export.cancelled": "No backup was saved.",
  "backup.warn.noRecovery":
    "There is no recovery if you lose this passphrase — the backup is unreadable without it, and Voyalier never stores it.",
  "backup.excludes":
    "Downloaded maps and your AI provider keys are not included: maps can be downloaded again, and the keys stay in this computer's keychain rather than travelling in a file.",
  "backup.restore.title": "Restore a backup",
  "backup.restore.hint":
    "Restoring replaces everything currently in Voyalier with the contents of the backup. Your current data is snapshotted first, so this can be undone.",
  "backup.restore.action": "Restore from a backup",
  "backup.restore.confirm": "Restore this backup",
  "backup.restore.cancelled": "No backup was restored.",
  "backup.restore.staged":
    "Ready to restore a backup from {date}. Quit and reopen Voyalier to finish — nothing has changed yet.",
  "backup.restore.pending":
    "A restore is waiting. Quit and reopen Voyalier to finish it.",
  "backup.passphrase": "Backup passphrase",
  "backup.passphrase.placeholder": "Backup passphrase ({min}+ characters)",
  "backup.confirmPassphrase": "Confirm backup passphrase",
  "backup.confirmPassphrase.placeholder": "Confirm backup passphrase",
  "backup.error.tooShort": "Use at least {min} characters.",
  "backup.error.mismatch": "Those passphrases don't match.",
  "backup.error.newerVersion":
    "This backup was made by a newer version of Voyalier. Update the app, then restore it again.",
  "backup.error.generic": "That didn't work. Please try again.",
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
  "error.weatherFetch.body":
    "Check the destination and your connection, then try again.",
  "error.packDownload.title": "Couldn't download that city pack",
  "error.packDownload.body":
    "Voyalier couldn't fetch the pack right now. Check your connection and try again — nothing was changed.",
  "error.validation.title": "Check the highlighted fields",
  "error.validation.body": "Check the entered values and try again.",
  "tripFieldError.origin": "Enter a valid trip origin.",
  "tripFieldError.destination": "Enter a valid trip destination.",
  "tripFieldError.dateRange": "Use a valid date range with the start first.",
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
  "tripcard.toReview": "to review",

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
  "today.item.depart": "Depart — {subject}",
  "today.item.departGeneric": "Flight departure",
  "today.item.arrive": "Arrive — {subject}",
  "today.item.arriveGeneric": "Flight arrival",
  "today.item.checkin": "Check in — {subject}",
  "today.item.checkinGeneric": "Check in",
  "today.item.checkout": "Check out — {subject}",
  "today.item.checkoutGeneric": "Check out",
  "today.item.staying": "Staying at {subject}",
  "today.item.stayingGeneric": "Staying tonight",
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
  "localai.card.downloaded": "Downloaded {model}.",
  "localai.card.downloadFailed":
    "Couldn't download that model. Check Ollama and try again.",
  "localai.model.gemma.blurb":
    "Balanced quality — a strong all-rounder for most machines.",
  "localai.model.qwen.blurb":
    "Lighter and faster — a good pick for modest laptops.",

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
  "search.label.flight": "Flight {subject}",
  "search.label.flightGeneric": "Flight",
  "search.label.stayGeneric": "Stay",

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
  "brief.plans": "Activities & transfers",
  "brief.empty":
    "No confirmed flights or stays yet. Confirm some plans to fill the brief.",
  "brief.redaction": "Hidden from this brief: {fields}.",
  "contract.redacted.confirmationCodes": "Confirmation codes",
  "contract.redacted.travelerNames": "Traveler names",
  "contract.redacted.addresses": "Addresses",
  "contract.withheld.importedDocumentText": "Imported document text",

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
  "providers.keyRejected": "That API key was rejected. Check it and try again.",
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
  "suggest.source.gazetteer": "city",

  "packs.title": "Offline city data",
  "packs.intro":
    "Download a city's places and travel notes to use offline. The pack is pulled from GitHub and stored on this device for this trip — nothing about your trip is sent. Each pack pairs Overture places with a separate Wikivoyage notes layer, each under its own license.",
  "packs.browse": "Browse city packs",
  "packs.layers.aria": "{name} data layers",
  "packs.remove": "Remove",
  "packs.download": "Download for this trip",
  "packs.includesOfflineMap":
    "Includes a verified offline map download; size varies by city.",
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
  "recs.reason.interest": "Matches your interest in {dimension}",
  "recs.reason.wildcard": "A change of pace from your top picks",
  "recs.preset.balanced": "Balanced",
  "recs.preset.foodie": "Foodie",
  "recs.preset.explorer": "Explorer",
  "recs.save": "Save place",
  "recs.savedAlready": "Saved",
  "recs.saved": "Saved {name} to this trip.",
  "recs.interests.save": "Save interests",
  "recs.interests.unsaved": "Interests not saved",
  "recs.interests.saved": "Interests saved",

  "planning.saved.title": "Saved places",
  "planning.saved.intro":
    "Your shortlist keeps the source, license, and reasons captured when you saved it. Adding one to the plan is always a separate choice.",
  "planning.saved.empty": "No saved places yet.",
  "planning.saved.packRemoved": "source pack removed",
  "planning.saved.notes": "Private notes",
  "planning.saved.saveNotes": "Save notes",
  "planning.saved.addToPlan": "Add to plan",
  "planning.saved.promoted": "Added {name} to the plan.",
  "planning.saved.prefilled": "Ready to add {name}; review the plan first.",
  "planning.saved.addToPlanLabel": "Add {name} to plan",
  "planning.saved.saveNotesLabel": "Save notes for {name}",
  "planning.remove": "Remove",
  "planning.removeNamed": "Remove {name}",
  "planning.packing.title": "Packing checklist",
  "planning.packing.intro":
    "Suggestions stay suggestions until you add them. Once added, weather updates never change or remove your checklist.",
  "planning.packing.custom": "Custom item",
  "planning.packing.add": "Add",
  "planning.packing.added": "Added",
  "planning.packing.nameLabel": "Packing item name",
  "planning.packing.renameLabel": "Rename {name}",
  "planning.packing.saveLabel": "Save packing item",
  "planning.items.title": "Activities & transfers",
  "planning.items.intro":
    "Add plans you entered yourself. They are shown as traveler-authored plans, never as confirmed bookings.",
  "planning.items.kind": "Type",
  "planning.items.activity": "Activity",
  "planning.items.rail": "Rail",
  "planning.items.transfer": "Transfer",
  "planning.items.name": "Name",
  "planning.items.location": "Location (optional)",
  "planning.items.start": "Start (optional)",
  "planning.items.end": "End (optional)",
  "planning.items.notes": "Private notes (optional)",
  "planning.items.add": "Add to plan",
  "planning.items.edit": "Edit",
  "planning.items.editLabel": "Edit {name}",
  "planning.items.removeLabel": "Remove {name}",
  "planning.items.save": "Save changes",
  "topbar.search": "Search workspace",
  "workspaceSearch.back": "All trips",
  "workspaceSearch.title": "Search workspace",
  "workspaceSearch.intro":
    "Search imported documents, confirmed facts, notes, saved places, and traveler-authored plans across every trip. Pending suggestions stay out until you confirm them.",
  "workspaceSearch.label": "Search all trips",
  "workspaceSearch.placeholder": "Search all trips",
  "workspaceSearch.search": "Search",
  "workspaceSearch.none": "No matches in this workspace.",
  "workspaceSearch.source.document": "Source document",
  "workspaceSearch.source.confirmed_fact": "Confirmed fact",
  "workspaceSearch.source.note": "Trip notes",
  "workspaceSearch.source.saved_place": "Saved place",
  "workspaceSearch.source.trip_item": "Traveler-authored plan",
  "workspaceSearch.archived": "Archived trip",
  "workspaceSearch.updated": "Trip updated {date}",
  "workspaceSearch.label.confirmedFact": "Confirmed fact",
  "workspaceSearch.label.note": "Trip notes",
  "dataSources.title": "Data sources & licenses",
  "dataSources.intro":
    "See what Voyalier uses, when a network request happens, the required attribution, and what each source can — and cannot — establish.",
  "dataSources.show": "Show all data sources",
  "dataSources.use": "Used for:",
  "dataSources.license": "License / terms:",
  "dataSources.endpoint": "Endpoint:",
  "dataSources.group.builtIn": "Built into the app",
  "dataSources.group.consentFetched": "Fetched with consent",
  "dataSources.group.offlineDownloads": "Offline downloads",
  "dataSources.group.optionalAi": "Optional AI",
  "dataSources.uk-fcdo.use": "Official travel advice",
  "dataSources.uk-fcdo.network":
    "Fetched only when you request official advice",
  "dataSources.uk-fcdo.authority":
    "Official UK government advice; written for UK nationals",
  "dataSources.us-state.use": "Official travel advisories",
  "dataSources.us-state.network":
    "Fetched only when you request official advice",
  "dataSources.us-state.authority":
    "Official U.S. government advice; written for U.S. nationals",
  "dataSources.ca-gac.use": "Official travel advisories",
  "dataSources.ca-gac.network": "Fetched only when you request official advice",
  "dataSources.ca-gac.authority":
    "Official Canadian government advice; written for Canadian nationals",
  "dataSources.de-aa.use": "Official travel advisories",
  "dataSources.de-aa.network": "Fetched only when you request official advice",
  "dataSources.de-aa.authority":
    "Official German government advice; source wording may remain German",
  "dataSources.us-cdc.use": "Travel health notices",
  "dataSources.us-cdc.network": "Fetched with the official-advice panel",
  "dataSources.us-cdc.authority":
    "Official U.S. public-health notices; informational, not personal medical advice",
  "dataSources.open-meteo.use":
    "Geocoding, weather, climate normals, and air quality",
  "dataSources.open-meteo.network":
    "Fetched only when you request a weather or destination snapshot",
  "dataSources.open-meteo.authority":
    "Forecast and historical observations; never safety or itinerary authority",
  "dataSources.nws.use": "Active U.S. weather alerts near a destination",
  "dataSources.nws.network":
    "Fetched with a requested weather snapshot for U.S. coordinates",
  "dataSources.nws.authority":
    "Official alert feed; timestamps and source wording remain visible",
  "dataSources.ecb.use": "Reference exchange rates",
  "dataSources.ecb.network": "Fetched with destination facts",
  "dataSources.ecb.authority":
    "Reference rates, not a quoted retail conversion price",
  "dataSources.nager-date.use": "Public holidays",
  "dataSources.nager-date.network": "Fetched only when you request holidays",
  "dataSources.nager-date.authority":
    "Informational calendar data; never entry or closure authority",
  "dataSources.wikimedia.use": "Destination summaries",
  "dataSources.wikimedia.network":
    "Fetched only when you request an about-place summary",
  "dataSources.wikimedia.authority":
    "Community-written context; never safety, price, or opening-hours authority",
  "dataSources.openfreemap.use": "Online map style and vector tiles",
  "dataSources.openfreemap.network":
    "Fetched only after you select Show map without an offline basemap",
  "dataSources.openfreemap.authority":
    "Visual map context with no routing, live-access, or availability claim",
  "dataSources.overture.use": "Offline city-pack places",
  "dataSources.overture.network":
    "Downloaded only when you request a city pack",
  "dataSources.overture.authority":
    "Open place data; recommendations do not assert live hours, prices, or availability",
  "dataSources.wikivoyage.use": "Offline city travel notes",
  "dataSources.wikivoyage.network":
    "Downloaded only when you request a city pack",
  "dataSources.wikivoyage.authority":
    "Community-written travel context; shown separately from place data",
  "dataSources.protomaps-osm.use": "Offline maps",
  "dataSources.protomaps-osm.network":
    "Downloaded only when you request a city pack's offline map",
  "dataSources.protomaps-osm.authority":
    "Basemap context; not routing, access, or opening-hours authority",
  "dataSources.geonames.use": "Bundled city autocomplete",
  "dataSources.geonames.network": "Bundled with the app; no runtime request",
  "dataSources.geonames.authority": "Place-name autocomplete only",
  "dataSources.ourairports.use": "Bundled nearest-airport lookup",
  "dataSources.ourairports.network": "Bundled with the app; no runtime request",
  "dataSources.ourairports.authority":
    "Geographic airport proximity only; not flight availability",
  "dataSources.wikidata-heritage.use": "Bundled World Heritage site lookup",
  "dataSources.wikidata-heritage.network":
    "Bundled with the app; no runtime request",
  "dataSources.wikidata-heritage.authority":
    "Convenience lookup from a dated extract; not a complete UNESCO registry",
  "dataSources.ollama.use": "Optional on-device AI assistance",
  "dataSources.ollama.network":
    "Called only after preview and explicit consent; requests stay on localhost",
  "dataSources.ollama.authority":
    "Draft assistance only; never a second forecast or booking authority",
  "dataSources.openai.use": "Optional bring-your-own-key cloud assistance",
  "dataSources.openai.network":
    "The exact redacted preview is sent only after explicit consent",
  "dataSources.openai.authority":
    "Draft assistance only; output remains untrusted and evidence-bound",
  "dataSources.anthropic.use": "Optional bring-your-own-key cloud assistance",
  "dataSources.anthropic.network":
    "The exact redacted preview is sent only after explicit consent",
  "dataSources.anthropic.authority":
    "Draft assistance only; output remains untrusted and evidence-bound",

  "advice.title": "Official travel advice",
  "advice.announce.saved": "Official advice for {country} saved.",
  "advice.stale": "Fetched {days} days ago — fetch again before you rely on it",
  "advice.fresh": "Recently fetched",
  "advice.readMore": "Read the full advice at the source",
  "advice.retrieved": "Retrieved {stamp}",
  "advice.sourceUpdated": "Source updated {stamp}",
  // Each government writes for its own citizens and uses its own scale, so the
  // panel says so once rather than implying the four cards are comparable.
  "advice.crossSource":
    "Each government writes for its own citizens and uses its own wording and levels. Compare the sources, not the numbers.",
  "advice.healthNotices": "Health notices (US CDC)",
  "advice.healthNotices.licence":
    "Travel health notices from the U.S. Centers for Disease Control and Prevention (public domain). Informational only.",
  "advice.status.kept":
    "{source}: could not be reached — showing the last saved copy",
  "advice.status.unavailable": "{source}: not available right now",
  "advice.status.notPublished":
    "{source} does not publish advice for this destination",
  "advice.selectLabel": "Country to fetch official advice for",
  "advice.chooseCountry": "Choose a country…",
  "advice.fetchAgain": "Fetch again",
  "advice.fetch": "Fetch official advice",
  "advice.consent":
    "Fetching contacts the UK, US, Canadian, and German government sources and the US CDC once from this device, and stores a dated copy locally. Nothing about your trip leaves this device.",

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
    "Fetching sends your destination name (“{destination}”) to open-meteo.com to place it on the map, then retrieves the forecast, the history for your dates, and the air quality. For US destinations it also asks the National Weather Service for active alerts. Nothing else about your trip leaves this device.",

  "facts.title": "Destination facts",
  "facts.fetch": "Fetch destination facts",
  "facts.fetchAgain": "Fetch again",
  "facts.consent":
    "Fetching sends your destination (“{destination}”) and your origin place name to open-meteo.com to place them on the map, and asks the European Central Bank for today’s reference rates. The time difference, sun, moon, country facts and nearest airports are worked out on this device. Nothing else about your trip leaves it.",
  "facts.retrieved": "Retrieved {stamp}",
  // Clock: the destination-vs-home time gap, computed offline from two offsets.
  "facts.clock.title": "Time difference",
  "facts.clock.ahead": "{destination} is {duration} ahead of {origin}",
  "facts.clock.behind": "{destination} is {duration} behind {origin}",
  "facts.clock.same": "{destination} keeps the same time as {origin}",
  "facts.clock.hours": "{hours}h",
  "facts.clock.hoursMinutes": "{hours}h {minutes}m",
  // Sky: computed offline, so it carries no source and cannot be stale.
  "facts.sky.title": "Sky",
  "facts.sky.sun": "{sunrise} – {sunset}",
  "facts.sky.dayLength": "{hours}h {minutes}m of daylight",
  "facts.polar.day": "Midnight sun — the sun does not set",
  "facts.polar.night": "Polar night — the sun does not rise",
  "facts.sky.moon": "{phase} · {pct}% lit",
  // Money: a reference rate, never a card or ATM rate.
  "facts.money.title": "Money",
  "facts.money.rate": "1 {from} = {value} {to}",
  "facts.money.indicative":
    "European Central Bank reference rates for {date} — indicative, not the rate your card or an ATM will give.",
  "facts.money.noRate":
    "No published reference rate for {currency}. Check locally before you travel.",
  // Practical: convenience facts; the card links out rather than asserting.
  "facts.practical.title": "Practical",
  "facts.practical.plug": "Plugs {types} · {voltage} V · {frequency} Hz",
  "facts.practical.driveLeft": "Drives on the left",
  "facts.practical.driveRight": "Drives on the right",
  "facts.practical.calling": "Calling code {code}",
  "facts.practical.emergency": "Emergency {number}",
  "facts.practical.emergencyServices":
    "Police {police} · Ambulance {ambulance} · Fire {fire}",
  "facts.practical.none":
    "Voyalier does not carry practical facts for this destination yet.",
  // Tipping: a hand-curated rough guide; customs vary, so it never asserts a rule.
  "facts.tipping.title": "Tipping",
  "facts.tipping.note":
    "A rough guide — customs vary and change; when unsure, a little or nothing is rarely wrong.",
  // Nearest airports: bundled + computed offline. Distance is a fact; Voyalier
  // does not say which airport is "best".
  "facts.airports.title": "Nearest airports",
  "facts.airports.row": "{iata} · {name}",
  "facts.airports.distance": "{km} km",
  // World Heritage: bundled from Wikidata, computed offline. A nearby-notable
  // list, never a claim of completeness.
  "facts.heritage.title": "World Heritage nearby",
  "facts.heritage.rowYear": "{name} · inscribed {year}",
  // Public holidays: fetched from Nager.Date, informational — banks and shops
  // may close; it never clears a readiness item.
  "holidays.title": "Public holidays",
  "holidays.fetch": "Fetch public holidays",
  "holidays.fetchAgain": "Fetch again",
  "holidays.retrieved": "Retrieved {stamp}",
  "holidays.nameLocal": "{name} ({localName})",
  "holidays.regional": "· regional",
  "holidays.none": "No public holidays fall in {country} during your trip.",
  "holidays.consent":
    "Fetching sends your destination name (“{destination}”) to open-meteo.com to place it in a country, then asks Nager.Date for that country’s public holidays. Nothing else about your trip leaves it.",
  // About this place: Wikipedia prose, shown under CC BY-SA with attribution.
  "about.title": "About this place",
  "about.fetch": "Fetch a summary",
  "about.fetchAgain": "Fetch again",
  "about.retrieved": "Retrieved {stamp}",
  "about.attribution": "Summary from Wikipedia, licensed CC BY-SA.",
  "about.readMore": "Read more about {title} →",
  "about.consent":
    "Fetching asks Wikipedia (en.wikipedia.org) for a short summary of “{destination}”. Nothing else about your trip leaves it.",
  "moon.new_moon": "New moon",
  "moon.waxing_crescent": "Waxing crescent",
  "moon.first_quarter": "First quarter",
  "moon.waxing_gibbous": "Waxing gibbous",
  "moon.full_moon": "Full moon",
  "moon.waning_gibbous": "Waning gibbous",
  "moon.last_quarter": "Last quarter",
  "moon.waning_crescent": "Waning crescent",

  // Normals describe observed history, so the copy says "typically", never
  // "will be", and always shows the sample the claim rests on.
  "weather.normals.title": "Typical for these dates",
  "weather.normals.range": "Typically {low}–{high}°C",
  "weather.normals.sample": "{days} days across {years} years ({from}–{to})",
  "weather.normals.wet": "{pct}% of days see rain",
  "weather.normals.extremes": "Recorded range {coldest}°C to {warmest}°C",
  "weather.uv": "UV {value}",
  "weather.aqi": "AQI {value}",
  "weather.alerts.title": "Official alerts",
  "weather.alerts.attribution":
    "Public domain (U.S. National Weather Service). Shown verbatim; check the source before you rely on it.",
  "weather.alerts.area": "Affects {area}",

  "packing.title": "What to pack",
  "packing.intro":
    "Worked out from the weather history above and your confirmed plans. Suggestions, not a checklist.",
  "packing.warm_layers": "Warm layers",
  "packing.light_clothing": "Light clothing",
  "packing.rain_shell": "Rain shell",
  "packing.sun_protection": "Sun protection",
  "packing.mask": "A mask",
  "packing.travel_documents": "Travel documents",
  "packing.laundry": "Laundry kit",
  "packing.reason.avg_low": "Typical low is {value}°C",
  "packing.reason.avg_high": "Typical high is {value}°C",
  "packing.reason.wet_day_share": "{value}% of typical days see rain",
  "packing.reason.uv_index": "UV reaches {value}",
  "packing.reason.aqi": "Air quality index reaches {value}",
  "packing.reason.has_flight": "You have a flight confirmed",
  "packing.reason.nights": "{value} nights away",

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
  "assist.grounding.flight.one": "1 confirmed flight",
  "assist.grounding.flight.other": "{count} confirmed flights",
  "assist.grounding.stay.one": "1 confirmed stay",
  "assist.grounding.stay.other": "{count} confirmed stays",
  "assist.grounding.document.one": "1 imported document",
  "assist.grounding.document.other": "{count} imported documents",
  "assist.grounding.tripDates": "trip dates",
  "assist.grounding.noDocuments": "no imported documents yet",
  "assist.grounding.confirmedEvidence": "confirmed trip evidence",
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
  // The core reports which facts a finding is about and how they are
  // identified; the sentence is built here. A flight number and a property
  // name are the traveler's own data, interpolated verbatim.
  "schedule.label.flight_number": "Flight {number}",
  "schedule.label.flight_route": "Flight {from}→{to}",
  "schedule.label.flight": "A flight",
  "schedule.label.lodging_property": "{property}",
  "schedule.label.lodging": "A lodging stay",
  "schedule.flight_overlap":
    "{first} and {second} overlap in time — a traveler can only be on one flight at once.",
  "schedule.lodging_overlap":
    "{first} and {second} overlap — two stays cover the same night.",
  // A one-night gap and a run of nights are the same finding with a different
  // count, so the plural rules pick the form rather than the core picking it.
  "schedule.lodging_gap.one": "No lodging is booked for the night of {first}.",
  "schedule.lodging_gap.other":
    "No lodging is booked for the nights of {first} through {last}.",
  "schedule.planned_item_overlap":
    "Your plans “{first}” and “{second}” overlap. Check whether that is intentional.",
  "schedule.planned_item_fact_overlap":
    "Your plan “{plan}” overlaps {fact}. Check whether that is intentional; readiness is unchanged.",

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
  "settings.language": "Language",
  "settings.language.hint":
    "System follows your computer. This preference stays only in this app on this device.",
  "settings.language.system": "System",
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

// Spanish is exhaustive by construction: adding an English key fails type checking
// until its reviewed Spanish counterpart lands with the same placeholders.
const es: Record<MessageKey, string> = {
  "backup.section": "Copia de seguridad y restauración",
  "backup.intro":
    "Guarda todo tu espacio de trabajo —viajes, confirmaciones importadas y paquetes sin conexión— en un solo archivo cifrado que puedes guardar en un lugar seguro o mover a otra computadora.",
  "backup.unsupported":
    "La copia de seguridad requiere la aplicación de escritorio, que es donde realmente reside tu información. En el navegador no hay una base de datos local para guardar.",
  "backup.export.title": "Guardar copia de seguridad",
  "backup.export.hint":
    "Tú eliges una frase de contraseña para el archivo. Esta acompaña a la copia, por lo que el mismo archivo se abrirá en cualquier computadora.",
  "backup.export.action": "Guardar copia de seguridad",
  "backup.export.confirm": "Guardar copia",
  "backup.export.done": "Copia guardada en {path}",
  "backup.export.cancelled": "No se guardó ninguna copia.",
  "backup.warn.noRecovery":
    "No hay forma de recuperar la información si pierdes esta frase de contraseña: la copia es ilegible sin ella y Voyalier nunca la almacena.",
  "backup.excludes":
    "Los mapas descargados y tus claves del proveedor de IA no se incluyen: los mapas pueden descargarse de nuevo y las claves permanecen en el llavero de esta computadora en lugar de viajar en un archivo.",
  "backup.restore.title": "Restaurar copia de seguridad",
  "backup.restore.hint":
    "Restaurar reemplaza todo lo que hay actualmente en Voyalier con el contenido de la copia. Primero se crea una instantánea de tus datos actuales, por lo que esto se puede deshacer.",
  "backup.restore.action": "Restaurar desde copia",
  "backup.restore.confirm": "Restaurar esta copia",
  "backup.restore.cancelled": "No se restauró ninguna copia.",
  "backup.restore.staged":
    "Listo para restaurar la copia del {date}. Sal y vuelve a abrir Voyalier para finalizar; aún no ha cambiado nada.",
  "backup.restore.pending":
    "Hay una restauración pendiente. Sal y vuelve a abrir Voyalier para completarla.",
  "backup.passphrase": "Frase de contraseña de copia",
  "backup.passphrase.placeholder": "Frase de contraseña ({min}+ caracteres)",
  "backup.confirmPassphrase": "Confirmar frase de contraseña",
  "backup.confirmPassphrase.placeholder": "Confirmar frase de contraseña",
  "backup.error.tooShort": "Usa al menos {min} caracteres.",
  "backup.error.mismatch": "Las frases de contraseña no coinciden.",
  "backup.error.newerVersion":
    "Esta copia se creó con una versión más reciente de Voyalier. Actualiza la aplicación y vuelve a restaurarla.",
  "backup.error.generic": "Eso no funcionó. Inténtalo de nuevo.",
  "vault.section": "Cifrado",
  "vault.inactive":
    "No hay un llavero de dispositivo disponible aquí, por lo que los campos sensibles se guardan en texto plano y no se puede añadir una frase de contraseña. En macOS y Windows, Voyalier los cifra automáticamente.",
  "vault.intro.base":
    "Los códigos de confirmación y los nombres de los viajeros están cifrados en este dispositivo.",
  "vault.intro.protected":
    "Una frase de contraseña que elegiste también protege la clave; Voyalier te la pedirá al iniciar.",
  "vault.intro.unprotected":
    "Añade una frase de contraseña para una segunda capa que proteja tus datos incluso en una computadora desbloqueada.",
  "vault.state.on": "La protección por frase de contraseña está activada.",
  "vault.state.off": "La protección por frase de contraseña está desactivada.",
  "vault.currentPassphrase": "Frase de contraseña actual",
  "vault.currentPassphrase.placeholder":
    "Ingresa tu frase de contraseña actual",
  "vault.newPassphrase": "Nueva frase de contraseña",
  "vault.newPassphrase.placeholder":
    "Nueva frase de contraseña ({min}+ caracteres)",
  "vault.confirmPassphrase": "Confirmar frase de contraseña",
  "vault.confirmPassphrase.placeholder": "Confirmar frase de contraseña",
  "vault.warn.noRecovery":
    "No hay forma de recuperarla si la olvidas: Voyalier no puede restablecer una frase de contraseña que nunca almacena.",
  "vault.action.add": "Añadir frase de contraseña",
  "vault.action.set": "Establecer frase de contraseña",
  "vault.action.remove": "Eliminar frase de contraseña",
  "vault.action.cancel": "Cancelar",
  "vault.error.tooShort": "Usa al menos {min} caracteres.",
  "vault.error.mismatch": "Las dos frases de contraseña no coinciden.",
  "vault.error.generic":
    "Eso no funcionó. Verifica la frase de contraseña e inténtalo de nuevo; no se cambió nada.",
  "vault.announce.set": "Frase de contraseña establecida.",
  "vault.announce.removed": "Frase de contraseña eliminada.",
  "vault.unlock.title": "Tu bóveda está bloqueada",
  "vault.unlock.intro":
    "Ingresa tu frase de contraseña para abrir este espacio de trabajo. Se usa solo en este dispositivo para desbloquear tus datos de viaje cifrados.",
  "vault.unlock.passphrase": "Frase de contraseña",
  "vault.unlock.action": "Desbloquear",
  "vault.unlock.error": "Esa frase de contraseña no es correcta.",
  "vault.unlock.forgot": "¿Olvidaste tu frase de contraseña?",
  "vault.unlock.forgot.body":
    "Por diseño, no hay forma de recuperarla: la frase de contraseña nunca se almacena ni se envía, por lo que Voyalier no puede restablecerla. Si hiciste una copia de seguridad del directorio de datos locales antes de activarla, restaurar esa copia te devuelve a una versión sin protección. De lo contrario, no podrás abrir los datos cifrados del viaje.",
  "error.transport.title": "Voyalier no puede contactar con el motor",
  "error.transport.body":
    "La parte de Voyalier que se ejecuta en este dispositivo no responde en este momento. Tus datos están seguros.",
  "error.storage.title": "Almacenamiento local no disponible",
  "error.storage.body":
    "Voyalier no pudo leer ni escribir tus datos locales. No se realizó ningún cambio.",
  "error.tripNotFound.title": "Este viaje ya no está aquí",
  "error.tripNotFound.body":
    "Es posible que haya sido eliminado en este dispositivo.",
  "error.candidateNotFound.title": "Esta sugerencia ya no está aquí",
  "error.candidateNotFound.body":
    "Es posible que ya haya sido resuelta. Actualiza para ver la lista actual.",
  "error.candidateResolved.title": "Ya se resolvió",
  "error.candidateResolved.body":
    "Esta sugerencia ya fue confirmada o descartada.",
  "error.factNotFound.title": "Este dato ya no está aquí",
  "error.factNotFound.body": "Es posible que ya haya sido eliminado.",
  "error.documentEmpty.title": "No hay nada para importar",
  "error.documentEmpty.body": "El contenido pegado estaba vacío.",
  "error.documentTooLarge.title": "Ese documento es demasiado grande",
  "error.documentTooLarge.body":
    "Los documentos están limitados a 1,000,000 de caracteres.",
  "error.documentDuplicate.title": "Ya fue importado",
  "error.documentDuplicate.body":
    "Este documento exacto ya se había importado antes.",
  "error.adviceFetch.title": "No se pudo contactar con la fuente oficial",
  "error.adviceFetch.body":
    "Voyalier no pudo obtener la página de consejos en este momento. Revisa tu conexión e inténtalo de nuevo; no se realizó ningún cambio.",
  "error.assist.title": "La asistencia no terminó",
  "error.assist.body":
    "Voyalier no pudo completar la solicitud. Revisa el modelo y tu conexión (o que tu IA local esté ejecutándose), luego intenta de nuevo; no se realizó ningún cambio.",
  "error.assistUnreachable.title": "No se pudo contactar con tu IA",
  "error.assistUnreachable.body":
    "Voyalier no pudo contactar con la IA. Si usas una IA en el dispositivo, asegúrate de que Ollama esté ejecutándose (y que un modelo esté descargado), luego intenta de nuevo. Para un proveedor en la nube, revisa tu conexión. No se realizó ningún cambio.",
  "error.weatherFetch.title": "No se pudo obtener el pronóstico del tiempo",
  "error.weatherFetch.body":
    "Revisa el destino y tu conexión, y vuelve a intentarlo.",
  "error.packDownload.title": "No se pudo descargar el paquete de esa ciudad",
  "error.packDownload.body":
    "Voyalier no pudo obtener el paquete en este momento. Revisa tu conexión e inténtalo de nuevo; no se realizó ningún cambio.",
  "error.validation.title": "Revisa los campos resaltados",
  "error.validation.body":
    "Revisa los valores ingresados e inténtalo de nuevo.",
  "tripFieldError.origin": "Ingresa un origen de viaje válido.",
  "tripFieldError.destination": "Ingresa un destino de viaje válido.",
  "tripFieldError.dateRange":
    "Usa un intervalo de fechas válido con el inicio primero.",
  "error.unexpected.title": "Algo salió mal",
  "error.unexpected.body":
    "Ocurrió un error inesperado. No se realizó ningún cambio.",
  "topbar.home": "Voyalier — todos los viajes",
  "health.checking": "Iniciando…",
  "health.online": "Listo",
  "health.offline": "Sin conexión",
  "action.retry": "Reintentar",
  "action.cancel": "Cancelar",
  "confirm.arm": "{label} — ¿estás seguro?",
  "deleteTrip.title": "¿Eliminar este viaje?",
  "deleteTrip.description":
    "Esto eliminará permanentemente “{title}” y todo su contenido. Esta acción no se puede deshacer.",
  "deleteTrip.confirm": "Eliminar viaje",
  "deleteTrip.confirmLabel": "Escribe delete para confirmar",
  "deleteTrip.placeholder": "delete",
  "deleteTrip.hint":
    "¿Prefieres conservarlo? Archivar oculta el viaje sin eliminar nada.",
  "createTrip.title": "Crear un viaje",
  "createTrip.description":
    "Empieza por indicar adónde vas y cuándo. Todo lo demás puede venir después.",
  "createTrip.submit": "Crear viaje",
  "createTrip.origin.label": "Desde",
  "createTrip.origin.placeholder": "Chicago",
  "createTrip.origin.required": "Ingresa dónde comienza el viaje.",
  "createTrip.destination.label": "Destino",
  "createTrip.destination.placeholder": "Kioto",
  "createTrip.destination.required": "Ingresa a dónde va el viaje.",
  "createTrip.tooLong": "Usa 120 caracteres o menos.",
  "createTrip.startDate": "Fecha de inicio",
  "createTrip.endDate": "Fecha de finalización",
  "createTrip.dates.required":
    "Agrega una fecha de inicio y una de finalización.",
  "createTrip.dates.order":
    "La fecha de inicio debe ser igual o anterior a la fecha de finalización.",
  "createTrip.name.label": "Nombre del viaje (opcional)",
  "createTrip.name.hint": "Si lo dejas vacío, usaremos «Origen → Destino».",
  "createTrip.name.placeholder": "Viaje de otoño a Kioto",
  "editTrip.title": "Editar viaje",
  "editTrip.description":
    "Corrige el destino, las fechas o el nombre. Tus documentos importados, datos y planes se mantendrán.",
  "editTrip.submit": "Guardar cambios",
  "triplist.eyebrow": "Tu espacio de trabajo",
  "triplist.title": "Tus viajes",
  "triplist.create": "Crear un viaje",
  "triplist.loading": "Cargando viajes…",
  "triplist.empty.title": "Aún no hay viajes",
  "triplist.empty.body":
    "Voyalier convierte confirmaciones y notas dispersas en un itinerario confiable — crea un viaje para comenzar.",
  "triplist.announce.archived": "{title} archivado.",
  "triplist.announce.unarchived": "{title} desarchivado.",
  "triplist.announce.created": "Viaje creado: {title}.",
  "triplist.announce.deleted": "{title} eliminado.",
  "triplist.hideArchived": "Ocultar archivados",
  "triplist.allArchived":
    "No hay viajes activos — tus viajes están archivados. Muéstralos abajo para reabrir uno.",
  "tripcard.open": "Abrir {title}",
  "tripcard.archive": "Archivar",
  "tripcard.unarchive": "Desarchivar",
  "tripcard.delete": "Eliminar",
  "tripcard.toReview": "por revisar",
  "status.trip.draft": "Borrador",
  "status.trip.active": "Activo",
  "status.trip.archived": "Archivado",
  "status.candidate.pending": "Pendiente",
  "status.candidate.confirmed": "Confirmado",
  "status.candidate.rejected": "Rechazado",
  "factType.flight": "Vuelo",
  "factType.stay": "Estancia",
  "fact.flightHeadline": "Vuelo {number}",
  "fact.flightSegment": "Tramo de vuelo",
  "fact.lodgingStay": "Estancia de alojamiento",
  "method.structured": "Estructurado",
  "method.inferred": "Inferido",
  "method.manual": "Manual",
  "method.assisted": "Sugerido por IA",
  "method.structured.desc":
    "Leído de datos estructurados incluidos en el documento.",
  "method.inferred.desc":
    "Inferido del texto no estructurado; vale la pena revisarlo con atención.",
  "method.manual.desc": "Introducido por ti.",
  "method.assisted.desc":
    "Redactado por tu IA local a partir de tu texto importado; revísalo antes de confirmar.",
  "warning.missing_dates": "No se encontraron fechas para este elemento.",
  "warning.missing_locations":
    "No se encontraron ubicaciones para este elemento.",
  "warning.ambiguous_date_format":
    "El formato de fecha es ambiguo y podría interpretarse mal.",
  "warning.past_date": "Esta fecha ya pasó.",
  "warning.outside_trip_window": "Esto está fuera del rango de tu viaje.",
  "warning.unrecognized_airport_code":
    "No se reconoció el código del aeropuerto.",
  "field.airlineName": "Aerolínea",
  "field.airlineIata": "Código de aerolínea",
  "field.flightNumber": "Número de vuelo",
  "field.departureAirportIata": "Desde (aeropuerto)",
  "field.arrivalAirportIata": "Hacia (aeropuerto)",
  "field.departureLocal": "Salida (hora local)",
  "field.arrivalLocal": "Llegada (hora local)",
  "field.confirmationCode": "Código de confirmación",
  "field.passengerName": "Pasajero",
  "field.propertyName": "Propiedad",
  "field.address": "Dirección",
  "field.checkinDate": "Llegada",
  "field.checkoutDate": "Salida",
  "field.guestName": "Huésped",
  "today.title": "Hoy",
  "today.phase.tomorrow": "Comienza mañana",
  "today.phase.upcoming": "Comienza en {days} días",
  "today.phase.active": "Día {day} de {total}",
  "today.phase.yesterday": "Terminó ayer",
  "today.phase.completed": "Terminó hace {days} días",
  "today.schedule": "Agenda de hoy",
  "today.empty.active": "No hay nada programado para hoy.",
  "today.empty.other": "Sin planes para hoy.",
  "today.next": "Siguiente",
  "today.item.depart": "Salida — {subject}",
  "today.item.departGeneric": "Salida del vuelo",
  "today.item.arrive": "Llegada — {subject}",
  "today.item.arriveGeneric": "Llegada del vuelo",
  "today.item.checkin": "Llegada al alojamiento — {subject}",
  "today.item.checkinGeneric": "Llegada al alojamiento",
  "today.item.checkout": "Salida del alojamiento — {subject}",
  "today.item.checkoutGeneric": "Salida del alojamiento",
  "today.item.staying": "Estancia en {subject}",
  "today.item.stayingGeneric": "Estancia esta noche",
  "today.error":
    "No se pudo cargar la agenda de hoy. El resto del viaje está bien.",
  "localai.title": "IA en el dispositivo",
  "localai.badge.available": "Disponible",
  "localai.badge.notDetected": "No detectado",
  "localai.precheck":
    "Voyalier puede usar un Ollama local para asistencia privada opcional; nada saldrá de tu dispositivo. Verifica si hay uno en ejecución.",
  "localai.models.aria": "Modelos instalados",
  "localai.noModels.before":
    "Ollama está en ejecución pero no hay modelos instalados. Descarga uno (por ejemplo, ",
  "localai.noModels.after":
    ") para habilitar la asistencia opcional en el dispositivo.",
  "localai.notDetected.before": "No se detectó IA en el dispositivo. Instala ",
  "localai.notDetected.after":
    " para habilitar la asistencia privada opcional. Voyalier seguirá siendo totalmente funcional sin ella.",
  "localai.ollama": "Ollama",
  "localai.check": "Buscar IA en el dispositivo",
  "localai.scope":
    "La detección solo se ejecuta en este dispositivo. Una vez instalado un modelo, las funciones de IA pueden usarlo; siempre en este dispositivo y siempre bajo tu elección.",
  "localai.setup.lead":
    "Configúralo en unos pocos pasos: es gratis, se ejecuta totalmente en tu dispositivo y es opcional.",
  "localai.step.install.title": "1. Instalar Ollama",
  "localai.step.install.before": "Descarga e instala ",
  "localai.step.install.after": "; es gratis y se ejecuta localmente.",
  "localai.step.start.title": "2. Iniciar Ollama",
  "localai.step.start.body":
    "Abre la aplicación Ollama. En macOS, aparece en tu barra de menús y suele iniciarse automáticamente tras la instalación.",
  "localai.step.model.title": "3. Obtener un modelo",
  "localai.step.model.body":
    "Elige uno de los siguientes. Copia el comando en tu terminal o, una vez que Ollama esté en ejecución, descárgalo directamente aquí.",
  "localai.nomodels.lead":
    "Ollama está en ejecución. Añade un modelo para habilitar la asistencia privada opcional.",
  "localai.recommended.aria": "Modelos recomendados",
  "localai.addAnother": "Añadir otro modelo",
  "localai.card.tag": "Etiqueta del modelo para {model}",
  "localai.card.copy": "Copiar comando",
  "localai.card.copied": "Copiado",
  "localai.card.download": "Descargar",
  "localai.card.downloading":
    "Descargando… mantén la app abierta (esto puede tardar varios minutos)",
  "localai.card.needsRunning": "Inicia Ollama para descargar desde aquí.",
  "localai.card.downloaded": "Se descargó {model}.",
  "localai.card.downloadFailed":
    "No se pudo descargar ese modelo. Revisa Ollama e inténtalo de nuevo.",
  "localai.model.gemma.blurb":
    "Calidad equilibrada: una opción versátil y sólida para la mayoría de los equipos.",
  "localai.model.qwen.blurb":
    "Más ligero y rápido: una buena opción para portátiles modestos.",
  "action.checkAgain": "Verificar de nuevo",
  "a11y.opensInNewTab": " (se abre en una pestaña nueva)",
  "a11y.skipToContent": "Saltar al contenido",
  "search.title": "Buscar en este viaje",
  "search.label": "Busca en tus documentos y planes confirmados",
  "search.placeholder": "Traslado, código de confirmación, hotel…",
  "search.submit": "Buscar",
  "search.hint":
    "Escribe para buscar mientras tecleas; funcionan palabras parciales y cualquier palabra coincide. Elige una sugerencia o copia un resultado para reutilizarlo.",
  "search.error.empty": "Escribe algo para buscar.",
  "search.announce.none": "Sin coincidencias para {query}.",
  "search.none":
    "No hay coincidencias para “{query}” en tus documentos ni planes confirmados.",
  "search.results.aria": "Resultados de búsqueda",
  "search.suggestions.aria": "Sugerencias de búsqueda",
  "search.suggestions.label": "Intenta:",
  "search.copy": "Copiar",
  "search.copied": "Copiado",
  "search.copy.aria": "Copiar “{value}”",
  "search.announce.copied": "Copiado al portapapeles.",
  "search.hit.document": "documento importado",
  "search.hit.confirmed": "plan confirmado",
  "search.label.flight": "Vuelo {subject}",
  "search.label.flightGeneric": "Vuelo",
  "search.label.stayGeneric": "Estancia",
  "addFact.title": "Agregar vuelo o estancia",
  "addFact.description":
    "Ingresa un vuelo o una estancia manualmente. Las entradas manuales son tuyas y aparecen en el Blueprint de inmediato.",
  "addFact.submit": "Agregar al Blueprint",
  "addFact.type": "Tipo",
  "addFact.typeChoice": "Tipo de dato",
  "addFact.empty": "Agrega al menos un detalle antes de guardar.",
  "action.done": "Listo",
  "import.title": "Importar documento",
  "import.description":
    "Pega un correo de confirmación o una página de reserva. Voyalier lo lee en este dispositivo y te muestra lo que encontró antes de guardar nada.",
  "import.submit": "Importar",
  "import.error.empty": "Pega algún contenido para importar.",
  "import.error.tooLarge":
    "Este documento supera el límite de 1,000,000 caracteres.",
  "import.error.wasEmpty": "El contenido pegado estaba vacío.",
  "import.duplicate.title": "Ya importado",
  "import.duplicate.body":
    "Este contenido exacto ya se importó antes{doc}. Edita el contenido para importar algo nuevo.",
  "import.duplicate.docSuffix": " (documento {id})",
  "import.format": "Formato",
  "import.formatChoice": "Formato de documento",
  "import.format.text": "Texto plano",
  "import.format.html": "HTML",
  "import.format.email": "Correo electrónico",
  "import.label": "Etiqueta (opcional)",
  "import.label.placeholder": "Confirmación de vuelo",
  "import.file.label": "Agregar archivo",
  "import.file.button": "Elegir archivo",
  "import.file.drop": "Suelta un archivo aquí",
  "import.file.hint":
    "Suelta un archivo .eml, .html o .txt — o pega el contenido abajo. Se lee en este dispositivo; nada se sube a la red.",
  "import.file.tooLarge":
    "Ese archivo supera el límite de 1,000,000 caracteres.",
  "import.file.unreadable":
    "No se pudo leer ese archivo. Intenta pegando el contenido en su lugar.",
  "import.file.loaded": "Cargado “{name}”. Revísalo abajo y luego impórtalo.",
  "import.content": "Contenido",
  "import.content.placeholder": "Pega tu confirmación aquí…",
  "import.content.placeholder.email":
    "Pega el correo de confirmación completo, incluyendo los encabezados. Voyalier lee el cuerpo e ignora el resto.",
  "import.charcount": "{count} / {max} caracteres",
  "import.done.title": "Importado",
  "import.done.label": "“{label}” importado.",
  "import.done.none": "No se encontraron nuevas sugerencias en este documento.",
  "action.close": "Cerrar",
  "brief.title": "Resumen para compartir",
  "brief.description":
    "Una copia que puedes compartir. Los códigos de confirmación y los nombres de los viajeros se eliminan antes de salir de este dispositivo.",
  "brief.print": "Imprimir / Guardar como PDF",
  "brief.loading": "Preparando el resumen…",
  "brief.flights": "Vuelos",
  "brief.stays": "Estancias",
  "brief.plans": "Actividades y traslados",
  "brief.empty":
    "Aún no hay vuelos ni estancias confirmados. Confirma algunos planes para completar el resumen.",
  "brief.redaction": "Oculto en este resumen: {fields}.",
  "contract.redacted.confirmationCodes": "Códigos de confirmación",
  "contract.redacted.travelerNames": "Nombres de los viajeros",
  "contract.redacted.addresses": "Direcciones",
  "contract.withheld.importedDocumentText": "Texto de documentos importados",
  "review.title": "Revisar sugerencias",
  "review.description":
    "Voyalier encontró esto en tus documentos. Nada se guarda hasta que lo confirmes; revisa la evidencia citada para cada campo.",
  "review.announce.confirmed": "Se confirmó {fact}.",
  "review.announce.dismissed": "Se descartó {fact}.",
  "review.editnote":
    "Edita cualquier campo y luego confirma. Los campos modificados se registrarán en el dato guardado.",
  "review.evidence": "Del documento",
  "review.cancelEdit": "Cancelar edición",
  "review.saveConfirm": "Guardar y confirmar",
  "review.confirm": "Confirmar",
  "review.editConfirm": "Editar y confirmar",
  "review.dismiss": "Descartar",
  "review.empty.title": "Todo al día",
  "review.empty.body":
    "Todas las sugerencias han sido confirmadas o descartadas.",
  "providers.title": "Proveedores de IA",
  "providers.intro":
    "Usa tu propia clave de OpenAI o Anthropic para asistencia opcional en la nube. Las claves se guardan en el llavero de tu dispositivo; nunca en los archivos de Voyalier ni en ningún servidor compartido.",
  "providers.manage": "Gestionar proveedores de IA",
  "providers.scope":
    "Las claves permanecen en el llavero de tu sistema operativo y nunca salen de tu dispositivo. Una clave solo se usa para enviar una solicitud que tú revisas y eliges enviar, bajo la opción “Vista previa de solicitud de IA”.",
  "providers.status.onDevice": "En el dispositivo",
  "providers.status.keyStored": "Clave guardada",
  "providers.status.noKey": "Sin clave",
  "providers.error": "No se pudo guardar; no hubo cambios.",
  "providers.keyRejected":
    "Esa clave de API fue rechazada. Revísala e inténtalo de nuevo.",
  "providers.stored": "Clave API guardada en tu llavero.",
  "providers.removeKey": "Eliminar clave",
  "providers.apiKey": "Clave API de {provider}",
  "providers.apiKey.placeholder": "Pega tu clave API",
  "providers.saveKey": "Guardar clave",
  "providers.onDeviceNote":
    "Se ejecuta localmente en este dispositivo; no requiere clave.",
  "providers.model.label": "Modelo de {provider}",
  "providers.model.placeholder": "Modelo (opcional)",
  "providers.saveModel": "Guardar modelo",
  "providers.announce.keyRemoved": "Clave de {provider} eliminada.",
  "providers.announce.keySaved": "Clave de {provider} guardada.",
  "providers.announce.keyVerified":
    "Clave de {provider} guardada y verificada.",
  "providers.announce.keySavedUnverified":
    "Clave de {provider} guardada, pero no se pudo verificar en este momento.",
  "providers.announce.modelSaved": "Modelo de {provider} guardado.",
  "providers.validateSave": "Validar y guardar",
  "providers.help.summary": "Cómo obtener una clave",
  "providers.help.intro": "Obtén una clave API de {provider}:",
  "providers.help.step.account":
    "Inicia sesión o crea una cuenta en {provider}.",
  "providers.help.step.create.before": "Abre la ",
  "providers.help.step.create.link": "página de claves API",
  "providers.help.step.create.after": " y crea una nueva clave secreta.",
  "providers.help.step.paste":
    "Pégala arriba y luego selecciona Validar y guardar.",
  "prompts.title": "Personalizar instrucciones de IA",
  "prompts.intro":
    "Avanzado: cambia lo que Voyalier le dice a la IA. El borrador de fechas de alojamiento seguirá aceptando solo fechas, sin importar lo que escribas aquí. Relajar las instrucciones de asistencia puede hacer que las respuestas sean más arriesgadas; en cualquier caso, Voyalier marcará las respuestas de la IA como no oficiales.",
  "prompts.kind.assist": "Instrucción de asistencia y vista previa",
  "prompts.kind.draft_lodging_dates":
    "Instrucción de borrador de fechas de alojamiento",
  "prompts.desc.assist":
    "Se usa cuando revisas o ejecutas una solicitud de IA para un viaje.",
  "prompts.desc.draft_lodging_dates":
    "Se usa cuando la IA local genera borradores de fechas de alojamiento faltantes.",
  "prompts.badge.custom": "Personalizado",
  "prompts.badge.default": "Predeterminado",
  "prompts.save": "Guardar instrucción",
  "prompts.reset": "Restablecer a predeterminado",
  "prompts.error": "No se pudo guardar; no hubo cambios.",
  "prompts.announce.saved": "{name} guardado.",
  "prompts.announce.reset": "{name} restablecido a predeterminado.",
  "prompts.scope":
    "Guardado en este dispositivo. Se aplica a futuras solicitudes de IA que realices; nunca cambia lo que sale de tu dispositivo más allá del texto de la instrucción que ves en la vista previa.",
  "packs.suggested.title": "Recomendados para este viaje",
  "packs.suggested.matchExact": "Coincide con tu destino",
  "packs.suggested.matchAlias": "Coincide con tu destino",
  "packs.suggested.matchPartial": "En esta región",
  "packs.suggested.download": "Descargar datos de la ciudad {name}",
  "packs.suggested.ambiguous":
    "Puede haber más de un paquete coincidente; elige uno:",
  "packs.suggested.none":
    "Aún no hay paquetes de ciudades que coincidan con “{destination}”. Explora todos los paquetes abajo.",
  "packs.suggested.downloaded": "Descargado para este viaje.",
  "packs.suggested.consent":
    "Al descargar, se importan los datos de este paquete; no se envía nada sobre tu viaje excepto la solicitud del archivo del paquete.",
  "combobox.listLabel": "Sugerencias de {label}",
  "combobox.available.one": "{count} sugerencia disponible.",
  "combobox.available.other": "{count} sugerencias disponibles.",
  "suggest.source.confirmed_fact": "de este viaje",
  "suggest.source.trip_history": "de una estancia anterior",
  "suggest.source.pack_place": "de un paquete de ciudad",
  "suggest.source.catalog": "paquete de ciudad",
  "suggest.source.gazetteer": "ciudad",
  "packs.title": "Datos de la ciudad sin conexión",
  "packs.intro":
    "Descarga los lugares y las notas de viaje de una ciudad para usarlos sin conexión. El paquete se descarga desde GitHub y se guarda en este dispositivo para este viaje; no se envía nada sobre tu viaje. Cada paquete combina lugares de Overture con una capa independiente de notas de Wikivoyage, cada una con su propia licencia.",
  "packs.browse": "Explorar paquetes de ciudades",
  "packs.layers.aria": "Capas de datos de {name}",
  "packs.remove": "Eliminar",
  "packs.download": "Descargar para este viaje",
  "packs.includesOfflineMap":
    "Incluye una descarga verificada de mapa sin conexión; el tamaño varía según la ciudad.",
  "packs.scope":
    "Los paquetes se guardan en este dispositivo para este viaje. La descarga obtiene datos de GitHub; no se envía nada sobre tu viaje.",
  "packs.announce.downloaded": "Paquete {name} descargado.",
  "packs.announce.removed": "Paquete {name} eliminado.",
  "recs.title": "Recomendaciones",
  "recs.intro":
    "Recomendaciones ordenadas de un paquete de ciudad descargado y ponderadas según tus intereses. La puntuación sigue una regla transparente, no un modelo, y cada recomendación conserva su fuente y licencia.",
  "recs.presets.aria": "Perfiles de intereses",
  "recs.get": "Obtener recomendaciones",
  "recs.list.aria": "Lugares recomendados",
  "recs.wildcard": "comodín",
  "recs.announce.none": "Aún no hay recomendaciones.",
  "recs.none":
    "Aún no hay recomendaciones — descarga un paquete de ciudad para este viaje (en “Datos de la ciudad sin conexión”) o amplía tus intereses.",
  "recs.scope":
    "Sugerencias basadas en datos abiertos sobre lugares; no son una fuente autorizada sobre precios, horarios ni seguridad. Nada sale de tu dispositivo.",
  "recs.dim.food": "Comida",
  "recs.dim.culture": "Cultura",
  "recs.dim.nature": "Naturaleza",
  "recs.dim.nightlife": "Vida nocturna",
  "recs.dim.shopping": "Compras",
  "recs.reason.interest": "Coincide con tu interés en {dimension}",
  "recs.reason.wildcard": "Una alternativa a tus opciones principales",
  "recs.preset.balanced": "Equilibrado",
  "recs.preset.foodie": "Gastronómico",
  "recs.preset.explorer": "Explorador",
  "recs.save": "Guardar lugar",
  "recs.savedAlready": "Guardado",
  "recs.saved": "Se guardó {name} en este viaje.",
  "recs.interests.save": "Guardar intereses",
  "recs.interests.unsaved": "Intereses no guardados",
  "recs.interests.saved": "Intereses guardados",
  "planning.saved.title": "Lugares guardados",
  "planning.saved.intro":
    "Tu lista de lugares conserva la fuente, la licencia y los motivos registrados cuando guardaste cada lugar. Añadir uno al plan siempre es una decisión independiente.",
  "planning.saved.empty": "Aún no hay lugares guardados.",
  "planning.saved.packRemoved": "paquete de origen eliminado",
  "planning.saved.notes": "Notas privadas",
  "planning.saved.saveNotes": "Guardar notas",
  "planning.saved.addToPlan": "Añadir al plan",
  "planning.saved.promoted": "Se añadió {name} al plan.",
  "planning.saved.prefilled":
    "Listo para añadir {name}; revisa el plan primero.",
  "planning.saved.addToPlanLabel": "Añadir {name} al plan",
  "planning.saved.saveNotesLabel": "Guardar notas de {name}",
  "planning.remove": "Quitar",
  "planning.removeNamed": "Eliminar {name}",
  "planning.packing.title": "Lista de equipaje",
  "planning.packing.intro":
    "Las sugerencias siguen siendo sugerencias hasta que las añadas. Una vez añadidas, las actualizaciones del clima nunca cambiarán ni eliminarán tu lista.",
  "planning.packing.custom": "Artículo personalizado",
  "planning.packing.add": "Añadir",
  "planning.packing.added": "Añadido",
  "planning.packing.nameLabel": "Nombre del artículo",
  "planning.packing.renameLabel": "Renombrar {name}",
  "planning.packing.saveLabel": "Guardar artículo",
  "planning.items.title": "Actividades y traslados",
  "planning.items.intro":
    "Añade planes que tú escribiste. Se muestran como planes creados por el viajero, nunca como reservas confirmadas.",
  "planning.items.kind": "Tipo",
  "planning.items.activity": "Actividad",
  "planning.items.rail": "Tren",
  "planning.items.transfer": "Traslado",
  "planning.items.name": "Nombre",
  "planning.items.location": "Ubicación (opcional)",
  "planning.items.start": "Inicio (opcional)",
  "planning.items.end": "Fin (opcional)",
  "planning.items.notes": "Notas privadas (opcional)",
  "planning.items.add": "Añadir al plan",
  "planning.items.edit": "Editar",
  "planning.items.editLabel": "Editar {name}",
  "planning.items.removeLabel": "Eliminar {name}",
  "planning.items.save": "Guardar cambios",
  "topbar.search": "Buscar en el espacio de trabajo",
  "workspaceSearch.back": "Todos los viajes",
  "workspaceSearch.title": "Buscar en el espacio de trabajo",
  "workspaceSearch.intro":
    "Busca documentos importados, datos confirmados, notas, lugares guardados y planes creados por el viajero en todos los viajes. Las sugerencias pendientes se excluyen hasta que las confirmes.",
  "workspaceSearch.label": "Buscar en todos los viajes",
  "workspaceSearch.placeholder": "Buscar en todos los viajes",
  "workspaceSearch.search": "Buscar",
  "workspaceSearch.none": "No hay coincidencias en este espacio de trabajo.",
  "workspaceSearch.source.document": "Documento de origen",
  "workspaceSearch.source.confirmed_fact": "Dato confirmado",
  "workspaceSearch.source.note": "Notas del viaje",
  "workspaceSearch.source.saved_place": "Lugar guardado",
  "workspaceSearch.source.trip_item": "Plan del viajero",
  "workspaceSearch.archived": "Viaje archivado",
  "workspaceSearch.updated": "Viaje actualizado el {date}",
  "workspaceSearch.label.confirmedFact": "Dato confirmado",
  "workspaceSearch.label.note": "Notas del viaje",
  "dataSources.title": "Fuentes de datos y licencias",
  "dataSources.intro":
    "Mira qué usa Voyalier, cuándo ocurre una solicitud de red, la atribución requerida y qué puede —y qué no puede— establecer cada fuente.",
  "dataSources.show": "Mostrar todas las fuentes de datos",
  "dataSources.use": "Se usa para:",
  "dataSources.license": "Licencia / condiciones:",
  "dataSources.endpoint": "Punto de conexión:",
  "dataSources.group.builtIn": "Integrado en la app",
  "dataSources.group.consentFetched": "Obtenido con consentimiento",
  "dataSources.group.offlineDownloads": "Descargas sin conexión",
  "dataSources.group.optionalAi": "IA opcional",
  "dataSources.uk-fcdo.use": "Avisos de viaje oficiales",
  "dataSources.uk-fcdo.network":
    "Se obtiene solo cuando solicitas avisos oficiales",
  "dataSources.uk-fcdo.authority":
    "Aviso oficial del Gobierno británico; escrito para nacionales del Reino Unido",
  "dataSources.us-state.use": "Avisos de viaje oficiales",
  "dataSources.us-state.network":
    "Se obtiene solo cuando solicitas avisos oficiales",
  "dataSources.us-state.authority":
    "Aviso oficial del Gobierno de EE. UU.; escrito para nacionales estadounidenses",
  "dataSources.ca-gac.use": "Avisos de viaje oficiales",
  "dataSources.ca-gac.network":
    "Se obtiene solo cuando solicitas avisos oficiales",
  "dataSources.ca-gac.authority":
    "Aviso oficial del Gobierno canadiense; escrito para nacionales canadienses",
  "dataSources.de-aa.use": "Avisos de viaje oficiales",
  "dataSources.de-aa.network":
    "Se obtiene solo cuando solicitas avisos oficiales",
  "dataSources.de-aa.authority":
    "Aviso oficial del Gobierno alemán; el texto de origen puede permanecer en alemán",
  "dataSources.us-cdc.use": "Avisos de salud para viajeros",
  "dataSources.us-cdc.network": "Se obtiene con el panel de avisos oficiales",
  "dataSources.us-cdc.authority":
    "Avisos oficiales de salud pública de EE. UU.; informativos, no son consejo médico personal",
  "dataSources.open-meteo.use":
    "Geocodificación, tiempo, normales climáticas y calidad del aire",
  "dataSources.open-meteo.network":
    "Se obtiene solo cuando solicitas una instantánea meteorológica o del destino",
  "dataSources.open-meteo.authority":
    "Pronósticos y observaciones históricas; nunca es autoridad sobre seguridad o itinerarios",
  "dataSources.nws.use":
    "Alertas meteorológicas activas de EE. UU. cerca de un destino",
  "dataSources.nws.network":
    "Se obtiene con una instantánea meteorológica solicitada para coordenadas de EE. UU.",
  "dataSources.nws.authority":
    "Fuente oficial de alertas; las marcas de tiempo y el texto de origen permanecen visibles",
  "dataSources.ecb.use": "Tipos de cambio de referencia",
  "dataSources.ecb.network": "Se obtiene con los datos del destino",
  "dataSources.ecb.authority":
    "Tipos de referencia, no un precio minorista de conversión cotizado",
  "dataSources.nager-date.use": "Días festivos",
  "dataSources.nager-date.network":
    "Se obtiene solo cuando solicitas días festivos",
  "dataSources.nager-date.authority":
    "Datos de calendario informativos; nunca son autoridad de entrada o cierres",
  "dataSources.wikimedia.use": "Resúmenes de destinos",
  "dataSources.wikimedia.network":
    "Se obtiene solo cuando solicitas un resumen del lugar",
  "dataSources.wikimedia.authority":
    "Contexto escrito por la comunidad; nunca es autoridad sobre seguridad, precios u horarios",
  "dataSources.openfreemap.use":
    "Estilo de mapa en línea y teselas vectoriales",
  "dataSources.openfreemap.network":
    "Se obtiene solo después de elegir Mostrar mapa sin un mapa base sin conexión",
  "dataSources.openfreemap.authority":
    "Contexto visual del mapa sin afirmar rutas, acceso en vivo ni disponibilidad",
  "dataSources.overture.use": "Lugares de paquetes urbanos sin conexión",
  "dataSources.overture.network":
    "Se descarga solo cuando solicitas un paquete urbano",
  "dataSources.overture.authority":
    "Datos abiertos de lugares; las recomendaciones no afirman horarios, precios ni disponibilidad actuales",
  "dataSources.wikivoyage.use": "Notas urbanas de viaje sin conexión",
  "dataSources.wikivoyage.network":
    "Se descarga solo cuando solicitas un paquete urbano",
  "dataSources.wikivoyage.authority":
    "Contexto de viaje escrito por la comunidad; se muestra separado de los datos de lugares",
  "dataSources.protomaps-osm.use": "Mapas sin conexión",
  "dataSources.protomaps-osm.network":
    "Se descarga solo cuando solicitas el mapa sin conexión de un paquete urbano",
  "dataSources.protomaps-osm.authority":
    "Contexto de mapa base; no es autoridad sobre rutas, acceso u horarios",
  "dataSources.geonames.use": "Autocompletado de ciudades incluido",
  "dataSources.geonames.network":
    "Incluido con la app; sin solicitudes durante el uso",
  "dataSources.geonames.authority": "Solo autocompletado de topónimos",
  "dataSources.ourairports.use": "Búsqueda incluida de aeropuertos cercanos",
  "dataSources.ourairports.network":
    "Incluido con la app; sin solicitudes durante el uso",
  "dataSources.ourairports.authority":
    "Solo proximidad geográfica de aeropuertos; no disponibilidad de vuelos",
  "dataSources.wikidata-heritage.use":
    "Búsqueda incluida de sitios del Patrimonio Mundial",
  "dataSources.wikidata-heritage.network":
    "Incluido con la app; sin solicitudes durante el uso",
  "dataSources.wikidata-heritage.authority":
    "Consulta práctica de una extracción fechada; no es un registro completo de la UNESCO",
  "dataSources.ollama.use": "Asistencia opcional de IA en el dispositivo",
  "dataSources.ollama.network":
    "Se usa solo después de una vista previa y consentimiento explícito; las solicitudes permanecen en localhost",
  "dataSources.ollama.authority":
    "Solo asistencia para borradores; nunca es un segundo pronóstico ni autoridad de reservas",
  "dataSources.openai.use":
    "Asistencia opcional en la nube con tu propia clave",
  "dataSources.openai.network":
    "La vista previa redactada exacta se envía solo después de una vista previa y consentimiento explícito",
  "dataSources.openai.authority":
    "Solo asistencia para borradores; el resultado sigue siendo no confiable y ligado a la evidencia",
  "dataSources.anthropic.use":
    "Asistencia opcional en la nube con tu propia clave",
  "dataSources.anthropic.network":
    "La vista previa redactada exacta se envía solo después de una vista previa y consentimiento explícito",
  "dataSources.anthropic.authority":
    "Solo asistencia para borradores; el resultado sigue siendo no confiable y ligado a la evidencia",
  "advice.title": "Aviso de viaje oficial",
  "advice.announce.saved": "Aviso oficial para {country} guardado.",
  "advice.stale":
    "Obtenido hace {days} días; vuelve a obtenerlo antes de confiar en él",
  "advice.fresh": "Obtenido recientemente",
  "advice.readMore": "Lee el aviso completo en la fuente",
  "advice.retrieved": "Obtenido {stamp}",
  "advice.sourceUpdated": "Fuente actualizada {stamp}",
  "advice.crossSource":
    "Cada gobierno escribe para sus propios ciudadanos y usa su propio lenguaje y niveles de alerta. Compara las fuentes, no los números.",
  "advice.healthNotices": "Avisos de salud (US CDC)",
  "advice.healthNotices.licence":
    "Avisos de salud para viajes de los Centros para el Control y la Prevención de Enfermedades de EE. UU. (dominio público). Solo informativo.",
  "advice.status.kept":
    "{source}: no se pudo acceder; mostrando la última copia guardada",
  "advice.status.unavailable": "{source}: no disponible en este momento",
  "advice.status.notPublished": "{source} no publica avisos para este destino",
  "advice.selectLabel": "País para obtener el aviso oficial",
  "advice.chooseCountry": "Elige un país…",
  "advice.fetchAgain": "Obtener de nuevo",
  "advice.fetch": "Obtener aviso oficial",
  "advice.consent":
    "Obtener datos contacta a las fuentes gubernamentales del Reino Unido, EE. UU., Canadá y Alemania, así como al CDC de EE. UU. una sola vez desde este dispositivo y guarda una copia con fecha localmente. Nada sobre tu viaje sale de este dispositivo.",
  "weather.title": "Pronóstico del tiempo",
  "weather.announce.saved": "Pronóstico para {place} guardado.",
  "weather.stale":
    "Obtenido hace {hours} horas; vuelve a obtenerlo para ver los números actuales",
  "weather.fresh": "Obtenido recientemente",
  "weather.rain": "{pct}% de lluvia",
  "weather.coverage.none":
    "Los pronósticos solo llegan hasta 16 días; tu viaje aún no está cubierto. Vuelve a obtenerlo cuando se acerque la fecha de salida.",
  "weather.coverage.partial":
    "Los pronósticos solo llegan hasta 16 días, por lo que solo la primera parte de tu viaje está cubierta. Los días posteriores aparecerán conforme se acerque la salida.",
  "weather.attribution": "Datos meteorológicos de Open-Meteo.com",
  "weather.retrieved": "Obtenido {stamp}",
  "weather.fetchAgain": "Obtener de nuevo",
  "weather.fetch": "Obtener pronóstico del tiempo",
  "weather.consent":
    "Obtener datos envía el nombre de tu destino (“{destination}”) a open-meteo.com para ubicarlo en el mapa, luego recupera el pronóstico, el historial para tus fechas y la calidad del aire. Para destinos en EE. UU., también solicita alertas activas al Servicio Meteorológico Nacional. Nada más sobre tu viaje sale de este dispositivo.",
  "facts.title": "Datos del destino",
  "facts.fetch": "Obtener datos del destino",
  "facts.fetchAgain": "Obtener de nuevo",
  "facts.consent":
    "Obtener datos envía tu destino (“{destination}”) y el nombre de tu lugar de origen a open-meteo.com para ubicarlos en el mapa, y solicita al Banco Central Europeo los tipos de cambio de referencia de hoy. La diferencia horaria, el sol, la luna, los datos del país y los aeropuertos cercanos se calculan en este dispositivo. Nada más sobre tu viaje sale de él.",
  "facts.retrieved": "Obtenido {stamp}",
  "facts.clock.title": "Diferencia horaria",
  "facts.clock.ahead": "{destination} está {duration} por delante de {origin}",
  "facts.clock.behind": "{destination} está {duration} por detrás de {origin}",
  "facts.clock.same": "{destination} tiene la misma hora que {origin}",
  "facts.clock.hours": "{hours}h",
  "facts.clock.hoursMinutes": "{hours}h {minutes}m",
  "facts.sky.title": "Cielo",
  "facts.sky.sun": "{sunrise} – {sunset}",
  "facts.sky.dayLength": "{hours}h {minutes}m de luz solar",
  "facts.polar.day": "Sol de medianoche: el sol no se pone",
  "facts.polar.night": "Noche polar: el sol no sale",
  "facts.sky.moon": "{phase} · {pct}% iluminada",
  "facts.money.title": "Dinero",
  "facts.money.rate": "1 {from} = {value} {to}",
  "facts.money.indicative":
    "Tasas de referencia del Banco Central Europeo para {date} — son indicativas, no la tasa que aplicará tu tarjeta o un cajero automático.",
  "facts.money.noRate":
    "No hay tasa de referencia publicada para {currency}. Verifícalo localmente antes de viajar.",
  "facts.practical.title": "Información práctica",
  "facts.practical.plug": "Enchufes {types} · {voltage} V · {frequency} Hz",
  "facts.practical.driveLeft": "Conducción por la izquierda",
  "facts.practical.driveRight": "Conducción por la derecha",
  "facts.practical.calling": "Código de llamada {code}",
  "facts.practical.emergency": "Emergencias {number}",
  "facts.practical.emergencyServices":
    "Policía {police} · Ambulancia {ambulance} · Bomberos {fire}",
  "facts.practical.none":
    "Voyalier aún no tiene información práctica para este destino.",
  "facts.tipping.title": "Propinas",
  "facts.tipping.note":
    "Una guía aproximada: las costumbres varían y cambian; si tienes dudas, dejar una propina pequeña o ninguna suele ser aceptable.",
  "facts.airports.title": "Aeropuertos cercanos",
  "facts.airports.row": "{iata} · {name}",
  "facts.airports.distance": "{km} km",
  "facts.heritage.title": "Patrimonio de la Humanidad cercano",
  "facts.heritage.rowYear": "{name} · inscrito en {year}",
  "holidays.title": "Días festivos",
  "holidays.fetch": "Obtener días festivos",
  "holidays.fetchAgain": "Obtener de nuevo",
  "holidays.retrieved": "Obtenido el {stamp}",
  "holidays.nameLocal": "{name} ({localName})",
  "holidays.regional": "· regional",
  "holidays.none": "No hay días festivos en {country} durante tu viaje.",
  "holidays.consent":
    "Al obtenerlos, se envía el nombre de tu destino (“{destination}”) a open-meteo.com para ubicarlo en un país y luego se solicita a Nager.Date los días festivos de ese país. Nada más sobre tu viaje sale de aquí.",
  "about.title": "Sobre este lugar",
  "about.fetch": "Obtener resumen",
  "about.fetchAgain": "Obtener de nuevo",
  "about.retrieved": "Obtenido el {stamp}",
  "about.attribution": "Resumen de Wikipedia, bajo licencia CC BY-SA.",
  "about.readMore": "Leer más sobre {title} →",
  "about.consent":
    "Al obtenerlo, se solicita a Wikipedia (en.wikipedia.org) un breve resumen de “{destination}”. Nada más sobre tu viaje sale de aquí.",
  "moon.new_moon": "Luna nueva",
  "moon.waxing_crescent": "Luna creciente",
  "moon.first_quarter": "Cuarto creciente",
  "moon.waxing_gibbous": "Gibosa creciente",
  "moon.full_moon": "Luna llena",
  "moon.waning_gibbous": "Gibosa menguante",
  "moon.last_quarter": "Cuarto menguante",
  "moon.waning_crescent": "Luna menguante",
  "weather.normals.title": "Típico para estas fechas",
  "weather.normals.range": "Normalmente entre {low} y {high}°C",
  "weather.normals.sample": "{days} días en {years} años ({from}–{to})",
  "weather.normals.wet": "El {pct}% de los días tienen lluvia",
  "weather.normals.extremes": "Rango registrado: {coldest}°C a {warmest}°C",
  "weather.uv": "UV {value}",
  "weather.aqi": "AQI {value}",
  "weather.alerts.title": "Alertas oficiales",
  "weather.alerts.attribution":
    "Dominio público (U.S. National Weather Service). Se muestra textualmente; verifica la fuente antes de confiar en ella.",
  "weather.alerts.area": "Afecta a {area}",
  "packing.title": "Qué llevar",
  "packing.intro":
    "Se calcula a partir del historial meteorológico anterior y tus planes confirmados. Son sugerencias, no una lista de equipaje.",
  "packing.warm_layers": "Ropa de abrigo",
  "packing.light_clothing": "Ropa ligera",
  "packing.rain_shell": "Chaqueta impermeable",
  "packing.sun_protection": "Protección solar",
  "packing.mask": "Una mascarilla",
  "packing.travel_documents": "Documentos de viaje",
  "packing.laundry": "Kit de lavandería",
  "packing.reason.avg_low": "La mínima típica es de {value}°C",
  "packing.reason.avg_high": "La máxima típica es de {value}°C",
  "packing.reason.wet_day_share":
    "El {value}% de los días típicos tienen lluvia",
  "packing.reason.uv_index": "El índice UV alcanza {value}",
  "packing.reason.aqi": "El índice de calidad del aire alcanza {value}",
  "packing.reason.has_flight": "Tienes un vuelo confirmado",
  "packing.reason.nights": "{value} noches fuera",
  "assist.title": "Vista previa de la solicitud de IA",
  "assist.intro":
    "Mira exactamente lo que Voyalier enviaría a un proveedor para este viaje. Nunca se incluyen códigos de confirmación ni nombres de viajeros, y no se envía nada.",
  "assist.readonly":
    'Esto te da una respuesta de solo lectura; no cambiará tu viaje. Para que la IA complete las fechas de alojamiento de una reserva importada, usa "Completar con IA local" abajo.',
  "assist.provider.ollama": "Ollama (en el dispositivo)",
  "assist.provider.openai": "OpenAI",
  "assist.provider.anthropic": "Anthropic",
  "assist.selectLabel": "Proveedor para vista previa",
  "assist.preview": "Vista previa de la solicitud",
  "assist.announce.previewCloud":
    "Vista previa lista. Esta solicitud saldría de tu dispositivo hacia {provider}.",
  "assist.announce.previewLocal":
    "Vista previa lista. Esta solicitud se ejecutaría localmente en este dispositivo.",
  "assist.route.cloud":
    "Esta solicitud saldría de tu dispositivo hacia {provider}.",
  "assist.route.local":
    "Esta solicitud se ejecutaría localmente en este dispositivo a través de {provider}.",
  "assist.model": "Modelo: {model}",
  "assist.grounded": "Basado en {sources}",
  "assist.grounding.flight.one": "1 vuelo confirmado",
  "assist.grounding.flight.other": "{count} vuelos confirmados",
  "assist.grounding.stay.one": "1 estancia confirmada",
  "assist.grounding.stay.other": "{count} estancias confirmadas",
  "assist.grounding.document.one": "1 documento importado",
  "assist.grounding.document.other": "{count} documentos importados",
  "assist.grounding.tripDates": "fechas del viaje",
  "assist.grounding.noDocuments": "aún no hay documentos importados",
  "assist.grounding.confirmedEvidence": "datos confirmados del viaje",
  "assist.noGrounding": "Aún no hay planes confirmados para usar como base",
  "assist.tokens": "~{tokens} tokens",
  "assist.systemInstruction": "Instrucción del sistema",
  "assist.tripDetails": "Detalles del viaje que incluiría",
  "assist.withheld": "Omitido de la solicitud",
  "assist.send": "Enviar a {provider}",
  "assist.runLocal": "Ejecutar asistencia en el dispositivo",
  "assist.note":
    "Esto envía la solicitud anterior a {provider} usando tu clave guardada. Si no tienes una, agrégala primero en proveedores de IA.",
  "assist.reply": "Respuesta de {model}",
  "assist.disclaimer":
    "Generado por IA a partir de tus planes confirmados. Voyalier nunca lo trata como una fuente autorizada. Verifica cualquier dato importante —requisitos de entrada, salud o seguridad— con una fuente oficial.",
  "assist.announce.finished": "Asistencia finalizada con {model}.",
  "assist.recentRuns": "Ejecuciones recientes",
  "assist.log.aria": "Registro de actividad de asistencia",
  "assist.scope":
    "La vista previa muestra exactamente lo que se enviaría. Las ejecuciones locales permanecen en este dispositivo mediante Ollama; las de la nube envían la solicitud a tu proveedor elegido usando tu clave guardada. Cada ejecución completada aparece arriba.",
  "draft.title": "Completar con IA local",
  "draft.intro":
    "Si una reserva importada tiene fechas de alojamiento que no se detectaron, tu IA local puede proponerlas a partir del texto. Se ejecuta en este dispositivo —nada sale— y cada sugerencia es un borrador que revisas antes de guardar nada.",
  "draft.route":
    "Se ejecuta en este dispositivo vía Ollama; nada sale de tu dispositivo.",
  "draft.preview": "Vista previa de lo que lee",
  "draft.reads": "Lo que leería",
  "draft.instruction": "Instrucción",
  "draft.run": "Proponer fechas de alojamiento",
  "draft.none":
    "No se encontraron fechas de alojamiento faltantes en el texto importado.",
  "draft.needDocs":
    "Importa una reserva primero; aún no hay texto para que la IA lo lea.",
  "draft.announce.drafted.one":
    "Se creó {count} sugerencia de alojamiento para revisar.",
  "draft.announce.drafted.other":
    "Se crearon {count} sugerencias de alojamiento para revisar.",
  "draft.scope":
    "Solo en el dispositivo. Voyalier redacta fechas a partir de tu propio texto importado; nunca inventa precios, visas, detalles de salud o seguridad, y nada se guarda hasta que lo revises.",
  "tripcard.facts.one": "dato confirmado",
  "tripcard.facts.other": "datos confirmados",
  "tripcard.pending.one": "sugerencia pendiente",
  "tripcard.pending.other": "sugerencias pendientes",
  "triplist.showArchived.one": "Mostrar {count} viaje archivado",
  "triplist.showArchived.other": "Mostrar {count} viajes archivados",
  "localai.running.one":
    "Ollama está ejecutándose con {count} modelo instalado. Voyalier puede usarlo para asistencia opcional y privada; nada sale de tu dispositivo.",
  "localai.running.other":
    "Ollama está ejecutándose con {count} modelos instalados. Voyalier puede usarlos para asistencia opcional y privada; nada sale de tu dispositivo.",
  "search.matches.one": "{count} coincidencia para {query}.",
  "search.matches.other": "{count} coincidencias para {query}.",
  "import.review.one": "Revisar {count} sugerencia",
  "import.review.other": "Revisar {count} sugerencias",
  "import.found.one":
    "Voyalier encontró {count} nueva sugerencia para revisar; nada cambia hasta que confirmes.",
  "import.found.other":
    "Voyalier encontró {count} nuevas sugerencias para revisar; nada cambia hasta que confirmes.",
  "review.count.one": "{count} sugerencia para revisar",
  "review.count.other": "{count} sugerencias para revisar",
  "packs.places.one": "{count} lugar",
  "packs.places.other": "{count} lugares",
  "packs.notes.one": "{count} nota",
  "packs.notes.other": "{count} notas",
  "packs.offline": "sin conexión",
  "packs.offlineMap": "mapa sin conexión listo",
  "recs.announce.count.one": "{count} recomendación.",
  "recs.announce.count.other": "{count} recomendaciones.",
  "detail.back": "Todos los viajes",
  "detail.loading": "Cargando viaje…",
  "detail.backToTrips": "Volver a viajes",
  "detail.status": "Estado: ",
  "detail.import": "Importar",
  "detail.edit": "Editar",
  "detail.unarchive": "Desarchivar",
  "detail.announce.updated": "Viaje actualizado.",
  "detail.announce.unarchived": "Viaje desarchivado.",
  "detail.addFact": "Añadir vuelo o estancia",
  "detail.shareBrief": "Compartir resumen",
  "detail.archive": "Archivar",
  "detail.delete": "Eliminar",
  "detail.pending.desc":
    "Confirma o descarta lo que Voyalier encontró en tus documentos.",
  "detail.nopending":
    "No hay sugerencias pendientes. Importa un documento para encontrar más.",
  "detail.blueprint": "Blueprint",
  "detail.blueprint.sub": "Tus vuelos y estancias confirmados, en orden.",
  "detail.empty.title": "Tu Blueprint está vacío",
  "detail.importDocument": "Importar un documento",
  "detail.empty.body":
    "Los vuelos y estancias confirmados aparecerán aquí en el orden del itinerario. Importa una confirmación o añade un dato manualmente para comenzar.",
  "detail.edited": "Editado antes de confirmar: {fields}",
  "detail.unconfirm": "Volver a revisar",
  "detail.remove": "Eliminar",
  "detail.announce.archived": "Viaje archivado.",
  "detail.announce.unconfirmed": "{fact} volvió a revisión.",
  "detail.announce.removed": "{fact} eliminado.",
  "detail.announce.added": "{fact} añadido.",
  "readiness.title": "Preparación",
  "readiness.checkYourself": "Compruébalo tú mismo",
  "readiness.scope":
    "Esto comprueba qué tan completo está tu plan y te dirige a fuentes oficiales. Voyalier nunca afirma ni da por cumplidos requisitos de entrada, salud o seguridad; confírmalos siempre con la fuente oficial.",
  "readiness.label.not_checked": "No iniciado",
  "readiness.label.clear": "En orden",
  "readiness.label.monitor": "Revisar pronto",
  "readiness.label.action_needed": "Atención necesaria",
  "readiness.label.critical": "Crítico",
  "readiness.check.schedule_conflicts": "Conflictos de horario",
  "readiness.check.lodging_coverage": "Cobertura de alojamiento",
  "readiness.check.pending_review": "Sugerencias para revisar",
  "readiness.check.entry_requirements": "Requisitos de entrada y viaje",
  "readiness.check.health_notices": "Avisos de salud",
  "readiness.finding.no_facts_yet":
    "Agrega vuelos o estancias para verificar traslapes.",
  "readiness.finding.schedule_conflicts.one":
    "{count} conflicto de horario para resolver.",
  "readiness.finding.schedule_conflicts.other":
    "{count} conflictos de horario para resolver.",
  "readiness.finding.schedule_notices.one":
    "{count} aviso de horario para revisar.",
  "readiness.finding.schedule_notices.other":
    "{count} avisos de horario para revisar.",
  "readiness.finding.schedule_clear":
    "No hay traslapes en tus planes confirmados.",
  "readiness.finding.no_lodging_yet": "Aún no has añadido alojamiento.",
  "readiness.finding.lodging_gaps":
    "Algunas noches de tu viaje no tienen alojamiento reservado.",
  "readiness.finding.lodging_clear":
    "Todas las noches de tu viaje tienen alojamiento.",
  "readiness.finding.pending_review.one":
    "{count} sugerencia importada esperando revisión.",
  "readiness.finding.pending_review.other":
    "{count} sugerencias importadas esperando revisión.",
  "readiness.finding.nothing_pending": "No hay nada pendiente por revisar.",
  "readiness.linkOnly.entry_requirements":
    "Los requisitos dependen de tu nacionalidad y cambian con frecuencia. Confírmalos en una fuente gubernamental oficial antes de viajar; Voyalier enlaza a fuentes oficiales y nunca afirma ni autoriza reglas de entrada.",
  "readiness.linkOnly.health_notices":
    "Los consejos de vacunación y salud dependen de tu destino y estado de salud, y cambian con frecuencia. Consulta una fuente oficial antes de viajar; Voyalier enlaza a fuentes oficiales y nunca ofrece asesoría médica.",
  "schedule.title": "Revisión de horario",
  "schedule.clear": "No se encontraron conflictos en tus planes confirmados.",
  "schedule.conflict": "Conflicto",
  "schedule.notice": "Aviso",
  "schedule.label.flight_number": "Vuelo {number}",
  "schedule.label.flight_route": "Vuelo {from}→{to}",
  "schedule.label.flight": "Un vuelo",
  "schedule.label.lodging_property": "{property}",
  "schedule.label.lodging": "Una estancia de alojamiento",
  "schedule.flight_overlap":
    "{first} y {second} se traslapan en el tiempo; un viajero solo puede estar en un vuelo a la vez.",
  "schedule.lodging_overlap":
    "{first} y {second} se traslapan; dos estancias cubren la misma noche.",
  "schedule.lodging_gap.one":
    "No hay alojamiento reservado para la noche del {first}.",
  "schedule.lodging_gap.other":
    "No hay alojamiento reservado para las noches del {first} al {last}.",
  "schedule.planned_item_overlap":
    "Tus planes “{first}” y “{second}” se superponen. Verifica si esto es intencional.",
  "schedule.planned_item_fact_overlap":
    "Tu plan “{plan}” se traslapa con {fact}. Verifica si es intencional; el estado de preparación no ha cambiado.",
  "map.title": "Mapa",
  "map.intro":
    "Mira tu destino y los lugares recomendados en un mapa. Un mapa base sin conexión descargado permanece en este dispositivo; de lo contrario, mostrar el mapa descarga mosaicos desde OpenFreeMap. No se envía información sobre tu viaje.",
  "map.show": "Mostrar mapa",
  "map.aria": "Mapa del viaje",
  "map.scope":
    "Mapa base © OpenFreeMap · datos del mapa © colaboradores de OpenStreetMap.",
  "map.scope.offline":
    "Mapa base sin conexión de {source} · datos del mapa © colaboradores de OpenStreetMap. No se envió ninguna solicitud de mosaico fuera de este dispositivo.",
  "map.scope.empty":
    "Descarga un paquete de ciudad y obtén recomendaciones para ver lugares aquí.",
  "map.error.load":
    "El mapa no pudo iniciarse aquí. El resto de las funciones de tu viaje siguen funcionando.",
  "map.error.webgl":
    "Este dispositivo o navegador no puede mostrar el mapa (sin WebGL). El resto de las funciones de tu viaje siguen funcionando.",
  "theme.label": "Tema de color",
  "theme.light": "Claro",
  "theme.system": "Sistema",
  "theme.dark": "Oscuro",
  "settings.title": "Configuración",
  "settings.intro":
    "Todo lo que aparece aquí se aplica a Voyalier en su totalidad, no a un viaje individual.",
  "settings.appearance": "Apariencia",
  "settings.appearance.hint":
    "El sistema sigue la configuración de tu computadora.",
  "settings.language": "Idioma",
  "settings.language.hint":
    "El sistema sigue la configuración de tu computadora. Esta preferencia solo se mantiene en esta aplicación en este dispositivo.",
  "settings.language.system": "Sistema",
  "settings.back": "Volver",
  "topbar.settings": "Configuración",
  "assist.needsSetup": "Configura la IA en Ajustes para usar esta función.",
  "assist.needsSetup.link": "Abrir Ajustes",
  "sample.explore": "Explorar un viaje de ejemplo",
  "sample.hint":
    "Datos ficticios que puedes eliminar. No se envía nada a ningún lugar.",
  "sample.building": "Creando…",
  "sample.error": "No se pudo generar el viaje de ejemplo.",
  "sample.title": "Ejemplo: Fin de semana largo en Kioto",
  "sample.origin": "San Francisco",
  "sample.destination": "Kioto",
  "sample.document": "Correo de confirmación de ejemplo",
  "notes.title": "Notas",
  "notes.intro":
    "Cualquier cosa que quieras recordar: planes a medias, un restaurante que alguien mencionó, qué reservar después.",
  "notes.excluded":
    "Se mantienen en este dispositivo y están cifradas. Nunca se incluyen en un resumen compartido ni se envían a un proveedor de IA.",
  "notes.label": "Notas del viaje",
  "notes.placeholder": "Empieza a escribir…",
  "notes.saving": "Guardando…",
  "notes.saved": "Guardado",
  "notes.error": "No se pudieron guardar tus notas; siguen aquí, intactas.",
  "notes.tooLong":
    "Eso es más largo de lo que Voyalier puede almacenar. No se guardó nada.",
  "ics.export": "Exportar calendario",
  "ics.exporting": "Preparando…",
  "ics.error": "No se pudo generar el archivo de calendario.",
  "ics.done": "Archivo de calendario guardado.",
  "ics.summary.flight": "Vuelo {flight}",
  "ics.summary.stay": "Estancia — {property}",
  "ics.description":
    "Exportado desde Voyalier. Las horas son las que aparecen en tu confirmación, sin zona horaria; Voyalier no la asume, por lo que tu calendario las mostrará en su propia hora local. No se incluyen códigos de confirmación ni nombres de viajeros.",
  "documents.title": "Documentos importados",
  "documents.intro":
    "Las confirmaciones que trajiste. Voyalier conserva el texto original para que puedas verificar qué leyó y eliminarlo cuando quieras.",
  "documents.empty": "Aún no has importado nada.",
  "documents.empty.hint":
    "Importa una confirmación y el original se guardará aquí.",
  "documents.error": "No se pudieron cargar tus documentos.",
  "documents.imported": "Importado el {date}",
  "documents.size.one": "{count} carácter",
  "documents.size.other": "{count} caracteres",
  "documents.counts.pending.one": "{count} pendiente de revisión",
  "documents.counts.pending.other": "{count} pendientes de revisión",
  "documents.counts.confirmed.one": "{count} confirmado",
  "documents.counts.confirmed.other": "{count} confirmados",
  "documents.view": "Mostrar original",
  "documents.hide": "Ocultar original",
  "documents.viewError": "No se pudo abrir ese documento.",
  "documents.remove": "Eliminar",
  "documents.removeError": "No se pudo eliminar ese documento.",
  "documents.removed": "Se eliminó {label}.",
  "documents.removeWarning.pending.one":
    "Su sugerencia pendiente de revisión también se eliminará.",
  "documents.removeWarning.pending.other":
    "Sus {count} sugerencias pendientes de revisión también se eliminarán.",
  "documents.removeWarning.confirmed":
    "Los datos que ya confirmaste permanecerán en tu viaje, pero perderán su evidencia.",
  "documents.sourceRemoved": "Documento fuente eliminado",
  "documents.kind.pasted_text": "Texto pegado",
  "documents.kind.html": "HTML",
  "documents.kind.email": "Correo electrónico",
  "tripnav.label": "Ir a una sección",
  "tripnav.plan": "Planificar",
  "tripnav.prepare": "Preparar",
  "tripnav.discover": "Descubrir",
  "tripnav.ai": "IA",
  "dialog.close": "Cerrar diálogo",
  "updates.title": "Actualizaciones",
  "updates.current": "Versión {version}",
  "updates.check": "Buscar actualizaciones",
  "updates.checking": "Buscando actualizaciones…",
  "updates.upToDate": "Tienes la última versión ({version}).",
  "updates.consent.title": "¿Buscar actualizaciones automáticamente?",
  "updates.consent.body":
    "Voyalier puede consultar GitHub una vez al día para buscar nuevas versiones. Solo se obtienen metadatos de la versión; no se envía información sobre ti ni sobre tus viajes.",
  "updates.consent.yes": "Sí, buscar automáticamente",
  "updates.consent.no": "No, lo haré manualmente",
  "updates.available.title": "Actualización disponible: {version}",
  "updates.available.body":
    "Hay una nueva versión lista para descargar e instalar. Tus viajes permanecerán en este dispositivo.",
  "updates.install": "Descargar e instalar",
  "updates.installWin": "Actualizar y reiniciar",
  "updates.installWin.note":
    "Voyalier se cerrará, se actualizará y se volverá a abrir (en menos de un minuto).",
  "updates.installing": "Descargando actualización…",
  "updates.installingWin":
    "Instalando — Voyalier se cerrará y se volverá a abrir.",
  "updates.progress.aria": "Progreso de descarga de la actualización",
  "updates.progress.percent": "{percent}% descargado",
  "updates.progress.indeterminate": "Descargando…",
  "updates.skip": "Omitir esta versión",
  "updates.skipped": "Omitiste esta versión.",
  "updates.unskip": "Deshacer omisión",
  "updates.notes.heading": "Notas de GitHub (no verificadas)",
  "updates.staged.title": "Actualización instalada",
  "updates.staged.body":
    "Reinicia Voyalier para finalizar la actualización a {version}.",
  "updates.restart": "Reiniciar Voyalier",
  "updates.error.offline":
    "Estás sin conexión. Reconéctate e inténtalo de nuevo.",
  "updates.error.generic":
    "No se pudo buscar actualizaciones; GitHub podría estar ocupado o inaccesible.",
  "updates.retry": "Reintentar",
  "updates.releases": "Ver versiones en GitHub",
  "updates.disabled":
    "Esta es una versión de desarrollo; las actualizaciones internas están desactivadas.",
  "updates.unsupported.title":
    "Las actualizaciones internas no están disponibles aquí",
  "updates.unsupported.source":
    "¿Ejecutas Voyalier desde el código fuente? Actualiza desde el repositorio: git pull y luego make bootstrap.",
  "updates.unsupported.download":
    "O descarga la aplicación de escritorio empaquetada.",
  "updates.pill.available": "Actualización disponible",
  "updates.pill.staged": "Reiniciar para actualizar",
  "updates.autocheck": "Buscar actualizaciones automáticamente",
  "updates.clearBackups": "Borrar copias de seguridad de actualización",
  "updates.backupsCleared.one": "Se borró {count} copia de seguridad.",
  "updates.backupsCleared.other": "Se borraron {count} copias de seguridad.",
  "updates.justUpdated": "Actualizado a Voyalier {version}.",
  "updates.dismiss": "Descartar",
};

// Distributes over the MessageKey union, keeping only keys with a `.one`
// plural form and stripping the suffix — so `PluralBase` is exactly the set of
// valid `plural()` bases, auto-derived from the catalog. A typo'd base is now a
// compile error (previously `plural(base: string)` silently returned the base).
type PluralBaseOf<K> = K extends `${infer Base}.one` ? Base : never;
export type PluralBase = PluralBaseOf<MessageKey>;

// Shipped catalogs are exhaustive; the wider lookup type preserves the locale
// chain's safe English fallback for unshipped browser locale variants.
export const catalogs = {
  en,
  es,
} satisfies Record<"en" | "es", Record<MessageKey, string>>;
const catalogLookup: Record<
  string,
  Partial<Record<MessageKey, string>>
> = catalogs;

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
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole;
    const value = vars[name];
    return typeof value === "number"
      ? new Intl.NumberFormat(APP_LOCALE).format(value)
      : String(value);
  });
}

/**
 * Translate a message key for the active locale, interpolating `{name}` vars.
 * Falls back along the locale chain to the English source, which is exhaustive,
 * so a value is always returned.
 */
export function t(key: MessageKey, vars?: Vars): string {
  for (const locale of localeChain(APP_LOCALE)) {
    const value = catalogLookup[locale]?.[key];
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
    const catalog = catalogLookup[locale] as Record<string, string> | undefined;
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
