import { useContext } from "react";

import { UpdaterContext } from "../app/context";
import { t } from "../app/i18n";

/**
 * A small topbar affordance shown only when an update is available or staged. It
 * reads the shared updater controller via the nullable context (so the Topbar
 * still renders in isolation, e.g. in tests, when no controller is provided) and
 * announces once via `role="status"`. Clicking it scrolls the updates panel into
 * view; it renders regardless of vault lock so a locked user still sees it.
 */
export function UpdatePill() {
  const controller = useContext(UpdaterContext);
  if (!controller) return null;
  const { phase } = controller;
  if (phase.name !== "available" && phase.name !== "staged") return null;

  const label =
    phase.name === "staged"
      ? t("updates.pill.staged")
      : t("updates.pill.available");

  return (
    <button
      type="button"
      className="voy-updatepill"
      onClick={() =>
        document
          .getElementById("updates-title")
          ?.scrollIntoView({ block: "center" })
      }
    >
      <span className="voy-updatepill__dot" aria-hidden="true" />
      <span role="status">{label}</span>
    </button>
  );
}
