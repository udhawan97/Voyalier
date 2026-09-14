# ADR-0025: Structured PII keeps the sealed-column plaintext fallback

- Status: Accepted
- Date: 2026-09-14

Extends ADR-0007. Records a decision raised by dev-review run `20260913T080635Z-78bcf464`
(finding DR-78bcf464-010, carried lead L2).

## Context

`SEALED_COLUMNS` columns are sealed through `Vault::seal`. When the vault is **inactive**
(no keychain data key is available and no passphrase is set), `seal` deliberately passes the
plaintext through and `open` returns it unchanged and never re-seals on read. This is the
long-standing fallback so a traveler on a machine without a working keychain is not locked out
of their own local notes.

The v0.12.0 concierge cockpit added binary attachment custody, which — unlike every other
sealed column — **refuses** to write on an inactive vault (`require_active_for_attachments`),
because storing an identity/travel file without durable encryption would make the wallet's
custody promise false.

That created a visible asymmetry: the concierge profile (traveler names, party context, money
entries) and the pre-existing passport nationality (`visa_prep.nationality_iso2`) still use the
plaintext fallback, while binary files do not. The review asked whether structured PII should be
held to the same active-vault standard as binary files.

## Decision

Keep the plaintext fallback for **all** non-binary sealed columns, including the concierge
profile and `visa_prep.nationality_iso2`. Do not add a `require_active`-style gate to structured
PII writes.

Rationale:

- The fallback is a single, consistently-applied policy across ~35 sealed sites. Gating only the
  concierge profile would be _inconsistent_ with `visa_prep` and every other sealed column, and
  gating all of them is a behavior change that would lock existing keychain-less users out of
  saving their own trip data — a larger regression than the exposure it removes.
- Binary attachments are treated differently on purpose: they are opaque identity documents whose
  custody promise is explicit, they are large, and refusing them has a clear user action
  ("configure a working keychain or passphrase"). Structured trip metadata does not carry the
  same explicit custody promise and has always followed the fallback.
- The active-vault path already seals everything; the fallback only applies when no vault is
  configured, which the vault status surface already communicates.

## Consequences

- No code change. The asymmetry between binary attachments (gated) and structured PII (fallback)
  is intentional and now documented.
- If a future decision does gate structured PII, it must apply to `visa_prep` **and** the
  concierge profile together, behind an explicit migration/onboarding path for keychain-less
  users, and is a contract/behavior change requiring its own ADR.
- This ADR is input-policy scope only; it is not a claim that a machine without an active vault
  provides at-rest encryption for these columns. The vault status remains the source of truth for
  whether a given install is sealing.
