# Journey continuity implementation plan

Voyalier already keeps the records this work needs: confirmed facts, traveler-authored plans,
redacted briefs, imported evidence, and explicit review. The gap is continuity between those
surfaces. This plan deepens the existing records into selective local sharing, a deterministic
day-by-day board, repeatable calendar snapshots, and conservative amendment review. It does not
add a provider, hosted collaboration, background monitoring, booking, price, availability, route,
or authority claim.

## Product and architecture boundary

- `voyalier-core` owns the Journey Board and calendar projections, their identity roles, ordering,
  omission rules, and conservative amendment matching.
- `voyalier-app` owns the append-only fact lineage, SQLite migration, fresh-version guard, and the
  transaction that replaces or restores an active fact.
- Existing `getTrip`, `getTripBrief`, import, candidate-review, and fact actions remain the product
  seams. Only amendment restoration needs a new method through both transports.
- Share and calendar outputs are built from redacted projections. Confirmation codes, traveler
  names, imported document bodies, notes, and resources never enter them.
- Calendar output remains a downloaded snapshot. It never claims subscription, synchronization,
  deletion in another calendar, time-zone resolution, or duplicate prevention by a calendar app.
- An amendment is proposed only from exact local evidence. Missing, multiple, or uncertain matches
  stay ordinary candidates and never overwrite anything.
- Keyboard order, focus restoration, visible focus, non-color meaning, reduced motion, contrast,
  English and Spanish, and 200% zoom/reflow remain gates.

ADR-0020 records the additive contract, storage, identity, and history decisions before code.

## Phase 0 — current resource truth

Audit current public and product documentation for claims that Voyalier stores dropped resource
files. The shipped resource form stores links; `ResourceKind.file` remains a dormant compatibility
value. Narrow current-tense claims, add an Unreleased correction, and leave historical ADRs,
release notes, and implementation plans intact. Add a scoped documentation assertion that permits
clearly future-gated file-wallet language.

## Phase 1 — selective redacted Copy and Print

Keep Full redacted as the default share view and add an opt-in Essentials view containing confirmed
flights, stays, and surface journeys but not traveler-authored activities. The dialog itself is the
print preview; a separate plain-text preview shows exactly what Copy writes. Both consume a selected
`TripBrief`, never raw facts. Tests pin default continuity, exact exclusion, clipboard behavior,
print selection, localization, focus, and failure states.

## Phase 2 — deterministic Journey Board

Add an IO-free core projection over active confirmed facts plus traveler-authored items:

- departure and arrival stay separate events on their recorded local dates;
- check-in is inclusive, every night before checkout gets `staying_tonight`, and checkout is its
  own event with no invented stay after it;
- dated authored items use their recorded start date; missing or invalid dates go to Unscheduled;
- entries outside the trip window go to Before trip or After trip rather than being dropped;
- same-time ties sort by kind, source, then a dedicated opaque focus locator;
- no merging, time-zone inference, route optimization, travel-time inference, availability, or
  live status.

Render the result as a compact itinerary spine above the existing evidence and planning editors.
Opening an item focuses its owning card and returning focus lands on the triggering Journey Board
control. Map behavior remains unchanged; the board never routes or reorders anything.

## Phase 3 — stable repeatable calendar snapshots

Replace the index-based web exporter with a redacted core projection. Confirmed fact lineages and
traveler-authored items receive opaque calendar lineages and monotonic revisions. Each source has
explicit roles (`departure`, `arrival`, `checkin`, `checkout`, or `plan`) so a multi-event record is
matched deterministically across versions.

Revision comparison is over canonical semantic event content only. `UID`, `SEQUENCE`, `DTSTAMP`,
export time, property order, line folding, and serialization format are excluded. Existing roles
keep UIDs; new roles get new UIDs; roles removed by an amendment appear in the preview as removals.
Unscheduled records appear as omissions. The `.ics` remains floating wall-clock output with no
`TZID` or inferred offset and carries explicit one-shot warnings.

Tests cover insertion/reordering, unchanged output, semantic revision increments, multi-role
amendments, removed roles, surface journeys, CRLF injection, Unicode folding, all-day records,
overnight travel, backup/restore identity continuity, and client-facing limitation copy.

## Phase 4 — explicit amendment review

Add conservative import-time classification:

- same trip and fact type;
- a non-empty exact normalized confirmation code;
- exact conservative operator/property and route context where present;
- exactly one active match.

An unchanged match is a duplicate/no-op and produces no review candidate. A changed single match is
stored as a possible amendment. Shared codes, missing context, or multiple matches stay ordinary
candidates; the initial slice does not group multi-segment reservations.

The review card shows an escaped current/imported diff and requires Replace, Keep both, or Dismiss.
Replace is a fresh-version-guarded transaction: the old version becomes inactive, the new version
inherits its lineage, revision increments once, and both records and their evidence remain. Keep
both starts a new lineage. Undo writes a compensating restore version; it never deletes or mutates
history. Only active facts feed readiness, Today, search, brief, Journey Board, and calendar.

## Verification and integration

Focused checks run after each layer, followed by:

1. Rust core/app tests, web feature tests, route parity, and live integration.
2. Backup/restore and migration retry tests against legacy and current schema shapes.
3. Keyboard, screen-reader naming, 320–1440 px reflow, reduced motion, and print checks.
4. `pnpm audit --prod` and the credential-string scan from `security-hygiene.yml`.
5. `graphify update .` and one scoped query over the changed symbols.
6. `make check`, `./scripts/check.sh integration`, and `git diff --check`.
7. The required two-round evidence/coverage/risk/outcome council; resolve every valid blocker.
8. Rebase the verified branch on current `origin/main`, integrate with a `Merge:` commit, and push
   `main`. No tag, release, or deployment is authorized by this plan.

## Commit order

1. `Docs: plan journey continuity`
2. `Docs: align current resource claims`
3. `Web+test: select redacted brief output`
4. `Core+contract: derive the Journey Board`
5. `Web+test: render the Journey Board`
6. `Core+app: persist itinerary event identity`
7. `Contract+web: export stable calendar snapshots`
8. `Core+app: classify and retain fact amendments`
9. `Contract+desktop+web: review and restore amendments`
10. `Test: close journey continuity gates`
11. `Merge: journey continuity`
