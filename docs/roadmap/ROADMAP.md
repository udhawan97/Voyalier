# Roadmap

## Phase 0 — feasibility gates

- Validate name/domain/trademark availability.
- Benchmark common confirmation extraction and an optional Docling pack.
- Validate the Rust/Tauri macOS and Windows packaging matrix.
- Complete a provider access, licensing, and caching matrix.
- Prototype Typst redacted PDF output.
- Test the Blueprint information hierarchy with representative travelers.

## Phase 1 — first vertical slice

- ✓ Create and persist a trip.
- ✓ Deterministic Blueprint (confirmed flights and stays in itinerary order).
- ✓ Manually add one reservation.
- ✓ Import and review one confirmation.
- ✓ Basic itinerary conflict validation — deterministic cross-segment checks
  (flight overlaps, lodging overlaps, uncovered-night gaps) surfaced as advisory
  findings on `TripDetail.itineraryConflicts`; never blocks confirmation.
- ✓ Deterministic readiness rules — plan-completeness rollup on
  `TripDetail.readiness` (schedule conflicts, lodging coverage, pending review)
  with an overall status. Logistics only; sourced readiness (advisories, entry
  rules, health, safety) stays Phase 2 and is quoted from cited sources, never
  inferred or LLM-authored.
- ✓ Redacted traveler brief — shipped end to end: `build_trip_brief` redaction
  core (generation-time exclusion) → `getTripBrief` gateway on every transport →
  a print-friendly `BriefDialog` ("Share brief" → Print / Save as PDF), with
  tests asserting confirmation codes and traveler names never enter the brief.
  A true embedded-Typst PDF export remains an optional later enhancement behind
  the Phase 0 Typst prototype gate; the print-to-PDF path covers Phase 1.

## Phase 2 — grounded intelligence

Contract surface proposed in ADR-0003; sequenced A (sourced readiness) → D
(local retrieval) → B (recommendations) → C (BYOK providers).

- ✓ Sourced readiness, first sources: the link-only `entry_requirements`
  readiness item (curated official links; never asserts or clears rules;
  excluded from the rollup) plus consent-gated FCDO snapshots — an explicit
  "Fetch official advice" click contacts the keyless GOV.UK Content API once
  (ureq, identifying User-Agent), stores a dated verbatim snapshot locally, and
  renders it with source link, OGL v3.0 attribution, retrieval time, staleness
  after 7 days, and a UK-passport-holders label. Country slugs come from a
  curated list in code, never from trip text or a model.
- ✓ Weather adapter: consent-gated Open-Meteo outlook — an explicit click sends
  the destination name to open-meteo.com (geocode, then daily forecast), stores
  a dated snapshot, and renders trip-window days with honest coverage
  (full/partial/none against the ~16-day horizon), "Weather data by
  Open-Meteo.com" CC BY 4.0 attribution, and 12-hour staleness. Weather is
  planning texture, never a safety claim.
- ✓ US State Dept advisories: link-only (ADR-0003 owner decision). No
  machine-readable per-country feed exists, so the entry-requirements item links
  to the official advisories index rather than asserting a level. Health notices
  (CDC/WHO) can follow the same link-or-consent pattern later.

**Owner decisions recorded (ADR-0003), not yet built:**

- ✓ Packs (B), catalog: a validated catalog of downloadable city packs, listed
  end to end. Locks in the required seeds — Nashville plus Hawaii as four
  separate per-island packs (Oʻahu, Maui, Kauaʻi, Big Island) — plus ~11 more
  destinations (16 total). Each pack keeps Overture places and Wikivoyage prose
  as separate layers with their own licenses (permissive vs. share-alike). The
  lazy "Offline city data" panel shows coverage and per-layer licenses.
- ✓ Packs (B), consented download: a per-pack "Download for this trip" pulls a
  pack's contents in from GitHub Releases and stores them locally for the trip.
  The click is the consent, and the fetch is one-way — it pulls place data and
  notes in; nothing about the trip is sent. The pack id is validated before any
  network call, and the downloaded body is verified to match the requested pack;
  the panel then shows offline counts with a "Remove" control.
- ✓ Packs (B), CI pipeline: a manual GitHub Actions workflow dumps the catalog
  from `voyalier-core` (one source of truth via an example binary), builds each
  pack's contents — Wikivoyage prose via the MediaWiki API plus Overture places
  via DuckDB clipped to the bbox — writes `<id>.json` plus a per-layer license
  manifest, and publishes the assets to the `packs-v1` release the app downloads
  from. Pack (B) is complete; running the workflow populates the release.
- ✓ Providers (C), detection + key storage: on-device AI **detection**
  (user-initiated "Check for on-device AI" probes `localhost:11434/api/tags`);
  plus **BYOK key storage** — OpenAI/Anthropic keys stored in the OS keychain
  via the `keyring` crate behind an injectable `SecretStore` (in-memory in
  tests). The lazy "AI providers" panel never returns, renders, or persists a
  key value (`hasKey` only); models persist in SQLite.
- ✓ Providers (C), consent preview: `previewAssist` builds a deterministic,
  on-device preview of the exact request Voyalier would send to a provider for
  a trip — system prompt, grounded trip details, endpoint, and a local-vs-cloud
  "leaves your device" signal. It reuses the brief's generation-time exclusion,
  so confirmation codes and traveler names never enter it and could never reach
  a provider; imported document text is withheld too. Nothing is transmitted —
  this is the consent step before an assist call.
- ✓ Providers (C), on-device inference: `runAssist` sends the same redacted
  request to a local Ollama and returns the reply, gated by the explicit click
  (and, being local, nothing leaves the device). Cloud providers are refused
  server-side for now. A fixed system prompt forbids inventing high-stakes
  facts, and the reply carries a non-authoritative disclaimer.
