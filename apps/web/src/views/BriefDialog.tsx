import type { FactPayload, FactType } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import {
  describeError,
  factSubtitle,
  factTitle,
  fieldLabel,
  fieldsForType,
  formatDateRange,
  formatDateTimeLocal,
  formatFieldValue,
  tripRoute,
} from "../app/format";
import { t } from "../app/i18n";
import { useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { BedIcon, PlaneIcon } from "../components/icons";
import { Skeleton } from "../components/primitives";

type Values = Record<string, string | undefined>;

// Fields already shown in each entry's title/subtitle, so we don't repeat them
// in the detail rows below.
const SHOWN_IN_HEADING: Record<FactType, readonly string[]> = {
  flight_segment: [
    "flightNumber",
    "departureAirportIata",
    "arrivalAirportIata",
  ],
  lodging_stay: ["propertyName", "address"],
};

function BriefEntry({
  factType,
  payload,
}: {
  factType: FactType;
  payload: FactPayload;
}) {
  const values = payload as Values;
  const heading = SHOWN_IN_HEADING[factType];
  const present = fieldsForType(factType).filter(
    (key) =>
      !heading.includes(key) && values[key] != null && values[key] !== "",
  );
  return (
    <article className="voy-brief__entry">
      <span className="voy-brief__entry-icon" aria-hidden="true">
        {factType === "flight_segment" ? <PlaneIcon /> : <BedIcon />}
      </span>
      <div className="voy-brief__entry-body">
        <p className="voy-brief__entry-title">{factTitle(factType, payload)}</p>
        <p className="voy-brief__entry-sub">
          {factSubtitle(factType, payload)}
        </p>
        <dl className="voy-brief__fields">
          {present.map((key) => (
            <div className="voy-brief__field" key={key}>
              <dt>{fieldLabel(key)}</dt>
              <dd>{formatFieldValue(key, values[key] as string)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

/**
 * A shareable, print-friendly brief. The gateway returns it already redacted by
 * the core, so nothing sensitive is ever in this component's data. "Print /
 * Save as PDF" uses the browser's print pipeline against a print stylesheet
 * that hides the app chrome.
 */
export function BriefDialog({
  tripId,
  onClose,
}: {
  tripId: string;
  onClose: () => void;
}) {
  const gateway = useGateway();
  const { status, data, error, reload } = useAsyncData(
    () => gateway.getTripBrief(tripId),
    `brief:${tripId}`,
  );

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t("action.close")}
      </Button>
      <Button variant="primary" onClick={() => window.print()} disabled={!data}>
        {t("brief.print")}
      </Button>
    </>
  );

  return (
    <Dialog
      title={t("brief.title")}
      onClose={onClose}
      size="lg"
      description={t("brief.description")}
      footer={footer}
    >
      {status === "loading" && !data ? (
        <div aria-busy="true" role="status">
          <span className="voy-sr-only">{t("brief.loading")}</span>
          <Skeleton width="60%" height="1.4rem" />
          <Skeleton width="40%" />
        </div>
      ) : status === "error" && !data ? (
        <Banner
          tone="error"
          role="alert"
          title={describeError(error!).title}
          action={
            <Button variant="secondary" onClick={reload}>
              {t("action.retry")}
            </Button>
          }
        >
          {describeError(error!).body}
        </Banner>
      ) : data ? (
        <div className="voy-brief">
          <header className="voy-brief__head">
            <p className="voy-eyebrow">
              {tripRoute(data.origin, data.destination)}
            </p>
            <h3 className="voy-brief__title">{data.title}</h3>
            <p className="voy-brief__dates">
              {formatDateRange(data.startDate, data.endDate)}
            </p>
          </header>

          {data.flights.length > 0 ? (
            <section
              className="voy-brief__section"
              aria-label={t("brief.flights")}
            >
              <h4 className="voy-brief__section-title">{t("brief.flights")}</h4>
              {data.flights.map((flight, index) => (
                <BriefEntry
                  key={`flight-${index}`}
                  factType="flight_segment"
                  payload={flight}
                />
              ))}
            </section>
          ) : null}

          {data.stays.length > 0 ? (
            <section
              className="voy-brief__section"
              aria-label={t("brief.stays")}
            >
              <h4 className="voy-brief__section-title">{t("brief.stays")}</h4>
              {data.stays.map((stay, index) => (
                <BriefEntry
                  key={`stay-${index}`}
                  factType="lodging_stay"
                  payload={stay}
                />
              ))}
            </section>
          ) : null}

          {data.tripItems.length > 0 ? (
            <section
              className="voy-brief__section"
              aria-label={t("brief.plans")}
            >
              <h4 className="voy-brief__section-title">{t("brief.plans")}</h4>
              {data.tripItems.map((item) => (
                <article className="voy-brief__entry" key={item.id}>
                  <div className="voy-brief__entry-body">
                    <p className="voy-brief__entry-title">{item.title}</p>
                    {item.location ? (
                      <p className="voy-brief__entry-sub">{item.location}</p>
                    ) : null}
                    {item.startAt ? (
                      <p className="voy-brief__entry-sub">
                        {formatDateTimeLocal(item.startAt)}
                        {item.endAt
                          ? ` – ${formatDateTimeLocal(item.endAt)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>
          ) : null}

          {data.flights.length === 0 &&
          data.stays.length === 0 &&
          data.tripItems.length === 0 ? (
            <p className="voy-brief__empty">{t("brief.empty")}</p>
          ) : null}

          {data.redactedFields.length > 0 ? (
            <p className="voy-brief__redaction">
              {t("brief.redaction", {
                fields: data.redactedFields.join(", ").toLowerCase(),
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
