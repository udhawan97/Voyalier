# Architecture

Voyalier is a local-first trip workspace with one React product interface, two
narrow runtime transports, a SQLite-backed Rust application-service layer, and
a framework-independent Rust domain core. The architecture is designed around a
more important boundary than frontend/backend: **untrusted input must never
silently become traveler-approved truth**.

![Voyalier system architecture: the shared React interface selects guarded Axum loopback HTTP for browser development or direct Tauri IPC for desktop, then converges on shared Rust application services, deterministic core rules, SQLite, and OS keychain storage.](../../docs-site/public/assets/voyalier-system-architecture.svg)

## Runtime topology

The UI depends on the versioned `AppGateway` contract, not on a transport. At
startup it selects exactly one implementation:

| Runtime                      | Transport                               | Boundary                     | Security posture                                          |
| ---------------------------- | --------------------------------------- | ---------------------------- | --------------------------------------------------------- |
| Browser development          | same-origin JSON through the Vite proxy | Axum on `127.0.0.1:8787`     | loopback bind, Vite-only CORS, Host and Origin validation |
| Tauri desktop                | typed `invoke` commands                 | direct IPC into `AppService` | no Axum dependency and no TCP listener in release builds  |
| Component and contract tests | in-memory mock gateway                  | frozen TypeScript contract   | deterministic fixtures; no storage, keychain, or network  |

Both production paths use camelCase wire types and the same serialized
`AppError` shape. A capability is not complete until its contract, Rust service,
Axum route, Tauri command, gateway implementation, mock, and tests agree.

## Layer ownership

### `apps/web` — product interface

- React/Vite views for trips, Blueprint, review, readiness, Today, city packs,
  recommendations, maps, AI preview, vault state, and the shareable brief.
- Selects HTTP, Tauri, or mock transport through `AppGateway`.
- Owns interaction and accessibility, not travel-rule authority.
- Makes the consent-gated map-tile request only after **Show map** is selected.

### `apps/desktop/src-tauri` — native shell

- Initializes the shared `AppService` and exposes thin one-line Tauri commands.
- Contains no product rules and starts no local web server.
- Applies a restrictive CSP; the map tile origin is the only product webview
  network origin currently allowlisted.

### `crates/voyalier-app` — application services and durable state

- Owns SQLite transactions, migrations, WAL mode, foreign keys, and the busy
  timeout.
- Orchestrates trip/fact lifecycle, imports, advice/weather snapshots, city
  packs, recommendations, AI providers, activity records, and vault state.
- Contains the injectable network seam so tests can replace every remote fetch.
- Stores BYOK secrets and the vault data key through the OS keychain, never in
  UI payloads, fixtures, logs, or committed files.
- Seals raw source content and sensitive confirmed-fact payloads at rest when a
  recoverable data key is available. An optional passphrase wraps that key;
  legacy plaintext and sealed records can coexist during migration.

### `crates/voyalier-core` — deterministic domain

- Owns types, validation, parsers, itinerary conflict detection, readiness,
  search, Today, recommendations, brief redaction, vault cryptography, and
  provider request/reply validation.
- Has no Tauri, Axum, database, or network dependency.
- Operates on explicit inputs and produces stable, fixture-testable outputs.
- Treats document text and model output as data, never executable instruction.
- Owns whole protocols, not their ingredients: importing a document
  (`parse_import`) bounds the input, unwraps an email to its body, bounds that,
  and picks the parser; an assist call (`build_assist_request` /
  `parse_assist_reply`) pairs a provider with its endpoint, model default, body
  shape, headers, and reply parser. The application layer supplies only what the
  core cannot — the key and the fetch.
- Reports findings, not sentences. Readiness returns a check id, a finding, and a
  count; the interface turns those into localized prose.

### `packages/contracts` and `packages/ui` — shared boundaries

- `packages/contracts` is the versioned TypeScript surface mirrored by Rust wire
  types and JSON Schema drift tests.
