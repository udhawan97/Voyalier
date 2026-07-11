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

- Packs (B): CI-built, ~20 cities, Overture places + Wikivoyage prose as a
  separate CC BY-SA layer with a per-layer license manifest, hosted on GitHub
  Releases, downloaded per trip with consent.
- ✓ Providers (C), first slice: on-device AI **detection** — a user-initiated
  "Check for on-device AI" probes `localhost:11434/api/tags` and reports whether
  Ollama is running plus its installed models (keyless, inference-free, nothing
  leaves the device; device-wide, not per-trip). Remaining: OS keychain
  (`keyring`) key storage, hybrid consent (first call per provider previews the
  payload; every call logged), then Ollama inference before OpenAI/Anthropic.
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
