# Time Difference (Dual-Clock / Jet-Lag) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Red-green-refactor every task.

**Goal:** Tell the traveller how far the destination clock runs ahead of (or behind) home — "Osaka is 14 hours ahead of Chicago" — on the destination-facts card, computed offline from two stored UTC offsets.

**Why now:** The facts card already geocodes the destination and stores its `utc_offset_minutes`. The only missing input is the origin's offset, and a live check confirmed the origin free-text geocodes cleanly (Chicago→America/Chicago, London→Europe/London, Sydney→Australia/Sydney). So this is one extra best-effort geocode on the existing consent-gated fetch, two nullable snapshot columns, and a derived-on-read field — the same shape as the astro/airports work already shipped.

**Architecture:** `fetch_destination_facts` additionally geocodes `trip.origin` (best-effort — empty or unresolvable origin just yields no difference) and stores `origin_place` + `origin_utc_offset_minutes` on the facts snapshot. A pure `voyalier-core::time_difference()` turns the two offsets into a signed `TimeDifference { origin_place, offset_minutes }` (destination − origin). `get_trip_detail` derives `TripDetail.time_difference` on read, exactly like `country_facts`/`astro`/`nearest_airports`. The React card renders a "Clock" block; the interface owns the words (ahead / behind / same, hours + minutes).

**Tech Stack:** Rust (std + jiff, already a dep), TypeScript contract + React. No new crates, no new gateway method (a derived `TripDetail` field flows through both transports untouched).

## Global Constraints

- **Offline and deterministic on read.** The two offsets are resolved once, at fetch time, for the trip's `start_date` (via the existing `offset_minutes_for` / jiff). No network and no `now()` on read; the difference is a static, testable fact, not a ticking live clock (YAGNI).
- **Best-effort origin.** The destination geocode stays mandatory (it drives the whole card). The origin geocode is a bonus, wrapped like the ECB rates are: any error, empty result, or blank origin → `origin_*` stay `None` and the Clock block simply does not render. A failed origin geocode never fails the fetch.
- **Sub-hour zones survive.** Offsets are minutes, never whole hours — Kathmandu (+345) and Kolkata (+330) must render "10h 45m", not a rounded hour.
- **Same-time is shown, not hidden.** A zero difference renders "keeps the same time as {origin}" — reassuring, worth a line.
- **Migrations append-only, self-detecting.** v7 ALTERs `destination_facts_snapshots`; because a fresh DB runs the base CREATE (which gains the columns) *and then* every migration from version 0, v7 must detect its columns and skip when present — exactly like `migrate_weather_layers`. Pin migration tests to `target_schema_version()`, never a literal.
- **Origin edits invalidate the snapshot.** The snapshot now depends on `trip.origin`, so `update_trip` must delete it when the origin changes (it already does for destination changes).
- TDD: failing test first, watch it fail, minimal code, commit.

---

### Task 1: Core `TimeDifference` type + `time_difference()`

**Files:** `crates/voyalier-core/src/facts.rs`; re-export in `crates/voyalier-core/src/lib.rs`.

**Interfaces:**
- Produces: `TimeDifference { origin_place: String, offset_minutes: i32 }` (Serialize, camelCase); `pub fn time_difference(origin_place: &str, origin_utc_offset_minutes: i32, destination_utc_offset_minutes: i32) -> TimeDifference`.

- [ ] **Step 1: Failing test** (in `facts.rs` tests):

```rust
#[test]
fn time_difference_is_signed_destination_minus_origin() {
    // Tokyo (+540) seen from Chicago (−300, CDT) is 840 min = 14h ahead.
    let ahead = time_difference("Chicago", -300, 540);
    assert_eq!(ahead.origin_place, "Chicago");
    assert_eq!(ahead.offset_minutes, 840);
    // Westward is negative (behind): Chicago seen from Tokyo.
    assert_eq!(time_difference("Tokyo", 540, -300).offset_minutes, -840);
    // Same clock is zero, still reported (worth a "same time" line).
    assert_eq!(time_difference("Paris", 120, 120).offset_minutes, 0);
    // Sub-hour zones survive: Kathmandu (+345) from Chicago (−300) = 645 = 10h45m.
    assert_eq!(time_difference("Chicago", -300, 345).offset_minutes, 645);
}
```

- [ ] **Step 2: Verify failure.** `cargo test -p voyalier-core time_difference` → FAIL (function missing).
- [ ] **Step 3: Implement.** Add the `TimeDifference` struct (`#[derive(Debug, Clone, PartialEq, Eq, Serialize)]`, `#[serde(rename_all = "camelCase")]`) and `time_difference` returning `TimeDifference { origin_place: origin_place.to_owned(), offset_minutes: destination_utc_offset_minutes - origin_utc_offset_minutes }`. Re-export both from `lib.rs` beside the other facts exports.
- [ ] **Step 4/5: Verify pass; commit** `"Core: time difference from two UTC offsets"`.

