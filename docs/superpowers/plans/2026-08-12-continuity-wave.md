# Trip continuity wave plan

The current trip page already knows which readiness category needs attention, which records a
schedule conflict names, and which stored document caused a duplicate import. It does not carry
those answers into the next action: readiness is passive, planned-item conflicts cannot jump to
their records, duplicate imports stop at a warning, and a long review queue cannot be narrowed.
This wave closes those continuity gaps with existing local data and deterministic UI behavior.

## Product and architecture boundary

All product-code changes belong to `apps/web` and reuse the existing `AppGateway` methods and
versioned types:

- Readiness actions route to the existing Plan, Prepare, Visa, schedule, or review surfaces. They
  do not reinterpret a finding or clear readiness, and official entry/health links remain intact.
- Conflict jumps use only the `factIds` and `plannedItemIds` already returned by the deterministic
  core assessment. Record identifiers remain transient DOM lookup values; they are never shown,
  announced, logged, or placed in the URL.
- Duplicate recovery uses `document/duplicate.details.existingDocumentId` to focus the existing
  collapsed document summary. The body remains sealed and unfetched until the traveler explicitly
  chooses View. A missing detail or stale row falls back to Prepare with an honest announcement.
- Review triage filters the in-memory pending queue by warnings, fact type, and extraction method.
  Confirm, edit-and-confirm, and dismiss remain one-candidate actions; no bulk resolution is added.
- Deferred sections are mounted through the shipped `DeferredMountProvider` seam before a focus
  handoff. The handoff retries boundedly for panels that load their local lists asynchronously,
  then focuses a named heading instead of silently doing nothing. The navigator is rendered as a
  child of the provider, cancels timers on unmount or target replacement, and uses a request token
  so rapid actions cannot land on an obsolete target.
- No contract method, route, transport payload, persistence rule, migration, provider, AI path, or
  authoritative visa/health/booking behavior changes. No ADR is required.

## Feature decisions and acceptance checks

### F1 - Actionable readiness and complete conflict jumps

Decision: give non-clear deterministic checks a contextual navigational action, and always give the two
link-only checks an in-product preparation action alongside their official links. Schedule
conflicts route to the schedule review (or Plan when no schedule exists), lodging to Plan, pending
suggestions to the existing review dialog, entry requirements to Visa, and health notices to
Prepare. Schedule findings expose jumps for every named confirmed fact and planned item.

Acceptance:

- Each action is a real keyboard-visible button with translated English and Spanish copy.
- Labels are destination-oriented (`Review schedule`, `Open visa preparation`, and `Open trip
  preparation`), never claims to resolve, complete, make safe, or determine eligibility or health.
- Pending review opens the same one-at-a-time review dialog, returns to the readiness action on
  Close or Escape, and retains the stable Blueprint return after the final candidate is resolved.
- Section actions mount deferred content, scroll, and focus a meaningful named heading or region.
- Fact and plan jumps focus the exact existing card; planned-item labels use the traveler-authored
  title when carried by the conflict and a translated generic fallback otherwise. A stale record
  focuses a named Plan heading and announces that the item is unavailable without exposing its ID.
- Readiness status, finding prose, official links, self-reported visa progress, and the product
  disclaimer are unchanged.

### F2 - Duplicate import recovery

Decision: add an Open existing document action to the duplicate banner. The trip page closes the
import dialog, mounts Prepare, and focuses the matching document summary. When the engine omits the
existing ID, the action becomes Go to imported documents and lands at Prepare instead.

Acceptance:

- A duplicate with an existing ID closes the dialog and focuses that exact document summary.
- The document body is not fetched or expanded by the navigation; a gateway spy must prove that
  `getDocument` is not called.
- An empty/malformed missing ID or vanished row lands on the named imported-documents heading and
  announces the limitation.
- The modal-to-page focus handoff wins after the closing dialog's deferred focus restoration.
- No internal document ID appears in visible copy, an accessible name, a URL, or an announcement.
- Existing duplicate focus/error behavior and ordinary import/review handoff remain intact.

### F3 - Review queue triage

Decision: add local filters for `Has extraction warnings`, fact type, and extraction method above
the queue.
Show both the unresolved total and filtered result count. Resolving a visible card focuses the next
visible primary action; if the filter has no remaining match, focus returns to the filter controls.
A no-match state offers Reset filters while preserving unresolved candidates.

Acceptance:

- Filters combine deterministically and never call the gateway.
- All six fact types and four extraction methods have translated labels; the existing
  `factTypeLabel` helper becomes exhaustive before it supplies the options.
- Every new filter, count, no-match, reset, action, fallback, and announcement string exists in
  both English and Spanish.
- No-match and all-resolved states are distinct; Reset filters restores the full pending queue.
- Confirm/edit/dismiss remain per-card, the remaining count updates live, and keyboard focus never
  escapes to a removed card or behind the dialog.
- Existing error banners continue to preserve candidates when a resolution fails or races.
- A failed or concurrently raced resolution remains in the local queue with its error available
  when its filter is restored; no optimistic disappearance occurs on failure.

### Responsive and assistive acceptance

- At 320px and 200% zoom-equivalent reflow, readiness actions/official links, schedule jumps, and
  the review filter strip wrap without root or dialog horizontal overflow.
- The review dialog body, filter controls, candidate actions, and footer remain keyboard reachable;
  focus order and accessible names remain coherent after filtering and resolution.
- New behavior adds no motion. Existing reduced-motion, contrast, and current-state semantics are
  preserved.

## Test-first sequence and commits

1. `Docs:` commit this plan before product implementation.
2. `Test:` add focused failing cases for readiness routing, planned-item and stale conflict jumps,
   duplicate recovery/missing-row behavior, collapsed document privacy, combined queue filters,
   no-match recovery, live counts, and post-resolution focus.
3. `Web:` add the bounded focus navigator, readiness/conflict actions, duplicate banner action,
   queue filters, exhaustive fact labels, translated copy, and scoped styles.
4. `Docs:` record the user-visible continuity improvements under `CHANGELOG.md` Unreleased without
   a version bump, tag, release, or deployment claim.
5. Refresh Graphify and verify a scoped query. Run focused Vitest suites, `make check`,
   `git diff --check`, `pnpm audit --prod`, and the repository credential-string scan.
6. Run the required two-round four-role result council, address valid findings, rerun affected
   gates, inspect the complete diff, and require the feature branch to contain current
   `origin/main` before merging.
7. Close the branch with `Merge: trip continuity wave`, merge into `main` without force, push
   `main`, fetch, and verify local HEAD, `origin/main`, and `git ls-remote` agree. Wait for the exact
   SHA's required GitHub checks. Do not tag, create release assets, or trigger a deployment.

## Verification boundary

Durable evidence comes from feature-named Vitest/Testing Library cases, the full web/Rust/desktop
gate, Graphify refresh, dependency audit, credential scan, and exact remote-SHA verification.
Semantic tests cover focus and collapsed-body behavior. Before merge, a supplemental Safari pass
against disposable data must exercise keyboard navigation, a 320px viewport, and 200% zoom reflow
for the three changed surfaces. This does not imply manual screen-reader listening, physical touch,
native packaged-Tauri, Windows, or release acceptance. Chromium is not required for this UI-only
wave.

Not expanded by this plan: new providers, booking actions, hosted services, entry or health
decisions, document-body prefetching, bulk candidate resolution, contract/schema changes, version
bumps, tags, release artifacts, or unrelated audit findings.
