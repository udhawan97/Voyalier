# Windows installed-app and updater acceptance plan

The `v0.11.0` feature candidate has passed the source, browser, macOS, documentation, and two-round
council checks, but the release remains blocked because Voyalier's release contract requires a real
Windows installed-app journey and updater replacement. A successful Windows bundle build is not
runtime evidence. This plan adds a reusable Windows-only acceptance harness and runs it against the
exact candidate before merge or publication.

## Boundary

- Run on a GitHub-hosted `windows-latest` machine with a fresh runner image and the supported Tauri
  WebDriver stack.
- Install the exact previous public base, `v0.10.7`, as a current-user NSIS application, then update
  it to the exact `v0.11.0` candidate.
- Generate an ephemeral updater key inside the job. Keep the private key step-scoped; never commit,
  log, cache, attest, or upload it. The production updater key and protected release environment are
  not used by this acceptance harness.
- Override the base build only through a temporary Tauri configuration: point its updater at a
  loopback HTTP endpoint, embed the ephemeral public key, and allow insecure transport only for that
  loopback test. Production configuration remains HTTPS-only and unchanged.
- Apply one repository-pinned, acceptance-only WebView2 automation patch to the detached `v0.10.7`
  source before building it. The patch may only forward EdgeDriver's numeric debugging port through
  the WebView2 API and select a path-safe disposable profile; it must not alter updater, storage,
  contract, or product behavior. Record both the exact public base SHA and the patch SHA-256 in the
  report, fail if any other base file changes, and retain the unmodified candidate as the release
  binary under test.
- Use a disposable `VOYALIER_DATA_DIR`. Do not read or modify a maintainer's workspace, keychain, or
  installed application.
- Do not publish, tag, or merge until the harness, the repository gate, and targeted council blocker
  acceptance all pass on the same candidate SHA.

## Acceptance sequence

1. Build an ephemeral-key-signed `v0.11.0` NSIS updater artifact from the candidate SHA and record
   its SHA-256 checksum and minisign signature.
2. Build and silently install a `v0.10.7` NSIS base from the public tag with the test-only updater
   endpoint and public key. Assert the executable lives at the documented current-user install path.
3. Launch the installed binary through `tauri-driver` and a matching Edge WebDriver. Assert the
   packaged bridge is present, the native updater reports `0.10.7`, and the local API remains
   loopback-only.
4. Drive the installed product UI through the release-checklist journey: create and open a trip,
   download the shipped Kyoto city pack, save a recommendation, add and complete a custom packing
   item, add a manual item that appears in Today, find it with workspace search, and switch the app
   to Spanish. Direct IPC may supplement assertions but must not perform these product actions.
5. Serve a crafted static `latest.json` and the signed candidate installer from `127.0.0.1`. Assert
   that the manifest uses `windows-x86_64-nsis`, the candidate checksum matches, and no non-loopback
   updater request is made.
6. Trigger the updater exclusively through the production `useUpdater` settings UI. Record the
   updater-backup directory count before the click, confirm that the controller creates exactly one
   new pre-update backup, then confirm the base process exits, NSIS replaces it, and the installed
   application reopens as `0.11.0`. The harness must not call `backup_database` itself.
7. Reattach WebDriver to the installed executable and verify the saved place, packing state, manual
   item, Today/search results, Spanish locale, and updater backup survived; also confirm the updater
   now reports `0.11.0` as current.
8. Export a password-protected portable backup through the installed settings UI and native Save
   dialog. Add a post-backup sentinel, stage restore through the installed settings UI and native
   Open dialog, then uninstall/reinstall the candidate without deleting disposable application
   data. On relaunch, confirm the staged restore applied: the original journey remains, the
   post-backup sentinel is absent, and Spanish remains selected.
9. Upload only a text/JSON evidence report, screenshots, artifact names, versions, paths, and
   checksums. Never upload the SQLite workspace, updater private key, or secrets.

## Repository integration

- Add the opt-in acceptance job to the existing release workflow so it can be dispatched from the
  candidate branch while the workflow path remains anchored on default `main`.
- Keep the normal keyless release dry-run unchanged. The acceptance job uses no protected
  environment and cannot create or edit a GitHub release.
