# Voyalier app audit & polish plan — 2026-07-12

**Status:** plan only — nothing here is implemented. Produced by a full audit
(four parallel deep passes: user flows, design system, bug hunt, docs drift,
each claim then re-verified against the code at the cited line).
**Intended use:** hand each lane below to an implementation model as its own
branch/PR. Lanes are ordered; each is independently mergeable and ends with the
repo gates green.

Baseline at audit time (commit `2a57fe3`, workspace `0.3.0`):

- `pnpm lint && pnpm typecheck && pnpm test` — green (35 files passed, 1 skipped; 152 tests passed, 5 skipped).
- `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` (core/app/server) — green (119 + 11 tests).
- No TODO/FIXME/HACK anywhere in `apps/`, `crates/`, `packages/`.

---

## 0. Read this first — invariants the executor must not break

These are load-bearing product/security properties, verified present today:

1. **No network before an explicit click.** Advice, weather, packs, map tiles,
   AI runs are all consent-gated. Any new feature follows the same rule.
2. **Redaction by construction.** Traveler names and confirmation codes never
   enter the brief output model. New surfaces (notes, documents, export) must
   state what they include/exclude.
3. **Accessibility floor** (all verified in code, keep green): global
   `:focus-visible` ring; `prefers-reduced-motion` global kill-switch
   ([styles.css:3424](../../apps/web/src/styles.css)); dialog focus trap +
   Esc + focus restore ([Dialog.tsx:57-105](../../apps/web/src/components/Dialog.tsx));
   ARIA radiogroups with roving tabindex (ThemeToggle, ChoiceGroup); full APG
   combobox; 38 live-region announcements; status always spelled in words,
   never color/icon alone; `a11y.test.tsx` (axe) must stay green.
4. **Typed i18n.** All copy flows through `t()`/`plural()` with a typed
   `MessageKey` ([i18n.ts](../../apps/web/src/app/i18n.ts)). Change **values**,
   not keys, unless you update every use site; new UI text must be added to the
   catalog, never inlined.
5. **Contract parity is exact.** `AppGateway` (46 methods) ==
   `http.ts` == `tauri.ts` == 46 Axum routes == 46 Tauri handlers == mock.
   Any contract addition updates all six places + fixtures
   (checklist in Lane 6).
6. **`voyalier-core` stays framework-free**; product behavior lives in Rust,
   not the React layer (see [AGENTS.md](../../AGENTS.md)).
7. **English catalog is the source of truth** for future locales; copy changes
   in Lane 1 are deliberate breaks from the "byte-identical migration" era and
   should land as one reviewed batch.

**Verified non-issues — do NOT "fix" these:**

- `gemma4:12b-it-qat` ([models.ts:26](../../apps/web/src/app/models.ts)) **is a
  real Ollama tag** (verified against ollama.com/library/gemma4/tags on
  2026-07-12; the overview page truncates, the tags page lists it).
- `advice.stale` "{days} days ago" / `weather.stale` "{hours} hours ago" can
  never render a singular ("1 days") — thresholds are `> 7` days / `> 12`
  hours. Optionally harden via `plural()` in Lane 1, but it is not a live bug.
- ~35 CSS classes that a static grep calls "unused" (`voy-btn--primary`,
  `voy-readiness__overall--clear`, `voy-today__phase--active`, …) are composed
  dynamically via template literals. Only `.voy-search__error`
  ([styles.css:2720](../../apps/web/src/styles.css)) is genuinely dead.
- Rust: the single production `.expect()`
  ([provider.rs:101](../../crates/voyalier-core/src/provider.rs)) is
  unreachable by construction; email parser recursion is depth-capped with a
  regression test; all multi-step SQLite writes are transactional under one
  connection lock with no lock held across network I/O.

---

## 1. Lane plan at a glance

| Lane | Theme                                                                      | Size | Depends on                  |
| ---- | -------------------------------------------------------------------------- | ---- | --------------------------- |
| 0    | Correctness & robustness fixes                                             | S    | —                           |
| 1    | Copy pass (reading ease, tone, consistency)                                | S–M  | —                           |
| 2    | IA restructure: a real Settings surface                                    | M    | best after 1                |
| 3    | Typography & theme foundation (fonts actually load)                        | M    | —                           |
| 4    | Motion & texture (subtle, token-driven)                                    | M    | 3 helps                     |
| 5    | Icons & unified section headers                                            | S–M  | 3, 4 help                   |
| 6    | Missing flows (documents, file import, confirms, notes, .ics, sample trip) | M–L  | 2                           |
| 7    | Performance (deferred sections, measured budgets)                          | S–M  | 2                           |
| 8    | README / website / docs overhaul                                           | M    | last — documents the result |

Suggested merge order: **0 → 1 → 2 → 3 → 4 → 5 → 6b/6c → 6a/6d/6e/6f → 7 → 8.**
Each lane: own branch, own PR, gates green (`pnpm check` + the three cargo
gates), then merge to `main`.

