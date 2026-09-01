# ADR-0018 — A decryption failure is not a storage failure

**Status:** Accepted · 2026-08-15

## Context

`ErrorCode::StorageFailure` is produced at roughly thirty sites across
`voyalier-app`. Twenty-six of them are what the name says: a SQLite call
returned an error, a lock was poisoned, a file could not be written, a stored
enum or JSON blob would not decode. Four of them are something else — the bytes
were found exactly where they were expected and could not be turned back into
plaintext:

- `voyalier-core/src/vault.rs` — `vault_open_error()`, returned when the sealed
  input is too short, carries an unusable nonce, or fails its AEAD check
  ("wrong key or tampered").
- `voyalier-app/src/sealed.rs` — `Vault::open`, three times: the value is tagged
  `v1:` but no key is loaded and no passphrase is set; the base64 body will not
  decode; the decrypted bytes are not UTF-8.

The web layer has exactly one copy for the code
(`apps/web/src/app/format.ts` → `error.storage.title` / `error.storage.body`),
so it cannot tell those four apart from the other twenty-six:

> **Local storage is unavailable** — Voyalier couldn't read or write your local
> data. Nothing was changed. \[Retry]

Reproduced in 0.10.7 against the real loopback server, on a workspace whose
sealed columns were written under a vault key it no longer holds:
`GET /api/v1/trips/{id}/candidates?status=pending` answers 500
`storage/failure`, the trip panel renders that banner, and the topbar beside it
reads **Ready** — because `GET /api/v1/trips` reads no sealed column and
succeeds. The screen contradicts itself, and every clause of the banner is
wrong at once:

- Storage is available. The row was read. It is the _decryption_ that failed.
- "Nothing was changed" is reassurance about an aborted write. This was a read.
- Retry is offered and cannot ever succeed. A key does not come back by asking
  again.

The state is not exotic. ADR-0017 records how a workspace ends up holding the
wrong data key — a second data directory that deleted or replaced the shared
keychain account, an orphaned adopted copy, a directory spelled two ways — and
it names the consequence in passing: sealed rows stop opening and "nothing on
screen says why the data is unreadable." That sentence is this ADR's problem
statement. ADR-0017 fixed the cause; the reporting was left alone.

For a local-first product this is not a copy nit. "Your local storage is broken"
and "these records are encrypted with a key this workspace no longer has" are
different situations with different recoveries, and only the second one is
true.

## Decision

A fifth code: **`vault/unreadable`**.

It means: _the stored value was found, and its plaintext could not be recovered._
All four sites above return it. Nothing else does.

The boundary is drawn at encryption, deliberately:

- **`storage/failure` keeps everything else**, including the JSON and enum
  decode failures in `records.rs`. Those are corrupt storage independent of any
  key; the vault is not involved and naming it would be a lie in the other
  direction.
- **It is not `vault/locked`.** Locked means a passphrase is set and has not
  been entered _this session_ — the traveler recovers by typing it, and the
  unlock dialog already owns that conversation. `vault/unreadable` is the case
  with no such door: there is no passphrase to enter, or the key that would
  work is gone.
- **It is not `vault/passphrase_incorrect`.** That code is an answer to
  something the traveler just typed.

`status_for_error` in `voyalier-server` is not extended: the new code falls
through to 500, which is what it already does today and what it should be. No
4xx describes "this server holds your data and cannot decrypt it", and the
condition is not something the request could have avoided.

## Consequences

**The contract grows a value; it does not break.** `ErrorCode` is a closed union
on both sides, mirrored in `AppError.schema.json` and held to the Rust enum by
`every_error_code_is_in_the_contract_schema`, whose non-exhaustive `match` makes
a forgotten variant a compile error rather than a stale list. Both shells ship
the web bundle and the engine together, so no deployed client meets a code its
build does not know; a hypothetical one falls to `describeError`'s default and
reads "Something went wrong", which is vaguer than the new copy and still less
wrong than today's confident, incorrect one.

**The copy has to earn the separate code.** Its body says the records are still
there and encrypted, and offers the two recoveries that do not require guessing
the cause — restore a Voyalier backup made while the records still opened, or
reopen the workspace that can still open them. It does not claim that the key is
missing: the AEAD check cannot distinguish a replaced key from a tampered row,
and malformed ciphertext reaches the same boundary. Neither recovery is a
button Voyalier can render, which is exactly why the banner must stop rendering
Retry: an action that cannot work is worse than no action, because it invites
the traveler to keep pressing it. `isRetryable()` in `format.ts` is the single
definition of that rule, and both banners that offered a load-failure Retry
consult it.

**One sibling stays behind, on purpose.** `unwrap_data_key` in
`service_vault.rs` returns `storage/failure` when the stored wrap record decrypts
to something that is not 32 bytes. It is a vault failure by any reading, and it
is left alone: it is reachable only _after_ a correct passphrase, only from an
explicit unlock, and the unlock dialog answers with its own copy rather than
`describeError`. Moving it would change what that dialog says about a condition
this ADR did not study. If it is ever surfaced through a banner, it should move
then.

**What this does not do.** It does not recover anything, detect _which_ of the
ADR-0017 situations produced the state, or distinguish a wrong key from a
tampered row — the AEAD check cannot tell those apart, and a product that
guessed would be inventing an accusation. The traveler is told what is true and
what the two ways out are, and no more.

## Amendment — an ambiguous legacy prefix also fails closed (2026-09-01)

ADR-0007 now gives current plaintext an escaped representation, but historical databases can
already contain raw text beginning `v1:`. When that text fails authentication, the bytes alone
cannot distinguish traveler-authored plaintext from damaged ciphertext or a wrong key. Guessing
"plaintext" would make a failed authenticity check disappear; guessing "ciphertext" and rewriting
it could destroy valid traveler text.

That condition is `vault/unreadable`. Before any format cutover, Voyalier creates and preserves a
safety backup. It then leaves the ambiguous cell and the storage-format state unchanged, reports
that no data was rewritten, and stops the migration. Retry under the same key is not presented as a
recovery. The safe paths remain restoring a known-readable backup, reopening the workspace that
still owns the correct key, or using a future explicit recovery tool that can preserve both
interpretations for traveler review.

The rule is deliberately asymmetric. A current `p1:` envelope is explicit plaintext and opens as
such; an authenticated `v1:` value is explicit ciphertext. Only pre-cutover raw `v1:` values occupy
the ambiguous state, and authentication failure never silently falls back to plaintext.
