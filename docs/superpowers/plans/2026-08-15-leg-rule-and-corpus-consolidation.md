# 2026-08-15 — Leg rule and corpus consolidation (0.10.8)

Base: `3eaadb0`.

Written after the work, not before it. AGENTS.md asks for the plan first; this
run went audit-first and wrote the plan when a council review found it missing.

## Scope

Three `/improve-userflow-design` passes and three `/improve-codebase-architecture`
passes were requested. One of each ran. See "What this did not cover".

## What shipped

### Web — trip-card controls name their trip

Each trip card renders Archive and Delete labelled with the bare verb, so a
screen-reader rotor over several trips reads "Archive, Delete, Archive,
Delete". The Open control in the same card already carried the title.

axe passes this surface and always did: every control has a name, and WCAG does
not require names to be unique. The guard added to `a11y.test.tsx` therefore
asserts naming directly rather than adding another axe run.

Visible labels unchanged; the accessible name opens with the visible word so
Label in Name stays satisfied. This does not make either action safer — Delete
already required typing a word into a dialog naming the trip, and Archive is
undone from a banner that names it.

**Known incomplete — six sibling sites, left for time, not for risk.** The edit
is mechanical and identical to the one made here: one prop plus two i18n keys
per site. `ConfirmButton` already accepts `ariaLabel`, and two call sites
already pass it — `ResourcesPanel.tsx:220` and `PlanningPanel.tsx:288` — so
there is nothing to design. Unfixed:

- `TripDetailView.tsx:177` — `FactCard`'s Remove and Unconfirm, once per
  confirmed fact. The most repeated of the set, and Remove is irreversible.
- `DocumentsPanel.tsx:135,138` — View/Hide, and a Remove whose own comment at
  :116 calls the deletion irreversible with a blast radius.
- `CandidateReviewDialog.tsx:240,249,257` — Confirm/Edit/Dismiss per candidate.
- `CityPacks.tsx:139`, `AiProviders.tsx:120`, `Recommendations.tsx:287`.

The new a11y guard is scoped to trip cards and will not catch any of them. The
seven widened `/^Archive\b/`-style queries elsewhere match the bare verb too,
so that one test is the whole naming guarantee right now.

### App — one owner for a trip's searchable corpus

`search_trip` and `chat_context` each read the same three record kinds and
rebuilt the same borrowed views. The second decides what an on-device model may
be grounded in, so drift between them would make a record searchable but not
citable, or the reverse.

The lifetimes are why it had been copied: `Searchable*` borrow from locally
owned buffers, so a helper returning the views cannot own what they point at.
`TripCorpus` owns the buffers and lends the views. Behaviour-neutral.

### Core — one definition of the leg time rule

`leg_times` is now the single reader of a journey leg's two stamps, replacing
three hand-written copies. Two definitions of `parse_datetime` became one:
`itinerary::parse_datetime` remains, because `detect_planned_item_conflicts`
needs it for planned-item start/end times, and `leg_times` calls it; the
byte-identical copy in `contingency.rs` is gone.

**This started as a behaviour change and was reverted to behaviour-neutral.**
The first attempt moved `arrival >= departure` into the shared rule on the
theory that the disruption plan had been wrong to accept an inverted leg. That
was wrong twice over:

- `validate_journey_times` (`types.rs:1161`) records the decision explicitly —
  "Deliberately no 'arrival before departure' rule" — and
  `journey_times_are_parsed_but_an_inverted_pair_is_not_refused` pins it.
- An eastbound date-line crossing (SYD 09:50 → LAX 06:25) legitimately lands at
  an earlier local wall clock. The change silently deleted a correct
  275-minute hand-off and its exposed leg, while the plan still rendered.

The evidence that motivated it was misread too: the "180 minutes / Ample"
figure came from `minutes_between(previous.arrival, inverted.departure)` — the
inverted leg's _departure_, which the inversion never touches. Three hours to
make a 17:00 flight after arriving at 14:00 is correct.

The ordering filter stays in `scheduled_legs`, where it belongs for its own
reason: the overlap checks treat a leg as a closed interval, and an inverted
interval reports overlaps that are not there.
`a_date_line_crossing_still_carries_its_connection` guards the disruption plan
against a repeat, and is the only test in 351 that catches it — which is why
the original mistake got as far as it did.

## What this did not cover

- One user-flow pass ran: trip list, create and its validation branch, trip
  detail, suggestion review, 320px, and recovery states, plus re-verification.
- One architecture pass ran, itself truncated — four of five planned lenses,
  and its verification stage was lost to a usage limit and redone by hand.
- Not opened live: Settings/vault/backup, workspace search and detour recovery,
  planning/itinerary, the visa cockpit, importing a new document.
- Neither skill's HTML report artifact was produced.

## Follow-ups

- The six accessibility sites above.
- `TripDraft` and `trip-draft.v1.schema.json` — a dead second trip-validation
  path with zero production callers, but a published versioned schema, so
  retiring it needs an ADR.
- An undecryptable vault reports as `storage/failure`, the same code generic IO
  failures use, so the UI says "Local storage is unavailable… Nothing was
  changed" with a Retry that cannot succeed. A distinct `ErrorCode` is a
  wire-contract change and needs an ADR.
- `mock.ts`'s itinerary overlap builders filter `flight_segment` only, while
  core's `scheduled_legs` covers every journey type except `CarRental`. A
  surface-journey overlap is a conflict in the engine and silent in the mock,
  and `parity/assess-trip.json` has no surface-journey case to catch it.
  Pre-existing, not from this release.
