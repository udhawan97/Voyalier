# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** flow under the repository Security tab so the report and discussion remain private.

Include the affected version or commit, reproduction steps, expected impact, and any suggested mitigation. Please avoid accessing data that is not yours while testing.

## Supported versions

Voyalier has not published a production release yet. Security fixes currently target the latest `main` branch. A supported-version table will be added before the first public beta.

## Security boundaries

Voyalier handles sensitive itineraries and documents. The project treats these as release-blocking requirements:

- secrets never live in browser storage or committed configuration;
- local services bind to loopback and require an authenticated session before public beta;
- document and web content are untrusted and cannot directly invoke tools;
- cloud AI receives only user-approved, redacted excerpts;
- exports default to excluding sensitive identity fields;
- source and dependency licenses are audited before distribution.

See [the threat model](docs/security/THREAT_MODEL.md) for the working security design.
