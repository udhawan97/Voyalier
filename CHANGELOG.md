# Changelog

All notable changes will be documented here once Voyalier begins publishing releases.

The project follows Semantic Versioning and keeps unreleased work under the section below.

## [Unreleased]

## [0.5.0] - 2026-07-20 — The traveler-owned planning release

### Added

- **Saved interests and places now survive the planning session.** Persona
  weights persist per trip after a dedicated save action, and a recommendation
  can be explicitly shortlisted with its name, coordinates, reasons, source,
  license, and private notes. A saved place survives removal of its source pack
  and says when that pack is no longer available; **Add to plan** only prefills
  the traveler-authored form, which must still be reviewed and submitted.
- **Packing suggestions now lead to an actual checklist.** Evidence-backed
  suggestions remain suggestions until the traveler clicks **Add**, while custom
  items, checked state, and removal persist locally. Voyalier still does not
  auto-pack, infer personal needs, or claim the list is complete.
- **Activities, rail legs, and transfers fill the space between
  confirmations.** Traveler-authored items can be added, edited, timed, and
  removed without inheriting evidence authority. Literal time overlaps are
  notices—not readiness failures—and title, location, and local time can appear
  in Today, the printable brief, and calendar export while private notes are
  excluded by construction.
- **Workspace search now reaches across every trip.** One local query searches
  imported documents, confirmed facts, trip notes, saved places, and manual plan
  items with bounded snippets and explicit trip/source provenance. Pending
  extraction candidates stay out until reviewed, and no index or query leaves
  the device.
- **Settings now carries a source and license register.** The product-visible
  table and its shared Rust/TypeScript golden name the major official,
  open-data, map, weather, and reference inputs plus the authority each one does
  and does not have. It is a shipped register, not a promise that every source
  is live or authoritative for a particular trip.
- **Nashville, Kyoto, Tokyo, and Paris now have verified offline-map targets.**
  The publisher builds every catalog-enabled PMTiles slice in one run, retries
  lower zooms to stay below the hard size bound, verifies each archive, and
  writes one complete manifest. Other catalog cities continue to use the
  explicit online fallback until their own bounded extract is enabled.
- **Spanish is available as an immediate local preference.** Settings offers
  System, English, and Español; changing it rerenders the visible application
  without a reload and persists only in local storage. Every English message
  has a reviewed Spanish counterpart with matching placeholders and plural
  forms, so secondary workflows no longer fall back to English.
- **A real-browser acceptance layer now runs in the release gate.** Playwright
  starts disposable SQLite and the real Axum + Vite stack, then drives trip
  creation, Today, checklist state, manual planning, workspace search,
  data-source settings, the Spanish switch, and reload persistence in Chromium.
  It complements—not replaces—the Rust, live Axum serialization,
  transport-parity, component, accessibility, and packaged-app checks.

- **Back up your whole workspace, and restore it anywhere.** Voyalier keeps
  everything on your device, which meant a lost computer was lost trips — and the
  optional vault passphrase has no recovery. Settings now saves your entire
  workspace to a single encrypted `.vbk` file: trips, imported confirmations,
  confirmed facts, notes, and offline packs. You choose a backup passphrase, and
  the **whole** file is sealed under it, so even trip names and dates are
  unreadable without it. The file also carries your workspace's encryption key,
  re-wrapped under that passphrase — which is what lets a backup open on a
  **different** computer, where the original keychain key never existed.
  Restoring replaces your workspace rather than merging into it, and happens in
  two deliberate steps: picking the file and passphrase only **stages** it,
  changing nothing, and the swap runs at the next launch before the database
  opens. Your current data is snapshotted first, so a restore you did not mean is
  recoverable. A backup from a newer Voyalier is refused rather than half-read;
  an older one migrates forward. Downloaded maps and AI provider keys are
  deliberately left out — maps re-download, and third-party keys stay in your
  keychain instead of travelling in a file — and the app says so rather than
  letting you find out later.
- **A tipping guide on the destination-facts card.** The card now shows a short,
  conservative note on tipping customs for the destination country — worked out
  on your device from a bundled table. It's framed as a rough guide (customs
  vary and change), never a rule, and never affects your trip's readiness.
- **"About this place" — a short summary of your destination.** One click
  fetches a plain-language summary of where you're going from Wikipedia, shown
  with attribution and a link to read more. The words stay Wikipedia's (licensed
  CC BY-SA), never rewritten as Voyalier's own or treated as a safety claim.
