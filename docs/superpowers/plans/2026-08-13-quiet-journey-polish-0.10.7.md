# Quiet Journey polish and 0.10.7 release plan

Date: 2026-08-13
Release target: 0.10.7
Base: `origin/main` at `60631a281e2dbfcf04cc46f7fe75955f703e9658`

## Goal

Integrate the two verified, still-unmerged continuity branches; repair the three gaps reproduced in
the current Playwright WebKit audit; synchronize the README, public website, guides, captures,
downloads, and release notes with the resulting product; merge the verified tree to `main`; and
publish an exact-SHA 0.10.7 desktop release.

Voyalier remains a local-first, evidence-backed trip workspace. This release does not add booking,
background monitoring, hosted sync, a provider, a contract method, storage schema, or authority over
entry, health, safety, prices, availability, or opening hours.

## Repository integration truth

- `stay-calm-its-codex/userflow-gap-repairs` is already merged into `main` by `60631a2` and will not
  be replayed.
- `stay-calm-its-codex/navigation-trust-repairs` is eleven unique commits on `60631a2`. Integrate it
  first because it owns top-level history, focus, and Search privacy.
- `stay-calm-its-codex/continuity-wave` is twelve unique commits on `60631a2`. Integrate it second;
  resolve overlap from current source and retain its actionable readiness, duplicate-document
  recovery, and one-at-a-time suggestion filters.
- Open Dependabot PR branches are preserved. They are externally owned, not part of this release,
  and must not be deleted or silently folded into the feature work.
- Work happens in an isolated worktree on
  `stay-calm-its-codex/v0.10.7-quiet-journey-polish`. The original clean checkout remains intact.

## Product repairs

### G1 — constrain the planning grid in WebKit

At 320×720, the tested Playwright WebKit build computes `.voy-planning`'s implicit grid track and
children at 394px inside a 280px parent. The root becomes 414px wide; focusing a planning search
result pans the page sideways. Chromium computes the same track at 280px.

Decision: set the planning grid's explicit track to `minmax(0, 1fr)` and use `min-width: 0` only on
the planning children that need it. Keep cards, hierarchy, and shared layout unchanged.

Acceptance:

- Playwright WebKit at 320 and 375 has `scrollWidth === clientWidth` before and after planning
  mounts, and after exact-result focus; `scrollX` remains zero.
- Planning sections match the parent content width. Chromium and the 200%-equivalent reflow remain
  contained.
- Plan validation and exact-record focus still work.

### G2 — make Create Trip return-focus intent explicit

Create Trip opens on From in both tested engines. Escape and Cancel return to the exact opener in
Chromium, but to `<main id="main">` in Playwright WebKit. `TripListView` already owns a persistent
header `createBtnRef`; the shared `Dialog` already accepts `returnFocusRef`.

Decision: pass an explicit return target into `CreateTripDialog`. Preserve the existing meaningful
main/heading fallback after successful creation when an empty-state opener disappears. Do not alter
review-dialog focus semantics.

Acceptance:

- Escape, Cancel, and Close return to the exact connected opener in Playwright WebKit and Chromium.
- Successful creation from the empty state focuses a meaningful page destination rather than a
  removed control or `body`.
- Initial focus, focus trap, validation focus, review handoff, and Strict Mode replay behavior pass.

### G3 — own translated sentence boundaries in markup

Spanish Settings renders `dispositivo.Añade` because `VaultPanel` places two translated text nodes
adjacently. Each translation string has correct punctuation.

Decision: insert an explicit JSX boundary between the translated sentences and assert final
rendered English and Spanish text for both protected and unprotected states.

Acceptance:

- Spanish renders `dispositivo. Añade`; the protected sentence boundary is also correct.
- English remains correct in light/dark at 320px with no overflow.

## Test-first and implementation sequence

1. Commit this plan before implementation.
2. Merge the navigation branch with an explicit merge commit and run its focused navigation,
   backup, Search, and browser tests.
3. Merge the continuity branch with an explicit merge commit, resolve conflicts against the
   navigation tree, and run continuity/readiness/review/import/schedule tests.
4. Add failing focused tests for G1–G3: WebKit browser geometry and return focus, Chromium neighbor
   controls, and rendering-level locale boundaries.
5. Implement the smallest scoped fixes in `apps/web`; add user-facing Unreleased changelog prose.
6. Run focused tests and same-condition browser after evidence before beginning the public refresh.

