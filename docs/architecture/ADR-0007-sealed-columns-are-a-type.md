# ADR-0007: Sealed columns are a type, not a list to remember

- Status: Accepted
- Date: 2026-07-29

## Context

`SEALED_COLUMNS` (`crates/voyalier-app/src/records.rs`) is the single declaration of which
columns the vault encrypts at rest, and `records.rs` exists so that sealing happens where the
columns are read and written rather than being remembered at each `SELECT`. Its module doc is
explicit that there is no `seal`/`open` escape hatch, and the visibility backs that up:
`Vault::seal_field` and `Vault::open_field` are private `fn`, and every call site is inside
`records.rs`.

That is real encapsulation, and it holds today. What it does not do is make a mistake
_impossible_ — only unlikely and, eventually, detected:

- Sealing is hand-written per field, at roughly 35 sites. A read calls `open_field`, a write
  calls `seal_field`, and the `Option` columns repeat a `.map(...).transpose()?` at each of
  their sites. Nothing relates a column in `SEALED_COLUMNS` to the code that touches it.
- The value is a `String` on both sides of the vault. Ciphertext and plaintext have the same
  type, so a forgotten `open_field` compiles and returns `v1:<base64>` to the interface, and a
  forgotten `seal_field` compiles and writes the traveler's text in the clear.
- The guard is `sealed_columns_round_trip_through_the_vault`, which runs after the fact and
  only for columns a fixture happens to exercise. It knows this about itself: it asserts its
  own fixture coverage, failing with "the fixture must exercise every sealed column". A guard
  that has to check it is being given work is a guard standing in for a missing constraint.

The recurring cost is not hypothetical. `latest_visa_nationality` documents that a sealed
column cannot be filtered on, so it reads the newest row and opens it; `update_packing_item`
and `update_trip_item` read and decrypt every row of a trip to modify one. Those are correct
consequences of sealing, and they are easier to reason about when sealing is visible in the
types rather than in call-site discipline.

## Decision

Introduce a crate-private `Sealed` newtype over the stored representation of a sealed column.

- `Sealed` wraps a `String` with a **private** field. `records.rs` can hold one and pass it
  around; it cannot build one from a plaintext `String`.
- The only constructor is `Vault::seal`, and the only reader is `Vault::open`. Both replace
  the current `seal_field` / `open_field`.
- `Sealed` implements `FromSql` and `ToSql`, so a sealed column is read as `Sealed` and bound
  as `Sealed`.
- `SEALED_COLUMNS` stays exactly as it is. It still drives
  `migrate_encrypt_sensitive_columns` and the round-trip test.

### What this does and does not enforce

The two directions are not symmetric, and the difference was measured rather than assumed.

**Reading is enforced.** A sealed column arrives from rusqlite as `Sealed`, and every domain
type it feeds — `PackingItem.label`, `TripItem.title`, `TripNotes.body`, the parsed
`FactPayload` — needs a `String`. The only way across is `Vault::open`, so the compiler now
forces the round trip. Deleting an `open` call is a compile error (`expected String, found
Sealed`), where it previously returned `v1:<base64>` to the interface and waited for a test to
notice. This is the direction the module doc worried about, and it is now closed.

**Writing is not enforced.** `params![...]` is positional and accepts any `ToSql`, so binding
a plaintext `&str` where a sealed column is expected still compiles. Verified by removing a
`seal` call from a write path: it built clean. Closing this would mean giving each insert a
typed row struct instead of a `params!` list, which is a larger change with its own tradeoffs.
`sealed_columns_round_trip_through_the_vault` remains the guard for the write direction, and
the ADR claims nothing more for the type than it delivers.

It is deliberately **not** generic. Every sealed column is text; a type parameter with one
instantiation would be scaffolding for a second one that does not exist.

## Consequences

- A read path that forgets to open is a compile error, not a `v1:` string rendered to the
  traveler.
- The round-trip test keeps both halves of its job but loses weight on one: it is now a
  backstop on the read side and still the only guard on the write side.
- **The type does not reach raw SQL in `lib.rs`.** Roughly 45 sites there use rusqlite
  directly, and one of them could still name a sealed column and ask for a `String`. Today
  none do — the raw SQL that touches sealed tables only names unsealed columns — and the
  existing test remains the guard for that. Closing it properly means moving those tables into
  `Records`, which is a larger change with its own tradeoffs and is not decided here.
- `Option` columns keep their `.map(...).transpose()?`, but the intent now lives in the type
  rather than in a comment beside it.
- Sealed columns still cannot be filtered, sorted, or joined on. That is a property of
  encrypting at rest, not of this change, and the read-then-open patterns that follow from it
  stay.

## Alternatives considered

**Leave it as it is.** Defensible: the encapsulation holds, the test has caught what it was
built to catch, and no leak has shipped. Rejected because the cost of the type is small and
one-time, while the cost of the discipline is paid at every new column — and the sealed set
has grown twice in two releases (planning in 0.5.0, visa in 0.6.0).

**Enforce by lint or textual test** — extend the existing source-scanning tests to reject a
`row.get::<_, String>` naming a sealed column. Rejected as the primary mechanism: it is the
same after-the-fact shape as the current test, and it is defeated by any indirection. It
remains available as a supplement for the raw-SQL sites the type cannot reach.

**Seal transparently inside a custom rusqlite type that opens on read.** Rejected: it would
make a locked vault a `rusqlite::Error` deep inside a row closure, which is exactly the
error-smuggling `records.rs` was created to remove — its module doc names that as one of the
two reasons it exists.

## Amendment — escaped plaintext has an explicit format (2026-09-01)

The original representation used the content prefix `v1:` as its only sealed/plain discriminator.
That made one valid traveler value indistinguishable from ciphertext: plaintext beginning `v1:`
was skipped by activation migration and later sent to the decryptor. A content prefix alone cannot
prove provenance because a traveler can write any prefix.

The stored-text contract now reserves two representations while keeping existing ciphertext
compatible:

- authenticated ciphertext remains `v1:<base64>`; and
- plaintext that begins with either reserved prefix is stored as `p1:<base64(original text)>`.

Ordinary plaintext stays ordinary text. Escaping is recursive: traveler text beginning `p1:` is
also encoded, so a current writer never stores an ambiguous raw `p1:` value. `Sealed` remains the
crate-private storage type and `SEALED_COLUMNS` remains the only declaration of which cells follow
this contract.

An append-only schema step creates a single-row storage-format state. Before that state reaches the
new version, `p1:` is legacy plaintext, not an envelope. The data cutover is backup-first and runs
in one SQLite transaction with the format-state update:

- an active vault authenticates existing `v1:` values, leaves valid ciphertext intact, and seals
  legacy plaintext;
- an inactive vault with no raw `v1:` cell escapes legacy plaintext beginning `p1:` and otherwise
  preserves plaintext; a raw `v1:` cell cannot be authenticated without a key and therefore stops
  the cutover as ambiguous; and
- a crash rolls back both cell rewrites and the format-state update, so the next open retries from
  one interpretation rather than a mixture.

Historical `v1:` text that does not authenticate is irreducibly ambiguous: it may be traveler
plaintext or damaged/wrong-key ciphertext. Voyalier preserves the pre-cutover backup, leaves the
cell and format state unchanged, and fails closed with the explicit vault-unreadable disposition
defined by ADR-0018. It never silently turns an authentication failure into plaintext. New
`v1:`-prefixed plaintext round-trips through the escaped representation without reopening that
ambiguity.
