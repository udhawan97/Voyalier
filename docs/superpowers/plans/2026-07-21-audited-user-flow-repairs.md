# Audited user-flow repairs (0.5.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the fifteen user-flow gaps reproduced in the 2026-07-21 browser audit of Voyalier 0.5.1, then ship 0.5.2.

**Architecture:** Every fix lands at the narrowest shared level that owns the behaviour: the section nav learns to mount-then-scroll instead of trusting a one-shot anchor jump; planning writes join the existing `useAsyncAction` transport-health contract instead of hand-rolling a third error shape; instant timestamps get one shared formatter separate from the zoneless wall-clock formatter; and the default trip title stops being the only place in the product that spells an arrow in ASCII. No contract shapes change, so no ADR is required — `WorkspaceSearchHit.label` changes its *content* (product noun → the traveler's own identifying data), not its type.

**Tech Stack:** React 19 + TypeScript (`apps/web`), Rust (`voyalier-core`, `voyalier-app`), Vitest + Testing Library, Playwright.

## Global Constraints

- Product contract: Voyalier never asserts or clears entry, health, safety, price, or availability rules. No fix may add such an assertion.
- Prose belongs in `apps/web/src/app/i18n.ts`, never in Rust. Both the `en` and `es` catalogs are exhaustive `Record<MessageKey, string>` — every new key must be added to both or the build fails.
- Rust tests are inline `#[cfg(test)] mod tests`; there is no `tests/` directory. Cross-cutting cases live in `crates/voyalier-core/src/tests.rs`.
- Web tests are flat in `apps/web/src/`, named by feature, and render through `src/test/helpers.tsx`.
- `IntersectionObserver` is stubbed in `src/test/setup.ts` to fire immediately, so `DeferredSection` mounts eagerly; a test that needs deferral must re-stub it.
- Parity goldens (`packages/contracts/parity/*.json`) pin exact case counts and are asserted from both languages. Do not regenerate them: no task here adds or removes a case.
- `packages/contracts/parity/routes.json` is hand-maintained. No task adds a gateway method, so it must not change.
- The gate is `make check` (= `scripts/check.sh`). Never inline a check into CI.
- Preserve reduced-motion, keyboard, screen-reader, contrast, and 200% zoom behaviour.
- Commits are `Scope: imperative summary` with scope a layer (`Core:`, `Web:`, `Docs:`, `Test:`), combinable (`Core+test:`). Close the branch with `Merge: <feature>`.
- Version is hand-synced across four files as one edit: root `package.json`, workspace `Cargo.toml`, `apps/web/package.json`, `apps/desktop/src-tauri/tauri.conf.json`.

---

### Task 1: Land the section nav where the chip points (gap 1, gap 10)

**Files:**
- Modify: `apps/web/src/components/DeferredSection.tsx`
- Modify: `apps/web/src/views/TripDetailView.tsx:206-237`
- Modify: `apps/web/src/styles.css` (`.voy-tripnav__chip`)
- Modify: `apps/web/src/app/i18n.ts` (no new keys; chips already have them)
- Test: `apps/web/src/flowFixes.test.tsx`

**Interfaces:**
- Produces: `MountAllContext` exported from `DeferredSection.tsx` as `{ mountAll: boolean }` via `DeferredMountProvider`; `useMountAllSections(): () => void`.

The audit proved the anchor jump is one-shot: the browser scrolls to the placeholder's position, then placeholders *above* the target mount at full height and push the target ~1,700px further down. Forcing every section to mount before scrolling makes the landing deterministic. The cost — all four groups mount — is paid only when the traveler explicitly navigates, which is exactly when they want those sections.

- [ ] **Step 1: Write the failing test** in `flowFixes.test.tsx`

```tsx
it("lands the section nav on its target even when sections defer", async () => {
  // Re-stub IntersectionObserver so nothing auto-mounts: this is the real
  // first-visit condition the audit reproduced.
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {
        observers.push(() => {});
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  renderApp(createMockGateway());
  await openKyoto();

  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    if (this.id) scrolled.push(this.id);
  };

  fireEvent.click(screen.getByRole("link", { name: "AI" }));
  // The AI section's content must exist (forced mount) and be the scroll target.
  expect(await screen.findByRole("heading", { name: "Preview an AI request" }))
    .toBeInTheDocument();
  expect(scrolled).toContain("section-ai");

  Element.prototype.scrollIntoView = original;
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @voyalier/web test -- flowFixes`
Expected: FAIL — the AI heading never mounts because the observer never fires.

- [ ] **Step 3: Give `DeferredSection` a force-mount escape hatch**

```tsx
import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from "react";

const MountAllContext = createContext(false);

/**
 * Lets one control (the section nav) say "mount everything now".
 *
 * Deferral is an idle-time optimisation; a traveler who clicks a jump chip has
 * announced they want that part of the page. Mounting on demand is what makes
 * the jump land: the sections *above* the target can no longer inflate after
 * the browser has already chosen where to stop.
 */
export function DeferredMountProvider({ children }: { children: ReactNode }) {
  const [mountAll, setMountAll] = useState(false);
  return (
    <MountAllContext.Provider value={mountAll}>
      <MountAllSetterContext.Provider value={setMountAll}>
        {children}
      </MountAllSetterContext.Provider>
    </MountAllContext.Provider>
  );
}
```

Add a setter context and `useMountAllSections()` returning `() => setMountAll(true)`. In `DeferredSection`, read `const mountAll = useContext(MountAllContext)` and initialise/force `shown` when it is true:

```tsx
const [shown, setShown] = useState(
  () => typeof IntersectionObserver === "undefined",
);
useEffect(() => {
  if (mountAll) setShown(true);
}, [mountAll]);
if (shown || mountAll) return <div id={id}>{children}</div>;
```

- [ ] **Step 4: Make the chips mount, then scroll, then update the hash**

Replace `TripSectionNav` in `TripDetailView.tsx`:

```tsx
function TripSectionNav() {
  const mountAllSections = useMountAllSections();
  const [current, setCurrent] = useState<string | null>(null);

  // Track which section owns the viewport, so a chip can answer "where am I?".
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setCurrent(visible.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const item of TRIP_NAV) {
      const node = document.getElementById(item.target);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  function jump(event: React.MouseEvent<HTMLAnchorElement>, target: string) {
    event.preventDefault();
    // Mount every deferred section first: a one-shot anchor jump lands wrong
    // when the sections above the target grow from placeholder to full height
    // *after* the browser has picked its stopping point.
    mountAllSections();
    setCurrent(target);
    // Two frames: one for React to commit the mounts, one for layout to settle.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById(target)?.scrollIntoView?.({ block: "start" });
        window.history.replaceState(window.history.state, "", `#${target}`);
      });
    });
  }

  return (
    <nav className="voy-tripnav" aria-label={t("tripnav.label")}>
      {TRIP_NAV.map((item) => (
        <a
          key={item.target}
          className="voy-tripnav__chip"
          href={`#${item.target}`}
          aria-current={current === item.target ? "true" : undefined}
          onClick={(event) => jump(event, item.target)}
        >
          {t(item.label)}
        </a>
      ))}
    </nav>
  );
}
```

Wrap the returned `<section className="voy-detail">` body in `<DeferredMountProvider>`.

- [ ] **Step 5: Give the active chip a visible state and a comfortable target**

In `styles.css`, after `.voy-tripnav__chip:hover`:

```css
.voy-tripnav__chip[aria-current="true"] {
  color: var(--voy-ink);
  border-color: var(--voy-ink);
  background: var(--voy-surface);
  font-weight: 600;
}

