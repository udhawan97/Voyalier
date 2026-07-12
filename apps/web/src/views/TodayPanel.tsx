import type { TodayItem, TodayView, TripPhase } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { useAsyncData } from "../app/useAsync";
import { formatDate } from "../app/format";
import { t } from "../app/i18n";
import { Button } from "../components/Button";
import { SectionTitle } from "../components/primitives";
import { CalendarIcon, RetryIcon } from "../components/icons";

function phaseHeadline(phase: TripPhase): string {
  switch (phase.state) {
    case "upcoming":
      if (phase.daysUntil === 1) return t("today.phase.tomorrow");
      return t("today.phase.upcoming", { days: phase.daysUntil ?? 0 });
    case "active":
      return t("today.phase.active", {
        day: phase.day ?? 0,
        total: phase.totalDays ?? 0,
      });
    case "completed":
      if (phase.daysAgo === 1) return t("today.phase.yesterday");
      return t("today.phase.completed", { days: phase.daysAgo ?? 0 });
  }
}

function itemLine(item: TodayItem): string {
  return item.time ? `${item.title} · ${item.time}` : item.title;
}

/**
 * The Today view: where the trip stands right now, what's on for today, and the
 * next thing coming up. Deterministic and offline — computed from confirmed
 * facts against the current date. Loads with the trip; no network.
 */
export function TodayPanel({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const today = useAsyncData<TodayView>(
    () => gateway.getToday(tripId),
    `today:${tripId}`,
  );

  if (today.status === "error") {
    // A best-effort summary — but surface a quiet, retryable line rather than
    // silently removing a headline panel when it can't load.
    return (
      <section
        className="voy-today voy-today--error"
        aria-labelledby="today-title"
      >
        <SectionTitle id="today-title" icon={<CalendarIcon />}>
          {t("today.title")}
        </SectionTitle>
        <p className="voy-today__error">
          <span>{t("today.error")}</span>
          <Button variant="ghost" icon={<RetryIcon />} onClick={today.reload}>
            {t("action.retry")}
          </Button>
        </p>
      </section>
    );
  }
  if (!today.data) {
    // No data for this trip yet (e.g. no confirmed facts) — render nothing.
    return null;
  }

  const view = today.data;

  return (
    <section className="voy-today" aria-labelledby="today-title">
      <div className="voy-today__head">
        <SectionTitle id="today-title" icon={<CalendarIcon />}>
          {t("today.title")}
        </SectionTitle>
        <span
          className={`voy-today__phase voy-today__phase--${view.phase.state}`}
        >
          {phaseHeadline(view.phase)}
        </span>
      </div>

      {view.today.length > 0 ? (
        <ul className="voy-today__list" aria-label={t("today.schedule")}>
          {view.today.map((item, index) => (
            <li key={`${item.kind}:${index}`} className="voy-today__item">
              <span className="voy-today__item-title">{itemLine(item)}</span>
              {item.detail ? (
                <span className="voy-today__item-detail">{item.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="voy-today__empty">
          {view.phase.state === "active"
            ? t("today.empty.active")
            : t("today.empty.other")}
        </p>
      )}

      {view.next ? (
        <p className="voy-today__next">
          <span className="voy-today__next-label">{t("today.next")}</span>
          {itemLine(view.next)} · {formatDate(view.next.date)}
        </p>
      ) : null}
    </section>
  );
}
