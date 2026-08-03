import {
  useCallback,
  useEffect,
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
import { TripDetailView, isTripSectionHash } from "./views/TripDetailView";
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
  const hash = isTripSectionHash(window.location.hash)
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
  // True while a popstate is being applied, so the effect that writes the URL
  // does not push a second entry for a move the browser already made.
  const poppingRef = useRef(false);
  // The query the search view last held. It stays out of the URL on purpose
  // (ADR-0015), so this is what lets Back restore it rather than an empty box.
  const lastSearchQuery = useRef("");
  // Where "Back" from Settings returns to (the view Settings was opened from).
  const [returnView, setReturnView] = useState<View>({ name: "list" });
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
    if (next !== current) window.history.pushState(null, "", next);
  }, [view, locked]);

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
    const onPop = () => {
      poppingRef.current = true;
      const restored = viewFromLocation() ?? { name: "list" as const };
      // The query is deliberately not in the URL (ADR-0015), so Back into the
      // search view would otherwise land on an empty box — the very symptom
      // G4 closed, coming back through the door this release just opened.
      setView(
        restored.name === "search"
          ? { ...restored, query: lastSearchQuery.current }
          : restored,
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openTrip = useCallback(
    (tripId: string) => setView({ name: "trip", tripId }),
    [],
  );
  const openList = useCallback(() => setView({ name: "list" }), []);
  // Search is a detour too, and used not to be: it recorded nothing and its
  // Back was hard-wired to the trip list, so opening it from inside a trip
  // dropped the traveler out of that trip. Settings has always done this
  // correctly; the two topbar buttons beside each other now agree.
  const openSearch = useCallback(
    () =>
      setView((current) => {
        if (current.name !== "search") setReturnView(current);
        return { name: "search", query: "" };
      }),
    [],
  );
  const setSearchQuery = useCallback((query: string) => {
    lastSearchQuery.current = query;
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
  // Settings is a detour, not a destination: remember where the user was so
  // "Back" returns them there instead of dumping them on the home list. Opening
  // Settings from Settings must not make Back a no-op loop.
  const openSettings = useCallback(
    () =>
      setView((current) => {
        if (current.name !== "settings") setReturnView(current);
        return { name: "settings" };
      }),
    [],
  );
  // Shared by Settings and Search — both are detours over the same return slot.
  const leaveDetour = useCallback(() => setView(returnView), [returnView]);

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
                <main className="voy-main" id="main">
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
