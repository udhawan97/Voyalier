import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AppError,
  AppGateway,
  WorkspaceSearchHit,
} from "@voyalier/contracts";

import {
  AnnounceContext,
  GatewayContext,
  TransportHealthContext,
  TransportRecoveryContext,
  UpdaterContext,
} from "./app/context";
import { RevalidateProvider, useRevalidateAll } from "./app/revalidate";
import { t } from "./app/i18n";
import { localeSnapshot, subscribeLocale } from "./app/locale";
import { selectGateway, toAppError } from "./gateway";
import { selectUpdater, type UpdaterGateway } from "./updater";
import { useUpdater } from "./updater/useUpdater";
import { OfflineBanner } from "./components/OfflineBanner";
import { Topbar, type HealthState } from "./components/Topbar";
import { SettingsView } from "./views/SettingsView";
import {
  TripDetailView,
  isTripSectionHash,
  tripSectionForSearchSource,
} from "./views/TripDetailView";
import { TripListView } from "./views/TripListView";
import { UpdatesPanel } from "./views/UpdatesPanel";
import { VaultUnlock } from "./views/VaultUnlock";
import { WorkspaceSearch } from "./views/WorkspaceSearch";

type View =
  | { name: "list" }
  | {
      name: "trip";
      tripId: string;
      searchTarget?: Pick<WorkspaceSearchHit, "source" | "recordId">;
    }
  | { name: "settings" }
  // The query rides on the view, not inside WorkspaceSearch: leaving for
  // Settings unmounts that subtree, and a query held below here died with it.
  | { name: "search"; query: string };

type AppProps = { gateway?: AppGateway; updater?: UpdaterGateway };

const ACTIVE_TRIP_KEY = "voyalier-active-trip";
const HISTORY_INDEX_KEY = "__voyalierViewIndex";
const VIEW_HEADING_SELECTOR = "[data-voy-view-heading]";

