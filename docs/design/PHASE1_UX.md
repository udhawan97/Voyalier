# Phase 1 UX — execution plan & handoff

The Phase 1 experience slice: the real product shell that replaces the foundation
landing page. It consumes the **frozen contract** (`packages/contracts/src/index.ts`)
through three interchangeable transports, and delivers the full trip loop —
create → import → review → confirm → Blueprint → undo — as an accessible,
theme-aware, dependency-free React app.

- **Owns / edits:** `apps/web/**` (except `package.json`), `packages/ui/**`, `docs/design/**`.
- **Reads only:** contracts, mock, brand, ADRs, product brief.
- **Zero new dependencies.** No router, no user-event, no animation lib, no `@tauri-apps/api`.
- **Contract is source of truth.** Never edited; verified frozen against the Phase 0 commit.

---

## Information architecture

One window, no URL router. A hand-rolled view state drives which surface renders;
overlays (dialogs) layer on top of the active view.

```
Topbar (Wayline mark · wordmark · offline status · theme toggle)  ── persistent
│
├── View: Trip list  (home)
│     • TripSummary cards — title, route, dates, status, confirmed/pending counts
│     • Empty state (teaches the product in one sentence)
│     • "Create a trip" entry
│
└── View: Blueprint  (trip detail)
      • Confirmed facts grouped by type (flights, lodging), itinerary order
      • Method chip + correctedFields history + unconfirm per fact
      • Pending-candidates entry point (count) → Review
      • "Add a fact" entry (flight_segment | lodging_stay)
      • "Import" entry
      • Archive / delete

Overlays (focus-managed dialogs):
  CreateTripDialog · ImportDialog · CandidateReviewDialog ·
  AddFactDialog · DeleteTripDialog
```

`CandidateReviewDialog` is the heart: a focus-trapped dialog, Esc closes, focus
returns to the trigger. It shows each candidate's fields beside their `FieldSpan`
excerpts as **quoted evidence** ("why it parsed this way"), warnings as human
sentences (with their codes for redundancy), and confirm / edit-then-confirm /
reject actions. Untrusted excerpts render as inert quoted text — never interpreted.

---

## Transport layer (`apps/web/src/gateway/`)

All three implement the `AppGateway` interface and normalize failures to
`AppError { code: "transport/failure" }`.

| Gateway | Selection | Notes |
| --- | --- | --- |
| Mock | `VITE_MOCK === "1"`, and all component tests | `createMockGateway()` from contracts |
| Tauri | `"__TAURI__" in window` | `window.__TAURI__.core.invoke(cmd, { input })`, snake_case commands |
| HTTP | otherwise (browser dev) | same-origin `/api/v1` + `/api/health`; Vite proxies `/api → 127.0.0.1:8787` |

HTTP routes match Codex's Axum server exactly (verified against
`crates/voyalier-server/src/lib.rs`): non-2xx bodies are `AppError`; 204s (delete,
unconfirm) carry no body; `importDocument` / `addManualFact` / `confirmCandidate`
send the id in both the path and the body (the server asserts they match).
`createHttpGateway({ baseUrl })` is same-origin by default; the live test points it
at `http://127.0.0.1:8787`.

The old hardcoded `http://127.0.0.1:8787/api/health` fetch in `App.tsx` is removed;
health now flows through the selected gateway.

---

## Component inventory

**Primitives (`components/`)** — `Button`, `Dialog` (focus trap + Esc + focus return),
`Field` (label + control + inline error + hint), `Chip`, `StatusBadge`, `Count`,
`Skeleton`, `Banner`, `EvidenceQuote`, `Empty`.

**Shell** — `Topbar`, `ThemeToggle`, `OfflineBanner`, `LiveRegion` (aria-live).

**Views** — `TripListView`, `TripDetailView` (Blueprint), and the five dialogs above.

**App plumbing (`app/`)** — `GatewayContext`, `theme.ts` (choice + localStorage +
`data-theme`), `useAsync` (idle/loading/success/error), `format.ts` (verbatim
date/time, route, warnings→sentences, method labels, field labels).

---

## State map

- `App` owns: `gateway` (injected/selected), `theme`, `view`
  (`{list}` | `{trip, tripId}`), a `health` probe, and a monotonic `reloadKey`.
- Views own their own data via `useAsync` keyed on `reloadKey`; every mutation
  calls `reload()` which refetches (`getTrip` + `listCandidates` for Blueprint,
  `listTrips` for the list). No global store — the contract is small enough that
  refetch-after-mutation is correct and simplest.
