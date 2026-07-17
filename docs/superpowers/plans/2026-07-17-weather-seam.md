# Weather Seam Implementation Plan (seam 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the existing one-click weather outlook into typical-weather-for-these-dates (climate normals), a UV + air-quality layer, US National Weather Service alerts, and a deterministic packing list — all on the seam and the click that already exist.

**Architecture:** Four pure additions to `voyalier-core::weather` (normals, air quality, alerts) plus a new IO-free `packing` module, hung off the existing `fetch_weather` service call and `WeatherSnapshot` storage row. No new gateway capability: `fetchWeather` returns a richer snapshot, and the packing list rides `TripDetail` because it is derived, not fetched.

**Tech Stack:** Rust (serde_json, jiff), SQLite via rusqlite (migration v5), TypeScript contract + React panel.

## Global Constraints

- Network only on the existing explicit click; all fetches Rust-side via `AdviceFetcher` with its identifying User-Agent; results stored as one dated snapshot.
- **Weather is planning texture, never a safety claim** (`weather.rs` header). Normals describe the past; they never predict. Alerts are the source's own words, linked, never summarized into a verdict.
- **Open-Meteo's free tier is non-commercial only.** This seam deepens that dependence: archive + air-quality are the same provider and terms. Launch-blocking for any paid tier (paid API or AGPL self-host) — already recorded in `docs/data/DATA_SOURCES.md`.
- Attribution (exact): Open-Meteo `Weather data by Open-Meteo.com` (CC BY 4.0); NWS `Public domain (U.S. National Weather Service)`.
- Migration ledger is append-only; new step is `to: 5`.
- TDD: failing test first, watch it fail, minimal code, commit. `cargo test -p <crate>`, `pnpm --filter @voyalier/web test -- --run <file>`.

## Source payload shapes (captured live 2026-07-17)

- **Geocoding** `geocoding-api.open-meteo.com/v1/search` → results carry `country_code` (`"JP"`, `"US"`). This is the gate for the US-only NWS call — no second lookup.
- **Archive** `archive-api.open-meteo.com/v1/archive?...&start_date=2016-11-01&end_date=2025-11-30&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto` → `{daily: {time: [...], temperature_2m_max: [...], temperature_2m_min: [...], precipitation_sum: [...]}}`. **10 years in one 92 KB request, 3317 days, no nulls.** One request beats ten; core filters to the trip's month-day window.
- **Air quality** `air-quality-api.open-meteo.com/v1/air-quality?...&daily=uv_index_max&hourly=us_aqi,pm2_5&timezone=auto` → `daily.uv_index_max` is real; **`pm2_5_max` / `us_aqi_max` are NOT valid daily variables** (the API rejects them). AQI and PM2.5 are hourly only, so core aggregates hourly → daily max deterministically.
- **NWS** `api.weather.gov/alerts/active?point=29.21,-99.79` → GeoJSON `features[].properties` with `event`, `severity` (`Extreme|Severe|Moderate|Minor|Unknown`), `headline`, `areaDesc`, `onset`, `ends`, `expires`, `senderName`, `status`, `messageType`, `description`, `instruction`. **The live nationwide feed right now contains a `status: "Test"` alert (1 of 426).** Filtering to `status == "Actual"` is a correctness requirement, not hygiene: a test tornado warning rendered as real is exactly the kind of false safety claim this codebase forbids.

---

### Task 1: Core climate normals

**Files:** Create `crates/voyalier-core/src/normals.rs` (or extend `weather.rs` if it stays under ~400 lines — prefer a new module); modify `lib.rs`.

**Interfaces:**
- Produces: `ClimateNormals { years_sampled: u32, sample_days: u32, first_year: i16, last_year: i16, avg_high_c: f64, avg_low_c: f64, wet_day_share_pct: f64, warmest_high_c: f64, coldest_low_c: f64 }`, `archive_window(start: &str, end: &str, years: u32) -> Result<(String, String), AppError>`, `parse_climate_normals(json: &str, trip_start: &str, trip_end: &str) -> Result<Option<ClimateNormals>, AppError>`.

- [ ] **Step 1: Failing tests.**

