# ADR-0023: Journey requests share wire fixtures

Status: accepted, 2026-09-10

Extends ADR-0012 and verifies the traveler-owned lineage rules in ADR-0020.

## Decision

The route manifest verifies command names and wrapper keys but cannot detect
drift inside whole forwarded shared inputs. Add a small, hand-maintained JSON
fixture for the trip/import/amendment/restore/plan journey. Explicitly constructed,
typed calls through the real TypeScript Tauri gateway must emit these exact
command envelopes. The Rust desktop suite executes the same envelopes through
Tauri's command dispatcher against AppService and disposable SQLite, replacing
only synthetic record identifiers with IDs returned by earlier steps.

Assert actual response field names and values, persisted optional fields,
compare-and-swap rejection without mutation, append-only history, and calendar
lineage. This catches a field silently ignored by serde as well as a required
field that fails deserialization. Use the shipped offline fetcher and in-memory
secret store; the journey must never require a provider or OS keychain.

## Limits

This is source-runtime IPC coverage with Tauri's MockRuntime, not a running
installed webview. It does not prove OS packaging, native pickers, updater
behavior, or every shared type's field parity. The existing route guards and
live HTTP tests remain necessary. Installed-package serialization acceptance
remains separate. No transport, storage, public contract, or product rule changes.

No generated schema or new test framework is introduced. Fixtures are reviewed
alongside both consumers; they must not be regenerated from gateway code.
