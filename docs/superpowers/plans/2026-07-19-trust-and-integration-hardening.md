# Trust and integration hardening implementation plan

**Date:** 2026-07-19  
**Status:** Approved by the owner  
**Goal:** Restore green `main`, safely complete the crypto dependency migration,
exercise real Rust-to-TypeScript serialization in CI, deepen retrieved-snapshot
invalidation behind one internal module, add a second verified offline-map
target, and absorb the waiting JavaScript dependency updates.

## Constraints

- Preserve ciphertext compatibility. Existing vault and backup bytes must open
  after the `chacha20poly1305` migration.
- Do not suppress deprecation warnings in cryptographic code.
- Keep `voyalier-core` IO-free, `AppService` authoritative, and both transports
  thin.
- Keep remote retrieval consented and evidence-backed. No new background
  network behavior.
- Keep source-specific snapshot payloads and provenance distinct; centralize
  only the cross-source staleness protocol.
- Keep PMTiles bounded, checksum-verified, range-read locally, and attributed
  to Protomaps/OpenStreetMap. Do not mark a pack available until its published
  JSON descriptor and archive both exist.
- Run `./scripts/check.sh`, `git diff --check`, the production dependency audit,
  and the credential-string check before merge.

## Task 1 - Core: restore and migrate the vault dependency

1. Revert the dependency-only `chacha20poly1305` 0.11 merge to recover the last
   known-green baseline.
2. Capture a deterministic ciphertext produced by 0.10.1 as a fixed regression
   vector.
3. Reapply 0.11 and replace deprecated key/nonce conversions with the new typed
   conversion interface.
4. Prove both directions: 0.11 produces the same fixed vector, and 0.11 opens
   the pre-upgrade bytes.
5. Run focused core and app vault/backup tests before the full gate.

## Task 2 - Test: live HTTP serialization in the repository gate

1. Add a bounded integration runner that starts `voyalier-server` on loopback
   with a temporary `VOYALIER_DATA_DIR`, waits for health, runs
   `gateway.live.test.ts`, and always stops the child process.
2. Make `scripts/check.sh integration` the single command used locally and in
   CI; include it in the no-argument repository gate.
3. Add a dedicated CI job that installs the existing Rust/Node prerequisites
   and calls that stage rather than restating its assertions in YAML.
4. Keep the existing create/read/delete and import/confirm/unconfirm/manual
   journeys; they cross the real Axum JSON seam and exercise optional fields,
   tagged payloads, enums, Unicode-capable strings, and structured errors.

## Task 3 - App: deepen the retrieved-snapshot module

1. Move the snapshot-table registry, staleness vocabulary, edit comparison, and
   transactional invalidation into `crates/voyalier-app/src/snapshots.rs`.
2. Give callers one internal interface: compare the validated current/updated
   trip and invalidate affected snapshots within the active transaction.
3. Keep source-specific fetch, parse, persistence, fallback, and provenance
   behavior in their current paths; do not add a universal payload trait.
4. Move the schema completeness assertion to the module so its interface is the
   test surface, then retain AppService behavior tests for destination/origin/date
   edits.

## Task 4 - Core+app: enable Kyoto as the second offline map

1. Mark `jp-kyoto` offline-map capable in the Rust catalog and TypeScript mock.
2. Replace Nashville-specific user copy and tests with bounded multi-pack copy
   that remains honest about approximate download size.
3. Update map architecture and roadmap documentation from a single-city slice
   to Nashville plus Kyoto.
4. After the code reaches `main`, run the existing manual pack workflow for
   `jp-kyoto` against the pinned Protomaps build and `packs-v1` prerelease.
5. Verify the workflow, `jp-kyoto.json`, `jp-kyoto.pmtiles`, PMTiles metadata,
   byte length, SHA-256, release prerelease status, and that `releases/latest`
   still points to the stable app release.

## Task 5 - Deps: absorb and close PR 24

1. Apply the four reviewed updates (`eslint` 10.7.0,
   `typescript-eslint` 8.64.0, `vite` 8.1.5, and `astro` 7.1.1) on this branch.
2. Regenerate the lockfile under the repository's minimum-release-age policy.
   The original PR failed only because Astro had been published hours earlier;
   do not relax the policy.
3. Run the web/docs gate plus `pnpm audit --prod`.
4. Close PR 24 as superseded only after the same versions are on `main` and its
   required checks pass.

## Delivery order

Commit the plan first, then stack implementation commits by layer. Finish with
`Merge: trust and integration hardening`, push `main`, wait for every required
GitHub check, publish/verify the Kyoto pack assets, and recheck the final
`main`/release state.
