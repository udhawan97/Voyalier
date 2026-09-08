# Updater settings boundary

## Selected phase

Close the standing plaintext-settings concern in `docs/architecture/UPDATES.md` at the
public desktop command boundary. The owner requested the next phase and merge. The
prior updater package and bundle boundaries are already merged. This slice requires
no provider, user-data migration, visual redesign, version bump, or release.

## Design and compatibility

Record ADR-0022 before implementation. Keep the existing command names and `{ input }`
payloads, but accept only the four shipped updater keys. Consent is exactly `yes` or
`no`; versions are empty (clear) or bounded valid Semantic Versions. Domain validation
belongs in core. Use the already-resolved MIT/Apache-2.0 `semver` crate as a direct core
dependency rather than introducing another version parser; it is offline and replaceable.

The app layer validates before SQLite access. Invalid stored updater values read as
unset without rewriting data, so an older malformed value cannot strand startup.
Unknown stored keys are preserved but inaccessible through the updater commands.
Research preferences and custom AI instructions retain their dedicated service methods
and use a private persistence helper. These instructions remain plaintext by their
existing contract; this work does not promise secret detection or encrypt all settings.

## Implementation and evidence

1. Commit this plan and ADR before code.
2. Add regression coverage for unknown keys, cross-feature keys, malformed values,
   unchanged database after rejection, valid version suffixes, and reopen persistence.
3. Implement core validation and restrict the public app methods; move internal writes
   to a private helper and retain the existing instruction limits.
4. Exercise real Tauri IPC with valid settings and rejected cross-feature/invalid writes.
   Cover locked-vault updater access and dedicated research/AI setting continuity.
5. Align the shipped updater mock with the same validation, pin both languages against
   a small shared golden, and retain command names/payload parity.
6. Update the updater design and changelog with the exact boundary and limits.
7. Run focused tests, `make check` (which includes integration), `git diff --check`,
   production dependency audit and credential hygiene, then `graphify update .` and a
   scoped query. All writer tests use disposable data and fake dependencies.
8. Run the product skill's two four-role council rounds; resolve valid blockers.
9. Integrate current origin/main, merge with `Merge: updater settings boundary`, push,
   and check the exact merge SHA in hosted CI. Leave other branches/worktrees alone.
