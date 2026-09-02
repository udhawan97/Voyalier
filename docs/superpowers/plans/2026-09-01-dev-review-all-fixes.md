# Dev-review all-fixes implementation plan

**Date:** 2026-09-01  
**Review run:** `20260831T232507Z-21b55059`  
**Selected scope:** all sixteen `Fix candidate` findings; `Research` findings remain experiment-only

## Outcome and authority

Close the review's source-proven product, recovery, trust, accessibility, and documentation gaps
without changing Voyalier's local-first authority boundary. The user authorized the complete
selectable set and a verified merge and push to `main`. The work does not authorize a version bump,
tag, release, deployment, live provider call, credential use, or third-party write.

The accepted behavior remains evidence-backed and traveler-controlled. Voyalier does not book,
monitor, or assert visas, safety, health, prices, availability, opening hours, or delivery. Direct
Tauri IPC remains the shipped desktop transport; the authenticated Axum route remains a
source-development surface.

## Cross-cutting architecture decisions

- Amend the existing ADRs before the code they govern: ADR-0002 for authenticated source-browser
  transport, ADR-0007/0017/0018 for unambiguous sealed storage and generation-bound recovery,
  ADR-0008 for request-class destination policy, ADR-0012 for restore command parity, and ADR-0020
  for typed calendar-removal roles.
- Keep all product rules and deterministic projections in `voyalier-core`; keep SQLite, filesystem,
  network, keychain, backup/restore, and vault choreography in `voyalier-app`; keep Axum and Tauri
  adapters thin; keep localization and interaction in `apps/web`.
- Preserve append-only, retry-safe migrations. `SEALED_COLUMNS` remains the sole encrypted-column
  declaration. Stored sealed-column values have three explicit format states: authenticated
  ciphertext is `v1:<base64>`, reserved-prefix plaintext is escaped as `p1:<base64 UTF-8>`, and
  ordinary bare text remains valid plaintext for inactive-vault compatibility. A `p1:` value decodes
  only as escaped plaintext; a historical `v1:` value that cannot authenticate is ambiguous and
  fails closed rather than falling back to plaintext.
- Every new gateway operation must be implemented through `AppService`, Axum where applicable,
  Tauri, contracts, mock, both gateways, and the hand-maintained route manifest. Desktop-only backup
  bridge changes must remain represented in `desktopOnly` parity.
- Network and backup size limits are enforced before unbounded allocation. Model-download streaming
  remains a separate bounded operation.
- Source-browser credentials stay in memory and out of URLs, logs, persisted browser storage,
  screenshots, fixtures, and committed files. The launcher gives the bearer to Axum through an
  inherited anonymous pipe, receives Axum's assigned address through a separate pipe, and injects
  both into the exact origin of a dedicated managed Chromium session before application code runs.
  Browser API calls go directly to authenticated Axum; Vite does not proxy `/api`, and an unmanaged
  uncredentialed browser has no bootstrap path.

## Phase 1 — storage discrimination and recoverable restore

### DR-21b55059-003 — unambiguous sealed representation

Replace the two-way content-prefix guess with an append-only, single-row storage-format state owned
by the vault/Records seam. `v1:<base64>` remains authenticated ciphertext. After the format cutover,
an inactive vault stores plaintext beginning with either reserved prefix (`v1:` or `p1:`) as
`p1:<base64 UTF-8>` and decodes `p1:` only as escaped plaintext. Before the format state advances,
`p1:` remains ordinary legacy plaintext. Ordinary bare plaintext remains valid in both states so
inactive-vault workspaces stay compatible. Advance the state in the same SQLite transaction as the
backup-first cell rewrites: an active vault authenticates existing `v1:` values and seals known
plaintext; an inactive vault escapes known `p1:`-prefixed plaintext. Existing authenticating
ciphertext stays readable. Malformed ciphertext and historical `v1:` plaintext that cannot
authenticate remain deliberately ambiguous and fail closed with the format state unchanged; the
migration never guesses, and rollback reopens the legacy generation.

### DR-21b55059-001 and DR-21b55059-011 — generation protocol and bounded reads

Checkpoint committed WAL state before snapshotting. Bind pending metadata to the staged database
hash, schema, database generation, and intended key state. Retain the old database and key until the
new generation has been atomically activated and reopened successfully. Every restart must converge
to exactly one readable old or new generation; mixed staging cannot activate. Add fault injection at
copy, marker, key-set, key-delete, rename, reopen, and cleanup boundaries.

