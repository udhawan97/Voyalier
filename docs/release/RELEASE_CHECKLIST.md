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

The initial workflow creates draft releases only. A maintainer must complete this checklist before publication.
