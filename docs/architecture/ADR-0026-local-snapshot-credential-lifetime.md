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

## Amendment — outstanding restore custody (2026-10-21)

ADR-0021 protocol 4 owns pending raw credentials before installation and retries
retirement after a committed restore. Passphrase protection refuses an outstanding
restore marker: finish or cancel that generation first, so a pending raw copy of
the same key cannot remain outside the snapshot protection transition. Indexed
historical credentials retain their existing lifetime and protection rules.

Verify self-export interruptions before/after staging intent and key installation,
then reopen and protect exact notes/files with no surviving raw generation copy.
Inject each committed generation-account deletion failure using the shipped
MemorySecretStore; retain retryable intent and prove successful restart preserves
both live data and the readable old safety snapshot. These checks use fictional
keys only and do not establish native keychain or physical power-loss acceptance.

## Amendment — portable export proves snapshot readability (2026-10-29)

A portable export authenticates every declared sealed column in its completed
SQLite snapshot with the exact data key it will carry before returning a
container. A cached inactive or unlocked vault status alone does not prove that
pair readable. Missing, wrong or corrupt keys and damaged ciphertext refuse the
export with recovery guidance; source rows and credentials remain untouched.
Legitimate plaintext/keyless snapshots and unlocked protected snapshots retain
the existing format and restore behavior. Validation reads the isolated snapshot,
so sibling writes cannot enter the export after its readability check.

Verify unavailable and corrupt synthetic credentials refuse export, then restore
the original credential and recover exact notes and attachment bytes. Exercise
wrong-key and damaged-row authentication, plaintext/keyless and protected-unlocked
exports, inspect/stage, and temporary-snapshot cleanup with the shipped fakes.

## Amendment — verify the pre-update safety copy before installation (2026-11-08)

A requested update must reserve space in the retention policy before publishing
a safety copy. Select older copies eligible for rotation under workspace custody,
keep every historical copy until the candidate is readable, and always retain
the new copy on success. An unavailable historical copy that would be rotated
blocks the attempt before publication. Retrying that refusal must leave file
counts, contents and recovery bindings stable across restart. Discovery accepts
up to the existing 32-entry index limit so workspaces with 17 copies left by an
older build can reopen and use explicit Clear backups. New pre-update copies
use the lower admission bound while recovery history awaits inspection.

Authenticate every sealed column in the completed pre-update snapshot using
its intended data key, or verify that all rows are readable without a key.
A protected workspace must be unlocked for this check and retains its embedded
passphrase wrap. Refuse a new unreadable copy before binding or rotating it and
show a local recovery instruction before download or installation. Historical
copies with missing credentials retain their existing diagnosis and clear paths.
