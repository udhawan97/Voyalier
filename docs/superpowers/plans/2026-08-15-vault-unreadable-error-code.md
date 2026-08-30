# 2026-08-15 — A decryption failure gets its own error code

Base: `b5a06b2`. ADR: `ADR-0018-a-decryption-failure-is-not-a-storage-failure`.

## Defect

A workspace holding the wrong vault key reads sealed columns as
`storage/failure`, and the web layer's single copy for that code says "Local
storage is unavailable — Voyalier couldn't read or write your local data.
Nothing was changed" with a Retry. Storage is fine, the read succeeded, it was
the decryption that failed, nothing was being written, and Retry cannot work.
Unsealed reads succeed in the same session, so the topbar says **Ready**
underneath the banner.

Reproduced in 0.10.7 against the real loopback server:
`GET /api/v1/trips/{id}/candidates?status=pending` → 500 `storage/failure`,
message "the encrypted data could not be opened (wrong key or tampered)".

## Scope

`vault/unreadable`, for the four sites where the bytes were found and the
plaintext could not be recovered. Everything else keeps `storage/failure`.
ADR-0018 carries the boundary and the two exclusions.

## Steps

1. **ADR-0018** — written first; the contract rule requires it.
2. **RED (core)** — `vault.rs`'s wrong-key test asserts the new code; a second
   test pins the short-input path. Both fail to compile until the variant
   exists, which is the intended first failure.
3. **RED (app)** — a workspace seals a note, its keychain account is replaced
   with a key that never sealed anything there, and the reopened service is
   asked for the note. Modelled on
   `a_second_data_directory_cannot_delete_the_first_ones_vault_key`, which
   already proves a trip title is the wrong thing to assert on — a title is not
   a sealed column. Asserts the code _and_ that an unsealed read still succeeds,
   because that pairing is the on-screen contradiction the defect produces.
4. **RED (web)** — `errorStates.test.tsx`: the trip load fails with
   `vault/unreadable`; the banner carries the new title and no Retry.
5. **GREEN** — `ErrorCode::VaultUnreadable` + serde rename + `as_str`; the
   variant in `AppError.schema.json` and the `ErrorCode` union in
   `contracts/src/index.ts`; `vault_open_error()` and `Vault::open`'s three
   branches repointed; a `describeError` case; copy in both locales;
   `isRetryable()` consulted by the two load-failure banners.
6. **CHANGELOG** under Unreleased.
7. `make check`.

## Deliberately not in scope

- `unwrap_data_key`'s "the stored key was the wrong size" — see ADR-0018.
- `records.rs`'s `from_sql_enum` / `from_sql_json` — corrupt storage, no key
  involved.
- `status_for_error` — the new code falls through to 500, which is correct.
- Any attempt to recover the key, or to tell a wrong key from a tampered row.

## Verification

`make check` (web + rust + desktop). The core schema test's non-exhaustive
`match` is the compile-time guard that the variant reached every list.

## Cleanup integration note

The original work was preserved uncommitted in
`friendly-wizard-claude/hopeful-darwin-64fdcc`. The 2026-08-30 main-cleanup
integrates it from current `main` (`7f8fbae`) without changing the ADR boundary.
Current-source adaptations and verification are recorded in the integration
commits rather than rewriting this original red/green plan.
