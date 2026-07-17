# Destination-Facts Seam Implementation Plan (seam 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A destination-facts card, fetched on one consent click: what these dates look like in the sky (sunrise / sunset / day length / moon phase, computed offline), today's indicative currency rates for the destination, and the practical country facts a traveller needs (plug, voltage, driving side, calling code, emergency number).

**Architecture:** Two pure `voyalier-core` modules — `astro` (offline sunrise/sunset/moon from lat-lon + date) and `facts` (a bundled per-country table + an ECB rates parser). One new gateway capability `fetchDestinationFacts`, which geocodes the destination (Open-Meteo, reused) and fetches ECB daily rates, then stores a dated snapshot. Astro is **derived on `TripDetail`** from the snapshot's stored coordinates, like `packingList` — always current for the trip's dates, never stale.

**Tech Stack:** Rust (serde_json, quick-xml, jiff), SQLite via rusqlite (migration v6), TypeScript contract + React panel. No new crates: the sunrise equation is the standard NOAA algorithm implemented directly.

## Scope

**In:** astro, currency (ECB), country facts (bundled table). **Deferred, transparently, to a later follow-up:** the OurAirports dataset (~12 MB), the GeoNames gazetteer (~3 MB), and coordinate→timezone dual-clock. Those need bundling large datasets or a build-time data pipeline — a different kind of change from this card, which ships pure code plus one hand-curated ~40-row table. The roadmap ([OPEN_DATA_FEATURE_CANDIDATES.md](../../roadmap/OPEN_DATA_FEATURE_CANDIDATES.md)) lists them; this plan does not implement them.

## Global Constraints

- Network only on the explicit click; fetches Rust-side via `AdviceFetcher` with its identifying User-Agent; result stored as one dated snapshot.
- **Facts are practical, not safety claims.** Currency is labelled indicative (a reference rate, not a card/ATM rate). Country facts are convenience, and the card links to an authoritative source rather than asserting the last word.
- **Open-Meteo's free tier is non-commercial only.** This card's geocode is Open-Meteo, same as weather — already a launch-blocking item for any paid tier (`docs/data/DATA_SOURCES.md`). ECB reference rates are public facts, freely reusable with attribution to the ECB.
- Astro is computed, never fetched. It describes the sky deterministically from coordinates and a date; it is not a forecast and carries no source.
- Migration ledger is append-only; new step is `to: 6`.
- Attribution (exact): ECB `Exchange rates from the European Central Bank`; country facts `Compiled from OpenStreetMap/Wikidata (CC0/ODbL) and public sources`.
- TDD: failing test first, watch it fail, minimal code, commit.

## Source payload shapes (captured live 2026-07-17)

- **ECB daily** `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` → gesmes XML; the innermost `<Cube time='YYYY-MM-DD'>` holds `<Cube currency='USD' rate='1.1435'/>` children. **29 currencies, all EUR-based** (EUR itself is the base and absent). ~1.5 KB. Cross-rate between any two covered currencies = `rate(to) / rate(from)`, with EUR = 1.0. Several travel currencies are **not covered** (EGP, MAD, PEN, VND among the curated countries) — the card needs a "no rate available" state.
- **Geocoding** `geocoding-api.open-meteo.com/v1/search` → top result carries `name`, `latitude`, `longitude`, `country_code` (ISO-3166-1 alpha-2). Reused from the weather seam.
- **Astro golden values** (standard NOAA sunrise equation, verified against real times): Kyoto (35.0116, 135.7681) 2026-11-03 in UTC+9 → sunrise 06:20, solar noon 11:42, sunset 17:03. London (51.5074, −0.1278) 2026-06-21 UTC+1 → 04:44 / 21:23. Sydney (−33.8688, 151.2093) 2026-01-15 UTC+11 → 06:00 / 20:10. Tromsø (69.65, 18.96) 2026-12-21 → polar night; 2026-06-21 → polar day. Moon: synodic month 29.53058867 d from the 2000-01-06 new-moon epoch (JD 2451550.1); 2026-01-03 → age ≈ 14.6 d (near full).