```rust
#[test]
fn archive_window_asks_for_whole_years_before_the_trip() {
    // A Nov 3–12 2026 trip samples Nov of the ten years before it.
    let (start, end) = archive_window("2026-11-03", "2026-11-12", 10).expect("window");
    assert_eq!(start, "2016-11-03");
    assert_eq!(end, "2025-11-12");
}

#[test]
fn parses_normals_from_the_same_dates_in_past_years() {
    // Two years, three days each; only the trip's month-days count.
    let json = r#"{"daily": {
        "time": ["2024-11-02","2024-11-03","2024-11-04","2024-11-05",
                 "2025-11-02","2025-11-03","2025-11-04","2025-11-05"],
        "temperature_2m_max": [30.0, 18.0, 20.0, 22.0, 30.0, 16.0, 18.0, 20.0],
        "temperature_2m_min": [1.0, 8.0, 10.0, 12.0, 1.0, 6.0, 8.0, 10.0],
        "precipitation_sum": [99.0, 0.0, 5.0, 0.2, 99.0, 1.5, 0.0, 0.0]
    }}"#;
    let normals = parse_climate_normals(json, "2026-11-03", "2026-11-05")
        .expect("parsed")
        .expect("enough samples");
    // The 11-02 rows are outside the trip's month-day window and are ignored:
    // their 30.0/1.0/99.0 values would visibly skew every field if counted.
    assert_eq!(normals.sample_days, 6);
    assert_eq!(normals.years_sampled, 2);
    assert_eq!(normals.first_year, 2024);
    assert_eq!(normals.last_year, 2025);
    assert_eq!(normals.avg_high_c, 19.0); // (18+20+22+16+18+20)/6
    assert_eq!(normals.avg_low_c, 9.0); // (8+10+12+6+8+10)/6
    assert_eq!(normals.warmest_high_c, 22.0);
    assert_eq!(normals.coldest_low_c, 6.0);
    // A wet day is >= 1mm: 5.0 and 1.5 qualify; 0.2 and 0.0 do not.
    assert_eq!(normals.wet_day_share_pct, 33.3);
}

#[test]
fn normals_need_enough_history_to_be_worth_a_claim() {
    // One year of one day is not a "typical" anything.
    let json = r#"{"daily": {"time": ["2025-11-03"], "temperature_2m_max": [18.0],
                   "temperature_2m_min": [8.0], "precipitation_sum": [0.0]}}"#;
    assert!(
        parse_climate_normals(json, "2026-11-03", "2026-11-05")
            .expect("parsed")
            .is_none(),
        "too few samples reports nothing rather than a false typical"
    );
    // Gaps in the source degrade rather than lie: nulls are skipped.
    let json = r#"{"daily": {
        "time": ["2023-11-03","2024-11-03","2025-11-03","2022-11-03","2021-11-03"],
        "temperature_2m_max": [18.0, null, 20.0, 19.0, 21.0],
        "temperature_2m_min": [8.0, null, 10.0, 9.0, 11.0],
        "precipitation_sum": [0.0, null, 0.0, 0.0, 0.0]
    }}"#;
    let normals = parse_climate_normals(json, "2026-11-03", "2026-11-05")
        .expect("parsed")
        .expect("four good samples");
    assert_eq!(normals.sample_days, 4);
    assert_eq!(normals.avg_high_c, 19.5);

    assert!(parse_climate_normals("<html>", "2026-11-03", "2026-11-05").is_err());
    assert!(archive_window("nonsense", "2026-11-12", 10).is_err());
}
```

- [ ] **Step 2: Verify failure.** `cargo test -p voyalier-core normals` → FAIL.
- [ ] **Step 3: Implement.** `archive_window`: parse both dates with `jiff::civil::Date`, return `(start - years, end - 1 year)` — i.e. first_year = start.year - years, last_year = end.year - 1, keeping each date's month-day. `parse_climate_normals`: walk `daily.time` with its three parallel arrays; keep a row when its `MM-DD` falls inside the trip's `MM-DD` window (inclusive; if the trip window wraps the new year, accept either side of the wrap) **and** all three values are non-null. Round every output to one decimal. `MIN_SAMPLE_DAYS = 4` and `MIN_YEARS = 2`; below either, return `Ok(None)`. Wet day = `precipitation_sum >= 1.0`. Bad JSON / missing `daily` → `Err(unreadable_source())`.
- [ ] **Step 4: Verify pass.** `cargo test -p voyalier-core` all green.
- [ ] **Step 5: Commit** `"Core: climate normals from the same dates in past years"`.

---

### Task 2: Core air quality

**Files:** modify the new module; `lib.rs`.

