# Architecture deepening — 2026-07-29

Follows an architecture review of the 0.6.x hot spots. Four candidates, three of which needed
a decision record first. Ordered by risk: the smallest and most reversible lands first, and
each step is committed on its own so a revert is one commit.

## Already landed

- **Route manifest drives the desktop envelope guard** (0.6.1). `get_visa_prep` took its
  argument as `trip_id` where every other command takes `input`, so the visa cockpit failed on
  every load in the packaged app. Guard rewritten to read its command list from
  `parity/routes.json` and to exercise argument binding rather than compare names.
- **`useAsyncAction` sequences overlapping runs** (0.6.1). Mount-guarded but not
  sequence-guarded, so the slower older run won and persisted stale interest weights.
- **Contract-derived message keys are bound to their unions**. Five `as MessageKey` casts
  replaced by four helpers; a new `PackingCode` is now a build failure, not a raw key rendered
  to a traveler.

## Step 1 — `Sealed` (ADR-0007)

Crate-private newtype over a sealed column's stored form. Private field, constructed only by
`Vault::seal`, read only by `Vault::open`, `FromSql`/`ToSql` so rusqlite carries it.

1. Define `Sealed` beside `Vault`; convert `seal_field`/`open_field` to `seal`/`open`.
2. Convert `records.rs` read paths: the six `Raw*` structs and their mappers take `Sealed`.
3. Convert write paths: every `params!` binding a sealed column binds `Sealed`.
4. Leave `SEALED_COLUMNS`, the migration, and the round-trip test untouched.

Verification: the round-trip test still passes; mutation — drop an `open` call and confirm it
is a compile error rather than a test failure. Then the full `check.sh rust`.

Risk: highest of the four. It touches the vault, which is security-critical, across ~35 sites.
Mitigated by the change being type-driven — the compiler enumerates the sites — and by the
existing 82 app tests plus the sealed round-trip assertion.

## Step 2 — Source protocol colocation (ADR-0008)

Move ten URL literals from `voyalier-app` into the core module that owns each parser, in the
shape `weather::geocode` already uses (core owns the endpoint and encoding; the app supplies
the fetch and the error flavour).

1. FCDO, US State, Canada GAC, Germany AA, CDC — the five advisory sources.
2. Open-Meteo forecast, archive, air quality; NWS alerts; ECB rates.
3. Collapse the duplicated provider auth headers shared by `provider.rs` and `assist.rs`.

Verification: existing parser fixtures and the 232 core tests are unchanged by construction —
this moves where a URL is built, not what is fetched or parsed. `FakeFetcher` asserts on URLs
in several app tests, so those pin the result.

Not in scope, per the ADR: no `confidence` field, no fetch-path content hash, no generic
`RetrievedSnapshot<T>`.

## Step 3 — Mock field coverage (ADR-0009)

A web test that reads optional properties off the contract's response types via the TypeScript
compiler API, drives every `AppGateway` method against the mock, and asserts each optional
property is populated at least once or listed as a documented exception.

1. Extract the property list; assert the extraction itself found something (a parser that
   silently matches nothing passes every test).
2. Drive the gateway across the fixture workspace.
3. Seed the exceptions table from the real absences, each with a reason.

Verification: mutation — remove the `suggestedNationalityIso2` line repaired in 0.6.1 and
confirm this guard fails naming that field.

Risk: the exceptions table may be large enough to be noise. If it is, narrow the guard's scope
to the response types of the methods the UI reads, and say so in the ADR.

## Not attempted

Splitting `AppService` (95 methods, one 2,900-line impl) and collapsing the nine-site ritual
for adding a gateway method. The first is not obviously a deepening — six smaller modules can
be shallower than one large one — and the second is a transport-generation change that needs
its own ADR and a working session, not an afternoon.
