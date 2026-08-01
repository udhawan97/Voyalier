# Architecture deepening, 0.8.2

An architecture review walked the repository's hot spots — the files that keep
appearing in recent commits — looking for shallow modules, places where the
interface costs nearly as much to learn as the implementation hides. It found
one live defect, one swallowed failure, and a set of duplications where a rule
is written down more than once with nothing holding the copies together.

This plan takes the repairs that fit under the existing ADRs. It deliberately
leaves the larger findings alone; they are recorded at the end so the next
review does not re-derive them.

## What is wrong

### 1. The mock's high-stakes table drifted, and the one test on it passes anyway

`crates/voyalier-core/src/chat.rs` matches 48 words and 6 multi-word phrases to
decide which questions get an "ask the authority" pointer card above the local
model's answer. `packages/contracts/src/mock.ts` carries a hand-written mirror
of that table with 20 words and no phrases.

So in mock mode — which is what 41 of the 62 web test files run against, and
what `VITE_MOCK=1` shows a contributor — "What are the entry requirements for
Japan?" produces no Entry pointer, and neither does any question about customs,
borders, ESTA, Schengen, overstaying, malaria, quarantine, terrorism, curfews,
travel insurance, or yellow fever. `apps/web/src/chatPanel.test.tsx` is the only
test that asserts the behavior, and it asks "Do I need a visa for this trip?" —
a word inside the 20-word intersection. It passes for the wrong reason.

ADR-0004 exists precisely for this: a rule mirrored in the mock needs a golden.
The rule was mirrored five days ago without one.

### 2. A provider load failure reaches nobody

`apps/web/src/views/AiProviders.tsx` wraps its gateway call in `try`/`finally`
with no `catch`, and wires it to a click handler. A rejection becomes an
unhandled promise rejection: no banner, no announcement, and no
`reportTransportFailure`, so the topbar keeps claiming the engine is reachable
while the panel silently shows nothing.

### 3. Five views still hand-roll the async shape `useAsync` was written to delete

`apps/web/src/app/useAsync.ts` documents the debt it repaid — 23 views
re-deriving `setError(null)` → `setBusy(true)` → `try`/`catch`/`finally`, and
three inconsistent error shapes grown up around those copies. Five of them
survive, including two that cast `caught as AppError` over a value that might be
a `TypeError` from their own code, and one that re-implements the
transport-health contract by hand with a comment naming the contract it is
re-implementing.

### 4. Two revalidation scopes have no name

`apps/web/src/app/revalidate.tsx` names four scopes so a mutation in one view
can invalidate another's data without prop-drilling. The chat and resources
panels invent `chat:${tripId}` and `resources:${tripId}` inline instead, so no
other view can invalidate them without re-deriving the string format.

### 5. Three pure rules are written down twice

- `haversine_km` and `EARTH_RADIUS_KM` are copied into `airports.rs`,
  `heritage.rs`, and `co2.rs`, each with its own rounding.
- `unreadable_source()` — the error a fetched source gets when it does not parse
  — is repeated seven ways across the retrieval modules.
- `crossRate` in `apps/web/src/views/DestinationFacts.tsx` reimplements
  `cross_rate` from `crates/voyalier-core/src/facts.rs`. `AGENTS.md` says core
  owns deterministic rules; this one lives in both languages with no golden.

### 6. `SEALED_COLUMNS` is not reconciled against the schema

`crates/voyalier-app/src/records.rs` declares which columns the vault encrypts
as 14 `(table, column)` string pairs. Nothing checks them against the database,
so a typo, or a table renamed by a later migration, silently stops encrypting a
column. The round-trip test only proves that the columns it *can* find hold
sealed values.

`crates/voyalier-app/src/snapshots.rs` already solves exactly this for
`SNAPSHOT_TABLES`, asserting both directions against `sqlite_master`. The
precedent is one file away and was not applied.

### 7. The route guards misstate their own size

`crates/voyalier-server/src/lib.rs` claims "the 57 checks below" in one
assertion message and "the 68 checks below" in another, in the same test, while
the manifest declares 81 routes. A guard that misreports its own coverage
invites the reader to trust a number instead of the assertion. ADR-0011's line
anchors moved two days after it was written.

### 8. Six test files define the same opener

`renderApp` lands on the trip list, but 35 test files need the trip page, so six
of them define a byte-identical `openKyoto()` and the rest inline it.
`errorStates.test.tsx` defines it twice under two names, 372 lines apart.

### 9. A shared primitive lives in a view

`apps/web/src/views/ChatPanel.tsx` imports `Hint` from `./ResourcesPanel`.
Separately, `apps/web/src/views/Recommendations.tsx` is the one place in the web
app that calls `toLocaleLowerCase()` with no locale argument.

## How it will be fixed

Layer order, one commit per layer.

1. **Core.** Move `haversine_km` and `EARTH_RADIUS_KM` to one module and have
   the three callers use it. Give the retrieval modules one
   `unreadable_source(source)` constructor. Neither changes behavior; both are
   covered by the existing per-module tests.
2. **Core + contract.** Add `packages/contracts/parity/chat-topics.json`
   carrying the word and phrase tables themselves, following the
   `prompts.json` precedent: the Rust test asserts the constants equal the file,
   and the mock imports it rather than paraphrasing. Add the same treatment to
   `crossRate`, whose golden pins the rule both languages compute. Both goldens
   pin exact case counts on both sides, as ADR-0004 requires.
3. **App.** Reconcile `SEALED_COLUMNS` against `sqlite_master` in both
   directions, mirroring `snapshots.rs`.
4. **Web.** Route the five hand-rolled async sites through `useAsyncAction`,
   fix the swallowed provider failure, name the chat and resources scopes, move
   `Hint` into `components/`, and give `Recommendations` its locale.
5. **Test.** Lift the shared opener into `test/helpers.tsx`. Derive the route
   count in the server guard instead of restating it.
6. **Docs.** Correct ADR-0011's anchors, write the changelog entry, sync the
   version across the four files.

Each repair lands with a test that fails before it and passes after. The
high-stakes drift gets its test first: a word the mock does not currently know.

## What this deliberately leaves out

These are real, and none of them fits in a patch release.

- **Both transport adapters are ~90% pass-through.** 66 of 81 Axum handlers and
  80 of 81 Tauri commands forward a single call. Deriving them would be an ADR
  about codegen, which `packages/contracts` currently refuses by design.
- **No guard covers the request payload.** `routes.json` declares verb, path,
  and command; TypeScript declares the signatures; nothing declares the body.
  Renaming a field on one side of 61 hand-built Tauri argument objects compiles
  clean and passes every existing guard. This is the largest real hole found and
  deserves its own ADR.
- **`mock.ts` is a second implementation of the product**, not a second adapter:
  ~1,300 lines of mirrored rules carry no golden. The chat-topics repair below
  is one of them; the other ~12 remain.
- **The schema is stated in three unreconciled places.** 33 `CREATE TABLE`
  statements for 24 tables, five of them duplicated between `init_connection`
  and a migration, one three ways.
- **219 hand-written row→domain mappings in two incompatible styles.** Adding a
  column touches 8–9 places and up to seven parallel column lists.
- **`crates/voyalier-app/src/lib.rs` is 3.7% `AppService`** after ADR-0010; the
  split moved methods and left their free functions behind.
- **`i18n.ts` needs two edits 1,400 lines apart**, and nothing lints for a
  string that skipped `t()`.
- **`TripDetailView.tsx` is 55% not-the-view** — five components living in the
  file, one of which `App.tsx` already imports.
