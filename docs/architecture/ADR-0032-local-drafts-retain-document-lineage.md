# ADR-0032 — Local drafts retain document lineage

**Status:** Accepted · 2026-10-29

## Decision

The lodging-dates draft sends each imported document in a separate on-device
Ollama request. The application retains that document's database identity beside
the request and validated proposals; model output cannot choose a document ID.
The existing closed reply shape rejects unknown fields, including attempted
source identities. Each parser run and its pending assisted candidates use the
same contributing document. No proposal becomes a confirmed fact automatically.

A run allows at most eight document calls, 12,000 cumulative Unicode characters
of assembled user content, and eight total proposals. Prepare and validate all
request bounds before dispatch; validate all replies before persistence. Exceeding
a bound refuses the whole run with no candidates saved. The existing preview
contract displays the separate document inputs and call count, while remaining
local-only and outside ADR-0029's immutable itinerary-assist approval path.

Persist the parser runs and candidates in one immediate transaction after
rechecking that every contributing document still belongs to the trip. Deletion
during model work refuses the whole save. Later source deletion follows the
existing document foreign-key lifetime; unrelated document deletion cannot erase
another source's candidates. No schema, migration, gateway or backup-format change
is needed.

## Verification

Use disposable SQLite, FakeFetcher and MemorySecretStore. Verify separate request
contents, parser-run/candidate identity, distinct-source deletion, multiple
proposals, empty/no-document runs, unknown-kind/source fields, malformed replies,
request/proposal bounds and atomic rollback on persistence failure. Pending status,
assisted method, empty model-derived field spans and local-only endpoints remain
required. These tests establish application lineage, not model extraction accuracy
or installed-webview acceptance.
