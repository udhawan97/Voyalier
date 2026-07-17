# Nearest-Airport Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show the airports nearest to a trip's destination — IATA code, name, and great-circle distance — computed **entirely offline** from a bundled airport list and the coordinates the destination-facts snapshot already stores.

**Why this, not seam 4:** the city-pack pipeline (seam 4) produces its data via external CI and hosts it on GitHub Releases; its features would ship dormant and can't be verified here. This feature is the opposite: bundled public-domain data + pure computation, so it ships **live and fully verifiable** on merge, and it composes with seam 3 — no new fetch, no migration, just a field derived on read like `astro` and `countryFacts`.

**Architecture:** A new pure `voyalier-core::airports` module embeds a compact CSV (`include_str!`) of ~3,300 scheduled-service airports (large + medium, with IATA codes), and computes the nearest N by haversine distance. `TripDetail.nearest_airports` is derived from the stored facts snapshot's coordinates. Contract + mock + a block on the existing destination-facts card. No gateway method, no migration.

**Tech Stack:** Rust (std only — no new crate), TypeScript contract + React.

## Data (captured live 2026-07-17)

- **Source:** OurAirports `airports.csv` (`davidmegginson.github.io/ourairports-data/airports.csv`), **public domain**, attribution optional. Filtered to `type ∈ {large_airport, medium_airport}` with a non-empty `iata_code` and `scheduled_service == yes` → **3,274 airports, ~162 KB** as a compact `IATA,lat,lon,size,name` CSV sorted by IATA. Committed to `crates/voyalier-core/src/data/airports.csv`.
- **Golden values (haversine, R = 6371 km):** Kyoto (35.0116, 135.7681) → ITM 39 km, UKB 65 km, KIX 81 km, NGO 96 km. London (51.5074, −0.1278) → LCY 13 km, LHR 23 km, LGW 40 km, LTN 44 km. A remote mid-Pacific point still returns the nearest without error.

## Global Constraints

- Offline and deterministic: no network, no source, cannot be stale. Distance is a fact; Voyalier does not editorialize which airport is "best".
- Bundled data is `&'static str` parsed once (`std::sync::OnceLock`); `nearest_airports` returns owned records for the wire.
- Derived on `TripDetail` from the facts snapshot, like `packing_list` / `astro` — empty without a snapshot. No migration, no gateway capability.
- TDD: failing test first, watch it fail, minimal code, commit.

---

### Task 1: Core airports module + bundled data

**Files:** Create `crates/voyalier-core/src/data/airports.csv` (the 162 KB compact CSV), `crates/voyalier-core/src/airports.rs`; modify `lib.rs`.

**Interfaces:**

- Produces: `AirportSize { Large, Medium }`, `NearbyAirport { iata: String, name: String, distance_km: f64, size: AirportSize }`, `nearest_airports(latitude: f64, longitude: f64, limit: usize) -> Vec<NearbyAirport>`.

- [ ] **Step 1: Commit the bundled CSV** (already generated). Header-less `IATA,lat,lon,{L|M},name`, sorted by IATA.
- [ ] **Step 2: Failing tests:**

```rust
#[test]
fn finds_the_nearest_airports_by_distance() {
    let near = nearest_airports(35.0116, 135.7681, 3); // Kyoto
    let codes: Vec<_> = near.iter().map(|a| a.iata.as_str()).collect();
    assert_eq!(codes, ["ITM", "UKB", "KIX"]);
    // Sorted strictly by distance, closest first.
    assert!(near[0].distance_km < near[1].distance_km);
    assert!(near[1].distance_km < near[2].distance_km);
    // ITM is ~39 km from central Kyoto.
    assert!((near[0].distance_km - 39.0).abs() < 3.0, "{}", near[0].distance_km);
    assert_eq!(near[0].name, "Osaka Itami International Airport");
    assert_eq!(near[0].size, AirportSize::Large);
}

#[test]
fn covers_other_regions_and_bounds_the_result() {
    let london = nearest_airports(51.5074, -0.1278, 4);
    assert_eq!(london[0].iata, "LCY");
    assert_eq!(london.iter().map(|a| a.iata.as_str()).collect::<Vec<_>>(),
               ["LCY", "LHR", "LGW", "LTN"]);
    // A remote point still returns the closest, never panics or empties.
    let remote = nearest_airports(0.0, -140.0, 2);
    assert_eq!(remote.len(), 2);
    assert!(remote[0].distance_km > 500.0);
    // limit is honoured and never exceeds the dataset.
    assert_eq!(nearest_airports(35.0, 135.0, 0).len(), 0);
    assert!(nearest_airports(35.0, 135.0, 100_000).len() < 4000);
}
```

