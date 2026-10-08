# Dev-review remediation

Date: 2026-10-08. Base: `4b3d3b754caba4b48928cc59e52b2cfeb66008ea`.
Audit: `20261007T214121Z-ea305767`, findings `DR-ea305767-001` through `014`.

## Scope and authority

The traveler requested all reported fixes, merge, and push. Implement the eleven
selected Fix candidates, investigate the three Research items with synthetic
fixtures, and implement a research direction only after evidence supports its
reclassification. The traveler chose device-local calendar dates for Today.
Full concierge localization remains deferred; correct the inaccurate coverage
claim. No release, tag, deployment, real-provider call, or user-data mutation is
part of this work.

Use an isolated integration checkout and a separate checkout/runtime for each
writer. Preserve existing worktrees and the original main checkout. Repository
execution uses credential-free environments, disposable data, shipped fakes,
and external-network denial. Locked dependency provisioning is separate from
execution, with install scripts and pnpmfile hooks disabled. Preserve the
original audit report and before evidence privately.

## Ownership and integration order

Three specialists remain the workers; the senior owns integration and gates.

1. Production/adversarial owns app vault/recovery, snapshot credentials, native
   export, maintenance recovery, and the two-process experiment: 001, 002, 006,
   007, 008, and investigation 014. Architecture is its independent peer.
2. Product/UX owns concierge form acknowledgement and shared save coordination,
   truthful document metadata, Today labels/clock, and docs: 005, 009, 010, 011,
   UI contribution to 003, and the UI portion of 012. Architecture is its peer.
3. Architecture/correctness owns profile revision semantics, document unlink,
   coordinated date contracts/transports, and AI-consent experiment/binding:
   003, 004, backend contribution to 012, and investigation 013. Production is
   its independent peer.

Production and architecture write shared Rust, desktop, and test modules in
sequence. Product may implement disjoint web files while production runs.
Product exclusively owns ConciergeCockpit and ProviderOptionsPanel edits;
architecture supplies the contract and reviews that UI contribution. Restart
each overlapping slice from the last accepted integration tree. No worker
commits or writes outside its declared files without senior coordination.

## Vault activation: 002

Amend ADR-0007 before implementation; preserve ADR-0025 input policy. Separate
storage-prefix interpretation from encryption completion. Authenticate existing
ciphertext, correctly decode escaped plaintext, seal current-format fallback
cells transactionally through the existing vault/Records boundary, and skip
NULLs and unchanged ciphertext. Locked reads reject before plaintext return.
Exercise normal reopen, passphrase unlock, and keyless staged restore.

Acceptance: ordinary and reserved-prefix notes saved with unavailable secrets
reopen encrypted with exact values; protected reopen requires unlock; wrong-key
and corrupt envelopes fail without partial rewriting. Existing format cutover,
backup bounds, inactive structured metadata, and binary-file refusal remain.

## Restore terminal phases: 006 and 007

Amend ADR-0021 before implementation. Persist cancellation or rollback intent
before deleting dependencies or moving the old database. Terminal recovery runs
before candidate-key validation, recognizes the old hash already at the live
path, restores/verifies old key intent, and cleans only exact-generation state.
Preserve failed-candidate evidence. Older protocol markers remain recoverable;
unsupported new phases must be refused by older binaries before mutation.

Acceptance: deterministic interruption at every terminal marker/key/file and
old-key restoration boundary converges on the readable old workspace after
restart. Include protected/keyless cases, ambiguous-hash refusal, and the
existing forward recovery matrix. Recovered old state must never enter the
forward-only passphrase-wrap clearing path.

## Snapshot credential lifetime and recovery: 001

Record the local recovery-index design in ADR-0026 and amend ADR-0021. Portable
backup format remains unchanged. Bind exact owned snapshot names/hashes to
workspace-scoped secret-store credential accounts and key digests; files and
contracts contain no raw key. Cover every retained snapshot family and adopt
pre-existing snapshots only with a matching surviving key or passphrase wrap.
Identify already stranded snapshots without implying their keys can be recreated.

Retention and pruning retire snapshots before the last dependent credential.
Clear backups remains exact-scope, interruption-safe cleanup. A later live
passphrase transition must not leave a raw same-key snapshot account that
bypasses protection: convert matching recovery credentials to authenticated
wrapped credentials before retiring raw access, and recover partial conversion.
Protected snapshots retain their original passphrase requirement.

Provide a maintenance-only `backup-recover` route following existing
`vault-prune` conventions: exact owned basename, bounded validation, dry-run by
default, explicit apply, passphrase input outside argv, and existing generation
staging. No additional product backup UI or hosted service.

Acceptance: distinct-key successful restore recovers an old sealed note and
file using surviving state after restart; second restore, existing pre-update
copies, shared-key lifetime, interrupted prune/Clear, unavailable secret store,
protected/keyless copies, and later passphrase protection all retain their
stated guarantees. Existing vault-account pruning keeps live snapshot owners.

## Native export replacement: 008

Write/sync a unique sibling temporary file before atomically replacing a native
picker destination; synchronize the parent where supported. Preserve confirmed
overwrite, permissions, platform replacement behavior, and automation's
create-new refusal. Use private fault checkpoints rather than another IO trait.
Partial write/sync/promotion failure preserves the previous exact valid backup;
successful replacement authenticates with the existing opener.

