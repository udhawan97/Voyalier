# Workspace Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development.
> Red-green-refactor every task — failing test first, watch it fail, minimal code,
> commit. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can export their entire Voyalier workspace to a single
passphrase-encrypted file, and restore it — on the same machine or a new one —
recovering every trip, imported document, confirmed fact, and downloaded pack
exactly as it was. This closes a genuine data-loss hole: Voyalier is local-first,
sealed at rest, and its optional vault passphrase has **no recovery**, yet today
there is no way to back the data up or move it. It also closes the open Lane-6
`6g` "documented backup story" item (`docs/product/APP_AUDIT_AND_POLISH_PLAN.md`).

## Why the crypto model is forced

Every sealed row (confirmed-fact payloads, imported document text, pending
candidates) is encrypted with a 32-byte XChaCha20-Poly1305 **data key that lives
in the OS keychain** (`VAULT_KEY_ACCOUNT = "vault.data_key"`), or wrapped under an
Argon2id key derived from the user's optional passphrase — never in the database.
So a raw copy of `voyalier.sqlite3` is worthless on another machine: its keychain
has no data key and every sealed row is undecryptable. A backup is only *real* if
it carries a portable way to recover that key. Hence: the backup re-wraps the data
key and seals the whole snapshot under a **backup passphrase** the user sets.

## Decisions (locked with the owner, 2026-07-18)

1. **Portable, passphrase-encrypted** — restorable on any machine with the passphrase.
2. **Replace whole workspace** on restore (not merge) — reversible via an
   automatic pre-restore safety snapshot.
3. **`tauri-plugin-dialog`** for native save/open pickers; all file IO stays Rust-side.
4. **Full user-facing slice**, shipped as a **desktop-only capability** following
   the **updater pattern** (Rust command wrappers + a web module calling `invoke`,
   *not* the 6-place gateway contract). `packages/contracts`, `mock.ts`, and the
   HTTP transport are untouched — backup/restore means nothing over HTTP.
5. **Restore is staged and applied on next launch** (owner call, 2026-07-18): the
   decrypted snapshot + carried key are staged; the swap happens at startup before
   the SQLite connection opens. Safer than live-connection surgery (no Windows
   file-lock races), same posture as the updater's staged restart, and cleanly
   testable end-to-end. Costs one restart after a restore.

## Scope

**In:** the SQLite workspace file — trips, itinerary facts, imported documents,
pending candidates, downloaded packs (`downloaded_packs.content` is in the DB),
all snapshots (weather/advice/facts/holidays/etc.), settings, and `vault_meta`.
Plus the carried data key so sealed rows open after restore.

**Out (re-establishable, documented as such):**
- **On-disk PMTiles map archives** (`<data-dir>/maps/<pack>-<sha>.pmtiles`) — large,
  content-addressed, and re-downloadable/re-verifiable. Not in the DB; not in the backup.
- **BYOK provider API keys** (OpenAI/Anthropic, keychain per-provider) — third-party
  secrets the user already holds; exporting them into a file is a needless spill.
  Re-enter after restore. Recorded in the docs page and the restore result.
- **The internal `backups/` residue directory** (pre-update snapshots) — excluded, as
  `backup_database` already documents.

## Global constraints

- **No network.** Pure local file IO, Rust-side. The webview never gets raw FS —
  `tauri-plugin-dialog` returns only a path; Rust reads/writes (mirrors the updater's
  "no hidden capability" posture, `apps/desktop/src-tauri/Cargo.toml`).
- **Secrets never leak.** The backup passphrase and the data key are never logged,
  never returned to the webview, never persisted except: the data key sealed inside
  the container, and (transiently, between stage and apply) the carried key in the
  keychain under a dedicated staging account, deleted on apply.
- **Wrong passphrase / tampered file → a clean AEAD failure with zero partial state.**
  Validate magic + format version before deriving anything; nothing is written to the
  live workspace until an `apply` at startup, which first takes a safety snapshot.
- **Restore always lands in keychain mode.** Apply installs the carried key as
  `vault.data_key` and deletes any source `vault_meta` passphrase-wrap row, so the
  restored workspace opens unlocked. The user re-enables a vault passphrase separately
  (existing feature). The backup passphrase is only the *file's* lock.