- **World Heritage sites near your destination.** The destination-facts card now
  lists the UNESCO World Heritage sites closest to where you're going — with the
  year each was inscribed and how far away it is — worked out on your device from
  a bundled list of the world's ~940 sites (from Wikidata) and the coordinates
  the card already resolved. No network; a nearby-notable list, not a claim of
  completeness.
- **Public holidays during your trip.** One click fetches the destination
  country's public holidays (from Nager.Date) and shows the ones that fall
  within your travel dates — with their local-language names — so a closed-bank,
  closed-shops day doesn't catch you out. It's informational and never changes
  your trip's readiness; a date or destination change refetches.
- **The time difference from home, on the destination-facts card.** The card now
  says how far your destination runs ahead of (or behind) where you're leaving
  from — "Kyoto is 14h ahead of Chicago" — worked out on your device from both
  places' time zones on your travel dates. Fetching the card now also asks the
  map for your origin's time zone; if the origin can't be placed the line is
  simply left off. Sub-hour zones (India, Nepal) keep their exact minutes, and
  a matching zone reads "same time" rather than nothing.
- **Destination autocomplete that knows the world's cities, offline.** Typing a
  place used to suggest only the 16 city packs and your own past trips, so most
  destinations got nothing. Now the origin and destination fields match against
  a bundled gazetteer of ~32,000 cities (GeoNames), ranked by population and
  matched with or without accents — "zur" and "zue" both find Zürich — entirely
  on your device, no per-keystroke network lookup. Your own places and the city
  packs still come first, and free text you type always works.
- **Nearest airports, offline.** The destination-facts card now lists the
  airports closest to where you're going — code, name, and how far — worked out
  on your device from a bundled list of the world's scheduled-service airports
  and the coordinates the card already resolved. No network, and it shows the
  distance as a plain fact rather than telling you which airport is "best".
- **A destination-facts card: the sky, the money, and the practical stuff.** One
  click now answers the small questions every trip raises. **Sky** shows
  sunrise, sunset and the moon phase for each day, computed on your device from
  the destination's coordinates — no network, no source to go stale, and polar
  day or night stated plainly rather than as a sunrise that never comes.
  **Money** shows the destination's currency against the US dollar, euro and
  pound using the European Central Bank's daily reference rates, clearly
  labelled indicative — not the rate your card or an ATM will give — and honest
  when the ECB doesn't publish a currency. **Practical** carries the plug types,
  voltage, which side they drive on, the calling code, and the emergency number,
  for the same countries the advice panel covers. Adds `fetchDestinationFacts`
  across every transport; the country facts and sun/moon days are worked out
  fresh on each read, so a corrected fact is never frozen into an old snapshot.
- **Typical weather, air quality, alerts, and a packing list — on the click you
  already make.** The outlook used to stop at a 16-day forecast, which is silent
  about the trips people actually plan months ahead. Fetching now also asks what
  these calendar dates have **usually** been like at your destination (ten years
  of observed history, in one request), the **UV and air quality** per day, and —
  for US destinations — active **National Weather Service alerts**, shown
  verbatim and linked. From that same evidence Voyalier works out **what to
  pack**, and shows the reading behind each suggestion, so "rain shell" comes
  with "44% of typical days see rain" rather than asking you to take its word.
  Normals always carry the sample they rest on, and say "typically", never
  "will be" — history is not a forecast. Each layer is fetched independently, so
  a slow archive never costs you the forecast, and outside the US no alert
  block appears at all rather than an empty one that would read as all-clear.
- **Four governments' travel advice, side by side.** Official advice used to mean
  the UK FCDO alone, because when that shipped the US had no machine-readable
  feed. It does now, so the panel adds the **US State Department**, **Global
  Affairs Canada**, and the **Auswärtiges Amt**, plus **US CDC health notices** —
  every one an official, keyless source, still fetched only on your click and
  still stored as a dated local copy. Each government gets its own card in its
  own words: levels are never merged or compared across them (a US "Level 2" and
  a Canadian advisory-state 2 are different claims), and the German source is
  shown in German rather than machine-translated into a safety judgement it never
  made. A source that cannot be reached says so and keeps its last saved copy
  instead of vanishing. Replaces `fetchTravelAdvice` with `fetchAdvisories`
  across every transport; existing saved UK advice migrates in place.
