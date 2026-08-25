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
4. Create representative traveler-owned data through the packaged Tauri IPC seam, verify it is
   readable, and record the disposable database path and pre-update data hash without uploading the
   database.
5. Serve a crafted static `latest.json` and the signed candidate installer from `127.0.0.1`. Assert
   that the manifest uses `windows-x86_64-nsis`, the candidate checksum matches, and no non-loopback
   updater request is made.
6. Trigger the real updater from the installed UI/IPC path. Confirm the base process exits, NSIS
   replaces it, and the installed application reopens as `0.11.0`.
7. Reattach WebDriver to the installed executable and verify the representative data survived,
   the pre-update backup exists, and the updater now reports `0.11.0` as current.
8. Exercise the recovery path by uninstalling/reinstalling the candidate without deleting the
   disposable application data, then confirm the data remains readable after relaunch.
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
  the credential-shaped-string scan, `cargo metadata --locked`, and `git diff --check`.
- Ask the original council blocker reviewers for targeted acceptance of the new Windows evidence.
  This closes Round 2 blockers and is not a third council round.

## Commit order

1. `Docs: plan Windows updater acceptance`
2. `Test: add Windows installed updater acceptance`
3. `Merge: close the Windows release gate`

