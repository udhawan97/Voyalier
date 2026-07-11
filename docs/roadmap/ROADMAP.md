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
- Redacted traveler PDF — remaining (Typst; see Phase 0 prototype gate).

## Phase 2 — grounded intelligence

- Place, weather, advisory, and destination-source adapters.
- Persona scoring and source corroboration.
- FTS5 plus optional local embeddings.
- OpenAI, Anthropic, and Ollama providers behind one interface.
- Cost, consent, citation, and evaluation surfaces.

## Phase 3 — public beta

- Encrypted vault and migration/backup tests.
- Map and offline Today view.
- DMG and EXE/MSI release automation, signing, notarization, checksums, and updater.
- Documentation, accessibility, performance, localization readiness, and support playbooks.

## Later

Licensed live inventory, encrypted sync, group collaboration, monitoring, email ingestion, and mobile experiences.