/* The most-used nav on the longest page: comfortable to tap, not just legal. */
@media (pointer: coarse) {
  .voy-tripnav__chip {
    padding: 0.55rem 0.9rem;
  }
}
```

- [ ] **Step 6: Run the test and the neighbours**

Run: `pnpm --filter @voyalier/web test -- flowFixes planningWorkflows`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/DeferredSection.tsx apps/web/src/views/TripDetailView.tsx apps/web/src/styles.css apps/web/src/flowFixes.test.tsx
git commit -m "Web+test: land the section nav where the chip points"
```

---

### Task 2: Report planning failures where they happen (gap 2)

**Files:**
- Modify: `apps/web/src/views/PlanningPanel.tsx:36-80,522-526`
- Modify: `apps/web/src/app/i18n.ts` (add `planning.retry`)
- Test: `apps/web/src/planningWorkflows.test.tsx`

**Interfaces:**
- Consumes: `useTransportHealth()` from `apps/web/src/app/context.ts`; `toAppError` from `apps/web/src/gateway/errors.ts`.

`change()` is already the shared runner, so the fix stays inside it: report transport health (so the topbar cannot keep claiming "Ready" while the engine is unreachable), remember which key failed and how to retry it, then render the failure inside the section that owns that key instead of in one trailing slot for all three features.