## Concierge concurrency and provenance: 003 and 004

ADR-0027 records an optional server-owned revision on the existing whole-profile
contract. Omission permits initial creation only; missing or stale revision on
an existing profile rejects before history, invalidation, timestamps, or write.
This explicitly tightens old-client write compatibility: old clients retain
reads/creation but must refresh/upgrade before overwriting an existing profile.
There is no unsafe legacy bypass. Legacy stored JSON gets a stable derived
revision without read-time rewriting. Every accepted Records persistence
rotates its revision, including internal invalidation and source unlink.
Compare and replace in one immediate SQLite transaction.

Document deletion clears matching wallet references in its existing transaction,
preserving authored metadata and evidence/history tombstones. Mirror it in the
mock. Whole-profile gateways retain their declared input-forwarding semantics;
shared-wire fixtures verify the revision rather than regenerating the manifest.

The cockpit and provider panel share a synchronous save owner. Retain rejected
drafts, expose completion, and avoid timestamp-based editor remounts. Provider
saves must not overwrite unsaved drafts; reconciliation is explicit.

Acceptance: two initial/stale readers, missing revisions on modern/legacy rows,
stable legacy reads, explicit fresh retry, revision rotation on every internal
writer, and independent-connection races. Source deletion permits unrelated
saves after reread, preserves wallet/fact/history metadata, and rolls back on
locked/persistence failure. Delayed provider/form/attachment journeys preserve
every accepted change and unsaved draft.

## UI failure states and source labels: 005, 009, 010

Use cockpit-local completion callbacks with the existing async hook. People,
Wallet, and Money reset only on accepted completion, and only if no newer form
edit occurred. Reject/retry retains values and nearby actionable error feedback.
Keep busy feedback and prevent duplicate submission.

Today reuses translated Confirmed/Traveler plan labels for rows and the next
anchor without changing their owning record or dates. Missing older target
metadata must not invent an authority label. Wallet distinguishes loading,
unavailable metadata, cached refresh failure, authoritative absence, and cleared
references; provide bounded retry and avoid false zero-document totals.

Acceptance: reject/correct/retry and delayed-success newer-edit tests for all
three forms; safe navigation during pending work; English/Spanish identical
fact/plan titles and target focus; loading/error/retry/cache/deletion states.
Verify actual keyboard, reduced motion, contrast, responsive widths and 200%
zoom on the changed surfaces with disposable data.

## Research experiments and conditional remediation: 012 through 014

012: capture controlled date-boundary and midnight/resume failures, then
reclassify. ADR-0028 records current UI device-local `YYYY-MM-DD`, an optional
`referenceDate` in getToday HTTP/Tauri contracts, strict core date validation,
and documented legacy omitted-date fallback. Preserve floating event dates.
Use a bounded clock timer and focus/visibility/pageshow checks; unchanged dates
cause no request. Include local midnight, UTC disagreement, DST, timezone
change, stale response, failure and unmount cleanup.

013: two disposable sessions preview synthetic content, mutate facts/model/
instructions, dispatch through FakeFetcher, and compare the captured effective
request against the approved preview. If a supported mismatch is proved,
reclassify and record ADR-0029 before binding preview approval to effective
credential-free endpoint/model/body. Compare before any request and dispatch
that same checked content. Missing/stale approval fails closed; propagate the
field through both transports, contracts, mock, manifest and wire fixtures.
Do not claim a local draft is remote disclosure.

014: two disposable subprocesses with pipe barriers and existing fakes exercise
WAL/restore overlap. Preserve ambiguous fixtures and stop if evidence is unclear.
If unsafe supported overlap is proved, reclassify and record ADR-0030 before
adding a lifetime OS workspace lock outside replaceable SQLite state, acquired
before recovery/migrations and retained across service clones. Kernel release
handles process death; no sentinel deletion and no silent MSRV increase.

## Documentation and final gates: 011

Synchronize architecture/security topology, ADR index, backup recovery and
partial Spanish coverage claims with verified source. Managed source-browser
launch uses an assigned loopback port, anonymous-pipe bootstrap and direct
guarded requests; desktop uses IPC. Distinguish source behavior from published
installer/release evidence. Add user-facing Keep a Changelog prose without a
version/release bump.

Each slice receives worker → senior → independent peer → senior verification.
After two failed correction loops, retain evidence and stop that slice rather
than forcing a fix. Roll back exact task-owned deltas if acceptance regresses.
Do not absorb unrelated work or change shipped migration steps.

Run focused reproductions and neighboring tests, then `scripts/check.sh` web,
rust, desktop, and integration stages against the accepted tree. Inspect wire
parity, credentials, formatting, complete diff/status, locked metadata, docs
build and portable recovery. Refresh the existing Graphify graph and verify a
scoped query. Final report includes same-condition before/after evidence and
all remaining limits. A fresh two-round, four-reviewer council approves the
exact candidate and report before merge. Push the reviewed branch, attach its
PR, verify required hosted checks, and integrate through protected linear
history without bypassing protection or force-pushing main. Verify main/origin
alignment after merge/push; preserve all user-owned worktrees.
