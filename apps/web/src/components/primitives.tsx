import type { CSSProperties, ReactNode } from "react";
import type { ExtractionMethod, TripStatus } from "@voyalier/contracts";

import { methodDescription, methodLabel } from "../app/format";
import { ArchiveIcon, DotIcon } from "./icons";

export type Tone = "neutral" | "moss" | "indigo" | "vermilion" | "silver";

export function StatusBadge({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`voy-badge voy-badge--${tone}`}>
      {icon ? (
        <span className="voy-badge__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </span>
  );
}

const TRIP_STATUS: Record<
  TripStatus,
  { tone: Tone; icon: ReactNode; label: string }
> = {
  draft: { tone: "silver", icon: <DotIcon />, label: "Draft" },
  active: { tone: "moss", icon: <DotIcon />, label: "Active" },
  archived: { tone: "neutral", icon: <ArchiveIcon />, label: "Archived" },
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const meta = TRIP_STATUS[status];
  return (
    <StatusBadge tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </StatusBadge>
  );
}

/** A quiet chip naming how a fact was extracted (structured/inferred/manual). */
export function MethodChip({ method }: { method: ExtractionMethod }) {
  return (
    <span
      className={`voy-chip voy-chip--${method}`}
      title={methodDescription(method)}
    >
      {methodLabel(method)}
    </span>
  );
}

export function CountBadge({
  count,
  label,
  tone = "vermilion",
}: {
  count: number;
  label: string;
  tone?: Tone;
}) {
  return (
    <span
      className={`voy-count voy-count--${tone}`}
      aria-label={`${count} ${label}`}
    >
      {count}
    </span>
  );
}

/** Quoted parser evidence — the excerpt is rendered as inert text, never markup. */
export function EvidenceQuote({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: ReactNode;
}) {
  return (
    <figure className="voy-evidence">
      <blockquote className="voy-evidence__quote">{children}</blockquote>
      {caption ? (
        <figcaption className="voy-evidence__cap">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

/**
 * A section heading with a leading line-icon. Renders an `<h2 id>` so section
 * `aria-labelledby` wiring keeps working; the icon is decorative (the title
 * text always carries the meaning).
 */
export function SectionTitle({
  id,
  icon,
  children,
}: {
  id?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <h2 id={id} className="voy-shead">
      <span className="voy-shead__icon" aria-hidden="true">
        {icon}
      </span>
      <span>{children}</span>
    </h2>
  );
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius = "var(--voy-radius-sm)",
}: {
  width?: string;
  height?: string;
  radius?: string;
}) {
  const style: CSSProperties = { width, height, borderRadius: radius };
  return <span className="voy-skeleton" aria-hidden="true" style={style} />;
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="voy-empty">
      {icon ? (
        <div className="voy-empty__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <p className="voy-empty__title">{title}</p>
      {children ? <p className="voy-empty__body">{children}</p> : null}
      {action ? <div className="voy-empty__action">{action}</div> : null}
    </div>
  );
}