- Dialogs are controlled by local `useState` in their parent view; open captures
  the trigger element, close restores focus to it.

### Flight datetimes — do not touch timezones
Contract datetimes are local wall-clock strings without offset (`2026-11-03T11:20`).
`format.ts` splits the string and formats via a static month table — **never** a
`Date` object — so they render verbatim beside their airport codes.

---

## States (everywhere)

- **Loading** — skeletons (never spinner-only).
- **Empty** — teaches the surface in one sentence.
- **Validation** — inline on the offending field, mirroring contract rules
  (trimmed non-empty ≤120; `startDate ≤ endDate`); server `validation/*` errors
  map back onto fields.
- **Failure** — every `AppError` code renders a designed state (see table below),
  not a toast. `document/duplicate` links to the existing document;
  `document/empty` and `document/too_large` are inline surface states.
- **Offline** — `health` / transport failure → calm "Local core unreachable"
  banner with retry; never fakes success.
- Async results announced via `aria-live`.

| Code | Where it surfaces |
| --- | --- |
| `validation/invalid_input` | Create/Add field inline |
| `validation/invalid_date_range` | Create/Add date fields inline |
| `trip/not_found` | Blueprint load → "This trip is no longer here" + back |
| `candidate/not_found` | Review item → removed/refresh |
| `candidate/already_resolved` | Review action → "Already resolved" + refresh |
| `fact/not_found` | Unconfirm → refresh |
| `document/too_large` | Import surface inline |
| `document/duplicate` | Import surface → link to existing |
| `document/empty` | Import surface inline |
| `storage/failure` | Banner + retry |
| `transport/failure` | Offline banner + retry |
| `internal/unexpected` | Banner + retry |

---

## Theming

`tokens.css` keeps its `:root` light defaults and the existing
`@media (prefers-color-scheme: dark)` (system behavior preserved), and **adds**
`:root[data-theme="light"]` / `:root[data-theme="dark"]` override blocks (higher
specificity, so an explicit choice wins over the media query). `theme.ts` persists
the choice in `localStorage` and sets/removes `data-theme` on `<html>`; "system"
removes the attribute and lets the media query drive.

---

## Motion

CSS transforms/opacity only, 150–250ms, full `prefers-reduced-motion` equivalents.
No status is communicated by motion alone (always text + icon + color).

---

## Accessibility (acceptance)

Whole loop keyboard-only; visible focus throughout; WCAG 2.2 AA contrast both
themes; 44px targets; 200% zoom; labels/roles on every control; status carries
text + icon redundancy, never color alone.

---

## Tests (vitest + Testing Library, `fireEvent` only, MockGateway)

- Full-loop integration (create → open Blueprint → import → review → confirm →
  counts update → unconfirm → counts revert).
- Every `AppError` code → rendered-state test.
- Keyboard navigation of the review flow (Tab trap, Esc, focus return).
- Injection-fixture inertness (untrusted excerpt renders as inert quoted text).
- Theme + reduced-motion assertions.
- Gateway error-normalization (all three transports → identical
  `transport/failure` shape).
- Performance: 50-candidate review list renders < 100ms.
- `gateway.live.test.ts` — same assertions against real HTTP, skipped unless
  `VITE_LIVE_API=1` (run at integration after Codex's core merges).

---

## CHANGELOG-ready entries (for Codex to fold at integration)

- **Added** — Web product shell replacing the foundation landing page: trip list,
  create-trip, Blueprint (trip detail), document import, and candidate review.
- **Added** — Runtime transport selection (Mock / HTTP / Tauri) behind the frozen
  `AppGateway`, with uniform `AppError` normalization.
- **Added** — Evidence-first candidate review: field spans as quoted evidence,
  warnings as human sentences, edit-then-confirm with `correctedFields` tracking,
  and inert rendering of untrusted excerpts.
- **Added** — Light/dark/system theme toggle persisted in `localStorage`, extending
  the token layer with `data-theme` overrides.
- **Changed** — `App.tsx` health check now flows through the gateway; the hardcoded
  loopback health fetch was removed.

---

## Progress log

- **Plan committed** — this document (opening commit).
- Repo verified: contract frozen since Phase 0 (`git diff --exit-code`), baseline
  `pnpm check` green on merged main. Codex's Rust core, `src-tauri`, and CI are out
  of this branch's ownership and untouched.
</content>
</invoke>
