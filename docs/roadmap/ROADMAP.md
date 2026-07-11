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
  Remaining for B: a CI pipeline that builds each pack's contents from Overture
  and Wikivoyage data clipped to its bbox and publishes to GitHub Releases, then
  a consented per-trip download that stores a pack locally.
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
  per-trip log (metadata only — never the prompt or reply). Remaining for C:
  cloud inference (OpenAI/Anthropic) behind the same consent + logging.
- ✓ Local retrieval, first slice: `searchTrip` ships as a deterministic scan
  over stored documents and confirmed facts with provenance and transparent
  scoring ("Find in this trip"). FTS5/embeddings may replace the internals
  later without contract change.
- Place, weather, advisory, and destination-source adapters.
- Persona scoring and source corroboration.
- OpenAI, Anthropic, and Ollama providers behind one interface.
- Cost, consent, citation, and evaluation surfaces.

## Phase 3 — public beta

- Encrypted vault and migration/backup tests.
- Map and offline Today view.
- DMG and EXE/MSI release automation, signing, notarization, checksums, and updater.
- Documentation, accessibility, performance, localization readiness, and support playbooks.

## Later

Licensed live inventory, encrypted sync, group collaboration, monitoring, email ingestion, and mobile experiences.
