# Release bundle-target boundary

**Status:** Approved for implementation by the owner's request to build and merge the next phase

## Why this is next

The public-beta roadmap is complete apart from external feasibility work, paid OS signing, and
large `Later` bets. `docs/architecture/UPDATES.md` records one remaining bounded updater Phase D
defect: the base Tauri configuration requests `bundle.targets: "all"` even though owner decision D4
supports only Apple Silicon macOS and Windows. The release workflow's current two-platform matrix
makes that harmless today, but a future Linux leg could inherit publishable Linux bundle targets
without an explicit product decision.

This phase makes the supported bundle set fail closed in repository-owned configuration. It does
not change the release matrix, updater endpoint, keys, signatures, version, or publication state.

## Product and trust boundaries

- The base Tauri configuration names no publishable bundle target.
- The automatically merged macOS configuration names only `app` and `dmg`.
- The automatically merged Windows configuration names only `nsis` and `msi`.
- No Linux bundle override is added. A later Linux release therefore requires an explicit reviewed
  configuration change, not only a workflow-matrix edit.
- Keep updater artifact generation, endpoint, public key, checksums, provenance, and protected
  environment behavior unchanged.
- Do not create a tag, release, signing key, installer, or updater request.

No ADR is required: this discharges the already-recorded Phase D item in `UPDATES.md` without a
contract, transport, storage, provider, or product-rule change.

## Test-first slices

### 1. Pin the supported bundle matrix

1. Add a Node test that reads the base and platform-specific Tauri JSON files.
2. Assert the base target list is empty, macOS is exactly `app` + `dmg`, Windows is exactly `nsis`
   - `msi`, the sets do not overlap, and Linux package formats are absent.
3. Run the focused test before adding the platform configs. Expected red: the base config still
   requests `"all"` and the platform files do not exist.
4. Add `tauri.macos.conf.json` and `tauri.windows.conf.json`; replace the base `"all"` target with
   an empty list. Re-run the focused test green.

### 2. Put the boundary in the shared gate

1. Name the test `scripts/release-bundle-targets.test.mjs`; the existing `node --test
scripts/*.test.mjs` command then covers it locally and in the hosted web/check job.
2. Run Tauri's config-consuming desktop checks on macOS so the platform override is parsed by the
   real build stack, not only by the static assertion.

### 3. Record the completed boundary

1. Mark the Phase D `bundle.targets` item complete in `docs/architecture/UPDATES.md` and explain
   the fail-closed base plus platform overrides.
2. Add a Keep a Changelog `Fixed` entry describing the release-scope repair and what did not
   change.
3. Keep the roadmap's updater claim aligned without implying a new installer or release.

## Verification and merge gate

- Focused red/green evidence for `scripts/release-bundle-targets.test.mjs`.
- `VITEST_MAX_WORKERS=4 ./scripts/check.sh`, `git diff --check`, production dependency audit,
  credential-pattern scan, and locked Cargo metadata.
- `graphify update .`, followed by a scoped query proving the base and two platform owners.
- Exactly two four-role council rounds, with targeted acceptance for any Round 2 blocker.
- Layered commits, then `Merge: release bundle target boundary`; fast-forward `main`, push, and
  wait for exact-SHA CI, Security hygiene, CodeQL, and Docs success.

No tag, release, signing-key operation, updater request, install, version bump, or manual deployment
is authorized by this plan.
