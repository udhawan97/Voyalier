import {
  useEffect,
  useId,
  useRef,
  useState,
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
  /** Focus the dialog itself when top-level context matters more than an action. */
  initialFocus?: "first" | "dialog";
  /** Explicit return target for triggers that may disappear while open. */
  returnFocusRef?: RefObject<HTMLElement | null>;
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
  initialFocus = "first",
  returnFocusRef,
  description,
  size = "md",
  labelId,
}: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const latestReturnFocusRef = useRef(returnFocusRef);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  /**
   * Whether the body has content past its own bottom edge, and still does.
   *
   * Re-measured on resize and on scroll, because a dialog's content changes
   * while it is open — resolving a suggestion removes a whole card — and the
   * hint must stop once there is nothing more to reach.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () =>
      setOverflowing(
        body.scrollHeight - body.clientHeight - body.scrollTop > 8,
      );
    measure();
    body.addEventListener("scroll", measure, { passive: true });
    // Absent in some test environments; the hint is an enhancement, never a
    // prerequisite for reaching the content.
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(body);
    return () => {
      body.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, []);

  // Capture the trigger during render, once, before the mount effect moves
  // focus inside the dialog. Reading it in the effect meant React Strict Mode's
  // replayed setup re-captured a focus target the dialog itself already owned,
  // which poisoned the return path in development.
  if (previouslyFocusedRef.current === null) {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body)
      previouslyFocusedRef.current = active;
  }
  const autoId = useId();
  const headingId = labelId ?? `${autoId}-title`;
  const descId = description ? `${autoId}-desc` : undefined;

  useEffect(() => {
    latestReturnFocusRef.current = returnFocusRef;
  }, [returnFocusRef]);

  useEffect(() => {
    const previouslyFocused = previouslyFocusedRef.current;
    const dialog = dialogRef.current;
    // The body, not the dialog, when top-level context is what matters: the
    // body is the element that scrolls, and a browser scrolls the nearest
    // scrollable *ancestor* of what has focus. Focusing the dialog left the
    // scroller a descendant, so PageDown and the arrow keys did nothing at all
    // and a keyboard reader could tab to Confirm without ever being able to
    // read the evidence between the controls. Focus stays inside the labelled,
    // aria-modal dialog either way.
    const initial =
      initialFocus === "dialog"
        ? (bodyRef.current ?? dialog)
        : (initialFocusRef?.current ??
          (dialog ? (focusableWithin(dialog)[0] ?? dialog) : null));
    if (initialFocus === "dialog") overlayRef.current!.scrollTop = 0;
    initial?.focus({ preventScroll: initialFocus === "dialog" });
    if (initialFocus === "dialog") overlayRef.current!.scrollTop = 0;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = overflow;
      // The trigger can disappear while the dialog is open (for example, the
      // last pending review is resolved). Read the latest explicit ref after
      // the closing render, then fall back only to a still-connected trigger.
      queueMicrotask(() => {
        // React Strict Mode replays effects without removing the mounted DOM.
        // Ignore that development-only cleanup so it cannot steal focus back
        // from the dialog after the replayed setup focuses it.
        if (dialog?.isConnected) return;
        // Another dialog has already claimed focus, so this restore is not the
        // last word on where the traveler is. One dialog opening another in a
        // single commit — the import summary handing off to the review queue —
        // runs this cleanup first and the incoming dialog's focus second, and
        // this microtask third: without the check it dragged focus back out to
        // the page behind an open modal, where Tab walks the background, Esc
        // does nothing (the handler lives on the dialog), and the queue the
        // traveler was sent to cannot be reached by keyboard at all.
        //
        // Deliberately inside the microtask: read synchronously in cleanup,
        // `activeElement` is still the closing dialog and this would swallow
        // every ordinary restore.
        if (document.activeElement?.closest('[role="dialog"]')) return;
        const explicit = latestReturnFocusRef.current?.current;
        // The trigger can be unmounted by the action that closed the dialog —
        // the empty state's "Create a trip" button stops existing the moment a
        // trip does. Falling through to nothing left a keyboard user on
        // <body>, restarting from the top of the page, so main is the floor.
        const main = document.getElementById("main");
        const target =
          explicit?.isConnected === true
            ? explicit
            : previouslyFocused?.isConnected === true
              ? previouslyFocused
              : main;
        if (target && target === main) target.setAttribute("tabindex", "-1");
        target?.focus();
      });
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
    <div ref={overlayRef} className="voy-overlay" onMouseDown={handleBackdrop}>
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
        {/* `data-overflowing` is what draws the "there is more below" edge. It
            has to be measured rather than assumed: on macOS the scrollbar is an
            overlay that appears only while scrolling, so a review dialog opened
            with 2,241px of evidence in a 600px window showed no scrollbar, no
            edge, and only a Close button — while the Confirm the traveler came
            for sat 826px further down. */}
        {/* `tabIndex` so this can hold focus: it is the scroll container, and
            a scroll container the keyboard cannot focus is one the keyboard
            cannot scroll. Not in the Tab order — `focusableWithin` excludes
            `tabindex="-1"`, so the trap still cycles the controls only. */}
        <div
          ref={bodyRef}
          className="voy-dialog__body"
          tabIndex={-1}
          data-overflowing={overflowing ? "true" : undefined}
        >
          {children}
        </div>
        {footer ? <footer className="voy-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
