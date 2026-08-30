# Find information across the workspace

Status: implemented and verified

## Trigger

The traveler opens workspace search from the trip-list screen and enters a query.

## Outcome

The traveler can find locally stored material across trips, with every result
showing which trip and source kind it came from.

## Confirmed behavior

- Workspace search covers source documents, confirmed facts, trip notes, saved
  places, manual trip items, and saved research. Saved-research matching uses
  the title, traveler note, tags, and fetched snapshot text, never the URL.
  Pending candidates remain available through review, not search, so unapproved
  extraction does not masquerade as a result.
- Results carry trip id/title, source kind, source id, label, snippet, and the
  existing transparent occurrence score.
- Search is deterministic, bounded, Unicode-character validated, and entirely
  local. It performs no provider call and uses no embeddings in this release.
- Results rank by score, then trip update time, then stable identifiers for
  deterministic ties. Archived trips are included and visibly labelled.
- Selecting any result opens its trip and moves focus to the exact local record.
  A slow note, document, or resource read announces that the handoff remains
  active and completes when ready. If a record disappeared after search, its
  owning heading receives focus with an honest localized notice; a panel error
  keeps its own visible error and is not described as deletion.
- Editing the query immediately supersedes the older request, including its late
  success, failure, busy state, and transport-recovery ownership. Search text and
  exact record identifiers remain outside the URL.
- Empty, short, busy, error, and no-result states are accessible and explicit.

## Boundaries

- Search ranking is relevance to the query, not importance or travel advice.
- Sealed text is opened only through the normal records path after vault unlock;
  a locked vault fails closed rather than returning partial sensitive snippets.
- No new search index or background daemon is introduced. A future FTS5 change
  may replace internals without changing the contract.

## Checkpoint

None. Search is read-only. Opening a result is an ordinary navigation action.

## Verification

- Core tests use literal mixed-source corpora and deterministic tie cases.
- `AppService` tests cover multiple trips, archived trips, deleted records, lock
  behavior, and source labels through the public search method.
- Contract, route, live HTTP, mock, React, and browser tests cover the same query.
- React public-seam tests cover replacement-query races, exact focus, slow local
  reads, panel failures, missing records, localized announcements, URL privacy,
  and selective deferred mounting.

## Definition of done

Workspace search is fast enough for the bounded local corpus, deterministic,
source-labelled, vault-aware, accessible, transport-complete, and documented.