- [ ] **Step 1: Write the failing test**

```tsx
it("surfaces a planning failure at its own section with a retry", async () => {
  let fail = true;
  renderApp(
    failingGateway({
      addPackingItem: (input) =>
        fail
          ? Promise.reject({ code: "transport/failure", message: "unreachable" })
          : createMockGateway().addPackingItem(input),
    }),
  );
  await openKyoto();
  const custom = await screen.findByLabelText("Custom item");
  fireEvent.change(custom, { target: { value: "Rain jacket" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  // The failure is owned by the packing section, not floated after everything.
  const packing = screen
    .getByRole("heading", { name: "Packing checklist" })
    .closest("section") as HTMLElement;
  const alert = await within(packing).findByRole("alert");
  expect(alert).toHaveTextContent(/engine/i);
  // The typed value survives, and one click retries the same write.
  expect((custom as HTMLInputElement).value).toBe("Rain jacket");
  fail = false;
  fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await within(packing).findByText("Rain jacket")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @voyalier/web test -- planningWorkflows`
Expected: FAIL — the alert lives outside the packing section and has no Retry.

- [ ] **Step 3: Rework `change()` to report health and remember the retry**

```tsx
const transportHealth = useTransportHealth();
const [failure, setFailure] = useState<
  { key: string; message: string; retry: () => void } | null
>(null);

async function change(key: string, action: () => Promise<unknown>) {
  setBusy(key);
  setFailure(null);
  try {
    await action();
    // Same contract every other view honours: a success is evidence the
    // engine is reachable, so app-level health stops claiming otherwise.
    transportHealth.reportTransportSuccess();
    onChanged();
  } catch (caught) {
    const error = toAppError(caught);
    // Without this the topbar kept reading "Ready" while the engine was gone.
    transportHealth.reportTransportFailure(error);
    setFailure({
      key,
      message: describeError(error).title,
      retry: () => void change(key, action),
    });
  } finally {
    setBusy(null);
  }
}
```

- [ ] **Step 4: Render the failure in the section that owns the key**

Add above the return:

```tsx
/** Which section a change key belongs to, so its failure renders there. */
function sectionOf(key: string): "saved" | "packing" | "items" {
  if (key.startsWith("notes:") || key.startsWith("delete-place:")) return "saved";
  if (key.startsWith("suggestion:") || key.startsWith("packing:") ||
      key.startsWith("delete-packing:")) return "packing";
  return "items";
}

function FailureNote({ area }: { area: "saved" | "packing" | "items" }) {
  if (!failure || sectionOf(failure.key) !== area) return null;
  return (
    <p role="alert" className="voy-planning__error">
      {failure.message}{" "}
      <Button variant="ghost" onClick={failure.retry}>
        {t("planning.retry")}
      </Button>
    </p>
  );
}
```