- **Imported documents manager.** Voyalier reads confirmation emails full of
  codes and traveler names, and until now kept them with no way to see or remove
  them — the loudest gap in a privacy-first product. Each trip now lists what was
  imported, with the counts that make deleting it an informed choice, shows the
  original text on request (unsealed from the vault only when asked, never in a
  listing), and removes it behind a two-step confirm. Deleting takes its
  still-pending suggestions with it; facts already confirmed from it stay — the
  traveler approved those — and are marked as having lost their source rather
  than passing as hand-typed. Adds `listDocuments`/`getDocument`/`deleteDocument`
  across every transport.
- **A real Settings screen.** Updates and Encryption used to sit at the bottom of
  the home list while the three AI panels re-mounted inside every trip, so with
  zero trips there was no way to configure AI at all. A topbar gear now opens
  Settings from anywhere; the trip page keeps only trip-scoped surfaces and gains
  a sticky Plan/Prepare/Discover/AI jump nav.

- A **Download and install** page in the documentation, now that a release
  carries real artifacts. It presents the three ways to run Voyalier as equals —
  Apple Silicon macOS, Windows x64, or in a browser from source on any OS
  (including Intel Macs and Linux) — walks through the Gatekeeper and SmartScreen
  first-launch warnings and explains what they do and don't mean, and documents
  the optional SHA-256 check. Links point at `releases/latest` rather than any
  version, so the docs cannot go stale behind a release.
- **Offline maps for Nashville and Kyoto.** Pack CI extracts and verifies a
  bounded Protomaps PMTiles archive for each enabled city, the local core
  verifies its size and SHA-256 before storing it, and MapLibre reads only
  bounded byte ranges through the existing app gateway. Download size varies by
  city and is stated that way before the click. The online OpenFreeMap style
  remains the explicit fallback when a compatible local archive is not present;
  other city packs do not pretend to be available offline yet.

- **Trip notes**, **calendar export**, and a **sample trip**. Notes are free text
  for the half-made plans a trip has nowhere else to keep — sealed at rest, and
  excluded from shared briefs and AI requests by construction. **Export calendar**
  writes an `.ics` locally from the redacted brief, so confirmation codes and
  traveler names cannot ride along into a cloud calendar; times stay floating
  because a confirmation gives a wall clock and no timezone, and Voyalier does
  not invent one. On an empty workspace, **Explore a sample trip** builds a demo
  through the ordinary import flow and drops you into a review — the thing
  Voyalier is actually for.

### Changed

- Opening a trip now fetches **3 times instead of 8**. Below-fold sections mount
  only when they are nearly on screen, so advice, weather, notes, documents,
  search, packs, recommendations, the map, and AI no longer all fetch for a
  traveler who never scrolls to them. The section nav still reaches them: chips
  target wrappers that exist whether or not the section has mounted, and landing
  there is what brings it in. A test asserts the budget so it cannot quietly
  regress.
- The README and website lead with the download rather than `git clone`: the
  homepage's primary action is now **Download for Mac or Windows**, the
  `source-only beta` badge is replaced by `public beta` plus a separate
  `installers unsigned` badge (deletable on its own when certificates land), and
  the release badge reads its version from GitHub instead of being hardcoded.
  **Getting started** is reframed as the from-source path it always was.

- **The mock gateway and the Rust core now answer to the same golden files.** The
  in-memory gateway that every component test runs against re-implemented ~990
  lines of the core's rules in TypeScript, with nothing comparing the two — the
  one test that would have has never run in CI. Facts both languages must agree
  on (validation limits, place folding, the default AI instructions, the
  official-source links) now live in `packages/contracts/parity/`, held by a test
  on each side. See [ADR-0004](docs/architecture/ADR-0004-mock-parity.md).
- **The core reports readiness findings; the interface writes the sentence.**
  Readiness prose — including its pluralization — was built in Rust and rendered
  raw, so one panel had two copy pipelines: the status label was translatable and
  the sentence beside it was not. Rendered copy is unchanged. See the
  [ADR-0003 amendment](docs/architecture/ADR-0003-phase2-contract.md).
- Schema migrations are an ordered list keyed on `PRAGMA user_version`, which was
  previously written on every open and never read. Ordering is now structural
  rather than held by a comment, each step runs at most once, and a legacy-shaped
  database is migrated in a test — the fixture-backed migration coverage
  `ARCHITECTURE.md` asks for before the signed beta.
- The records whose columns the vault seals read and write through one module, so
  "this column is sealed" is declared once and checked by a test that walks the
  declaration.
