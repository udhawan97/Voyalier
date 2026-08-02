# Branch consolidation and main cleanup

The repository has a clean `main`, four auxiliary worktrees, historical local
branches, four feature branches with commits not reachable from `main`, one
worktree with uncommitted pack-selection work, and eleven open Dependabot pull
requests. This plan keeps the novel work, rejects duplicated or unsafe patches,
and leaves one verified canonical checkout on `main`.

## Classification

- Port `fix/bind-address-host-allowlist` onto current `main`. The router must use
  the listener's actual address so a requested port of zero works, and the
  executable must reject non-loopback binds before listening.
- Merge `friendly-wizard-claude/xenodochial-edison-0733c5`, then add a mock
  behavior test so the hand-written TypeScript ranking rule is held to the Rust
  rule it mirrors.
- Merge `friendly-wizard-claude/nifty-hermann-dd0439`; its `Cargo.lock`
  version-sync correction is current and independent.
- Do not merge `friendly-wizard-claude/practical-morse-fd3926` wholesale.
  Commit `e592420` on `main` already implements its publication failure, with
  stronger handling for DuckDB returning an error as successful stdout. Port
  only the missing successful-but-empty assertion and injectable coverage.
- Preserve and adapt the uncommitted `zen-babbage-bfb9ab` follow-up. Separate
  the place and amenity budgets, select deterministically across the whole
  bounding box, retain Overture confidence in the pack, and document the
  provider/query decision before changing it.
- Merge the green dependency branches sequentially. Resolve lockfiles from the
  combined manifests rather than choosing one branch's stale lock.
- Repair the `getrandom` 0.4 and `sha2` 0.11 call sites before accepting those
  currently failing upgrades. Correct the stale setup-node version comments.

## Delivery order

1. Commit this plan, then the city-pack ADR.
2. Integrate deterministic core/category behavior and its mock parity test.
3. Integrate the loopback host repair and current-main call sites.
4. Adapt and commit the pack selection/query work with source-confidence and
   backwards-compatibility tests.
5. Merge dependency branches, repair required source APIs, and regenerate both
   lockfiles.
6. Consolidate the Unreleased changelog and documentation.
7. Refresh Graphify and run `make check`, `scripts/check.sh integration`,
   `pnpm audit --prod`, the repository credential scan, and `git diff --check`.
   Smoke the rendered map because MapLibre crosses a major version.
8. Merge the integration branch to `main`, push it, wait for required checks,
   then remove only worktrees and branches whose work is merged, equivalent, or
   explicitly superseded.

## Boundaries

- No release, tag, or pack publication is part of this cleanup.
- Existing pack files remain readable; new source-confidence fields are
  optional on read.
- The pack's travel-category allowlist remains deliberately broader than the
  persona ranker because accommodation feeds field suggestions without being a
  recommendation dimension.
- Overture's taxonomy migration is follow-up work. This consolidation records
  the current dependency instead of silently widening scope into a second
  provider migration.
