# Windows installed-process quiescence plan

## Problem

The exact-SHA v0.12.0 Windows release dry run 34739011943 proved the base
journey, updater swap, updated journey, portable backup export and restore
staging. Both recovery WebDriver attempts then failed because the candidate
process panicked while opening the staged restore with Windows error 5,
`Access is denied`. The harness asked Windows to stop the prior installed app
but did not wait until every matching process had exited before uninstalling,
reinstalling and reopening the same external SQLite workspace.

## Scope

1. Give the Windows acceptance fixture one awaitable process-quiescence seam.
2. Stop the installed application as a process tree, then wait until no process
   with the installed executable path remains.
3. Await that boundary before a WebDriver retry, uninstall, post-update reopen
   and final cleanup.
4. Add a fast regression test that proves the quiescence predicate remains
   false while any matching process survives and completes only at zero.
5. Preserve the existing two-attempt WebDriver startup bound and sanitized
   diagnostics. Product assertions are never retried.
6. Run the focused fixture suite and full repository gate, merge through
   protected `main`, refresh Graphify, then rerun the exact-SHA Windows installed
   acceptance before tagging v0.12.0.

## Boundaries

- This changes release acceptance infrastructure only. Product restore,
  storage, updater behavior and traveler data are unchanged.
- The harness waits for observable process exit instead of sleeping for an
  arbitrary duration.
- A process that does not exit within the existing bounded wait fails the gate
  with an explicit quiescence error.