---

### Task 2: Snapshot origin columns + migration v7 + fetch + derive + invalidation

**Files:** `crates/voyalier-core/src/facts.rs` (snapshot fields), `crates/voyalier-core/src/types.rs` (TripDetail field), `crates/voyalier-app/src/lib.rs` (base CREATE, migration, fetch, load, derive, invalidate).

**Interfaces:**
- `DestinationFactsSnapshot` gains `origin_place: Option<String>` and `origin_utc_offset_minutes: Option<i32>` (both `#[serde(default, skip_serializing_if = "Option::is_none")]`).
- `TripDetail` gains `time_difference: Option<TimeDifference>` (`#[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]` — derived on read like `country_facts`).

- [ ] **Step 1: Failing tests** (in the app tests module). Test A — the happy path routes the origin geocode by query:

```rust
#[test]
fn fetch_destination_facts_resolves_origin_for_a_time_difference() {
    struct RoutedFetcher;
    impl AdviceFetcher for RoutedFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            if url.contains("geocoding-api.open-meteo.com") {
                // Origin "Chicago" vs destination "Kyoto", told apart by the query.
                if url.contains("name=Chicago") {
                    return Ok(r#"{ "results": [ { "name": "Chicago",
                        "latitude": 41.85, "longitude": -87.65, "country": "United States",
                        "country_code": "US", "timezone": "America/Chicago" } ] }"#
                        .to_owned());
                }
                return Ok(facts_geocode_body("JP", "Asia/Tokyo"));
            }
            if url.contains("ecb.europa.eu") {
                return Ok(ECB_BODY.to_owned());
            }
            Err(AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
        }
    }

    let database = temp_database("facts_timediff");
    let service = open_test_service_with_fetcher(&database, Arc::new(RoutedFetcher)).expect("service");
    // start_date 2027-04-01: Chicago is CDT (−300), Tokyo +540 → 840 min ahead.
    let trip = service.create_trip(valid_trip_input()).expect("trip");

    let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
    assert_eq!(snapshot.origin_place.as_deref(), Some("Chicago"));
    assert_eq!(snapshot.origin_utc_offset_minutes, Some(-300));

    let detail = service.get_trip(&trip.id).expect("detail");
    let diff = detail.time_difference.expect("time difference derived");
    assert_eq!(diff.origin_place, "Chicago");
    assert_eq!(diff.offset_minutes, 840);
    cleanup_database(database);
}

#[test]
fn an_unresolvable_origin_yields_no_time_difference() {
    struct EmptyOriginFetcher;
    impl AdviceFetcher for EmptyOriginFetcher {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            if url.contains("geocoding-api.open-meteo.com") {
                if url.contains("name=Kyoto") {
                    return Ok(facts_geocode_body("JP", "Asia/Tokyo"));
                }
                return Ok(r#"{ "results": [] }"#.to_owned()); // origin matches nothing
            }
            if url.contains("ecb.europa.eu") {
                return Ok(ECB_BODY.to_owned());
            }
            Err(AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
        }
    }
    let database = temp_database("facts_no_origin");
    let service = open_test_service_with_fetcher(&database, Arc::new(EmptyOriginFetcher)).expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    let snapshot = service.fetch_destination_facts(&trip.id).expect("snapshot");
    assert_eq!(snapshot.origin_place, None);
    assert_eq!(snapshot.origin_utc_offset_minutes, None);
    assert!(service.get_trip(&trip.id).expect("detail").time_difference.is_none());
    cleanup_database(database);
}

#[test]
fn editing_the_origin_invalidates_the_facts_snapshot() {
    let database = temp_database("facts_origin_edit");
    let service = open_test_service_with_fetcher(&database, Arc::new(routed_facts_fetcher()))
        .expect("service");
    let trip = service.create_trip(valid_trip_input()).expect("trip");
    service.fetch_destination_facts(&trip.id).expect("snapshot");
    service
        .update_trip(&trip.id, UpdateTripInput {
            title: None, origin: Some("Denver".to_owned()), destination: None,
            start_date: None, end_date: None,
        })
        .expect("origin edit");
    let after = service.get_trip(&trip.id).expect("detail after edit");
    assert!(after.destination_facts.is_none());
    assert!(after.time_difference.is_none());
    cleanup_database(database);
}

#[test]
fn migration_v7_adds_origin_columns_to_the_facts_table() {
    let connection = Connection::open_in_memory().expect("memory db");
    connection
        .execute_batch(
            r#"CREATE TABLE trips (id TEXT PRIMARY KEY);
               CREATE TABLE destination_facts_snapshots (
                 trip_id TEXT PRIMARY KEY, place_name TEXT NOT NULL, place_region TEXT NOT NULL,
                 latitude REAL NOT NULL, longitude REAL NOT NULL, utc_offset_minutes INTEGER NOT NULL,
                 country_code TEXT NOT NULL, rate_date TEXT NOT NULL,
                 currency_rates TEXT NOT NULL DEFAULT '[]', retrieved_at TEXT NOT NULL);
               PRAGMA user_version = 6;"#,
        )
        .expect("pre-v7 shape");
    migrate(&connection).expect("migrate to v7");
    assert_eq!(user_version(&connection).expect("version"), target_schema_version());
    let columns: Vec<String> = {
        let mut s = connection.prepare("PRAGMA table_info(destination_facts_snapshots)").unwrap();
        s.query_map([], |r| r.get::<_, String>(1)).unwrap().collect::<rusqlite::Result<_>>().unwrap()
    };
    assert!(columns.iter().any(|c| c == "origin_place"));
    assert!(columns.iter().any(|c| c == "origin_utc_offset_minutes"));
}
```

