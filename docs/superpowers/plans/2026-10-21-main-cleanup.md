# Verified main cleanup

## Scope and ownership

Consolidate compatible dependency work through a temporary integration worktree,
then promote through protected main. Preserve every pre-existing worktree.

## Implementation order

1. Apply the Rust dependency group from PR #133.
2. Apply the Windows API dependency update from PR #121, reconciling only the
   overlapping lockfile resolution with the Rust group.
3. Apply the JavaScript dependency group from PR #134.
4. Apply the CodeQL action update from PR #119.

Each source commit is recorded by cherry-pick provenance. Run focused dependency
metadata and contract checks between candidates. Run the canonical full gate,
production dependency audit, credential scan, Graphify refresh/query and hosted
checks on the completed tree before promotion.

## Preserved candidates

- PR #135 stays draft: old-store interoperability and native restore acceptance
  remain incomplete.
- PR #130 requires a Node support decision: jsdom 30.1.3 excludes parts of the
  documented Node >=24 range.
- PR #122 fails the Linux desktop build because rfd 0.17.2 requires an explicit
  Linux backend; backend selection is outside this cleanup.
- Closed automation branches contain historical maintenance records, with no
  current product fix to rescue; retain their unmerged refs.
- Dirty and detached worktrees remain protected. Remove only unattached local
  branches proven identical to already merged squash commits.

## Acceptance and rollback

Require the full local gate and all hosted checks on the exact candidate, followed
by remote/local main equality and post-merge checks. Compare preserved worktree
status and file hashes. No release, tag, deployment or installed-app acceptance is
part of this change. Before promotion, abandon only the clean temporary branch if
validation fails; after promotion, use a reviewed revert rather than rewriting
main.