**Interfaces:**
- Produces: `AirQualityDay { date: String, uv_index_max: Option<f64>, us_aqi_max: Option<u16>, pm2_5_max: Option<f64> }`, `parse_air_quality(json: &str, trip_start: &str, trip_end: &str) -> Result<Vec<AirQualityDay>, AppError>`.

- [ ] **Step 1: Failing test.**

```rust
#[test]
fn parses_daily_uv_and_folds_hourly_aqi_into_days() {
    // Shaped like the real response: uv is daily, aqi and pm2.5 are hourly only.
    let json = r#"{
      "daily": {"time": ["2026-11-03","2026-11-04"], "uv_index_max": [7.95, 8.5]},
      "hourly": {
        "time": ["2026-11-03T00:00","2026-11-03T13:00","2026-11-04T00:00","2026-11-05T00:00"],
        "us_aqi": [64, 91, 58, 200],
        "pm2_5": [19.0, 25.5, 17.3, 80.0]
      }
    }"#;
    let days = parse_air_quality(json, "2026-11-03", "2026-11-04").expect("parsed");
    assert_eq!(days.len(), 2);
    assert_eq!(days[0].date, "2026-11-03");
    assert_eq!(days[0].uv_index_max, Some(7.95));
    // The day's worst hour is the day's number — an average would hide the peak.
    assert_eq!(days[0].us_aqi_max, Some(91));
    assert_eq!(days[0].pm2_5_max, Some(25.5));
    assert_eq!(days[1].us_aqi_max, Some(58));
    // 11-05 is outside the trip window and never appears.
    assert!(days.iter().all(|day| day.date != "2026-11-05"));
}

#[test]
fn air_quality_degrades_rather_than_failing() {
    // Daily present, hourly absent: still worth a UV number.
    let json = r#"{"daily": {"time": ["2026-11-03"], "uv_index_max": [7.0]}}"#;
    let days = parse_air_quality(json, "2026-11-03", "2026-11-04").expect("parsed");
    assert_eq!(days.len(), 1);
    assert_eq!(days[0].uv_index_max, Some(7.0));
    assert_eq!(days[0].us_aqi_max, None);
    // Nulls are absent, not zero: 0 AQI would read as pristine air.
    let json = r#"{"daily": {"time": ["2026-11-03"], "uv_index_max": [null]},
                   "hourly": {"time": ["2026-11-03T00:00"], "us_aqi": [null], "pm2_5": [null]}}"#;
    let days = parse_air_quality(json, "2026-11-03", "2026-11-04").expect("parsed");
    assert_eq!(days[0].uv_index_max, None);
    assert_eq!(days[0].us_aqi_max, None);
    assert!(parse_air_quality("<html>", "2026-11-03", "2026-11-04").is_err());
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Build a map from `YYYY-MM-DD` → running max over `hourly.time` (split the `T`), skipping nulls. Emit one `AirQualityDay` per `daily.time` entry inside `[trip_start, trip_end]`, joining the hourly maxima. Missing `daily` → `Err`. Cap at 32 days.
- [ ] **Step 4/5: Verify pass; commit** `"Core: UV and air-quality day layer"`.

---

### Task 3: Core NWS alerts

**Interfaces:**
- Produces: `WeatherAlert { event: String, severity: String, headline: String, area: String, onset: Option<String>, ends: Option<String>, sender: String, url: String }`, `parse_nws_alerts(json: &str) -> Result<Vec<WeatherAlert>, AppError>`.

- [ ] **Step 1: Failing test.**

```rust
#[test]
fn parses_active_alerts_and_drops_test_broadcasts() {
    // Shaped like the real feed, which really does carry Test alerts.
    let json = r#"{"type": "FeatureCollection", "features": [
      {"properties": {"id": "urn:oid:1", "event": "Flood Warning", "severity": "Severe",
        "headline": "Flood Warning issued July 17 at 1:58AM CDT by NWS Austin/San Antonio TX",
        "areaDesc": "Uvalde, TX", "onset": "2026-07-17T01:58:00-05:00",
        "ends": "2026-07-18T03:12:00-05:00", "senderName": "NWS Austin/San Antonio TX",
        "status": "Actual", "messageType": "Update"}},
      {"properties": {"id": "urn:oid:2", "event": "Tornado Warning", "severity": "Extreme",
        "headline": "TEST tornado warning", "areaDesc": "Nowhere, TX",
        "senderName": "NWS Test", "status": "Test", "messageType": "Alert"}}
    ]}"#;
    let alerts = parse_nws_alerts(json).expect("parsed");
    // A test broadcast rendered as real is a false safety claim.
    assert_eq!(alerts.len(), 1);
    assert_eq!(alerts[0].event, "Flood Warning");
    assert_eq!(alerts[0].severity, "Severe");
    assert_eq!(alerts[0].area, "Uvalde, TX");
    assert_eq!(alerts[0].sender, "NWS Austin/San Antonio TX");
    assert_eq!(alerts[0].onset.as_deref(), Some("2026-07-17T01:58:00-05:00"));
    assert_eq!(alerts[0].url, "https://api.weather.gov/alerts/urn:oid:1");
}