Bound selected-backup reads before copy and bound known-length and chunked network bodies before
parsing. Endpoint-specific limits must admit the largest legitimate fixtures and leave the existing
streamed model download path unchanged.

### DR-21b55059-015 — inspect, confirm, cancel, and unstage

Only after the recovery protocol is safe, split restore selection from staging. A read-only inspect
operation validates and previews the selected artifact without pending state. The native adapter
binds the encrypted selected bytes to a random opaque, process-local inspection identifier and
returns only that identifier plus safe metadata; no path, raw backup bytes, or decrypted snapshot
crosses into the webview. The native session retains neither passphrase nor decrypted snapshot.
Confirmation resubmits the transient form passphrase, consumes the exact inspected bytes, and stages
exactly one generation. Cancel/close destroys the session and clears the form without persistent
mutation; unstage durably removes the exact pending generation and key state across restart; an
invalid backup never creates a session or stages. Keep Rust-side file IO, native pickers, schema
refusal, safety snapshots, and truthful next-launch copy. Inspect, confirm, cancel-inspection, and
unstage remain Tauri-only commands declared by `desktopOnly` parity, never Axum routes.

## Phase 2 — deterministic parser and calendar contracts

### DR-21b55059-002 — one graph-aware JSON-LD traversal

Visit an object-valued `@graph` exactly once, keep array-valued behavior, deduplicate nested graph
nodes by traversal identity, and retain depth/accepted-size bounds, source spans, hashes, malformed
input tolerance, and candidate provenance. Add auto-discovered fixtures for object, array, and nested
graph shapes.

### DR-21b55059-008 and DR-21b55059-017 — logical removal roles

Represent removals by lineage root plus typed `CalendarRole`, deduplicate before presentation, and
carry only redacted context. Keep distinct roles distinct and keep `.ics` UID, `SEQUENCE`, `DTSTAMP`,
and serialized bytes stable. Preserve legacy `removals: string[]` and add optional typed
`removalDetails` entries to Rust, TypeScript, mock, and parity fixtures. New presentation code prefers
typed details, maps each role to English or Spanish at render time, and falls back to the legacy
strings when old fixtures omit the optional field. Do not replace `removals` with a string/object
union: that would break older consumers. Context remains redacted plain text, never raw source.

## Phase 3 — production trust boundaries

### DR-21b55059-005 — least-privilege pack publication

Pin and verify the DuckDB bootstrap, split validation/build from release mutation, constrain inputs
to a pack-only tag namespace, reject product tags, prevent failed builds from touching an existing
release, and give publication only the minimum required permission. Preserve deterministic pack
validation and immutable product release history. This changes workflow code only; it does not
publish a pack or release.

### DR-21b55059-006 — request-class destination policy

Place a destination policy below `AdviceFetcher` that applies to untrusted resource capture, checks
the initial and every redirected destination, rejects loopback/private/link-local IPv4 and IPv6 plus
ambiguous encodings, and bounds DNS-rebinding behavior. Provider and local-AI request classes retain
their existing rules; localhost Ollama remains available only for explicitly consented local AI.

### DR-21b55059-014 and DR-21b55059-020 — authenticated source browser

Bind Axum to an OS-assigned loopback port and require a cryptographically random per-launch bearer
on reads and writes. The source launcher sends the bearer to Axum through an inherited anonymous
pipe and receives the assigned address through a separate anonymous pipe. It then starts a dedicated
managed Chromium session and injects the address and bearer into that exact loopback document before
application code runs; the gateway consumes the non-enumerable bootstrap into its request closure.
The bearer never appears in a URL, log, browser storage, fixture, screenshot, or committed file. The
browser calls authenticated Axum directly; Vite does not proxy `/api`. Retain Host/Origin/CORS and
DNS-rebinding guards, leave direct Tauri IPC unchanged, and do not claim support for attaching an
unmanaged browser to this authenticated source workflow.

Serve the source-browser document with a tested CSP that limits scripts and API connections to the
minimum development/HMR surface, forbids unintended frame/object/base/form behavior, keeps map
rendering and reduced motion working, and does not modify the desktop CSP.

### DR-21b55059-012 — current security policy

Make `SECURITY.md`, README, and the threat model agree on the current public-beta policy, packaged
reporting/update expectations, private disclosure route, direct-IPC desktop boundary, and
authenticated development HTTP surface. Do not make an exact-tag, certification, or unsupported
platform claim.

## Phase 4 — recovery-owned and accessible web interactions

### DR-21b55059-007 — safe local-read Retry

