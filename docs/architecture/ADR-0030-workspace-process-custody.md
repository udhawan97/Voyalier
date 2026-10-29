# ADR-0030 — Workspace process custody precedes recovery

**Status:** Accepted · 2026-10-08

## Evidence

Two disposable processes using `FakeFetcher::offline()` and synthetic
`MemorySecretStore` keys reproduced supported overlap. The first retained its
AppService and a pinned SQLite read transaction, then committed a note to WAL.
A pipe barrier released the second process to activate a staged restore. It
succeeded while the first remained alive. Reading the pre-restore safety copy
failed with SQLite `DatabaseCorrupt` (extended code 11). A busy checkpoint had
not proved that committed WAL state reached the main file.

## Decision

Acquire an exclusive nonblocking OS file lock before recovery, migration, or key
changes at service open. The lock file is a stable sibling of the replaceable
database. Its open handle lives across service clones; the kernel releases it
after the last handle or process death. No sentinel deletion, PID guessing,
wait loop, network dependency, or minimum-Rust-version increase is needed.

Within one process, canonical workspace paths share a weakly registered Arc
guard so independent service connections remain available for compare-and-swap
and consent checks. Opening another service while a pending restore exists is
refused if any sibling service remains live: sharing the process guard must
never permit replacement under that sibling's SQLite handle. Maintenance
recovery uses the same guard. Another process fails before touching SQLite,
generation files, or credentials, with a close-other-workspace instruction.

Recovery also checks the checkpoint's result row: a busy response refuses
replacement before removing WAL sidecars, even when an external SQLite reader
does not participate in the process guard.

SQLite still owns transaction concurrency inside the process. This lock owns
cross-process workspace custody, not product rules or a new transport API.
Unix uses advisory `flock`; Windows uses `LockFileEx`. Manually unlinking a
live lock file is unsupported; an empty file left after exit is harmless.
Unix creates owner-private custody files, refuses symlinks/nonregular files,
and verifies owner, permissions and inode identity before reuse. Detectable
pathname replacement fails closed. This does not promise protection against
an actor with the same OS user's authority deliberately replacing a live lock
path across independent processes; custody files must never be unlinked during use.
Restore staging and pending recovery reject a workspace that is itself a file
symlink before generation or key mutation. Replacing that link would create a
regular file under a second lock identity. Safe parent-directory aliases remain
supported; file aliases can be opened normally but cannot be replaced by restore.

## Verification

The two-process regression repeats the pinned-reader/committed-WAL condition,
proves rejection with unchanged generation files, then drops all service
handles and verifies a readable restore and intact old safety note. Independent
same-process connections remain allowed; pending recovery is refused until
the last sibling clone is dropped. Process termination releases custody.

## Amendment — serialized operations recheck durable state (2026-10-21)

The shared operation mutex serializes vault transitions but does not refresh an
independent connection's cached vault. Passphrase installation checks the current
stored wrap while holding that mutex, before protection intent or credential
mutation. A stale sibling must refuse an already installed passphrase; it cannot
replace it. Verify independent services and clones, then removal and a deliberate
new installation, while preserving restore and snapshot-protection behavior.

## Amendment — credential pruning requires quiescent absence (2026-10-29)

A replaceable live database can be absent during restore. Credential pruning
therefore retains pending markers, generation artifacts, historical snapshot
bindings and protection transitions, including malformed or unreadable evidence.
Only a definite metadata absence permits orphan classification; access errors,
unsafe surfaces and ambiguous account/path bindings preserve the registry row
and every credential. Default and unrelated accounts remain outside its authority.

Before classifying an absent workspace, maintenance refuses any live same-process
custody owner and acquires the existing nonblocking OS lock, then the shared
operation mutex. Hold them through evidence rechecks and credential deletion;
retain removed-workspace custody through registry retirement so a fresh service
cannot register against its departing row. Services cannot join maintenance
custody. Never join a live service's guard or remove a custody file. Pruning opens no
SQLite database and does not delete recovery evidence or guess generation accounts.

Dry-run creates no directory or custody file and never writes credentials or
the registry. It checks the process registry and locks an existing custody file
when present. Explicit apply may recreate a definitely absent registered parent
solely to hold the stable custody file. New POSIX directories use mode0700;
Windows directories inherit the surviving parent ACL, whose native privacy
acceptance remains unverified. Check
in-process ownership before creating that surface, refuse path/link ambiguity,
and recheck absence afterward. This permits cleanup of genuinely deleted
workspaces while leaving harmless empty-directory/custody-file residue. Manual
unlinking of a live custody path remains unsupported as above.

Verify a real restore interruption at `rename_old`, then both prune modes retain
registry, notes and provider credentials through successful recovery. Cover live
same/other-process custody, missing-parent and true-orphan cleanup, dry-run
filesystem preservation, corrupt/unknown recovery evidence, metadata failures,
unsafe links, account binding and default-account protection with shipped fakes.
No real keychain or physical power-loss acceptance is claimed.
