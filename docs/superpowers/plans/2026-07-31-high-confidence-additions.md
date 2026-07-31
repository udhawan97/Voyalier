# High-confidence additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five additions the 2026-07-31 review found defensible — repair the trip clock across a
DST boundary, curate more entry authorities, point a traveler at their own country's mission, name the sky
events that fall inside a trip, and widen the pack catalogue.

**Architecture:** Four of the five land on seams that already exist, which is why they are cheap. The clock
repair persists the IANA zone the geocode already returns and derives per-day offsets from it, leaving the
existing `compute_astro_day(lat, lon, date, offset)` signature untouched. Entry authorities are constant
tables in `visa.rs` behind the `entry_path` / `visa_journey` pair, whose three return values
(`None`, `Unknown`, resolved) already model "not curated", "authority names no route", and "route". Missions
and sky events are bundled build-time extracts in the shape `heritage.rs` established. Packs are catalogue
rows plus a publisher run.

**Tech Stack:** Rust (`voyalier-core` pure, `voyalier-app` owns all IO), `jiff` for tzdb, SQLite with
append-only Rust migrations, hand-written TypeScript contracts, React + Vitest.

## Global Constraints

- `voyalier-core` does **no IO** — no filesystem, no network, no SQLite. `jiff::tz::TimeZone::get` reads the
  system tzdb and is therefore filesystem IO: every zone→offset resolution stays in `voyalier-app`, which is
  why `offset_minutes_for` already lives at `crates/voyalier-app/src/lib.rs:2450`. Core gets the resolved
  integers and the pure math.
- Errors are `thiserror` only. Everything is `Result<T, AppError>`; no `anyhow`, no `Result` alias.
- Migrations are append-only Rust functions in `MIGRATIONS` (`crates/voyalier-app/src/lib.rs:1461`), keyed on
  `PRAGMA user_version`. Never renumber or edit a shipped step. Every step must be retry-safe — follow the
  check-then-`ALTER` pattern at `crates/voyalier-app/src/lib.rs:2046`.
- A new gateway method must land in all six places: `AppService`, the Axum route, the Tauri command,
  `contracts/src/index.ts`, `contracts/src/mock.ts`, and both `gateway/http.ts` and `gateway/tauri.ts`, plus a
  row in `packages/contracts/parity/routes.json`. **None of the five tasks below adds a gateway method** —
  every one extends an existing payload. If a task starts wanting a new method, stop and re-plan.
- Parity goldens pin **exact case counts** in both languages. Adding a case means bumping the number in
  `crates/voyalier-core/src/tests.rs` *and* `apps/web/src/parity.test.ts`. Regenerate only with
  `VOYALIER_REGENERATE_GOLDEN=1`, which rewrites the file and then panics on purpose so the diff gets read.
- Limits count Unicode characters — `countChars()` from contracts, never `.length`.
- ADR-0006 binds every curated entry claim: a factual claim about a requirement is a **link**, an authored
  sentence is a translation or a caution, and a test fails the build if curated prose quotes a fee or a
  processing time. That test is live — do not write around it.
- No curated list may contain an entry that was not read from the authority's own page in the research pass.
  An unverifiable destination becomes authority-only (`EntryPath::Unknown`), never a guess.
- `make check` is the gate and is what CI runs. Never substitute a bare `cargo test` — `voyalier-desktop` is
  outside the workspace default members and gets silently skipped.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `crates/voyalier-core/src/facts.rs` | Snapshot gains `timezone` / `origin_timezone`; new `ClockChange` type |
| `crates/voyalier-app/src/lib.rs` | Migration step; per-day offset derivation; clock-change detection |
| `crates/voyalier-app/src/service_retrieved.rs` | Persist the zone ids the geocode already returns |
| `crates/voyalier-core/src/visa.rs` | New destination constant blocks + `entry_path` arms |
| `crates/voyalier-core/src/missions.rs` | **New** — bundled diplomatic-mission lookup |
| `crates/voyalier-core/src/data/missions.tsv` | **New** — Wikidata CC0 extract |
| `crates/voyalier-core/src/astro.rs` | Eclipse / meteor events inside a date window |
| `crates/voyalier-core/src/data/sky_events.tsv` | **New** — public-domain event table |
| `crates/voyalier-core/src/packs.rs` | Catalogue rows |
| `packages/contracts/src/index.ts`, `mock.ts` | Mirror every new field |
| `apps/web/src/views/DestinationFacts.tsx`, `VisaPanel.tsx` | Render |