- **Migrations forward-only.** A backup whose `schema_version` exceeds the app's
  `target_schema_version()` (currently **9**) is refused ("made by a newer Voyalier");
  an older one is migrated forward by the existing ledger after the swap.
- TDD throughout; `cargo test --workspace` + clippy (0 warnings) + fmt, and
  `pnpm typecheck && pnpm test && pnpm build` green before merge.

## Container format — `.vbk` (Voyalier BacKup)

One authenticated blob. Everything after the header is sealed under the
backup-passphrase KEK, so even plaintext DB columns (trip names, dates) are opaque.

```
magic          : 4 bytes  = b"VBK1"
format_version : u16 LE   = 1                     (validated before anything else)
salt           : 16 bytes (random; Argon2id salt)
nonce          : 24 bytes (random; XChaCha20 nonce)
sealed_body    : rest     = seal(kek, nonce, plaintext_body)
                 where kek = derive_key(passphrase, salt)   [Argon2id]
```

`plaintext_body` (recovered only with the right passphrase, then parsed):

```
key_present    : 1 byte   (1 = a data key follows, 0 = vault was inactive/plaintext)
data_key       : 32 bytes (present iff key_present == 1)
manifest_len   : u32 LE
manifest_json  : manifest_len bytes  (BackupManifest, authenticated as part of the seal)
snapshot       : rest     (the consistent SQLite file bytes)
```

`BackupManifest { format_version: u16, schema_version: i64, app_version: String, created_at: String }`.
`magic`/`format_version` are also fed as AEAD associated data so a header edit fails the open.

---

## Task 1 — Core: the backup container (pure crypto), `voyalier-core::backup`

**Files:** create `crates/voyalier-core/src/backup.rs`; modify `lib.rs`. Reuses
`vault::{derive_key, seal, open, VAULT_KEY_LEN, VAULT_NONCE_LEN, VAULT_SALT_LEN}`.

**Interfaces:**
- `BackupManifest { format_version, schema_version, app_version, created_at }`
- `seal_backup(passphrase: &str, manifest: &BackupManifest, data_key: Option<&[u8; 32]>, snapshot: &[u8]) -> Result<Vec<u8>, AppError>`
- `open_backup(passphrase: &str, container: &[u8]) -> Result<OpenedBackup, AppError>`
  where `OpenedBackup { manifest, data_key: Option<[u8;32]>, snapshot: Vec<u8> }`
- `BACKUP_MAGIC: &[u8;4]`, `BACKUP_FORMAT_VERSION: u16`.

- [ ] **Step 1 — Failing tests:**
  - `round_trips_a_backup_with_a_data_key`: seal with a known key + manifest + snapshot bytes;
    `open_backup` with the same passphrase returns an equal manifest, the same key, the same snapshot.
  - `round_trips_without_a_data_key` (`key_present == 0` path).
  - `a_wrong_passphrase_cannot_open`: `open_backup("nope", …)` is `Err` (AEAD failure), not a panic.
  - `a_tampered_container_is_rejected`: flip a byte in the body → `Err`; corrupt the magic → `Err`
    (`ValidationInvalidInput`); a truncated container → `Err`, never a slice-index panic.
  - `refuses_an_unknown_format_version`: header with version 2 → `Err` before any key derivation.
- [ ] **Step 2 — Verify failure.**
- [ ] **Step 3 — Implement.** Assemble/parse the byte layout above with checked slicing
  (bounds-check every field; `.get(range).ok_or_else(invalid)`). `seal_backup` builds
  `plaintext_body`, derives the KEK, seals. `open_backup` validates magic+version, derives,
  opens, then parses the body with the same checked slicing.
- [ ] **Step 4/5 — Verify pass; commit** `"Core: passphrase-encrypted backup container"`.

## Task 2 — App: export, `AppService::export_backup`

**Files:** `crates/voyalier-app/src/lib.rs`.

