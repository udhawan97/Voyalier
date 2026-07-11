# Release checklist

No public release may be promoted merely because the build completed.

## Product gates

- Vertical trip workflow passes with representative fixtures.
- Local/no-key capability matches the UI wording.
- Stale and unknown travel facts are labeled.
- Redaction preview and exported PDF are visually reviewed.
- Accessibility and reduced-motion checks pass.

## Security and compliance

- Threat model and data-source registry are current.
- Secrets, SBOM, dependency, license, and provenance checks pass.
- macOS and Windows artifacts are signed when credentials are available.
- macOS notarization and Windows reputation behavior are documented.
- Updater artifacts are signed independently of platform signing.

## Artifact verification

- Install and launch each artifact on a clean supported OS.
- Verify version and bundle metadata.
- Verify the local API binds only to loopback and shuts down with the app.
- Verify an upgrade preserves user data and a failed migration can recover.
- Verify `SHA256SUMS.txt` against uploaded assets.

## Updater release (first self-updating base = v0.3.0)

One-time and per-release steps for the in-app updater, per
[`docs/architecture/UPDATES.md`](../architecture/UPDATES.md) §E:

- Run `tauri signer generate`; store the private key + password offline **and**
  as the Actions secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`; paste the PUBLIC
  key into `apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
  (the release job fails if it is still the placeholder or empty). See
  [`docs/security/UPDATE_KEY_RUNBOOK.md`](../security/UPDATE_KEY_RUNBOOK.md).
- Configure a protected `release` GitHub environment (required reviewers) and
  protect `v*` tags (block force-push/moves).
- Run a `workflow_dispatch` dry-run (keyless, build-only) and confirm both
  platform bundles build before tagging.
- After tagging, confirm the draft's `latest.json` contains BOTH
  `darwin-aarch64` and `windows-x86_64-nsis` keys (a matrix race can drop one).
- E2E the swap on real Apple Silicon **and** Windows against a local endpoint
  serving a crafted `latest.json` (draft asset URLs 404 unauthenticated);
  confirm install is in `/Applications`, the app reopens after the swap, and a
  "won't open" recovery (re-download) keeps user data (it lives outside the
  bundle).
- Keep `packs-v1` (and any pack release) marked PRE-RELEASE so it never becomes
  `releases/latest` and 404s the updater.
- v0.3.0 is install-once (the chicken-and-egg base); the loop self-proves on
  v0.3.1.

The initial workflow creates draft releases only. A maintainer must complete this checklist before publication.