- Add deterministic local tests for manifest construction and evidence validation where they do not
  require Windows.
- After a successful run, refresh Graphify and rerun `make check`, the production dependency audit,
  the credential-shaped-string scan, `cargo metadata --locked`, `git diff --check`, and
  `git diff --check origin/main...HEAD`. The range check is a release gate because repository-held
  patch fixtures can contain whitespace errors that the worktree-only check cannot see.
- Ask the original council blocker reviewers for targeted acceptance of the new Windows evidence.
  This closes Round 2 blockers and is not a third council round.

## WebView2 Runtime 150 compatibility

GitHub's elevated Windows runners currently exercise WebView2 Runtime 150 or newer. That runtime
deliberately ignores environment-supplied remote-debugging arguments for elevated hosts, so the
external driver cannot create a session unless the host passes the sanitized debugging port through
the WebView2 API. Voyalier will bridge this upstream gap without enabling automation in normal use:

- Require Tauri's exact `TAURI_WEBVIEW_AUTOMATION=true` signal and a Voyalier-owned, path-safe
  acceptance profile name; either missing or malformed input leaves the normal window configuration
  byte-for-byte unchanged.
- Extract only `--remote-debugging-port=<u16>` from EdgeDriver's browser arguments. Do not forward
  arbitrary environment-controlled browser flags.
- Pass that one numeric port through Tauri's `additional_browser_args` API and set a matching,
  relative WebView data directory so EdgeDriver and WebView2 observe the same disposable profile.
- Keep the code in the exact release binary but dormant on ordinary launches, rather than testing a
  special binary that cannot establish release confidence.
- Unit-test the fail-closed parser and configuration mutation, then retain staged runner diagnostics
  for all base, updated, and reinstall-recovery sessions.

The public `v0.10.7` binary predates this compatibility bridge, while GitHub's hosted runner no
longer offers the Runtime behavior under which that binary was released. Rebuilding the old source
with only the same fail-closed bridge is therefore an explicit test adaptation, not proof about the
historical binary's launchability on Runtime 150. The acceptance claim remains narrower and useful:
the exact `v0.10.7` updater, storage, and product implementation can install the exact candidate,
preserve traveler data, reopen, and recover on the current Windows runner. The report and release
checklist must disclose this boundary rather than describing the base binary as byte-identical to
the public installer.

## Commit order

1. `Docs: plan Windows updater acceptance`
2. `Test: add Windows installed updater acceptance`
3. `Desktop+test: support elevated Windows automation`
4. `Test+docs: adapt the public base to current Windows automation`
5. `Merge: close the Windows release gate`

## Council blocker closure

The first exact-SHA Windows run proved installer replacement, process restart, updater isolation,
data persistence, and reinstall recovery, but the Round 2 evidence and risk reviewers correctly
kept the release blocked. This extension closes their three material findings:

- Rewrite the pinned base automation patch so the repository range passes `git diff --check`, while
  retaining a successful exact-base `git apply --check` before the runner uses it.
- Replace direct IPC product setup with the complete installed UI journey required by the release
  checklist and record explicit per-step assertions in the evidence report.
- Remove the harness-created database backup and prove the production updater controller created
  the pre-update backup by observing an exact directory-count increment around its UI action.

The portable backup file and passphrase remain runner-private. The report may contain only the
backup basename, byte count, and SHA-256; the job must delete the disposable root and must never
upload traveler data, SQLite files, recovery material, or updater keys.

## Pinned native picker bridge

Exact-SHA run `32938333882` found exactly one standard Windows dialog and one semantic
`FileNameControlHost`, but the managed UI Automation surface exposed no writable `ValuePattern`,
managed `LegacyIAccessiblePattern`, or eligible edit/combo-box descendant. The release remains
blocked. Replace that exhausted setter with Microsoft's released Windows App CLI `v0.6.0`, whose
exact tagged implementation falls back from Value to Range to COM-level LegacyIAccessible value
setting without keyboard, clipboard, focus, or pointer input.