**Interface:** `pub fn export_backup(&self, passphrase: &str) -> Result<Vec<u8>, AppError>`
returns the `.vbk` bytes (the desktop command owns the dialog + file write; returning bytes
keeps this unit-testable). Enforce a minimum passphrase length (reuse the vault's rule).

**Mechanics:**
- Refuse if the vault is **locked** (passphrase set but not unlocked this session) — no active
  key to carry: `Err` "unlock the vault before exporting".
- Consistent snapshot: lock the connection, `PRAGMA wal_checkpoint(TRUNCATE)`, read the main
  `.sqlite3` bytes (the proven `backup_database` technique, minus writing a sibling file).
- Active data key: add a crate-private `Vault::active_data_key(&self) -> Option<[u8;32]>`
  (returns the in-memory key when active/keychain/unlocked; `None` when inactive/plaintext).
- `manifest = { BACKUP_FORMAT_VERSION, target_schema_version(), CARGO_PKG_VERSION, now_rfc3339() }`;
  `seal_backup(passphrase, &manifest, key.as_ref(), &snapshot)`.

- [ ] **Step 1 — Failing test** (`open_path_with_deps` + `MemorySecretStore`): create a trip with
  a sealed fact, `export_backup("correct horse battery")`, then `open_backup` the bytes → manifest
  `schema_version == 9`, a data key is present, and the snapshot bytes begin with the SQLite header
  (`b"SQLite format 3\0"`). A too-short passphrase is refused.
- [ ] **Step 2–5 — Verify fail → implement → verify pass → commit**
  `"App: export the workspace as an encrypted backup"`.

## Task 3 — App: stage + apply restore

**Files:** `crates/voyalier-app/src/lib.rs`; possibly `vault.rs` for a reload/clear helper.

**Interfaces:**
- `pub fn stage_restore(&self, passphrase: &str, container: &[u8]) -> Result<RestorePreview, AppError>`
  — validate + decrypt (proves passphrase) + schema-check, then stage: write the decrypted snapshot
  to `<data-dir>/pending-restore.sqlite3`, stash the carried key in the keychain under
  `vault.pending_data_key` (base64) with a `key_present` marker, and write a `pending-restore.json`
  marker (source `created_at`, `app_version`). Returns `RestorePreview { created_at, app_version }`
  for the confirm UI. Refuses a newer-than-`target_schema_version()` backup here, before staging.
- Startup hook `apply_pending_restore(secrets, data_dir) -> Result<Option<RestoreApplied>, AppError>`,
  called inside `open_path_with_deps` **before** `Connection::open`:
  1. No marker → `Ok(None)`.
  2. Safety-snapshot the current live DB into `backups/` as `pre-restore-<stamp>.sqlite3`.
  3. Atomically replace `database_path` with the staged snapshot (write-temp + rename).
  4. Move `vault.pending_data_key` → `vault.data_key` (or, if `key_present == 0`, delete
     `vault.data_key` so a fresh vault initialises).
  5. Open a short-lived connection, `DELETE FROM vault_meta` (drop any source passphrase wrap →
     keychain mode), run `migrate` forward, close.
  6. Delete the staging file, the staging key, and the marker. Return `Ok(Some(applied))`.
  Then normal open proceeds: `load_or_init` sees the installed key + clean `vault_meta` → unlocked.

- [ ] **Step 1 — Failing end-to-end test** (no live-connection surgery needed):
  - Build **workspace A** at path A with a trip + a sealed fact; `export_backup` → bytes.
  - Build **workspace B** at path B with different trips (same shared `MemorySecretStore` is fine to
    model one machine; use a second store to model a new machine).
  - `service_b.stage_restore(pass, &bytes)` → a marker + staging file exist at B's data dir; B's live
    data is still intact (nothing swapped yet).
  - Simulate restart: drop `service_b`, `AppService::open_path_with_deps(pathB, …, secrets_b)` again →
    `apply_pending_restore` fires; the reopened B now lists **A's** trip, the sealed fact **decrypts**
    (key was carried + installed), a `pre-restore-*` safety snapshot exists, and the marker is gone.
  - `stage_restore` with a wrong passphrase → `Err`, no marker written.
  - `stage_restore` of a container whose manifest `schema_version = 999` → `Err` "newer Voyalier",
    no marker written.
- [ ] **Step 2–5 — Verify fail → implement → verify pass → commit**
  `"App: staged workspace restore applied on next launch"`.

## Task 4 — Desktop: dialog plugin + Tauri commands

**Files:** `apps/desktop/src-tauri/Cargo.toml`, `.../src/lib.rs`,
`.../capabilities/*.json`, `.../tauri.conf.json` (plugin permission).

- [ ] Add `tauri-plugin-dialog = "2"` under the same per-OS `[target.'cfg(...)']` block the
  updater uses; register `.plugin(tauri_plugin_dialog::init())`.
- [ ] Commands (wrap the app methods; IO stays Rust-side):
  - `export_backup(passphrase) `→ open a native **save** dialog (default name
    `voyalier-backup-<date>.vbk`); if the user picks a path, `service.export_backup` then write the
    bytes; return `{ path }` or a cancelled signal. Passphrase arrives via the command input, never a dialog.
  - `stage_restore(passphrase)` → native **open** dialog filtered to `*.vbk`; read the chosen file,
    `service.stage_restore`; return the `RestorePreview`.
  - `restore_pending() -> bool` / surfaced via existing status so the UI can prompt the restart.
- [ ] Register all in `generate_handler!` **and** add them to the `every_tauri_command_requires_the_input_arg_key`
  command-list test.
- [ ] Verify `cargo build -p voyalier-desktop` (all targets) + the desktop tests.
- [ ] Commit `"Desktop: backup/restore commands + tauri-plugin-dialog"`.

## Task 5 — Web: Settings surface + i18n + tests

**Files:** create `apps/web/src/backup/tauriBackup.ts` (mirror `updater/tauriUpdater.ts`),
a `BackupPanel` in the Settings screen, `apps/web/src/i18n/*`, a test file.

- [ ] `tauriBackup.ts`: `invoke`-based `exportBackup(passphrase)`, `stageRestore(passphrase)`,
  Tauri-detection so the panel renders **"Back up & restore (desktop app only)"** disabled in the
  web/mock harness — exactly how the updater degrades.
- [ ] `BackupPanel` (in Settings, beside Updates/Encryption): an **Export** action (passphrase entered
  **twice** + a blunt *"There is no recovery if you lose this passphrase"* warning mirroring the vault
  copy; mismatch blocks), a **Restore** action (pick file → passphrase → preview `created_at` → confirm →
  "Restart to finish restoring" prompt), and a short line naming what a backup does **not** include
  (map downloads, AI provider keys).
- [ ] i18n `backup.*` keys (English source of truth). Type-safe against `MessageKey`.
- [ ] Component tests via a fake invoke bridge: export calls through with the passphrase; a passphrase
  mismatch blocks export; restore shows the preview then the restart prompt; the panel is disabled in
  non-Tauri mode.
- [ ] Commit `"Web: backup & restore panel in Settings"`.

## Task 6 — Docs, changelog, verify, merge

- [ ] `CHANGELOG.md` `[Unreleased] → Added`.
- [ ] A **"Back up & restore"** docs-site page (closes Lane-6 `6g`): what's included/excluded, the
  no-recovery passphrase warning, the restart-to-apply step, and where files live. Cross-link the
  Troubleshooting "where data lives / back up or reset" section.
- [ ] Full sweep: `cargo test --workspace`, `cargo clippy --workspace --all-targets` (0 warnings),
  `cargo fmt --all --check`; `pnpm typecheck && pnpm test && pnpm build`; `prettier --write` this
  slice's files only.
- [ ] Drive the real app on the mock gateway (:5174), confirm the panel renders + the desktop-only
  degrade; screenshot the Settings panel.
- [ ] Merge to `main` + push.

## Self-review

- **Spec coverage:** the five locked decisions each map to a task — crypto model (Task 1), portable
  export (Task 2), replace-workspace + staged apply + safety snapshot + forward-migration + newer-refused
  (Task 3), dialog plugin (Task 4), full user-facing slice as a desktop-only capability (Tasks 4–6).
- **Correctness risks named:** vault state at export (locked → refuse; inactive → `key_present == 0`);
  the restored DB's own `vault_meta` is cleared on apply so it can't re-lock against a keychain key;
  staging is inert until an atomic startup swap that safety-snapshots first, so a crash mid-restore
  loses nothing.
- **Not hand-waved:** the staged-restart mechanic is the one place live-connection surgery was avoided
  on purpose; the end-to-end app test (export A → stage into B → reopen B → A's sealed data decrypts)
  exercises the whole chain without needing to mutate an open connection.
- **Excluded, honestly:** map archives and provider keys are out, surfaced in both the UI and the docs
  so a restored-and-surprised user is impossible.
