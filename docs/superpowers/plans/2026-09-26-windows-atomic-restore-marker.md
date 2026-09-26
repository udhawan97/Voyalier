# Windows atomic restore-marker replacement

## Problem

The exact-SHA Windows installed-app release gate stages a portable restore but
the next launch stops with `StorageFailure: Access is denied (os error 5)`.
The first marker write succeeds because the destination does not yet exist.
Startup then advances the same marker with `std::fs::rename`, whose Windows
implementation does not replace an existing destination.

## Plan

1. Amend ADR-0021 to make replace-existing atomic marker writes explicit on
   Windows.
2. Add a small platform-specific replacement primitive: ordinary rename on
   Unix and `MoveFileExW` with replace-existing/write-through flags on Windows.
3. Exercise initial creation and replacement through the real atomic-write
   helper, including the Windows regression path.
4. Run focused tests, `make check`, Graphify update/query, hosted PR checks, and
   the exact-SHA Windows installed updater/restore release gate before tagging.

No backup format, storage schema, keychain protocol, or public contract changes.