## Public-surface refresh

The existing Quiet Transit design contract stays authoritative. Refresh Docs evolves it rather than
replacing the brand or framework.

### Verified facts and coverage ledger

Before public edits, record evidence for product job, shipped features, exact UI terms, macOS and
Windows support, source prerequisites, SQLite/vault behavior, network triggers, AI consent,
signing/notarization state, updater signatures, current stable release, and known limitations.
Unsupported claims are removed or qualified.

### Bounded public files

- README: opening promise/actions, platform matrix, current capability story, new screenshots,
  trust boundaries, setup, limitations, architecture, and release links.
- Website/docs: landing page, Download deck and install guide, Introduction, affected feature
  guides, metadata/social preview, design ledger, and shared styles.
- Assets: preserve folded-route logo silhouette; replace public screenshots and social preview only
  with current disposable-runtime captures; inspect every SVG and asset reference.
- Release surfaces: synchronize five version sources plus `Cargo.lock`, convert Unreleased notes
  into 0.10.7 user-facing prose, and keep download links on stable release resolution until the new
  release is actually published.

### Visual direction

- Palette: app charcoal/ivory, indigo structure, vermilion waypoints, moss status, silver rules.
- Type: Shippori Mincho display, Zen Kaku Gothic New body/control, system mono only for artifacts.
- Layout: retain the Workbench split hero and long-document docs; turn the folded-route ledger into
  a compact evidence register whose stops show `source → review → plan → return` using real product
  states. This is the one signature moment; everything else stays quiet.
- Motion: one restrained initial reveal and 1px press; reduced motion shows the complete state
  immediately.

## Documentation and browser acceptance

- Capture from the current app against a disposable `VOYALIER_DATA_DIR` with fictional sample
  data. Inspect light/dark captures and keep UI text readable.
- Build and inspect README asset paths plus the Astro/Starlight website at 320, 375×812, 414, 768,
  1440×900, and a 200%-equivalent reflow pass; keyboard, reduced motion, theme, console, requests,
  anchors, download fallbacks, and root overflow must pass.
- Test live latest-release redirects and the current release assets before writing install claims.
- Preserve public routes and the established framework; delete no asset without proving it
  unreferenced and safe.

## Release and verification gates

1. Run focused web/browser checks while iterating, then `make check`, `git diff --check`,
   `pnpm audit --prod`, and the repository credential-string scan.
2. Run `graphify update .` and a scoped query covering planning containment, Create focus,
   Vault copy, continuity navigation, README/site/downloads, version sources, and release flow.
3. Build the desktop release candidate locally without updater secrets where safe; inspect bundle
   metadata, packaged resources, app version, updater public key, and installer configuration.
4. Run exactly two council rounds with four independent reviewers each; correct and reverify before
   any push.
5. Re-fetch. Require the feature branch to contain current `origin/main`; inspect the full diff and
   clean tree. Merge to `main` without force, push, and require local, fetched, and remote SHAs to
   match.
6. Wait for CI, Docs, Security hygiene, and CodeQL on the exact `main` SHA. Verify the served Pages
   site and download fallbacks before tagging.
7. Create annotated `v0.10.7` on that exact SHA and push it. Approve each serialized protected
   release leg only after verifying the previous leg and exact-SHA state. The workflow must create
   a draft; do not publish it as stable until all artifacts are present.
8. Verify macOS tarball/DMG, Windows EXE/MSI, both updater signatures, both checksum manifests,
   `latest.json` with `darwin-aarch64` and `windows-x86_64`, provenance attestations, source
   archives, release notes, tag/main alignment, `/releases/latest`, and live docs.
9. Launch an isolated extracted macOS bundle with disposable data; inspect version/bundle/signature
   structure and exercise the repaired paths if the current session permits native UI. Windows
   runtime and manual screen-reader speech remain explicit limitations unless separately observed.
10. After remote `main` and the release are verified, inventory every original branch again. Delete
    only exact refs proven integrated or patch-equivalent; preserve open-PR and ambiguous work.

## Commit discipline

Commits follow layer order: plan, branch integrations, failing tests, web fixes, docs/assets,
version/release notes, verification corrections, and final `Merge: quiet journey polish 0.10.7`.
Bodies state the defect or source branch, the product boundary preserved, and verification.
