# Docs advisory and installed macOS verification

Date: 2026-10-19. Base: 042ed9b23ee3c3a709c534010726f9c9329abea6.

## Scope

Resolve GHSA-rj75-hqrm-r3gf in the documentation dependency tree with the smallest compatible patched resolution. Prefer the available 6.x backport if both published and recognized by the current advisory feed; otherwise narrowly update the docs-only parent/parser relationship. Preserve unrelated resolutions, Node support, product contracts, and runtime code.

## Verification

- Record the current production audit; regenerate and inspect the bounded lockfile change, perform a frozen install with lifecycle scripts disabled, and rerun the production audit without suppressions.
- Run the repository-owned complete gate and security hygiene checks. Refresh the existing graph and corroborate one scoped query.
- Inventory the existing macOS app, bundle identity/signature/checksum, and current processes. Build the canonical desktop target with updater artifacts disabled for the local keyless build, recording exact source identity.
- Preserve the previous installed bundle recoverably before installing the verified candidate at the established canonical path. Use disposable VOYALIER_DATA_DIR, blocked external network and OS-keychain access, and task-owned WebKit storage. Preserve normal traveler data and credentials.
- Exercise actual installed native UI: create and reopen a fictional trip, retain edits across restart, inspect Today, import a synthetic confirmation/attachment, and export/inspect/restore a portable backup through native pickers where supported. Record precise observable coverage and limits; no provider keys or real services.
- Obtain the required two-round council review, then commit fixes, pass protected PR checks, merge, push and verify clean primary/remote alignment. Keep release publication, signing/notarization and updater services outside this task.

## Stop conditions

Preserve source, old app and evidence if a required check fails. Do not delete traveler data, weaken assertions, replace production security with test shortcuts, or infer unsupported installed behavior. Fix reproducible failures within the requested scope and rerun affected checks.
