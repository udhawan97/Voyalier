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
  dialog with `IsWindow`, `IsChild`, and `GetDlgCtrlID`. Exact-SHA run `32947384758` proved that a
  direct `WM_COMMAND(IDOK, BN_CLICKED)` can dismiss this dialog while returning the wrong selected
  path, so remove and prohibit that route. Instead, retrieve `IID_IAccessible` for only that bound
  child HWND with `AccessibleObjectFromWindow(OBJID_CLIENT)`, bind the returned object back to the
  same HWND, and require `CHILDID_SELF`, the exact case-sensitive action name, a nonempty default
  action, `ROLE_SYSTEM_PUSHBUTTON`, and no unavailable/invisible/offscreen state. Call
  `accDoDefaultAction(CHILDID_SELF)` exactly once inside a bounded process, release the COM object,
  and never fall through after any supported UI Automation or MSAA retrieval/action failure. This
  is semantic accessibility activation, not keyboard, pointer, clipboard, focus, geometry, a
  direct window message, or global input. Record which of the three supported accessibility
  methods performed the action, both unavailable UIA-pattern states, every MSAA identity constant,
  HRESULT/HWND/name/default-action/role/state check, call count/completion, release, and the dialog
  count transition from one to zero. Dismissal plus exact downstream file effects—not an API call
  alone—proves success. Any ambiguity, other control type, unsupported pattern or accessible
  identity, malformed output, mismatch, timeout, or out-of-TEMP path fails closed. This preflight
  proves only picker-tool compatibility, not Voyalier behavior.
- Exact-SHA run `32948743304` proved that the direct accessibility action met every identity and
  lifecycle guard—`S_OK`, the same child HWND, exact `Save` name, push-button role, usable state,
  one completed invocation, COM release, and dialog count one to zero—but the independent
  `SaveFileDialog.FileName` result still did not equal the requested path. Keep the release blocked.
  Before changing any setter or action again, run one diagnostic-only preflight that records three
  distinct path identities: the expected path, the pre-action CLI readback, and the host-selected
  path. Emit only SHA-256 values, explicitly defined ordinal/ordinal-ignore-case/canonical-ignore-case
  comparisons, canonicalization status, segment-aware temporary-root containment, and a relative
  token only after containment is proven. Record the selected basename only when it equals the
  generated target or original placeholder; otherwise record its SHA-256, length, and extension.
  Compare the host selection with the original placeholder under the same raw and canonical rules.
  Never emit a raw absolute path through stdout, stderr, an exception, or an artifact. Never write
  unless the dialog returned `OK`, `Path.GetFullPath` equality under `OrdinalIgnoreCase` is true,
  and the selected path remains inside the fresh preflight root. Record whether a write was
  attempted and whether a marker exists. Mark the report `diagnosticOnly: true`, retain
  `productEvidence: false`, fail the step after persisting sanitized evidence, and surface only a
  sanitized one-line error without an unhandled stack. Dispatch through an explicit
  `windows_picker_diagnostic` workflow input that excludes the independent desktop build matrix;
  do not continue into Rust builds or the installed-product journey. Accept a selected path outside
  the fresh root only as a no-write, null-relative-token diagnostic, and accept an uncanonicalizable
  value only with null canonical hashes, no containment, no relative token, and no write. This one
  run cannot satisfy the picker or
  release validator: canonical equality identifies an over-strict oracle; placeholder equality
  identifies an uncommitted setter/readback; any third value requires reassessment rather than
  another speculative activation fallback.
- Repeat the same title, HWND, semantic-host, structured set/get, exact-readback, exact-action, and
  dismissal checks for both installed Voyalier Save and Open dialogs. Tie those observations to the
  existing backup notice, file stat/hash, restore staging, reinstall, preservation, and sentinel
  assertions. The full product journey remains the release gate.
- Preserve sanitized CLI stdout/stderr and failure screenshots. Never claim which internal setter
  succeeded unless the released CLI explicitly reports it, and never fall back to SendKeys,
  clipboard, focus, geometry, direct window messages, numeric automation-ID selection, or broader
  selectors.
- Because the released CLI emits a first-run banner on a cold isolated cache, create and verify its
  documented empty `.first-run-complete` marker only after the archive hash passes and before the
  first execution. Record the marker's zero length and empty-file hash so version output remains an
  exact, machine-checkable `0.6.0` without weakening cache isolation.
- Keep raw selected paths only in runner memory for the exact comparisons. Uploaded JSON, Markdown,
  logs, and UI screenshots must use root tokens; omit raw `get-value` and dialog-host stdout while
  retaining hashes and structured identity/HWND results. Recursively reject any remaining absolute
  Windows or UNC path before the upload step, and do not upload at all if sanitization fails.

## Evidence-backed picker preset correction