Render `<FailureNote area="saved" />` at the end of the saved-places section, `<FailureNote area="packing" />` after the packing checklist `<ul>`, and `<FailureNote area="items" />` after the trip-items `<ul>`. Delete the trailing `{error ? … }` block and the `error` state.

- [ ] **Step 5: Add the key to both catalogs**

`en`: `"planning.retry": "Retry",` — `es`: `"planning.retry": "Reintentar",`

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @voyalier/web test -- planningWorkflows`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/views/PlanningPanel.tsx apps/web/src/app/i18n.ts apps/web/src/planningWorkflows.test.tsx
git commit -m "Web+test: report planning failures where they happen"
```

---

### Task 3: Stamp retrieved evidence in the viewer's zone (gap 3)

**Files:**
- Modify: `apps/web/src/app/format.ts`
- Modify: `apps/web/src/views/WeatherOutlook.tsx:27-31`, `TravelAdvice.tsx`, `DestinationFacts.tsx`, `PublicHolidays.tsx`, `AboutPlace.tsx`
- Test: `apps/web/src/weather.test.tsx`

**Interfaces:**
- Produces: `formatInstant(iso: string): string` in `app/format.ts`.

Two time species live in this codebase and only one was being served. A flight's `2026-10-12T11:05` is a wall-clock value local to its airport and must render verbatim — that is what `formatDateTimeLocal` is for, and it is correct. A snapshot's `2026-07-21T23:34:56Z` is an instant, and the five copied `formatStamp` helpers stripped the `Z` and fed it to the wall-clock formatter, printing UTC with a local clock's face.

- [ ] **Step 1: Write the failing test** in `weather.test.tsx`

```tsx
it("stamps a retrieved snapshot in the viewer's timezone", () => {
  // 23:34Z is 18:34 in America/Chicago (CDT). The old helper printed 11:34 PM.
  const stamped = formatInstant("2026-07-21T23:34:56Z");
  const expected = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date("2026-07-21T23:34:56Z"));
  expect(stamped.replace(" · ", ", ")).toBe(expected.replace(" at ", ", "));
});

it("leaves a wall-clock flight time unshifted", () => {
  expect(formatDateTimeLocal("2026-10-12T11:05")).toContain("11:05");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @voyalier/web test -- weather`
Expected: FAIL — `formatInstant` is not exported.

- [ ] **Step 3: Add the shared formatter to `format.ts`**

