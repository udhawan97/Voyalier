# Windows restore failure diagnostics

## Goal

Make the installed Windows acceptance artifact identify the durable restore phase reached when the reinstalled app exits during startup, without exposing paths, secrets, backup contents, or user data.

## Changes

1. Inspect only the pending-restore marker phase and the presence/type of the live, candidate, rollback, and sidecar files after a recovery startup failure.
2. Add that sanitized snapshot to failed acceptance reports at the recovery-driver stage.
3. Unit-test the snapshot shape and sanitizer compatibility.
4. Run the focused script tests, the repository gate, and the Windows installed-app workflow before deciding on a product repair.

## Boundaries

- Diagnostics remain test-harness-only.
- Do not record absolute paths, restore generation identifiers, hashes, credentials, passphrases, or database contents.
- Do not tag or publish v0.12.0 until installed recovery succeeds.
