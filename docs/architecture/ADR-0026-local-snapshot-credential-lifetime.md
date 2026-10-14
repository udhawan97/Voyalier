# ADR-0026 — Local snapshot credentials outlive their snapshots

**Status:** Accepted · 2026-10-11

## Decision

Keep portable backup format 1 unchanged. A bounded, owner-private local index
binds exact safety-snapshot basenames and hashes to workspace-scoped SecretStore
credentials. The index contains account names, key/wrap fingerprints and cleanup
intent, never raw keys. Parse at most 64 KiB and 32 entries; recompute every owned
account name before acting. Invalid indices or ambiguous copies preserve evidence.

All pre-update, pre-restore and pre-format copies participate. Adopt existing
copies only with a surviving matching credential, their embedded passphrase wrap,
or verified keyless data. No matching credential means unavailable recovery, not
permission to recreate a key. Retain the old credential before replacing a live
key; publish complete snapshots only. Last-reference cleanup records deletion
intent, unlinks and synchronizes files, then retires credentials idempotently.
Automatic retention refuses to retire an unavailable historical copy. Explicit
Clear backups may remove owned copies after validating their recorded hashes.

Raw and wrapped account identities are distinct. Setting a live passphrase first
adopts matching historical copies and records transition fingerprints, then writes
the live wrap, moves matching raw references to an authenticated wrapped credential,
retires raw shadows and the live raw key, and clears transition intent. Restart
finishes a post-wrap transition before opening successfully; failure refuses
completion. A pre-wrap interruption may remain unprotected. Unrelated workspace
credentials and historical wrappers are never rewritten. Removing today's
passphrase does not remove an older snapshot's passphrase requirement.

Exact historical SQLite bytes are preserved. A live passphrase cannot retroactively
encrypt plaintext already present in an old safety copy. Its protection covers
retained data keys, not the entire historical file. Clear backups removes those
copies; portable encrypted exports remain the appropriate movable backup.

Workspace custody precedes one shared recovery-operation mutex, then connection
ownership/SQLite transactions. Startup repeats pending/sibling checks after taking
that mutex. Product compare-and-swap transactions do not acquire it. Helpers never
reacquire it; registry lookup locks are released before waiting.

Maintenance `backup-recover <owned-basename> [--apply]` diagnoses by default and
stages through the existing generation protocol only on explicit apply. It is a
free app IO function, not a product gateway. Passphrases use non-echo console input,
never argv, environment, metadata, logs or contracts. Unsupported consoles refuse
protected recovery. Successful local recovery still requires normal next-start
activation; a marker is not completion evidence.

Native confirmed exports use a unique sibling temporary file, complete write,
file synchronization and atomic replacement through the app IO helper. Preserve
regular-file permissions, reject file links/directories, and leave automation's
create-new guard intact. Failure before promotion preserves old bytes; failure
of parent synchronization after promotion reports uncertain durability of a
complete new file. Picker cancellation performs no destination writes.

## Verification

Use synthetic MemorySecretStore keys and offline fetchers. Verify distinct-key
notes/files, shared-key last references, all snapshot families, unavailable/corrupt
evidence, protected/keyless recovery, passphrase-transition interruption, deletion
retry and bounded maintenance staging. No real keychain or user workspace tests.
