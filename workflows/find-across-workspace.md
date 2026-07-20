# Find information across the workspace

Status: ready for implementation

## Trigger

The traveler opens workspace search from the trip-list screen and enters a query.

## Outcome

The traveler can find locally stored material across trips, with every result
showing which trip and source kind it came from.

## Confirmed behavior

- Workspace search covers source documents, confirmed facts, trip notes, saved
  places, and manual trip items. Pending candidates remain available through
  review, not search, so unapproved extraction does not masquerade as a result.
- Results carry trip id/title, source kind, source id, label, snippet, and the
  existing transparent occurrence score.
- Search is deterministic, bounded, Unicode-character validated, and entirely
  local. It performs no provider call and uses no embeddings in this release.
- Results rank by score, then trip update time, then stable identifiers for
  deterministic ties. Archived trips are included and visibly labelled.
- Selecting a result opens its trip and, where the current UI can target the
  source, moves focus to the relevant section. URL routing is not introduced.
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

## Definition of done

Workspace search is fast enough for the bounded local corpus, deterministic,
source-labelled, vault-aware, accessible, transport-complete, and documented.
