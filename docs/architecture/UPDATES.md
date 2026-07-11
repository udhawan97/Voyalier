# Voyalier in-app updates — FINAL plan (reviewed, ready to implement)

Reviewed by 3 independent agents (Tauri-docs fact-check, user-flow gaps, privacy/security).
All facts verified against official Tauri v2 docs + plugin/tauri-action source. The owner decisions
in §0 are resolved; build after the Phase-3 i18n migration wraps up (D5).

## 0. OWNER decisions — RESOLVED (2026-07-11)

- **D1 — Auto-check = one-time consent ask.** First launch of a packaged build asks once ("Check
  GitHub once a day for updates? Only release metadata is fetched; nothing about you or your trips
  is sent. [Yes] [No, I'll check manually]"). No network until answered → "network only on an
  explicit click" stays literally true. Persist the answer; never re-ask; toggle still in the panel.
- **D2 — Vault-locked users CAN update.** The topbar pill renders pre-unlock and opens a minimal
  update surface without unlocking (updates need zero trip data) → passphrase users still get
  security fixes promptly.
- **D3 — Persistence = `app_settings` KV table** in voyalier-app (durable, testable,
  transport-agnostic; additive gateway methods). Not localStorage.
- **D4 — Platforms = macOS (Apple Silicon / aarch64 only) + Windows.** NOT a universal binary
  (owner call) → Intel Macs do not get in-app updates for now; Linux deferred. `latest.json` needs
  the `darwin-aarch64`(+`-app`) and `windows-x86_64-nsis` keys. (Fact-check #10's universal path is
  therefore unused; the aarch64 runner builds the aarch64 artifact directly.)
- **D5 — Sequencing:** finish the Phase-3 i18n migration first, THEN start the updater at Phase A.

## 1. Core architecture (verified)

Adopt **tauri-plugin-updater v2** + **tauri-plugin-process**, fed by `latest.json` on GitHub
Releases produced by `tauri-action`. Mandatory minisign-style signature verification (pubkey
compiled into the binary) — a real upgrade over FolioOrb's optional signing. We take FolioOrb's UX

- state-machine clarity, not its 1,700 lines of bespoke Python plumbing.

**SECURITY-CRITICAL (reviewer #3, must-do #1): do NOT grant `updater:default`/`process` to the
webview.** JS `check()` accepts caller `proxy`+`headers` → a compromised webview could route the
update through an attacker proxy = a hidden network path, violating our promise. Instead:

- Wrap check / download+install / relaunch in our own **Rust `#[tauri::command]`s** with endpoint
  and options **fixed in Rust** (no caller proxy/headers). Expose only those; the capability grants
  only our commands, not the plugin's raw permissions.
- The `tauriUpdater` gateway calls these custom commands — fits the existing gateway seam cleanly.

## 2. Signing keys (Phase A, one-time, owner custody)

- `tauri signer generate` → keypair. **Pubkey content** (not a path) → `plugins.updater.pubkey`.
  Private key + password → GitHub **Actions secrets** `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`.
- Free updater keys (update authenticity), independent of paid OS code-signing (still deferred).
- **Key-compromise/rotation runbook** is a Phase-A deliverable (`docs/security/UPDATE_KEY_RUNBOOK.md`):
  loss ⇒ installs stranded (manual reinstall); compromise ⇒ **no revocation possible** (old installs
  trust the old pubkey forever) → emergency release signed with old key that embeds the new pubkey,
  and a documented stepping-stone policy (installs that skip it need manual reinstall). Store an
  offline key backup separate from GitHub.

## 3. tauri.conf.json

- `bundle.createUpdaterArtifacts: true`.
- **`bundle.macOS.signingIdentity: "-"`** (fact-check #5: Tauri does NOT ad-hoc sign by default;
  this is the documented mitigation so the arm64 bundle stays consistently signed across the swap).
- `plugins.updater`: pubkey + endpoint
  `https://github.com/udhawan97/Voyalier/releases/latest/download/latest.json`.
- Capabilities: only our custom command identifiers (NOT `updater:default`). Relaunch via a custom
  command too (or minimally `process:allow-restart`).
- CSP: **no change** — updater HTTP is reqwest in Rust, not the webview (verified).

## 4. Release pipeline — HARDEN release.yml (reviewer #3 must-do #2; also closes THREAT_MODEL provenance row)

- **SHA-pin every action** (currently all mutable: `dtolnay/rust-toolchain@stable` is a _branch_).
  A tag/branch move = arbitrary code in the job that holds the signing key.
- **Step-scope the signing env** to the `tauri-action` step only (never job-level).
- **Drop `Swatinem/rust-cache` from the release job** (poisoned `target/` cache → build.rs runs with
  the key in env); build clean.
- **Protected GitHub environment w/ required approval** on the release job; **tag protection** on
  `v*` (block force-push/moves) — else any write token can mint a signed build.
- **Provenance:** add `actions/attest-build-provenance` (free Sigstore, `gh attestation verify`);
  minisign-sign `SHA256SUMS.txt` with the updater key; publish the pubkey fingerprint on the docs
  site (second surface for first-install TOFU cross-check).
- **tauri-action wiring (fact-check #3/#6):** `uploadUpdaterJson` (default true), add
  **`updaterJsonPreferNsis: true`** (MSI is preferred by default; we want NSIS as the promoted
  updatable Windows artifact), pass `GITHUB_TOKEN` + signing env. **Gate `tagName`/`releaseName` on
  tag refs** so `workflow_dispatch` stays a build-only dry-run (empty tagName ⇒ uploads skipped).
  **Remove the separate softprops draft-release job** (would create a 2nd draft/asset conflict);
  append `SHA256SUMS.txt` to the tauri-action draft via a `gh` post-step instead.
- Artifacts (verified): macOS `*.app.tar.gz`+`.sig`; Windows `*-setup.exe`+`.sig` AND `*.msi`+`.sig`;
  `latest.json` (each matrix job merges its platform in). Owner publishes the draft to go live.

## 5. BLOCKER — packs-v1 vs `releases/latest` collision (reviewer #2 blocker #3)

The updater reads `releases/latest`. This repo ALSO publishes city-pack contents as a `packs-v1`
release. GitHub's `/latest` = newest **non-draft, non-prerelease** release → if the pack workflow
(re)publishes after v0.3.0, `latest` flips to packs, `latest.json` 404s, and **every user's update
check breaks**. **Fix (must ship with the feature):** mark all pack releases **pre-release**
(excluded from `/latest`); enforce in `packs.yml` + the release checklist. (Alt: serve `latest.json`
from a stable gh-pages URL — more work, considered.)

## 6. BLOCKER — per-platform flow fork (reviewer #2 blocker #2; fact-check #12)

Windows `downloadAndInstall()` **never resolves** — the process `exit(0)`s during install and the
NSIS installer relaunches the app itself (`/R`). There is **no "ready → restart" step on Windows**.

- **Windows:** consent BEFORE download — button "Update and restart" + copy "Voyalier will close,
  update, and reopen (under a minute)"; terminal UI state is "Installing — Voyalier will close…".
- **macOS/Linux:** download → verify → **"Restart Voyalier"** (swap-in-place; old code runs until
  relaunch). Call `relaunch()` (harmless/unreachable on Windows).
- Progress (fact-check #9): total comes only from the optional `Started` event; `Progress` carries
  `chunkLength` only → accumulate. Show `role="progressbar"` + throttled announce (every ~25%); if
  no total, show bytes-only + indeterminate bar.

## 7. BLOCKER — prove the unsigned-macOS loop + recovery (reviewer #2 blocker #1)

Mechanically the swap works (no quarantine xattr since Rust downloads it; plain rename swap). But
an ad-hoc-signature mismatch after swap could brick launch, and we have **no bundle rollback**.

- **Phase-A/E E2E gate (hard, before v0.3.1):** validate the full loop on real Apple Silicon +
  Windows against a **local endpoint** serving a crafted `latest.json` (draft releases can't be
  E2E'd via the real API — asset URLs 404 unauthenticated; `dangerousInsecureTransportProtocol` is
  dev-only). Confirm install must be in **/Applications** (cross-device `rename` → os error 18
  otherwise; document it).
- **Recovery:** troubleshooting entry "app won't open after an update → re-download; your data is
  safe (it lives outside the app bundle)". Pre-update SQLite backup (below) is the data safety net.

## 8. Frontend seam + state machine (App-level, i18n, a11y)

- **`UpdaterGateway`** (separate from the frozen AppGateway): `{ mode: "packaged"|"devShell"|"browser";
check(); downloadAndInstall(onProgress); relaunch() }`. `mode` (fact-check via Rust
  `cfg(debug_assertions)`/`is_packaged`) fixes reviewer #2's tauri-dev gap — devShell shows "dev
  build — updates disabled", not a live button.
- Impls: `tauriUpdater` (→ our custom Rust commands), `unsupportedUpdater` (browser/source: honest
  dual copy — "run from source: `git pull && make bootstrap`" OR "download the packaged app"),
  `mockUpdater` (scripted, for tests/UI dev).
- **Hook mounts at App level** (not inside the panel) so auto-check + staged-state work regardless of
  route or vault-lock (reviewer #2 e2).
- **Honest, small state machine (reviewer #2 k1 + fact-check #4):** don't reproduce FolioOrb's
  tls/rate-limit/server taxonomy (the plugin gives coarse errors; parsing English strings is fragile
  - un-i18n-able). States: idle → checking → upToDate | available → (win: confirm→installing) |
    (mac: downloading→staged→restart) ; error. Error mapping: `navigator.onLine===false` → "You're
    offline"; everything else → one "Couldn't check for updates — GitHub may be busy or unreachable.
    Try again" + releases link + last-checked. **Never render raw plugin error strings.**
- **Staged-awaiting-restart persistence (reviewer #2 g1):** on macOS the bundle is swapped when the
  user clicks "Later"; persist `staged_version` and short-circuit further checks to "Update
  installed — restart to finish"; clear on next launch by version compare.

## 9. UI (Voyalier patterns: 100% t() catalog, axe-gated, announce())

- **UpdatesPanel** (home, sibling of VaultPanel) + **topbar pill** (pre-unlock capable, `role=status`
  announced once). Version line, explicit **Check for updates** (keep the same Button with `busy` so
  focus/SR isn't stranded), release notes, skip + **un-skip** (a manual check always shows a skipped
  version with "You skipped this — [Un-skip]"; skip only silences the pill; exact-version match).
- **Release notes rendering (reviewer #3 must-do #3):** notes are attacker-influencable
  (`generate_release_notes` pulls fork PR titles). Render as **plain text with inert, https-only
  autolinked URLs opened via the OS browser** (opener), **no images, no data:/file:/javascript:**,
  length-capped, prefixed "Notes from GitHub (unverified)". (Drop mini-markdown entirely — simpler +
  safer than the escape-first approach.)
- **No size promise (fact-check: latest.json has no size):** either HEAD the asset during the same
  consented check for Content-Length, or show a static per-release "~XX MB" estimate. Don't promise
  a size that never appears.
- **Downgrade/first-run toast guards (reviewer #2 j1):** toast only when a _previous_ last_seen
  exists AND current > last_seen; silent (or "reverted") on downgrade; never on the very first
  updater-enabled launch.
- Unsaved-work warning on relaunch (open dialog → "finish or close first"); a11y: progressbar,
  reduced-motion on bar+toast, restart surface focus handling, toast `role=status` non-focus-stealing.

## 10. Pre-update backup (Rust, mirrors FolioOrb backing_up; belt-and-braces)

New AppService `backup_database(label)` → WAL-checkpoint + copy `voyalier.sqlite3` (no `-wal`/`-shm`
strays) to `<data-dir>/backups/pre-update-v{X}-{ts}.sqlite3`, prune to last 5. Tauri command; UI
calls it before install. Note (reviewer #3 #5): deleted trips survive in backups → list the backups
dir in **privacy.mdx** "where data lives", add a "clear backups" affordance, and exclude backups
from any future export/share. Verify data-dir + keychain-service parity between dev and packaged
builds (reviewer #2 b2) so source→packaged users keep their trips.

## 11. Docs sweep (reviewer #2 o1 — explicit checklist, publish-ordered)

privacy.mdx (reword "explicit click" → standing-consent for opt-in auto-check; add backups to data
inventory; two update hosts: github.com + api.github.com/objects.githubusercontent.com) · new
**Download & install** page (which asset; **macOS 15+ Gatekeeper = Settings → Privacy & Security →
Open Anyway**, not right-click-open; SmartScreen; SHA256 check) linked from README · getting-started
(download path first, source second) · troubleshooting (update-failed, won't-open recovery, backups)
· architecture Current-limits (split: update provenance ships; OS signing pending) + network
inventory · THREAT_MODEL (signing/checksums/provenance done; SBOM decision or explicit defer) ·
README (drop "source-only beta" badge/narrative) · roadmap/CHANGELOG · **v0.3.0 release-notes
template** (first self-updating release, install-once, per-OS open instructions, data outside
bundle). Publish order: docs live only after the release is published (README must never point at a
missing download).

## 12. Tests

- Web: `mockUpdater` drives UpdatesPanel through every state incl. win/mac fork, staged-restart,
  skip/un-skip, error, progress, devShell/browser/source copy; axe auto-covers the panel; 100% t().
- Rust: `backup_database` (creates/prunes/checkpoints), app_settings KV, the custom updater command
  wrappers (options fixed; no caller proxy/headers).
- Release: `workflow_dispatch` dry-run builds updater artifacts; local-endpoint E2E of the full loop
  (mac+win) before cutting the real release.

## 13. Phasing

- **A** keys + runbook + tauri.conf (signingIdentity, pubkey, endpoint) + Rust command wrappers +
  capability + `backup_database` + app_settings KV + data-dir/keychain parity check.
- **B** `UpdaterGateway` (3 impls, mode signal) + App-level hook/state machine (per-platform fork,
  honest errors, staged persistence).
- **C** UpdatesPanel + pill + toast + plain-text notes + one-time consent ask + i18n + a11y + tests.
- **D** harden `release.yml` (pins, scoped env, environment+tag protection, attestation, tauri-action
  wiring, SHA256SUMS post-step) + packs-v1 pre-release fix + docs sweep.
- **E** cut **v0.3.0** (first updatable base — must be installed manually once; document the
  chicken-and-egg); local-endpoint E2E first. On **v0.3.1** the real loop self-proves.

## Net changes vs the original draft (what the reviews forced)

Rust-command-wrapped updater (no webview capability); hardened + pinned release.yml + attestation;
packs-v1 pre-release fix (was a silent break); per-platform flow fork (win never resolves);
unsigned-mac E2E gate + /Applications + signingIdentity:"-" + won't-open recovery; devShell mode;
one-time consent ask + App-level mount + pre-unlock pill; staged-restart persistence; honest coarse
error taxonomy (no string-parsing); plain-text https-only image-free notes; no-size reality;
downgrade/first-run toast guards; app_settings persistence; key-compromise runbook; explicit
publish-ordered docs checklist + Sequoia Gatekeeper copy.
