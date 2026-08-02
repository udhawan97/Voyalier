# Visa cockpit v2 — design

- Date: 2026-08-02
- Status: council-reviewed (contract & trust, architecture, UX & web — all
  APPROVE-WITH-AMENDMENTS; every required amendment is folded in below)
- Slice 1 of 4 from the trip-cockpit brainstorm (booking-site directory, app-wide
  design pass, and the LLM cheat-sheet prompt are later slices and out of scope)

## Problem

An Indian passport holder planning any trip outside Canada/Japan hits a dead end:
"check your destination's own immigration service." Only 4 curated journeys exist
(CA visa, CA eTA, JP visa, AU ETA). Nationality entry is a raw 2-letter ISO text
field. There are no processing-time statistics anywhere. Spacing inside the panel
is ad-hoc rem values; headings and paragraphs visually merge.

## Locked decisions (from brainstorm)

1. **Hybrid coverage** — a universal playbook renders for every route without a
   curated journey; curated journeys override it. No dead ends.
2. **Live-fetched stats with consent** — processing-time statistics are fetched
   from the authority's own published pages on explicit user action, never
   bundled. ADR-0014 amends ADR-0006's fetch clause narrowly.
3. **Approach B** — cockpit re-architecture of `VisaPanel`; Readiness/Today
   integration excluded (that was approach C).

## Contract constraints (binding)

From ADR-0006, unchanged:

- A curated string that asserts a fee, a processing time, an eligibility
  outcome, or an amount of money is a defect. The build-failing prose scan
  (`curated_prose_never_quotes_a_fee_or_a_processing_time`, visa.rs) **extends
  over every playbook string, including step titles.**
- Every factual claim is a link; every authored sentence is a translation of
  the authority's term or a caution about an execution mistake.
- Entry paths are quoted, never derived. `Unknown` is first-class.

ADR-0014 adds: numbers may appear **only** when machine-read from the
authority's own published page by this device at the user's explicit request,
displayed verbatim with authority name, source URL, attribution/licence,
retrieved-at stamp, the source's own published-as-of date whenever it exposes
one, and age-based staleness marking. **No bundled numbers, ever.** Fallback
ladder: fetched → kept copy (stamped + aged) → link-only. Never silent.

## UX: four cockpit zones

Top to bottom inside the existing `#section-visa` `DeferredSection`. The
non-dismissible `role="note"` disclaimer stays exactly where it is. At ≤48rem
all zones stack in order; the stepper rail stacks above the detail pane (the
existing 48rem grid collapse is preserved), and the focus-into-step-title
behavior (`chosen`-gated, `tabIndex={-1}` h3) is retained for exactly that
reason. Stats metric rows scroll horizontally in their own container if wider
than the viewport.

1. **Route header** — nationality picker + destination + verdict.
   - Picker: existing `Combobox`. Options `{ value: code, label: "{name} — {code}" }`
     built once from a bundled alpha-2 constant (new `apps/web/src/app/countries.ts`,
     ~249 codes — chrome, not contract) + `Intl.DisplayNames(APP_LOCALE,
{ type: "region", fallback: "code" })` wrapped in try/catch (raw code on
     throw). Filtering is caller-side in `fetchSuggestions`: case- and
     diacritic-insensitive, matches name and code. The field drops
     `maxLength={2}`; uppercase normalization happens at submit only; after
     selection the field shows the code — the committed value is what
     `setVisaNationality` already accepts. Free-typed 2-letter codes remain
     valid (suggestions never gate input).
   - The suggested nationality becomes a one-tap chip naming the country
     (field empty until tapped; tap applies and saves).
   - Verdict: existing `EntryPathQuoteCard`, restyled on the new tokens.