- Invalidation has a home. A view names the scope it reads; a mutation names the
  scopes it changed, and only views reading those re-fetch. Deleting a document
  no longer refetches a whole trip, and the refresh counter that used to be
  drilled from the app root down through two components is gone.

### Fixed

- **A failed archive, unarchive, calendar export, unconfirm, or sample-trip build
  now says so.** Those actions — on both the trip page and the trip list — only
  announced their failure to screen readers, so a sighted user watched the button
  stop spinning and saw nothing at all.
- Browsing city packs no longer swallows a failure: the catalog fetch had no
  error handling, so a failed load became an unhandled rejection.
- Place names with accented capitals (`REYKJAVÍK`) matched no city pack — the
  core folded them to a word separator instead of their base letters. `Tromsø`
  and `Weißenburg` had the mirror-image bug in the mock.
- Release checksums are now generated by a cross-platform Node script; Git Bash
  on the Windows runner does not include the previously assumed `shasum` binary.

## [0.4.3] - 2026-07-13 — First self-updating build

### Changed

- First release to ship the signed desktop bundles and the updater's
  `latest.json` manifest, so the in-app **Updates** check resolves instead of
  failing. The updater's own minisign signing is independent of OS code-signing
  (Apple notarization / Windows Authenticode), which remains blocked on paid
  certificates — first-open still shows an "unidentified developer" warning.

  (0.4.2 was tagged but never released — its bump omitted the `Cargo.lock`
  refresh, so the protected tag was abandoned rather than force-moved.)

## [0.4.1] - 2026-07-12 — Flow-gap fixes

### Fixed

- More user-flow dead-ends: the **Import** and **Add flight or stay** primary
  buttons were enabled on an empty form (they looked clickable but only errored),
  and are now disabled until there's something to submit. The **vault unlock**
  screen was a dead end on a forgotten passphrase — it now offers a "Forgot your
  passphrase?" explainer with the honest no-recovery reality and the
  restore-from-backup path.

## [0.4.0] - 2026-07-12 — Public beta polish

Assistive setup, a real type identity, and a correctness/robustness sweep on top
of the 0.3.0 beta base. OS code-signing (Apple notarization / Windows
Authenticode) remains blocked on paid certificates; the free in-app updater's own
minisign signing is separate.

### Added

- **Destination-aware, assistive trip setup.** Origin/destination fields are an
  accessible WAI-ARIA combobox with offline suggestions drawn from your existing
  trips and the pack catalog; setup surfaces "Recommended for this trip" packs and
  offline field suggestions for address/property fields. Nothing is geocoded per
  keystroke and nothing leaves the device.
- **Guided on-device AI setup.** When no runtime is detected, a step-by-step
  install → start → get-a-model wizard; once Ollama is running, models can be
  pulled in-app (`pullLocalModel`). Cloud keys gain **Validate & save**
  (`validateProviderKey`) and a "How to get a key" helper.
- **On-device lodging-date drafts.** "Fill gaps with on-device AI" proposes
  missing lodging dates from your own imported text (`previewAssistDraft` /
  `runAssistDraft`, `assisted` extraction method); every suggestion is a draft you
  review before anything is saved.
- **Editable AI instructions.** A settings panel to view and override the system
  instructions used for assist and for the date draft, with per-instruction reset
  (`getAiPrompts` / `setAiPrompt`). The date draft stays schema-locked to dates
  regardless of the instruction, and replies stay marked non-authoritative.
- **Relaxed, typeahead in-trip search.** As-you-type local search where any word
  matches (partial words too), matching terms are offered as autofill
  suggestions, and each result can be copied to reuse (`suggestSearchTerms`).
- **Edit and unarchive trips.** An Edit dialog (`updateTrip`) that keeps imported
  documents/facts/plans, an Unarchive action, and an archive show/hide toggle.
- **Import from a file.** The import dialog accepts a local `.eml`/`.html`/`.txt`
  file via a picker or drag-and-drop, read on-device (no upload) with the format
  inferred from the extension — a saved confirmation email no longer has to be
  hand-pasted.
- **A real type identity.** The interface's named typefaces (Zen Kaku Gothic New,
  Shippori Mincho) are now actually loaded — self-hosted Latin/Latin-Ext WOFF2
  subsets (~94 KB, SIL OFL), with **no runtime web-font request**. The
  documentation site self-hosts the same files, removing its only third-party
  request.