---

## Lane 0 — Correctness & robustness fixes (S)

The only genuine bugs found. Each item: what, where, fix, proof.

**0.1 — Stale search results resurrect a cleared query (MEDIUM).**
[TripSearch.tsx:53-59](../../apps/web/src/views/TripSearch.tsx) — the
short-query early return resets results but does **not** bump
`requestRef.current`, so an in-flight older request is not superseded and its
`.then` repopulates results + fires a screen-reader announcement for a query
the user already cleared (reachable inside the 200 ms debounce).
_Fix:_ bump `requestRef.current += 1` at the top of `runSearch` (or inside the
early return) so any in-flight request is invalidated either way.
_Proof:_ add a test in `tripSearch.test.tsx` with a delayed mock: type
`hotel`, clear to `h` before resolution, assert results stay empty and no
announcement fires.

**0.2 — Delete-trip confirmation breaks under localization.**
[DeleteTripDialog.tsx:26](../../apps/web/src/views/DeleteTripDialog.tsx)
compares against the literal `"delete"` while the label/placeholder localize
(`deleteTrip.confirmLabel/.placeholder`). In any future locale the UI asks for
one word and accepts another.
_Fix:_ derive the required word from the catalog —
`const word = t("deleteTrip.placeholder")` and compare
case-insensitively against it. English behavior unchanged.
_Proof:_ unit test asserting the accepted word tracks the catalog value.

**0.3 — Raw debug tokens rendered to travelers.**
(a) [CandidateReviewDialog.tsx:122](../../apps/web/src/views/CandidateReviewDialog.tsx)
renders `<code>{code}</code>` (e.g. `ambiguous_date_format`) beside the human
sentence — the code even admits it's "a debug token, not user copy".
(b) [ImportDialog.tsx:152-159](../../apps/web/src/views/ImportDialog.tsx) +
`import.duplicate.docSuffix` surface an internal document id.
_Fix:_ drop both from the visible UI (keep the human sentence; if useful, move
the code to a `title` attribute). Update any test that asserts them.
_Note:_ (b) becomes genuinely useful again once documents are listable
(Lane 6a) — if 6a ships, link the duplicate notice to the document instead.

**0.4 — Map failures are invisible.**
[MapPanel.tsx:68-71 and 86-90](../../apps/web/src/views/MapPanel.tsx) swallow
both library-load failure and missing-WebGL, leaving a silent empty frame.
_Fix:_ set an `error` state in both catches; render a quiet inline line in the
frame ("The map couldn't start here. Everything else still works.") + a Retry
for the load case. New catalog keys `map.error.load`, `map.error.webgl`,
`action.retry` (exists).
Also: the marker color is hardcoded `#c34e33`
([MapPanel.tsx:117](../../apps/web/src/views/MapPanel.tsx)) — read the
resolved `--voy-vermilion` via `getComputedStyle(document.documentElement)`
at map init so it follows the theme.

**0.5 — Today panel vanishes on error.**
[TodayPanel.tsx:40-43](../../apps/web/src/views/TodayPanel.tsx) returns `null`
on error, silently removing a headline feature.
_Fix:_ keep returning `null` when the trip legitimately has no data, but on
`status === "error"` render one muted line with a retry
(`today.error` = "Today couldn't load. Retry"). Small, no layout shift.

**0.6 — Dark-mode toast shadow uses light-theme ink.**
[styles.css:1454](../../apps/web/src/styles.css) —
`box-shadow: … color-mix(in srgb, #1a1917 12%, transparent)`.
_Fix:_ `color-mix(in srgb, var(--voy-ink) 12%, transparent)` (or reuse
`--voy-shadow`).

**0.7 — `theme-color` meta is wrong and single-theme.**
[apps/web/index.html:10](../../apps/web/index.html) says `#f6f3ec`; the actual
paper is `#f3efe4`, and there's no dark variant.
_Fix:_ two metas with `media="(prefers-color-scheme: light|dark)"` using
`#f3efe4` / `#171614`.

**0.8 — Dead selector.** Remove `.voy-search__error`
([styles.css:2720-2724](../../apps/web/src/styles.css)).

**0.9 — False "Copied" confirmation without a clipboard.**
[TripSearch.tsx:94-103](../../apps/web/src/views/TripSearch.tsx),
[OnDeviceAi.tsx:47-54](../../apps/web/src/views/OnDeviceAi.tsx) —
`await navigator.clipboard?.writeText(…)` resolves when `clipboard` is
undefined, so the success branch runs with nothing copied.
_Fix:_ feature-detect once; hide Copy buttons when unavailable (or guard and
show nothing on absence). Tauri/localhost are secure contexts, so this is
belt-and-braces — keep it tiny.

**0.10 — Prompt length cap not mirrored client-side.**
Real backend enforces 6000 chars (`MAX_AI_PROMPT_LEN`,
[voyalier-app/src/lib.rs:1612](../../crates/voyalier-app/src/lib.rs)); the mock
and the editor don't. _Fix:_ `maxLength={6000}` + live count on the
AiPromptSettings textarea; mirror the cap in
[mock.ts:1941-1962](../../packages/contracts/src/mock.ts).

