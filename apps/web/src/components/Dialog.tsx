import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { t } from "../app/i18n";
import { CloseIcon } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getAttribute("aria-hidden") !== "true",
  );
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Footer actions row (buttons). */
  footer?: ReactNode;
  /** Focus this on open instead of the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Extra description text tied to aria-describedby. */
  description?: ReactNode;
  size?: "md" | "lg";
  labelId?: string;
}

/**
 * Accessible modal dialog: role="dialog" aria-modal, focus trapped inside,
 * Esc closes, and focus returns to whatever was focused when it opened (the
 * trigger). Rendered in a portal so stacking and backdrop are independent of
 * the trigger's DOM position.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  initialFocusRef,
  description,
  size = "md",
  labelId,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const headingId = labelId ?? `${autoId}-title`;
  const descId = description ? `${autoId}-desc` : undefined;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const initial =
      initialFocusRef?.current ??
      (dialog ? (focusableWithin(dialog)[0] ?? dialog) : null);
    initial?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
    // Run once per open; the trap handler reads live refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableWithin(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdrop(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div className="voy-overlay" onMouseDown={handleBackdrop}>
      <div
        ref={dialogRef}
        className={`voy-dialog voy-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* A plain div, not <header>: a <header> here would register as a second
            page-level `banner` landmark alongside the topbar. */}
        <div className="voy-dialog__head">
          <h2 id={headingId} className="voy-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="voy-icon-btn"
            onClick={onClose}
            aria-label={t("dialog.close")}
          >
            <CloseIcon />
          </button>
        </div>
        {description ? (
          <p id={descId} className="voy-dialog__desc">
            {description}
          </p>
        ) : null}
        <div className="voy-dialog__body">{children}</div>
        {footer ? <footer className="voy-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