- `packages/contracts/parity/*.json` holds what both languages must agree on —
  validation limits, place folding, the default AI instructions, and the curated
  official-source links. A Rust test holds the core to each file and a TypeScript
  test holds the contract and its mock gateway to the same one, so a divergence
  fails a test instead of passing quietly.
- `packages/ui` carries the palette, typography, spacing, motion, and semantic
  tokens shared by product surfaces.

## Evidence lifecycle

![Voyalier evidence lifecycle: imported text is stored locally, parsed into candidates with field spans and warnings, reviewed by the traveler, and only then promoted to confirmed facts that can drive deterministic trip views. Retrieved evidence and AI remain separate consent-gated lanes.](../../docs-site/public/assets/voyalier-evidence-pipeline.svg)

### Imported confirmations

1. The service validates the input kind and size, hashes the content, and stores
   the raw source only in SQLite.
2. JSON-LD and plaintext parsers emit candidate facts with a parser-run ID,
   extraction method, field spans, excerpts, and warnings.
3. The review UI makes the traveler confirm/correct, reject, or leave each
   candidate pending.
4. Confirmed facts retain the candidate link, extraction method, corrected field
   list, and confirmation time. Undo returns the candidate to pending review.
5. Only confirmed facts feed itinerary conflicts, logistics readiness, Today,
   and the redacted brief. Local search covers both stored source documents and
   confirmed facts; recommendations rank downloaded open place data against
   traveler-selected persona weights.

Raw document content is intentionally absent from `SourceDocument`,
`ImportResult`, HTTP responses, and Tauri responses.

### Retrieved facts and destination packs

Remote travel data is user-triggered and stored as a dated snapshot rather than
treated as timeless truth:

| Capability      | Source / path                                                 | What is retained                                                              | Failure posture                                         |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| Official advice | GOV.UK FCDO                                                   | human URL, verbatim fields, source update time, retrieval time                | stale or absent remains visible; no invented summary    |
| Weather         | Open-Meteo geocoding + forecast                               | resolved place, coordinates, dated days, coverage, source URL, retrieval time | partial and out-of-horizon coverage is labeled          |
| City packs      | CI-built GitHub Release artifacts                             | Overture place data plus separately attributed Wikivoyage layer               | download is explicit; local pack remains usable offline |
| Map             | MapLibre + OpenFreeMap, with PMTiles as the offline direction | viewport tiles and visible attribution                                        | no tiles are requested before **Show map**              |

Official entry, health, and safety sources outrank commercial data, editorial
content, community content, and model inference. No lower-trust source can clear
a high-stakes readiness item.

### Optional AI assistance

- Ollama is local and keyless; OpenAI and Anthropic are BYOK cloud providers.
- Keys are write-only from the product contract and stored in the OS keychain.
- Before a run, Voyalier builds an on-device preview containing the destination,
  endpoint, exact redacted user payload, withheld field kinds, grounding count,
  and token estimate.
- Names and confirmation codes are excluded by construction.
- The traveler explicitly consents, and every completed call is recorded in the
  visible activity log.
- Model replies remain labeled assistance. They cannot originate or clear visa,
  safety, health, price, availability, or opening-hour claims.

## Product flow

![How the Voyalier workspace works: frame the trip, gather sourced evidence, review extracted facts, pressure-test readiness, download an offline pack, use Today, optionally ask AI, and share a redacted brief.](../../docs-site/public/assets/voyalier-trip-workspace-flow.svg)

The offline baseline is deliberate: saved trips, confirmed facts, Blueprint,
conflicts, readiness, search, Today, and the brief remain useful without a paid
AI key or live provider. Network access adds dated evidence; it does not replace
the local operating layer.

## Persistence and encryption

All persistent state lives in an OS-appropriate application-data directory,
never inside the application bundle. The database uses SQLite with WAL, foreign
keys, and a busy timeout.

