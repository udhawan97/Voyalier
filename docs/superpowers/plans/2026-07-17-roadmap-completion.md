# Open-Data Roadmap Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Red-green-refactor every task. Steps use checkbox (`- [ ]`).

**Goal:** Build the remaining *codeable-and-verifiable-in-repo* candidates from `docs/roadmap/OPEN_DATA_FEATURE_CANDIDATES.md`. The pack-pipeline items (#7/#10/#17/#18) stay owner-infra (they need external pack regeneration + GitHub-Releases hosting) and are out of scope.

**Status (2026-07-17): 4 of 5 shipped and merged to `main`; 1 deferred.**
- ✅ **#11 Public holidays** — shipped (migration v8, Nager.Date).
- ✅ **#8 World-Heritage** — shipped (942 sites from Wikidata, derived on read).
- ✅ **#14 About-this-place** — shipped (migration v9, Wikimedia REST, CC BY-SA).
- ✅ **#20 Tipping** — shipped (bundled curated table, rough-guide-framed).
- ⛔ **#6 Trip CO₂** — **deferred**: the mechanism is fine (flight segments carry
  IATA, airports are bundled) but the DESNZ/DEFRA per-passenger-km factors are
  version/class-dependent, disagree across secondary sources, and live only in a
  gov `.xlsx` that could not be extracted cleanly. Bundling approximate numbers
  labelled as official DESNZ factors would fabricate provenance, so this waits on
  the exact factor table + a yearly re-sync commitment (an owner data task).

**The five features, in build order (confidence × value × cleanliness):**

1. **#11 Public holidays during the trip** — consent-gated Nager.Date fetch (keyless, 187 countries, verified live), stored as a dated snapshot, filtered to the trip window on read. Its own seam, mirroring advisories.
2. **#6 Trip CO₂ estimate** — offline: bundled UK DESNZ/DEFRA per-passenger-km flight factors + great-circle distance between the confirmed flight segments' airports. Derived on `TripDetail`, no fetch.
3. **#8 World-Heritage sites near the destination** — bundled Wikidata extract (UNESCO WHS: name, coords, year), matched by great-circle proximity to the destination coordinates. A block on the facts card, derived on read.
4. **#14 "About this place" card** — consent-gated Wikimedia REST page-summary + attribution, snapshot-stored. Its own seam. Scoped to the destination.
5. **#20 Tipping-norms card** — bundled curated table (facts in our own words, sources cited) for the covered countries. A block on the facts card, derived on read from the country code. Built last (content-nuance risk is highest).

## Global Constraints (every feature)

- **Network only on explicit consent, Rust-side, identifying User-Agent, dated attributed snapshot.** Bundled data ships at build time, serialize-only, resolved fresh on read (corrections never freeze into a snapshot).
- **Trust ordering holds:** none of these clear a readiness item. Holidays/WHS/about/tipping are convenience; CO₂ is a labelled estimate.
- **Migrations append-only, self-detecting**, pinned to `target_schema_version()` in tests. Currently at **v7**; holidays → v8.
- **6-place contract lockstep** for any new gateway method: `packages/contracts/{index,mock}.ts` + `apps/web/src/gateway/{http,tauri}.ts` + `crates/voyalier-server` + `apps/desktop/src-tauri`. Derived `TripDetail` fields need no new method (they ride on `get_trip`).
- TDD: failing test first, watch it fail, minimal code, commit. Verify (cargo test + clippy + fmt; pnpm typecheck + test + build) before each merge. Merge to `main` + push after each feature.

---

## Feature #11 — Public holidays during the trip

**Data (captured live 2026-07-17):** Nager.Date v3, `GET https://date.nager.at/api/v3/PublicHolidays/{year}/{ISO2}` — keyless, 187 countries, MIT-licensed code / free hosted API. Each entry: `date` (YYYY-MM-DD), `name` (English), `localName` (native), `global` (national vs regional), `types` (keep entries whose types include `"Public"`). Attribution: "Holiday data from Nager.Date".

**Architecture:** A new consent-gated capability, like advisories. `fetch_public_holidays(trip_id)` geocodes the destination to its ISO2 country (reusing `parse_geocoding_response`), fetches Nager for each distinct year in the trip window, stores a `PublicHolidaysSnapshot`. `TripDetail.public_holidays` is derived on read = the snapshot's holidays whose date falls within `[start_date, end_date]`. Invalidated on destination **or** date change.

### Task 11.1 — Core `holidays` module (parser + window filter)

- Produces: `PublicHoliday { date, name, local_name, global }`; `parse_nager_holidays(json) -> Result<Vec<PublicHoliday>, AppError>` (keep only `types` ⊇ `"Public"`); `holidays_within(&[PublicHoliday], start, end) -> Vec<PublicHoliday>` (date in window inclusive, sorted, deduped).
- [ ] Failing test: `parses_public_holidays_and_drops_non_public_types` + `filters_holidays_to_the_trip_window_sorted` (fixture with a Public global, a Public regional, an Observance to drop, and an out-of-window entry).
- [ ] Verify fail → implement (`NagerHoliday` deserialize helper → filter → map) → verify pass → export from `lib.rs` → commit.

