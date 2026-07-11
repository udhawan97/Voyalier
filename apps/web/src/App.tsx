import { useCallback, useEffect, useState } from "react";
import type { AppError, AppGateway } from "@voyalier/contracts";

import { AnnounceContext, GatewayContext, UpdaterContext } from "./app/context";
import { t } from "./app/i18n";
import { selectGateway, toAppError } from "./gateway";
import { selectUpdater, type UpdaterGateway } from "./updater";
import { useUpdater } from "./updater/useUpdater";
import { OfflineBanner } from "./components/OfflineBanner";
import { Topbar, type HealthState } from "./components/Topbar";
import { TripDetailView } from "./views/TripDetailView";
import { TripListView } from "./views/TripListView";
import { VaultUnlock } from "./views/VaultUnlock";

type View = { name: "list" } | { name: "trip"; tripId: string };

export function App({
  gateway: injected,
  updater: injectedUpdater,
}: { gateway?: AppGateway; updater?: UpdaterGateway } = {}) {
  const [gateway] = useState<AppGateway>(() => injected ?? selectGateway());
  // A STABLE updater instance (see useUpdater's contract): created once so the
  // App-level state machine doesn't re-fire its mount effect every render.
  const [updater] = useState<UpdaterGateway>(
    () => injectedUpdater ?? selectUpdater(),
  );
  const updaterController = useUpdater(updater);
  const [view, setView] = useState<View>({ name: "list" });
  const [health, setHealth] = useState<HealthState>("checking");
  const [healthError, setHealthError] = useState<AppError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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

  const retry = useCallback(() => {
    setHealth("checking");
    setHealthError(null);
    setReloadKey((key) => key + 1);
    probeHealth();
  }, [probeHealth]);

  return (
    <GatewayContext.Provider value={gateway}>
      <UpdaterContext.Provider value={updaterController}>
        <AnnounceContext.Provider value={announce}>
          <div className="voy-app">
            <a className="voy-skip" href="#main">
              {t("a11y.skipToContent")}
            </a>
            <Topbar onHome={openList} health={health} />
            <main className="voy-main" id="main">
              {health === "offline" && healthError ? (
                <OfflineBanner error={healthError} onRetry={retry} />
              ) : null}
              {locked ? (
                <VaultUnlock onUnlocked={checkVault} />
              ) : view.name === "list" ? (
                <TripListView onOpenTrip={openTrip} reloadKey={reloadKey} />
              ) : (
                <TripDetailView
                  key={view.tripId}
                  tripId={view.tripId}
                  reloadKey={reloadKey}
                  onBack={openList}
                  onDeleted={openList}
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