Add a small shared helper near `facts_geocode_body`:

```rust
fn routed_facts_fetcher() -> impl AdviceFetcher {
    struct F;
    impl AdviceFetcher for F {
        fn fetch_text(&self, url: &str) -> Result<String, AppError> {
            if url.contains("geocoding-api.open-meteo.com") {
                if url.contains("name=Kyoto") { return Ok(facts_geocode_body("JP", "Asia/Tokyo")); }
                return Ok(r#"{ "results": [ { "name": "Home", "latitude": 41.85,
                    "longitude": -87.65, "country": "United States", "country_code": "US",
                    "timezone": "America/Chicago" } ] }"#.to_owned());
            }
            if url.contains("ecb.europa.eu") { return Ok(ECB_BODY.to_owned()); }
            Err(AppError::new(ErrorCode::WeatherFetchFailed, "unexpected url"))
        }
    }
    F
}
```

- [ ] **Step 2: Verify failure.** `cargo test -p voyalier-app time_difference` / `origin` / `migration_v7` → FAIL.
- [ ] **Step 3: Implement.**
  - `facts.rs`: add the two `Option` fields to `DestinationFactsSnapshot` (after `retrieved_at` is fine; keep serde skip attrs).
  - `types.rs`: add `time_difference: Option<TimeDifference>` to `TripDetail` with the derived-on-read serde attrs; import `TimeDifference`.
  - `lib.rs` base CREATE (~3109): append `origin_place TEXT` and `origin_utc_offset_minutes INTEGER` (nullable, no default needed).
  - `lib.rs` MIGRATIONS: append `Migration { to: 7, name: "facts_origin", run: migrate_facts_origin }`. Implement `migrate_facts_origin` self-detecting: read `PRAGMA table_info(destination_facts_snapshots)`; if `origin_place` absent, `ALTER TABLE destination_facts_snapshots ADD COLUMN origin_place TEXT;` and `... ADD COLUMN origin_utc_offset_minutes INTEGER;`. Do **not** touch the historical `migrate_destination_facts`.
  - `fetch_destination_facts`: after the destination geocode, best-effort resolve the origin —
    ```rust
    let (origin_place, origin_utc_offset_minutes) = if trip.origin.trim().is_empty() {
        (None, None)
    } else {
        let origin_url = format!(
            "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1&language=en&format=json",
            percent_encode(&trip.origin),
        );
        match self.fetcher.fetch_text(&origin_url).ok()
            .and_then(|body| parse_geocoding_response(&body).ok())
        {
            Some(place) => (
                Some(place.name),
                Some(offset_minutes_for(&place.timezone, &trip.start_date)),
            ),
            None => (None, None),
        }
    };
    ```
    Set both on the `DestinationFactsSnapshot`; extend the INSERT column list + `params!` (two more `?`), and the `ON CONFLICT ... DO UPDATE SET` clause. Update the doc comment ("exactly two requests" → the origin adds a best-effort third).
  - `load_destination_facts_snapshot`: add `origin_place, origin_utc_offset_minutes` to the SELECT and read them (`row.get(9)?`, `row.get(10)?` as `Option`).
  - `get_trip_detail`: derive `let time_difference = destination_facts.as_ref().and_then(|s| Some(time_difference(s.origin_place.as_deref()?, s.origin_utc_offset_minutes?, s.utc_offset_minutes)));` and add it to the returned `TripDetail`.
  - `update_trip`: add `let origin_changed = current.origin != input.origin;` and gate the `destination_facts_snapshots` DELETE on `destination_changed || origin_changed` (split it out of the destination-only advisory block).
- [ ] **Step 4/5: Verify pass** (`cargo test -p voyalier-app`, then `cargo test --workspace`); **commit** `"App: resolve origin timezone and derive the time difference"`.

