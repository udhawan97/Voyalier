# Dev-review remediation — 2026-10-21

Run: `20261021T174848Z-0fa5b711`; evidence revision: `bc87092d9bb4e7b8e81ffb3b9156c3274946b0a2`.

## Scope and authority

The owner selected all reported work and explicitly authorized fixing, merging and pushing. Four verified Fix candidates (001–004) are selected. Research 005–007 begins with its bounded experiment; only proven, bounded outcomes may be reclassified and implemented. Preserve unrelated worktrees and the separate credential-store/native branch. No release, deployment, native user-data or real-provider mutation is included.

## Ownership and ordering

Exactly three specialists continue: Production/adversarial owns 001 and 002; Product/UX owns 003 and the 005 experiment; Architecture/correctness owns 004 and experiments 006/007. Each writer uses a separate checkout, sanitized environment, externally denied runtime, disposable data and shipped fakes. The senior alone integrates and commits. UI may proceed independently of Rust; shared Rust implementation/tests and ADRs are serialized. Each queued Rust slice starts from the last accepted tree. Review loop: worker → senior → distinct peer → senior, at most two correction loops, with receipts bound to the same accepted tree.

## 001 — generation credential custody

Owned: app `lib.rs`, `backup_recovery.rs`, inline tests; amend ADR-0021/0026 before implementation. Persist bounded ownership before raw generation credentials can exist; retry retirement until deletions succeed. Define missing-key and pre-activation behavior without sacrificing old/new recoverability. Acceptance: self-export interrupted at every pre-marker boundary then protect leaves no raw live-key duplicate; both generation deletion failures retain retryable intent; restart retires exact accounts. Run existing restore/cancel/rollback/snapshot/protection matrices. Stop on unreadable generations, dropped safety evidence or unbounded orphan cleanup; rollback protocol changes rather than deleting ambiguous evidence.

## 002 — provider redirects

Owned: app production fetcher and inline tests; amend ADR-0029. Refuse provider redirects before a second request for both validation GET and assist POST, retaining endpoint, payload commitment, auth and reply bounds. Synthetic two-listener 301/302/307/308 tests must observe zero second-origin requests and safe errors. Normal provider parsing must pass. No real keys or endpoints. Stop if the transport changes approved bytes or ordinary response semantics without evidence.

## 003 — modal completion ownership

Owned: CreateTripDialog, EditTripDialog, TripListView/TripDetailView only as necessary, feature tests and scoped browser regression. Persistence invalidation must survive departed views, while only the current modal generation may close, announce or alter a draft. Delay A; dismiss by cancel/Escape/backdrop; reopen B, type and release A success/failure. B/focus survive and persisted A is discoverable. Cover navigation and edit. Preserve exact opener restoration. Roll back if accepted persistence stops refreshing its scopes.

## 004 — durable vault preconditions

Owned after 001/002 acceptance: service_vault.rs, app lib/tests; amend ADR-0017/0030. Under shared operation custody, enforce persistent protection state before setter mutation. Two independent services must not replace an installed passphrase. Preserve clones, CAS sessions, unlock/removal, restore and snapshot protection. Stop on key identity/lifetime regressions.

## Research experiments and conditional fixes

- 005: reproduce retained newer setup's stale revision, then define explicit review/reapply against acknowledged state. No automatic preparation merge. If bounded, amend ADR-0027, show an explicit reconciliation action and prove CAS still refuses independent concurrent writes. Owned by Product/UX after 003.
- 006: simulate selective namespaced-key read failure with fictional keys and existing fake-backed fault injection; verify whether legacy adoption overwrites it. No real keychain. If proven, propagate inaccessible state instead of treating it as absence, while retaining accepted inactive/plaintext behavior. Owned by Architecture after 004.
- 007: raise a disposable current database user_version above supported, reopen and inspect mutation. If proven and compatibility permits, refuse before schema/credential/data mutation with an actionable error; preserve append-only migrations and restore validation. Owned by Architecture after 006.

Unproven or product-ambiguous work remains Research and is not silently coded. Each experiment has one bounded pass; stop if the synthetic setup cannot establish the reported cause.

## Verification, integration and rollback

Inspect all executed scripts/config; no unrelated credentials; separate task caches/config/data; deny external egress for repository execution, permit only disposable loopback. Diagnose the existing Chromium PDF IO.read failure with a minimal contained control before changing product code; never weaken or skip that gate. Run focused tests, original reproductions, neighboring journeys, full `scripts/check.sh all`, credential-shape scan, locked metadata and diff checks. Networked advisory feeds require separately bounded access; do not infer current advisory status from cached tests. Refresh existing Graphify and verify affected queries.

Update the private report with exact before/after evidence and unresolved native/provider/installer limits. Run two four-reviewer council rounds on exact candidate/tree and report digest; retain all blocker closure evidence. Only accepted scope is committed and pushed to a feature branch. Use protected integration, wait for every exact-head hosted check, merge, then verify remote/local main and post-merge CI. No bypass of protection or force-push. Any failing required acceptance or valid council blocker prevents merge-ready status. Revert the bounded slice if it introduces regression; preserve recovery evidence and unrelated state.
