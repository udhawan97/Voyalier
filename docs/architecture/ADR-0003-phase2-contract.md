# ADR-0003: Phase 2 contract-change request (grounded intelligence)

- Status: Partially adopted — A (entry links, FCDO advice, weather with
  snapshot invalidation on trip edits) and the first D slice (searchTrip)
  shipped as additive contract changes; remaining A sources (US State
  advisories, health) plus B and C await owner decisions.
- Date: 2026-07-10 (status updated same day)

## Context

Phase 1 is complete: create/persist trips, deterministic Blueprint, import and
review confirmations, itinerary conflict validation, a plan-completeness
readiness rollup, and a redaction-first shareable brief. The frozen contract
(`packages/contracts/src/index.ts`) covers exactly trips, facts, candidates,
documents, itinerary conflicts, readiness (logistics), and the brief.

Phase 2 ("grounded intelligence") cannot begin as a UX or core slice against the
current surface — sourced readiness, persona recommendations, and BYOK providers
each need new contract types. Per the parallel-work governance, contract changes
are proposed and frozen before core/UX build against them. This ADR is that
request. It proposes the surface; it does not implement Phase 2.

Every addition below is **additive and backward-compatible** (new types and new
`AppGateway` methods; no field removed or retyped), and each ships as a lockstep
change across Rust core + Axum + Tauri + TS contract + mock + tests — the exact
pattern used for conflicts, readiness, and the brief.

## Proposed additions

### A. Sourced readiness (entry / health / safety / weather)

- New `ReadinessCheck` variants (e.g. `entry_requirements`, `health_notices`,
  `safety_advisory`, `weather_window`, `disruption`).
- A `SourcedReadinessItem` extending a readiness item with **provenance**:
  `source` (name), `sourceUrl`, `retrievedAt`, `validUntil`, `freshness`
  (`fresh | stale`), and a verbatim `excerpt`. No free-text summary.
- Gateway: `refreshReadiness(tripId, { sources })` — network + consent gated —
  and cached results surfaced on `TripDetail.readiness` under a new
  `sourcedItems` array (logistics `items` unchanged).

### B. Destination & persona recommendations

- Persona **weights** (dimension sliders) as a per-trip preference object; NOT
  hard-coded personas. Presets map to weights.
- `Recommendation` / `PlaceCandidate` types: id, name, category, coordinates,
  source + license, confidence, "because" reasons, and a `wildcard` flag.
- Gateway: `getRecommendations(tripId, weights)` and destination-pack management
  (`listPacks`, `downloadPack`, `removePack`) with explicit consent for the pack
  download (the only network call in the browse flow).

### C. BYOK providers (OpenAI / Anthropic / Ollama)

- A `Provider` descriptor + `ProviderConfig` (provider id, model, enabled).
  **API keys never appear in any contract payload** — they live in the OS
  keychain; the contract references a key only by presence/absence.
- Consent-gated assist: `runExtractionAssist(input)` / `runNarrative(input)`
  returning a result plus a `citation` (which source chunks) and a `costEstimate`
  (tokens). Each call requires a prior `ConsentRecord` and a **payload preview**
  of exactly what would leave the device. Zero telemetry; opt-in only.

### D. Local retrieval (FTS5 + optional embeddings)

- Mostly internal to core. Minimal surface: an optional `searchTrip(tripId, query)`
  returning ranked chunks with provenance, used to ground assist calls.

## Hard rules (carried from the product contract)

- High-stakes data (entry/visa, health, safety, prices, opening hours) is
  **quoted or structurally extracted from an identified source, timestamped, and
  freshness-labeled** — never originated, summarized, or "cleared" by a model.
- An LLM may draft prose over already-sourced facts; it must never be the origin
  or the arbiter of a readiness finding.
- BYOK cloud calls are consent-gated with a payload preview; no shared keys, no
  telemetry, no autonomous booking, no live inventory, no scraping (per the
  chosen route). Providers are local-first and optional; the app stays fully
  useful with no key.

## Ownership & sequencing

1. Freeze this surface (types + gateway signatures + mock stubs) as the Phase 2
   contract before any feature build — the contract owner lands it first.
2. Build in dependency order: **A → D → B → C** (sourced readiness and retrieval
   before recommendations and providers).
3. Each capability lands as core rule + mock mirror + Axum + Tauri command +
   tests in one change, verified twice, merged to `main`.

## Consequences

- Phase 2 core/UX can proceed independently once the surface is frozen.
- `SourceProvenance` becomes a shared, reused shape across readiness,
  recommendations, and retrieval.
- Non-goals unchanged: no live flight/hotel inventory, no booking, no social
  scraping, no shared provider keys.

## Open questions

- Does sourced readiness live on `TripDetail` (cached) or a separate
  `getReadiness` call with its own refresh lifecycle? (So far: cached on
  `TripDetail`, refreshed by explicit user clicks — working well.)

## Owner decisions (resolved 2026-07-11)

- **US State Dept advisories: link-only.** No machine-readable per-country feed
  exists (RSS carries only recent updates; state.gov bot-blocks fetchers), so
  Voyalier links to the official advisories index instead of showing a level.
  Revisit if the US ships a real API.
- **Packs (B): CI-built, layered licensing.** A CI pipeline builds ~20 city
  packs — Overture places (permissive) plus Wikivoyage prose as a separate
  CC BY-SA layer with a per-layer LICENSE/ATTRIBUTION manifest — published to
  GitHub Releases; the app downloads one pack per trip behind explicit consent.
  - **Required seed cities (must be in the first pack set), owner-decided:**
    - Nashville (US-TN) — one city pack.
    - Hawaii — **all four main islands as separate packs**: Oʻahu, Maui,
      Kauaʻi, and Hawaiʻi (Big Island). Each uses its own Wikivoyage article
      and its own island-sized Overture bbox (never one oversized state bbox).
      That is 4 of the pack set, not 1.
      These are non-negotiable for the initial build; the rest of the ~20 fill in
      around them (so ~15 more cities beyond Nashville + the 4 Hawaii packs).
- **Providers (C): OS keychain + hybrid consent, Ollama first.** BYOK keys live
  in the OS keychain via the `keyring` crate (desktop-only until a browser-mode
  fallback is designed). Consent: the first AI call per provider shows a full
  payload preview with an "allow for this trip" choice; every call is recorded
  in a visible activity log. Ollama (local, keyless) ships before cloud
  providers.