**0.11 — Server niceties (loopback dev server only).**
(a) Host/Origin rejections map to HTTP 500 via `TransportFailure`
([voyalier-server/src/lib.rs:561-568, 641](../../crates/voyalier-server/src/lib.rs));
return 403 with a dedicated code.
(b) Blocking `ureq` calls (model pull can hold a tokio worker up to 30 min)
run directly in async handlers; wrap the long-running service calls
(`pull_local_model`, `run_assist`, `download_pack`, fetches) in
`tokio::task::spawn_blocking`. Desktop IPC is unaffected either way.

**0.12 — Minor races.**
(a) [usePlaceSuggestions.ts:17-40](../../apps/web/src/app/usePlaceSuggestions.ts)
can double-fetch its source before the cache fills — add an in-flight promise
guard.
(b) [CreateTripDialog.tsx:151-171](../../apps/web/src/views/CreateTripDialog.tsx)
shows the date-order error only under End date while Start date is only
`aria-invalid` — render the inline message under both fields.

**Acceptance for Lane 0:** all gates green; new regression tests for 0.1, 0.2,
0.3; a manual dark-mode pass over toast + map marker.

---

## Lane 1 — Copy pass: easier reading, one voice (S–M)

The catalog ([i18n.ts](../../apps/web/src/app/i18n.ts), ~230 entries) is
already strong. This is a surgical edit of ~30 entries, not a rewrite.
Rules first, then the exact edit list. Change **values only** — keys stay.

**Voice rules (apply everywhere, including new copy in later lanes):**

- One idea per sentence. If a string has two `—` dashes or nested
  parentheses, split it.
- Product speaks plain traveler language; architecture words stay internal
  (no "core", "transport", "grounded", "milestone", "forecast horizon").
