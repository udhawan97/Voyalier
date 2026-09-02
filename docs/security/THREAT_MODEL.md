# Threat model

## Sensitive assets

- Itineraries, locations, traveler identities, contact details, confirmations, insurance information, and document images
- Provider keys and local encryption keys
- Extracted facts, embeddings, research history, and exported briefs

## Primary threats

| Threat                                                       | Foundation control                                                                                         | Required before beta                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local API accessed by another process or page                | Kernel-selected loopback port, per-launch bearer, exact Host/Origin/CORS checks, and source-only nonce CSP | Keep the anonymous-pipe bootstrap and managed-browser regression gates passing                                                                                           |
| API key exposure                                             | No keys in frontend or repository                                                                          | OS credential vault, redacted logs, rotation and deletion                                                                                                                |
| Prompt injection in documents or pages                       | Content treated as data, not instructions                                                                  | Tool isolation, schema validation, adversarial fixtures                                                                                                                  |
| Sensitive cloud disclosure                                   | Exact redacted preview before each BYOK run                                                                | Provider retention copy, field-level policy, deletion verification                                                                                                       |
| Unsafe sharing                                               | Redaction-first print/PDF/clipboard brief; structural clipboard allowlist; explicit user action            | Warn that clipboard history, device sync, and third-party clipboard managers can retain copied text; audience profiles and expiring/encrypted bundles remain future work |
| Malicious update or dependency                               | Lockfiles and CI                                                                                           | Signing, checksums, SBOM, provenance, updater signature validation                                                                                                       |
| Resource exhaustion from untrusted import input (email/HTML) | Depth-capped, dependency-light parsing; a 1M-character document cap                                        | Fuzz coverage, per-parser time/size budgets                                                                                                                              |
| Stale or incorrect travel facts                              | Explicit unknown states in contracts                                                                       | Source priority, freshness TTLs, citations, conflict handling                                                                                                            |

## Update integrity (status)

The "malicious update or dependency" row is now largely delivered by the in-app
updater (see [`docs/architecture/UPDATES.md`](../architecture/UPDATES.md)):

- **Updater signature validation — done.** Every update is minisign-verified
  against a pubkey compiled into the binary; the download runs in Rust behind
  fixed command wrappers (no webview updater capability, no caller-supplied
  proxy or headers), so there is no hidden network path.
- **Checksums + provenance — done.** The release workflow publishes per-platform
  `SHA256SUMS` and attaches SLSA build provenance
  (`actions/attest-build-provenance`, verifiable with `gh attestation verify`).
  Every action in the release and pack-publish workflows is SHA-pinned. Pack
  builders have read-only repository authority; only a separate publish job can
  write contents, and it is fixed to the `packs-v1` prerelease. DuckDB is an
  exact official release asset verified against its published SHA-256. The
  updater signing key is step-scoped to an approved, protected environment;
  `packs-v1` releases are pre-release so they cannot hijack the updater's
  `releases/latest` endpoint. The security-hygiene workflow is also SHA-pinned;
  it has read-only contents access plus checks write and issue write solely so
  RustSec can maintain advisory-tracking issues. The remaining build/lint CI
  actions are not yet SHA-pinned, but they hold no signing key.

- **OS code-signing — pending.** Bundles are not yet Apple Developer ID /
  Windows Authenticode signed (paid); first launch uses the documented
  Gatekeeper / SmartScreen "open anyway" path. This is independent of the (free)
  updater signature above.
- **SBOM — deferred.** No SBOM is generated yet; `Cargo.lock`, `pnpm-lock.yaml`,
  and the pinned actions are the current supply-chain pin. Revisit before a
  wider beta.

## Source-browser boundary

On supported macOS and Linux hosts, `make dev` is a security boundary, not just
process convenience. The Unix-only launcher creates the API credential in
memory, sends it to Axum through an inherited anonymous pipe, receives only the
assigned loopback origin over a second pipe, and opens a fresh Playwright
Chromium context. A one-shot, non-enumerable page bootstrap is installed only
at the exact Vite origin; the web gateway consumes and deletes it before making
direct authenticated requests. Vite has no `/api` proxy and therefore cannot
accidentally turn unauthenticated same-origin calls into authorized local API
calls. Windows source launch is unsupported; the packaged Windows app continues
to use direct Tauri IPC without a loopback API.

## Trust hierarchy

Official entry, health, and safety sources outrank commercial inventory, editorial travel sources, community sentiment, and model inference. Community or AI sources can never clear a high-stakes readiness finding.
