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

**Path identity is canonical, and the first draft of this ADR was wrong about
that.** It said two spellings of one directory would resolve to two accounts and
called the result "a cosmetic duplicate, not data loss". It is not. A directory
reached as `./data` and then as `/home/u/data` is one database; the second
spelling finds neither its own account nor — on an install created after this
change — a legacy one, so it mints a fresh key and every `v1:` row already on
disk stops opening. That is precisely the defect this ADR exists to prevent,
arriving through the fix. The parent directory is therefore canonicalized before
hashing (the parent, because `open_path_with_deps` creates it before this runs
while the database file itself may not exist yet), falling back to the raw text
when it cannot be resolved.

The staged-restore key, `vault.pending_data_key`, carries the same suffix for
the same reason, and was missed on the first pass: two workspaces that each
stage a restore before either restarts would otherwise meet at one account.

## Amendment — the provider keys, and why they do not adopt

`api_key.<provider>` was the third account family and the last to be reached.
It had the same defect without the encryption: two data directories shared one
entry per provider, so clearing a key in one removed the key the other was
still using. It now carries the same suffix, so all three families agree about
which workspace they belong to.

It deliberately does **not** adopt. Adoption exists for exactly one reason — a
data key that goes missing makes sealed rows unreadable, and minting a fresh one
in its place destroys them. A provider key that goes missing makes nothing
unreadable: the panel says no key and the traveler pastes one in. Copying a live
credential into a second account to save that paste would spread the secret
further in exchange for a convenience, and this is the one family here that is
someone else's credential rather than a key to the traveler's own data.

So the rule is not "namespace everything the same way". It is: **adopt when the
alternative is destroying data, and only then.**

That leaves a consequence worth naming rather than discovering later. Adoption
copies, so every data directory a traveler points Voyalier at leaves a permanent
copy of the vault data key under a new account. It is the honest cost of the
guarantee — and it needs a way out, which the next section is.

## Amendment — the registry, and `vault-prune`

The copies could not be found again. `SecretStore` has no enumeration and the
`keyring` crate offers none we would take a dependency for, so there was no way
to ask the OS which `vault.data_key.*` accounts exist. Every workspace ever
opened left a key behind, invisibly and permanently.

The missing enumeration is kept ourselves: `vault-accounts.json`, beside the
**platform default** database — never `VOYALIER_DATA_DIR`'s answer, because a
registry living inside one workspace could not describe the others. It records
account names and database paths, never a key. A workspace registers itself on
**every** open rather than only its first, so a registry that is lost, or that
predates this decision, repairs itself the next time that workspace is used.

`voyalier-server vault-prune` reads it, and removes the accounts of workspaces
whose database no longer exists — the vault key, the staged-restore key, and
each provider key, since all three carry the same suffix. It reports by default
and removes only with `--apply`, because the mistake it could make is precisely
the one this ADR exists to prevent. Existence of the database file is the only
signal it uses: anything it cannot prove gone is kept.

Two limits, stated in the command's own output rather than left to be found:

- It can only see workspaces opened since the registry existed. An older orphan
  has to be removed by hand.
- The default installation's bare account is never registered and never pruned.

`MemorySecretStore` reports `is_persistent() == false` and is therefore never
registered — which is what stops `cargo test` writing a registry of temporary
database paths into a developer's real application data directory. That is not a
test convenience bolted on; it is a true property of an in-memory store, and it
belongs on the trait beside the network and keychain fakes.

`crates/voyalier-app/src/tests.rs` carries the guard: two data directories over
one secret store, a passphrase set on the second, and the first one's _sealed_
note still readable afterwards. It was mutation-checked — restoring the shared
account fails it. An earlier version of that test asserted on a trip title and
passed under the mutation, because a title is not a sealed column.