---

### Task 1: The trip clock survives a DST boundary

**The defect.** `crates/voyalier-app/src/service_retrieved.rs:276` resolves the destination offset **once**,
for `trip.start_date`, and then discards the IANA zone — the snapshot schema keeps only
`utc_offset_minutes`. `derive_astro` (`crates/voyalier-app/src/lib.rs:2469`) feeds that single integer to
every one of up to 16 trip days. A Paris trip spanning the last Sunday in March, or a US trip spanning the
first Sunday in November, renders every later day's sunrise, sunset and golden hour exactly one hour wrong,
and the dual clock with it.

**Files:**

- Modify: `crates/voyalier-core/src/facts.rs:72-96` (snapshot fields), and a new `ClockChange` type
- Modify: `crates/voyalier-app/src/lib.rs:1461` (append migration), `:2450` (`offset_minutes_for`), `:2469`
  (`derive_astro`), `:2494` (snapshot load), `:2019` (fresh-schema DDL)
- Modify: `crates/voyalier-app/src/service_retrieved.rs:259-305`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/mock.ts`
- Modify: `apps/web/src/views/DestinationFacts.tsx`
- Test: `crates/voyalier-core/src/facts.rs` inline tests, `crates/voyalier-app/src/tests.rs`,
  `apps/web/src/destinationFacts.test.tsx`

**Interfaces:**

- Consumes: `compute_astro_day(latitude, longitude, date, utc_offset_minutes) -> Result<AstroDay, AppError>`
  — unchanged signature, called once per day with **that day's** offset.
- Produces:
  - `DestinationFactsSnapshot.timezone: String` — IANA id, `""` for rows written before this task.
  - `DestinationFactsSnapshot.origin_timezone: Option<String>`
  - `pub struct ClockChange { pub date: String, pub from_offset_minutes: i32, pub to_offset_minutes: i32, pub place: String }`
  - `DestinationFacts.clock_changes: Vec<ClockChange>` on the read model.

- [ ] **Step 1: Write the failing core test for the type and its ordering**

In `crates/voyalier-core/src/facts.rs` tests:

```rust
#[test]
fn a_clock_change_names_the_day_and_both_offsets() {
    let change = ClockChange {
        date: "2027-03-28".to_owned(),
        from_offset_minutes: 60,
        to_offset_minutes: 120,
        place: "Paris".to_owned(),
    };
    assert_eq!(change.minutes_gained(), 60);
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cargo test -p voyalier-core clock_change`
Expected: FAIL — `cannot find struct ClockChange`.

- [ ] **Step 3: Add the type**

```rust
/// A civil-time discontinuity inside the trip window: the day a place's clocks
/// move, and the offsets on either side of it. Derived in `voyalier-app` from
/// the stored IANA zone, because resolving a zone reads the system tzdb and
/// core does no IO.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClockChange {
    /// ISO `YYYY-MM-DD`, the first local day on the new offset.
    pub date: String,
    pub from_offset_minutes: i32,
    pub to_offset_minutes: i32,
    /// The place whose clocks move — destination or origin, named so a
    /// traveler is not left guessing which end of the trip changed.
    pub place: String,
}

