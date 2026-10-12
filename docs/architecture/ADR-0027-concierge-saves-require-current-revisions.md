# ADR-0027: Concierge saves require current revisions

Status: accepted, 2026-10-08

Extends ADR-0012 and ADR-0023. Addresses DR-ea305767-003 and -004.

## Decision

Keep the typed whole-profile setter. A profile carries an optional, opaque,
server-owned `revision`. Absence means the profile has never been persisted,
not permission to overwrite an existing profile. The setter takes an immediate
SQLite transaction, compares the supplied revision with the stored revision
before history or invalidation changes, validates and persists the whole profile,
then returns its actual newly stored revision. Every successful persistence
rotates the revision, including internal trip invalidation and source unlinking.
Stale or missing preconditions on an existing profile fail without mutation.

Legacy stored payloads remain readable without a migration or write-on-read.
Records derives their stable revision from the exact decrypted stored JSON with
a domain-prefixed SHA256 identity until the next accepted persistence installs
an opaque revision. Custody stays in Records and the sealed profile payload;
no additional plaintext profile column or migration is introduced.

The UI coordinates saves through one owner and preserves rejected or newer
drafts. A saved profile change requires explicit review and reconciliation;
preparation state is never automatically merged. Requests and acknowledgements
must retain their originating identity so an older refresh cannot replace a
newer acknowledged write.

Document deletion clears only matching embedded `sourceDocumentId` references
in the same transaction as source deletion and existing fact/history tombstones.
Authored labels, notes, people and preparation requirements survive. Attachment
deletion follows the same lifetime rule. Internal changes rotate revisions, so
an old profile cannot silently restore a detached source reference.

## Compatibility

This explicitly approves a safety tightening of the existing versioned setter:
legacy clients may read and create a first profile, but existing-profile writes
that omit the precondition are refused with an actionable validation error.
Optional deserialization permits that clear error; it does not authorize an
unsafe legacy overwrite. Routes, commands and whole-object envelopes stay the
same. Typed shared-wire tests cover the new nested field because manifest
`"input"` alone cannot prove it survives deserialization.

This cannot make an unpatched older binary safe when it accesses SQLite directly.
Backups preserve revisions; legacy backups receive the same readable derived
identity. Existing append-only migrations and inactive-vault fallback are unchanged.

## Verification

Exercise stale and omitted-precondition rejection without data/history/timestamp
mutation; initial-create races; explicit reread/retry; internal revision rotation;
legacy stored payloads; source unlink transaction rollback; both transports and
the mock; delayed provider/form saves and retained drafts. No installed-webview
or real-keychain acceptance is implied by source-runtime tests.
