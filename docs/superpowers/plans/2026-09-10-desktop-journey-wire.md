# Desktop journey wire contract

## Selected phase

The next phase is the shared-request serialization gap recorded in ADR-0012 and
the integration-testing guidance in AGENTS.md. Extend the existing source Tauri
IPC harness with a durable journey through import, amendment, stale replacement,
restore, and authored-plan edits. This is a bounded verification phase, not a
new product feature or installed-package acceptance claim.

## Implementation

1. Commit this plan and ADR-0023 before implementation.
2. Add a hand-maintained synthetic fixture under contracts/fixtures with exact
   command envelopes. Pin all selected request fields from explicitly typed web
   gateway calls against the fixture; do not generate it from either adapter.
3. Feed the same fixture into the actual Tauri command dispatcher, substituting
   only runtime-generated record IDs. Assert persisted values and serialized
   output fields through create/import/confirm/replace/restore and plan edits.
4. Prove stale revision requests reject without changing active facts/history,
   approved edits survive, and evidence/calendar lineage survives restoration.
5. Use disposable SQLite and the shipped FakeFetcher::offline and
   MemorySecretStore. No network, user data, native picker, or keychain access.
6. Document the precise coverage and remaining installed-webview boundary. Keep
   routes.json hand-maintained and unchanged; add no dependency or version bump.

## Verification and delivery

Run focused Vitest and desktop tests, then make check, diff checks, the production
dependency audit and credential scan. Refresh Graphify and verify a scoped query.
Complete the product skill's two four-role council rounds, resolve blockers,
commit and push the phase branch, and integrate through the normal protected-main
path when available. Preserve unrelated worktrees and do not publish a release.

## Gate-driven dependency amendment

The production audit found three existing docs-toolchain advisories in the pinned
js-yaml 4.3.1 and svgo 4.0.2 overrides. Update those existing pins to js-yaml 4.3.2
and svgo 4.1.0, regenerate the lockfile, inspect the dependency diff, and rerun
the web/docs gate and audit. References: GHSA-2883-xcg3-v3hh,
GHSA-w27v-7q3p-w38r, and GHSA-4vpr-x523-8j87. This is a dependency gate repair,
not a new library or framework.
