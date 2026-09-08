# ADR-0022: Updater settings have a closed schema

- Status: Accepted
- Date: 2026-09-08

## Context

The updater's `get_app_setting` and `set_app_setting` desktop commands expose the
plaintext `app_settings` table through arbitrary keys and opaque strings. The same
table also contains research consent and custom AI instructions with dedicated APIs.
A convention that this table never holds secrets does not constrain this public writer.

## Decision

Retain command names, string payload fields, and success shapes. Approve narrowing the
previously generic desktop API to its shipped consumer: `updater.auto_check_consent`,
`updater.skipped_version`, `updater.staged_version`, and `updater.last_seen_version`.
Unknown keys (including research and AI instruction keys) fail with the existing
`validation/invalid_input` code, on reads and writes, before database access.

Core owns the closed key list and value validation. Consent accepts only `yes` and
`no`. Version fields accept an empty clear marker or a valid Semantic Version with at
most 128 Unicode characters, including prerelease/build metadata. Values are never
trimmed or normalized. The existing trim of key whitespace remains compatible.

The app validates before writing and returns malformed existing updater values as
unset, without mutation. No migration, key deletion, historical rewrite, or encryption
change is needed. A malformed legacy consent never enables automatic checking.
Research and AI settings write through private app persistence behind their existing
validated service APIs. There is no new Axum route or change to the desktop manifest.

## Consequences

Shipped updater values and clear operations remain compatible across reopening and
vault locking. Generic callers writing other keys must use the feature's dedicated
API. Public updater commands cannot read or overwrite another feature's settings.
The mock and Rust validation share a golden so accepted inputs cannot silently drift.

This is input-schema enforcement, not content classification or a guarantee that a
string shaped like a version could never encode sensitive information. Custom AI
instructions retain their existing plaintext storage; provider keys remain exclusively
in the OS keychain. Direct database modification and old binaries remain outside this
API boundary. The already-transitive offline `semver` crate becomes a direct core
dependency (MIT/Apache-2.0), avoiding a separate handwritten Rust version parser.
