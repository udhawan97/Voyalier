import markUrl from "@voyalier/brand/voyalier-mark.svg?url";

import { t, type MessageKey } from "../app/i18n";
import { ThemeToggle } from "./ThemeToggle";
import { UpdatePill } from "./UpdatePill";
import { GearIcon, SearchIcon } from "./icons";

export type HealthState = "checking" | "online" | "offline";

const HEALTH: Record<HealthState, { key: MessageKey; cls: string }> = {
  checking: { key: "health.checking", cls: "checking" },
  online: { key: "health.online", cls: "online" },
  offline: { key: "health.offline", cls: "offline" },
};

export function Topbar({
  onHome,
  onSettings,
  onSearch,
  health,
}: {
  onHome: () => void;
  onSettings?: () => void;
  onSearch?: () => void;
  health: HealthState;
}) {
  const pill = HEALTH[health];
  return (
    <header className="voy-topbar">
      <button
        type="button"
        className="voy-brand"
        onClick={onHome}
        aria-label={t("topbar.home")}
      >
        <img src={markUrl} alt="" className="voy-brand__mark" />
        <span className="voy-brand__word">Voyalier</span>
      </button>
      <div className="voy-topbar__right">
        {onSearch ? (
          <button
            type="button"
            className="voy-topbar__gear"
            onClick={onSearch}
            aria-label={t("topbar.search")}
          >
            <SearchIcon aria-hidden="true" />
          </button>
        ) : null}
        <UpdatePill onOpenSettings={onSettings} />
        <span
          className={`voy-health voy-health--${pill.cls}`}
          role="status"
          aria-live="polite"
        >
          <span className="voy-health__dot" aria-hidden="true" />
          {t(pill.key)}
        </span>
        <ThemeToggle />
        {onSettings ? (
          <button
            type="button"
            className="voy-topbar__gear"
            onClick={onSettings}
            aria-label={t("topbar.settings")}
          >
            <GearIcon aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  );
}
