import type { ReactNode } from "react";

import { AlertIcon } from "./icons";

export type BannerTone = "error" | "warn" | "info";

interface BannerProps {
  tone?: BannerTone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  /** "alert" interrupts assistive tech; "status" is polite. */
  role?: "alert" | "status";
}

export function Banner({
  tone = "error",
  title,
  children,
  action,
  icon,
  role = "status",
}: BannerProps) {
  return (
    <div className={`voy-banner voy-banner--${tone}`} role={role}>
      <span className="voy-banner__icon" aria-hidden="true">
        {icon ?? <AlertIcon />}
      </span>
      <div className="voy-banner__text">
        <p className="voy-banner__title">{title}</p>
        {children ? <div className="voy-banner__body">{children}</div> : null}
      </div>
      {action ? <div className="voy-banner__action">{action}</div> : null}
    </div>
  );
}
