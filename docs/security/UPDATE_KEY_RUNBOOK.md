# Update-signing key runbook

Voyalier's in-app updater verifies every downloaded update against a **minisign
signature**. The public half is compiled into each installed binary
(`plugins.updater.pubkey` in `tauri.conf.json`); the private half signs release
artifacts in CI. This is **update-authenticity signing only** — it is separate
from paid OS code-signing (Apple Developer ID / Windows Authenticode), which
Voyalier does not yet do. Losing or leaking this key has consequences that
cannot be undone remotely, so treat it with care and keep this runbook current.

## What the key is and where it lives

- **Keypair:** generated once with `tauri signer generate` (minisign-style, with
  a password). The owner holds it; it is **not** in this repository.
- **Public key:** the pubkey _content_ (not a file path) is pasted into
  `apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey` and ships
  inside every build. Its fingerprint is also published on the docs site so a
  first-time installer can cross-check it (trust-on-first-use).
- **Private key + password:** stored **only** as GitHub Actions secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, scoped to
  the release workflow's protected environment. Never commit them, never paste
  them into logs, never echo them in a workflow step.
- **Offline backup:** keep one encrypted copy of the private key + password
  **off GitHub** (a hardware-encrypted drive or a password manager). This way a
  lost or rotated CI secret is recoverable without it being a single point of
  failure that also lives in the same place an attacker would reach.

## First-time generation (owner, one-time)

1. `tauri signer generate -w ~/.tauri/voyalier_updater.key` (choose a strong
   password; store both in your password manager and the offline backup).
2. Copy the **public key** it prints into `plugins.updater.pubkey` in
   `tauri.conf.json`, replacing the placeholder. Commit that change.
3. In GitHub → repo → Settings → Secrets → Actions, add
   `TAURI_SIGNING_PRIVATE_KEY` (the private-key file contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Publish the pubkey fingerprint on the docs site (Download & install page).

## The hard truth: there is no remote revocation

Each installed copy trusts the pubkey baked into it **forever**. There is no
callback, no CRL, no kill switch. Rotating the key only affects _future_
installs and updates that a client will accept — it cannot reach back and
distrust the old key on machines already in the field. Every recovery below is
shaped by that fact.

## Scenario: key lost (no backup, not leaked)

Impact: you can no longer sign updates, so **existing installs are stranded** on
their current version (they will reject anything not signed by the old key).

Recovery:

1. Generate a **new** keypair; update `tauri.conf.json` + the Actions secrets.
2. Cut a new release with the new key. Existing installs **will not auto-update
   to it** (wrong signature) — they must be **reinstalled manually** (point
   users at the Download & install page).
3. User **data is safe** throughout: trips and the vault live in the OS data
   directory outside the app bundle, so a reinstall keeps them (see the storage
   identity test in `voyalier-app` — dev and packaged share the same data dir).

## Scenario: key compromised (private key leaked)

Impact: an attacker who _also_ gains the release channel could push a malicious
**validly-signed** update. Since the pubkey is baked into installs, you **cannot
revoke it remotely**. This is the most serious case.

Recovery — the stepping-stone release:

1. **Contain the channel first.** Rotate the GitHub token(s) and any CI
   credentials, review the release workflow run history, and re-confirm branch/
   tag protection and the protected environment (a leak most often comes through
   CI, not the laptop).
2. Generate a **new** keypair and update `tauri.conf.json` + secrets.
3. Ship an **emergency release signed with the OLD (compromised) key** whose new
   binary embeds the **NEW** pubkey. Existing installs still trust the old key,
   so they will accept this one release — and from then on they trust only the
   new key. This "stepping-stone" is the _only_ way to migrate the fleet without
   a manual reinstall.
4. Installs that **skip** the stepping-stone (e.g. jump several versions at once)
   will reject later releases signed with the new key and need a **manual
   reinstall**. Call this out in the release notes.
5. Keep the old (now-distrusted) key only as long as the stepping-stone release
   is live, then destroy it.

## Scenario: planned rotation (not an emergency)

Use the same stepping-stone mechanism: publish a release signed with the current
key that carries the next pubkey, keep both keys through the transition window,
then retire the old one. Announce it so users on very old versions know a manual
reinstall may be needed.

## Checklist to keep this real

- [ ] Private key + password exist as Actions secrets **and** in an offline
      encrypted backup, in two different places.
- [ ] Pubkey in `tauri.conf.json` matches the private key in CI (a mismatch
      means **no** install will ever accept an update — verify on the first
      `v0.3.1` self-update).
- [ ] Pubkey fingerprint is published on the docs site.
- [ ] Release workflow signing env is step-scoped, the environment is protected,
      and `v*` tags are protected (see `docs/architecture/UPDATES.md` §4).