The single diagnostic-only run `32951589052` at exact candidate SHA
`5431958f1b7c0e406258c5c87d7836bb38ad7863` closed the setter-versus-action question. Its sanitized
artifact (`sha256:804260c204c2104c6a368351de4b89f05f954a63768cc101d226a9e413328cf8`)
showed that the pinned CLI read back the requested target while the independent dialog host returned
the untouched placeholder under both raw and canonical hashes. The exact MSAA Save action again met
every identity and lifecycle guard. No marker was written. A JavaScript-to-PowerShell escaping error
also rendered the diagnostic containment label invalid, but it occurred after dismissal and did not
affect the independent target, readback, selected, or placeholder hashes. The council accepted the
narrow classification: the external container-level setter did not commit to `SaveFileDialog`.

This correction supersedes the external setter and one-use diagnostic portions of the pinned bridge:

- Freeze the accepted exact-title, exact-HWND, semantic-host, one-shot MSAA action. Do not add another
  action fallback. Keyboard, pointer, clipboard, focus, geometry, direct-window-message,
  numeric-selector, and broad-selector routes remain prohibited.
- Remove the Windows App CLI from release acceptance rather than attributing confidence to its
  non-authoritative readback. Remove the one-use workflow input and restore a nondiagnostic standard
  picker preflight before any product build.
- Make the standard preflight action-only: create a standard Save dialog with the target already
  configured, require terminating PowerShell errors and empty host stderr, invoke the frozen action,
  then require the authoritative returned canonical target, exact marker content/stat/hash, dialog
  dismissal, sanitization, and cleanup. It remains `productEvidence: false`.
- Add a private Windows-only preset in the desktop adapter, where the backup commands already own the
  native picker and filesystem IO. Enable it only when the complete existing automation configuration
  is valid—exact `TAURI_WEBVIEW_AUTOMATION=true`, one sanitized debugging port, and a valid
  `voyalier-acceptance-*` profile—and a dedicated backup target is present. An inactive master gate
  preserves the existing ordinary-launch control flow and picker configuration. An active gate with a
  missing or invalid target fails before a dialog opens; it never silently falls back.
- Read the environment once. Canonicalize `RUNNER_TEMP` and the target's existing parent, reject a
  reparse-point parent, and require a strict descendant directory named
  `voyalier-windows-acceptance-*`. Require the exact ASCII basename
  `voyalier-portable-acceptance.vbk`; reject relative, root, traversal, prefix-sibling, wrong-extension,
  and outside-root targets. Export requires the target to be absent; restore requires the same target
  to be an existing regular file.
- Configure only the existing locked dialog path: `tauri-plugin-dialog 2.7.2` uses `rfd 0.16.0`, whose
  Windows backend calls `IFileDialog::SetFolder` and `SetFileName` for both Save and Open builders.
  Keep the real titles, filters, native dialogs, and UI-triggered commands. After each picker returns,
  independently require the chosen path to equal the configured canonical target before any write or
  read. The preset is never treated as authority.
- Record only tokenized preset provenance and hashes: complete-gate status, canonical root/parent
  success, strict containment, exact basename/extension, `externalSetterUsed: false`, and per-dialog
  returned-path equality. Save must prove a new positive-length backup and SHA-256; Open must prove the
  same pre-read SHA-256 before restore staging. Never upload the raw target, backup contents,
  passphrase, SQLite data, recovery material, or updater key.
- Unit-test inactive and stray-variable behavior; active missing/malformed configuration; relative,
  root, traversal, prefix-sibling, reparse, wrong-name, and wrong-extension targets; pre-existing Save
  and missing/non-file Open targets; returned-path mismatches; and valid Save/Open decomposition.
  Static tests must keep external setters absent and the ordinary picker builder unchanged.
- Release acceptance still requires the exact-SHA installed journey: UI-triggered Save and Open,
  authoritative returned-path equality, backup notice/stat/hash, restore staging, reinstall, sentinel
  removal, traveler-data/profile preservation, and no non-loopback traffic. The defensible claim is
  exact candidate backup/restore through real native dialogs under a dormant acceptance-only preset,
  not manual filename entry or byte identity with a future published artifact.

## Exact-commit council revisions

The pre-dispatch council reviewed `ea0762de1a08c19c217564379b63cd9936389ccf`. Coverage accepted;
the evidence and risk seats required four fail-closed corrections before Windows dispatch:

- Keep the dialog helper explicitly action-only. It may prove the expected target is inside the
  temporary root and that one exact native action dismissed one exact dialog, but it must not label
  that as an observed or selected path. Use `expectedPathWithinTemp` and
  `nativeDialogActionConfirmed`. Establish Save path equality only from the exact product notice plus
  the newly created target's stat/hash, and Restore path equality only from successful staging and
  recovery combined with the candidate's mandatory post-selection guard before read.
- Make every PowerShell discovery/action invocation use terminating errors and require empty stderr
  in both runtime checks and evidence validators. Negative fixtures must reject nonempty discovery or
  action stderr.
- Read the automation environment once into one immutable startup snapshot. Derive both the WebView2
  configuration and the native picker preset from that same parsed snapshot so their gates cannot
  disagree.
- Preserve the export target-absence invariant atomically. After the returned-path guard, open the
  target with `create_new(true)` and write through that handle; never use a truncating convenience
  write after a separate absence check.

## Exact branch-head picker diagnostic

