# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** flow under the repository Security tab so the report and discussion remain private.

Include the affected version or commit, reproduction steps, expected impact, and any suggested mitigation. Please avoid accessing data that is not yours while testing.

## Supported versions

Voyalier is a source-only public beta. Security fixes target the latest `main`
branch and the most recent tagged release.

| Version             | Supported                  |
| ------------------- | -------------------------- |
| `main` (unreleased) | ✅                         |
| 0.4.x               | ✅                         |
| < 0.4.0             | ❌ (upgrade to the latest) |

## Security boundaries

Voyalier handles sensitive itineraries and documents. The project treats these as release-blocking requirements:

- secrets never live in browser storage or committed configuration;
- the desktop app uses direct Tauri IPC and binds no TCP port; the browser-development loopback service is guarded by strict Host, Origin, and CORS checks (DNS-rebinding protection). A per-launch bearer token remains defense-in-depth work, tracked in the [threat model](docs/security/THREAT_MODEL.md);
- document and web content are untrusted and cannot directly invoke tools;
- cloud AI receives only user-approved, redacted excerpts;
- exports default to excluding sensitive identity fields;
- source and dependency licenses are audited before distribution.

See [the threat model](docs/security/THREAT_MODEL.md) for the working security design.
