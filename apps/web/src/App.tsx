import { useCallback, useEffect, useState } from "react";
import type { AppError, AppGateway } from "@voyalier/contracts";

import { AnnounceContext, GatewayContext, UpdaterContext } from "./app/context";
import { RevalidateProvider, useRevalidateAll } from "./app/revalidate";
import { t } from "./app/i18n";
import { selectGateway, toAppError } from "./gateway";
import { selectUpdater, type UpdaterGateway } from "./updater";
import { useUpdater } from "./updater/useUpdater";
import { OfflineBanner } from "./components/OfflineBanner";
import { Topbar, type HealthState } from "./components/Topbar";
import { SettingsView } from "./views/SettingsView";
import { TripDetailView } from "./views/TripDetailView";
import { TripListView } from "./views/TripListView";
import { UpdatesPanel } from "./views/UpdatesPanel";
import { VaultUnlock } from "./views/VaultUnlock";

type View =
  { name: "list" } | { name: "trip"; tripId: string } | { name: "settings" };

type AppProps = { gateway?: AppGateway; updater?: UpdaterGateway };

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
  const [gateway] = useState<AppGateway>(() => injected ?? selectGateway());
  // A STABLE updater instance (see useUpdater's contract): created once so the
  // App-level state machine doesn't re-fire its mount effect every render.
  const [updater] = useState<UpdaterGateway>(
    () => injectedUpdater ?? selectUpdater(),
  );
  const updaterController = useUpdater(updater);
  const revalidateAll = useRevalidateAll();
  const [view, setView] = useState<View>({ name: "list" });
  // Where "Back" from Settings returns to (the view Settings was opened from).
  const [returnView, setReturnView] = useState<View>({ name: "list" });
  const [health, setHealth] = useState<HealthState>("checking");
  const [healthError, setHealthError] = useState<AppError | null>(null);
  const [message, setMessage] = useState("");
  // Whether the encrypted vault needs a passphrase before the workspace opens.
  // `null` until the first check completes (treated as "not locked").
  const [locked, setLocked] = useState<boolean | null>(null);

  const announce = useCallback((next: string) => setMessage(next), []);

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
        setHealth("online");
        setHealthError(null);
      },
      (caught) => {
        setHealth("offline");
        setHealthError(toAppError(caught));
      },
    );
  }, [gateway]);

  useEffect(() => {
    probeHealth();
  }, [probeHealth]);

  const openTrip = useCallback(
    (tripId: string) => setView({ name: "trip", tripId }),
    [],
  );
  const openList = useCallback(() => setView({ name: "list" }), []);
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
  const leaveSettings = useCallback(() => setView(returnView), [returnView]);

  const retry = useCallback(() => {
    setHealth("checking");
    setHealthError(null);
    // The one caller that cannot name what changed: the app just failed to
    // reach its engine, so nothing on screen is trustworthy.
    revalidateAll();
    probeHealth();
  }, [probeHealth, revalidateAll]);

  return (
    <GatewayContext.Provider value={gateway}>
      <UpdaterContext.Provider value={updaterController}>
        <AnnounceContext.Provider value={announce}>
          <div className="voy-app">
            <a className="voy-skip" href="#main">
              {t("a11y.skipToContent")}
            </a>
            <Topbar
              onHome={openList}
              onSettings={openSettings}
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
                <SettingsView onBack={leaveSettings} />
              ) : view.name === "list" ? (
                <TripListView onOpenTrip={openTrip} />
              ) : (
                <TripDetailView
                  key={view.tripId}
                  tripId={view.tripId}
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
    </GatewayContext.Provider>
  );
}
