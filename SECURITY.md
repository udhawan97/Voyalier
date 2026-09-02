# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** flow under the repository Security tab so the report and discussion remain private.

Include the affected version or commit, reproduction steps, expected impact, and any suggested mitigation. Please avoid accessing data that is not yours while testing.

## Supported versions

Voyalier is a public beta. Security fixes target the latest `main` branch and
the most recent public-beta release. Older releases must be upgraded before a
report can be evaluated against a supported build.

| Version                              | Supported                  |
| ------------------------------------ | -------------------------- |
| `main` (unreleased source)           | ✅                         |
| Latest published public-beta release | ✅                         |
| Older releases                       | ❌ (upgrade to the latest) |

## Security boundaries

Voyalier handles sensitive itineraries and documents. The project treats these as release-blocking requirements:

- secrets never live in browser storage or committed configuration;
- the desktop app uses direct Tauri IPC and binds no TCP port;
- on supported macOS and Linux hosts, the source route opens a managed,
  disposable Chromium context. Its loopback server uses a kernel-selected port,
  a 32-byte per-launch bearer sent through a Unix anonymous pipe, strict
  Host/Origin/CORS checks, and a source-only nonce CSP. Windows source launch is
  not supported; use the packaged desktop app. The bearer is not placed in
  process arguments,
  environment variables, URLs, browser storage, cookies, logs, response bodies,
  page source, files, or screenshots;
- document and web content are untrusted and cannot directly invoke tools;
- cloud AI receives only user-approved, redacted excerpts;
- exports default to excluding sensitive identity fields;
- source and dependency licenses are audited before distribution.

See [the threat model](docs/security/THREAT_MODEL.md) for the working security design.