Give the global recovery action explicit ownership of the three identified safe local reads only.
Each failed read replays exactly once and preserves prior data; no write, provider call, weather,
map, AI, or consent-gated action can replay.

### DR-21b55059-009 and DR-21b55059-016 — Unicode query validation

Keep Trip Search and Workspace Search input intact, use shared `countChars`, permit 200 astral
characters, associate localized guidance at 201, and block the gateway call until corrected. Keep
ordinary short search quiet, debounce behavior fast, input-method/paste behavior stable, workspace
history intact, and exact-source handoff unchanged.

### DR-21b55059-010 — compact 44 px controls

Expand the interactive boxes for recurring theme, search, settings, and dialog-close controls to at
least 44 by 44 CSS pixels while keeping icons and Quiet Journey rhythm compact. Preserve the theme
radiogroup arrow-key model, roving tabindex, dialog trap/focus return, visible focus, reduced motion,
200% zoom, and no-overflow layouts at 320, 375, 414, 768, and 1440 px.

## Research boundaries

- `DR-21b55059-004`: run the older-writer experiment only on disposable copied data; do not change
  downgrade policy without reclassification and explicit selection.
- `DR-21b55059-013`: vary Vitest worker count/order/timing and capture leak evidence; do not hide a
  cause by raising timeouts.
- `DR-21b55059-018`: document/tamper-test publisher versus content-authenticity roots; do not add
  speculative key management.
- `DR-21b55059-019`: run a disposable HTTP and Tauri serialization journey; adding a durable
  production-shaped test requires supported evidence and remains outside the selected Fix set unless
  separately authorized.

Research may inform acceptance or reclassify a finding, but it does not authorize product edits.

## Ownership, sequencing, and review

- Architecture implementation specialist: DR-001, DR-002, DR-003, DR-008, DR-011.
- Production implementation specialist: DR-005, DR-006, DR-012, DR-014, DR-020.
- Product UX implementation specialist: DR-007, DR-009, DR-010, DR-015, DR-016, DR-017.

One writer owns a file at a time. Storage/recovery lands before restore UX; typed calendar roles land
before localized rendering. Each slice follows worker implementation, senior review, independent
peer review, and senior final acceptance. Any peer blocker returns to the original worker, with at
most two correction loops. Final receipts bind all four roles to one exact accepted tree digest.

## Verification gates

1. Focused red/green Rust, contract, web, workflow-source, server, desktop, and parity tests for each
   finding and every acceptance clause.
2. Restore fault matrix, legacy/current vault migration, oversize body/artifact, private-destination,
   missing/wrong bearer, CSP, Unicode, localization, keyboard, focus, and geometry cases.
3. `make check`, `./scripts/check.sh integration`, `git diff --check`, `pnpm audit --prod`, and the
   tracked credential-pattern scan from `security-hygiene.yml`.
4. The bounded Research experiments needed to explain the existing aggregate web-gate failure and
   to exercise the production-shaped amendment/restore route without writing user data.
5. Actual-browser acceptance after Obscura-level functional inspection. Exercise the authenticated
   source transport in the managed Chromium instance launched over the anonymous pipe; there is no
   Vite-proxy or unmanaged-browser acceptance path. Use Safari separately for responsive,
   accessibility, reduced-motion, and 200% zoom presentation checks without treating it as proof of
   the managed source bootstrap. Packaged Tauri restore acceptance uses a disposable local workspace
   and synthetic backup only.
6. `graphify update .` plus scoped queries over the refreshed recovery, transport, and calendar
   paths before integration.
7. A fresh private after-report and exactly two council rounds over the exact candidate diff, tree
   digest, checks, and report. Resolve every valid blocker before integration.
8. Rebase or otherwise integrate current `origin/main`, merge with `Merge: dev-review all fixes`,
   push `main`, and verify the remote SHA. No tag, release, or deployment.

## Planned commit order

1. `Docs: plan dev-review all fixes`
2. `Docs: amend recovery and trust decisions`
3. `Core+app: make vault recovery generation-safe`
4. `Core+app: bound reads and parser traversal`
5. `Core+contract: type calendar removals`
6. `Deps: harden pack publication`
7. `App+server: constrain resource and browser transport`
8. `Contract+desktop+web: make restore staging explicit`
9. `Web: recover safe reads and validate Unicode search`
10. `Web: localize calendar roles and enlarge controls`
11. `Docs+test: close dev-review verification gates`
12. `Merge: dev-review all fixes`