#[test]
fn no_alerts_is_a_valid_answer_but_a_non_feed_is_not() {
    let empty = parse_nws_alerts(r#"{"type": "FeatureCollection", "features": []}"#)
        .expect("an empty collection is a valid answer");
    assert!(empty.is_empty());
    // Anything without a features array is not the feed we asked for.
    assert!(parse_nws_alerts("<html>503</html>").is_err());
    assert!(parse_nws_alerts(r#"{"error": "nope"}"#).is_err());
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Require `features` to be an array (else `Err`). Keep only `status == "Actual"`. Map fields verbatim; `url` = `https://api.weather.gov/alerts/{id}`; missing `severity` → `"Unknown"`. Cap at 20 alerts.
- [ ] **Step 4/5: Verify pass; commit** `"Core: NWS active alerts, test broadcasts excluded"`.

---

### Task 4: Core packing list

**Files:** Create `crates/voyalier-core/src/packing.rs`; `lib.rs`.

**Interfaces:**
- Consumes `ClimateNormals`, `WeatherSnapshot`, `Trip`, `[ConfirmedFact]`.
- Produces: `PackingSuggestion { code: PackingCode, reason: PackingReason }`, `PackingCode` (closed enum), `PackingReason { code: PackingReasonCode, value?: f64 }`, `build_packing_list(trip, facts, weather) -> Vec<PackingSuggestion>`.

**Copy rule (ADR-0003's standing amendment):** the core reports **codes and numbers**; the interface owns the words. No English sentences in this module.

- [ ] **Step 1: Failing test.**

```rust
#[test]
fn suggests_from_what_the_weather_and_the_itinerary_actually_say() {
    let normals = ClimateNormals { avg_high_c: 8.0, avg_low_c: -2.0, wet_day_share_pct: 55.0, ..sample_normals() };
    let list = build_packing_list_from_parts(&normals, &[/* uv 9.0 day */], 5);
    let codes: Vec<_> = list.iter().map(|s| s.code).collect();
    assert!(codes.contains(&PackingCode::WarmLayers)); // avg_low below 5C
    assert!(codes.contains(&PackingCode::RainShell)); // wet day share above 40%
    assert!(codes.contains(&PackingCode::SunProtection)); // uv at or above 8
    assert!(!codes.contains(&PackingCode::LightClothing)); // avg_high below 22C
    // Every suggestion carries the number that produced it, so the reason is
    // checkable rather than a vibe.
    let rain = list.iter().find(|s| s.code == PackingCode::RainShell).expect("rain");
    assert_eq!(rain.reason.code, PackingReasonCode::WetDayShare);
    assert_eq!(rain.reason.value, Some(55.0));
}

#[test]
fn suggests_nothing_without_evidence() {
    // No weather snapshot means no claim about what to pack.
    assert!(build_packing_list(&sample_trip(), &[], None).is_empty());
}
```

(Write `build_packing_list` as the public entry taking `Option<&WeatherSnapshot>`; keep the parts-based helper private or fold the test into the public shape — do not ship a public API that exists only for tests.)

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Rules, each firing only on evidence present: `avg_low_c < 5` → `WarmLayers(AvgLow)`; `avg_high_c >= 22` → `LightClothing(AvgHigh)`; `wet_day_share_pct >= 40` → `RainShell(WetDayShare)`; any day `uv_index_max >= 8` → `SunProtection(UvIndex)`; any day `us_aqi_max >= 100` → `Mask(Aqi)`; a confirmed flight → `TravelDocuments(HasFlight)`; trip nights >= 7 → `Laundry(Nights)`. `None` weather → empty. Deterministic order = enum order.
- [ ] **Step 4/5: Verify pass; commit** `"Core: deterministic packing suggestions"`.

---

### Task 5: App — migration v5, richer fetch, packing on trip detail

**Files:** `crates/voyalier-app/src/lib.rs`; `crates/voyalier-core/src/types.rs` (`TripDetail.packing_list`).

- [ ] **Step 1: Failing test.** Extend `fetch_weather_geocodes_the_destination_and_stores_the_outlook`'s `RoutedFetcher` with archive / air-quality / NWS bodies keyed by URL, then assert: a US destination gets alerts and a non-US one never calls `api.weather.gov` at all; normals + air-quality days persist through `get_trip`; an archive failure still stores the forecast (weather degrades, never all-or-nothing); `TripDetail.packing_list` is non-empty once a snapshot exists. Also a v5 migration test mirroring `migration_v4_...`: a pre-v5 `weather_snapshots` row survives with `normals`/`air_quality`/`alerts` defaulting to empty.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.**
  - Migration `to: 5`, `name: "weather_layers"`: `ALTER TABLE weather_snapshots ADD COLUMN normals TEXT`, `... ADD COLUMN air_quality TEXT NOT NULL DEFAULT '[]'`, `... ADD COLUMN alerts TEXT NOT NULL DEFAULT '[]'` (each guarded by a `PRAGMA table_info` check like `migrate_source_removed`).
  - `fetch_weather`: after the existing geocode + forecast, additionally fetch archive (`archive_window(trip.start, trip.end, 10)`), air-quality, and — **only when the geocoded `country_code == "US"`** — `api.weather.gov/alerts/active?point={lat},{lon}`. Each extra layer is independent: `Err` leaves that layer empty and never fails the call, because the forecast is the thing the user clicked for.
  - `parse_geocoding_response` gains `country_code` on `GeocodedPlace` (its own small test).
  - `TripDetail.packing_list: Vec<PackingSuggestion>` computed in `get_trip` from the stored snapshot + confirmed facts.
- [ ] **Step 4/5: Verify pass (`cargo test --workspace`); commit** `"App: weather layers, migration v5, packing on trip detail"`.

---

### Task 6: Contract + transports + mock

- [ ] Add `ClimateNormals`, `AirQualityDay`, `WeatherAlert`, `PackingSuggestion`, `PackingCode`, `PackingReasonCode` to `packages/contracts/src/index.ts`; extend `WeatherSnapshot` with `normals?`, `airQuality`, `alerts`; add `TripDetail.packingList`.
- [ ] Mock: fictional normals + two air-quality days + one alert + the packing list they imply; keep it deterministic.
- [ ] No route/command change — `fetchWeather` is unchanged in shape. Verify `pnpm typecheck` and `cargo test -p voyalier-server` stay green.
- [ ] Commit `"Contract: weather layers and packing suggestions"`.

---

### Task 7: Web UI + i18n + tests + changelog

- [ ] Extend `apps/web/src/views/WeatherOutlook.tsx`: a "typical for these dates" line (with `yearsSampled`/`firstYear`–`lastYear` so the sample is visible), per-day UV/AQI chips, an alerts block (each alert linking to its NWS page, severity styled, attribution `Public domain (U.S. National Weather Service)`), and a packing list rendering `PackingCode` → catalog sentence with its number.
- [ ] i18n: `weather.normals.*`, `weather.uv`, `weather.aqi`, `weather.alerts.*`, `packing.*` (one key per `PackingCode` + one per `PackingReasonCode`). Core sends codes; these keys are the words.
- [ ] Tests in `apps/web/src/weather.test.tsx` (or a new `packing.test.tsx`): normals line renders with its sample size; an alert renders with its link; the packing list shows a suggestion and its reason; a snapshot without normals renders the forecast and no typical line.
- [ ] CHANGELOG `[Unreleased]` → Added.
- [ ] Commit `"Web: typical weather, UV and air quality, NWS alerts, packing list"`.

---

### Task 8: Verification sweep

- [ ] `cargo test --workspace`, `cargo clippy --workspace --all-targets` (0 warnings), `cargo fmt --all --check`.
- [ ] `pnpm typecheck && pnpm test && pnpm build`; `npx prettier --write` only the files this seam touched.
- [ ] Drive the real app on the mock gateway (`voyalier-mock` on :5174) and screenshot the weather panel.
- [ ] Merge to main and push.