---

### Task 1: Core astro (sunrise / sunset / day length / moon phase)

**Files:** Create `crates/voyalier-core/src/astro.rs`; modify `lib.rs`.

**Interfaces:**

- Produces: `AstroDay { date, sunrise?: String, sunset?: String, day_length_minutes?: u32, polar: PolarState }`, `PolarState { Normal | PolarDay | PolarNight }`, `MoonPhase { age_days, illumination_pct, name: MoonPhaseName }`, `MoonPhaseName` (8-way closed enum, snake_case), `compute_astro_day(lat, lon, date: &str, utc_offset_minutes: i32) -> Result<AstroDay, AppError>`, `moon_phase(date: &str) -> Result<MoonPhase, AppError>`.

The times are **local wall-clock at the destination**, so the caller passes the destination's UTC offset (from the geocode/timezone). Store the offset with coordinates so astro can be recomputed offline.

- [ ] **Step 1: Failing tests** (golden values above; allow ±2 min for float drift):

```rust
fn near(actual: Option<&str>, expected: &str) {
    let a = actual.expect("time present");
    let to_min = |t: &str| {
        let (h, m) = t.split_once(':').expect("hh:mm");
        h.parse::<i32>().unwrap() * 60 + m.parse::<i32>().unwrap()
    };
    assert!((to_min(a) - to_min(expected)).abs() <= 2, "{a} vs {expected}");
}

#[test]
fn computes_local_sunrise_and_sunset() {
    let kyoto = compute_astro_day(35.0116, 135.7681, "2026-11-03", 9 * 60).expect("kyoto");
    assert_eq!(kyoto.polar, PolarState::Normal);
    near(kyoto.sunrise.as_deref(), "06:20");
    near(kyoto.sunset.as_deref(), "17:03");
    // Day length is sunset − sunrise, ~10h43m here.
    assert!((kyoto.day_length_minutes.unwrap() as i32 - 643).abs() <= 3);

    let london = compute_astro_day(51.5074, -0.1278, "2026-06-21", 60).expect("london");
    near(london.sunrise.as_deref(), "04:44");
    near(london.sunset.as_deref(), "21:23");

    let sydney = compute_astro_day(-33.8688, 151.2093, "2026-01-15", 11 * 60).expect("sydney");
    near(sydney.sunrise.as_deref(), "06:00");
    near(sydney.sunset.as_deref(), "20:10");
}

#[test]
fn reports_polar_day_and_night_without_pretending() {
    let winter = compute_astro_day(69.6492, 18.9553, "2026-12-21", 60).expect("tromso winter");
    assert_eq!(winter.polar, PolarState::PolarNight);
    assert_eq!(winter.sunrise, None);
    assert_eq!(winter.sunset, None);
    assert_eq!(winter.day_length_minutes, Some(0));

    let summer = compute_astro_day(69.6492, 18.9553, "2026-06-21", 2 * 60).expect("tromso summer");
    assert_eq!(summer.polar, PolarState::PolarDay);
    assert_eq!(summer.day_length_minutes, Some(1440));

    assert!(compute_astro_day(35.0, 135.0, "not-a-date", 0).is_err());
}

#[test]
fn names_the_moon_phase_from_its_age() {
    let full = moon_phase("2026-01-03").expect("full-ish");
    assert!((full.age_days - 14.6).abs() < 0.5);
    assert!(full.illumination_pct > 95);
    assert_eq!(full.name, MoonPhaseName::FullMoon);

    // The 2000-01-06 epoch is a new moon.
    let new = moon_phase("2000-01-06").expect("new");
    assert!(new.age_days < 1.0 || new.age_days > 28.5);
    assert!(new.illumination_pct < 5);
    assert_eq!(new.name, MoonPhaseName::NewMoon);
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Port the NOAA sunrise equation (see the plan header's algorithm). Julian day from the civil date; mean solar anomaly, equation of centre, ecliptic longitude, solar transit, declination; hour angle from `cos ω = (sin(−0.833°) − sin φ sin δ)/(cos φ cos δ)`. `cos ω > 1` → `PolarNight` (day length 0); `< −1` → `PolarDay` (1440). Convert the transit ± ω/360 Julian fractions to local wall clock by adding `utc_offset_minutes`. Round to the minute. `moon_phase`: `age = (jd − 2451550.1) mod 29.53058867`; `illumination_pct = round(50·(1 − cos(2π·age/synodic)))`; `name` from eight equal age octants (New, WaxingCrescent, FirstQuarter, WaxingGibbous, Full, WaningGibbous, LastQuarter, WaningCrescent). Bad date → `Err(ValidationInvalidInput)`.
- [ ] **Step 4/5: Verify pass; commit** `"Core: offline sunrise, sunset and moon phase"`.

---

### Task 2: Core currency (ECB parser + cross-rates)

**Files:** Create `crates/voyalier-core/src/facts.rs`; modify `lib.rs`.

**Interfaces:**

- Produces: `CurrencyRate { code: String, per_eur: f64 }`, `parse_ecb_rates(xml: &str) -> Result<(String, Vec<CurrencyRate>), AppError>` (returns the rate date + rates, EUR included as 1.0), `cross_rate(rates: &[CurrencyRate], from: &str, to: &str) -> Option<f64>`.

- [ ] **Step 1: Failing tests** (trimmed real ECB shape):

```rust
const ECB_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01"
 xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time='2026-07-17'>
    <Cube currency='USD' rate='1.1435'/>
    <Cube currency='JPY' rate='185.65'/>
    <Cube currency='GBP' rate='0.85098'/>
  </Cube></Cube>
