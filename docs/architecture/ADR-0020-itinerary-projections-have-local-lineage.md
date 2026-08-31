# ADR-0020 — Itinerary projections have local lineage

**Status:** Accepted · 2026-08-31

## Context

Voyalier stores two kinds of itinerary material: evidence-backed confirmed facts and
traveler-authored plans. Today, the trip view renders them in separate sections; the Today view
projects only one reference date; and the web calendar exporter reconstructs events from a
redacted brief using array positions as identifiers. Inserting an earlier flight changes every
later UID, and scheduled rail, coach, ferry, and car facts do not enter the file at all.

Repeat imports have a separate continuity problem. Exact document bytes are deduplicated, but a
new confirmation for the same reservation becomes an unrelated pending candidate. Confirming it
creates a second active fact. There is no explicit amendment choice and no retained relationship
between versions.

The tempting answers all cross a product boundary: calendar subscription requires an external
long-lived surface; inbox monitoring requires background access; fuzzy overwrite rules can destroy
approved evidence; and time-zone inference would turn incomplete wall-clock text into a claim.

## Decision

### 1. Journey Board and calendar are deterministic projections

`voyalier-core` derives both views from local records. They perform no IO and never enter readiness.
Journey Board groups literal recorded dates into Before trip, trip days, After trip, and
Unscheduled. Calendar projection emits only redacted event fields and explicit omissions/removals.

The Journey Board carries a dedicated opaque focus locator. Calendar carries a different opaque
lineage and an explicit event role. Neither exposes a SQLite row position, and neither identity is
reused for the other purpose.

### 2. Calendar identity belongs to a logical event role

A source record can produce more than one event. Confirmed travel uses `departure` and `arrival`;
stays use `checkin` and `checkout`; authored plans use `plan`. UID is the source's opaque calendar
lineage plus the role. Reordering, inserting another record, or replacing a fact does not change it.

`SEQUENCE` is monotonic per logical role, not per source record. For confirmed facts it is derived
from the append-only version lineage; authored plans keep their own semantic revision and timestamp
in the identity sidecar. Whether a role increments is decided by a canonical semantic event
projection: role, kind, subject, location/detail, start/end value, and
all-day state. UID, sequence, DTSTAMP/export time, property order, line folding, and serialization
format are not semantic content and cannot trigger themselves. Newly appearing roles get new UIDs;
removed roles are reported in the preview because a downloaded file cannot remove an event already
imported into another application.

Projection identity is required. Missing, duplicate, or incomplete sidecars fail the trip read with
a repairable storage error; calendar UIDs and Journey Board locators never fall back to row ids.

Times remain floating local wall-clock values. No `TZID`, `Z`, offset, or DST rule is inferred.
This is a repeatable downloaded snapshot, not synchronization or duplicate prevention.

### 3. Confirmed facts form an append-only lineage

An `itinerary_identities` sidecar gives confirmed facts and trip items an opaque calendar lineage
and an opaque UI locator without placing transport or UI concerns inside either domain record.
Existing rows receive freshly assigned identities; insert/delete triggers keep sidecar lifecycle
atomic. A trip-item role revision and semantic timestamp increment atomically with only a canonical
calendar change. `confirmed_facts` remains a current-only compatibility table. Prior approved
snapshots live in a separate sealed `confirmed_fact_versions` table so opening the database with an
older reader cannot display history as duplicate current reservations. A persistent delete trigger
fails closed when that reader attempts to unconfirm a lineage with retained history, while trip
deletion still cascades through both tables.

Normal product reads return active facts. Trip detail also returns inactive history explicitly so
the traveler can inspect prior approved evidence; downstream readiness, Today, search, brief,
Journey Board, and calendar projections read only active facts.

### 4. Amendment matching is conservative and review-owned

A parsed candidate is a possible amendment only when one active fact on the same trip has the same
fact type, exact normalized non-empty confirmation code, and conservative matching
operator/property and route context. There must be exactly one match. No match, several matches,
missing identifiers, or uncertain context produces an ordinary candidate. The first version does
not group multi-segment records that share a code: more than one same-type active fact with the code
is ambiguous before route narrowing.

An exactly unchanged match is a duplicate/no-op. A changed match records the proposed active fact
id. Confirmation in the current UI requires the traveler to choose Replace or Keep both. An older
consumer that omits the additive action safely defaults to Keep both. Replace reclassifies the final
edited payload against freshly read active facts inside the transaction, requires the exact active
fact id and revision the traveler reviewed, checks the affected row,
appends the prior current snapshot to history, and updates the compatibility row without changing
its opaque identity. Keep both starts a new lineage. Dismiss resolves only the candidate. Undo
requires the same reviewed-current compare-and-swap and appends a compensating Restore version; it
never deletes or rewrites history. A source-removed historical version retains its evidence
tombstone, but its restored current row cannot revive a dangling candidate foreign key.

The existing Back to review action remains available for an initial fact and keeps its existing
behavior. Amendment history itself is append-only; restoration is the only amendment undo path.

### 5. The wire contract is additive; the schema is downgrade-tolerant

The hand-written Rust/TypeScript contract gains optional amendment and lineage fields, Journey
Board/calendar projections on `TripDetail`, and one `restoreFactVersion` method through AppService,
Axum, Tauri, both gateways, the mock, and `parity/routes.json`. Older consumers can ignore the
additive fields and an omitted amendment action keeps the old, non-destructive create-another-fact
behavior. The current-fact table remains readable as one row per reservation lineage; history is
isolated in a new table. No existing route or enum value changes meaning.

## Consequences

- The database receives retry-safe append-only identity, history, and downgrade-safety migrations,
  plus the corresponding backup schema version increment.
- Confirmed-fact and trip-item write paths must mint identities and maintain semantic revisions.
- Mock behavior must match active/history filtering, amendment matching, replacement, and restore;
  it cannot return a visually convenient fiction that the Rust service would reject.
- Sharing stays local and redacted. Calendar and Journey Board never gain document text, codes,
  names, private notes, resources, or provider data.
- A real encrypted resource file wallet remains a separate decision. `ResourceKind.file` may remain
  for compatibility, but this ADR does not implement file bytes, opening, parsing, or backup rules.

## Alternatives considered

**Hash the current event into UID.** Rejected: every edit becomes a new event and duplicates the
old one.

**Use array index or database id directly.** Rejected: array positions are unstable, and internal
row identities couple UI focus and external calendar behavior to storage.

**Infer time zones from airports or destination.** Rejected: a confirmation's wall clock does not
say which zone rule applied, and multi-zone travel makes destination-wide inference false.

**Overwrite the existing confirmed fact.** Rejected: it erases approved evidence and makes stale
review approval indistinguishable from a current one.

**Fuzzy-match likely amendments.** Rejected: false replacement is worse than one extra ordinary
candidate. Uncertainty stays visible and traveler-controlled.
