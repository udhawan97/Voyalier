# Today and disruption continuity plan

Voyalier already turns confirmed facts and traveler-authored trip items into two useful projections:
Today says what is happening now or next, and the disruption panel states which commitments are
stacked behind another. Disruption preserves source record ids in Rust, while Today discards that
identity as it builds each line; neither interface lets the traveler return to the owning record.
This phase closes those dead ends without turning either projection into a booking, monitoring, or
authority surface.

## Product and architecture boundary

- Today remains deterministic, local, and caller-dated. It never fetches, monitors, predicts, or
  changes a record.
- The disruption panel continues to state exposure only. Focusing a confirmation does not assert
  that a connection is invalid, an alternative exists, or a carrier will help.
- A confirmed fact and a traveler-authored trip item remain separate evidence lanes. Navigation
  must carry the source kind as well as the record id; it must never infer one from an item label.
- The new Today response field is optional and additive for backwards compatibility. Current core
  and mock projections populate it for every item they build.
- No migration, sealed column, gateway method, route-manifest row, provider, model prompt, network
  request, source license, or remote consent surface changes.
- Amend ADR-0005 before the contract edit. It already owns the decision that trip items may appear
  in Today while remaining separate from confirmed evidence.
- Exact record ids remain transient local navigation state. They do not enter the URL, history,
  clipboard, logs, screenshots, or durable settings.

## Slice 1 - Let Today return to its source

Add an optional `target` to `TodayItem`, containing a source discriminant (`confirmed_fact` or
`trip_item`) and the local record id. Rust core attaches the confirmed fact id to departures,
arrivals, check-ins, check-outs, and staying-tonight lines, and the trip-item id to traveler-authored
activities, rail journeys, and transfers. The mock mirrors the same projection.

Acceptance:

- Every item emitted by the current core and mock has one target with the correct source kind and
  id, including the single `next` anchor.
- The target carries no confirmation payload, traveler text, notes, or new source claim.
- Today renders a visible, localized action only when a target exists, so an older compatible
  gateway response remains readable.
- Activating a current target uses TripDetailView's existing exact-record navigation. A removed
  record focuses the owning Plan heading and announces the existing honest unavailable message.
- Keyboard focus lands on the exact confirmed-fact or trip-item card; record ids never enter the
  address bar.

Focused verification: core Today tests, mock parity through `todayPanel.test.tsx`, exact fact and
trip-item focus, removed-record fallback, English and Spanish action names, and URL privacy.

## Slice 2 - Let disruption evidence return to the confirmation

`Handoff`, `ExposedLeg`, and the carrier-on-confirmation pointer already carry confirmed-fact ids.
Pass one focus callback into `DisruptionPanel` and expose localized record actions beside those
lines. Alternate-airport and diplomatic-mission pointers remain plain text because they do not own a
confirmed fact.

Acceptance:

- A handoff can focus each of its two confirmations; an exposed leg and carrier pointer can focus
  their one confirmation.
- Actions are named from the source/traveler label already rendered, not from a raw id, generic
  "Open", or inferred authority language.
- Missing records use the same Plan-heading fallback and announcement as schedule-conflict
  navigation.
- Existing advisory copy, ordering, readiness isolation, and absence of external links remain
  unchanged.
- Repeated controls satisfy Label in Name, keyboard order, 320-pixel reflow, 200% zoom, Spanish,
  and reduced-motion expectations.

Focused verification: `disruptionPanel.test.tsx` for both sides of a handoff, exposed/carrier
actions, pointer exclusions, exact focus, missing-record fallback, and unchanged advisory language.

## Verification and delivery

1. Commit this plan before implementation.
2. Amend ADR-0005, then add failing core, mock/UI, and disruption tests.
3. Implement core and contract before the web continuity actions.
4. Run focused Rust and Vitest suites, then `make check`, integration/Playwright when the changed
   journey requires it, `pnpm audit --prod`, the repository credential scan, locked Cargo metadata,
   and `git diff --check`.
5. Refresh Graphify and verify one scoped query against the changed paths.
6. Run the required two-round, four-seat council. Resolve every valid blocker before integration.
7. Commit in layer order, merge the verified branch into `main`, and push `main`. This phase does
   not authorize a version bump, tag, GitHub release, signed artifact, deployment, or public docs
   publication.

## Commit order

1. `Docs: plan Today and disruption continuity`
2. `Core+contract+docs: preserve Today source targets`
3. `Web+test: open the records behind continuity lines`
4. `Merge: Today and disruption continuity`
