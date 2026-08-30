# Updater package-boundary hardening

**Status:** Approved for implementation by the owner's request to build and merge the next phase

## Why this is next

The public-beta roadmap is otherwise complete apart from external feasibility, paid signing, and
large `Later` bets. `docs/architecture/UPDATES.md` still records one bounded code-owned defect in
the shipped updater: native commands and plugin registration use Rust's `debug_assertions` as a
proxy for Tauri production/custom-protocol mode. An ordinary optimized `cargo build --release`
therefore registers the updater and can let an explicit **Check for updates** click contact GitHub,
even though that source build is meant to keep the surface disabled.

The repository's tagged-release pubkey guard already exists. This phase closes the independent
package-boundary defect without changing updater endpoints, keys, signatures, versioning, or
release state.

## Product and trust boundaries

- Use Tauri's production-mode signal (`tauri::is_dev()`, backed by the custom-protocol feature),
  not compilation optimization, as the one updater availability decision.
- Ordinary Cargo source builds stay disabled, including an optimized release-profile build. Tauri
  production/custom-protocol mode may register the existing Rust-wrapped updater and may contact
  only its fixed HTTPS endpoint after the traveler's explicit click.
- Keep the webview without updater or process capabilities. Do not add a route, contract method,
  provider, background check, storage field, migration, or caller-supplied endpoint/header.
- Tests must not contact GitHub, install an update, mutate the OS keychain, or create a release.
- This is not OS signing, notarization, Authenticode, a version bump, a tag, or a publication.

No ADR is required: this discharges the already-recorded Phase B clause in `UPDATES.md` and keeps
the existing transport and release contracts unchanged.

## Pre-agreed seams

1. **Native command seam:** invoke the existing `updater_check` and `updater_install` commands
   through Tauri's `MockRuntime` and observe the disabled response/refusal. Do not mock internal
   updater functions.
2. **Build-mode seam:** run that journey in an optimized source build, where the current
   `debug_assertions` proxy is false but Tauri's package signal still says development/source.
3. **Repository gate:** make the optimized source-build regression part of
   `./scripts/check.sh desktop`, so local `make check` and the hosted Desktop IPC job share it.

## Test-first slices

### 1. Optimized source builds remain offline

1. Rename the existing updater command test from “dev builds” to “source builds” and make its
   assertions state that no packaged updater is available.
2. Run only that test with Cargo's release profile. Expected red: the old
   `#[cfg(not(debug_assertions))]` branch attempts the updater path instead of returning
   `status: "disabled"`.
3. Replace every updater availability branch and plugin-registration branch with the same Tauri
   package-mode decision. Keep errors and response shapes unchanged.
4. Re-run the focused test in both ordinary test and optimized source modes. Both must pass without
   a network request.

### 2. Keep the regression in the real gate

1. Add the focused optimized source-mode test to `stage_desktop` after the ordinary desktop suite.
2. Run `./scripts/check.sh desktop`. It must compile and test both the ordinary source shell and the
   optimized source boundary.

### 3. Record the shipped boundary honestly

1. Amend `docs/architecture/UPDATES.md`: mark the package-mode item and the already-shipped pubkey
   guard complete; leave platform bundle targeting and the non-secret settings convention open.
2. Add a Keep a Changelog `Fixed` entry stating the user-visible boundary and what did not change.
3. Mark this small hardening slice in the roadmap's updater paragraph without implying OS signing
   or a new release.

## Verification and merge gate

- Focused red/green evidence for the native updater command test in debug and release profiles.
- `./scripts/check.sh` and `git diff --check`.
- `pnpm audit --prod --audit-level high`, the credential-pattern scan from
  `security-hygiene.yml`, and `cargo metadata --locked --no-deps`.
- `graphify update .`, followed by one scoped query proving the package-mode owner and gate.
- Exactly two four-role council rounds, with targeted acceptance for any Round 2 blocker.
- Layered commits, then `Merge: updater package boundary`; fast-forward `main`, push, and wait for
  exact-SHA CI, Security hygiene, CodeQL, and Docs success.

No tag, release, signing-key operation, updater request, install, or deployment is authorized by
this plan.
