import { useCallback, useEffect, useState } from "react";
import type { AppError, AppGateway } from "@voyalier/contracts";

import { AnnounceContext, GatewayContext } from "./app/context";
import { selectGateway, toAppError } from "./gateway";
import { OfflineBanner } from "./components/OfflineBanner";
import { Topbar, type HealthState } from "./components/Topbar";
import { TripDetailView } from "./views/TripDetailView";
import { TripListView } from "./views/TripListView";

type View = { name: "list" } | { name: "trip"; tripId: string };

export function App({ gateway: injected }: { gateway?: AppGateway } = {}) {
  const [gateway] = useState<AppGateway>(() => injected ?? selectGateway());
  const [view, setView] = useState<View>({ name: "list" });
  const [health, setHealth] = useState<HealthState>("checking");
  const [healthError, setHealthError] = useState<AppError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState("");

  const announce = useCallback((next: string) => setMessage(next), []);

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
      <AnnounceContext.Provider value={announce}>
        <div className="voy-app">
          <a className="voy-skip" href="#main">
            Skip to content
          </a>
          <Topbar onHome={openList} health={health} />
          <main className="voy-main" id="main">
            {health === "offline" && healthError ? (
              <OfflineBanner error={healthError} onRetry={retry} />
            ) : null}
            {view.name === "list" ? (
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
    </GatewayContext.Provider>
  );
}
