# Locked-vault updates: recovery design research

Date: 2026-11-25. Status: research only; no new update path implemented or approved.
Owner direction: investigate safe updates while locked; preserve authentication
and do not bypass unlock. The current protected-workspace update still requires
unlock before its safety copy can succeed. This note changes no contract, storage
format, dependency, key policy or runtime behavior.

## Finding

The original [UPDATES D2](../architecture/UPDATES.md) wanted security updates to be
available before unlock because fetching release metadata needs no trip content.
The later [ADR-0026 amendment](../architecture/ADR-0026-local-snapshot-credential-lifetime.md#amendment--verify-the-pre-update-safety-copy-before-installation-2026-11-08)
requires a newly completed safety snapshot to authenticate every declared sealed
column before installation. Those are different operations. Keeping the update
surface visible does not prove a usable recovery copy exists.

Source inspected at the inherited `ab278527` implementation, retained in the
production-readiness branch:

- [`AppService::backup_database`](../../crates/voyalier-app/src/service_backup.rs)
  holds workspace-operation custody, resumes prior recovery, adopts known copies
  and calls `create_update_snapshot` with the current vault state.
- [`create_update_snapshot`](../../crates/voyalier-app/src/backup_recovery.rs)
  refuses `protected && key.is_none()`. It reserves retention, makes a consistent
  SQLite snapshot, checks its embedded wrap against the verified wrap, authenticates
  its sealed rows, binds its hash/credential and only then rotates eligible history.
- [`Vault` and `VaultState`](../../crates/voyalier-app/src/lib.rs) keep the available
  data key and verified-wrap identity in memory. The protected startup state has no
  usable data key. [`unlock_vault`](../../crates/voyalier-app/src/service_vault.rs)
  verifies the supplied passphrase against the stored wrap before supplying it.
- [ADR-0017](../architecture/ADR-0017-the-vault-key-belongs-to-its-database.md)
  scopes credential identity to the workspace. [ADR-0021](../architecture/ADR-0021-restore-generations-are-recoverable.md)
  requires a readable database/key pair before a restore generation commits.

These are source facts, not proof of native keychain availability, power-loss
recovery, installed updater behavior, or the traveler's knowledge of a passphrase.
No real workspace, provider, keychain, installed app or update was used for this
research. No external cryptographic protocol is selected here.

## What a locked process can and cannot establish

| Observation while locked                                  | Establishes                                                                 | Does not establish                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Consistent SQLite snapshot and structural integrity check | A bounded structurally valid snapshot of committed database state           | That any encrypted row authenticates or can be read                                                                 |
| Hash of the copied bytes                                  | An identity usable for detecting a later change against a trusted reference | Correct plaintext, a valid data key, trustworthy origin of an editable reference, or future credential availability |
| Embedded passphrase wrap with valid shape                 | Recovery material is present and syntactically recognizable                 | Correct passphrase, authentic unwrap, readable sealed rows or a remembered password                                 |
| Retained keychain account or fingerprint                  | An expected credential identity/reference exists                            | That the OS will return the right key after upgrade, reinstall, denial or loss                                      |
| Signed updater artifact                                   | Artifact authenticity under the configured updater trust boundary           | The workspace is recoverable, migrations are safe, or the user can unlock                                           |
| A historical snapshot that once authenticated             | That exact older generation was readable at its verification time           | That a new snapshot is readable, that later edits are included, or that credentials remain obtainable               |

The current code intentionally separates keyless readable data from an inaccessible
key. Neither a missing credential nor an inaccessible keychain authorizes generating
a replacement key. Never retain a raw data key just to make a protected workspace
silently decryptable while it claims to be locked.

## Options

| Option                                                                                                                                                     | Pros                                                                                                          | Cons / limits                                                                                                                                                                              | Effort and disposition                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Keep unlock before verified backup and install                                                                                                             | Preserves the existing authenticated-snapshot gate and key lifetime                                           | A traveler unable to unlock cannot complete this in-app update path                                                                                                                        | Existing behavior; retain now                                          |
| Explicitly authorize temporary verification with the passphrase, then return to a locked screen                                                            | Could avoid exposing trip UI while allowing a newly verified snapshot                                         | The data key is still temporarily available to the process: this is scoped authentication, not a keyless locked update; needs a clear security-state/consent decision                      | Medium–large; separate ADR and memory/lifetime review; not implemented |
| Verify and seal an immutable update-recovery generation while unlocked, then install while locked only if that exact generation still covers the workspace | Potentially avoids keeping a decryption key while locked and preserves evidence from a real readability check | Requires trustworthy freshness, anti-substitution/replay, credential custody and an upgrade bootstrap that preserves the verified pair; old snapshots cannot silently stand for newer data | Large research/design change; conditional candidate below              |
| Copy ciphertext and update now; try the passphrase later                                                                                                   | Small implementation surface                                                                                  | Cannot meet the current pre-install readability guarantee; corruption/key mismatch is discovered after replacing the app                                                                   | Rejected as an unlock/verification bypass                              |
| Keep an extra unwrapped recovery key accessible while locked                                                                                               | Makes the copy readable to the app                                                                            | Undermines passphrase protection and expands key custody                                                                                                                                   | Rejected                                                               |

## Conditional future design: prepared recovery generation

This is a falsifiable design proposal, not a claim that a safe locked update has
been solved. Start with a separate ADR and threat-model review before changing code.

1. While the traveler has explicitly authenticated, create an immutable snapshot
   under workspace-operation custody. Authenticate all sealed columns, the exact
   wrap/key binding and structural/schema bounds, then prepare a uniquely owned
   recovery generation. Retain existing historical copies and their credentials.
2. Bind a durable verification receipt to the exact snapshot, schema/storage
   version, workspace identity, wrap/credential intent and a complete freshness
   boundary. A plain editable hash file is insufficient against substitution.
   Select and review how the receipt is authenticated without leaving a decryption
   key available after lock. Do not reuse the updater signing key or export secrets.
3. Prove that every later mutation relevant to recovery invalidates the prepared
   generation before it can become eligible for installation: sealed and plaintext
   rows, migration, wrap/passphrase change, restore activation and key custody all
   matter. Account for independent connections, WAL, crashes and restarts. A check
   followed by an unfenced write is not sufficient. VACUUM snapshot bytes may differ
   from the live database layout, so a naive live-file hash comparison is not a
   complete freshness design. An epoch must cover all writers and resist rollback
   within the explicitly chosen threat model.
4. On a locked install request, take custody and refuse missing, stale, altered or
   ambiguous receipts, unavailable required recovery material and unresolved restore
   generations. Do not silently use an older verified snapshot and discard newer
   user edits. Eligibility must be revoked if any needed proof is absent.
5. Install only an authenticated app artifact. Keep the exact prepared old recovery
   pair until the candidate has proved its data path. A new startup path must avoid
   mutating/migrating the protected workspace before the required authentication
   and recovery boundary; today's startup behavior cannot simply be assumed to do
   that. Reinstalling the previous app is not database rollback.
6. After explicit unlock, validate the preserved pair and complete the generation
   protocol. Never report restoration complete from a marker alone. Cleanup must
   retain old credentials until no owned recovery reference needs them, and restart
   must converge after interruption at every state transition.

The remaining hard question is trusted freshness while locked without retaining a
secret that defeats lock. This proposal may be unsuitable if the supported threat
model includes an attacker able to roll back both the database and every local
receipt/verification anchor. A prior good signature cannot prove the most recent
state without an appropriate freshness anchor. Reject the path, rather than
weaken the guarantee, if the required anchor or writer coverage cannot be justified.

Even a successful design cannot prove that a traveler will remember a passphrase
or that an OS credential store will remain available forever. State the supported
failure model precisely. Native denied/missing/wrong key cases remain required.

## Verification required before selecting an implementation

Use shipped FakeFetcher and MemorySecretStore for source fault injection and
separate isolated native credentials for target-platform qualification.

- Positive cases: unchanged protected generation, legitimate keyless data,
  unlocked protected data, exact notes/attachments/plans recovered after reopen.
- Refusals: wrong/missing/denied key, changed wrap, damaged sealed row, missing or
  substituted snapshot/receipt, stale schema, earlier receipt replay, path alias,
  sibling workspace, any newer user write or unresolved restore generation.
- Interrupt every receipt, snapshot, key-retention, invalidation, install, migration,
  generation-commit and cleanup boundary; restart with exact file/hash/key intent.
- Verify concurrency across independent connections, SQLite WAL state and the
  native update-operation owner; no overlapping installation or stale eligibility.
- Observe both Apple Silicon WKWebView and Windows WebView2 from exact artifacts,
  supported-base upgrade and candidate-as-base future update. Test filesystem and
  native keychain denial separately. Source fakes cannot establish native behavior.
- Keep authentication out of logs, argv, environment, metadata, screenshots and
  public contracts. Observe offline behavior and zero new provider/data disclosure.

No tests were added or run for this unimplemented design. The recommendation is to
retain the current fail-closed gate while evaluating whether the prepared-generation
requirements justify their complexity. Any selected design needs its own plan,
ADR, implementation review and installed recovery evidence.

## Related product and accessibility decisions

The owner separately retained the concierge's explicit English fallback. This does
not exempt the trip-idea create/list flow from selected-language labels and errors;
see the [product brief](../product/PRODUCT_BRIEF.md#language-scope). English language
annotations support pronunciation but do not prove complete spoken access.

PDF preview currently exposes a bounded canvas, page labels/status and an adjacent
Save copy route (`PdfPreview` and `ConciergeCockpit`). A canvas alone does not prove
an accessible reading route; it also does not prove that no route exists. Test a
fictional text/tagged PDF and a scanned PDF with VoiceOver/WKWebView and
NVDA/WebView2, including actual content, page navigation, save-copy handoff, cancel,
replacement and cleanup. No exact isolated native artifact/AT session was available
to this research worker, so native PDF acceptance remains untested. Do not infer
that saving a scanned document supplies accessible text, add OCR, or change the
renderer on the strength of this source observation alone.
