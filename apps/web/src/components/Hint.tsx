import { useState, type ReactNode } from "react";

import { t } from "../app/i18n";

/**
 * A small piece of inline guidance: shown by default, dismissible, and gone for
 * the rest of the visit once dismissed.
 *
 * A `<p role="note">` rather than a dialog or a tooltip, so it is in the reading
 * order where it applies, reachable by keyboard, and readable by a screen reader
 * without anyone having to go hunting for a trigger.
 */
export function Hint({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <p className="voy-field-hint" role="note">
      {children}{" "}
      <button
        type="button"
        className="voy-linkbtn"
        onClick={() => setShown(false)}
      >
        {t("hint.dismiss")}
      </button>
    </p>
  );
}
