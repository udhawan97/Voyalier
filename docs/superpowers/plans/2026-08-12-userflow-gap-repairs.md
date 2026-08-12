# User-flow gap repair plan

The 0.10.6 runtime audit reproduced three connected web interaction defects on the current
`main`: the Visa passport suggestion list fully covers Save at narrow widths, invalid passport
submission leaves focus on Save, and Workspace Search exposes an enabled empty action that silently
does nothing. This plan repairs all three without changing Voyalier's domain, persistence,
transport, provider, or versioned-contract boundaries.

The standalone audit report remains private and outside the repository. Its measurements are the
before evidence; focused unit and real-browser regression tests are the durable acceptance record.

## Product and architecture boundary

All product-code changes belong to `apps/web`:

- `VisaPanel` continues to own the passport form's local validation and focus behavior. It will use
  the existing `Combobox.inputRef` seam rather than changing the shared component's behavior.
- The suggestion layout fix will be scoped to `.voy-visa__nationality` at the existing 48rem Visa
  breakpoint. Shared origin, destination, and fact-entry comboboxes keep their popup layout and
  keyboard contract.
- `WorkspaceSearch` continues to own query state, debounce, stale-result clearing, and safe
  read-only recovery replay. Empty-query guidance will be local, translated, associated with the
  input, and kept entirely on the client side.
- Empty/whitespace input and helper copy never cross the gateway. A non-empty trimmed query crosses
  `AppGateway`: Tauri carries it as IPC input, while HTTP carries it only to the loopback server in
  the `q` query parameter. The app service validates it, reads local SQLite-backed records, and
  ranks them deterministically in process. The query is not persisted, placed in browser
  navigation/history, or sent to a provider or external network service.
- No ADR is required because there is no contract, route, storage, migration, provider, or product
  authority change. Voyalier remains local-first and makes no new visa or eligibility claim.

## Gap decisions and acceptance checks

### G1 — Visa suggestions obscure Save at narrow widths

At 320×720 and 375×812, the absolute 240px suggestion list overlaps the full 69×44px Save button.
Pointer activation reaches a suggestion instead of the action. At desktop width the field and Save
are separate columns and do not intersect.

Decision: at `width <= 48rem`, change `.voy-visa__nationality` to a one-column grid, explicitly set
its `.voy-field` to `flex: none; width: 100%; max-width: none`, align actions to the start, and let
only that form's suggestion list participate in normal flow. Cap the list to the smaller of 12rem
and 30dvh so Save remains visible while the list itself scrolls. Keep the shared absolute popup
behavior everywhere else.

Acceptance:

- At 320, 375, 767, and 768, an open list and Save have zero intersection; Save remains fully
  visible and pointer operable while suggestions are open.
- The narrow list remains bounded and scrollable, and the page has no root horizontal overflow.
- At 769 and 1280, the list stays attached below the input without intersecting Save; a non-Visa
  combobox still computes to `position: absolute`.
- Shared combobox Arrow, Home/End, Enter, Escape, IME composition, pointer selection,
  `aria-activedescendant`, free-text, and desktop behaviors do not regress. Home/End, pointer,
  IME, free-text, and ARIA semantics are unit-level shared-component assertions; the browser test
  owns layout and hit-testing.

### G2 — Invalid passport input does not receive focus

The single-field form exposes an inline role-alert and `aria-invalid`, but empty or malformed
submission leaves focus on Save.

Decision: keep a local input ref in `NationalityPicker`, pass it through the shipped
`Combobox.inputRef` prop, clear the prior submitted value and focus the input directly in the
invalid submit branch. Show action failures only while the current value is the value that produced
them, so an edit or local validation refusal cannot leave a stale second alert. The interaction
stays in the submit/change handlers; no effect or shared primitive change is needed.

Acceptance:

- Empty and malformed submission focus Passport country code after Save is explicitly focused.
- Exactly one local role-alert remains associated through `aria-describedby`, including the
  sequence valid submit fails with a non-transport error → edit malformed → submit locally.
- Correcting the value clears local invalid state; valid save and transport-error behavior remain
  unchanged.

### G3 — Empty Workspace Search is a silent no-op

The Search button is enabled for empty and whitespace-only input, while both submit and run guards
return without feedback.