2. **Guide** — curated journey when one exists, else the universal playbook;
   one renderer (both are `VisaJourney`). The progress strip sits at the top
   of this zone and keeps the shipped attribution sentence ("Voyalier has not
   verified any item"). Per-step document checkboxes and notes are unchanged.
   A provenance banner distinguishes origin:
   - `visa.guide.provenance.curated`: "These steps were read from {authority}
     on {date}. Confirm your own case there before you act on any of them."
   - `visa.guide.provenance.playbook`: "A general route map written by
     Voyalier — not read from any authority and not specific to this route.
     Each step tells you what to confirm at the official source before you
     pay, book, or file."
     The guide wrapper keeps `lang={journey.language}`; the playbook carries
     `language: "en"` like curated journeys, so ES chrome around English steps
     stays honestly tagged.
3. **Route stats** — processing-time card. The authority name is the card's
   **heading in every state** (a cropped screenshot still names whose numbers
   these are). States:
   - _Never fetched:_ heading + official page link + consent sentence
     `visa.stats.consent`: "Fetching contacts {authority} once from this
     device to read its published processing times, and stores a dated copy
     locally. Nothing about you or your trip is sent — only the public page
     is downloaded." Button `visa.stats.fetch`: "Fetch current published
     times" (the click is the consent act, mirroring `DestinationFacts`).
   - _Fetched / kept:_ metric rows as a real `<table>` with header semantics,
     quoted styling (the `voy-advice__summary` treatment), the source's own
     labels and units — no unit conversion, no averaging, no reordering or
     filtering of rows. Source line: "Read from {authority} · retrieved
     {stamp}" plus, whenever the source publishes one, "{authority} states
     these figures as of {published-at}" — the source's own date is never
     omitted when present. Attribution/licence line below (mirrors
     `voy-advice__licence`). Nationality highlight: only on an exact match
     between the source's own row label and the passport country name from
     the bundled table; never filters or reorders; marked with text ("your
     passport", sr-only at minimum), never color alone; captioned "marks the
     row labelled '{label}' — confirm it is yours."
   - _Staleness is marked by age as well as by failure_, mirroring
     `TravelAdvice` (7-day window): any displayed snapshot older than the
     window carries `visa.stats.stale`: "Fetched {days} days ago — fetch
     again before you rely on it," regardless of refresh outcome.
   - _Kept copy after a failed refresh:_ `visa.stats.kept`: "Could not reach
     {authority} — showing the copy saved {date}. The published times may
     have changed since; check the source."
   - _Unfetchable authority:_ `visa.stats.unfetchable`: "{authority} blocks
     automated reading, so Voyalier cannot fetch its published times for you.
     Read them yourself at the official page." (This is canada.ca's likely
     state in practice; the design treats it as first-class, not an error.)
   - Refresh uses the shared `Button busy` state plus `useAnnounce` on
     completion — success, kept-fallback, and failure are all announced.
     Expected states render inline; `role="alert"` only for unexpected errors.
4. **Missions** — existing list behind a native `<details>/<summary>`
   disclosure ("Missions of {nationality} near {destination}"), collapsed by
   default, keeping the `h4` + `aria-labelledby` region semantics.

Preserved a11y contract, explicitly: `aria-current="step"` on the rail, the
remount-keyed `chosen`-gated focus mechanism, `role="note"` disclaimer,
text-not-color done markers, sr-only link annotations, `lang` tagging.

Spacing/typography: a seven-step `--voy-space-*` scale is added to
`packages/ui/src/tokens.css` (additive), pinned here so nobody eyeballs the
docs-site's unrelated `--space-*` values: `2xs 0.25rem · xs 0.5rem ·
sm 0.75rem · md 1rem · lg 1.5rem · xl 2rem · 2xl 2.5rem`. The rebuilt
`.voy-visa-*` rules consume tokens exclusively, with one carve-out: the
checkbox-text alignment indent stays a local `--voy-visa-indent: 1.55rem`
(control-width constant, not rhythm). Shared primitives are not globally
restyled in this slice.

## Core (`crates/voyalier-core`)

- `src/visa.rs` gains `universal_playbook(destination_iso2, nationality_iso2,
quote: Option<&EntryPathQuote>) -> VisaJourney`:
  - Six steps, every sentence a translation or an execution caution — zero
    fees, times, eligibility outcomes, or amounts:
    1. _Confirm who decides_ — the authority when a quote exists; else
       cautions for finding it (lookalike visa-agency sites outrank official
       ones in search — the folklore trap).
    2. _Identify your entry path_ — path vocabulary translated (visa /
       electronic authorization / exemption / published conditions); the
       quote's page is where the answer lives.
    3. _Get ahead of the documents that take time_ — opens with "the official
       checklist decides what is actually asked for — read it before
       gathering anything." Each item names a document class **only inside a
       caution about how that class goes wrong or takes time**, conditional
       on the checklist: passport ("renewing mid-application means redoing
       parts of it — check validity before anything else"), photos ("if
       photos are asked for, take the destination's own published
       specification to the photographer"), funds ("if evidence of funds is
       asked for, a balance that appeared recently reads as borrowed —
       history matters more than the amount"), itinerary/ties/insurance in
       the same conditional voice. The step never states that this
       destination asks for anything.
    4. _File where the authority says to file_ — caution-voiced: "file only
       where {source_name}'s own site says to file — third-party filing
       sites rank above it in search results"; browser-vs-Adobe form trap.
    5. _Track and wait_ — "track only through the channel the authority
       itself names"; points at the Route stats card without stating any
       time.
    6. _Prepare for entry_ — carry-documents caution; conditions-of-entry
       vocabulary translation.
  - **Link rule (tested):** the playbook renders at most `quote.source_url`,
    labeled with `quote.source_name` — no other anchors, no relabeling as
    "portal" or "tracking." The core test asserts playbook links are exactly
    a subset of `{quote.source_url}` (set membership, not domain prefix) and
    empty when no quote is passed.
  - Document ids carry a `playbook-` prefix; the per-destination prefix
    invariant stays scoped to curated journeys.
- `VisaPrep` gains two optional fields, `#[serde(skip_serializing_if)]`,
  wire-compatible:
  - `playbook: Option<VisaJourney>` — present **iff** nationality is set, a
    destination resolved, and `journey` is `None`.
  - `stats: Option<VisaStatsPanel>` — present iff the destination resolves
    to a row in the stats source table (the 7 named authorities). An
    uncurated destination has no stats zone at all — honest absence, and the
    playbook's step-5 prose stays generic so it never references a card that
    is not there.
- New `src/visa_stats.rs` (ADR-0008 shape — the module owns its endpoints and
  dispatch; nothing here is re-exported through `lib.rs`'s `pub use` beyond
  the types the contract needs):
  - `published_times(destination_iso2, retrieved_at, fetch: impl FnOnce(&str)
-> Result<String, AppError>) -> Result<Option<VisaStatsSnapshot>, AppError>`
    — owns the fetch endpoint URLs (IRCC's published JSON dataset; UKVI's
    GOV.UK waiting-times page) and picks the parser. The app layer supplies
    only fetch, error flavour, and storage.
  - Pure parsers beneath it, fixture-tested: `parse_ircc_processing_times`
    (JSON) and `parse_ukvi_waiting_times` (HTML). Malformed fixtures included.
  - Types: `VisaStatsPanel { source: VisaStatsSource, snapshot:
Option<VisaStatsSnapshot> }`, `VisaStatsSource { destination_iso2,
authority_name, page_url, fetchable }`, `VisaStatsSnapshot {
destination_iso2, authority_name, source_url, attribution, retrieved_at,
published_at: Option<String>, metrics, provenance }`, `VisaStatMetric
{ id, label, audience: Option<String>, value, unit: Option<String> }`,
    `VisaStatsProvenance { Fetched, KeptCopy }`.
  - **Provenance is defined by delivery, not history:** `Fetched` describes
    only the direct return value of a successful refresh; any snapshot served
    from storage is `KeptCopy`. (Computed at serve time, not stored.)
  - Source table: all 7 named authorities; CA + GB carry parsers in v1;
    JP/AU/NZ/KR/US ship `fetchable: false` with official page links. The US
    parser is explicitly deferred.
  - `attribution` carries the source's own reuse terms (per
    RETRIEVED_SNAPSHOTS invariant 2), rendered as the licence line.

