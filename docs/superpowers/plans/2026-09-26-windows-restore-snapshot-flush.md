# Windows restore snapshot flush

## Goal

Let the installed Windows app durably flush its pre-restore safety snapshot so recovery can commit without weakening rollback guarantees.

## Evidence

The exact-main installed acceptance reaches restore phase `activated` and reports `Access is denied (os error 5)` while snapshotting the pre-restore workspace. The snapshot code reopens the copied temporary file read-only before `sync_all`; Windows `FlushFileBuffers` requires a writable handle.

## Change

1. Reopen the already-created temporary snapshot with write permission and without create or truncate.
2. Add a source guard and behavior coverage for the non-truncating write handle.
3. Run the repository gate, refresh Graphify, merge only with hosted checks, then rerun exact-main installed Windows acceptance before tagging.

## Boundaries

- Preserve the complete rollback snapshot and hash verification.
- Do not suppress flush errors or weaken atomic rename behavior.
- Do not tag or publish v0.12.0 until recovery passes.
