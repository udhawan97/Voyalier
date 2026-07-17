# Offline Gazetteer (Destination Autocomplete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Type-ahead for the origin/destination fields that actually knows the world's cities — offline. Today those fields only suggest the 16 pack names and the user's own trip history, so most destinations get no suggestion. A bundled GeoNames gazetteer of ~34,000 cities fixes it, matched Rust-side and returned per keystroke like the existing lodging suggestions.

**Why now:** `docs/data/DATA_SOURCES.md` forbids per-keystroke network geocoding and names a bundled gazetteer as the sanctioned fix ("suggestions stay offline and pack-backed" → now gazetteer-backed too). This is bundled public data + pure matching: ships live and fully verifiable, no network.

**Architecture:** A pure `voyalier-core::gazetteer` module embeds two files (`include_str!`): ~34k cities (`name, ascii, cc, population`) and ~250 country names (`cc → name`). It exposes `search_cities(query, limit)`. A new app method `suggest_places(query)` combines gazetteer matches with the pack catalog and the user's trip history and ranks them with the existing `rank_field_suggestions`. A new gateway method `suggestPlaces` replaces the frontend's ad-hoc pack+trip matching in `usePlaceSuggestions`. No storage, no migration.

**Tech Stack:** Rust (std only — no new crate), TypeScript contract + React.

## Data (captured live 2026-07-17)

- **Cities:** GeoNames `cities15000` (population ≥ 15,000), **CC BY 4.0**, attribution "GeoNames". Compacted to `name⇥ascii⇥cc⇥pop` (ascii empty when equal to name; 79% of rows), **sorted by population descending**, → `crates/voyalier-core/src/data/cities.tsv`, **34,008 cities, 751 KB**.
- **Country names:** GeoNames `countryInfo.txt`, ISO-3166-1 alpha-2 → English name, → `crates/voyalier-core/src/data/countries.tsv`, **252 rows, 3.5 KB**.
- **Golden values:** `"kyoto"` → Kyoto (JP, pop 1,463,723). `"paris"` → Paris (FR, 2.1M) **before** Paris (US, 24k) — population sort disambiguates. `"zur"` → Zürich (matched via ascii "Zurich").

## Global Constraints

- Offline and deterministic: no network, no source label beyond "GeoNames" attribution. Ranking is population then order — never a model.
- Prefix-only matching (autocomplete), case- and accent-insensitive (via the pre-folded ascii name). Query and city names are lower-cased **once at parse time**, not per keystroke — the per-query work is lower-casing the short query and scanning `starts_with`.
- Bundled data is `&'static str` parsed once (`std::sync::OnceLock`). `suggest_places` is **not** trip-scoped: it works in the Create-Trip dialog before any trip exists.
- Result capped at `FIELD_SUGGESTION_LIMIT` (8). Trip history and pack catalog rank before gazetteer, so the user's own places win ties.
- TDD: failing test first, watch it fail, minimal code, commit.

---

### Task 1: Core gazetteer module + bundled data

**Files:** `crates/voyalier-core/src/data/cities.tsv` + `countries.tsv` (already generated), `crates/voyalier-core/src/gazetteer.rs`; modify `lib.rs`.

**Interfaces:**
- Produces: `CitySuggestion { name: String, country_code: String, country: String }`, `search_cities(query: &str, limit: usize) -> Vec<CitySuggestion>`.

- [ ] **Step 1: Failing tests:**

```rust
#[test]
fn suggests_cities_by_prefix_biggest_first() {
    let kyoto = search_cities("kyoto", 5);
    assert_eq!(kyoto[0].name, "Kyoto");
    assert_eq!(kyoto[0].country, "Japan");

    // Population disambiguates same-named cities: Paris FR before Paris TX.
    let paris = search_cities("paris", 5);
    assert_eq!(paris[0].name, "Paris");
    assert_eq!(paris[0].country, "France");
    assert!(paris.iter().any(|c| c.country == "United States"));
    assert_eq!(paris.iter().position(|c| c.country == "France"),
               Some(0));

    // Prefix, not contains: "york" must not surface "New York".
    assert!(search_cities("york", 8).iter().all(|c| c.name != "New York"));
}

#[test]
fn matches_accents_via_the_ascii_name_and_bounds_the_result() {
    // "zur" matches "Zürich" through its folded ascii name.
    assert!(search_cities("zur", 8).iter().any(|c| c.name == "Zürich"));
    // A blank query suggests nothing rather than dumping the whole world.
    assert!(search_cities("   ", 8).is_empty());
    assert!(search_cities("kyoto", 0).is_empty());
    // The cap holds.
    assert!(search_cities("san", 8).len() <= 8);
    // Nonsense yields nothing, never a panic.
    assert!(search_cities("zzzzzznotacity", 8).is_empty());
}
```

