# User-flow continuity and release plan (0.10.6)

The 0.10.5 browser audit exercised six connected journeys against the real loopback Axum service
and a disposable SQLite workspace. It found two reproducible continuity defects: workspace-search
results can retain a contradictory section hash, and engine outages can give List/Search a second
copy of the workspace-level transport error. This plan fixes those defects, repeats the audit after
the fixes, implements any additional verified in-scope gaps from that second pass, and carries the
result through a published and independently verified 0.10.6 release.

The standalone evidence report remains private and outside the repository. It is the before/after
evidence surface; this file is the durable implementation and release contract.

## Product and architecture boundary

The known defects are web navigation and error-presentation defects. They require no domain,
storage, provider, route, or wire-contract change:

- `apps/web/src/App.tsx` continues to own view/history state and the global transport banner.
- Search-hit provenance remains the existing `WorkspaceSearchHit` contract. Its `source` is mapped
  to the section that already owns the corresponding rendered record: documents and notes belong
  to Prepare; confirmed facts, saved places, and traveler-authored items belong to Plan.
- `TripListView` and `WorkspaceSearch` continue to own non-transport errors, while
  `transport/failure` is presented once by the app-level recovery surface, matching the rule
  already shipped by `TripDetailView`.
- No network, AI, visa, price, booking, or autonomous authority is added. Voyalier remains a
  local-first, evidence-backed workspace.

Any second-pass finding will be implemented only when it is Verified or Source-proven, belongs to
the audited local web/desktop product surface, and can be corrected without broadening those
boundaries. External-provider success, real Windows interaction, unavailable credentials, and
native-only states that cannot be exercised remain explicit release limitations rather than guessed
fixes.

## Known gaps and acceptance checks

### G1 — a search destination and its URL disagree

From a trip's Visa section, open Workspace Search and choose a traveler-authored planning result.
The result receives focus in Plan, but `#section-visa` survives in the URL; reload therefore returns
to Visa after the transient search target disappears.

Acceptance:

- A document, note, or saved-resource result writes `#section-prepare`; a confirmed fact, saved
  place, or trip item writes `#section-plan`.
- The search detour's own history entry remains intact, so Back/Forward semantics still satisfy
  ADR-0015.
- Same-trip and cross-trip search results focus the exact record on entry and re-enter the owning
  section after reload.
- No search query or record identifier is added to the URL.

### G2 — transport recovery has two owners

When the engine is unreachable, `App` renders the global Offline banner. List also renders an
identical local Banner with a second Retry; Search renders the same title a second time without a
second Retry. Trip Detail already suppresses local `transport/failure` and preserves other errors.

Acceptance:

- An offline List or Search view exposes exactly one engine-unreachable alert and one global Retry.
- List's storage/internal errors and Search's non-transport errors remain locally visible.
- Reconnection plus Retry clears the transport state and repopulates the view.
- The existing Trip Detail and action-error behavior does not regress.

## Sequence and commits

1. `Docs:` commit this plan before implementation.
2. `Test:` add failing regression cases for both search-section categories, reload-compatible URL
   state, List/Search transport ownership, and retained non-transport errors.
3. `Web:` implement the two narrow shared fixes and replay their exact 320-pixel dark-theme
   reproductions against the real Axum/Vite stack.
4. Run a fresh risk-based user-flow audit across first run/lifecycle, pasted import, evidence review,
   planning, visa preparation, and workspace navigation. Preserve every before capture; add
   same-condition after evidence for resolved gaps.
5. Pass the fresh findings and proposed dispositions through the required two-round four-role
   council. Implement every valid in-scope finding, add focused regression coverage, and repeat the
   original journey plus neighboring states.
6. `Docs:` update the changelog with user-facing behavior and honest limitations. Synchronize
   version `0.10.6` in root `package.json`, workspace `Cargo.toml`, web `package.json`, desktop
   `tauri.conf.json`, and `Cargo.lock` via `cargo update --workspace`.
7. Refresh Graphify and verify one scoped query. Run the focused suites, integration journey,
   `make check`, `git diff --check`, production dependency audit, and credential-string scan.
8. Close the branch with `Merge: user-flow continuity`, merge to `main`, push, and wait for the exact
   main SHA's CI/security/docs gates.
9. Tag that exact SHA as `v0.10.6`. Wait for the protected signed release workflow, inspect the
   draft, and publish only after macOS/Windows bundles, updater signatures, `latest.json`, platform
   checksums, and provenance attestations are complete.
10. Download release assets afresh, verify checksums/metadata/bundle contents, inspect live docs and
    download links, and exercise the installed macOS application separately from GitHub release
    proof.

## Verification charter

- Browsers/layouts: Chromium at 320×720 and 1280×900; light, dark, and persisted System where the
  selected flow supports it; keyboard and pointer. Use a second engine where available and label
  any untested combination.
- Continuity: success, validation, cancel/back/out, recovery/retry, return/re-entry, stale URL,
  repeated action, and destructive-cancel branches for every selected journey.
- Runtime health: failed requests and console output classified against the integration fixture;
  `FakeFetcher::offline()` and unprovisioned local-AI failures are harness limitations, not product
  findings unless production behavior is independently reproduced.
- Privacy: disposable `VOYALIER_DATA_DIR`; no provider keys or real trip data; owner-only temporary
  evidence; raw captures removed after the standalone report is verified.
- Release: exact tag/main SHA alignment, all required artifact names and signatures, updater
  platform entries, checksums, live Pages/docs, and installed-app behavior are separate gates.

Not expanded by this plan: new contract methods, migrations, provider behavior, authoritative visa
or safety claims, hosted services, city-pack contents, autonomous booking, or unsupported platform
claims.