- Download only `winappcli-x64.zip` from the `v0.6.0` release at commit
  `b7494ed3b324d6e378cb17b477f2b1a9729765d0`. Require archive SHA-256
  `f6dc42e3b4e4709c8f617003008e2cfdd9a51735e04e7170d60edda258db78a8` before extraction or
  execution, locate exactly one executable under a fresh runner temporary directory, and invoke
  that absolute path. Do not use `latest`, Winget, a setup action, global installation, or PATH
  fallback.
- Disable the tool's update check and telemetry, and put its cache inside the same disposable
  temporary root. Record expected/reported version, tag commit, asset URL/name, expected/actual
  hashes, hash-before-extraction status, executable cardinality/containment, and the absence of
  PATH/latest/input-injection fallbacks.
- Before the expensive Rust builds, open a standard Windows SaveFileDialog with a unique exact
  title. Require exactly one enabled, onscreen dialog with a nonzero HWND and exactly one
  `FileNameControlHost`; scope structured `set-value` and `get-value --json` calls to that HWND and
  require case-sensitive exact path readback. Exact-SHA run `32944058567` proved those invariants,
  then found that the unique exact-name Save action did not expose `InvokePattern`. For the same
  exact enabled, onscreen action candidate, prefer `InvokePattern` and otherwise require managed
  `LegacyIAccessiblePattern` before calling its semantic default action. Exact-SHA diagnostic run
  `32945543090` then proved that the one standard-dialog Save action is reported as
  `ControlType.Pane`, enabled, onscreen, with AutomationId `1`. Accept only an observed
  `ControlType.Button` or this native `ControlType.Pane` shape; record the observed type and
  AutomationId, but never select by the numeric ID. Exact-SHA run `32946151801` then proved that
  this unique action exposes neither UI Automation pattern. Keep the pattern calls preferred; for
  this one exhausted standard-dialog shape only, require the already selected exact-name target's
  AutomationId to equal canonical Windows `IDOK` (`"1"`), bind its nonzero native HWND to the exact
  dialog with `IsWindow`, `IsChild`, and `GetDlgCtrlID`, and synchronously send
  `WM_COMMAND(IDOK, BN_CLICKED)` to the already verified dialog HWND. Use bounded
  `SendMessageTimeoutW` with block, abort-if-hung, and error-on-exit flags; never broadcast, and
  never fall through after a supported UI Automation pattern fails to invoke. This is a
  window-scoped semantic dialog command, not keyboard, pointer, clipboard, focus, geometry, or
  global input. Record which of the three supported methods performed the action, both unavailable
  pattern states, the guarded command identifiers/HWNDs/flags/timeout, synchronous dispatch, and
  the dialog count transition from one to zero. Dismissal plus exact downstream file effects—not
  the message's method-specific result—proves success. Any ambiguity, other control type,
  unsupported pattern or command identity, malformed output, mismatch, timeout, or out-of-TEMP
  path fails closed. This preflight proves only picker-tool compatibility, not Voyalier behavior.
- Repeat the same title, HWND, semantic-host, structured set/get, exact-readback, exact-action, and
  dismissal checks for both installed Voyalier Save and Open dialogs. Tie those observations to the
  existing backup notice, file stat/hash, restore staging, reinstall, preservation, and sentinel
  assertions. The full product journey remains the release gate.
- Preserve sanitized CLI stdout/stderr and failure screenshots. Never claim which internal setter
  succeeded unless the released CLI explicitly reports it, and never fall back to SendKeys,
  clipboard, focus, geometry, numeric automation-ID selection, or broader selectors.
- Because the released CLI emits a first-run banner on a cold isolated cache, create and verify its
  documented empty `.first-run-complete` marker only after the archive hash passes and before the
  first execution. Record the marker's zero length and empty-file hash so version output remains an
  exact, machine-checkable `0.6.0` without weakening cache isolation.
- Keep raw selected paths only in runner memory for the exact comparisons. Uploaded JSON, Markdown,
  logs, and UI screenshots must use root tokens; omit raw `get-value` and dialog-host stdout while
  retaining hashes and structured identity/HWND results. Recursively reject any remaining absolute
  Windows or UNC path before the upload step, and do not upload at all if sanitization fails.
