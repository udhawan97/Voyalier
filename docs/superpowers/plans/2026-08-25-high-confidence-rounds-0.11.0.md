# High-confidence feature rounds and 0.11.0 plan

Voyalier already carries the durable records needed to help a traveler move from discovery to a
usable plan: saved places keep coordinates and provenance, packing items keep traveler-owned
completion state, and the share brief is redacted in Rust before the web view receives it. The
remaining high-confidence work is therefore composition, not another provider, database table, or
authority claim. This plan adds one bounded feature, then repeats the same evidence gate for two
more rounds before refreshing the public surface and publishing 0.11.0.

## Product and architecture boundary

All product-code changes stay in `apps/web` and reuse `TripDetail.savedPlaces`, `PackingItem`,
`TripBrief`, the existing `AppGateway`, and the existing map/Plan/share surfaces.

- No gateway method, route-manifest row, Tauri command, Axum handler, migration, sealed column,
  provider, model prompt, city-pack schema, or source license changes.
- A saved place remains a traveler shortlist entry, not a booking or schedule item. Mapping it does
  not assert hours, availability, price, access, or safety.
- Packing suggestions remain proposals that require individual acceptance. Progress is calculated
  only from traveler-owned packing items, and filtering never changes or deletes an item.
- Brief copy uses only the redacted `TripBrief` returned by core. Confirmation codes, traveler names,
  imported document text, private trip-item notes, and resource content never enter the formatter.
- Clipboard access happens only on the explicit Copy action. An unavailable or denied clipboard is
  reported without claiming success or falling back to a hidden network or persistence path.
- Existing English and Spanish localization, keyboard behavior, reduced motion, contrast, and 200%
  zoom/reflow remain release gates.

No ADR is required: the versioned contract, transport, storage, provider, and trust boundaries do
not change.

## Round 1 - Put the traveler's shortlist on the map

Decision: make the consent-opened trip map distinguish places the traveler saved from unsaved
recommendations. Saved coordinates already live on `TripDetail`, so the map receives them from its
parent rather than refetching or recomputing them. A place that appears in both sets is plotted once
as saved. A saved place remains mappable after its source pack is removed because the kept record
already carries its name, coordinates, source, and license.

Acceptance:

- Before Show map, no map library, tile, recommendation, or offline-map request runs.
- After the explicit click, saved places render even when recommendation loading fails.
- Identical saved/recommended points are deduplicated by the existing normalized identity plus exact
  coordinates; the saved state wins.
- Saved and suggested markers have distinct, theme-aware styles and a visible text legend.
- A semantic point list names each mapped place and whether it is saved or suggested, so meaning is
  not available only through color or the canvas.
- Offline-map behavior, online consent copy, attribution, zero-duration fit, and WebGL failure
  recovery remain unchanged.

Focused verification: `mapPanel.test.tsx`, a saved-place-with-removed-pack case, a recommendation
failure case, deduplication, no-preconsent calls, and the existing WebGL recovery tests.

## Round 2 - Make the packing checklist readable at a glance

Decision: calculate an honest progress line from persisted packing items and let the traveler hide
checked items locally. The default continues to show every item. The filter is view state only; it
does not write to storage and does not reinterpret deterministic packing suggestions.

Acceptance:

- Progress says how many traveler-owned items are packed out of the total and updates after a check,
  uncheck, add, rename, or removal refresh.
- Hide packed is available only when there is something checked, has an explicit label/state, and
  leaves unchecked items in their stable order.
- When every item is hidden, the section says everything currently listed is packed and offers Show
  packed; it never reads as a trip-readiness or safety claim.
- Suggestions retain individual Add actions and are excluded from the progress denominator until
  accepted.
- Failure placement, retry behavior, destructive confirmation, keyboard order, and narrow-layout
  wrapping remain intact.

Focused verification: `planningWorkflows.test.tsx` for initial progress, live update, suggestion
exclusion, filtering, all-hidden recovery, and localized accessible labels.

## Round 3 - Copy the redacted brief without widening its trust surface

Decision: add Copy brief beside Print / Save as PDF. A small pure formatter turns the existing
redacted `TripBrief` into readable plain text using the same localized titles, fields, dates, and
plan labels as the dialog. The UI writes that text to the clipboard only after the traveler asks.

Acceptance:

- The formatter includes route, title, dates, flights, stays, and scheduled traveler-authored plans
  that exist in `TripBrief`.
- It cannot include confirmation codes, traveler names, imported document text, resources, or
  private plan notes because those fields are absent from the formatter input; tests pin the
  generation-time exclusion boundary.
- Successful copy is announced and reflected in the visible button label.
- Missing or denied clipboard access shows an honest in-dialog status and keeps Print / Save as PDF
  available.
- Copy is disabled until the brief has loaded and does not trigger another gateway request.

Focused verification: `brief.test.tsx` plus pure formatter cases for full, partial, empty, localized,
and redaction-boundary outputs.

## Public-surface refresh and release

After all three rounds pass focused checks:

1. Verify the current app against disposable data and capture only public-safe demo states.
2. Refresh the README, website, guides, screenshots/metadata, download wording, and changelog where
   the verified 0.11.0 behavior changes the story; retain the Quiet Journey visual system.
3. Bump all five version surfaces to 0.11.0, run `cargo update --workspace`, and add user-facing
   release notes. No platform, signing, notarization, updater, or artifact claim is added without
   current proof.
4. Run focused suites, `./scripts/check.sh`, integration/Playwright journeys, production audit,
   credential-string scan, `git diff --check`, responsive/reduced-motion browser checks, and
   Graphify update plus a scoped query.
5. Run the exact two-round council with evidence, coverage, risk, and outcome reviewers. Resolve all
   valid blockers and rerun affected checks.
6. Re-fetch `origin/main`, bring the integration branch current, push it, merge through protected
   `main`, and wait for required checks on the exact merge SHA.
7. Create an annotated `v0.11.0` tag only from the verified `main` SHA, trigger the protected release
   workflow, approve the environment when required, and verify the public release, DMG/EXE/MSI,
   signatures, `latest.json`, per-platform checksums, updater metadata, city-pack compatibility, and
   live docs. Draft or incomplete artifacts do not count as a release.

## Main-cleanup boundary

- Integrate the current green UUID and JavaScript dependency candidates and the one narrow Visa
  accessibility-budget commit rescued from the stale branch.
- Treat the old jsdom PR as already present only after current manifests/lockfile prove version
  equivalence.
- Preserve all dirty Claude worktrees and their branches. In particular, do not absorb the vault
  error-code work, Visa-panel edits, or public-holiday edits into this release.
- Remove only refs proven ancestor-merged or patch-equivalent after the remote `main` contains the
  final work. Open PR branches and dirty-worktree branches remain protected.

## Commit order

1. `Docs: plan high-confidence feature rounds`
2. `Web+test: map the traveler shortlist`
3. `Web+test: show packing checklist progress`
4. `Web+test: copy the redacted trip brief`
5. `Docs: refresh the 0.11.0 public surface`
6. `Deps: record the 0.11.0 version`
7. `Merge: high-confidence feature rounds`
