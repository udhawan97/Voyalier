# Public proof refresh and v0.11.1 release plan

Voyalier v0.11.0 is the current public release at tag `v0.11.0` / commit
`16b8f56c`. The candidate base is clean `main` at `612924d`, sixteen commits
later. The comparison adds Today and disruption continuity, corrects the public
v0.11.0 evidence record, and closes the finite Rust/TypeScript mock-rule parity
debt. This phase makes those facts understandable and provable on the public
surface, then publishes the backward-compatible result as v0.11.1.

## Product and release boundary

- This is a documentation, visual-proof, and release phase. It does not add a
  booking, provider, authority, storage, migration, transport, contract, or
  background-network capability.
- Voyalier remains a local-first, evidence-backed trip workspace for travelers
  who want confirmations, research, plans, preparation, and travel-day context
  together without turning suggestions into facts.
- Today may surface confirmed journeys and traveler-authored plans and return a
  traveler to their source record. The disruption plan may explain exposed
  connections and open the existing local context. Neither predicts a delay,
  monitors a carrier, changes readiness, or clears a safety, health, visa,
  price, availability, or booking question.
- The packaged release remains Apple Silicon on macOS 13 or newer and Windows
  x64. The browser development path remains available from source on compatible
  macOS/Linux hosts and does not imply that GitHub Pages runs the product.
- Packaged builds remain public beta artifacts without paid platform publisher
  identity. macOS is not notarized; Windows may show SmartScreen. Independent
  updater signatures, SHA-256 checksums, and provenance attestations remain
  mandatory release evidence.
- `packs-v1` stays a prerelease and outside `releases/latest`.

## Evidence and coverage ledger

| Surface or claim             | Source of truth                                      | Status                    | Public destination                       | Verification                                       |
| ---------------------------- | ---------------------------------------------------- | ------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Local-first trip workspace   | App runtime, `AGENTS.md`, storage and network tests  | Shipped                   | README, homepage, introduction           | Disposable runtime plus tests                      |
| Today source return          | `today.rs`, `TodayPanel`, route tests and Playwright | Candidate                 | README, homepage, travel-day guide       | Current-source browser journey                     |
| Disruption continuity        | Core contingency rules, `DisruptionPanel`, E2E       | Candidate                 | Homepage and travel-day guide            | Current-source browser journey                     |
| Mock-mode conformance        | Shared parity goldens and both-language tests        | Candidate, internal trust | Architecture/release notes only          | Focused parity plus full gate                      |
| macOS Apple Silicon download | v0.11.0 release pattern and release workflow         | Shipped; v0.11.1 pending  | README, homepage, download guide         | Anonymous artifact and checksum verification       |
| Windows x64 downloads        | v0.11.0 release pattern and release workflow         | Shipped; v0.11.1 pending  | README, homepage, download guide         | Installed acceptance, artifacts, checksums         |
| Updater authenticity         | Tauri config, protected workflow, signatures         | Shipped                   | Download/update guides                   | `latest.json`, signatures, exact artifact bindings |
| Platform publisher identity  | Installer metadata and public install guidance       | Unavailable               | Download, troubleshooting, release notes | Artifact inspection and first-launch copy          |
| Screenshots                  | Disposable current-source workspace                  | Candidate                 | README and homepage                      | Deterministic capture and visual inspection        |

Unsupported metrics, autonomous behavior, background monitoring, commercial
availability claims, and future-platform download claims remain excluded.

## Bounded public surfaces

Expected authoritative changes are limited to:

- `README.md` and the stale desktop-shell `apps/desktop/README.md`;
- `docs-site/src/pages/index.astro`, the existing public styles/design record,
  navigation, and the relevant introduction, download, getting-started,
  planning, readiness, update, troubleshooting, privacy, architecture, and
  roadmap pages;
- current-source assets under `docs-site/public/assets/`, including screenshots,
  the social preview, and only SVG consumers that need factual synchronization;
- `CHANGELOG.md`, a new `docs/release/v0.11.1-release-notes.md`, and the five
  synchronized product-version files plus `Cargo.lock`;
- the smallest documentation/link/capture checks needed to keep the refresh
  maintainable.

Generated `docs-site/dist/` output is verification evidence, not an authored
surface. Existing route trees, Astro/Starlight ownership, logo concept,
packaging architecture, and product behavior remain intact. An obsolete asset
will not be deleted without proving it is unreferenced and obtaining any
required approval.

## Slice 1 - Re-prove the current product