---

### Task 3: Contract + mock

**Files:** `packages/contracts/src/index.ts`, `packages/contracts/src/mock.ts`.

- [ ] `index.ts`: add `export interface TimeDifference { originPlace: string; offsetMinutes: number; }`; add `timeDifference?: TimeDifference;` to `TripDetail` (after `nearestAirports`); add `originPlace?: string;` and `originUtcOffsetMinutes?: number;` to `DestinationFactsSnapshot`.
- [ ] `mock.ts`: in `fetchDestinationFacts`, set `originPlace: trip.origin` and `originUtcOffsetMinutes: -300` on the snapshot (Chicago-like), so the fixture's +540 destination yields a real 840-minute difference. In `getTripDetail`, derive `const timeDifference = destFacts?.originUtcOffsetMinutes != null ? { originPlace: destFacts.originPlace!, offsetMinutes: destFacts.utcOffsetMinutes - destFacts.originUtcOffsetMinutes } : undefined;` and spread `...(timeDifference ? { timeDifference } : {})` into the returned detail.
- [ ] Verify `pnpm --filter @voyalier/contracts typecheck` (or root `pnpm typecheck`). No transport edits — `timeDifference` rides on `getTripDetail`'s JSON and the origin fields ride on `fetchDestinationFacts`'s snapshot JSON (both transports parse whole objects; confirm with a grep that `http.ts`/`tauri.ts` `getTripDetail` returns the parsed body without a field whitelist). Commit `"Contract: timeDifference on TripDetail + origin fields on the facts snapshot"`.

---

### Task 4: Web Clock block + i18n + test + changelog

**Files:** `apps/web/src/views/DestinationFacts.tsx`, `apps/web/src/views/TripDetailView.tsx`, `apps/web/src/app/i18n.ts`, a test (`apps/web/src/*.test.tsx`), `CHANGELOG.md`.

- [ ] **i18n** (`i18n.ts`, beside the other `facts.*` keys):
  ```
  "facts.clock.title": "Time difference",
  "facts.clock.ahead": "{destination} is {duration} ahead of {origin}",
  "facts.clock.behind": "{destination} is {duration} behind {origin}",
  "facts.clock.same": "{destination} keeps the same time as {origin}",
  "facts.clock.hours": "{hours}h",
  "facts.clock.hoursMinutes": "{hours}h {minutes}m",
  ```
- [ ] **Clock block** in `DestinationFacts.tsx`: a `Clock({ destination, diff }: { destination: string; diff: TimeDifference })` component. Compute `const abs = Math.abs(diff.offsetMinutes); const hours = Math.floor(abs / 60); const minutes = abs % 60; const duration = minutes === 0 ? t("facts.clock.hours", { hours }) : t("facts.clock.hoursMinutes", { hours, minutes });` then pick `same` when `offsetMinutes === 0`, else `ahead`/`behind` by sign, passing `{ destination, duration, origin: diff.originPlace }`. Render it as the first `voy-facts__block` in the grid (clock before sky reads naturally). Add a `timeDifference?: TimeDifference` prop and render the block only when `snapshot && timeDifference` — use `snapshot.placeName` as `destination`.
- [ ] **Wire it** in `TripDetailView.tsx`: pass `timeDifference={data.detail.timeDifference}` to `<DestinationFacts>`. Import `TimeDifference` type where needed.
- [ ] **Test** (extend `destinationFacts` view test, or a focused new one): create a trip (origin "Chicago", destination "Osaka"), open detail, click Fetch destination facts, and assert a "Time difference" block appears reading `/Osaka/` … `/ahead/` … `/Chicago/`. (Mock: placeName = destination = "Osaka", originPlace = origin = "Chicago", 840 min.)
- [ ] **CHANGELOG** `[Unreleased]` → Added: destination-facts card now shows the time difference from the trip's origin. Commit `"Web: show the destination-vs-origin time difference"`.

---

### Task 5: Docs + verification sweep + merge

- [ ] `docs/data/DATA_SOURCES.md`: extend the Open-Meteo geocoding note — it now also resolves the **origin** to a timezone for the offline time difference (still one keyless click, best-effort, no new provider).
- [ ] `cargo test --workspace` (expect the new tests green, all prior green), `cargo clippy --workspace --all-targets` (0 warnings), `cargo fmt`.
- [ ] `pnpm typecheck && pnpm test && pnpm build`; prettier only this feature's touched files. (If the machine is under load, run heavy web files in isolation and check `uptime` before trusting timeouts — see memory.)
- [ ] Drive the app on the mock gateway, fetch destination facts, screenshot the Clock block.
- [ ] Merge to `main` and push to `origin`; confirm `main == origin/main`.
