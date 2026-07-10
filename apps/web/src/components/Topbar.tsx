import markUrl from "@voyalier/brand/voyalier-mark.svg?url";

import { ThemeToggle } from "./ThemeToggle";

export type HealthState = "checking" | "online" | "offline";

const HEALTH: Record<HealthState, { label: string; cls: string }> = {
  checking: { label: "Checking local core", cls: "checking" },
  online: { label: "Local core ready", cls: "online" },
  offline: { label: "Local core offline", cls: "offline" },
};

export function Topbar({
  onHome,
  health,
}: {
  onHome: () => void;
  health: HealthState;
}) {
  const pill = HEALTH[health];
  return (
    <header className="voy-topbar">
      <button
        type="button"
        className="voy-brand"
        onClick={onHome}
        aria-label="Voyalier — all trips"
      >
        <img src={markUrl} alt="" className="voy-brand__mark" />
        <span className="voy-brand__word">Voyalier</span>
      </button>
      <div className="voy-topbar__right">
        <span
          className={`voy-health voy-health--${pill.cls}`}
          role="status"
          aria-live="polite"
        >
          <span className="voy-health__dot" aria-hidden="true" />
          {pill.label}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