The first full run at final reviewed SHA `3f4fa9d0c4eaf248701fc706d33411a663255ecf`
(`32956445698`) passed the standard native-dialog preflight, both platform bundle builds, the real
v0.10.7 install, production updater swap, candidate reopen, locale persistence, and traveler-data
preservation. It failed closed at the candidate portable-backup step because the exact product dialog
never appeared. The sanitized artifact proves only `dialogs: 0`, `hosts: 0`; it has no candidate-side
phase or UI error evidence. No root cause is established. In particular, do not attribute the failure
to Windows' canonical path prefix: locked `rfd 0.16.0` strips that prefix before constructing the shell
item.

Before another corrective change, add a dormant, acceptance-only phase recorder to the existing
complete picker gate:

- emit only fixed, content-free phase markers inside the already canonicalized, non-reparse,
  exact acceptance directory;
- create each marker atomically under an exact allowlisted filename so diagnostics cannot overwrite
  or follow a competing file;
- bracket export preparation, preset validation, native dialog entry/return, returned-path guard, and
  final write; bracket the equivalent restore stages for the later half of the journey;
- record the dialog result only as `returned-none` or `returned-some`: locked `rfd 0.16.0` collapses
  cancellation and internal build/show/result errors to `None`, so a `returned-none` marker establishes
  no cause by itself;
- collect only the ordered allowlisted phase names into the sanitized aggregate report, never marker
  paths or contents; reject unknown, duplicate, or out-of-order phase evidence; and
- keep ordinary launches byte-for-byte on the inactive no-diagnostic path. The next exact-SHA run is
  diagnostic until the product dialog, returned path, backup artifact, restore, reinstall, and
  recovery all pass; a phase trace alone cannot satisfy the release gate.

## Exact diagnostic result and command-thread correction

Exact-SHA run `32959897629` at `44f260515434f0c00768f5fff47a7ff4de742d5c`
produced a sanitized artifact whose archive digest matches
`99eb2b3cdf06ea8b102fbf9d4ab93ba37f137e462d83eb516ced32d38f4987cb`.
The installed 0.10.7 journey, production updater replacement, 0.11.0 reopen,
locale and traveler-data preservation, and standard native-dialog preflight
passed. Portable export emitted exactly:

1. `export:command-entered`
2. `export:container-ready`
3. `export:preset-valid`
4. `export:before-dialog`

The expected product dialog then remained absent (`dialogs: 0`, `hosts: 0`)
and the command emitted no returned marker. This localizes the failure to
`blocking_save_file()` itself rather than backup creation, preset validation,
dialog discovery, or returned-path handling.

The locked implementation establishes the cause. Tauri's command macro executes
a synchronous command inline, while `tauri-plugin-dialog 2.7.2` says its
blocking picker APIs must not run on the main thread. Those APIs schedule
asynchronous rfd dialog construction with `run_on_main_thread` and then wait on
a zero-capacity channel. Both portable-backup commands are synchronous, so the
Windows event thread can wait for dialog construction that it cannot service.

Correction:

- Add a fast source-level regression assertion that every command using a
  blocking native picker is declared `async fn`; run it red before the fix.
- Declare only `export_backup` and `stage_restore` asynchronous. Keep the
  existing command names, inputs, return values, picker builders, preset guards,
  path validation, atomic export write, restore read, and phase ordering.
- Run the focused Node fixture and desktop Rust tests, then the full repository
  gate and Graphify refresh.
- Dispatch Windows installed-app acceptance from the exact pushed SHA. Only the
  complete product journey through export, restore, reinstall, recovery, and
  sanitized evidence can close the release gate.

## Exact async-command result and duplicate-path redaction correction

Exact-SHA run `33005615909` at `38bb9f9350ff5bfbc35c62c05e8df46a6cee7317`
proved the command-thread correction in the hosted Windows runtime. The real
`Save Voyalier backup` dialog appeared, the exact native Save action dismissed
it, the product returned the configured path, and the phase trace continued
through `export:dialog-returned-some`, `export:returned-path-valid`, and
`export:write-complete`. The portable backup was therefore created before the
journey failed at the screenshot privacy assertion with `1 !== 0`.

The remaining failure is deterministic in the UI and harness. `BackupPanel`
places the successful path in `.voy-backup__notice` and passes the same message
to the app's polite screen-reader live region. The acceptance screenshot helper
redacts only the first element, then correctly counts the duplicate absolute
path still present in `document.body.innerText` and fails before writing the
screenshot.

Correction:

- Add a focused source regression requiring the screenshot privacy helper to
  cover the app's polite live region as well as the visible backup notice; run
  it red before the fix.
- In the screenshot-only evidence preparation, replace absolute paths in both
  path-bearing status elements with the existing `<ABSOLUTE_PATH>` token. Keep
  the earlier assertion against the exact product notice, backup stat, and
  content hash unchanged, so redaction cannot substitute for product proof.
- Keep the final whole-document scan fail-closed. Any absolute path outside the
  two expected status copies must still abort evidence capture.
- Rerun the focused fixture, full local gate, Graphify refresh, exact two-round
  council, and hosted exact-SHA Windows journey before merge or release.
