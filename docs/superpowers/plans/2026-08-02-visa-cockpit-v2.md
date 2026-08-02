# Visa cockpit v2 — implementation plan

Spec: `docs/superpowers/specs/2026-08-02-visa-cockpit-v2-design.md` (council-reviewed).
ADR: `docs/architecture/ADR-0014-visa-statistics-are-read-live-never-bundled.md`.
Branch: `friendly-wizard-claude/visa-trip-planning-ux-ff8f45`, closed with `Merge: visa cockpit v2`.

Commits land in layer order; each step's tests are written with (red before green) its code.

## 1. `Core:` universal playbook (visa.rs)

- `universal_playbook(destination_iso2, nationality_iso2, quote) -> VisaJourney`; six
  caution-voiced steps per spec; `playbook-` document-id prefix; links = at most
  `quote.source_url` labeled `quote.source_name`.
- `VisaPrep.playbook: Option<VisaJourney>` (`skip_serializing_if`).
- Tests: prose scan extended over playbook strings (titles included); link set-membership
  (⊆ {quote.source_url}, empty without quote); six-step shape; prefix rule; curated
  journeys still override (existing pair tests untouched).

## 2. `Core:` visa_stats.rs

- Types per spec (`VisaStatsPanel { source, snapshot: Option }`, snapshot with
  `attribution` + `published_at`, provenance computed at serve time).
- `published_times(destination, retrieved_at, fetch)` owning endpoints + dispatch
  (ADR-0008); parsers `parse_ircc_processing_times` / `parse_ukvi_waiting_times` with
  well-formed + malformed fixtures; 7-row source table (CA/GB fetchable).
- `VisaPrep.stats: Option<VisaStatsPanel>` present iff destination in source table.
- Goldens: `visa-stats-sources.json` (new, count-pinned) + `visa.json` playbook cases
  (`caseCount` bump); Rust-side assertions in tests.rs (BTreeSet + counts).

## 3. `App:` service + storage

- Migration 17 `visa_stats` (retry-safe CREATE TABLE IF NOT EXISTS).
- `get_visa_prep` resolves playbook + stats (kept snapshot = `KeptCopy`, no network).
- `refresh_visa_stats(input) -> VisaPrep` via injected fetcher; failure → kept copy or
  link-only with visible reason; existing advice-fetch `ErrorCode` reused.
- `visa_self_report` counts whichever guide renders (ADR-0014 §4).
- Tests: FakeFetcher success/failure/offline; migration idempotence; upsert overwrite;
  provenance-by-delivery.

## 4. `Contract:` parity train

- `refreshVisaStats(tripId)` POST `/api/v1/trips/{tripId}/visa/stats`,
  command `refresh_visa_stats`, payload `{"command":["tripId"],"body":null,"query":[]}`.
- All fifteen stops from the spec's table: server route+handler, desktop command +
  input struct + `generate_handler!` + input-arg array, `index.ts` types + method,
  `mock.ts` (golden-read playbook, `visa-stats-sources.json` source rows, fictional
  snapshot fixtures, full state machine, self-report mirror), both web gateways,
  `routes.json` row, `routeParity.test.ts` ARGS, `mockFieldCoverage` walk (nationality
  on an uncurated trip; refresh on a fetchable one), `data-sources.json` 23→25 + both
  count pins, `parity.test.ts` literals, `gateway.live.test.ts`.

## 5. `Web:` cockpit UI

- `--voy-space-*` (7 pinned values) in `packages/ui/src/tokens.css`.
- `countries.ts` alpha-2 constant; Combobox picker per spec (caller-side filtering,
  Intl.DisplayNames(APP_LOCALE) try/catch, no maxLength, code-on-commit); suggested
  chip replaces prefill.
- Four zones; provenance banners; stats card states (consent sentence, `<table>`
  metrics, published-as-of line, attribution line, stale-age line, kept banner,
  unfetchable, `useAnnounce` + `Button busy`); missions `<details>` disclosure;
  ≤48rem stack + focus contract preserved; `.voy-visa-*` on tokens with
  `--voy-visa-indent` carve-out.
- i18n EN+ES for every new string; delete `visa.noDestination` both locales.
- `visaPanel.test.tsx`: update the two pinned tests (chip; disclosure), add the spec's
  new-case list (IN→FR playbook, IN→CA override, picker, stats states, ES banner,
  focus-on-playbook, a11y sweep).

## 6. Gate, docs, release

- `make check`; `scripts/check.sh integration`.
- `/update-docs` pass; CHANGELOG prose entry under Unreleased, then cut 0.9.0.
- Version bump 0.8.3→0.9.0 (root+web package.json, workspace Cargo.toml,
  tauri.conf.json) + `cargo update --workspace`.
- `Merge: visa cockpit v2` → main, push (protection warning expected).