Schema changes are an ordered list of steps keyed on `PRAGMA user_version`: each
runs at most once and records itself before the next begins, so the order is
structural rather than remembered. Version 1 means "some legacy shape" rather
than a known one — every build since the first stamped it on open regardless of
what the database held — so the two steps that predate the ledger still detect
their own applicability. Steps added since can trust the version.

Which columns the vault seals is declared once, and that declaration drives a
test holding each of them to being ciphertext on disk and plaintext through the
reads. Trips, candidates, and confirmed facts are read and written through one
module that seals where it maps the columns; the document body and trip notes
still seal by hand at their own SQL.

Raw imported content and sensitive confirmed-fact payloads have three vault
states:

- **Active:** a data key is available from the OS keychain, or the traveler has
  unlocked a passphrase-protected vault. Sensitive fields are sealed/opened
  transparently.
- **Locked:** a passphrase wraps the data key and has not been entered for this
  process. Reads and writes that need sealed content fail closed.
- **Inactive:** no recoverable key store exists, such as a keychain-less CI
  environment. The app remains testable and does not encrypt with an ephemeral
  key that would make data unrecoverable.

Database migrations are fixture-backed: a legacy-shaped database is migrated in a
test and checked for ordering and row survival. Key changes, backup, deletion,
and legacy-record handling still need the same treatment before the signed public
beta.

## Network inventory

Every current remote edge is narrow and attributable:

- GOV.UK FCDO advice and Open-Meteo weather through the injectable Rust fetcher.
- GitHub Release downloads for explicitly selected offline city packs.
- The in-app updater, after you opt in: a once-a-day release-metadata check plus
  the signed update download over `github.com` + `objects.githubusercontent.com`,
  run entirely in the Rust core (never the web view).
- OpenFreeMap tiles directly from the map view after user consent.
- Localhost Ollama probing/inference, or BYOK OpenAI/Anthropic inference after an
  exact payload preview.

There is no telemetry, shared provider key, autonomous booking, live inventory
aggregation, background scraping, or silent document upload.

## Invariants enforced in tests

- Rust and TypeScript contracts stay aligned across both transports.
- The rules the mock gateway mirrors agree with the core, against shared golden
  files: validation limits (and the units they count in), place folding, the
  default AI instructions, and the official-source links.
- Every `ErrorCode` appears in the contract's `AppError` schema. The list is
  hand-kept, but an exhaustive match beside it means adding a variant is a
  compile error at the line that says to extend it.
- Desktop command names and the single `input` argument shape round-trip.
- Parser, ranking, readiness, itinerary, redaction, vault, and provider behavior
  use deterministic fixtures.
- Schema migrations run in order, once each, and a legacy-shaped database keeps
  its rows through them.
- Every column declared sealed is ciphertext on disk and plaintext through the
  record reads — the declaration drives the test.
- Prompt-injection fixture text remains inert quoted source content.
- Keys and raw document bodies never appear in response contracts.
- Browser loopback requests fail closed for invalid Host or Origin values.
- Reduced motion, keyboard flow, focus containment, and accessible labeling are
  release requirements, not post-launch polish.

## Current limitations

- Browser development still uses a fixed `127.0.0.1:8787` port. A random port
  plus per-launch token remains defense-in-depth work if browser mode becomes a
  distributed product surface.
- In-app updates ship signature verification (minisign), per-platform checksums,
  and SLSA build provenance; the packaged app is not yet OS code-signed (Apple
  notarization / Windows Authenticode), so the first manual install uses the
  documented Gatekeeper / SmartScreen "open anyway" path.
- Map PMTiles are the intended offline route, but the current interactive map
  uses consent-gated OpenFreeMap tiles.
- Voyalier surfaces official links and dated snapshots; it does not claim legal,
  medical, safety, pricing, availability, or opening-hours authority.

Related decisions: [ADR-0001](ADR-0001-system-shape.md),
[ADR-0002](ADR-0002-desktop-transport.md),
[ADR-0003](ADR-0003-phase2-contract.md), [ADR-0004](ADR-0004-mock-parity.md), and
[map architecture](MAPS.md).