impl ClockChange {
    /// Signed minutes added to the wall clock. Positive springs forward.
    pub fn minutes_gained(&self) -> i32 {
        self.to_offset_minutes - self.from_offset_minutes
    }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cargo test -p voyalier-core clock_change` → PASS.

- [ ] **Step 5: Write the failing app test for the real defect**

In `crates/voyalier-app/src/tests.rs` — this is the test that would have caught the bug:

```rust
#[test]
fn astro_days_follow_the_zone_across_a_spring_forward() {
    // Europe/Paris moves +01:00 → +02:00 on 2027-03-28.
    let offsets = offsets_for_window("Europe/Paris", "2027-03-26", "2027-03-30");
    assert_eq!(offsets.first().copied(), Some(60));
    assert_eq!(offsets.last().copied(), Some(120));
}

#[test]
fn a_window_without_a_transition_reports_no_clock_change() {
    assert!(clock_changes_for("Europe/Paris", "2027-06-01", "2027-06-10", "Paris").is_empty());
}

#[test]
fn a_window_with_a_transition_names_the_day_it_falls_on() {
    let changes = clock_changes_for("Europe/Paris", "2027-03-26", "2027-03-30", "Paris");
    assert_eq!(changes.len(), 1);
    assert_eq!(changes[0].date, "2027-03-28");
    assert_eq!(changes[0].minutes_gained(), 60);
}

#[test]
fn an_unknown_zone_yields_no_changes_rather_than_an_error() {
    assert!(clock_changes_for("Mars/Olympus", "2027-03-26", "2027-03-30", "Paris").is_empty());
}
```

- [ ] **Step 6: Run and watch it fail**

Run: `cargo test -p voyalier-app clock_change` and `cargo test -p voyalier-app spring_forward`
Expected: FAIL — the helpers do not exist.

- [ ] **Step 7: Implement the two helpers in `crates/voyalier-app/src/lib.rs`**

```rust
/// The offset in effect at each local noon across an inclusive date window.
/// Noon avoids landing on a transition instant, the same reason
/// `offset_minutes_for` uses it.
fn offsets_for_window(timezone: &str, start: &str, end: &str) -> Vec<i32> {
    let (Ok(start), Ok(end)) = (
        start.parse::<jiff::civil::Date>(),
        end.parse::<jiff::civil::Date>(),
    ) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut date = start;
    while date <= end {
        out.push(offset_minutes_for(timezone, &date.to_string()));
        let Ok(next) = date.tomorrow() else { break };
        date = next;
    }
    out
}

/// Every day inside the window whose offset differs from the day before it.
/// An empty or unresolvable zone yields nothing: a missing clock change is a
/// quiet omission, whereas a wrong one would have a traveler at an airport an
/// hour late.
fn clock_changes_for(timezone: &str, start: &str, end: &str, place: &str) -> Vec<ClockChange> {
    if timezone.is_empty() || jiff::tz::TimeZone::get(timezone).is_err() {
        return Vec::new();
    }
    let (Ok(first), Ok(end)) = (
        start.parse::<jiff::civil::Date>(),
        end.parse::<jiff::civil::Date>(),
    ) else {
        return Vec::new();
    };
    let mut changes = Vec::new();
    let mut previous = offset_minutes_for(timezone, &first.to_string());
    let mut date = first;
    while date < end {
        let Ok(next) = date.tomorrow() else { break };
        date = next;
        let offset = offset_minutes_for(timezone, &date.to_string());
        if offset != previous {
            changes.push(ClockChange {
                date: date.to_string(),
                from_offset_minutes: previous,
                to_offset_minutes: offset,
                place: place.to_owned(),
            });
            previous = offset;
        }
    }
    changes
}
```

- [ ] **Step 8: Run and watch them pass**

Run: `cargo test -p voyalier-app clock_change spring_forward` → PASS.

- [ ] **Step 9: Persist the zone — append the migration**

Append to `MIGRATIONS` (never renumber; take the next `to:` after the current tail) and add the columns to
the fresh-schema DDL at `crates/voyalier-app/src/lib.rs:2019` so a new database and a migrated one agree:

```rust
Migration {
    to: <next>,
    name: "destination_facts_timezone",
    run: migrate_destination_facts_timezone,
},
```

```rust
/// Carry the IANA zone beside the offset. Before this, the snapshot stored a
/// single offset resolved on the trip's start date, so every trip spanning a
/// DST transition rendered its later days an hour wrong.
fn migrate_destination_facts_timezone(connection: &Connection) -> Result<(), AppError> {
    let present = column_exists(connection, "destination_facts_snapshots", "timezone")?;
    if present {
        return Ok(());
    }
    connection
        .execute_batch(
            "ALTER TABLE destination_facts_snapshots ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
             ALTER TABLE destination_facts_snapshots ADD COLUMN origin_timezone TEXT;",
        )
        .map_err(storage_error)
}
```

Reuse the existing column-presence helper the step at `:2046` uses rather than writing a second one.

- [ ] **Step 10: Write, then satisfy, the migration test**

```rust
#[test]
fn the_timezone_migration_is_retry_safe() {
    let service = AppService::open_path(&path).unwrap();
    // Running every migration twice must not error.
    drop(service);
    let reopened = AppService::open_path(&path);
    assert!(reopened.is_ok());
}
```

Run: `cargo test -p voyalier-app migration` → PASS.

- [ ] **Step 11: Write the zone through on fetch and read it back**

In `service_retrieved.rs`, add `timezone: place.timezone.clone()` and the origin's zone to the struct
literal, add both columns to the `INSERT`, the `ON CONFLICT DO UPDATE SET`, and the `SELECT` at
`crates/voyalier-app/src/lib.rs:2500`. Column indices shift — re-index the whole `row.get(n)` block, do not
patch one line.

- [ ] **Step 12: Derive astro per day and attach clock changes**

Rewrite `derive_astro` so the offset comes from the zone when the snapshot has one, and falls back to the
stored scalar for rows written before Step 9:

```rust
let offset = if snapshot.timezone.is_empty() {
    snapshot.utc_offset_minutes
} else {
    offset_minutes_for(&snapshot.timezone, &date.to_string())
};
```

- [ ] **Step 13: Run the full Rust gate**

Run: `scripts/check.sh rust`
Expected: fmt clean, clippy clean, all tests pass.

- [ ] **Step 14: Mirror the contract and render it**

Add `timezone`, `originTimezone?`, and `clockChanges` to the destination-facts types in
`packages/contracts/src/index.ts` and to `mock.ts`. In `DestinationFacts.tsx`, render a clock-change line
per change. Copy states the fact and nothing more: the day, the direction, and whose clocks move — never
advice about what to do about it.

- [ ] **Step 15: Web tests, then the full gate**

`apps/web/src/destinationFacts.test.tsx`: a trip window containing a change renders the day; one without it
renders nothing. Then `make check`.

- [ ] **Step 16: Commit in layer order**

```bash
git commit -m "Core: name a clock change as a type"
git commit -m "App: resolve the trip's offsets from its zone, not its first day"
git commit -m "Contract+web: show the day the clocks move"
```

---

### Task 2: More entry authorities

**Files:**

- Modify: `crates/voyalier-core/src/visa.rs` — one constant block per destination, one `entry_path` arm
- Modify: `packages/contracts/parity/visa.json` (golden), `crates/voyalier-core/src/tests.rs:~227`,
  `apps/web/src/parity.test.ts:227` (both count pins)
- Modify: `docs/architecture/ADR-0006-visa-preparation-pointers.md` (amend in place with what was curated)

**Interfaces:**

- Consumes: `entry_path(destination_iso2, nationality_iso2) -> Option<EntryPathQuote>` and
  `visa_journey(destination_iso2, nationality_iso2) -> Option<VisaJourney>`.
- Produces: new `match` arms only. No new types, no contract change.

**The decision rule — this is the whole task.** For each researched destination, the verifier's
`safeToCurate` verdict decides the shape, and nothing else does:

| Verdict | Shape | Precedent in tree |
| --- | --- | --- |
| `resolvable_route` | Enumerated lists + a full journey | `CA`, `JP` |
| `authority_only` | Named authority, every pair `EntryPath::Unknown` | `GB` |
| `do_not_curate` | Not added at all — `entry_path` keeps returning `None` | every uncurated country |

A destination whose exemption list carries conditions gets those nationalities in a `*_CONDITIONAL` block
resolving to `Unknown`, exactly as `CA_CONDITIONAL` and `JP_CONDITIONAL` already do. Resolving a
conditional pair to a clean answer is the failure that puts a traveler at a boarding gate without a visa.

- [ ] **Step 1: Write the failing tests before any list exists**

For each destination that came back `resolvable_route`, in `crates/voyalier-core/src/visa.rs` tests:

```rust
#[test]
fn a_listed_nationality_resolves_to_the_published_path() {
    let quote = entry_path("<DEST>", "<LISTED>").expect("destination is curated");
    assert_eq!(quote.path, EntryPath::<PUBLISHED_PATH>);
    assert_eq!(quote.source_name, <AUTHORITY_CONST>);
    assert!(!quote.curated_as_of.is_empty());
}

#[test]
fn a_conditional_nationality_resolves_to_unknown_and_no_journey() {
    let quote = entry_path("<DEST>", "<CONDITIONAL>").expect("destination is curated");
    assert_eq!(quote.path, EntryPath::Unknown);
    assert!(visa_journey("<DEST>", "<CONDITIONAL>").is_none());
}

#[test]
fn an_unreadable_nationality_code_still_names_the_authority() {
    let quote = entry_path("<DEST>", "zz").expect("destination is curated");
    assert_eq!(quote.path, EntryPath::Unknown);
}
```

For an `authority_only` destination, the single test is that **every** sampled nationality resolves
`Unknown` while the authority is still named — the `GB` test is the template.

- [ ] **Step 2: Run and watch them fail** — `cargo test -p voyalier-core visa` → the destination is
      uncurated, so `entry_path` returns `None` and `.expect` panics.

- [ ] **Step 3: Add the constant block**, following the `CA`/`JP` layout exactly: authority name, source
      URLs as `const`, `*_CURATED_AS_OF` set to the date the research pass read the page, then the
      `*_EXEMPT` / `*_ELIGIBLE` / `*_CONDITIONAL` slices with a doc comment saying **how many entries the
      authority's table has** and how many landed in each slice. That count is the reader's check that
      nothing was dropped.

- [ ] **Step 4: Add the `entry_path` arm and, for a resolvable route, the `visa_journey` arm.**

- [ ] **Step 5: Run and watch them pass** — `cargo test -p voyalier-core visa`.

- [ ] **Step 6: Regenerate the golden and read the diff**

```bash
VOYALIER_REGENERATE_GOLDEN=1 cargo test -p voyalier-core visa_golden
```

It rewrites `packages/contracts/parity/visa.json` and then panics on purpose. Read the diff, then bump
`caseCount` and **both** count pins.

- [ ] **Step 7: `make check`, then commit** — `Core: curate <destination>'s entry path`.

---

### Task 3: Where the traveler's own embassy is

**Files:**

- Create: `crates/voyalier-core/src/data/missions.tsv`, `crates/voyalier-core/src/missions.rs`
- Modify: `crates/voyalier-core/src/lib.rs` (module + selective re-export),
  `crates/voyalier-app/src/service_visa.rs` (attach to the visa read model)
- Modify: `packages/contracts/src/index.ts`, `mock.ts`, `apps/web/src/views/VisaPanel.tsx`
- Modify: `docs/data/DATA_SOURCES.md`, `packages/contracts/parity/data-sources.json` (+ its count pins)

**Interfaces:**

- Produces: `pub fn missions_in(host_iso2: &str, sending_iso2: &str) -> Vec<Mission>` returning at most a
  handful, nearest-capital-first, and `pub struct Mission { pub sending_country: String, pub host_country:
  String, pub city: String, pub kind: MissionKind, pub latitude: f64, pub longitude: f64 }`.

**Posture — read this before writing code.** A mission address is exactly the kind of fact this product does
not get to be the authority on: they move, they close, and someone reads it in an emergency. So the panel is
a **pointer**, always rendered beside the sending country's own mission-list link, and the copy says the
bundled entry is a starting point to confirm. Wikidata is CC0 and its coverage is uneven — honorary consulates
sit beside career ones and closed posts linger. Bundle only what the extract can defend: career embassies,
consulates-general and high commissions with coordinates, dropping honorary posts.

- [ ] **Step 1: Write the failing lookup tests**

```rust
#[test]
fn a_mission_is_found_for_a_sending_country_in_a_host_country() {
    let found = missions_in("JP", "CA");
    assert!(found.iter().any(|m| m.city == "Tokyo"));
    assert!(found.iter().all(|m| m.sending_country == "CA" && m.host_country == "JP"));
}

#[test]
fn an_uncovered_pair_returns_nothing_rather_than_a_guess() {
    assert!(missions_in("ZZ", "CA").is_empty());
}

#[test]
fn every_bundled_row_carries_usable_coordinates() {
    for mission in all_missions() {
        assert!((-90.0..=90.0).contains(&mission.latitude));
        assert!((-180.0..=180.0).contains(&mission.longitude));
    }
}
```

- [ ] **Step 2: Run and watch them fail.** `cargo test -p voyalier-core missions`.

- [ ] **Step 3: Generate the extract** from the verified SPARQL query into TSV, one row per mission,
      `include_str!`-parsed the way `heritage.rs` parses `whs.tsv`. Match that module's parsing shape rather
      than inventing a second one.

- [ ] **Step 4: Run and watch them pass**, then wire the read model, contract, mock, and panel.

- [ ] **Step 5: Register the source.** Add the Wikidata mission extract to `DATA_SOURCES.md` and the
      data-source register golden, bumping its count pins in both languages.

- [ ] **Step 6: `make check`, then commit** — `Core: bundle diplomatic missions`, then
      `App+contract+web: point at the traveler's own mission`.

---

### Task 4: Sky events inside the trip window

**Files:**

- Create: `crates/voyalier-core/src/data/sky_events.tsv`
- Modify: `crates/voyalier-core/src/astro.rs`, `crates/voyalier-app/src/lib.rs` (`derive_astro` caller)
- Modify: `packages/contracts/src/index.ts`, `mock.ts`, `apps/web/src/views/DestinationFacts.tsx`

**Interfaces:**

- Produces: `pub fn sky_events_within(start: &str, end: &str) -> Vec<SkyEvent>` and
  `pub struct SkyEvent { pub date: String, pub kind: SkyEventKind, pub label: String, pub region: String }`.
  A **field on the existing astro payload**, not a new capability — the register cut aurora on exactly this
  cost line, and a new gateway method would fail that test again.

**Sourcing constraint.** Eclipse dates must come from NASA GSFC's canon (US-government public domain) and be
verifiable. Meteor peaks must come from a source whose terms permit bundling — if the IMO working list does
not, carry only the showers a public-domain source states, or drop meteors entirely and ship eclipses alone.
Dropping half this task is an acceptable outcome; bundling data whose licence was not read is not.

- [ ] **Step 1: Write the failing window tests**

```rust
#[test]
fn an_event_inside_the_window_is_returned() {
    let events = sky_events_within("2026-08-01", "2026-08-31");
    assert!(events.iter().any(|e| e.kind == SkyEventKind::SolarEclipse));
}

#[test]
fn a_window_with_no_events_is_empty_not_an_error() {
    assert!(sky_events_within("2026-09-01", "2026-09-02").is_empty());
}

#[test]
fn the_window_is_inclusive_at_both_ends() { /* boundary dates from the table */ }

#[test]
fn a_reversed_window_returns_nothing() {
    assert!(sky_events_within("2026-08-31", "2026-08-01").is_empty());
}
```

- [ ] **Step 2–5:** fail → bundle the verified table → pass → render → `make check` → commit
      `Core+contract+web: name the sky events inside a trip`.

---

### Task 5: Widen the pack catalogue

**Files:**

- Modify: `crates/voyalier-core/src/packs.rs:137` (catalogue rows)
- Modify: `crates/voyalier-core/src/packs.rs` tests (the seed-city test at `:711` pins the catalogue)

**The coupling that matters.** Every one of the 16 catalogue rows has a published asset on the `packs-v1`
release. `pack_download_url` is `.../releases/download/packs-v1/<id>.json`, so a catalogue row with no asset
is a 404 behind a "Download for this trip" button. **Code lands first, then the publisher workflow is
dispatched** — `gh workflow run packs.yml`. The workflow rebuilds and overwrites all existing assets and
needs a Protomaps build date that has not been pruned (the pinned default goes stale by design; check
`https://build.protomaps.com/<YYYYMMDD>.pmtiles` resolves before dispatching).

- [ ] **Step 1: Write the failing catalogue tests**

```rust
#[test]
fn every_catalogue_bbox_is_well_formed() {
    for info in pack_catalog() {
        assert!(info.bbox.west < info.bbox.east, "{} has a flipped longitude", info.id);
        assert!(info.bbox.south < info.bbox.north, "{} has a flipped latitude", info.id);
    }
}

#[test]
fn every_pack_id_is_unique_and_slug_shaped() {
    let mut seen = std::collections::HashSet::new();
    for info in pack_catalog() {
        assert!(seen.insert(info.id.clone()), "duplicate pack id {}", info.id);
        assert!(info.id.chars().all(|c| c.is_ascii_lowercase() || c == '-'));
    }
}
```

- [ ] **Step 2–4:** run → add the verified rows → run → `make check` → commit
      `Core: widen the pack catalogue`.
- [ ] **Step 5: After the merge lands, dispatch the publisher and verify assets exist for the new ids.**

---

## Release

- [ ] `make check` on the **merged** tree — merge `main` into the branch first, so the gate sees what main
      will become rather than a stale branch.
- [ ] CHANGELOG entry per Keep a Changelog: user-facing prose, a bolded lead sentence, then the tradeoff and
      what was left out. Not one-line bullets.
- [ ] Version hand-synced across root `package.json`, workspace `Cargo.toml`, `apps/web/package.json`,
      `apps/desktop/src-tauri/tauri.conf.json` — then `cargo update --workspace` for the fifth file,
      `Cargo.lock`. `--locked` in `scripts/check.sh` is what actually catches a stale lock.
- [ ] Close the branch with `Merge: <feature>` and `--no-ff`. Pushing to `main` trips
      `required_linear_history` and reports "Bypassed rule violations" — that is the documented state of this
      repo, not an error, and must be surfaced rather than "fixed" by rebasing.
- [ ] **Stop at the release commit.** Tagging enters a protected `release` environment holding the Tauri
      signing key and requires verifying artifacts on real Apple Silicon and Windows first. The tag and any
      draft publication are the owner's step — name which are outstanding and stop.