- Verb policy: **Fetch** = a consented network request ("Fetch weather
  outlook"); **Get/Show** = local computation; **Download** = pulling a file
  in. (Today's usage already mostly follows this — keep it deliberate.)
- Reassurance lines keep the pattern "…— nothing was changed." /
  "Nothing about your trip leaves this device." — they're the brand.
- Typographic quotes/apostrophes everywhere (', “ ”) — today it's mixed
  (e.g. `assist.note` curly vs `vault.intro` straight). Normalize; en-US
  spelling except proper nouns ("Open Government Licence" stays).

**Exact edits (key → new value or direction):**

| Key(s)                                                              | Problem                                                     | Proposed value                                                                                                                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.checking/online/offline`, `error.transport.title/.body`     | "Local core" is architecture-speak in the most visible pill | "Starting up…" / "Ready" / "Offline"; error title "Voyalier can't reach its engine on this device. Your data is safe."                                                                                              |
| `readiness.scope`                                                   | "…arrives in a later milestone" is roadmap-speak            | "Plan completeness plus official starting points. Voyalier never asserts or clears entry, health, or safety rules — always confirm with the official source."                                                       |
| `readiness.label.monitor`                                           | "Worth a look" clashes with "Critical" register             | "Check soon"                                                                                                                                                                                                        |
| `assist.grounded` / `assist.noGrounding`                            | ML jargon                                                   | "Based on: {sources}" / "No confirmed plans to draw on yet"                                                                                                                                                         |
| `weather.coverage.none/.partial`                                    | "forecast horizon"                                          | "Forecasts only reach ~16 days out, so your trip isn't covered yet. Fetch again closer to departure." / partial: same style                                                                                         |
| `vault.error.generic`                                               | Dead-end "That didn't work."                                | "That didn't work. Check the passphrase and try again — nothing was changed."                                                                                                                                       |
| `providers.error`, `prompts.error`                                  | Duplicated vague string                                     | Keep one shared key or make each name the thing that failed ("Couldn't save the key — nothing changed.")                                                                                                            |
| `localai.scope`                                                     | Run-on with nested quoted UI names                          | Split: "Detection runs only on this device." + second sentence naming the two features plainly.                                                                                                                     |
| `packs.intro`                                                       | 3 dense sentences, provenance jargon                        | Lead with the benefit: "Download a city's places and travel notes to use offline." Keep GitHub + license facts as sentence 2–3, shorter.                                                                            |
| `assist.scope`, `prompts.intro`, `draft.intro`, `assist.disclaimer` | 3+ clauses each                                             | Split into 2 short sentences each; keep every factual guarantee.                                                                                                                                                    |
| `updates.unsupported.source`                                        | Bare `git pull` / `make bootstrap`                          | Keep the commands (right audience) but frame them: "Running from source? Update from the repository: `git pull`, then `make bootstrap`."                                                                            |
| `detail.unconfirm`                                                  | "Unconfirm" is invented                                     | "Back to review" (announce string `detail.announce.unconfirmed` already says exactly this — align the button)                                                                                                       |
| `addFact.title`/`.description`                                      | "fact" is domain-speak                                      | Title "Add a flight or stay"; description keeps "Manual entries are yours and appear in the Blueprint right away." (`detail.addFact` button → "Add flight or stay")                                                 |
| `detail.blueprint`                                                  | Coined term with no gloss                                   | Keep the brand term, add one-line sub under the H2: new key `detail.blueprint.sub` = "Your confirmed flights and stays, in order."                                                                                  |
| `import.duplicate.docSuffix`                                        | Internal id exposed                                         | Removed in Lane 0.3 (key deleted or repurposed when 6a lands)                                                                                                                                                       |
| Five AI section titles                                              | Overlapping names, "on-device AI" used twice                | See Lane 2 — naming moves with the IA change: Settings gets "On-device AI (Ollama)", "Cloud AI keys", "AI instructions"; trip page gets "Ask about this trip" (assist) and "Fill gaps from your documents" (draft). |
| `deleteTrip.description`                                            | Fine — verify it still matches after 0.2                    | —                                                                                                                                                                                                                   |
| Stale-string hardening                                              | optional                                                    | move `advice.stale`/`weather.stale` to `plural()` bases                                                                                                                                                             |

**Also:** sweep the whole catalog for the quote/dash normalization (mechanical,
one commit, no wording changes mixed in — keeps review easy).

**Acceptance:** `pnpm test` green after updating string assertions;
`i18n.test.ts` still passes; a read-aloud pass of every changed string; no key
renames leaked into components.

---

## Lane 2 — IA restructure: a real Settings surface (M)

**Today:** there is no settings screen. Global panels are scattered —
Updates + Encryption sit at the bottom of the **home** list
([TripListView.tsx:261-263](../../apps/web/src/views/TripListView.tsx));
On-device AI, Cloud keys, and AI instructions render inside **every trip**
([TripDetailView.tsx:591-595](../../apps/web/src/views/TripDetailView.tsx)).
Consequences (all verified): with zero trips you cannot configure AI at all;
the trip page is a ~16-section scroll wall; global panels re-mount and
re-fetch per trip; trip open fires ~8–10 gateway calls.

**Target:**

1. New view: `View = { name:"list" } | { name:"trip"; tripId } | { name:"settings" }`
   in [App.tsx:16](../../apps/web/src/App.tsx). Topbar gains a gear button
   (icon from Lane 5) → Settings; back returns to the previous view.
2. **Settings** (new `views/SettingsView.tsx`) hosts, in order:
   Appearance (theme radiogroup moves here; the topbar toggle can stay too or
   become a shortcut — recommend keep topbar), On-device AI (`OnDeviceAi`),
   Cloud AI keys (`AiProviders`), AI instructions (`AiPromptSettings`),
   Updates (`UpdatesPanel`), Encryption (`VaultPanel`).
   Anchored subsections with the Lane 5 SectionHeader.
3. **Trip page keeps** trip-scoped surfaces only: Today, pending review,
   Blueprint, Readiness, Schedule, Advice, Weather, Search, "Ask about this
   trip" (AssistPreview), "Fill gaps" (AssistDraft), Packs, Recommendations,
   Map. Where an AI action needs setup, show one line + link:
   "Set up AI in Settings." (new key, e.g. `assist.needsSetup`).
4. **Home** drops UpdatesPanel/VaultPanel (now in Settings).
5. `UpdatePill` currently scrolls the panel into view — it must now switch to
   Settings first, then scroll ([UpdatePill.tsx:19-27](../../apps/web/src/components/UpdatePill.tsx)).
   The locked-vault screen keeps rendering `UpdatesPanel` directly
   ([App.tsx:98-104](../../apps/web/src/App.tsx)) — preserve that
   (update-while-locked is a designed property, "D2" comment).
6. Add an in-page section nav on the trip view (sticky row of anchor chips:
   Plan · Prepare · Discover · AI) — pure CSS + `scroll-margin-top`; no
   router needed.

**Explicit non-goal:** URL routing / deep links. It would change
refresh/back behavior and is listed under deferred flows (Lane 6 tail).

**Test impact (expected, not collateral):** tests that mount global panels via
the trip view (`aiProviders`, `onDeviceAi`, `aiPromptSettings`,
`updatesPanel`, `vault`, parts of `flowFixes`, `fullLoop`) must switch to
rendering Settings. Update the shared helper in `test/helpers.tsx` to expose a
`renderSettings()` path.

**Acceptance:** with zero trips, AI can be fully configured from Settings;
trip open fires ≤5 gateway calls before any interaction (measure in
`performance.test.tsx`); axe green on all three views; all flows from the
walkthrough checklist (Lane 9) pass.

---

## Lane 3 — Typography & theme foundation (M)

**3.1 — Actually load the brand fonts (the biggest visual win).**
Tokens name "Zen Kaku Gothic New" (UI) and "Shippori Mincho" (display), but
**no `@font-face`, link, or bundled font exists anywhere** — nearly every user
gets Inter/system + Georgia-ish fallbacks. The docs site _does_ use them — via
Google Fonts ([index.astro:24-26](../../docs-site/src/pages/index.astro)),
which contradicts the product's no-third-party-requests ethos.

- Self-host WOFF2 subsets (latin + latin-ext) in `packages/ui/fonts/`:
  Zen Kaku Gothic New 400/500/700, Shippori Mincho 500/600. Both are SIL OFL —
  add license texts to `THIRD_PARTY_NOTICES.md`.
- `@font-face` blocks in `packages/ui/src/tokens.css` with
  `font-display: swap`; Vite serves them from the package (verify the
  `?url`/asset pipeline works from a workspace package — else place in
  `apps/web/public/fonts/` and `docs-site/public/fonts/`, same files).
- Docs site: drop the three Google Fonts lines, reference the same files.
  (Keeps the landing page identical, removes the only third-party request.)
- Desktop bundle size: ~4 subset files ≈ 300–600 KB total — acceptable; check
  the DMG delta.

**3.2 — Quantize font-weights.** styles.css uses 480/560/580/600/620/640/680
(17× `640` alone) — variable-font values that snap unpredictably on the static
weights we'll actually load. Add weight tokens
(`--voy-w-regular:400; --voy-w-medium:500; --voy-w-strong:700`) and replace
every numeric `font-weight` in [styles.css](../../apps/web/src/styles.css)
(mapping: ≤520→400 or 500 by role, 560–640→500 for text / 700 for true
emphasis like counts and CTAs, 680→700). Mechanical, one commit.

**3.3 — Type + z-index tokens (light-touch).** 26 ad-hoc font sizes exist;
don't chase all of them. Add a 7-step scale
(`--voy-text-xs .72rem / -sm .8rem / -base .92rem / -md 1rem / -lg 1.15rem /
-xl 1.4rem / -2xl clamp(2rem,5vw,2.8rem)`) and migrate only the four
most-repeated steps (0.8 ×21, 0.88 ×20, 0.92 ×20, 1.4 ×15). Add
`--voy-z-skip:100; --voy-z-toast:60; --voy-z-overlay:50; --voy-z-popover:40`
and replace the four raw z-indexes. Skip a spacing-scale migration (churn ≫
value) — add the scale tokens for **new** code only.

**3.4 — Contrast fix.** `--voy-silver` (#a9a69c) on paper is used for small
scope/licence/meta text — the weakest contrast in the app
(≈2.4:1, fails WCAG AA for text). Switch these five selectors to
`--voy-ink-muted` (keeps the quiet tone, passes):
`.voy-readiness__scope` (:997), `.voy-advice__licence` (:1094),
`.voy-providers__scope` (:1411), `.voy-recs__prov` (:2459),
`.voy-packs__scope` (:2114). Keep silver for decorative rules/borders only.

**3.5 — Housekeeping.** Tokenize the two hardcoded durations
(skeleton `1.4s` → `--voy-motion-shimmer:1.4s`; progress bar `0.2s ease` →
`var(--voy-motion) var(--voy-ease)`); fix `.voy-btn--danger`/`.voy-count`
`#fff` → a `--voy-on-accent` token; document (don't restructure) the
intentional light/dark duplication in tokens.css with a "keep blocks in sync"
comment.

**Acceptance:** fonts visibly render (screenshot light+dark), Lighthouse/axe
contrast checks pass on the five fixed selectors, no `font-weight: 6xx`
left in styles.css, docs-site has zero third-party requests (network tab).

---

## Lane 4 — Motion & texture (M)

Motion today: 3 keyframes, 9 transitions in 3,432 lines — the tokens
(`--voy-motion*`, `--voy-ease`) exist but are barely used. Everything below
uses those tokens, CSS-only where possible, and inherits the existing global
reduced-motion kill-switch (verify each addition is covered by it — no
JS-driven rAF animation).

Design rule to keep: **motion implies affordance** — animate interactive
elements and state changes; don't add hover-lift to non-clickable cards.

1. **Dialog exit.** Enter animates (`voy-rise`), close unmounts instantly
   ([Dialog.tsx:111](../../apps/web/src/components/Dialog.tsx)). Add a closing
   state: on close, set `data-state="closing"`, play 150 ms fade+scale-down,
   unmount on `animationend` (with a `setTimeout` fallback ~200 ms). Focus
   restore must still run on the synchronous close path. Under reduced motion
   the kill-switch collapses it to ~0 ms — verify no double-unmount.
2. **Toast + UpdatePill enter/exit** — slide-up + fade for `.voy-toast`
   (:1441), fade/scale for the pill's appearance.
3. **Disclosures** (`<details>` in providers help, localai "more") — use
   `interpolate-size: allow-keywords` + `transition: height` as progressive
   enhancement (Chromium-only today; WKWebView ignores it gracefully). No JS.
4. **List entrances** — one-time rise+fade on mount for trip cards, search
   results, and review cards: `animation: voy-rise` with
   `animation-delay: calc(var(--i) * 30ms)` capped at ~6 items (set `--i`
   inline per item index). Must not replay on `reload()` — key the animation
   to first data arrival (e.g. class applied only when the previous state was
   loading/empty).
5. **Skeleton → content crossfade** — when `useAsyncData` flips
   loading→loaded, add a `is-entering` class to the section content applying
   `voy-fade`. Cheap and app-wide via the shared section wrapper (Lane 5).
6. **Micro-states** — transitions for: health dot background
   (:167-175), badge/chip/status-pill background+color (`.voy-badge`,
   `.voy-chip`, `.voy-readiness__overall`, `.voy-today__phase`), input
   border+focus ring (exists for border only).
7. **Texture (subtle, zero-request).** Two layers on `body`:
   the existing moss radial (keep) + a **paper grain**: inline
   `data:image/svg+xml` feTurbulence noise on `body::before`
   (`position:fixed; inset:0; pointer-events:none; opacity:.02–.03;
mix-blend-mode:multiply` — and `luminosity`/lower opacity in dark). Hide in
   `@media print`. Budget: verify no scroll repaint (fixed layer,
   `will-change` not needed) — check with DevTools paint flashing before/after.
8. **Card depth polish.** Keep the flat bordered look; add `--voy-shadow-sm`
   at rest / `--voy-shadow` on hover **only** for interactive cards
   (trip cards already do this — extend to pending-review entry, suggestion
   chips).

**Acceptance:** reduced-motion run shows no movement (test exists — extend
`theme.test.tsx`/axe run with `matchMedia` mock if not covered); no dropped
frames scrolling a dense trip (manual check, paint flashing off); dialog
close still restores focus (existing tests must stay green).

---

## Lane 5 — Icons & unified section headers (S–M)

15 line icons exist with a strict style contract
([icons.tsx](../../apps/web/src/components/icons.tsx): 24 viewBox, 1.7 stroke,
round caps, `aria-hidden`, meaning always duplicated in text). 17 of ~24 views
render none, and section headers split into two treatments (icon+count vs
plain serif).

1. **New icons (same contract, ~13):** GlobeIcon (advice), CloudSunIcon
   (weather), SearchIcon (search), PackageIcon (city packs), CompassIcon
   (recommendations), MapIcon (map), SparklesIcon (assist), CpuIcon
   (on-device AI), KeyIcon (cloud keys), SlidersIcon (AI instructions),
   CalendarIcon (Today), ClipboardCheckIcon (readiness), GearIcon (settings
   entry), DownloadIcon (updates). Hand-draw in the same grid; no icon
   library dependency (AGENTS.md discipline).
2. **`SectionHeader` primitive** (new, in `components/`):
   `icon + serif title + optional count/badge + optional action slot +
optional intro line`. Replace the ~15 hand-rolled headers (the 15×
   `font-size:1.4rem` display-serif blocks) and the icon-bearing variants so
   every section reads the same. One CSS block replaces 15 near-duplicates.
3. **Status anchors:** give the readiness overall pill and today-phase pill a
   leading icon (Dot/Calendar) — text still carries meaning (invariant #3).

**Acceptance:** every trip/settings section shows the same header anatomy;
axe green (icons `aria-hidden`); visual diff light+dark.

---

## Lane 6 — Missing flows (each its own PR)

Verified absent against the full 46-method contract. Ordered by value ÷ effort.
**Contract-change checklist** for 6a/6d (from invariant #5): TS types + method
in `contracts/index.ts`, mock parity with fixtures, `http.ts` + Axum route +
handler, `tauri.ts` + command + `generate_handler!`, Rust service + SQLite
migration + tests, UI + tests, CHANGELOG entry.

**6b — Import from file (S). Do first — pure frontend.**
Import is paste-only ([ImportDialog.tsx:183-196](../../apps/web/src/views/ImportDialog.tsx));
a `.eml` must be opened elsewhere and hand-pasted. Add a file picker button +
drag-and-drop onto the dialog: `FileReader.readAsText` (local, no upload),
extension→kind mapping (`.eml`→email, `.html/.htm`→html, else text —
user-overridable), reuse the existing 1 M char guard and error states. Tests:
drop/pick fixtures for all three kinds.

**6c — Consistent guards for destructive actions (S).**
Today only Delete-trip confirms. Single-click, no-undo actions (all verified):
Dismiss candidate ([CandidateReviewDialog.tsx:206-213](../../apps/web/src/views/CandidateReviewDialog.tsx)),
Remove manual fact ([TripDetailView.tsx:129-133](../../apps/web/src/views/TripDetailView.tsx)),
Remove pack ([CityPacks.tsx:132-138](../../apps/web/src/views/CityPacks.tsx)),
Remove provider key ([AiProviders.tsx:114-129](../../apps/web/src/views/AiProviders.tsx)).
_Fix:_ lightweight two-step inline confirm (button flips to "Remove — sure?"
with auto-revert after ~4 s; `aria-live` announce), NOT a modal per action.
Keep Dismiss fast (it's a triage flow): two-step only there too, no dialog.

**6a — Imported-documents manager (L). The flagship gap.**
Users import confirmation emails (PII) but can never see or remove them —
no `listDocuments`/`getDocument`/`deleteDocument` exists; the only residue is
duplicate detection + search snippets. For a privacy-first product this is
the loudest missing flow.
_Spec:_ new trip section "Imported documents": list (label, kind, imported
date, size, candidates found), expandable content view, delete with confirm.
Content is sealed at rest — the read path must go through the vault unseal
(same path the parser used; expose via `get_document`).
**Decision points for the executor (recommendations):**

- Deleting a document with **pending** candidates → delete them too (they're
  unreviewed derivatives).
- Deleting a document whose candidates were **confirmed** → keep the facts
  (user-approved), mark their provenance "source removed" (new nullable state;
  show in FactCard). Do not cascade-delete confirmed facts.
- Search hits referencing a deleted document disappear naturally.
  _Tests:_ Rust service tests (cascade rules, sealed read), UI tests, mock parity.

**6d — Trip notes (M). Closes a positioning gap.**
The README hero literally sells a home for "half-made plans", but a trip has
no free-text anywhere. Add per-trip notes: `getTripNotes/setTripNotes`
(sealed at rest like other user text), autosaving textarea card on the trip
page (debounced save + "Saved" whisper), **excluded from the brief by
construction** (state it in the UI). Plain text v1 — no markdown rendering.

**6e — Calendar export, .ics (M).**
Local file generation from confirmed facts — no network, perfectly on-brand.
Flights → VEVENT with floating local times (no TZID guessing — Voyalier
doesn't invent timezones; say so in the UI line), stays → all-day
DTSTART/DTEND. Download via blob anchor (works in both shells; verify in
Tauri webview, else route through a save dialog). Put the button next to
"Share brief".

**6f — Sample trip (S–M). First-run empathy.**
Empty home screen → secondary action "Explore a sample trip": builds a demo
trip **through the normal public flow** (createTrip + importDocument with a
bundled fixture confirmation + leaves candidates pending) so the user
experiences import→review→confirm on fake data. Clearly named "Sample:
Kyoto long weekend", deletable normally. No contract changes.

**6g — Documented backup story (S, docs-only now).**
Full export/restore is deferred; for now add a "Back up your data" docs page

- troubleshooting section: where the SQLite DB and packs live per-OS, what
  the keychain holds (and that a passphrase vault means the backup is useless
  without the passphrase — honest per the product voice). Links from the
  Encryption settings section.

**Explicitly deferred (list in ROADMAP, don't start):** workspace
export/restore UI, additional fact types (trains/activities — core contract
surgery), multi-traveler, budgets, packing lists, global cross-trip search,
URL routing/deep links, share-beyond-print.

---

## Lane 7 — Performance (S–M)

The app is already frugal (maplibre lazy-loaded on consent, providers panel
lazy, search debounced). Two real wins, both measured:

1. **Deferred below-fold sections.** After Lane 2, the trip page still mounts
   Advice, Weather, Search, Assist, Draft, Packs, Recommendations, Map
   eagerly; several fetch on mount (packs suggestions, assist activity,
   prompts…). Add a tiny `<DeferredSection>` wrapper: renders a fixed-height
   placeholder until `IntersectionObserver` fires (`rootMargin: "300px"`),
   then mounts children. Jsdom/tests: no IO → render immediately (guard).
   Eager: Today, pending entry, Blueprint, Readiness, Schedule. Deferred: the
   rest. Preserve `scroll-margin-top` anchors for the section nav.
2. **Budget as a test.** Extend
   [performance.test.tsx](../../apps/web/src/performance.test.tsx): count
   gateway calls on trip open — assert **≤5 before any interaction** (today
   ~8–10) — and assert the trip view renders under a fixture with 50 facts
   without exploding (a render-time smoke, not a benchmark).
3. **Optional Rust hardening (from the audit):** `parser.rs` re-collects the
   whole document per field span (O(candidates × fields × len), bounded by
   the 1 MB cap — [parser.rs:522-527](../../crates/voyalier-core/src/parser.rs)).
   Precompute the char-index map once per document. Include only if touching
   the parser anyway; it is not user-visible today.
4. **Bundle check, no action expected:** `pnpm build` and record chunk sizes
   in the PR; maplibre must remain the only >200 KB async chunk.

**Acceptance:** the call-count test passes; scrolling a dense trip stays
smooth with texture enabled (Lane 4 check repeated after both lanes merge).

---

## Lane 8 — README, website, docs overhaul (M — last)

Docs are exactly **one feature-wave behind**: seven commits after the last
docs touch (`944102a`) shipped edit/unarchive, typeahead search + copy,
guided AI setup + in-app model pull, key validation, editable AI
instructions, lodging-date drafts, and the DMG — almost none are documented
or changelogged. Three self-assigned tasks from
[UPDATES.md §11](../architecture/UPDATES.md) were never done. Do this lane
**after** the product lanes so the docs describe the shipped result once.

**8.1 — CHANGELOG.** Add the seven missing entries under `[Unreleased]`
(one bullet each, follow the existing voice; include the flow-gap fix's
data-loss note — manual-fact Unconfirm used to delete). **Do not** cut a
dated `[0.3.0]` heading until the release is actually tagged/published —
v0.3.0 publication is still owner-gated. Add every Lane 0–7 change here as
lanes merge.

**8.2 — README.** Update the NOTE (line 42) feature list + capability table:
add in-trip search enhancements, edit + unarchive, guided AI setup, key
validation, editable instructions, lodging-date drafts; refresh the AI rows.
**Keep "source-only beta" until v0.3.0 assets are actually published** — it
is factually correct today; prepare the replacement text ("public beta —
download below") in the same PR behind an HTML comment, so flipping is a
one-line change at release time. Add the Download section then, not before.

**8.3 — docs-site: new pages + sidebar** ([astro.config.mjs:24-54](../../docs-site/astro.config.mjs)):

- `download-and-install.mdx` — install flow, Gatekeeper "Open Anyway" /
  SmartScreen steps (source them from
  [v0.3.0-release-notes-template.md:19-24](../release/v0.3.0-release-notes-template.md)),
  and **publish the updater pubkey fingerprint** (computable now from the
  pubkey in `tauri.conf.json` — this un-blocks
  [UPDATE_KEY_RUNBOOK.md:37/57/100](../security/UPDATE_KEY_RUNBOOK.md)).
  Mark the download links "available with v0.3.0" until published.
- `guides/updates.mdx` — the in-app updater as a user guide (consent, check,
  install per-OS, skip/un-skip, backups). Headline v0.3.0 feature with no
  page today.
- Search: add a section to `guides/trips-and-blueprint.mdx` (typeahead,
  suggestions, copy-to-reuse) — a full page is overkill.
  **8.4 — docs-site: stale pages.**
  `guides/ai-assist.mdx` (add wizard, in-app pull, Validate & save, editable
  instructions, "Fill gaps" drafts), `guides/trips-and-blueprint.mdx`
  (edit, unarchive, archive toggle), `getting-started.mdx` (in-app guided AI
  setup instead of bare `ollama pull`; download-first once released),
  `introduction.mdx` + `roadmap.mdx` (feature lists), and any copy the Lane 1/2
  renames touched (section titles!).
  **8.5 — Repo docs.** `SUPPORT.md` + `SECURITY.md`: replace "no public
  release / foundation-stage" with the accurate beta status + supported-version
  table stub; reconcile SECURITY.md's "authenticated session before public
  beta" line with reality (either implement the per-launch token or soften the
  claim — recommend an explicit "defense-in-depth, tracked in THREAT_MODEL"
  sentence; do not silently drop it). `PRODUCT_BRIEF.md`: named personas →
  shipped 5-weight model (per ADR-0003). `PHASE1_UX.md`: one-line note that
  "Wayline mark" was superseded. Keep ADRs as historical records.
  **8.6 — Landing page.** Content is accurate; two changes only: swap Google
  Fonts for the Lane 3 self-hosted files (removes the only third-party
  request), and add the new capabilities to the feature sections if they're
  enumerated there. Do not redesign — it's good.

**Acceptance:** every shipped feature appears in ≥1 of README/docs-site;
`pnpm build` (docs build) green; zero third-party requests on the site; no
doc promises a flow that doesn't exist (the reverse of today's problem).

---

## Lane 9 — Verification protocol (run for every lane)

```bash
pnpm check                    # lint + typecheck + web tests + builds
cargo fmt --all -- --check
cargo clippy --locked -p voyalier-core -p voyalier-app -p voyalier-server --all-targets -- -D warnings
cargo test  --locked -p voyalier-core -p voyalier-app -p voyalier-server
```

Manual walkthrough checklist (browser `make dev`, plus desktop spot-check for
Lane 2/4/6 changes): create → edit → import (paste + file) → review
(confirm/edit/dismiss) → Blueprint → back-to-review → readiness/schedule →
advice → weather → search (type fast, clear fast) → packs → recommendations →
map (and map with WebGL disabled) → Today → assist preview/run → fill-gaps →
settings (AI setup, keys, instructions, updates, encryption incl. lock/unlock)
→ brief print → archive/unarchive → delete. Light + dark + reduced-motion +
200 % zoom + keyboard-only for whatever the lane touched.

**Sizing guide:** S ≈ half a session, M ≈ a session, L (6a) ≈ two sessions
including the Rust surface. Lanes 0+1 make a good first session; 8 is the
closing session.
