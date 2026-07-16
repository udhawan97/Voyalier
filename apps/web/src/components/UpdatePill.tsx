import { useContext } from "react";

import { UpdaterContext } from "../app/context";
import { t } from "../app/i18n";

/**
 * A small topbar affordance shown only when an update is available or staged. It
 * reads the shared updater controller via the nullable context (so the Topbar
 * still renders in isolation, e.g. in tests, when no controller is provided) and
 * announces once via `role="status"`. It renders regardless of vault lock so a
 * locked user still sees it.
 *
 * Clicking it reveals the updates panel. The panel now lives in Settings, so the
 * pill must switch views first and scroll only once the panel has rendered. When
 * no navigation is provided the panel is already on screen — that is the locked
 * vault, where `UpdatesPanel` renders directly beside the unlock gate — so a
 * plain scroll is still correct.
 */
export function UpdatePill({
  onOpenSettings,
}: {
  onOpenSettings?: () => void;
}) {
  const controller = useContext(UpdaterContext);
  if (!controller) return null;
  const { phase } = controller;

  // Staged always shows; an available update shows unless the user skipped it
  // (§9: skipping only silences the pill, the panel still lists it).
  const label =
    phase.name === "staged"
      ? t("updates.pill.staged")
      : phase.name === "available" && !phase.skipped
        ? t("updates.pill.available")
        : null;
  if (!label) return null;

  return (
    <button
      type="button"
      className="voy-updatepill"
      onClick={() => {
        const reveal = () =>
          document
            .getElementById("updates-title")
            ?.scrollIntoView({ block: "center" });
        if (!onOpenSettings) return reveal();
        onOpenSettings();
        // Settings renders on the next commit; scrolling now would find nothing.
        requestAnimationFrame(reveal);
      }}
    >
      <span className="voy-updatepill__dot" aria-hidden="true" />
      <span role="status">{label}</span>
    </button>
  );
}
