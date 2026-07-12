# Threat model

## Sensitive assets

- Itineraries, locations, traveler identities, contact details, confirmations, insurance information, and document images
- Provider keys and local encryption keys
- Extracted facts, embeddings, research history, and exported briefs

## Primary threats

| Threat                                        | Foundation control                          | Required before beta                                               |
| --------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Local API accessed by another process or page | Loopback-only bind and origin allowlist     | Random port, per-launch token, strict CSP and origin validation    |
| API key exposure                              | No keys in frontend or repository           | OS credential vault, redacted logs, rotation and deletion          |
| Prompt injection in documents or pages        | Content treated as data, not instructions   | Tool isolation, schema validation, adversarial fixtures            |
| Sensitive cloud disclosure                    | Exact redacted preview before each BYOK run | Provider retention copy, field-level policy, deletion verification |
| Unsafe sharing                                | Redaction-first printable brief and preview | Audience profiles, expiring/encrypted bundle formats               |
| Malicious update or dependency                | Lockfiles and CI                            | Signing, checksums, SBOM, provenance, updater signature validation |
| Stale or incorrect travel facts               | Explicit unknown states in contracts        | Source priority, freshness TTLs, citations, conflict handling      |

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
  Every action in the release and pack-publish workflows is SHA-pinned and the
  signing key is step-scoped to an approved, protected environment; `packs-v1`
  releases are pre-release so they cannot hijack the updater's
  `releases/latest` endpoint. (The build/lint/security-scan CI workflows are
  not yet SHA-pinned — lower risk since they hold no signing key and run with
  read-only permissions, but tightening them is worth doing.)
- **OS code-signing — pending.** Bundles are not yet Apple Developer ID /
  Windows Authenticode signed (paid); first launch uses the documented
  Gatekeeper / SmartScreen "open anyway" path. This is independent of the (free)
  updater signature above.
- **SBOM — deferred.** No SBOM is generated yet; `Cargo.lock`, `pnpm-lock.yaml`,
  and the pinned actions are the current supply-chain pin. Revisit before a
  wider beta.

## Trust hierarchy

Official entry, health, and safety sources outrank commercial inventory, editorial travel sources, community sentiment, and model inference. Community or AI sources can never clear a high-stakes readiness finding.