- **Branded macOS DMG installer window** (background + icon layout).
- **Confirm-guards on destructive actions.** Dismissing a candidate and removing
  a manual fact, a downloaded pack, or a stored provider key now take a two-step
  confirm (arm → confirm); reversible actions stay one click.

### Changed

- **Copy pass for reading ease and one voice.** Architecture words retired from
  the UI ("local core" → engine/ready wording), jargon removed ("grounded",
  "forecast horizon", "milestone"), run-on scope lines split, "Unconfirm" →
  "Back to review", "Add a fact" → "Add flight or stay".
- **Design-token foundation.** Quantized ad-hoc font-weights onto the three
  shipped weights; added type-scale, z-index, on-accent, and motion tokens.
- **Subtle, token-driven motion + paper texture**, all under the existing
  reduced-motion kill-switch; a shared `SectionTitle` gives every section the
  same icon + display-serif heading.
- New additive error codes `assist/unreachable` and `weather/fetch_failed` for
  clearer failure messages.

### Fixed

- **Data loss:** returning a _manual_ fact from the Blueprint used to delete it
  silently; it is now an explicit, confirmed "Remove".
- Trip search could repopulate results and announce a stale count after the box
  was cleared (in-flight requests are now invalidated on every keystroke).
- The delete-trip confirmation compared against a hardcoded English word; it now
  tracks the localized field.
- The map showed a silent empty frame on missing WebGL / library-load failure;
  it now explains why (and its marker follows the theme). The Today panel shows a
  retryable line instead of vanishing on error.
- WCAG AA contrast fix for small "silver-on-paper" meta text; dark-mode toast
  shadow and `theme-color` no longer use a frozen light-theme value.
- Raw parser warning codes and internal document ids are no longer shown to
  users; clipboard copy no longer reports success when no clipboard exists; the
  AI-instruction editor caps length client-side; both date fields carry the
  date-range error; the loopback dev server returns `403` (not `500`) for a
  blocked host/origin.

## [0.3.0] - 2026-07-11 — Phase 3 public beta base

Phase 3 (public beta) work. OS code-signing (Apple notarization / Windows
Authenticode) remains blocked on paid certificates; the in-app updater's own
signing is separate and free, and ships in this release.

### Added

- **In-app updater.** `tauri-plugin-updater` driven entirely through Rust
  command wrappers — the webview is never granted the updater capability, so
  there is no path for a compromised page to redirect an update. Updates are
  minisign-verified on-device, releases carry per-platform checksums and SLSA
  build provenance, and the pipeline fails closed if the signing key was never
  configured. A one-time, reversible "check automatically?" consent; a topbar
  pill and an Updates panel that both work before the vault is unlocked; a
  per-platform install flow (macOS/Linux stage the swap and prompt a restart;
  Windows confirms before download, then closes/updates/reopens); a pre-update
  database backup with an in-app "clear backups" affordance; and a "just
  updated" toast. v0.3.0 is the install-once base — the self-update loop
  proves itself starting on v0.3.1.
- **Complete UI localization.** Every panel, dialog, shell, and label now
  renders through a type-safe message catalog (`t()`), with locale-aware
  pluralization (`Intl.PluralRules`) and date/number formatting. English is
  the byte-identical source of truth; added locales are data-only.
- **Email confirmation import.** The import dialog accepts a raw confirmation
  email (`.eml` or pasted) alongside plain text and HTML. The Rust extractor
  prefers the HTML MIME part so the existing structured-data parser still
  fires, decodes quoted-printable and base64 transfer encodings, and is
  depth-capped against a crafted deeply-nested-multipart denial-of-service.
- **Persona-weighted recommendations.** `getRecommendations` ranks a trip's
  downloaded-pack places by per-trip persona weights (food, culture, nature,
  nightlife, shopping) with a deterministic keyword-to-dimension rule — per-pick
  source, license, score, and reasons, plus a cross-dimension wildcard.