</gesmes:Envelope>"#;

#[test]
fn parses_ecb_rates_with_eur_as_the_base() {
    let (date, rates) = parse_ecb_rates(ECB_FIXTURE).expect("parsed");
    assert_eq!(date, "2026-07-17");
    // EUR is the base and is not in the feed; the parser adds it as 1.0 so
    // conversions from EUR work without a special case.
    assert_eq!(cross_rate(&rates, "EUR", "EUR"), Some(1.0));
    assert_eq!(cross_rate(&rates, "EUR", "JPY"), Some(185.65));
    // Cross-rate via EUR: 1 USD = 185.65/1.1435 ≈ 162.35 JPY.
    let usd_jpy = cross_rate(&rates, "USD", "JPY").expect("usd->jpy");
    assert!((usd_jpy - 162.35).abs() < 0.1, "{usd_jpy}");
    // A currency the ECB does not publish has no rate — never a guessed one.
    assert_eq!(cross_rate(&rates, "USD", "EGP"), None);
    assert_eq!(cross_rate(&rates, "XYZ", "USD"), None);
}

#[test]
fn an_unreadable_feed_is_an_error() {
    assert!(parse_ecb_rates("<html>503</html>").is_err());
    assert!(parse_ecb_rates("<gesmes:Envelope></gesmes:Envelope>").is_err());
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** with `quick_xml` (already a dep): stream the `<Cube>` elements; the one with a `time` attribute gives the date; children with `currency`+`rate` give the rates. Push `EUR` = 1.0. No `time` cube found → `Err(unreadable_source())`. `cross_rate` returns `None` if either code is absent.
- [ ] **Step 4/5: Verify pass; commit** `"Core: ECB reference rates and EUR cross-rates"`.

---

### Task 3: Core country facts (bundled table)

**Files:** modify `crates/voyalier-core/src/facts.rs`; `lib.rs`.

**Interfaces:**

- Produces: `CountryFacts { iso2, name, currency_code, plug_types: Vec<char-as-String>, voltage_v: u16, frequency_hz: u8, drives_on_left: bool, calling_code, emergency: EmergencyNumbers }`, `EmergencyNumbers { general?, police?, ambulance?, fire? }`, `country_facts(iso2: &str) -> Option<&'static CountryFacts>`.

The table covers the **same 39 countries as `ADVISORY_COUNTRIES`**, so the app's curated country set stays consistent across advice, and facts. Values are well-established public facts (plug/voltage/driving-side/calling-code/emergency).

- [ ] **Step 1: Failing tests** (spot-check a representative spread — do not assert all 39):

```rust
#[test]
fn resolves_country_facts_for_covered_countries() {
    let jp = country_facts("JP").expect("japan");
    assert_eq!(jp.name, "Japan");
    assert_eq!(jp.currency_code, "JPY");
    assert_eq!(jp.voltage_v, 100);
    assert!(jp.plug_types.iter().any(|p| p == "A"));
    assert!(jp.drives_on_left);
    assert_eq!(jp.calling_code, "+81");
    // Japan has separate police (110) and fire/ambulance (119) numbers.
    assert_eq!(jp.emergency.police.as_deref(), Some("110"));

    let us = country_facts("US").expect("usa");
    assert_eq!(us.voltage_v, 120);
    assert!(!us.drives_on_left);
    assert_eq!(us.emergency.general.as_deref(), Some("911"));

    let gb = country_facts("GB").or_else(|| country_facts("UK")).expect("uk");
    assert_eq!(gb.voltage_v, 230);
    assert!(gb.drives_on_left);
    assert!(gb.plug_types.iter().any(|p| p == "G"));

    assert!(country_facts("ZZ").is_none());
}

#[test]
fn every_advisory_country_has_facts() {
    // The facts table and the advisory table cover the same countries, so a
    // destination that can get advice can also get facts.
    for country in crate::advisories::ADVISORY_COUNTRIES {
        assert!(
            country_facts(country.iso2).is_some(),
            "no facts for {}",
            country.iso2
        );
    }
}
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** `COUNTRY_FACTS: &[CountryFacts]` — 39 rows keyed by the `ADVISORY_COUNTRIES` iso2 codes, values hand-verified. (USA `country_code` from the geocoder is `US`; the FCDO slug is `usa` — the facts table keys on the ISO2 `US`, matching the geocode.) `country_facts` is a linear find over ~39 rows. Make `ADVISORY_COUNTRIES` visible to this module (it is already `pub` in `advisories`).
- [ ] **Step 4/5: Verify pass; commit** `"Core: bundled country facts for the curated countries"`.

---

### Task 4: App — snapshot, migration v6, fetch, astro on detail

**Files:** `crates/voyalier-app/src/lib.rs`; `crates/voyalier-core/src/types.rs`.

**Interfaces:**

- New `DestinationFactsSnapshot { place_name, latitude, longitude, utc_offset_minutes, country_code, facts: Option<CountryFacts>, rate_date, currency_rates: Vec<CurrencyRate>, retrieved_at }`, stored per trip.
- `fetch_destination_facts(&self, trip_id) -> Result<DestinationFactsSnapshot, AppError>`.
- `TripDetail` gains `destination_facts: Option<DestinationFactsSnapshot>` (stored) and `astro: Vec<AstroDay>` (derived, one per trip day up to a cap, computed from the snapshot's coords + offset).

- [ ] **Step 1: Failing test.** A `RoutedFetcher` returning a geocode (with `country_code: "JP"`, `timezone`) and the ECB fixture: assert the snapshot stores coords + resolved JP facts + rates; `cross_rate` works off the stored rates; `TripDetail.astro` is non-empty and its first day has a sunrise; a destination whose country is uncovered stores `facts: None` but still stores rates; a v6 migration test mirroring the v5 one (a pre-v6 database with no `destination_facts_snapshots` table migrates cleanly). The geocode's `utc_offset_seconds` (present in the forecast payload, not the search payload) is not available from search alone — derive the offset from the geocode `timezone` via `jiff`'s tz database, or store `0` and note it; **prefer** resolving the IANA `timezone` string through `jiff::tz::TimeZone` to the offset on the trip's first date.
- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement.** Migration `to: 6`, `name: "destination_facts"`, guarded like v5: create `destination_facts_snapshots(trip_id PK, place_name, latitude, longitude, utc_offset_minutes, country_code, facts TEXT, rate_date, currency_rates TEXT NOT NULL DEFAULT '[]', retrieved_at)`. `fetch_destination_facts`: geocode the destination (reuse the weather geocode URL/parse, extended so `GeocodedPlace` also carries `timezone`), resolve `utc_offset_minutes` from the timezone via `jiff` on the trip's start date, fetch ECB rates (a failure here still stores the geocode + facts with empty rates — the card degrades), resolve `country_facts(country_code)`, store. The destination-edit invalidation path (already clearing weather + advice) also clears `destination_facts_snapshots`. `TripDetail.astro`: from a stored snapshot, `compute_astro_day` for each date in the trip window (cap 16) using stored coords + offset; empty without a snapshot.
- [ ] **Step 4/5: Verify pass (`cargo test --workspace`); commit** `"App: destination-facts fetch, migration v6, astro on trip detail"`.

---

### Task 5: Contract + both transports + mock

- [ ] Add `AstroDay`, `PolarState`, `MoonPhase`, `MoonPhaseName`, `CurrencyRate`, `CountryFacts`, `EmergencyNumbers`, `DestinationFactsSnapshot` to `packages/contracts/src/index.ts`; add `TripDetail.destinationFacts?` + `TripDetail.astro`; add `fetchDestinationFacts(tripId): Promise<DestinationFactsSnapshot>` to `AppGateway`.
- [ ] Mock: a deterministic JP facts snapshot (coords, JPY + USD/GBP rates, resolved Japan facts) and a plausible `astro` array on `tripDetail`. Compute the mock astro with the **same** formula the core uses, or hard-code golden days — a mock that disagrees with the service teaches the UI a lie.
- [ ] Both transports: HTTP route `POST /api/v1/trips/{trip_id}/destination-facts` + Axum handler; Tauri command `fetch_destination_facts` + `generate_handler!` + capability string.
- [ ] Verify `pnpm typecheck`, `cargo test -p voyalier-server`, `cargo build -p voyalier-desktop`.
- [ ] Commit `"Contract: fetchDestinationFacts across both transports"`.

---

### Task 6: Web UI + i18n + tests + changelog

- [ ] New `apps/web/src/views/DestinationFacts.tsx`: a consent-gated fetch (naming what leaves the device: the destination name to open-meteo.com and a rates request to the ECB), then three blocks — **Sky** (per-day sunrise/sunset/day-length + a moon-phase glyph/name, "polar day/night" stated where it applies), **Money** (destination currency vs USD/EUR/GBP from stored rates, dated, labelled indicative, with a "no published rate" state), **Practical** (plug letters, voltage/frequency, drive-side, calling code, emergency number). Mount it in `TripDetailView` beside weather/advice.
- [ ] i18n: `facts.*` (sky/money/practical labels), `moon.*` (eight phase names), `facts.currency.indicative`, `facts.currency.noRate`, `facts.polar.day`/`.night`. Core sends codes/numbers; these are the words.
- [ ] Tests in `apps/web/src/destinationFacts.test.tsx`: fetch renders sunrise + moon name; a currency row shows the indicative label; a plug/voltage/emergency fact renders; a snapshot for an uncovered currency shows the no-rate state.
- [ ] CHANGELOG `[Unreleased]` → Added.
- [ ] Commit `"Web: destination-facts card (sky, money, practical)"`.

---

### Task 7: Verification sweep + merge/push

- [ ] `cargo test --workspace`, `cargo clippy --workspace --all-targets` (0 warnings), `cargo fmt --all --check`.
- [ ] `pnpm typecheck && pnpm test && pnpm build`; `npx prettier --write` only this seam's files.
- [ ] Drive the real app on the mock gateway (:5174) and screenshot the facts card.
- [ ] Merge to main and push.
