# Test strategy

## Required layers

- Rust unit tests for domain rules and redaction.
- API contract and migration tests.
- React component and accessibility tests.
- Live HTTP serialization tests for the vertical gateway journey.
- Playwright browser acceptance through the real loopback Axum + Vite stack for
  a disposable persisted trip, Today, traveler-owned planning, workspace
  search, trust settings, locale switching, and reload persistence.
  `scripts/check.sh integration` runs this layer after live HTTP serialization
  in CI.
- Fixture-based document extraction precision and recall.
- Retrieval relevance and citation-validity evaluations.
- Itinerary hard-constraint and timezone fixtures.
- Frozen desktop bundle startup and upgrade tests.

`make check` is the release gate and must remain the single source used by CI.
Targeted Vitest, Cargo, or Playwright commands are useful while iterating, but do
not replace the full gate. Pack publishing additionally runs the pure Node
publisher tests before any PMTiles extraction.

## Representative fixtures

Fixtures must cover multi-city and overnight travel, transit points, time-zone changes, accessibility and dietary constraints, duplicate confirmations, missing dates, conflicting booking facts, stale advisories, and malicious document instructions.

Synthetic identifiers and addresses are required. Real traveler documents are never committed.