- [ ] **Step 2: Verify failure.** `cargo test -p voyalier-core gazetteer` → FAIL.
- [ ] **Step 3: Implement.** `const CITIES_TSV = include_str!("data/cities.tsv");` `const COUNTRIES_TSV = include_str!("data/countries.tsv");` `countries()` → `OnceLock<HashMap<&'static str, &'static str>>`. `cities()` → `OnceLock<Vec<City>>` where `City { name: &'static str, cc: &'static str, name_lower: String, ascii_lower: Option<String>, }` (`ascii_lower` = `Some` only when the ascii field differs; population is only used for the pre-sort so it need not be stored). Since the file is pre-sorted by population descending, preserving file order gives biggest-first for free. `search_cities`: trim + lower-case the query; empty → `Vec::new()`; scan cities, keep those whose `name_lower` or `ascii_lower` `starts_with(query)`; take `limit`; map `cc` → country name (unknown cc → the code itself). Return owned `CitySuggestion`.
- [ ] **Step 4/5: Verify pass; commit** `"Core: offline city gazetteer from GeoNames"`.

---

### Task 2: `SuggestionSource::Gazetteer` + app `suggest_places`

**Files:** `crates/voyalier-core/src/suggest.rs` (enum variant); `crates/voyalier-app/src/lib.rs` (new method); re-exports.

**Interfaces:**
- `SuggestionSource::Gazetteer`.
- `suggest_places(&self, query: &str) -> Result<Vec<FieldSuggestion>, AppError>`.

- [ ] **Step 1: Failing test.** In the app tests: `service.suggest_places("kyo")` returns a suggestion whose value is `"Kyoto"`, source `Gazetteer`, detail `Some("Japan")`. Add a trip with origin "Kyoto" and assert the trip-history copy ranks first (dedup keeps the user's own). A blank query returns empty.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** `suggest_places`:
  - Candidates in priority order (so `rank_field_suggestions`'s stable order lets the user's own win the dedup): (1) this user's trip origins + destinations from the `trips` table → `TripHistory` with detail "from a previous trip"; (2) pack catalog names from `pack_catalog()` → `Catalog`; (3) `search_cities(query, FIELD_SUGGESTION_LIMIT)` → `Gazetteer` with detail = country.
  - `Ok(rank_field_suggestions(query, candidates))`. Blank query → the ranker already returns empty. Not trip-scoped, no vault, no network.
- [ ] **Step 4/5: Verify pass (`cargo test --workspace`); commit** `"App: suggest_places over gazetteer, packs and trip history"`.

---

### Task 3: Contract + both transports + mock

- [ ] `AppGateway.suggestPlaces(query: string): Promise<FieldSuggestion[]>`; `SuggestionSource` gains `"gazetteer"`.
- [ ] HTTP route `GET /api/v1/places/suggest?q=...` + handler; Tauri command `suggest_places` + registration.
- [ ] Mock: `suggestPlaces(query)` returns a small fixed city set filtered by prefix (Kyoto/Kobe/Kobe-like for "k"), each `{ value, source: "gazetteer", detail: "Japan" }`, plus honouring a blank query → `[]`.
- [ ] Verify `pnpm typecheck`, `cargo test -p voyalier-server`, `cargo build -p voyalier-desktop`. Commit `"Contract: suggestPlaces across both transports"`.

---

### Task 4: Frontend `usePlaceSuggestions` + tests

**Files:** `apps/web/src/app/usePlaceSuggestions.ts`, its test (or `CreateTripDialog` test), CHANGELOG.

- [ ] Rewrite the hook to call `gateway.suggestPlaces(query)` per keystroke (local, no network — same as lodging), mapping `FieldSuggestion` → `ComboboxItem { value, detail }`. A blank query returns `[]`. Drop the frontend pack+trip loading now that Rust owns it. Keep it resilient: a gateway error yields `[]` (the field still works).
- [ ] Test (component or hook): typing "kyo" in the destination field surfaces a "Kyoto" option with a "Japan" detail, via the mock gateway.
- [ ] CHANGELOG `[Unreleased]` → Added. Commit `"Web: destination autocomplete backed by the offline gazetteer"`.

---

### Task 5: Docs + verification sweep + merge

- [ ] `docs/data/DATA_SOURCES.md`: add GeoNames to the bundled/computed table (CC BY 4.0, attribution "GeoNames"); note the place-suggestion section now includes the bundled gazetteer.
- [ ] `cargo test --workspace`, clippy 0, fmt; `pnpm typecheck && pnpm test && pnpm build`; prettier only this feature's files.
- [ ] Drive the app on the mock gateway, type in the destination field, screenshot the suggestions.
- [ ] Merge to main and push.