Run the current source against a disposable `VOYALIER_DATA_DIR` and realistic
fictional data. Exercise the full state represented publicly, including Today,
source return, disruption context, evidence review, saved shortlist, packing,
brief sharing, readiness routing, themes, narrow layouts, reduced motion, and
keyboard operation. Inventory the installed v0.11.0 app separately without
opening writable user state.

Capture only current, exercised states. Preserve the folded-route mark,
Shippori Mincho / Zen Kaku Gothic New typography, washi/sumi/indigo/vermilion
palette, and restrained motion. Every screenshot must have a specific public
claim, accurate dimensions, fictional data, useful alt text, and visual review.

## Slice 2 - Refresh the README and public website

Recompose the opening path around one literal promise, direct platform actions,
current product proof, and the authority boundary. Make Today and disruption
continuity legible as one travel-day story: the workspace carries approved
evidence forward, explains fragile handoffs deterministically, and returns the
traveler to the local source they can change.

Keep macOS, Windows, and from-source/browser routes explicit. Dynamic release
discovery must retain a working stable-release fallback. Keep technical depth
below the first-time-user story and avoid generic dashboard cards, invented
statistics, fake browser chrome, and decorative motion.

## Slice 3 - Synchronize depth, downloads, and release notes

Add or update the focused travel-day/disruption guidance, exact UI terminology,
privacy/network boundaries, architecture notes, updater guidance, first-launch
warnings, checksum commands, troubleshooting, and limitations. Correct stale
desktop-shell prose that still describes already-shipped release gates as
future work.

Prepare v0.11.1 notes from `v0.11.0..HEAD`, with Today/disruption continuity as
the user-facing improvement and mock conformance as an internal reliability
change. Bump root `package.json`, workspace `Cargo.toml`,
`apps/web/package.json`, Tauri configuration, and all four workspace package
entries in `Cargo.lock` together; run `cargo update --workspace`.

## Verification

1. Run focused docs, link, anchor, asset, SVG, screenshot, type, and production
   build checks while iterating.
2. Render the site through Obscura first, then perform final acceptance in
   Safari because the public browser surface is user-facing. Exercise 320,
   375×812, 414, 768, and 1440×900, plus 200% zoom, keyboard, light/dark, and
   reduced-motion states. Inspect console and failed requests.
3. Verify README rendering inputs, copy-paste commands, all CTA destinations,
   GitHub release fallbacks, platform labels, checksum instructions, and the
   live v0.11.0 baseline before publication.
4. Run `make check`, `git diff --check`, the production dependency audit,
   credential-shaped string scan, locked Cargo metadata, and a repository-wide
   stale-version/claim/asset closure search.
5. Refresh Graphify and run one scoped query joining current app behavior,
   public proof, downloads, release notes, and release workflow.
6. Build the exact local release candidate, inspect bundle metadata, updater
   configuration, resources, architecture, and code-signature structure, then
   run a disposable packaged-app smoke journey without touching the user's
   workspace.
7. Complete exactly two four-role council rounds. Resolve every valid finding
   and obtain targeted acceptance for any material Round 2 blocker fix.

## Delivery and release

1. Close the reviewed branch with `Merge: public proof refresh and v0.11.1`.
2. Fetch and fast-forward `main` only if local and remote `main` still match the
   reviewed base; push and wait for exact-SHA CI, CodeQL, security, and Pages.
3. Dispatch the keyless release dry-run from the exact candidate SHA and verify
   both desktop bundles before tagging.
4. Create and push the protected annotated `v0.11.1` tag only after the dry-run
   and release gates pass. Approve protected macOS and Windows legs only after
   verifying the exact ref/SHA and the preceding leg.
5. Keep the generated release draft private until every expected artifact,
   `.sig`, checksum file, both required `latest.json` platform keys, signature
   binding, and provenance attestation passes. Then publish it as stable/latest
   with the reviewed notes.
6. Download every public asset anonymously, verify checksums and updater
   metadata, inspect the packaged macOS app, verify Windows installed-app
   acceptance evidence, confirm tag/main/release SHA alignment, and re-open the
   live homepage/download pages. Report the GitHub Pages deployment separately
   from the product release.

## Commit order

1. `Docs: plan public proof refresh and v0.11.1`
2. `Docs: refresh the Quiet Journey public story`
3. `Docs+test: synchronize public proof and downloads`
4. `Deps+docs: prepare v0.11.1`
5. Council-driven corrective commits, named by their affected layer
6. `Merge: public proof refresh and v0.11.1`
