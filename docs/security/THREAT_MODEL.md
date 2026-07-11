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

## Trust hierarchy

Official entry, health, and safety sources outrank commercial inventory, editorial travel sources, community sentiment, and model inference. Community or AI sources can never clear a high-stakes readiness finding.
