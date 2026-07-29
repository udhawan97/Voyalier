# Audited user-flow repairs (0.6.1)

A browser audit of 0.6.0 (`f1a384b`) drove five primary flows against the real loopback engine —
first run, create trip, import → review → confirm, visa preparation, and recovery from an
unreachable engine — at 320/375/1280px in light and dark. It found fourteen gaps, all reproduced on
the running product. Six are in the visa preparation cockpit that shipped with 0.6.0; the rest are
older and shared across flows.

The audit report is a temporary artifact and is not committed. This plan is the durable record of
what it found and what was done about it.

## The two patterns worth naming

**A fix landed on one path and its sibling never got it.** Three separate gaps are the same shape:
the load-failure banner is guarded against duplicating the workspace banner and the action-failure
banner is not; the section-nav chips mount-then-scroll and the hash-on-load effect does not; the
import handler names every scope it invalidates and the edit handler names one. In each case the
correct version is within thirty lines of the broken one. Where the fix allows, the two paths are
made to share the mechanism rather than to hold two copies of it.

**A panel re-derived something the shared layer already owned.** The visa cockpit invented
`.voy-error` instead of using `Field`, and the stylesheet never grew a rule for it, so three error
messages have rendered as ordinary body text since 0.6.0. The Prepare section's separator is
copy-pasted into each panel's own class, so four panels added later silently shipped without it.
Both are fixed by deleting the local copy, not by completing it.

## Gaps and dispositions

### Core

**G1 — the entry-path quote names Canada's authority for every uncurated destination.**
`entry_path()` returns an IRCC-attributed quote on every path out of the function, including the
branch that means "nothing is curated for this destination". Canada is the only curated destination
in 0.6.0, so a London → Tokyo trip is told to confirm its case at canada.ca. The app layer one level
up already gets this right — it returns `None` when the destination country cannot be resolved, with
a comment calling an invented answer the exact overreach ADR-0006 forbids. Core contradicts it at
the next branch down.

`entry_path` returns `Option<EntryPathQuote>`, and the uncurated-destination branch returns `None`.
`EntryPathQuote` then cannot exist without a real authority behind it. The two branches that keep
their quote both have Canada as the destination and are correct as they stand: a nationality whose
conditions IRCC publishes rather than answers, and a malformed nationality code — in both, IRCC is
genuinely the authority for the trip.

`VisaPrep.entryPath` is already `Option`, so the wire contract does not move. ADR-0006 is amended in
place to say that an uncurated destination yields no quote, because the ADR's existing wording is
what core was read as satisfying.

### Web — visa cockpit

**G2 — the journey can never be completed.** A step counts as done only when it has documents and
all of them are ticked; step 1 is orientation and has none, so the counter reads "7 of 8" with all
sixteen documents ticked and no remaining action anywhere. Steps with nothing to tick leave both the
numerator and the denominator, so the journey reads 7 of 7 and reaches its own total.

**G5 — tapping a step on a phone changes nothing visible.** The rail button only sets state. On
desktop the detail sits beside the rail; the narrow layout stacks it below all eight rail rows, 108px
past the fold at 375×812. Selecting a step moves focus to the step detail's heading, which scrolls it
into view and announces it — one change that fixes the pointer story and the screen-reader story.

**G6 — "Check the highlighted fields", with nothing highlighted, in body text.** The panel renders
the generic multi-field banner title for a single-field form, through a class the stylesheet never
styled. The nationality input becomes a `TextField`, so the error is a real field error: vermilion,
`aria-invalid`, `role="alert"`, wired by `aria-describedby`. The copy becomes the rule it is actually
enforcing. `.voy-error` is deleted rather than styled.

**G11 — saving an empty passport code does nothing at all.** The submit handler returns silently.
It now sets the same field error, so the form answers the way the create-trip dialog answers.

**G14 — invalid `<p>`-in-`<p>` nesting.** `Empty` wraps children in a `<p>`, and the no-journey state
passes it a paragraph and a link list. `Empty` wraps in a `<div>` carrying the same class; text-only
callers are unaffected.

### Web — navigation and recovery

**G3 — a reload or shared section link lands almost four screens short.** The hash-on-load effect
scrolls against the placeholder layout, and the deferred sections above the target then inflate and
push it down; measured 3,520px past the fold for `#section-ai`, with the nav marking Prepare current.
The chip handler already solves this. Its mount-all-then-scroll-on-the-second-frame body moves into
one function both paths call, and the load path also adopts the chip's `aria-current` update so the
URL and the nav agree.

**G4 — editing the destination leaves the visa answer stale.** The edit handler calls `reload()`,
which re-runs only the detail view's own query; the visa panel reads its own scope and is never told.
The handler names both scopes, as the import handler already does.

**G7 — a successful Retry leaves a banner claiming the engine is unreachable.** `useAsyncAction`
clears its error only when the next run starts, so nothing connects a recovered transport to it.
`reportTransportSuccess` gains a subscription: an action holding a `transport/failure` error drops it
when the transport is next known good. That reaches every `useAsyncAction` caller rather than the
four in this view.

**G8 — the same offline sentence twice, once with Retry and once without.** The action banner gets
the guard the load banner already has.

### Web — layout and forms

**G9 — the trip list scrolls sideways at 320px.** `minmax(19rem, 1fr)` — a grid floor never shrinks
below its minimum, so at any content width under 304px the track overflows. `minmax(min(19rem,100%),
1fr)`; nothing changes at wider sizes.

**G10 — four Prepare panels have no separator.** One rule on the section's adjacent siblings replaces
four copies, so a panel added later is separated by default.

**G12 — Review suggestions opens with its actions 826px below the fold.** The dialog body is 2,241px
in a 600px window, macOS overlay scrollbars leave no persistent affordance, and the only visible
control is the one that abandons the task. The body gets a scroll affordance — `scrollbar-gutter`
plus a bottom fade that clears when the body is scrolled to the end — so the dialog visibly
continues. Restructuring the evidence disclosure is a larger change and is not attempted here.

**G13 — a rejected create-trip submission leaves focus on the submit button.** Focus moves to the
first invalid control, which is what the planning form already does and what `e2e/planning.spec.ts`
already asserts for it.

## Sequence

Layer order, one commit per layer, closed with a merge commit:

1. `Docs:` this plan and the ADR-0006 amendment.
2. `Core:` G1.
3. `App:` the `entry_path` call site.
4. `Web:` visa cockpit — G2, G5, G6, G11, G14.
5. `Web:` navigation and recovery — G3, G4, G7, G8.
6. `Web:` layout and forms — G9, G10, G12, G13.
7. `Docs:` changelog and the four-file version bump to 0.6.1.

## Verification

Every gap has an acceptance check taken from its reproduction, written as a test before the fix:

- Core: `entry_path` returns `None` for an uncurated destination and `Some` with IRCC named for
  Canada, including the conditional and malformed-code branches.
- Web: a Vitest case per web gap, in the feature-named files the conventions call for —
  `visaPanel.test.tsx`, `sectionNav.test.tsx`, `errorStates.test.tsx`, `flowFixes.test.tsx`.
- `make check` for the gate.
- The browser reproduction from the audit re-run for each gap, at the viewport and theme that
  exposed it.

Not covered, and unchanged by this work: successful network retrieval (the integration server
hard-wires the offline fake), the packaged Tauri shell, vault and backup, AI assist, a second browser
engine, non-English locales, measured contrast, and real touch input.
