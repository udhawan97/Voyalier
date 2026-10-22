# Verified main cleanup

## Scope and ownership

Consolidate compatible dependency work through a temporary integration worktree,
then promote through protected main. Preserve every pre-existing worktree.

## Implementation order

1. Apply the compatible subset of the Rust dependency group from PR #133,
   retaining sha2 0.11.0 and uuid 1.26.1 for the declared Rust 1.85 minimum.
2. Apply the Windows API dependency update from PR #121, reconciling only the
   overlapping lockfile resolution with the Rust group.
3. Apply the JavaScript dependency group from PR #134.
4. Apply the CodeQL action update from PR #119.

Each source commit is recorded by cherry-pick provenance. Run focused dependency
metadata and contract checks between candidates. Run the canonical full gate,
production dependency audit, credential scan, Graphify refresh/query and hosted
checks on the completed tree before promotion.

## Preserved candidates

- PR #133 remains open for the withheld sha2 and uuid updates: their package
  metadata requires Rust 1.88 and 1.89 respectively, above core/app Rust 1.85.
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

## Local verification record

The canonical web, Rust and desktop stages passed on the combined dependency
tree. Integration passed after installing the Chromium and WebKit binaries
required by the updated Playwright version: six live HTTP tests and 26 browser
journeys. The initial browser run failed before launch because those binaries
were absent; no assertions were weakened. Production JavaScript and Rust audits
reported zero vulnerabilities; the six existing Cargo warnings remain visible.

Graphify refreshed the code graph and resolved the new cleanup plan in a scoped
query. Some generated/configuration files produce no graph nodes, so source and
test evidence remain authoritative. Promotion still requires all hosted checks
on the final candidate and fresh default-branch evidence.

## Compiler compatibility correction

A package metadata review found that sha2 0.11.1 and uuid 1.28.0 raise the
compiler floor beyond the Rust 1.85 declared by their consumers. Retain the
baseline versions, sha2 0.11.0 and uuid 1.26.1, and preserve PR #133 rather
than deleting its source branch. Desktop-only updates requiring Rust 1.90
remain within the desktop crate's declared minimum. Rerun the affected gate
after this lockfile correction; green stable-toolchain checks alone do not
establish minimum-compiler compatibility.

## Bounded validation repair

The hosted date-clock stale-completion test found Today’s loading status before
the asynchronous loader had called getToday. Await the existing exact old-day
request assertion before advancing the clock; retain both success/error cases
and every stale-result assertion. Product behavior and test timeouts remain
unchanged. Verify the focused test and the canonical web gate, then refresh
Graphify and require all hosted checks on the final candidate.

An actual Rust 1.85 check fails for the same ICU, IDNA and quick-xml packages on
both the original main and the corrected dependency tree. Record this existing
compiler-metadata drift; this cleanup does not claim Rust 1.85 acceptance or
change compiler declarations. The two withheld upgrades would raise additional
requirements and remain in PR #133 for an explicit future decision.
