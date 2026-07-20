# Test strategy

## Required layers

- Rust unit tests for domain rules and redaction.
- API contract and migration tests.
- React component and accessibility tests.
- Live HTTP serialization tests for the vertical gateway journey. Browser-level
  Playwright coverage remains the next end-to-end layer.
- Fixture-based document extraction precision and recall.
- Retrieval relevance and citation-validity evaluations.
- Itinerary hard-constraint and timezone fixtures.
- Frozen desktop bundle startup and upgrade tests.

## Representative fixtures

Fixtures must cover multi-city and overnight travel, transit points, time-zone changes, accessibility and dietary constraints, duplicate confirmations, missing dates, conflicting booking facts, stale advisories, and malicious document instructions.

Synthetic identifiers and addresses are required. Real traveler documents are never committed.