Decision: render localized enabling guidance using the existing packing-form pattern. Keep it
inside the input's label wrapper with a stable ID, associate it through `aria-describedby` only
while the query is empty/whitespace, and pass `disabled={!query.trim()}` to Search. Preserve the
defensive guards.

Acceptance:

- Empty and whitespace-only input expose and assert both the English and Spanish helper and disable
  Search.
- The helper is programmatically associated with the input.
- A non-whitespace query removes the empty-state association and enables Search; both form-Enter
  and pointer submission run the valid query.
- Debounce, Enter/pointer submission, stale-result clearing, Back/Settings query restoration, and
  exact failed-read recovery replay continue to pass.

## Test-first sequence and commits

1. `Docs:` commit this plan before product implementation.
2. `Test:` extend `visaPanel.test.tsx`, `combobox.test.tsx`, `workspaceSearch.test.tsx`, and
   `e2e/planning.spec.ts` so the three current defects fail for the measured reasons. Add explicit
   Home/End, pointer-selection, valid Enter/pointer Search, alert-deconfliction, breakpoint,
   bounded-scroll, root-containment, and hit-tested Save assertions.
3. `Web:` implement the scoped CSS, local passport input ref, localized search helper, disabled
   state, and the minimum layout support for that helper.
4. `Docs:` record the user-visible fixes under `CHANGELOG.md`'s Unreleased section, including the
   intentionally unchanged shared combobox and product-contract boundaries.
5. Refresh Graphify, verify a scoped query, run all gates below, and review the diff for accidental
   contract, provider, or release changes.
6. Before merging, run `git diff --check origin/main...HEAD` and inspect `git diff
origin/main...HEAD`; fetch again and require local `main == origin/main`. If remote main moved,
   integrate it on the feature branch and rerun every gate. Close with `Merge: user-flow gap
repairs`, merge into `main` without force, push `main`, and verify local HEAD, fetched
   `origin/main`, and `git ls-remote origin refs/heads/main` agree. Wait for CI,
   `dependencies-and-secrets`, CodeQL `analyze`, and Docs build/deploy on that exact SHA. Do not tag,
   create release artifacts, or manually trigger a deployment. Because the required committed plan
   lives under `docs/**`, the ordinary `main` push will trigger the repository's Docs workflow and
   automatic GitHub Pages deployment; verify the served static site and report that side effect
   honestly. It does not deploy the local product backend.

## Verification charter

- Focused unit suites: Workspace Search, Visa, Combobox, i18n, `errorStates.test.tsx`, and
  `flowFixes.test.tsx`.
- Real browser: `e2e/planning.spec.ts` in Chromium at 320×720, 375×812, 767×900, 768×900,
  769×900, and 1280×900, covering open suggestions, zero rectangle intersection, actual pointer
  Save, list scrollability (`scrollHeight > clientHeight`), invalid focus, empty/whitespace Search,
  valid Enter/pointer Search, localized guidance, non-Visa popup positioning, and root containment.
  Add a direct 200% browser-zoom/reflow pass for Visa and the longer Spanish Search helper, asserting
  zero list/Save intersection, pointer-operable Save, bounded list scrollability, no root overflow,
  and associated/readable Spanish guidance.
- Safari: run the three repaired interactions against the same disposable loopback runtime as a
  supplemental manual pass. Keep Chromium Playwright as the durable automated layout gate.
- Repository gates: `make check`, `git diff --check`, `git diff --check origin/main...HEAD`,
  `pnpm audit --prod`, and this exact credential scan:
  `git grep -nE '(sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|gh[opsu]_[A-Za-z0-9]{30,})' -- ':!*.md' ':!.github/workflows/security-hygiene.yml'`
- Graph gate: `graphify update .`, then a scoped query covering Visa nationality suggestions,
  invalid focus, and Workspace Search guidance.
- Evidence boundary: native packaged Tauri, physical touch, and manual screen-reader listening
  remain unverified; semantic, Chromium, and supplemental Safari assertions do not imply those
  surfaces passed.

Not expanded by this plan: contract methods, migrations, provider behavior, visa authority claims,
booking, version bumps, tags, release artifacts, manual or product-backend deployment, or unrelated
audit findings.