- [ ] **Step 3: Verify failure.** `cargo test -p voyalier-core airports` → FAIL.
- [ ] **Step 4: Implement.** `const AIRPORTS_CSV: &str = include_str!("data/airports.csv");` A private `parsed()` returns `&'static [Airport]` via `OnceLock`, parsing each line into `Airport { iata: &'static str, name: &'static str, lat: f64, lon: f64, size: AirportSize }` (split on the first four commas; the name may not contain commas since the generator stripped them). `nearest_airports`: haversine (R = 6371) from the point to every airport, collect `(distance, index)`, sort by distance (`total_cmp`), take `limit`, build owned `NearbyAirport`. Round `distance_km` to one decimal.
- [ ] **Step 5: Verify pass; commit** `"Core: nearest airports from bundled OurAirports data"`.

---

### Task 2: Derive nearest airports on TripDetail

**Files:** `crates/voyalier-core/src/types.rs` (`TripDetail.nearest_airports`); `crates/voyalier-app/src/lib.rs` (derive in `get_trip`).

- [ ] **Step 1: Failing test.** Extend the existing `fetch_destination_facts_...` app test: after fetching facts for Kyoto, assert `detail.nearest_airports` is non-empty and its first entry is `ITM`. Also assert it is empty when no facts snapshot exists.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** `TripDetail.nearest_airports: Vec<NearbyAirport>` (`#[serde(default)]`). In `get_trip`, `let nearest_airports = destination_facts.as_ref().map(|s| nearest_airports(s.latitude, s.longitude, 4)).unwrap_or_default();`. Import + re-export the core symbols.
- [ ] **Step 4: Verify pass (`cargo test --workspace`); commit** `"App: nearest airports on the trip detail"`.

---

### Task 3: Contract + mock

**Files:** `packages/contracts/src/index.ts`, `packages/contracts/src/mock.ts`.

- [ ] Add `AirportSize = "large" | "medium"`, `NearbyAirport { iata, name, distanceKm, size }`, and `TripDetail.nearestAirports: NearbyAirport[]`.
- [ ] Mock: when a facts snapshot exists for the fixture, surface `nearestAirports` = ITM/KIX/UKB fixtures (mirroring the core output shape).
- [ ] Verify `pnpm typecheck`, `cargo test -p voyalier-server`. No route/command change. Commit `"Contract: nearest airports on the trip detail"`.

---

### Task 4: Web UI + i18n + tests + changelog

**Files:** `apps/web/src/views/DestinationFacts.tsx`, `apps/web/src/app/i18n.ts`, `apps/web/src/destinationFacts.test.tsx`, `CHANGELOG.md`.

- [ ] Add an **Airports** block to the facts card: each airport as `IATA · name · {distance} km`, nearest first, with a large/medium marker. i18n keys `facts.airports.title`, `facts.airports.row`.
- [ ] Test: after fetching facts, the airports block shows the nearest IATA + a distance.
- [ ] CHANGELOG `[Unreleased]` → Added. Commit `"Web: nearest-airports block on the destination-facts card"`.

---

### Task 5: Docs + verification sweep + merge

- [ ] `docs/data/DATA_SOURCES.md`: add OurAirports to the bundled/computed table (public domain).
- [ ] `cargo test --workspace`, clippy 0, fmt; `pnpm typecheck && pnpm test && pnpm build`; prettier only this feature's files.
- [ ] Drive the app on the mock gateway and screenshot the airports block.
- [ ] Merge to main and push.
