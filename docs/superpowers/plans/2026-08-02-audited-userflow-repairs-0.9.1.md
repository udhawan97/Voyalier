# Audited user-flow repairs — 0.9.1

A browser audit of 0.9.0 (`a9de959`) found eleven gaps across six primary flows.
This plan closes all of them. Every fix is verified against the reproduction that
exposed it, not against the build passing.

The audit's report lists severity, evidence and root cause per gap; this plan is
only about how each one gets closed and in what order.

## The one that is not a defect

`G8` — a trip card printing the route twice — turned out to be the residue of a
prior fix, not an oversight: `types.rs:812` normalises the arrow precisely because
the title sits one line above its own route line. The duplication was seen and
left. It is still worth removing, but the fix belongs in the two views that render
both lines, never in `validate_create_trip`, which must keep returning a non-empty
title.

## The one that reverses a recorded decision

`G2` — browser and gesture Back do nothing — is not an unnoticed regression.
`docs/product/APP_AUDIT_AND_POLISH_PLAN.md:302` records "Explicit non-goal: URL
routing / deep links", repeated in the don't-start list at :536.

Reversing that needs an ADR, not a quiet patch, so ADR-0015 carries the decision
and the history work lands as its own commit that can be reverted without touching
the other ten fixes. The argument for reversing: the same don't-start line also
lists "global cross-trip search", which has since shipped, so the list no longer
describes the product; and every non-list view already has an in-app Back control,
so wiring history adds an affordance rather than replacing one.

## Order of work

Layer order, one commit per layer, closing with a merge commit.

### 1. `Web: reunite the passport field with its own controls` (G1)

`.voy-visa__nationality .voy-combobox` carries `flex: 1 1 16rem; max-width: 24rem`,
but `Combobox` always renders inside a `.voy-field` wrapper that is
`flex-direction: column`. The basis therefore resolves on the block axis and the
combobox computes to 256px tall around a 44px input.

Move **both** declarations to `.voy-visa__nationality .voy-field` — the element that
is actually the row's flex child. Moving only `flex` would leave the 24rem cap on the
inner div and let the label, hint and error stretch wider than the input. Never put
either on bare `.voy-field`; that is the primitive behind every form in the app.

Guard: an assertion in `e2e/planning.spec.ts`, which already measures geometry in a
real browser and already runs inside `make check` via `stage_integration`. The jsdom
unit stage cannot see this class of defect at all — none of the 62 Vitest files
touches a layout API, and jsdom performs no layout.

### 2. `Web: count characters the way the engine does` (G3, G11)

`CreateTripDialog` and `EditTripDialog` compare `.length` — UTF-16 code units —
against a hardcoded 120, while core counts Unicode scalars (`types.rs:934`). The
failure mode is documented inline at the constant they declined to import
(`contracts/src/index.ts:574-579`).

Three parts, in order:

1. `countChars()` instead of `.length` in both dialogs.
2. Import `MAX_LOCATION_LEN` instead of the hardcoded 120s — these two dialogs only.
3. Only then drop the `maxLength` attributes, so an over-long paste is explained
   rather than silently cut.

`AiPromptSettings.tsx:91`, `TripSearch.tsx:162` and `ImportDialog.tsx:247` truncate
the same way, but there `maxLength` is the _only_ client-side limit — none of them
has a `countChars` check behind it. They get a check added first; the attribute stays
until one exists.

### 3. `Web: keep the traveler's place across a detour` (G4)

Three distinct causes behind one symptom class, fixed separately:

- `openSearch` never records a return view, so Search opened from a trip lands on
  the trip list while Settings correctly returns. Give it the `returnView`
  treatment Settings already has.
- `WorkspaceSearch` holds its query in local state under a view that unmounts.
  Lift the query to the App-level view state that already carries `searchTarget`.
- `clearTripSectionHash` runs only on the transition to `list`, so a cross-trip
  search jump carries the old trip's section hash into the new trip and wins on
  reload. Clear it whenever the viewed trip changes.

### 4. `Web: say each thing once, and say what failed` (G5, G6, G7)

- `StepDetail` renders each document's links and then the step's links, so a step
  that cites the same authority at both levels prints it twice — 14 pairs across 11
  steps in all four curated journeys. Filter the step links against the links its
  own documents already rendered. This stays in the view: the curated data is
  correct, and only the rendering repeats it.
- The search view is the only top-level view without an `h1`. Give it one; do not
  add a level prop to `SectionTitle`, whose `h2` is right everywhere else.
- The zero-result state says only "No matches in this workspace." Add one line of
  recovery at the point of failure.
- ~~Any statistics refresh error renders "Could not reach {authority}". The
  engine already distinguishes a fetch failure from a parse failure; branch the
  copy.~~ **Wrong, and dropped from this release.** It does not: a network
  failure, a parse failure and an uncurated source all return
  `ErrorCode::AdviceFetchFailed`. Splitting them needs a new variant, which is
  wire contract mirrored in a JSON schema, so it wants an ADR of its own.

### 5. `Web: stand aside while an IME is composing` (G9)

`Combobox`'s key handler has no `isComposing` guard, so it `preventDefault`s the
ArrowDown an IME needs to move through its candidate list. Return early while
composing. Five call sites share the component, including the visa passport picker.

### 6. `Web+docs: let Back mean something` (G2, ADR-0015)

Represent the view in the URL and listen for `popstate`. Kept last and separate so
it can be reverted alone.

## Verification

`make check` for the gate. Then the audit's own reproductions, re-run in a real
browser: the passport row at 1440 and 375 with the chip and an error visible; a
61-character astral paste; the four navigation reproductions; a curated step's link
list; the search view's heading; browser Back from a trip.

Layout fixes are the ones the unit stage cannot see, so their evidence is a
measurement in a real engine, not a passing test file.
