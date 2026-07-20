# ADR-0005: Keep traveler-authored plans separate from evidence

- Status: Accepted
- Date: 2026-07-20

## Context

Voyalier already distinguishes imported source documents, untrusted candidate
facts, traveler-confirmed facts, and dated retrieved snapshots. The next product
slice adds saved recommendations, packing checklists, and manually scheduled
activities or transfers. Treating any of those as `ConfirmedFact` would erase
the reason the evidence lifecycle exists: a place suggested by an open-data pack
is not a reservation, a weather-derived packing hint is not a traveler decision,
and a manually typed museum visit has no imported confirmation behind it.

The product brief also promises that recommendations can be saved, while the
current implementation keeps interest weights and recommendation results only in
React state. Packing suggestions similarly exist only as computed output. The
new records need durable storage, backup/restore behavior, transport parity, and
vault coverage without letting generated output promote itself.

## Decision

Voyalier owns a distinct **planning** model alongside its evidence model:

- An `InterestProfile` persists the five existing persona weights per trip. It
  affects only deterministic recommendation ranking.
- A `SavedPlace` snapshots the selected recommendation's pack id, coordinates,
  category, source, license, and reasons at the moment the traveler saves it.
  Optional traveler notes are user-owned. Removing or refreshing the source pack
  never silently removes the saved place; the retained provenance explains where
  it came from.
- A `PackingSuggestion` remains computed output. It enters no checklist by
  itself. A `PackingItem` exists only after an explicit add and can also be
  custom-authored, checked, renamed, or removed. Weather and itinerary refreshes
  never mutate traveler-owned checklist entries.
- A `TripItem` is a manual activity, rail journey, or transfer. It is eligible
  for Today, calendar export, the printable brief preview, workspace search, and
  deterministic time-overlap notices, but it is not a confirmed reservation and
  never clears readiness.

Planning records belong to `voyalier-app` persistence and are exposed only
through `AppService`; validation and deterministic projections belong to
`voyalier-core`. Axum and Tauri remain thin adapters over the same versioned
`AppGateway` contract.

All traveler-authored free text in saved places, packing items, and trip items
is sealed through `Records` and declared in `SEALED_COLUMNS`. Workspace backups
include the records and restore them transactionally. Trip deletion cascades;
source-pack deletion does not. AI requests continue to exclude planning notes.
The brief and calendar may include a trip item's title, location, and times, but
never its notes. Their previews remain the checkpoint before export.

Workspace search may index documents, confirmed facts, trip notes, saved places,
and trip items, but every result states both its trip and source kind. Ranking is
deterministic occurrence scoring, never a claim of importance.

The data-source register is defined in one shared contract file and checked
against the Rust source inventory. It is descriptive only: sources from different
authorities or licenses are never merged into one trust score.

## Alternatives considered

- **Promote saved places and trip items into confirmed facts.** Rejected because
  it would make suggestion, authored plan, and evidence-approved reservation
  indistinguishable to readiness, sharing, and future parsers.
- **Store the planning state only in the web interface.** Rejected because it
  would vanish on restart, bypass backups and the vault, and diverge between
  browser and desktop transports.
- **Automatically accept every packing suggestion.** Rejected because derived
  advice must not become a traveler decision without a deliberate action.
- **Delete saved places with their pack.** Rejected because the traveler owns the
  shortlist; the source relationship is provenance, not ownership.

## Consequences

- Planning adds an append-only migration and coordinated contract, server,
  desktop, mock, and gateway methods.
- Tests observe planning behavior through core functions, `AppService`,
  `AppGateway`, React interactions, live HTTP, and a browser journey. Direct SQL
  inspection is reserved for migration, vault, backup, and integrity guarantees.
- New planning kinds require explicit decisions in Today, brief, calendar,
  search, backup, deletion, and accessibility tests rather than being smuggled
  through an existing payload enum.

Related: [ADR-0001](ADR-0001-system-shape.md),
[ADR-0003](ADR-0003-phase2-contract.md), and
[ADR-0004](ADR-0004-mock-parity.md).
