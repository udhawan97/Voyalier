# ADR-0031: Pin the updater archive security fix

Date: 2026-10-19. Status: Accepted for the approved dependency security repair.

## Context

The security gate reports four rustls 0.23.45 advisories and three Windows zip 4.6.1 advisories. Rustls 0.23.46 is patched. Published tauri-plugin-updater 2.14.0 still requires zip 4; the official upstream zip 9 fix is committed but not included in that published crate.

## Decision

Pin tauri-plugin-updater to official repository revision `ba98bfadc4c868c9a7e1a226c83af528e1f11b89`. Relative to the published 2.14.0 source revision `44293a5722efcaf27060504e63b17aeba721b40f`, its updater subtree changes only the Windows zip requirement from 4 to 9. Keep default updater features and existing application wrappers, fixed endpoints, consent, and signature verification. Pin rustls 0.23.46 in the lockfile. Declare desktop Rust minimum 1.90 as required by updater 2.14; leave the other crate minimum declarations unchanged.

## Consequences

This is a temporary immutable Git source pin for an existing dependency, under its existing Apache-2.0 OR MIT license. Builds require fetching that official revision once; cached builds remain offline. Runtime network behavior and privacy boundaries remain unchanged. Cargo.lock records the revision and archive resolution. Review all required Tauri transitive changes and run the complete local, macOS desktop and Windows gates. Replace the Git pin with a published patched registry release only through another reviewed lockfile update. No advisory ignores, security-feature removal, contract/storage changes, or release publication are authorized by this decision.