## App (`crates/voyalier-app`)

- **ADR-0014** records all four decisions: (1) the narrow ADR-0006 amendment —
  the `AdviceFetcher` seam now applies to published _statistics_ pages, never
  rules, fetched only on explicit user action; (2) the `visa_stats_snapshots`
  storage shape including the deliberate no-cascade retention decision (a
  snapshot outlives trips to that destination; destination-keyed lookup means
  a destination edit re-resolves, satisfying RETRIEVED_SNAPSHOTS invariant
  5's intent); (3) the two data-source register additions (user-facing
  surface); (4) the `VisaSelfReport` semantic change (the readiness line now
  counts whichever guide renders — journey else playbook — still
  self-attributed).
- Migration: append `Migration { to: 17, name: "visa_stats", … }` —
  `CREATE TABLE IF NOT EXISTS visa_stats_snapshots (destination_iso2 TEXT
PRIMARY KEY, payload_json TEXT NOT NULL, retrieved_at TEXT NOT NULL)`.
  Destination-scoped (the authority publishes one table per destination;
  nationality is display-time only). Not sealed — nothing personal:
  `audience` labels are the publication's row labels.
- `service_visa.rs`:
  - `get_visa_prep` resolves `playbook` (per the invariant) and `stats`
    (source row + kept snapshot, `KeptCopy`, no network) — **zero new
    mount-time gateway calls**, so the trip-open call budget in
    `performance.test.tsx` is untouched.
  - `visa_self_report` counts whichever guide renders.
  - New `refresh_visa_stats(input) -> VisaPrep`: fetches via the injected
    fetcher through `published_times`, upserts, returns the full prep with
    `provenance: Fetched`; on fetch/parse failure returns the kept copy
    (marked) or link-only, with the failure reason surfaced. `FakeFetcher`
    (+ `offline()`) covers tests. Errors reuse the existing advice-fetch
    `ErrorCode` — no new code, no `AppError.schema.json` change.

