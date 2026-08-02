# ADR-0017 — The vault key belongs to its database

**Status:** Accepted · 2026-08-02

## Context

`VOYALIER_DATA_DIR` is the documented way to run Voyalier against a workspace
other than the platform default: a development instance, a disposable audit
copy, a second profile. It is the crate's only environment override
(`crates/voyalier-app/src/lib.rs`), and it moves exactly one thing — the SQLite
file.

The vault's data key does not move with it. `KEYRING_SERVICE`
(`"com.voyalier.keys"`) and `VAULT_KEY_ACCOUNT` (`"vault.data_key"`) are
compile-time constants with no path component, so every data directory
belonging to one OS user reads and writes the same keychain entry.

Three ordinary actions then reach for that entry:

- `VaultManager::load_or_init` deletes it when the database it is opening has a
  `vault_meta` wrap row — that is the tidy-up for a crash between writing the
  wrap and removing the raw key.
- `set_vault_passphrase` deletes it as its normal success path
  (`service_vault.rs`), because a passphrase is supposed to replace it.
- A staged restore sets or deletes it, so the restored rows open under the key
  the backup carried.

Each is correct for the database it is acting on and wrong for every other one.
Set a passphrase in a second workspace and the first workspace's key is gone.
Everything in `SEALED_COLUMNS` — confirmed facts, imported documents, candidate
payloads and their evidence spans, notes, packing labels, traveler-authored
items, the passport nationality — fails to open. It fails loudly at the record
layer, but `load_or_init` folds a keychain error into "vault inactive", so the
app keeps running and nothing on screen says why the data is unreadable.

A fourth case is quieter and was happening all along: two directories with no
passphrase silently share one key, so the second one's rows are sealed under
the first one's key and become a dependency of it.

The repository's own test tooling is not exposed — `voyalier-server` injects
`MemorySecretStore` under `VOYALIER_INTEGRATION_TEST`, with a comment saying the
gate must not touch a developer's keychain. The exposure is a human running a
second data directory against `open_default()`, which is the documented way to
get one.

## Decision

The keychain account is derived from the database's own path.

- The **platform default** path keeps the account `vault.data_key`, unchanged.
  Every shipped install already has that entry; none of them migrate, and none
  of them notice this decision.
- **Any other path** uses `vault.data_key.<first 16 hex of sha256(path)>`.
- On first use, a non-default path that finds no namespaced account but does
  find a legacy one **copies** the legacy value across rather than generating a
  new key.

The keychain _service_ stays one constant. Splitting it would fragment the OS's
own view of the app for no gain; the account is the level at which the conflict
happens.

## Consequences

Adoption is the load-bearing part. An install that has been running with
`VOYALIER_DATA_DIR` set since before this change has rows sealed under the
legacy account. Reading the namespaced account first and minting a fresh key on
a miss would have made every one of those rows unreadable — the same data loss
this ADR exists to prevent, arriving through the fix instead of the defect.

Adoption **copies**. A move would be that same bug pointing the other way: the
default install is still using the legacy entry.

The cost is a keychain entry per data directory, which is the honest
representation of what is happening. A traveler who moves their data directory
after first run gets a new account and, on that first open, adopts whatever the
legacy account holds — correct when they are migrating a workspace, and
harmless when they are not, because a directory with no sealed rows has nothing
to lose either way.

Path identity is textual, not canonical. Two spellings of one directory —
a symlink, a trailing slash — resolve to two accounts, and the second one adopts
from the legacy entry rather than from the first. That is a cosmetic duplicate,
not data loss, and canonicalizing would mean touching the filesystem on a path
that may not exist yet.

`crates/voyalier-app/src/tests.rs` carries the guard: two data directories over
one secret store, a passphrase set on the second, and the first one's _sealed_
note still readable afterwards. It was mutation-checked — restoring the shared
account fails it. An earlier version of that test asserted on a trip title and
passed under the mutation, because a title is not a sealed column.
