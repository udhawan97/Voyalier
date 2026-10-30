# Main cleanup — October 30, 2026

## Scope and preservation

Inventory every local/remote branch, PR and worktree from main 45faaf5. Preserve all original staged, unstaged and untracked changes byte-for-byte. Preserve dirty worktrees and their refs. Do not infer software release, native/keychain acceptance or manual deployment authority.

## Integration

1. Verify squash equivalence for the delivered PR139 and PR144 worktrees using trees, aggregate patches, ancestry, PR state, cherry and range-diff evidence.
2. Integrate the compatible JavaScript patch cohort from PR142: typescript-eslint 8.72.0, Astro 7.4.1 and @astrojs/check 0.9.11 with its reviewed lockfile. Preserve Node >=24 and all application behavior/contracts.
3. Preserve jsdom PR143 because its engines exclude part of Node >=24; preserve rfd PR122 pending a supported Linux backend decision and verification. Preserve native-store draft PR135 pending native interoperability/restore acceptance and current-base reconciliation. Preserve unique historical automation notes rather than treating unmerged docs as merged work.

## Verification and promotion

Run a frozen dependency install, the canonical scripts/check.sh all gate (web, Rust, desktop and live integration), production dependency/security hygiene checks, Graphify update and a scoped query. Use disposable fixtures and no real provider/keychain data. Open a reviewable integration PR and wait for every exact-candidate hosted check before merge. Verify the merged tree, post-main workflows and synchronized main independently.

## Cleanup and rollback

Back up exact retired branch commits and useful ignored graph/test evidence privately before removing only the clean, proven-equivalent PR139/PR144 checkouts and refs. Close PR142 only after its whole patch is present on main, then delete the equivalent source ref. Remove this temporary integration worktree/ref after promotion. Recompare every preserved status, diff and dirty-file hash. The remote source branches and private bundles provide recovery; no force pushes, stashes or hard resets.
