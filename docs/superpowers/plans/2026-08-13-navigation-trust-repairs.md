# Navigation trust repair plan

The 0.10.6 five-pass browser audit reproduced three current `main` defects and the user selected
all three for implementation:

- **VY-UF-01:** Search and Settings page transitions change the main subtree without placing focus
  in the destination; leaving Settings removes the focused control and falls back to `body`.
- **VY-UF-02:** browser-from-source Settings copy says there is no local database even though the
  supported loopback Axum path persists the workspace in local SQLite.
- **VY-UF-03:** Trip/List → Search → Settings → Back → Back gets stuck in Search because both
  detours overwrite one `returnView` slot.

The private HTML audit report outside the repository preserves the exact before evidence. This
plan turns each selected gap into a bounded, observable repair without changing domain rules,
storage, transport payloads, provider behavior, or desktop backup semantics.

## Product and architecture boundaries

The behavior change belongs to `apps/web`:

- `App.tsx` remains the single owner of top-level view and URL/history synchronization under
  ADR-0015. It will use the browser's existing view history for Search/Settings detour return
  instead of maintaining a second, lossy return slot.
- A private index in `history.state` will distinguish an app-owned prior entry from a direct
  Search/Settings URL. The index is never written to the address bar, persisted outside browser
  history, sent through `AppGateway`, or exposed to Tauri/Axum.
- Search terms remain outside the URL and continue to ride only in view state/ref memory. The
  existing exact-record search-result handoff and trip-section hash contract remain authoritative.
- Focus handoff will be driven only by explicit page-transition intent. It will not run on initial
  mount, data refresh, transport recovery, query edits, or hash-only section navigation.
- Unsupported backup copy will distinguish local SQLite persistence from the packaged desktop's
  native file picker and portable encrypted `.vbk` backup bridge. It will not recommend copying a
  live WAL database, imply that a raw database is portable, or change backup implementation.

ADR-0015 will be amended because the implementation clarifies how Search/Settings in-app Back
controls use the history entries that ADR already requires. No new ADR is needed: no public
contract, route, payload, migration, storage rule, provider, or authority boundary changes.

## Gap decisions and acceptance checks

### VY-UF-01 — transition-intent focus

Decision: mark each top-level h1 as the programmatic page-entry target with `tabIndex={-1}` and a
shared data marker. `App.tsx` will consume a one-shot focus intent in a layout effect after an
explicit Search/Settings entry or a real top-level `popstate` transition. The exact search result
continues to own focus when Search opens a record.

Acceptance:

- Topbar Search and Settings entry focus the destination h1 without scrolling it away.
- Settings/Search in-app Back and browser Back/Forward focus the restored destination h1.
- Search-result navigation still focuses the matching record, not the trip h1.
- Hash-only history changes retain section behavior and do not focus the trip h1.
- Initial mount, query changes, revalidation, locale/theme changes, health recovery, and ordinary
  data updates do not trigger a page-entry focus handoff.
- Focus remains visible for keyboard navigation and creates no horizontal overflow or narrow-screen
  scroll jump at 320px or the 200%-equivalent reflow pass.

### VY-UF-02 — truthful browser backup boundary

Decision: replace the English and Spanish unsupported copy and its source comment. State that the
browser-from-source path still has a local SQLite workspace, while the integrated portable
encrypted backup and restore controls require the packaged desktop bridge.

Acceptance:

- Neither locale says browser data is absent, ephemeral, browser storage, or safe to copy live.
- Both locales distinguish persistence from portable encrypted backup capability.
- The unsupported bridge still rejects export/restore, and the packaged Tauri bridge is untouched.
- README, download, architecture, and troubleshooting documentation are verification sources;
  change them only if the later full docs pass finds a concrete contradiction.

### VY-UF-03 — nested detours unwind through history

Decision: remove the shared `returnView`. Stamp same-document view entries with a private monotonic
history index. Search/Settings Back calls `history.back()` only when an app-owned predecessor is
known; a direct or malformed detour URL falls back safely to All Trips through normal view state.

Acceptance:

- Trip and List origins both complete Search → Settings → Back → Back without a no-op or loop.
- The Search query and originating trip section hash survive the nested round trip.
- Settings → Search → Back → Back also unwinds to its origin.
- Browser Back/Forward traverses the same view sequence without duplicate entries.
- Repeated clicks on the active topbar view do not clear Search, add history, or create self-return.
- Direct Search/Settings URLs and history entries without the private marker use the safe List
  fallback and never leave an enabled Back action that does nothing.

## Test-first sequence and commits

1. `Docs:` commit this plan before product implementation.
2. `Test:` extend `flowFixes.test.tsx`, `backupPanel.test.tsx`, and `e2e/planning.spec.ts` with the
   failing focus, nested-detour, direct-entry fallback, copy, history, and negative-focus cases.
3. `Web:` implement the private history-entry marker, transition-intent focus handoff, marked h1
   targets, and corrected localized backup copy/comment.
4. `Docs:` amend ADR-0015 and add user-facing Unreleased changelog prose with the tradeoffs and
   intentionally unchanged desktop/storage boundaries.
5. Update the private audit report with same-condition after evidence and mark each selected gap
   `Resolved` only after its exact runtime reproduction stops failing.
6. Refresh Graphify, verify a scoped navigation query, run every gate below, and review the final
   diff for accidental contract, provider, storage, or release changes.

## Verification charter

- Focused web tests: `flowFixes.test.tsx`, `backupPanel.test.tsx`, `workspaceSearch.test.tsx`,
  `sectionNav.test.tsx`, `tripSearch.test.tsx`, `a11y.test.tsx`, and `theme.test.tsx`.
- Real Chromium: Trip/List → Search → Settings → Back → Back; direct Search/Settings fallback;
  query/hash preservation; active element after each top-level transition; exact search-result
  focus; hash-only no-handoff; corrected English and Spanish copy; 320×720, 375×812, 768px, and
  1280×900, including dark theme and 200%-equivalent reflow.
- Neighboring flows: create/open trip, Search result navigation, browser Back/Forward, topbar home,
  Settings return, vault lock URL cleanup, transport recovery, reload persistence, archive/unarchive,
  and Visa narrow-layout regression.
- Repository gate: `make check`, `git diff --check`, `pnpm audit --prod`, and the exact credential
  scan from the repository security workflow.
- Graph gate: `graphify update .`, then a scoped query covering top-level view history, detour Back,
  transition focus, Search query privacy, and trip-section hashes.
- Evidence boundary: automated DOM focus is not manual screen-reader speech; Chromium does not prove
  packaged Tauri, Windows, or physical-touch behavior. Those remain named limitations until the
  later shipped-product release gate.

Not expanded by this plan: Rust domain/application code, gateway contracts, routes, migrations,
provider/network behavior, backup file format, vault/keychain behavior, platform support, version
numbers, public docs redesign, branch cleanup, tags, release artifacts, or deployment. Those later
tasks keep their own evidence and authority gates.