### Task 11.2 — App: snapshot + migration v8 + fetch + derive + invalidation

- `PublicHolidaysSnapshot { country_code, country_name, holidays: Vec<PublicHoliday>, retrieved_at }` (core). `TripDetail.public_holidays: Vec<PublicHoliday>` (derived, `#[serde(default)]`).
- Migration v8 `public_holidays_snapshots (trip_id PK, country_code, country_name, holidays TEXT JSON, retrieved_at)`; base CREATE + self-detecting step.
- `fetch_public_holidays`: geocode destination → ISO2 + country name; for each year in `start..=end`, fetch + `parse_nager_holidays`, concat; store. A year that 404s (country unsupported) contributes nothing rather than failing.
- Derive `public_holidays = holidays_within(snapshot.holidays, start, end)` on `get_trip`. Invalidate the snapshot in `update_trip` when destination or dates change.
- [ ] Failing app tests (routed fetcher: geocode → JP, Nager year URLs → fixture): snapshot stored with holidays; `TripDetail.public_holidays` only in-window; date edit invalidates. Migration v8 test pinned to `target_schema_version()`.
- [ ] Verify → implement → verify → commit.

### Task 11.3 — Contract + both transports + mock

- `PublicHoliday`, `PublicHolidaysSnapshot` types; `TripDetail.publicHolidays: PublicHoliday[]`; `fetchPublicHolidays(tripId): Promise<PublicHolidaysSnapshot>`. HTTP `POST /api/v1/trips/:id/holidays` + Tauri `fetch_public_holidays` + registration. Mock: canned JP holidays, one inside the seed window.
- [ ] `pnpm typecheck`, `cargo test -p voyalier-server`, `cargo build -p voyalier-desktop`. Commit.

### Task 11.4 — Web panel + i18n + test + changelog

- A `PublicHolidays` panel: Fetch button + consent line; lists in-window holidays (`{date} · {name}` + localName when different) or an empty state. Wire in `TripDetailView`. i18n `holidays.*`. Component test via mock. CHANGELOG. Commit.

### Task 11.5 — Docs + verify + merge

- DATA_SOURCES.md Nager.Date row (fetched reference data). Full sweep. Merge + push.

---

## Feature #6 — Trip CO₂ estimate (offline)

**Data:** UK DESNZ/DEFRA GHG conversion factors, per-passenger-km, by haul (domestic / short-haul / long-haul), economy basis, with the source year and URL recorded and a visible "estimate" label. Great-circle distance from the bundled airports (`airports.rs`), by IATA on the confirmed flight segments. Attribution/exact factors to be pinned from the published DESNZ dataset at build time.

**Architecture:** Pure `voyalier-core::co2` — `estimate_flight_co2(distance_km) -> f64` picking the haul band; a `trip_flight_co2(segments, airport_lookup) -> Option<TripCo2>` summing confirmed flight segments. Needs an `airport_by_iata(code) -> Option<&Airport>` in `airports.rs`. Derived on `TripDetail.trip_co2` from the confirmed flight facts. A block near the itinerary/readiness. (Detailed tasks written when this feature starts — depends on confirming the flight-segment payload carries IATA codes.)

---

## Feature #8 — World-Heritage sites near the destination (bundled)

**Data:** Wikidata SPARQL (`query.wikidata.org`) build-time extract of UNESCO World Heritage Sites (`P1435` = `Q9259`): label, coords, inscription year → bundled `data/whs.tsv`, CC0. Matched by great-circle proximity to the destination coordinates (reuse haversine).

**Architecture:** `voyalier-core::heritage` bundles the TSV, `world_heritage_near(lat, lon, radius_km, limit) -> Vec<HeritageSite>`. Derived on `TripDetail` from the facts snapshot's coords (like nearest airports). A facts-card block. (Detailed tasks when it starts; data generated live via SPARQL first.)

---

## Feature #14 — "About this place" (consent-gated Wikimedia)

**Data:** Wikimedia REST `GET https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}` — extract + description + attribution, CC BY-SA. Consent-gated per click, snapshot-stored. Its own seam. (Detailed tasks when it starts; capture live payload first.)

---

## Feature #20 — Tipping-norms card (bundled curated table)

**Data:** Hand-authored tipping norms (restaurants / taxis / general) for the ~39 covered countries, written in our own words with sources cited, labelled informational. Bundled, serialize-only, resolved from the country code like `country_facts`. A facts-card block. Built last — the risk is content nuance, not code. (Detailed tasks when it starts.)

---

## Self-review

Spec coverage: 5 features map to the 5 non-owner-infra roadmap candidates not yet shipped. Types are consistent (all snapshots follow the dated-attributed pattern; all derived fields ride on `get_trip`). No placeholders in Feature #11 (the one starting now); #6/#8/#14/#20 carry architecture + data-source but defer step-level detail to their start, gated on a live data capture or a payload check that must happen first.
