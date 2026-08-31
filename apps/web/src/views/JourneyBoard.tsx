import type {
  JourneyBoard as JourneyBoardData,
  JourneyBoardEntry,
  TodayItem,
} from "@voyalier/contracts";

import { formatDate, formatTimeLocal } from "../app/format";
import { t } from "../app/i18n";
import { Button } from "../components/Button";
import { RouteIcon } from "../components/icons";
import { SectionTitle } from "../components/primitives";

function entryTitle(item: JourneyBoardEntry): string {
  switch (item.kind) {
    case "flight_departure":
    case "journey_departure":
      return item.subject
        ? t("today.item.depart", { subject: item.subject })
        : t("journey.item.departGeneric");
    case "flight_arrival":
    case "journey_arrival":
      return item.subject
        ? t("today.item.arrive", { subject: item.subject })
        : t("journey.item.arriveGeneric");
    case "checkin":
      return item.subject
        ? t("today.item.checkin", { subject: item.subject })
        : t("today.item.checkinGeneric");
    case "checkout":
      return item.subject
        ? t("today.item.checkout", { subject: item.subject })
        : t("today.item.checkoutGeneric");
    case "staying_tonight":
      return item.subject
        ? t("today.item.staying", { subject: item.subject })
        : t("today.item.stayingGeneric");
    case "activity":
    case "rail":
    case "transfer":
      return item.title;
  }
}

function entryLine(item: JourneyBoardEntry): string {
  const title = entryTitle(item);
  return item.time ? `${formatTimeLocal(item.time)} · ${title}` : title;
}

function EntryList({
  entries,
  onFocusTarget,
}: {
  entries: JourneyBoardEntry[];
  onFocusTarget: (
    target: JourneyBoardEntry["target"],
    trigger: HTMLElement,
  ) => void;
}) {
  if (entries.length === 0) {
    return <p className="voy-journey__empty">{t("journey.day.empty")}</p>;
  }
  return (
    <ul className="voy-journey__entries">
      {entries.map((entry) => (
        <li
          key={`${entry.focusLocator}:${entry.kind}:${entry.date ?? "none"}`}
          className={`voy-journey__entry voy-journey__entry--${entry.target.source}`}
        >
          <span className="voy-journey__dot" aria-hidden="true" />
          <span className="voy-journey__entry-copy">
            <span className="voy-journey__entry-title">{entryLine(entry)}</span>
            {entry.detail ? (
              <span className="voy-journey__entry-detail">{entry.detail}</span>
            ) : null}
            <span className="voy-journey__source">
              {entry.target.source === "confirmed_fact"
                ? t("journey.source.confirmed")
                : t("journey.source.plan")}
            </span>
          </span>
          <Button
            variant="ghost"
            className="voy-journey__open"
            aria-label={t("journey.open.label", { item: entryLine(entry) })}
            onClick={(event) =>
              onFocusTarget(entry.target, event.currentTarget)
            }
          >
            {t("today.openTarget")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

type Target = NonNullable<TodayItem["target"]>;

export function JourneyBoard({
  board,
  onFocusTarget,
}: {
  board: JourneyBoardData;
  onFocusTarget: (target: Target, trigger: HTMLElement) => void;
}) {
  const hasAny =
    board.before.length > 0 ||
    board.after.length > 0 ||
    board.unscheduled.length > 0 ||
    board.days.some((day) => day.entries.length > 0);
  if (!hasAny) return null;

  return (
    <section className="voy-journey" aria-labelledby="journey-board-title">
      <div className="voy-journey__head">
        <SectionTitle id="journey-board-title" icon={<RouteIcon />}>
          {t("journey.title")}
        </SectionTitle>
        <p>{t("journey.description")}</p>
        {board.truncated ? (
          <p className="voy-journey__warning" role="status">
            {t("journey.truncated")}
          </p>
        ) : null}
      </div>

      <ol className="voy-journey__days">
        {board.before.length > 0 ? (
          <li className="voy-journey__day voy-journey__day--outside">
            <h3>{t("journey.before")}</h3>
            <EntryList entries={board.before} onFocusTarget={onFocusTarget} />
          </li>
        ) : null}
        {board.days.map((day) => (
          <li className="voy-journey__day" key={day.date}>
            <h3>
              <time dateTime={day.date}>{formatDate(day.date)}</time>
            </h3>
            <EntryList entries={day.entries} onFocusTarget={onFocusTarget} />
          </li>
        ))}
        {board.after.length > 0 ? (
          <li className="voy-journey__day voy-journey__day--outside">
            <h3>{t("journey.after")}</h3>
            <EntryList entries={board.after} onFocusTarget={onFocusTarget} />
          </li>
        ) : null}
        {board.unscheduled.length > 0 ? (
          <li className="voy-journey__day voy-journey__day--outside">
            <h3>{t("journey.unscheduled")}</h3>
            <EntryList
              entries={board.unscheduled}
              onFocusTarget={onFocusTarget}
            />
          </li>
        ) : null}
      </ol>
    </section>
  );
}
