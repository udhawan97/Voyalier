import { useEffect, useRef, useState, type ReactNode } from "react";

import { t } from "../app/i18n";
import { Button, type ButtonVariant } from "./Button";

const REVERT_MS = 4000;

/**
 * A two-step confirm for a destructive action with no undo. First click "arms"
 * the button (its label becomes "{label} — sure?" and it turns danger-styled);
 * a second click within a few seconds runs the action, otherwise it disarms.
 * Lighter than a modal per action, and it never fires on a single stray click.
 */
export function ConfirmButton({
  label,
  onConfirm,
  busy,
  disabled,
  icon,
  variant = "ghost",
}: {
  label: string;
  onConfirm: () => void;
  busy?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  variant?: ButtonVariant;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function handleClick() {
    if (armed) {
      if (timer.current) clearTimeout(timer.current);
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), REVERT_MS);
  }

  return (
    <Button
      variant={armed ? "danger" : variant}
      busy={busy}
      disabled={disabled}
      icon={icon}
      onClick={handleClick}
    >
      {armed ? t("confirm.arm", { label }) : label}
    </Button>
  );
}
