# ADR-0019 — Trip creation has one validation path

**Status:** Accepted · 2026-08-15

## Context

Two functions in `crates/voyalier-core/src/types.rs` validate a new trip, forty
lines apart, and only one of them is reachable.

`validate_create_trip` is the live path. `AppService::create_trip`
(`crates/voyalier-app/src/service_trips.rs`) calls it, both transports reach it
through that, and it is what every trip in a traveler's workspace was checked
by.

`TripDraft::new` applies the same three rules in the same order —
`trim_required` on origin, `trim_required` on destination, `validate_date_range`
on the pair. It differs in two ways, neither of which is a rule: it mints a
`Uuid` (trip ids are minted by `new_id` in the app layer, so this one is never
persisted), and it has no title, so it never reaches the default-title branch
that gives an untitled trip its `"A → B"` name. `TripDraftError` exists to wrap
the `AppError` those shared helpers already return.

Nothing in either shell, either transport, or the app crate calls it. The only
callers are three tests in `crates/voyalier-core/src/tests.rs` that exist to
test it.

Two things about how this got here, because they change what the fix is.

**It was never a migration.** `TripDraft` and `validate_create_trip` arrived in
the same commit — `baecbc3`, "Phase 1: core slice", 2026-07-10. This is not a
cutover someone left half-finished and would resume; the second path was born
unwired and has stayed that way through every release since.

**The doc comment is not evidence of drift.** It reads "the minimum information
required to start a trip Blueprint", and Blueprint is current domain language,
not a superseded term — it names the shipped itinerary view in `README.md`,
`docs/design/PHASE1_UX.md`, and the changelog. The comment's noun is fine. What
is false is the sentence: nothing that starts a Blueprint goes through this
type.

### The schema is the reason this needs an ADR

`packages/contracts/schemas/trip-draft.v1.schema.json` describes exactly
`TripDraft`'s five fields. It is older than both functions — it is in `accf785`,
the repository's root commit, dated the day before Phase 1.

Nothing loads it. `SchemaSet::load`
(`crates/voyalier-core/src/schema_validation.rs`) names its five schemas in a
hardcoded array, and this is not among them. No `.rs` or `.ts` file references
the path or the `$id`.

AGENTS.md requires contracts to stay versioned and backwards compatible unless
an ADR approves the break, and a filename carrying `.v1.` with a published
`$id` is a contract surface on its face. That rule is what this ADR is for, and
the honest way to discharge it is to say what the guarantee is actually made
to, rather than to argue the file does not count.

Three facts bound it:

- The `$id` is `https://voyalier.dev/schemas/trip-draft.v1.schema.json`. Every
  sibling schema uses `voyalier.local` — a deliberately non-resolving authority.
  This is the only one claiming a real domain, and the project does not serve
  it: `docs-site` publishes to `udhawan97.github.io/Voyalier` and has no
  `/schemas` route. That URL has never returned this file.
- It is reachable to code through `@voyalier/contracts`'s `./schemas/*` export,
  and that package is `"private": true` and unpublished. The export is a
  workspace convenience, not a distribution.
- Its naming is from before the convention: kebab-case with an explicit `.v1.`,
  where the five live schemas are `PascalCase.schema.json` and carry their
  version in the package.

## Decision

Retire `TripDraft`, `TripDraftError`, and `trip-draft.v1.schema.json`.

`validate_create_trip` is the single validation path for trip creation, as it
has been in production since the beginning. `validate_update_trip` remains its
counterpart for edits; both return `ValidatedTripInput`, and new trip rules go
in one of those two functions or in the helpers they share.

The general rule this sets, so the next unreferenced schema does not need its
own ADR to reason from zero:

**A versioned schema earns its compatibility guarantee by being loaded.** The
guarantee in AGENTS.md protects consumers — a stored payload, a `SchemaSet`
assertion, a shipped package a reader can install. A file that no `SchemaSet`
loads, no code references, and no published package carries has none, and a
`$id` does not create one. An `$id` is a name; distribution is what makes a
name a promise. A schema that is loaded, referenced, or published is covered by
the rule as written, and retiring one of those is a real break needing a real
deprecation.

## Consequences

The three tests move to the surviving path rather than being deleted with the
type. Two of them land cleanly. The third does not, and the difference is worth
recording.

`creates_a_trimmed_trip_draft` and `rejects_a_missing_destination` are about
rules `validate_create_trip` applies identically, so they retarget directly.
Retargeting the second one closes a real gap: the existing
`validates_trip_inputs_with_contract_rules` covered the date range and origin
trim, but nothing asserted that the live path rejects a blank destination. That
rule was only ever guarded on the dead path. This is the finding, more than the
duplication is — the coverage was pointed at the code nobody runs.

`serializes_trip_draft_with_camel_case_wire_fields` cannot follow them.
`ValidatedTripInput` derives no `Serialize` and never crosses a wire; asserting
`startDate` on it would be impossible, and forcing it there by adding a derive
would put a `serde` attribute on a type for a test's benefit. The camelCase
guarantee it was protecting belongs to `CreateTripInput`, which is the type that
actually crosses both transports on this path and which nothing in the core
suite asserted the wire shape of. The test moves there. This is a change of
subject, stated plainly: it now guards the payload travelers' clients send
instead of a shape that was never sent.

Nothing behavioural is lost. The `Uuid::new_v4()` was the only thing `TripDraft`
did that the live path does not, and it was discarded on every call.

The reversal cost is one `git revert`. Retiring an unreferenced file is
recoverable in a way that retiring a loaded one is not, which is most of why
this decision is available at all.

The residual risk is a consumer outside this repository that pinned the `$id`
and would break on its absence. That risk is not zero in principle, but the URL
has never resolved, the package that could have carried the file is private and
unpublished, and there is no telemetry or issue in which anyone asked about it.
Naming it here is the record; nobody is being asked to migrate.