- **Offline Today view.** A deterministic "now / next" summary (trip phase with
  day counts, today's departures/arrivals/check-ins, and the next anchor) from
  confirmed facts against the current date. No network, no model.
- **Encrypted vault.** Confirmation codes and traveler names are sealed at rest
  with an XChaCha20-Poly1305 data key. By default the key lives in the OS
  keychain (transparent unlock); an **optional passphrase** wraps the key with
  Argon2id and removes it from the keychain, so the app opens locked behind a
  full-screen unlock gate and data is protected even on an unlocked machine. The
  passphrase is only ever used locally to derive a key — never stored, returned,
  or logged — and encryption degrades to plaintext where no keychain exists so
  the app still runs everywhere.
- **Map view.** A consent-gated MapLibre GL map plotting the destination and
  downloaded-pack recommendations, using the keyless OpenFreeMap basemap; per-pack
  PMTiles extracts are the planned offline path.
- **Grounded-intelligence polish.** The AI request preview now cites what it is
  grounded in and shows a rough token estimate; a link-only "Health notices"
  readiness item (CDC/WHO) joins entry requirements.

### Changed

- Release pipeline hardened for signed updates: every action in the release and
  pack-publish workflows is pinned to a commit SHA, the signing key is scoped
  to a single step and only reachable from a protected environment on a real
  tag (never a manual dry run), build provenance is attested, and city-pack
  releases are enforced pre-release so
  they can never shadow `releases/latest` and break the updater.
- New `vault/locked` and `vault/passphrase_incorrect` error codes; the gateway
  gained additive `getVaultStatus`/`setVaultPassphrase`/`unlockVault`/
  `removeVaultPassphrase`, `getRecommendations`, and `getToday` methods (plus a
  `VaultStatus` type) — all backward-compatible.
- Performance: the consent-gated map lazy-loads MapLibre GL on first use, so the
  initial JavaScript payload drops from ~357 KB to ~84 KB gzipped; the ~1 MB map
  library is a separate chunk fetched only when a map is opened.
- Accessibility: an automated axe-core gate runs on every test suite (home, trip
  detail, a dialog, the vault unlock screen). Its first pass fixed a heading-level
  skip on trip cards (`h3` → `h2`) and a duplicate `banner` landmark caused by
  dialog headers.

## [0.2.0] - 2026-07-11 — Grounded intelligence (Phase 2)

Every capability ships end to end (Rust core → SQLite app → Axum API → Tauri IPC → TS contract → mock → web UI), additive and backward-compatible, with keys and high-stakes data handled per the privacy contract.

### Added

- **Sourced readiness.** A link-only `entry_requirements` item (curated official links; never asserts or clears rules), consent-gated FCDO travel-advice snapshots from the GOV.UK Content API, and a consent-gated Open-Meteo weather outlook — each stored dated, source-linked, freshness-labeled, and invalidated when the trip's place/window changes. US State advisories are link-only (no machine-readable feed exists).
- **Trip search.** Deterministic `searchTrip` over imported documents and confirmed facts, with provenance and transparent scoring.
- **Offline city packs.** A validated catalog (Nashville plus the four Hawaii islands as separate packs, plus ~11 more), each keeping Overture places and a separate Wikivoyage prose layer under their own licenses; per-trip download with consent; and a CI workflow that builds and publishes pack contents to the `packs-v1` release.
- **BYOK AI assist.** On-device detection (Ollama), OS-keychain key storage, a deterministic redacted request preview, on-device inference (Ollama) and cloud inference (OpenAI/Anthropic), and a per-trip activity log. Keys live only in the OS keychain and only ever appear in an outgoing auth header — never in a payload, log, database, or error. Confirmation codes and traveler names are excluded from every request by construction; a fixed system prompt forbids inventing high-stakes facts; each reply carries a non-authoritative disclaimer.

### Changed

- `TripDetail` gained additive `itineraryConflicts`, `readiness`, `travelAdvice`, and `weather` fields; new `assist/failed` and `pack/download_failed` error codes; provider errors now surface the provider's real cause.

## [0.1.0] — Foundation and first vertical slice (Phase 1)

### Added

- Initial repository, product, architecture, security, web, API, desktop, documentation, and delivery foundations.
- The Phase 1 local core: SQLite-backed app services, deterministic confirmation parsers, contract schema drift tests, HTTP endpoints, and direct Tauri IPC command tests; trip CRUD, deterministic Blueprint, import/review, conflict validation, a readiness rollup, and a redaction-first shareable brief.

### Changed

- Rebuilt the brand identity around the folded-route mark (one strip, one fold, one vermilion waypoint), replacing the Wayline V: new mark/lockup/app-icon assets, washi–sumi–indigo–vermilion design tokens, Zen Kaku Gothic New and Shippori Mincho type, a redesigned animated landing page, and a matching README and docs theme.
- Reworked desktop transport to direct Tauri IPC with no fixed loopback listener in the desktop crate.
