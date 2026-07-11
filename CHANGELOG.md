# Changelog

All notable changes will be documented here once Voyalier begins publishing releases.

The project follows Semantic Versioning and keeps unreleased work under the section below.

## [Unreleased]

Phase 3 (public beta) work, landing incrementally. Signed installers remain
blocked on paid code-signing certificates.

### Added

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

- New `vault/locked` and `vault/passphrase_incorrect` error codes; the gateway
  gained additive `getVaultStatus`/`setVaultPassphrase`/`unlockVault`/
  `removeVaultPassphrase`, `getRecommendations`, and `getToday` methods (plus a
  `VaultStatus` type) — all backward-compatible.

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
