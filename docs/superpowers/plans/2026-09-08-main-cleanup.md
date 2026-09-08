# Main cleanup — 2026-09-08

Consolidate verified dependency maintenance using the protected, linear-history
main workflow. Preserve existing uncommitted work and runtime artifacts.

1. Inventory every local/remote branch, worktree, open PR, and PR closed since
   2026-09-01. Compare ancestry, complete diffs, and aggregate patch/tree equality.
2. Replay with source provenance the coherent maintenance commits from PRs #80
   (checkout), #81 (CodeQL), #79 (attestation), #84 (Rust), and #83 (JavaScript).
   Keep each unit separate and validate manifests/workflow inputs before moving on.
3. Preserve #67: jsdom 30.0.1 requires Node ^24.15.0 within the Node 24 series,
   whereas the repository declares Node >=24. Do not change that support contract
   as a branch-cleanup side effect. Preserve all dirty worktrees and existing
   clean worktrees containing ignored artifacts.
4. Run the repository gate, production dependency audit, credential-pattern check,
   diff checks, and Graphify incremental refresh plus a scoped query. Use
   disposable workspace data for integration tests.
5. Promote through a protected PR after required CI passes. Re-fetch and verify
   final local/remote main equality before deleting any proven-integrated refs.
6. Remove only this task's clean temporary worktree/ref; retain user-owned
   worktrees. No tag, release, manual deployment, or provider execution.

No product rules, transports, storage, or contracts change; no new ADR is needed.
Attestation action input/permission compatibility is inspected statically; actual
signed release execution remains outside this cleanup.

## Integration decisions

The five selected source commits are replayed separately with `-x` provenance.
The CodeQL overlap retains checkout 7.0.1 and CodeQL 4.37.9. No product source,
version, storage, or contract changes were needed.

Protection currently requires linear history and five status checks, with no
pull-request review rule or additional ruleset. PR #86 runs the checks. Prefer a
normal fast-forward promotion of its verified tip to retain the tested commits;
if protection rejects it, use the normal PR merge path without bypassing checks.
Only prune after fresh remote verification and repeat the preserved-file hashes.