- ✓ Providers (C), activity log: every successful run is recorded in a visible
  per-trip log (metadata only — never the prompt or reply).
- ✓ Providers (C), cloud inference: `runAssist` also sends the previewed,
  redacted request to OpenAI or Anthropic using the BYOK key from the OS
  keychain. The key is read only on the inference path, placed solely in the
  outgoing auth header, and never logged, returned, or stored elsewhere; a
  missing key is refused before any request. The same redaction, system prompt,
  disclaimer, and activity logging as on-device apply. Provider (C) is complete.
- ✓ Local retrieval, first slice: `searchTrip` ships as a deterministic scan
  over stored documents and confirmed facts with provenance and transparent
  scoring ("Find in this trip"). FTS5/embeddings may replace the internals
  later without contract change.
- ✓ OpenAI, Anthropic, and Ollama providers behind one interface (`runAssist`
  dispatches all three; preview + consent + activity log shared).

**Additional grounded-intelligence polish (shipped in Phase 3):**

- ✓ Assist citations + token estimate: the request preview cites what it is
  grounded in ("N confirmed flights/stays") and shows a rough token estimate for
  cost awareness, both computed on-device before anything is sent.
- ✓ Health-notice sources (CDC/WHO): a link-only "Health notices" readiness item
  alongside entry requirements — official links, never asserted, excluded from
  the rollup.

## Phase 3 — public beta

- ✓ Persona-weighted recommendations: `getRecommendations` ranks a trip's
  downloaded pack places by per-trip persona weights (food, culture, nature,
  nightlife, shopping). Deterministic and transparent — a keyword-to-dimension
  rule, never a model — with per-pick source, license, score, "because" reasons,
  and a cross-dimension wildcard. Empty until a pack with places is downloaded.
- ✓ Offline Today view: a deterministic "now / next" summary at the top of a
  trip — phase (upcoming/active/completed with day counts), today's items
  (departures, arrivals, check-ins/outs, staying-tonight), and the next anchor.
  Computed from confirmed facts against the current date; no network, no model.
- ✓ Encrypted vault (keychain default + optional passphrase): every stored field
  that carries confirmation codes or traveler names — confirmed-fact payloads,
  the original imported document text, and pending candidates (payload + evidence
  excerpts) — is sealed at rest with an XChaCha20-Poly1305 data key held in the OS
  keychain, transparently at each storage seam, with an idempotent migration of
  legacy rows. Degrades to plaintext when no keychain exists (headless/CI) so the
  app runs everywhere.
  The **optional passphrase** is the chosen model's second half: setting one
  wraps the data key under an Argon2id-derived key and removes the raw key from
  the keychain, so the app opens **locked** and asks for the passphrase (a
  full-screen unlock gate) — protecting data even on an unlocked machine. The
  passphrase is only ever used locally to derive a key; it is never stored,
  returned, or logged, and there is no recovery if it is forgotten.
- ✓ Map view: a consent-gated MapLibre GL map plotting the trip's destination
  and downloaded-pack recommendations. Default basemap is OpenFreeMap (free, no
  API key, OpenStreetMap-derived, self-hostable); per-pack PMTiles extracts
  (built by the pack CI) are the offline path. See `docs/architecture/MAPS.md`.
- ✓ In-app updater: a `tauri-plugin-updater` loop wrapped in Rust commands (the
  webview never gets the updater capability — no hidden network path),
  minisign-signed updates verified on-device, per-platform checksums, and SLSA
  build provenance from a SHA-pinned, environment-protected release workflow.
  Full accessible UI — updates panel, topbar pill, one-time reversible consent,
  per-platform install fork, staged restart, just-updated toast, clear-backups.
  See `docs/architecture/UPDATES.md`. Turning it on is the owner's key +
  `v0.3.0` publish (the first install-once base); the free updater signing is
  independent of the paid OS code-signing below.
- Signed installers: DMG and EXE/MSI OS code-signing + notarization.
  _(Blocked on paid Apple ($99/yr) and Windows code-signing certificates. First
  launch of the unsigned build uses the documented Gatekeeper / SmartScreen
  "open anyway" path.)_
- Documentation, accessibility, performance, localization readiness, and support
  playbooks. _(In progress. Performance: the consent-gated map now lazy-loads
  MapLibre GL on first use, cutting the initial JavaScript payload from ~357 KB to
  ~84 KB gzipped — users who never open a map never download the ~1 MB library.
  Accessibility: an automated axe-core gate scans the home, trip detail, a dialog,
  and the vault unlock screen for violations on every test run; the first pass
  fixed a heading-level skip on trip cards and a duplicate `banner` landmark from
  dialog headers. Colour contrast is checked in the browser, which jsdom can't
  compute. Documentation: the docs site now has a **Guides** section covering
  each workflow — trips and the Blueprint, importing confirmations, readiness and
  official advice, offline packs/recommendations/maps, AI assist, and the
  encrypted vault, plus a **Troubleshooting** page of support playbooks (common
  failures, and where data lives / how to back up or reset). Localization: date
  and number formatting are locale-aware (`Intl`, UTC-anchored so the wall-clock
  day never shifts), and the **entire UI now renders through a message-catalog
  `t()`** with locale-aware pluralization (`Intl.PluralRules`) — every panel,
  dialog, shell, and label migrated, English the byte-identical source of truth,
  added locales data-only. The catalog is type-safe (`MessageKey` +
  compile-checked plural bases). Complete.)_

## Later

Licensed live inventory, encrypted sync, group collaboration, monitoring, email ingestion, and mobile experiences.