function historyIndex(state: unknown): number | null {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const value = (state as Record<string, unknown>)[HISTORY_INDEX_KEY];
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function historyStateAt(index: number): Record<string, unknown> {
  const current = window.history.state;
  const state =
    current && typeof current === "object" && !Array.isArray(current)
      ? current
      : {};
  return { ...state, [HISTORY_INDEX_KEY]: index };
}

function sameViewPage(left: View, right: View): boolean {
  if (left.name !== right.name) return false;
  if (left.name === "trip" && right.name === "trip") {
    return left.tripId === right.tripId;
  }
  return true;
}

/**
 * Whether a trip id from outside the app is one the workspace will adopt.
 *
 * Two readers put a value into the same `view.tripId`: the address bar and
 * session storage. Both are places the app does not control, so both ask this
 * one question — the URL reader ADR-0015 added checked only the length, and
 * the looser of two rules is the rule. Nothing downstream is exploitable today
 * (an unknown id is a not-found error, and React escapes the text), which is
 * why this is a boundary that stays closed rather than a bug being patched.
 *
 * `.length` and not `countChars()` on purpose: this is a defensive ceiling on
 * an opaque identifier, not a limit a traveler types into and sees counted.
 */
function isAdoptableTripId(tripId: string | undefined): tripId is string {
  // C0 controls and DEL: exactly the per-character loop this replaces, checked
  // identical over all 65536 BMP code units and over surrogate pairs, where
  // `Array.from` and a code-unit scan disagree about what a character is.
  // Not `\p{Cc}`, which also rejects C1 (U+0080–U+009F) and would quietly
  // narrow what the session-storage reader here has always accepted.
  //
  // `no-control-regex` exists to catch control characters someone pasted in by
  // accident. Here they are the subject of the check, so the rule is answered
  // rather than obeyed — the alternative spellings that satisfy it silently
  // (`\p{Cc}`, a `fromCharCode` build-up) either change the rule or hide it.
  // eslint-disable-next-line no-control-regex
  return !!tripId && tripId.length <= 128 && !/[\x00-\x1f\x7f]/.test(tripId);
}

function readActiveTrip(): string | null {
  try {
    const tripId = globalThis.sessionStorage?.getItem(ACTIVE_TRIP_KEY)?.trim();
    if (isAdoptableTripId(tripId)) return tripId;
  } catch {
    // Session storage can be unavailable; list view remains the safe default.
  }
  return null;
}

function rememberActiveTrip(tripId: string): void {
  try {
    globalThis.sessionStorage?.setItem(ACTIVE_TRIP_KEY, tripId);
  } catch {
    // Re-entry is a convenience, never a prerequisite for using the workspace.
  }
}

function clearActiveTrip(): void {
  try {
    globalThis.sessionStorage?.removeItem(ACTIVE_TRIP_KEY);
  } catch {
    // Ignore an unavailable session store.
  }
}

function clearTripSectionHash(): void {
  // The predicate lives with the nav that owns those ids. A hand-written copy
  // here missed `#section-visa` when the visa cockpit landed, so leaving a trip
  // from that section left a dead hash in the address bar.
  if (typeof window === "undefined" || !isTripSectionHash(window.location.hash))
    return;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

/**
 * The view, written into the URL and read back out (ADR-0015).
 *
 * A query string rather than a path, because this app is served by a loopback
 * Axum process and by Tauri's asset protocol, and neither would rewrite a path
 * route without being taught to. The section hash keeps its own job unchanged:
 * the query says which view, the hash says where inside it.
 *
 * The search query is deliberately absent. It is the traveler's own text about
 * their own trips, and the address bar is the one place in this product where
 * such text would outlive the moment — into history, screenshots, screen
 * shares. It rides in view state, which already survives a detour.
 */
function viewFromLocation(): View | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const named = params.get("view");
  if (named === "settings") return { name: "settings" };
  if (named === "search") return { name: "search", query: "" };
  const tripId = params.get("trip")?.trim();
  if (isAdoptableTripId(tripId)) return { name: "trip", tripId };
  // A `?trip=` this rejects still counts as the URL having spoken: the list,
  // not the session's last trip, which is what an unreadable address means.
  if (params.has("view") || params.has("trip")) return { name: "list" };
  return null;
}

function urlForView(view: View): string {
  const path = window.location.pathname;
  // Carried by every view except the list, and that is load-bearing: Settings
  // and Search are detours a trip returns from, so dropping the section hash on
  // the way out would land the traveler back at the top of a trip they had
  // scrolled halfway through. The list is the one view that genuinely owns no
  // section, and `clearTripSectionHash` strips it there.
  const hash =
    view.name === "trip" && view.searchTarget
      ? `#${tripSectionForSearchSource(view.searchTarget.source)}`
      : isTripSectionHash(window.location.hash)
        ? window.location.hash
        : "";
  switch (view.name) {
    case "settings":
      return `${path}?view=settings${hash}`;
    case "search":
      return `${path}?view=search${hash}`;
    case "trip":
      return `${path}?trip=${encodeURIComponent(view.tripId)}${hash}`;
    default:
      return path;
  }
}

/**
 * Revalidation has to wrap the workspace, because the workspace revalidates:
 * `retry` refetches everything after the engine goes unreachable. Splitting the
 * provider out keeps `<App gateway={...}/>` the whole mounting story for tests.
 */
export function App(props: AppProps = {}) {
  return (
    <RevalidateProvider>
      <Workspace {...props} />
    </RevalidateProvider>
  );
}

function Workspace({
  gateway: injected,
  updater: injectedUpdater,
}: AppProps = {}) {
  // Locale is an app-local external store. A preference change re-renders the
  // whole visible workspace immediately without a reload or network request.
  useSyncExternalStore(subscribeLocale, localeSnapshot, localeSnapshot);
  const [gateway] = useState<AppGateway>(() => injected ?? selectGateway());
  // A STABLE updater instance (see useUpdater's contract): created once so the
  // App-level state machine doesn't re-fire its mount effect every render.
  const [updater] = useState<UpdaterGateway>(
    () => injectedUpdater ?? selectUpdater(),
  );
  const updaterController = useUpdater(updater);
  const revalidateAll = useRevalidateAll();
  const [view, setView] = useState<View>(() => {
    // The URL wins when it says anything; the session's last trip is the
    // fallback, so an address bar with no query keeps the pre-0.9.1 behaviour
    // of returning the traveler to where they were.
    const fromUrl = viewFromLocation();
    if (fromUrl) return fromUrl;
    const tripId = readActiveTrip();
    return tripId ? { name: "trip", tripId } : { name: "list" };
  });
  const currentViewRef = useRef(view);
  const pendingViewFocus = useRef(false);
  const mainRef = useRef<HTMLElement>(null);
  const historyIndexRef = useRef(
    typeof window === "undefined"
      ? 0
      : (historyIndex(window.history.state) ?? 0),
  );
  // True while a popstate is being applied, so the effect that writes the URL
  // does not push a second entry for a move the browser already made.
  const poppingRef = useRef(false);
  // Search text stays out of the URL and history.state on purpose (ADR-0015).
  // Key it to the private app-owned history index instead of keeping one
  // global slot: two distinct Search entries may legitimately hold different
  // text, and a later blank visit must not inherit an older visit's query.
  const searchQueriesByHistory = useRef(new Map<number, string>());
  const [health, setHealth] = useState<HealthState>("checking");
  const [healthError, setHealthError] = useState<AppError | null>(null);
  const asyncTransportFailureSeen = useRef(false);
  // Bumped whenever the engine answers. Views holding a transport failure watch
  // it so a recovery clears what it just disproved.
  const [recoveries, setRecoveries] = useState(0);
  const [message, setMessage] = useState("");
  // Whether the encrypted vault needs a passphrase before the workspace opens.
  // `null` until the first check completes (treated as "not locked").
  const [locked, setLocked] = useState<boolean | null>(null);

  const announce = useCallback((next: string) => setMessage(next), []);

  const transportHealth = useMemo(
    () => ({
      reportTransportSuccess: () => {
        if (!asyncTransportFailureSeen.current) return;
        asyncTransportFailureSeen.current = false;
        setHealth("online");
        setHealthError(null);
        setRecoveries((count) => count + 1);
      },
      reportTransportFailure: (error: AppError) => {
        if (error.code !== "transport/failure") return;
        asyncTransportFailureSeen.current = true;
        setHealth("offline");
        setHealthError(error);
      },
    }),
    [],
  );

  const checkVault = useCallback(() => {
    gateway.getVaultStatus().then(
      (status) => setLocked(status.locked),
      // A gateway without vault support (or a transient error) must never wall
      // off the app — fail open to the normal workspace.
      () => setLocked(false),
    );
  }, [gateway]);

  useEffect(() => {
    checkVault();
  }, [checkVault]);

  // Only the async result touches state, so the mount effect never calls
  // setState synchronously; the retry handler does its own "checking" reset.
  const probeHealth = useCallback(() => {
    gateway.health().then(
      () => {
        asyncTransportFailureSeen.current = false;
        setHealth("online");
        setHealthError(null);
        setRecoveries((count) => count + 1);
      },
      (caught) => {
        asyncTransportFailureSeen.current = false;
        setHealth("offline");
        setHealthError(toAppError(caught));
      },
    );
  }, [gateway]);

  useEffect(() => {
    probeHealth();
  }, [probeHealth]);

  // Which trip the section hash belongs to. `#section-visa` is an id every trip
  // shares, so a hash left over from trip A silently re-applies to trip B — and
  // on a search jump it is the *reload* that shows it, because the search
  // target wins on the first render and hides the stale hash until then.
  const hashOwner = useRef<string | null>(null);

  useEffect(() => {
    // A move the browser made already owns the URL — including the hash it just
    // restored. Everything below rewrites the address bar, so it has to stand
    // down first; clearing the hash here would strip the very `#section-*` a
    // Back press had just brought back.
    if (poppingRef.current) {
      poppingRef.current = false;
      if (view.name === "trip") {
        hashOwner.current = view.tripId;
        rememberActiveTrip(view.tripId);
      } else if (view.name === "list") {
        hashOwner.current = null;
        clearActiveTrip();
      }
      return;
    }

    if (view.name === "trip") {
      if (hashOwner.current !== null && hashOwner.current !== view.tripId) {
        clearTripSectionHash();
      }
      hashOwner.current = view.tripId;
      rememberActiveTrip(view.tripId);
    } else if (view.name === "list") {
      hashOwner.current = null;
      clearActiveTrip();
      clearTripSectionHash();
    }

    // ADR-0015: give the move a history entry, so Back undoes it. Skipped when
    // the URL already says this — that keeps a first render, or a section-hash
    // rewrite, from stacking a duplicate entry the traveler would have to press
    // Back twice to escape.
    //
    if (typeof window === "undefined" || locked) return;
    const next = urlForView(view);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      const nextIndex = historyIndexRef.current + 1;
      historyIndexRef.current = nextIndex;
      if (view.name === "search") {
        searchQueriesByHistory.current.set(nextIndex, view.query);
      }
      window.history.pushState(historyStateAt(nextIndex), "", next);
    } else if (historyIndex(window.history.state) === null) {
      // A direct load owns index zero. Marking the entry lets a detour know
      // whether there is an in-app predecessor without exposing anything in
      // the address bar or guessing from the browser's global history length.
      window.history.replaceState(
        historyStateAt(historyIndexRef.current),
        "",
        current,
      );
      if (view.name === "search") {
        searchQueriesByHistory.current.set(historyIndexRef.current, view.query);
      }
    }
  }, [view, locked]);

  useLayoutEffect(() => {
    currentViewRef.current = view;
  }, [view]);

  useLayoutEffect(() => {
    if (!pendingViewFocus.current) return;
    const focusHeading = () => {
      const heading = mainRef.current?.querySelector<HTMLElement>(
        VIEW_HEADING_SELECTOR,
      );
      if (!heading) return false;
      pendingViewFocus.current = false;
      heading.focus({ preventScroll: true });
      return true;
    };
    if (focusHeading()) return;

    // Trip data is asynchronous, so its h1 may not exist in the first commit.
    // Observe only the current main subtree and stop as soon as that one
    // destination supplies its heading. A refresh without navigation never
    // sets the one-shot intent and therefore never starts this observer.
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    if (mainRef.current) {
      observer.observe(mainRef.current, { childList: true, subtree: true });
    }
    return () => observer.disconnect();
  }, [view]);

  /**
   * Take the view back out of the address bar once the vault says it is locked.
   *
   * The effect above skips the write while `locked`, but `locked` is `null`
   * until the status arrives and `null` is falsy — so the first render, which is
   * the only render a locked traveler ever sees, wrote the restored trip id and
   * nothing removed it. Guarding that effect on `locked !== false` instead is
   * the obvious fix and is wrong: the section navigation depends on the address
   * that first write leaves behind, and deferring it strands the jump to
   * `#section-<name>` on a cold load.
   *
   * So the write stands and this takes it back, the moment there is an answer.
   * `replaceState`, not `pushState`: the entry it is correcting is one the
   * traveler never chose and must not have to press Back through.
   */
  useEffect(() => {
    if (typeof window === "undefined" || locked !== true) return;
    if (!window.location.search) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.hash}`,
    );
  }, [locked]);

  // Back and Forward move the view rather than leaving the workspace.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (event: PopStateEvent) => {
      poppingRef.current = true;
      const restored = viewFromLocation() ?? { name: "list" as const };
      const restoredIndex = historyIndex(event.state) ?? 0;
      // The query is deliberately not in the URL (ADR-0015), so Back into the
      // search view reads only the text owned by that history entry. This
      // preserves an actual detour without leaking a prior Search visit into a
      // newer blank one.
      const next =
        restored.name === "search"
          ? {
              ...restored,
              query: searchQueriesByHistory.current.get(restoredIndex) ?? "",
            }
          : restored;
      historyIndexRef.current = restoredIndex;
      if (!sameViewPage(currentViewRef.current, next)) {
        pendingViewFocus.current = true;
      }
      currentViewRef.current = next;
      setView(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openTrip = useCallback(
    (tripId: string) => setView({ name: "trip", tripId }),
    [],
  );
  const openList = useCallback(() => setView({ name: "list" }), []);
  const openSearch = useCallback(() => {
    if (currentViewRef.current.name === "search") return;
    pendingViewFocus.current = true;
    setView({ name: "search", query: "" });
  }, []);
  const setSearchQuery = useCallback((query: string) => {
    searchQueriesByHistory.current.set(historyIndexRef.current, query);
    setView((current) =>
      current.name === "search" ? { ...current, query } : current,
    );
  }, []);
  const openSearchResult = useCallback(
    (hit: WorkspaceSearchHit) =>
      setView({
        name: "trip",
        tripId: hit.tripId,
        searchTarget: { source: hit.source, recordId: hit.recordId },
      }),
    [],
  );
  const openSettings = useCallback(() => {
    if (currentViewRef.current.name === "settings") return;
    pendingViewFocus.current = true;
    setView({ name: "settings" });
  }, []);
  // Search and Settings already receive one ADR-0015 history entry per move.
  // Their own Back controls unwind those entries instead of maintaining a
  // second, lossy return slot. A direct URL has no app-owned predecessor, so
  // its safe "up" destination is All Trips.
  const leaveDetour = useCallback(() => {
    if (historyIndexRef.current > 0) {
      window.history.back();
      return;
    }
    pendingViewFocus.current = true;
    setView({ name: "list" });
  }, []);

  const retry = useCallback(() => {
    setHealth("checking");
    setHealthError(null);
    // The one caller that cannot name what changed: the app just failed to
    // reach its engine, so nothing on screen is trustworthy.
    revalidateAll();
    probeHealth();
    // Including whether the vault is still open. The ordinary reason an engine
    // goes away is that it restarted — an update, a crash — and a restart
    // re-locks a passphrase-protected vault. Without this the traveler was
    // handed back what looked like their workspace while every sealed read
    // answered 423, because `checkVault` only ever ran on mount and the mount
    // had already happened.
    checkVault();
  }, [checkVault, probeHealth, revalidateAll]);

  return (
    <GatewayContext.Provider value={gateway}>
      <TransportHealthContext.Provider value={transportHealth}>
        <TransportRecoveryContext.Provider value={recoveries}>
          <UpdaterContext.Provider value={updaterController}>
            <AnnounceContext.Provider value={announce}>
              <div className="voy-app">
                <a className="voy-skip" href="#main">
                  {t("a11y.skipToContent")}
                </a>
                <Topbar
                  onHome={openList}
                  onSettings={openSettings}
                  onSearch={openSearch}
                  health={health}
                />
                <main ref={mainRef} className="voy-main" id="main">
                  {health === "offline" && healthError ? (
                    <OfflineBanner error={healthError} onRetry={retry} />
                  ) : null}
                  {locked ? (
                    <>
                      <VaultUnlock onUnlocked={checkVault} />
                      {/* D2: a locked user can still update — the updater needs zero
                      trip data, so the panel renders pre-unlock too. */}
                      <UpdatesPanel />
                    </>
                  ) : view.name === "settings" ? (
                    <SettingsView onBack={leaveDetour} />
                  ) : view.name === "search" ? (
                    <WorkspaceSearch
                      onBack={leaveDetour}
                      onOpenResult={openSearchResult}
                      initialQuery={view.query}
                      onQueryChange={setSearchQuery}
                    />
                  ) : view.name === "list" ? (
                    <TripListView onOpenTrip={openTrip} />
                  ) : (
                    <TripDetailView
                      key={view.tripId}
                      tripId={view.tripId}
                      searchTarget={view.searchTarget}
                      onBack={openList}
                      onDeleted={openList}
                      onOpenSettings={openSettings}
                    />
                  )}
                </main>
                {updaterController.justUpdated ? (
                  <div className="voy-toast" role="status">
                    <span>
                      {t("updates.justUpdated", {
                        version: updaterController.justUpdated,
                      })}
                    </span>
                    <button
                      type="button"
                      className="voy-toast__close"
                      onClick={updaterController.dismissJustUpdated}
                      aria-label={t("updates.dismiss")}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
              </div>
              <div
                className="voy-sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {message}
              </div>
            </AnnounceContext.Provider>
          </UpdaterContext.Provider>
        </TransportRecoveryContext.Provider>
      </TransportHealthContext.Provider>
    </GatewayContext.Provider>
  );
}
