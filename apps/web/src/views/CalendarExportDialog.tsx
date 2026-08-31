import type { CalendarEvent, CalendarSnapshot } from "@voyalier/contracts";

import { formatDateTimeLocal } from "../app/format";
import { plural, t } from "../app/i18n";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";

export function CalendarExportDialog({
  snapshot,
  busy,
  onClose,
  onDownload,
  summary,
}: {
  snapshot: CalendarSnapshot;
  busy: boolean;
  onClose: () => void;
  onDownload: () => void;
  summary: (event: CalendarEvent) => string;
}) {
  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t("action.close")}
      </Button>
      <Button
        variant="primary"
        busy={busy}
        disabled={snapshot.events.length === 0}
        onClick={onDownload}
      >
        {busy ? t("ics.exporting") : t("ics.download")}
      </Button>
    </>
  );
  return (
    <Dialog
      title={t("ics.preview.title")}
      description={t("ics.preview.description")}
      onClose={onClose}
      footer={footer}
    >
      <div className="voy-calendar-preview">
        <Banner tone="info" title={t("ics.preview.limit.title")}>
          {t("ics.preview.limit.body")}
        </Banner>
        <p className="voy-calendar-preview__count">
          {plural("ics.preview.count", snapshot.events.length)}
        </p>
        {snapshot.events.length > 0 ? (
          <section aria-labelledby="calendar-events-title">
            <h3 id="calendar-events-title">{t("ics.preview.events")}</h3>
            <ul className="voy-calendar-preview__events">
              {snapshot.events.map((event) => (
                <li key={event.uid}>
                  <strong>{summary(event)}</strong>
                  <span>{formatDateTimeLocal(event.start)}</span>
                  {event.detail ? <span>{event.detail}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p>{t("ics.preview.empty")}</p>
        )}
        {snapshot.omissions.length > 0 ? (
          <section aria-labelledby="calendar-omissions-title">
            <h3 id="calendar-omissions-title">{t("ics.preview.omissions")}</h3>
            <ul>
              {snapshot.omissions.map((omission, index) => (
                <li key={`${omission.source}:${omission.role}:${index}`}>
                  {omission.title} — {t(`ics.omission.${omission.reason}`)}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p>{t("ics.preview.noOmissions")}</p>
        )}
        {snapshot.removals.length > 0 ? (
          <section aria-labelledby="calendar-removals-title">
            <h3 id="calendar-removals-title">{t("ics.preview.removals")}</h3>
            <ul>
              {snapshot.removals.map((removal) => (
                <li key={removal}>{removal}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
