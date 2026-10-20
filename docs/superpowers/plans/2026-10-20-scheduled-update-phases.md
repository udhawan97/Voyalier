# Voyalier scheduled update phases

Date: October 20, 2026, America/Chicago.

This is the canonical next-work queue for scheduled Voyalier implementation.
Finish the existing security and native-verification work, strengthen the
cross-shell journey, complete a bounded Spanish concierge experience, and then
add useful local review reminders and more dependable provider returns. Each
packet below is independently reviewable. A scheduled run selects at most one
packet; it does not attempt the entire roadmap.

The current request authorizes this implementation queue for future scheduled
runs. This planning change implements no product feature and creates no release.
The scheduler's existing repository priority, ownership, integration and release
rules continue to apply. No new schedule, cadence or model is required.

## Baseline and existing work

Recheck this snapshot before implementing:

Snapshot collected during the October 20, 2026 planning session. GitHub evidence
is the main commit API and PR 131 head/check summary; scheduler evidence is the
saved CAPO `automation.toml` and the app's automation view. These are observations,
not continuing guarantees.

- Local main and GitHub main were both
  `042ed9b23ee3c3a709c534010726f9c9329abea6`.
- [PR 131](https://github.com/udhawan97/Voyalier/pull/131), headed at
  `a66e5a9c964c095b383725a5c272ddd3098e30ba`, was open. Its existing worktree is
  `/Users/umang/.codex/worktrees/dev-review-remediation/Voyalier`. The Windows
  source job was still running; successful source jobs do not establish installed
  acceptance. Its owner and unfinished work take precedence over a duplicate fix.
- The active weekly CAPO heartbeat selects at most two substantial repositories.
  Its existing Sunday noon America/Chicago cadence is unchanged. This queue
  applies when Voyalier is selected; it does not guarantee a weekly Voyalier run.
  No local Elf or Mobster automation definition was found in the inspected
  automation directory; their prompts and execution history were not verified.
- [The v0.12.0 ledger](../../release/v0.12.0-verification.md) already records the
  delivered concierge, wallet, money and travel-day slices. Do not replay the
  original P0–P7 build plan or treat its old native evidence as current.
- [ADR-0023](../../architecture/ADR-0023-journey-requests-share-wire-fixtures.md)
  covers selected journey requests. The newer
  `packages/contracts/fixtures/profile-date-assist-wire.json` already covers
  profile revisions, Today dates and assist approval, but its traveler, cost,
  wallet, task and handoff arrays are empty. This is the concrete starting point
  for deeper shared-field coverage, not a claim that those features lack tests.
- `apps/web/src/views/ConciergeCockpit.tsx` still contains English interface
  labels. Wallet dates already persist as `expiresOn` and render as “review by”;
  cost records already have `dueDate`. Reuse those fields before proposing storage.

Source navigation used the existing Graphify graph, then the linked source,
fixtures, ADRs, release ledger and current GitHub state. The broad graph query was
truncated; source inspection, not the partial graph, establishes these claims.

## Run protocol

1. Read `AGENTS.md`, `CONTEXT.md`, this queue, the
   [run record](2026-10-20-scheduled-update-run-record.md), and the selected
   packet's referenced ADRs. Inspect main, remote heads, worktrees, open PRs,
   relevant CI, package state and concurrent work. Revalidate the packet's
   limitation; mark already-delivered work satisfied with evidence.
2. Claim one packet in the run record using a run/chat identifier, branch,
   worktree, base SHA and timestamp. Use an isolated worktree for implementation.
   Establish exclusive ownership in a shared location before creating the branch:
   atomically create a packet-specific claim directory under the path returned
   by `git rev-parse --path-format=absolute --git-common-dir`, in
   `voyalier-scheduled-claims/<packet-id>`. Store the owner and worktree there.
   If the directory already exists, reconcile its owner and stop conflicting
   work. Publish the same claim in the run record; do not treat an isolated
   branch edit as a shared lock. All executors of this queue must use this seam.
   Reuse an unfinished packet only after confirming its owner is inactive or
   explicitly handed it off. Age alone is not permission to steal a claim.
   If the record cannot be updated safely, do not start conflicting mutations.
   Release only the current run's claim after checkpointing its next action;
   retain it while a live owner is still working. Never remove another owner's
   claim merely because it looks old.
3. Complete the selected packet's concrete design, fixtures and file scope.
   Reconcile it against the current tree. Obtain the plan council below and
   commit that plan before implementation. These phase descriptions authorize
   bounded work, not an unreviewed expansion into a new provider or subsystem.
4. Implement one useful slice in layer order. Use core for deterministic rules,
   app for IO and the existing `AppService`, `AdviceFetcher`, `SecretStore`,
   `Records`, gateway and localization seams. Add an ADR before changing
   contracts, transport, storage or provider behavior. Never edit a shipped
   migration; do not introduce a new framework.
5. Run the packet's focused checks, then `./scripts/check.sh all` and
   `git diff --check`. The all stage includes web, Rust, desktop and integration;
   a bare `cargo test` is insufficient. Add relevant production audits and
   credential checks from `.github/workflows/security-hygiene.yml` for dependency,
   network, vault or storage changes. Keep failures visible.
6. Refresh an existing graph after code changes and verify a scoped query.
   Record warnings and corroborate with source. Graph refresh failure prevents
   claiming the packet complete and blocks any release.
7. Review the exact diff, tests and artifacts through the implementation council.
   Integrate only with applicable authorization, required checks and protections.
   Recheck final PR SHA and CI immediately before merging. If the base or final
   tree changes, rerun affected checks and refresh affected council acceptance.
8. Update the run record with attempted, verified, committed, merged, installed
   and released states separately. Preserve an unfinished branch and record one
   precise next action. A run may deliver no change when there is no safe packet.

Keep runs finite: one packet and its validation, not an arbitrary number of
commits. If the scheduler's run budget expires, checkpoint instead of starting
another packet or relaxing verification. Stop retrying an unchanged failure;
record its signature, previous attempt, new evidence and next required action.
Notify only for meaningful progress, completion, failure or required owner action.

## Council gate for every packet

Use the installed `council-review` skill: exactly two full rounds, four independent
reviewers each round, in the evidence, coverage, risk and outcome roles. Run
reviewers sequentially when concurrency is limited. Reviewers must not recursively
start councils.

Before code, all reviewers receive the same compact packet: current base SHA,
problem evidence, intended behavior, non-goals, files/ADRs, acceptance matrix,
rollback and proposed result. Round 1 challenges it; revise; Round 2 confirms.
Each returns `APPROVE`, `APPROVE_WITH_NITS` or `BLOCK`. Resolve valid blockers and
obtain targeted acceptance for material corrections. Missing reviewers block the
gate unless the user explicitly changes the requirement.

After implementation, repeat that two-round gate on the exact candidate diff,
checks, target-surface evidence and proposed completion report. Bind the record
to candidate SHA/tree and plan digest. Council approval is not proof of test,
native acceptance, source rights, medical/legal correctness or release readiness.
Keep private transcripts out of the repository; record only verdicts, material
corrections, evidence and unresolved limits.

For reconciliation-only, evidence-only and verified-no-op packets, the second
gate reviews the evidence and proposed completion report instead of a product
diff. It still requires two rounds and all four roles; “no implementation” does
not waive review of completion claims.

## Phase order and selection

| Phase                                     | Packets                                    | Prerequisites                                | First useful result                                       |
| ----------------------------------------- | ------------------------------------------ | -------------------------------------------- | --------------------------------------------------------- |
| 0 Recovery and current acceptance         | 0A reconcile; 0B native evidence           | Existing owner coordination                  | One truthful, current security and acceptance baseline    |
| 1 Shared nested journey coverage          | 1A profile; 1B wallet and money            | 0A; no conflicting owner                     | Real nested fields survive both shells                    |
| 2 Spanish concierge and accessible states | 2A forms; 2B generated guidance            | 0A; no conflicting owner                     | A defined everyday journey works in Spanish               |
| 3 Local review and due-date agenda        | 3A projection; 3B UI and continuity        | 1A, 1B, 2A                                   | Wallet review dates and payment dates become actionable   |
| 4 Provider return continuity              | 4A capability evidence; 4B return flow     | 1A, 2A                                       | Travelers can return from research without losing context |
| 5 Performance and release qualification   | 5A measured optimization; 5B qualification | Completed selected product slices; 0B for 5B | A measured, usable candidate with honest release evidence |

0B may remain blocked on a device or protected workflow while independent
source-only packets progress after 0A. It blocks installed-acceptance claims and
release qualification, not unrelated source improvements. A packet with new
security/data-loss evidence preempts the normal sequence.

The run record's packet prerequisites are authoritative; the phase table is an
overview. Update both together when council-approved sequencing changes.
Select the earliest ready packet in listed order, skipping blocked or actively
owned work and documenting the reason. Security/data-loss evidence can preempt
that order; do not select a larger novelty project because a smaller gate is hard.

## Phase 0 Recovery and current acceptance

### 0A Reconcile the active repair

**Problem:** PR 131 already owns dependency repairs and installed verification.
Starting another repair from old main risks duplication and contradictory results.

**Work:**

1. Read its current plan, ADR-0031 if present, diff and exact-head checks. Check
   whether it merged since the snapshot. Inspect the existing owner's status
   without sending another chat instructions unless the user authorizes that.
2. Inventory related dependency PRs. Compare actual lockfile changes and runtime
   compatibility; do not merge all dependabot updates as a side effect.
3. Record remaining source, Windows, installed-macOS and updater gates separately.
   Reuse completed exact-artifact evidence only when its scope and identity match.
4. If the owner is active, record ownership and select an independent packet.
   If safely handed off, resume that PR's approved scope and required checks.

**Exit:** one baseline/ownership entry and one next action for every unfinished
gate; merged work is proven by default-branch ancestry. This reconciliation can
complete without claiming 0B complete.

**Rollback:** read-only reconciliation needs no product rollback. Never reset,
clean, stash, delete or overwrite the owner's worktree.

### 0B Record current installed acceptance

**Scope:** execute
`docs/superpowers/plans/2026-10-19-docs-advisory-installed-verification.md` in the
PR 131 worktree named above (or its verified merged/superseding version) against
the accepted candidate, not a second unrelated app installation workflow. Apply the installed
`shipped-product-verification` skill when doing this work.

That plan records earlier restore staging failure under isolation, blocked
OS-keychain access, and no separate WebKit datastore identity. It also retains
normal-profile process exposure and unaudited startup writes in private evidence.
Revalidate those limits; do not copy a historical partial pass into this gate.

**Cases:** disposable trip create/reopen; draft save/rejection/restart; local-date
Today; synthetic confirmation import/review; encrypted PDF/image preview; backup
export, cancellation and restore through native pickers; lock/unlock and retained
recovery copies. Windows install/update/reinstall acceptance uses the existing
workflow and sanitized evidence. Record exact OS, architecture, source SHA,
package checksum/signature, dataset and observed outcomes.

Use task-owned data, credentials, caches and evidence. Inspect isolation before
launch. Never experiment against the normal traveler workspace or real provider
keys. Blocked OS keychain testing proves no real-keychain acceptance; a separate
task-owned keychain test is necessary to make that claim.

**Exit:** every applicable required case must pass for 0B acceptance. Record each
case as pass, fail or blocked, or not applicable with a specific rationale.
Evidence collection may finish with failures, but both failed and blocked required
cases retain the qualification hold and prevent 0B acceptance and 5B completion.
macOS results cannot establish Windows behavior;
MockRuntime cannot establish installed behavior. Keep unrecoverable device,
permission, protected-workflow or signing prerequisites as explicit holds.

**Rollback:** preserve the prior installed bundle recoverably, retain recovery
evidence, and stop the task-owned app before restoring its prior installation.
Never purge the user's data/keychain to obtain a clean result.

## Phase 1 Shared nested journey coverage

### 1A Populated profile and stale-write fixtures

**Files:** existing `profile-date-assist-wire.json`, `profileDateAssistWire.test.ts`,
desktop inline tests, relevant live HTTP tests, and ADR-0023. Inspect the existing
revision tests before extending them.

**Work:** add one populated fictional profile with travelers, area stays, task
progress/history and handoffs. Construct typed requests explicitly in both
gateways; do not spread the fixture into a request. Dispatch the shared envelope
through MockRuntime with `FakeFetcher::offline()` and `MemorySecretStore`.
Substitute only generated identifiers and revisions. Assert persisted nested
values, returned field names, and equality after restart/readback.

**Cases:** optional omitted versus present values; non-ASCII labels; false and
zero values; unchanged versus stale revision; a failed save makes no mutation;
legacy valid profiles remain readable. Deliberately rename a representative
optional wire key in a disposable copy and show the assertion fails; restore it.

**Exit:** both gateways, real service and live HTTP agree on the populated
contract. Existing three-step coverage remains intact; counts change explicitly
only if steps are added. Never regenerate `routes.json`.

### 1B Wallet links and exact-currency money fixtures

**Prerequisite:** 1A.

**Files:** the same fixture seam or a small hand-maintained companion, desktop
attachment tests, `gateway.live.test.ts`, contracts and concierge app tests.

**Work:** cover a synthetic attachment linked to a traveler and preparation
requirement, review date, source detachment, one unknown amount, one exact amount,
one refund and two currencies. Assert round-trip bytes/hash only for tiny
synthetic files; metadata listing must not return file content.

**Cases:** attachment removed versus source fetch failed; stale profile rejection;
invalid date/currency and out-of-range amounts rejected without mutation;
restored workspace retains links; secret material absent from contract payloads.
Test limit rejection through existing bounded fixtures rather than allocating a
workspace-sized blob in every suite.

**Exit:** source removal preserves authored labels/notes, currencies never sum
together, unknowns stay unknown, and serialization errors fail on each transport.
This extends coverage; it does not redesign the existing storage rules.

**Rollback for Phase 1:** revert the isolated test/fixture change if wrong;
never alter production schemas to make a fixture pass. Any discovered product
defect gets a reproducer and a bounded, council-reviewed fix before proceeding.

## Phase 2 Spanish concierge and accessible states

### 2A Localize the everyday forms

**Problem:** the translated shell still exposes English concierge controls.
Make a bounded journey complete before claiming whole-product localization.

**Files:** `ConciergeCockpit.tsx`, `app/i18n.ts`, existing locale/cockpit tests and
docs explaining language coverage. Preserve existing save ownership and revision
logic.

**Work:** inventory interface-owned strings for overview, setup, people, wallet,
money and provider return controls. Move them into the existing typed EN/ES
dictionary; include labels, accessible names, errors, empty/loading/retry states,
status announcements and confirmation text. Retain proper names, imported source
text and traveler-authored content verbatim.

**Cases:** language change with unsaved edits; failed and delayed saves; plural
travelers and money; long Spanish strings at 200% zoom; light/dark/reduced motion;
keyboard order, visible focus, dialog close/restore and screen-reader labels.
Use the actual target Safari and installed webview for their respective claims.
Read the Safari skill and run its doctor/documentation bootstrap for browser work.

**Exit:** the named form journey has EN/ES parity without losing drafts or
changing provider/authority meaning. Update language documentation to name the
verified scope; no claim of complete translation of all source content.

### 2B Localize deterministic guidance without rewriting evidence

**Prerequisite:** 2A. Core currently supplies substantial human-readable guidance;
first inventory which text is generated by Voyalier versus quoted from a source.

**Design gate:** prefer additive stable message identifiers and structured
interpolation arguments, retaining old English fallback fields for compatible
clients. Document the exact contract in an ADR before changing it. No business
rule moves into React to make translation easier.

**Cases:** Hawaii and Montréal preparation/task projections; unknown context;
missing message identifier fallback; unchanged task identity/progress after a
locale switch; stale source dates and conditional wording preserved; source URL,
license and original excerpt unchanged.

**Exit:** selected generated task/preparation guidance renders in EN/ES with
backward compatibility and shared wire coverage. Do not translate official
statements into new eligibility conclusions. Unsettled terminology is a specific
copy-review hold, not permission to invent a stronger claim.

**Rollback for Phase 2:** revert the interface changes and retain compatible
fallbacks. Never translate or rewrite saved traveler/source records in a migration.

## Phase 3 Local review and due-date agenda

### 3A Project existing user-entered dates

**Problem:** wallet review dates are visible inline, but deserve a focused local
review queue alongside existing cost due dates. First confirm the gap still
exists; retain existing quick access rather than rebuilding it.

**Design:** core projects a bounded agenda from `WalletLink.expiresOn` and
`CostItem.dueDate` using an explicit reference calendar date. Wallet wording is
“review by”; payment wording is “payment date you entered.” Neither proves legal
expiry, entry eligibility, debt status or payment. Preserve the mixed legacy
“review or expiry” field's meaning; do not silently reinterpret saved records.

Propose an additive projection on the existing concierge workspace with optional
reference date, or another small compatible seam after tracing current reads.
Choose one in the packet ADR before code. Do not add storage just to cache a
deterministic result. Core performs date arithmetic, stable ordering and
categorization; app only retrieves inputs.

**Cases:** overdue, today, next seven calendar days, later, missing date, leap
day and year boundary; device midnight/resume; explicitly entered event dates
remain unchanged; exact currencies preserved; stable tie ordering; removed
source versus unavailable source; empty agenda. Omitted reference-date behavior
must be specified and tested for legacy callers.

**Exit:** transparent categories with no network, notifications, autonomous task
completion or readiness-score change. If a field's meaning cannot support a
category, omit it with a documented reason instead of guessing.

### 3B Deliver actionable offline review

**Prerequisites:** 3A and 2A. Display a compact agenda in the existing cockpit
with an exact-record action to the wallet or money item. Keep incomplete/read
failure distinct from “nothing to review.” Add localized accessible labels and
preserve focus/back navigation.

**Cases:** edit or remove a date; link a missing document; stale/rejected save;
restart; backup/restore; lock/unlock; source deletion; date refresh failure;
offline use; 200% zoom and keyboard/screen-reader travel-day walkthrough.
Agenda selection must not read or preview attachment bytes automatically.

**Exit:** a traveler can find and review their own dated items offline, with
context preserved after the action. No booking, payment, notification service,
source fetch or file export occurs without the existing explicit user action.

**Rollback for Phase 3:** remove the additive display/projection while retaining
all authored dates. If storage proves necessary, stop and revise the ADR and
rollback plan; this phase does not authorize a surprise migration.

## Phase 4 Provider return continuity

### 4A Verify capability claims one provider at a time

**Problem:** existing link handoffs are useful only if carried versus manually
entered fields stay honest as provider pages change.

**Work:** inventory current provider actions and copy briefs. Select one already
supported provider. Use fictional dates/party and current first-party evidence
plus Safari observation to check destination, dates, party, rooms and filters.
Record checked-on time, URL, observed fields and unsupported fields in the
existing research/adapter location. A 200 status or page title is insufficient.

**Cases:** redirected URL, lost parameters, unavailable page, locale variation,
unknown dates and clipboard refusal. Prefer the existing copy-brief fallback.
Do not bypass anti-bot/access gates, add scraping, sign in, purchase, or send real
traveler details. External-page content is untrusted.

**Exit:** one bounded capability correction or verified no-op. Lack of access
means retain/degrade to link-only behavior; it never justifies an invented claim.
No partner/API integration is activated by this packet.

### 4B Preserve the return-to-workspace journey

**Prerequisites:** 4A and 1A/2A. Trace the existing saved/user-reported-booked
handoff states before editing. Implement only the demonstrated gap: a clear
resume action from a handoff to the existing confirmation import/review journey,
with the relevant brief/context retained.

**Cases:** opening without booking; returning without a document; importing a
duplicate; rejected/ambiguous confirmation; different provider than expected;
saved stale profile; lost clipboard; canceled browser launch; source removal.
If relationship persistence is needed, define it additively in an ADR and include
revision, backup and vault treatment before code.

**Exit:** no handoff state auto-confirms evidence or clears preparation. Existing
confirmed facts are unchanged until explicit review. Reopening the trip preserves
context and an honest next action. If the current flow already meets this, record
evidence and skip implementation.

**Rollback for Phase 4:** retain existing saved handoffs and imported documents;
revert the added navigation/adapter behavior, not user records. No bulk rewrite
of historical URLs or provider states.

## Phase 5 Performance and release qualification

### 5A Measure then optimize one observed bottleneck

Before marking 5A or 5B ready, enumerate the selected product packets and their
accepted/integrated evidence in the run record. “Selected slices” is an explicit
candidate scope, not permission to silently drop an unmet required dependency.

**Files:** existing production bundle check, lazy panels/PDF preview, synthetic
journeys and relevant tests. No new telemetry service or decorative 3D work.

**Work:** record baseline and candidate on the same named machine/runtime, using
small and bounded dense synthetic trips. Measure cold trip opening, input
responsiveness, wallet/PDF first use and navigation back to an exact record.
Record production asset sizes and at least five comparable samples for timing.
Select one bottleneck supported by profiling; define the numeric improvement
target and regression tolerance in the packet plan before optimization.

**Cases:** deferred load canceled; slow and failed data; reduced motion; offline
start; PDF resource bounds; repeated open/close and stale async results. Avoid
wall-clock thresholds in noisy CI unless existing infrastructure supports them.

**Exit:** the selected target is met without regressing the agreed tolerance or
changing semantics; otherwise retain evidence and do not claim an improvement.
Existing bundle checks pass. Native/Safari measurements name their actual host;
Playwright WebKit is not native Safari evidence.

### 5B Qualify the completed candidate

**Prerequisites:** 0B and the chosen slices integrated; incomplete optional phases
need not delay an independently useful release.

Use `docs/release/RELEASE_CHECKLIST.md` and the shipped-product verification skill.
Bind evidence to the final candidate; run all source/security gates, current
macOS and Windows installed journeys, updater swap, backup/recovery, accessibility,
offline and privacy checks as applicable. Update user-facing documentation and
screenshots using synthetic data; do not reuse old checks as new verification.

If the existing scheduled-run authority permits a release and meaningful changes
warrant it, follow protected publication: coordinated five-file versioning,
locked metadata, fresh graph/query, signing/notarization and updater artifacts,
checksums/provenance, protected environment, exact tag/main identity and actual
public downloads/docs verification. Check triggers before tagging. No bypasses,
new hosting, invented version or weakened security controls.

**Exit:** either a separately evidenced release and public-site verification, or
a preserved candidate with named holds. Source merge, installed pass, release
publication and Pages deployment remain separate states.
A preserved candidate with holds is `verification blocked`, never `accepted`.

**Rollback for Phase 5:** revert a measured regression at source through the normal
protected process. For a published defect use the established recovery/release
procedure; never overwrite immutable artifacts or delete evidence to hide it.

## Deferred scope

Mobile companion, encrypted sync, collaboration, autonomous booking, background
provider monitoring, inbox scanning, live inventory, new private APIs, OCR,
document redaction and 3D terrain remain outside this queue. They require distinct
product/privacy/licensing decisions. Do not use a blocked native test as a reason
to start one of these larger projects.

## Scheduler handoff

The existing CAPO prompt should point here and to the run record, preserve its
global priority and two-repository limit, and select one ready packet only when
Voyalier is chosen. It must reconcile active ownership, complete both plan and
implementation councils, preserve unavailable gates, and checkpoint exact evidence.
The current schedule, model, enabled state and notification settings stay intact.
This queue does not edit or presume access to Elf/Mobster instructions.
