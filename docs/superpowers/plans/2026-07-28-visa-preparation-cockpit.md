# Visa preparation cockpit — implementation plan

**Date:** 2026-07-28
**Spec:** `docs/superpowers/specs/2026-07-28-visa-preparation-cockpit-design.md`
**ADR:** `docs/architecture/ADR-0006-visa-preparation-pointers.md`

Stacked in layer order, one commit per layer, closed with `Merge: visa preparation cockpit`.

## 1. `Core:` curated journey model and Canada data

`crates/voyalier-core/src/visa.rs`, registered in `lib.rs`.

- `EntryPath`, `EntryPathQuote`, `VisaDocument`, `VisaStep`, `VisaJourney`.
- `entry_path()` — IRCC's published visa-required / eTA-eligible split, quoted with source name,
  source URL, and `curated_as_of`. Every ISO-3166-1 alpha-2 code resolves; uncurated pairs give
  `Unknown`.
- `visa_journey()` — the eight-step Canada TRV journey; `None` for `Unknown`.
- `biometrics_links()` — curated for the fifteen listed nationalities, generic fallback otherwise,
  folded into step 7's links.
- Inline tests: link well-formedness, contiguous ordinals from 1, unique and destination-prefixed
  document ids, total resolution over `countries.tsv`, `Unknown` yields no journey.

## 2. `Contract:` types, mock, parity golden

- `packages/contracts/src/index.ts` — the five types, `VisaPrep`, `VisaPrepItem`, the two inputs, and
  the three `AppGateway` methods.
- `packages/contracts/src/mock.ts` — a mock journey exercising all eight steps.
- `packages/contracts/parity/visa.json` — golden with exact case counts, plus three
  `parity/routes.json` rows.
- `crates/voyalier-core/src/tests.rs` and `apps/web/src/parity.test.ts` — both assert the golden and
  pin the counts.

## 3. `App:` storage and service methods

- Append one `MIGRATIONS` step creating `visa_prep` and `visa_prep_item`. Retry-safe; never
  renumbered.
- Add `visa_prep.nationality_iso2` and `visa_prep_item.note` to `SEALED_COLUMNS`; wire read and write
  paths in `Records`.
- `AppService::get_visa_prep`, `set_visa_nationality`, `set_visa_item_progress`. Rows are created
  only on explicit tick or note. Note length bounded.
- Nationality prefill reads the most recently updated `visa_prep` row.
- Tests: round-trip persistence, cascade on trip delete, sealed columns unreadable in the raw file.

## 4. `Server+desktop:` transport

- Three Axum routes in `crates/voyalier-server/src/lib.rs`.
- Three Tauri commands in `apps/desktop/src-tauri`, snake_case, one argument named `input`,
  registered in `generate_handler!`.

## 5. `Web:` the cockpit

- `apps/web/src/views/VisaPanel.tsx` — disclaimer, path quote with `curated_as_of`, progress, step
  rail, open step with documents, gotchas, and links.
- `apps/web/src/gateway/http.ts` and `gateway/tauri.ts` — the three methods.
- `TripDetailView.tsx` — fifth `DeferredSection id="section-visa"`, nav entry, scroll-spy regex.
- `ReadinessPanel` — self-report sub-line on `EntryRequirements`; status unchanged.
- `i18n.ts` — interface copy. Curated content comes from core and is marked with its `language`.
- `apps/web/src/visaPanel.test.tsx` and the `routeParity.test.ts` rows.

## 6. `Docs:` release

- `CHANGELOG.md` entry in Keep a Changelog prose.
- Version synced across the four files.
- `make check` green before the merge commit.

## Verification

`make check` is the gate — `check.sh web`, `rust`, and `desktop` are what CI runs. Not covered, so
checked by hand: `pnpm audit --prod` and the credential-string grep from `security-hygiene.yml`.
