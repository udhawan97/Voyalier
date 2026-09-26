# Windows restore-handle quiescence plan

## Problem

The exact-SHA v0.12.0 Windows release dry run 36218929111 proved the base
installed journey, production updater swap, preserved workspace, portable
backup export, and restore staging. The final recovery launch then failed twice
with Windows error 5, `Access is denied`, while activating the staged SQLite
generation. The existing quiescence check only observes processes whose
executable path exactly equals the installed path; it does not cover a same-name
updater/relaunch process running from a transient path, and it does not prove
that Windows has released the workspace files before the reinstall launch.

## Scope

1. Treat every process with the installed product executable name as part of
   the disposable acceptance app, while retaining the exact-path evidence.
2. Stop each matching process tree and wait until none remains.
3. Before the recovery reinstall, wait until every staged-restore file can be
   opened with exclusive read/write sharing, proving that no old process still
   holds the workspace.
4. Keep both waits bounded and fail with explicit gate diagnostics instead of
   sleeping or weakening the product assertions.
5. Add focused regression coverage, run the full repository gate, refresh
   Graphify, and rerun the exact-SHA Windows installed acceptance before tagging
   v0.12.0.

## Boundaries

- The broader name match is confined to the disposable GitHub-hosted Windows
  acceptance runner and uses the exact installed executable basename.
- The workspace readiness probe is read/write-open only; it does not rename,
  copy, delete, or modify traveler data.
- Product restore, storage, updater behavior, and release artifacts remain
  unchanged unless the stronger evidence exposes a separate product defect.