## Contracts and parity train (all fifteen stops)

One new method — `refreshVisaStats(tripId: string): Promise<VisaPrep>` —
`POST /api/v1/trips/{tripId}/visa/stats`, command `refresh_visa_stats`,
payload `{ "command": ["tripId"], "body": null, "query": [] }` (the
`fetchWeather` shape). Landing spots:

1. `crates/voyalier-app/src/service_visa.rs` — the method.
2. `crates/voyalier-server/src/lib.rs` — route + handler (guards:
   `the_router_declares_exactly_the_manifest`,
   `every_handler_reads_the_keys_the_manifest_declares`).
3. `apps/desktop/src-tauri/src/lib.rs` — command + input struct +
   `generate_handler!` + append to the hand-listed
   `every_tauri_command_requires_the_input_arg_key` array.
4. `packages/contracts/src/index.ts` — `AppGateway` + new types +
   `VisaPrep.playbook`/`stats`.
5. `packages/contracts/src/mock.ts` — see mock rules below.
6. `apps/web/src/gateway/http.ts`. 7. `apps/web/src/gateway/tauri.ts`.
7. `packages/contracts/parity/routes.json` — one hand-written row.
8. `apps/web/src/routeParity.test.ts` — `ARGS` entry for the method.
9. `apps/web/src/mockFieldCoverage.test.ts` — `driveWorkspace()` calls the
   method; every new optional (`playbook`, `stats`, `publishedAt`,
   `audience`, `unit`) appears once or carries a reasoned exception; the
   walk sets a nationality on an uncurated trip so the playbook actually
   materializes.
10. `packages/contracts/parity/data-sources.json` — two new rows (`ca-ircc`,
    `uk-ukvi`; distinct from `ca-gac`/`uk-fcdo`), `count` 23→25; BTreeSet +
    pinned count updated in `crates/voyalier-core/src/tests.rs`;
    `apps/web/src/dataSources.test.tsx` renders the new count.
