# ADR-0021 — Restore generations are recoverable

**Status:** Accepted · 2026-09-01

## Context

A portable backup contains two things that have to agree: a SQLite snapshot and, when the source
vault was active, the data key that opens its sealed rows. The filesystem and the OS keychain do
not share a transaction. Treating a database rename and a keychain update as though they were one
atomic operation can leave the live path paired with the wrong key after a crash.

The first restore protocol staged one database at `pending-restore.sqlite3`, one key at a shared
pending account, and one metadata marker. At the next launch it copied the current main database,
renamed the staged file live, removed the old WAL files, changed the live key account, and removed
the marker. Those side effects were individually reasonable, but they were not bound to one
generation and the safety copy did not first checkpoint committed WAL state. A failure between
them could therefore omit committed data, activate a database with the wrong key, or remove the
only evidence needed to recover.

No design can make keychain and filesystem mutations literally atomic. The product guarantee is
instead that every partial state is recognizable and can converge to exactly one readable old or
new generation on restart.

## Decision

### 1. A restore is one named generation

Every staged restore receives a fresh opaque generation ID. Its candidate database, pending-key
account, rollback database, rollback-key account, and marker all include or name that generation.
An existing pending generation must be explicitly cancelled or completed; staging never overwrites
it and cannot mix generation A's database with generation B's key.

The marker is metadata, never secret material. It records:

- the protocol version and generation ID;
- generation-specific candidate and rollback filenames;
- the candidate database SHA-256 and actual SQLite schema version;
- the backup manifest version and schema version;
- key intent (`present` or `absent`) and, when present, a SHA-256 digest of the decoded staged key;
- the old database hash and old-key intent once preparation reaches them; and
- the latest durable phase.

The actual keys remain only in the OS keychain. The marker binds their digests so recovery can
refuse a mismatched account without copying a key into SQLite or a contract payload.

### 2. Staging proves the candidate before it can replace anything

The native picker reads a selected regular file through an explicit byte ceiling before allocating
the complete container. Opening the container proves its passphrase and authenticated manifest.
The staged SQLite candidate is then checked independently: its header, actual
`PRAGMA user_version`, manifest/schema agreement, supported schema, and `PRAGMA quick_check` must
all pass. Required migrations and removal of a foreign machine's passphrase wrap happen in the
staged candidate, not after it is live. Its sealed rows must reopen under the staged key intent.

Only after that validation does Voyalier write the generation marker. Candidate and marker writes
use a temporary file, file synchronization, atomic rename in the data directory, and directory
synchronization. A crash before the marker is durable leaves inert generation debris, not an
activation instruction.

### 3. Activation retains the old pair until the new pair reopens

Before replacing the live database, startup checkpoints its WAL with no product connection open.
Committed WAL state is thereby folded into the main file. Voyalier records the old database hash,
copies the old live key into the generation's rollback account when one exists, and durably records
that prepared state.

Activation then:

1. renames the old main database to the generation's rollback filename;
2. installs or deliberately removes the live data key according to the candidate key intent;
3. renames the validated candidate to the live database path;
4. reopens the live database and repeats the schema, integrity, and sealed-row checks; and
5. records the generation committed.

The old database and rollback key remain available through step 4. Only a successful reopen allows
cleanup of the rollback pair, pending account, marker, and generation debris. The checkpointed old
database is copied into the existing bounded pre-restore backup set before its generation artifact
is removed.

### 4. Recovery uses evidence, not the last phase word alone

Marker updates have crash windows too. On restart, Voyalier compares the marker with the actual
candidate/live/rollback filenames, database hashes, and key digests. The recoverable states are:

- old live, candidate staged: validate and begin, or leave the old generation untouched;
- old renamed, candidate still staged: finish activation or restore the old filename and key;
- candidate live, old retained: revalidate the new pair, then commit or roll back;
- committed marker with cleanup incomplete: keep the verified new pair and finish cleanup; and
- any hash, generation, schema, or key-intent mismatch: refuse activation and preserve the old
  readable pair and all evidence.

A rollback restores the old filename and old key intent together. A keyless old workspace is a
real intent, not a missing-key error. Cleanup never guesses which generation an unbound artifact
belongs to.

The implementation exposes private, deterministic restore checkpoints to tests so every copy,
marker write, key set/delete, rename, reopen, commit, and cleanup boundary can be interrupted. This
is a test hook inside the module, not a new filesystem or keychain trait seam.

## Consequences

- Restore uses more temporary disk space and keychain entries while a generation is pending.
- The startup path is a state machine rather than a one-way rename, but that complexity is the
  irreducible cost of coordinating two non-transactional stores without risking local data.
- Existing `.vbk` format version 1 containers remain readable. This ADR changes local staging and
  activation, not the portable container layout.
- The existing next-launch activation, native picker, explicit confirmation, schema refusal,
  `Records` ownership, and bounded safety-backup retention remain.
- A marker or temporary artifact is not evidence of a completed restore. Completion requires a
  successfully reopened database/key pair.

## Alternatives considered

**Install the key after renaming and rely on the next launch.** Rejected: a crash can leave the new
database live under the old key with no durable rollback instruction.

**Copy only the main database as the safety snapshot.** Rejected: committed state can still live in
the WAL, so the copy can be older than the workspace the traveler approved replacing.

**Put the restored key in the marker or database.** Rejected: keys stay out of SQLite, files,
contracts, logs, and screenshots. A digest can bind intent without becoming secret material.

**Delete the old generation immediately after the candidate rename.** Rejected: a valid SQLite
file can still be unreadable under the installed key. Successful reopen is the commit boundary.
