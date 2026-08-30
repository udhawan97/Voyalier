# Workspace-search continuity plan

**Date:** 2026-08-29
**Status:** Approved for implementation by the owner's request to build and merge the next phase

## Why this is next

Trip search now revokes stale work as soon as the query changes and keeps an
exact source handoff alive while a local source list is still loading.
Workspace-wide search predates those guarantees. It clears visible hits when a
traveler edits, but it does not invalidate the older `useAsyncAction` run until
the replacement debounce fires. Its cross-trip handoff also polls for one
second, then silently focuses a broad section even when the exact document,
resource, or note is merely slow to load.

This is the next bounded, code-owned slice because it composes existing search,
navigation, and local-list seams. It adds no provider, storage migration,
contract method, route, background action, or authority claim.

## Product outcome

- Editing a workspace query immediately supersedes the prior request, including
  its late success, late failure, busy state, and transport-recovery ownership.
- Opening a workspace result continues to the exact confirmed fact, trip item,
  saved place, trip notes, source document, or research resource.
- Slow local note/document/resource lists announce that the handoff is still
  active and focus the exact record whenever it becomes ready.
- A result deleted after the search falls back to its owning section with an
  honest localized notice; a panel load error keeps its own visible error rather
  than being misreported as deletion.
- Search text and record identifiers remain outside the URL. Opening a result is
  read-only and does not fetch source content or mount unrelated deferred work.

## Test seams

Tests exercise the rendered `WorkspaceSearch` and `TripDetailView` journey
through an injected public `AppGateway`. Assertions observe only traveler-visible
results, errors, live announcements, URL state, and focused elements. Gateway
methods are controlled only at the system boundary to model an old request, a
slow local list, a failed local list, or a record removed after search.

## Vertical slices

1. Add a failing search-intent test where an old failure lands during the next
   query's debounce. Invalidate the action synchronously with the edit and when
   leaving Search.
2. Add a failing slow-resource handoff test past the former one-second retry
   window. Route workspace targets through the shared continuity navigator and
   keep polling at the existing low cadence until the owning list is terminal;
   the shared navigator's existing trip-search test retains the beyond-ten-second
   coverage.
3. Add a failing missing-saved-place test. Extend exact-record continuity to all
   workspace source kinds and add localized, source-specific fallbacks.
4. Cover slow trip notes and panel-error behavior if the earlier slices expose
   different ownership states. Add `data-continuity-state` only to the owning
   panel, not to unrelated sections.
5. Synchronize the changelog, workflow guide, roadmap, and public planning/search
   guide with the verified behavior.

## Discovery during implementation

The public `AppGateway` mock omitted saved research from `searchWorkspace`, even
though the Rust `AppService` and core corpus already search it. The mock is a
shipped development seam, so the phase adds a parity test and mirrors the
existing Rust text projection: title, traveler note, tags, snapshot description,
and snapshot text are searchable; the resource URL remains excluded. This is no
production corpus, ranking, route, or contract change.

## Verification

- Focused Vitest red/green runs for workspace search and affected continuity
  journeys.
- Web typecheck, lint, formatting, and production docs build.
- `./scripts/check.sh` and `git diff --check`.
- Production dependency audit, credential-shaped string grep, locked Cargo
  metadata, Graphify incremental refresh, and a scoped graph query.
- Exactly two four-role council rounds, with targeted blocker acceptance if a
  Round 2 correction materially changes the reviewed result.
- Fast-forward merge to `main`, push, and exact-SHA hosted check verification.

## Non-goals

- No FTS5 or embedding index.
- No production search contract, transport, ranking, or corpus change.
- No new provider, network call, background search, monitoring, or source fetch.
- No version bump, tag, installer, release, or signing work.