11. `packages/contracts/parity/visa.json` — **playbook cases added** (uncurated
    pairs pinning step ids, ordinals, `playbook-` document ids) so the mock
    synthesizes the playbook from the golden (read, never mirror); `caseCount`
    bumped in the file, the literal `toHaveLength` bumped in
    `apps/web/src/parity.test.ts`, and the Rust side follows the file.
12. New golden `packages/contracts/parity/visa-stats-sources.json` — the
    7-row source table with pinned count, asserted from both
    `crates/voyalier-core/src/tests.rs` and `apps/web/src/parity.test.ts`;
    the mock reads it for source rows and link-only states.
13. `apps/web/src/gateway/gateway.live.test.ts` — the new route exercised
    against the real loopback server.
14. `docs/architecture/ADR-0014-….md` + this spec + the plan doc.

Mock rules (ADR-0004/0009): playbook synthesized from `visa.json` cases like
`mockVisaJourney` does today; source rows from `visa-stats-sources.json`;
snapshot rows are hand-authored fictional fixtures labeled "(Fictional
fixture.)" per the `fetchAdvisories` precedent; the full state machine
(never-fetched → fetched → kept-on-failure → unfetchable) is real mock
behavior so component tests exercise real states; the mock's `visaSelfReport`
counts whichever guide renders, changed in the same commit.

## Web (`apps/web`)

`VisaPanel.tsx` rebuilt into the four zones. `visaPanel.test.tsx` updates —
two existing pinned tests change shape, named here so they don't surprise:

- "offers the last passport to a new trip without adopting it" now asserts
  the **chip** (visible, naming the country, field empty; tap applies+saves).
- "names the mission and says to confirm it elsewhere" first opens the
  missions disclosure.

New cases: IN→FR renders the playbook with the Voyalier-authored provenance
banner (no dead end); IN→CA still renders the curated journey (override
proven); picker search "Ind" → India, free-typed "in" accepted; stats states
(consent, fetched rows + nationality text marker, kept banner, stale-age
line, unfetchable); ES render of the playbook provenance banner; the
focus-into-step test parameterized over IN→FR (playbook path); a11y sweep
(`findA11yViolations`) with playbook rendered, stats fetched, and missions
open; i18n adds EN + ES for every new string; the unreachable
`visa.noDestination` string is deleted in both locales.

## Error handling (summary)

Every failure is a visible state: fetch failure → kept-copy banner or
link-only with reason; parser mismatch → treated as fetch failure (kept copy
stands); offline → kept copy with age or link-only; unfetchable authority →
named block + link; age past the 7-day window → stale line always. No silent
fallbacks, no toasts for expected states.

## Testing

Core: playbook invariants (six steps; prose scan over all playbook strings
including titles; link set-membership rule; `playbook-` prefixes), parser
fixtures (well-formed + malformed IRCC JSON and UKVI HTML), staleness and
provenance rules. App: service tests via `FakeFetcher`/`offline()`, migration
idempotence, kept-copy upsert, refresh-failure fallback. Contracts: the
fifteen stops above. Web: the case list above. Gate: `make check`;
`scripts/check.sh integration` for the live route.

## Release plan (this branch)

1. Layer-ordered commits: `Docs:` (spec+ADR+plan) → `Core:` → `App:` →
   `Contract:` → `Web:`, bodies naming the ADR clause discharged.
2. `/update-docs` pass, then CHANGELOG prose entry.
3. Version 0.8.3 → **0.9.0** across root `package.json`, workspace
   `Cargo.toml`, `apps/web/package.json`, `tauri.conf.json`, then
   `cargo update --workspace` (re-records `voyalier-desktop` too).
4. Close with `Merge: visa cockpit v2` into `main`, push
   (branch-protection warning expected per repo convention).

## Out of scope (explicit)

Booking-site directory and import tie-in (slice 2), app-wide spacing
migration (slice 3), LLM mini-prompt (slice 4), readiness/Today integration
(approach C), stats history/trends (snapshot table is overwrite-on-refresh),
US State Dept parser, `getVisaStats` as a separate method (folded into
`VisaPrep`), any autonomous filing or booking behavior.