```ts
/**
 * Format an RFC3339 *instant* ("2026-07-21T23:34:56Z") in the viewer's own
 * timezone — "Jul 21, 2026 · 6:34 PM" in America/Chicago.
 *
 * Distinct from [[formatDateTimeLocal]] on purpose. That one formats a
 * zoneless contract value (a flight departs at 11:05 local to its airport) and
 * must never shift it. This one formats a moment in time, where showing the
 * raw UTC clock misstates when the traveler actually fetched their evidence —
 * and Voyalier's whole trust story rests on that date being true.
 */
export function formatInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${formatDateIn(
    `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(
      parsed.getDate(),
    ).padStart(2, "0")}`,
    APP_LOCALE,
  )} · ${new Intl.DateTimeFormat(APP_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed)}`;
}
```

- [ ] **Step 4: Replace all five local copies**

In each of the five views, delete the local `formatStamp` function and import `formatInstant` from `../app/format`, replacing every `formatStamp(` call site with `formatInstant(`.

- [ ] **Step 5: Run the suite**

Run: `pnpm --filter @voyalier/web test -- weather travelAdvice destinationFacts publicHolidays aboutPlace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/format.ts apps/web/src/views/WeatherOutlook.tsx apps/web/src/views/TravelAdvice.tsx apps/web/src/views/DestinationFacts.tsx apps/web/src/views/PublicHolidays.tsx apps/web/src/views/AboutPlace.tsx apps/web/src/weather.test.tsx
git commit -m "Web+test: stamp retrieved evidence in the viewer's zone"
```

---

### Task 4: Refresh imported documents after an import (gap 4)

**Files:**
- Modify: `apps/web/src/views/TripDetailView.tsx` (import + review success paths)
- Test: `apps/web/src/documents.test.tsx`

The vocabulary already has `documentsScope(tripId)` and `DocumentsPanel` already subscribes to it; the import success path simply never bumped it.

- [ ] **Step 1: Write the failing test** — import a document with the panel mounted, assert it is listed without a reload.
- [ ] **Step 2: Run it and watch it fail.** Run: `pnpm --filter @voyalier/web test -- documents`
- [ ] **Step 3: Bump both scopes.** In `TripDetailView`, define `const refreshTrip = () => revalidate(tripScope(tripId), documentsScope(tripId));` and call it from `ImportDialog`'s `onImported`/`onReview` and from the candidate review's `onResolved`, alongside the existing `reload()`.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git commit -am "Web+test: refresh imported documents after an import"
```

---

### Task 5: Return focus when a dialog closes (gap 5, gap 15)

**Files:**
- Modify: `apps/web/src/components/Dialog.tsx:69-106`
- Modify: `apps/web/src/styles.css` (`.voy-dialog`)
- Test: `apps/web/src/flowFixes.test.tsx`

Two layers: the trigger can be unmounted by the very action that closed the dialog (real in any build), and StrictMode's replayed mount effect re-captures `previouslyFocused` *after* the dialog moved focus inside itself (dev only). Capture once per open, and add a last-resort target so focus never lands on `<body>`.

- [ ] **Step 1: Write the failing test** — create a trip from the empty state, submit, assert `document.activeElement` is not `document.body`.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Capture the return target once and add a fallback**

```tsx
const previouslyFocusedRef = useRef<HTMLElement | null>(null);
if (previouslyFocusedRef.current === null) {
  const active = document.activeElement as HTMLElement | null;
  // Guard the StrictMode replay: by the second setup the dialog already owns
  // focus, and capturing that would make the return target the dialog itself.
  if (active && !dialogRef.current?.contains(active)) {
    previouslyFocusedRef.current = active;
  }
}
```

In the cleanup, fall back through explicit ref → captured trigger → `#main`:

```tsx
const main = document.getElementById("main");
const target =
  explicit?.isConnected === true ? explicit
  : previouslyFocusedRef.current?.isConnected === true ? previouslyFocusedRef.current
  : main;
if (target === main && main) main.setAttribute("tabindex", "-1");
target?.focus();
```

- [ ] **Step 4: Cap dialog height on short viewports (gap 15)**

```css
/* A long dialog must not push its own actions past the fold: the sheet scrolls
   inside itself and the footer stays put. */
.voy-dialog {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 2rem);
}

.voy-dialog__body {
  overflow-y: auto;
}

.voy-dialog__foot {
  flex: none;
}
```

Verify the existing print media query still neutralises these (it already sets `max-height: none !important`).

- [ ] **Step 5: Run the tests.** Run: `pnpm --filter @voyalier/web test -- flowFixes importDialog a11y`
- [ ] **Step 6: Commit**

```bash
git commit -am "Web+test: return focus when a dialog closes"
```

---

### Task 6: Distinguish the settings icon from the theme sun (gap 6)

**Files:**
- Modify: `apps/web/src/components/icons.tsx:222-227`

`GearIcon` is a circle with eight radial ticks; `SunIcon` is a circle with eight radial rays. On the phone topbar the labels drop and the row reads sun, monitor, moon, sun.

- [ ] **Step 1: Redraw `GearIcon` with an actual cog silhouette**

```tsx
export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.2 14.4a1.6 1.6 0 0 0 .32 1.76l.06.06a2 2 0 1 1-2.82 2.82l-.06-.06a1.6 1.6 0 0 0-1.76-.32 1.6 1.6 0 0 0-.97 1.46V20a2 2 0 1 1-4 0v-.06A1.6 1.6 0 0 0 8.9 18.5a1.6 1.6 0 0 0-1.76.32l-.06.06a2 2 0 1 1-2.82-2.82l.06-.06a1.6 1.6 0 0 0 .32-1.76 1.6 1.6 0 0 0-1.46-.97H3a2 2 0 1 1 0-4h.06A1.6 1.6 0 0 0 4.5 7.9a1.6 1.6 0 0 0-.32-1.76l-.06-.06a2 2 0 1 1 2.82-2.82l.06.06a1.6 1.6 0 0 0 1.76.32H8.9a1.6 1.6 0 0 0 .97-1.46V2a2 2 0 1 1 4 0v.06a1.6 1.6 0 0 0 .97 1.46 1.6 1.6 0 0 0 1.76-.32l.06-.06a2 2 0 1 1 2.82 2.82l-.06.06a1.6 1.6 0 0 0-.32 1.76v.08a1.6 1.6 0 0 0 1.46.97H21a2 2 0 1 1 0 4h-.06a1.6 1.6 0 0 0-1.46.97Z" />
  </Base>
);
```

- [ ] **Step 2: Verify no other icon regressed.** Run: `pnpm --filter @voyalier/web test`
- [ ] **Step 3: Commit**

```bash
git commit -am "Web: distinguish the settings icon from the theme sun"
```

---

### Task 7: Name default trips with the display arrow (gap 7)

**Files:**
- Modify: `crates/voyalier-core/src/types.rs:788`
- Test: `crates/voyalier-core/src/tests.rs:138`

The create dialog promises "Defaults to 'From → To'" and the core stored `From -> To`, so every surface showed an ASCII arrow one line from the formatted one. This is the stored, traveler-visible name, so it is a core rule — not a display patch. Existing trips keep their stored titles; the changelog says so rather than migrating them.

- [ ] **Step 1: Change the assertion first**

In `tests.rs:138`: `assert_eq!(validated.title, "Chicago → Kyoto");`

- [ ] **Step 2: Run it and watch it fail.** Run: `cargo test -p voyalier-core -- validate_create_trip`
- [ ] **Step 3: Change the literal.** In `types.rs:788`: `.unwrap_or_else(|| format!("{origin} → {destination}"));`
- [ ] **Step 4: Run the crate.** Run: `cargo test -p voyalier-core`. The golden fixture at `tests.rs:757` supplies its title explicitly and is unaffected, so no golden regenerates.
- [ ] **Step 5: Commit**

```bash
git commit -am "Core+test: name default trips with the display arrow"
```

---

### Task 8: Clear a field error when the field becomes valid (gap 8)

**Files:**
- Modify: `apps/web/src/views/CreateTripDialog.tsx`
- Test: `apps/web/src/flowFixes.test.tsx`

Keep first-attempt silence: only a field that has already failed re-validates as the traveler fixes it.

- [ ] **Step 1: Write the failing test** — submit empty, pick a suggestion for From, assert the "Enter where the trip starts." alert is gone before any second submit.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Re-validate a failed field on change**

```tsx
// Only fields that already failed re-check as they are fixed: validating a
// field the traveler has not finished with yet is nagging, not help.
function clearIfFixed(field: keyof FieldErrors, valid: boolean) {
  setErrors((current) =>
    current[field] && valid ? { ...current, [field]: undefined } : current,
  );
}
```

Call it from each control: `onChange={(value) => { setOrigin(value); clearIfFixed("origin", value.trim().length > 0 && value.trim().length <= 120); }}`, the same for `destination`, and for both dates `clearIfFixed("dates", Boolean(nextStart && nextEnd && nextStart <= nextEnd))`.

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git commit -am "Web+test: clear a field error when the field becomes valid"
```

---

### Task 9: Show one engine-unreachable banner (gap 9)

**Files:**
- Modify: `apps/web/src/views/TripDetailView.tsx` (load-error branch)
- Modify: `apps/web/src/App.tsx` (pass health down) or read it from context
- Test: `apps/web/src/errorStates.test.tsx`

Both the app-level `OfflineBanner` and the trip view's load-error render the same message and Retry for the same failure. One owner: when the failure is `transport/failure` and the app banner is already showing it, the trip view shows a quiet placeholder instead.

- [ ] **Step 1: Write the failing test** — engine down on load with a trip open, assert exactly one "Voyalier can't reach its engine" and one Retry.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Defer to the app-level banner.** In `TripDetailView`'s `status === "error"` branch, when `error!.code === "transport/failure"` render only the back button plus a short muted line (`t("detail.offlinePlaceholder")`), leaving the banner and Retry to `App`. Every other code keeps its own banner, because nothing above is showing it.
- [ ] **Step 4: Add the key to both catalogs.** `en`: `"detail.offlinePlaceholder": "This trip will load once Voyalier can reach its engine."` — `es`: `"detail.offlinePlaceholder": "Este viaje se cargará cuando Voyalier pueda comunicarse con su motor."`
- [ ] **Step 5: Run the test.** Expected: PASS.
- [ ] **Step 6: Commit**

```bash
git commit -am "Web+test: show one engine-unreachable banner"
```

---

### Task 10: Name what a search result actually is (gap 11)

**Files:**
- Modify: `crates/voyalier-app/src/lib.rs:2372-2388`
- Modify: `apps/web/src/views/WorkspaceSearch.tsx:12-18`
- Test: `crates/voyalier-app/src/lib.rs` (inline tests)

The snippet showing raw indexed text is *correct* — it is the matching evidence, the same instinct as the review dialog's quoted spans, and it must stay searchable by `2026-10-12`. The defect is the title: every flight and stay was headed "Confirmed fact". Carry the traveler's own identifying data in `label` instead of a product noun; the localized noun already renders on the next line.

- [ ] **Step 1: Write the failing Rust test** — a confirmed flight's hit label is `"SFO → KIX"`, a stay's is its property name.
- [ ] **Step 2: Run it and watch it fail.** Run: `cargo test -p voyalier-app -- search_workspace`
- [ ] **Step 3: Build the label from the payload**

```rust
// The traveler's own identifying data, not a product noun: the interface
// already says "Confirmed fact" beside this, and saying it twice cost the
// result its only chance to name which flight it found.
let label = fact_identity(&fact);
```

Add `fact_identity` returning `"{from} → {to}"` for a flight with both airports, its flight number when it has one and no route, the property name for lodging, and the existing `"Confirmed flight"` / `"Confirmed lodging"` only as a last resort. No prose, no pluralisation — data or a bare noun.

- [ ] **Step 4: Stop overriding the label in the web.** In `resultLabel`, drop the `confirmed_fact` branch so `hit.label` is used; keep the `note` branch (a note has no identifying data of its own).
- [ ] **Step 5: Run both sides.** Run: `cargo test -p voyalier-app && pnpm --filter @voyalier/web test -- workspaceSearch`
- [ ] **Step 6: Commit**

```bash
git commit -am "App+web+test: name what a search result actually is"
```

---

### Task 11: Make the conflict card and empty state navigable (gap 12, gap 13, gap 14)

**Files:**
- Modify: `apps/web/src/views/TripDetailView.tsx` (`ScheduleCheck`)
- Modify: `apps/web/src/views/TripListView.tsx` (empty state, archive)
- Modify: `apps/web/src/app/i18n.ts`
- Test: `apps/web/src/scheduleCheck.test.tsx`, `apps/web/src/flowFixes.test.tsx`

- [ ] **Step 1: Write the failing tests** — (a) a conflict exposes a control per named fact that focuses that fact's card; (b) the sample-data disclaimer sits with the sample button; (c) archiving offers Undo that restores the trip.
- [ ] **Step 2: Run them and watch them fail.**
- [ ] **Step 3: Link each conflict subject to its fact.** `ItineraryConflict` already carries `factIds`; render each subject as a button that finds `[data-search-source="confirmed_fact"][data-search-record="<id>"]`, scrolls it into view, and focuses it — the same mechanism the search-result landing already uses.
- [ ] **Step 4: Move the sample disclaimer.** Remove `<span className="voy-empty__hint">{t("sample.hint")}</span>` from `Empty`'s children and render it directly under the "Explore a sample trip" button inside `voy-empty__actions`.
- [ ] **Step 5: Offer Undo after archiving.** In `TripListView`, keep the archived trip in state after a successful archive and render an inline `role="status"` note with an Undo button that calls `unarchive(trip)`; clear it on the next action or when the list changes.
- [ ] **Step 6: Add the keys to both catalogs.** `triplist.undoArchive` / `schedule.jumpToFact`.
- [ ] **Step 7: Run the tests.** Expected: PASS.
- [ ] **Step 8: Commit**

```bash
git commit -am "Web+test: make conflicts, the sample hint, and archive recoverable"
```

---

### Task 12: Verify the whole gate, then release 0.5.2

**Files:**
- Modify: `package.json`, `Cargo.toml`, `apps/web/package.json`, `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md` if any claim changed

- [ ] **Step 1: Run the full gate.** Run: `make check`. Expected: every stage passes. Fix anything red before continuing — a release from a red gate is not a release.
- [ ] **Step 2: Re-verify each original reproduction on the real surface.** Boot the sandboxed stack and re-run the audit's exact steps for all fifteen gaps at 1280 and 375, light and dark. Source and unit tests passing is not the acceptance bar; the original reproduction must stop failing.
- [ ] **Step 3: Bump the version in all four files as one edit** to `0.5.2`.
- [ ] **Step 4: Write the CHANGELOG entry** in Keep a Changelog form — a bolded lead sentence, then the tradeoff and what was left out. Say plainly that existing trips keep their stored `->` titles.
- [ ] **Step 5: Refresh the knowledge graph.** Run: `graphify update`, then verify one scoped query, per the repo's release rule.
- [ ] **Step 6: Commit, merge, push.**

```bash
git commit -am "Docs: release Voyalier 0.5.2"
git checkout main && git merge --no-ff friendly-wizard-claude/improve-userflow-design-747d10
git push origin main
```

Expect the branch-protection warning about merge commits on `main` — it is known and documented; do not "fix" it by rebasing.

- [ ] **Step 7: Tag and publish the release.**

```bash
git tag -a v0.5.2 -m "Voyalier 0.5.2"
git push origin v0.5.2
```

---

## Self-Review

**Spec coverage:** All fifteen audit gaps map to a task — 1 and 10 → Task 1; 2 → Task 2; 3 → Task 3; 4 → Task 4; 5 and 15 → Task 5; 6 → Task 6; 7 → Task 7; 8 → Task 8; 9 → Task 9; 11 → Task 10; 12, 13, 14 → Task 11. Release is Task 12.

**Type consistency:** `formatInstant` is named identically in Task 3's definition and its five call sites. `useMountAllSections` matches between `DeferredSection.tsx` and `TripSectionNav`. `sectionOf`/`FailureNote`'s `"saved" | "packing" | "items"` union is used consistently in Task 2. `fact_identity` is the single Rust helper name in Task 10.

**Known risk:** Task 1 mounts all four section groups on chip click, firing their on-mount loads earlier than before. That is deliberate and bounded to explicit navigation; if it ever shows up as a cost, the narrower fix is to mount only the target and its predecessors, which needs section ordering the nav does not currently own.
