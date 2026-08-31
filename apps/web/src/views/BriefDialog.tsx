import { useState } from "react";
import type {
  FactPayload,
  FactType,
  SurfaceJourneyPayload,
  CarRentalPayload,
} from "@voyalier/contracts";

import {
  buildBriefText,
  selectBriefContent,
  type BriefContentMode,
  type BriefTextLabels,
} from "../app/briefText";
import { useAnnounce, useGateway } from "../app/context";
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
import { APP_LOCALE } from "../app/locale";
import { redactedFieldLabel } from "../app/localizedContract";
import { useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { Dialog } from "../components/Dialog";
import { BedIcon, PlaneIcon, RouteIcon } from "../components/icons";
import { Skeleton } from "../components/primitives";

type Values = Record<string, string | undefined>;

function localizedBriefTextLabels(): BriefTextLabels {
  return {
    flights: t("brief.flights"),
    stays: t("brief.stays"),
    journeys: t("brief.journeys"),
    plans: t("brief.plans"),
    journey: t("brief.journey"),
    empty: t("brief.empty"),
    redaction: (fields) =>
      t("brief.redaction", {
        fields: fields
          .map(redactedFieldLabel)
          .join(", ")
          .toLocaleLowerCase(APP_LOCALE),
      }),
  };
}

// Fields already shown in each entry's title/subtitle, so we don't repeat them
// in the detail rows below.
// Rail, coach and ferry read identically: the service names the entry and the
// two places subtitle it.
const SHOWN_IN_JOURNEY_HEADING = [
  "carrierName",
  "serviceNumber",
  "departurePlace",
  "arrivalPlace",
] as const;

const SHOWN_IN_HEADING: Record<FactType, readonly string[]> = {
  flight_segment: [
    "flightNumber",
    "departureAirportIata",
    "arrivalAirportIata",
  ],
  lodging_stay: ["propertyName", "address"],
  rail_journey: SHOWN_IN_JOURNEY_HEADING,
  coach_journey: SHOWN_IN_JOURNEY_HEADING,
  ferry_crossing: SHOWN_IN_JOURNEY_HEADING,
  car_rental: ["carrierName", "departurePlace", "arrivalPlace"],
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

function BriefJourneyEntry({
  payload,
}: {
  payload: SurfaceJourneyPayload | CarRentalPayload;
}) {
  const values = payload as Values;
  const present = [
    "carrierName",
    "vehicleDescription",
    "departureLocal",
    "arrivalLocal",
  ].filter((key) => values[key] != null && values[key] !== "");
  const title =
    values.serviceNumber ??
    values.carrierName ??
    values.vehicleDescription ??
    t("brief.journey");
  const subtitle =
    payload.departurePlace && payload.arrivalPlace
      ? `${payload.departurePlace} → ${payload.arrivalPlace}`
      : (payload.departurePlace ?? payload.arrivalPlace);
  return (
    <article className="voy-brief__entry">
      <span className="voy-brief__entry-icon" aria-hidden="true">
        <RouteIcon />
      </span>
      <div className="voy-brief__entry-body">
        <p className="voy-brief__entry-title">{title}</p>
        {subtitle ? <p className="voy-brief__entry-sub">{subtitle}</p> : null}
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
  const announce = useAnnounce();
  const [contentMode, setContentMode] = useState<BriefContentMode>("full");
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const { status, data, error, reload } = useAsyncData(
    () => gateway.getTripBrief(tripId),
    `brief:${tripId}`,
  );
  const selectedData = data ? selectBriefContent(data, contentMode) : undefined;
  const copyPreview = selectedData
    ? buildBriefText(selectedData, localizedBriefTextLabels())
    : "";

  async function copyBrief() {
    if (!selectedData || !navigator.clipboard) {
      setCopyState("failed");
      return;
    }
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(copyPreview);
      setCopyState("copied");
      announce(t("brief.copy.done"));
    } catch {
      setCopyState("failed");
    }
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t("action.close")}
      </Button>
      <Button
        variant="secondary"
        onClick={() => void copyBrief()}
        disabled={!selectedData}
        busy={copyState === "copying"}
      >
        {copyState === "copied" ? t("brief.copy.done") : t("brief.copy")}
      </Button>
      <Button
        variant="primary"
        onClick={() => window.print()}
        disabled={!selectedData}
      >
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
      ) : selectedData ? (
        <div className="voy-brief-shell">
          <div className="voy-brief__controls">
            <ChoiceGroup
              label={t("brief.scope.label")}
              value={contentMode}
              options={[
                {
                  value: "full",
                  label: t("brief.scope.full"),
                  hint: t("brief.scope.full.hint"),
                },
                {
                  value: "essentials",
                  label: t("brief.scope.essentials"),
                  hint: t("brief.scope.essentials.hint"),
                },
              ]}
              onChange={(value) => {
                setContentMode(value);
                setCopyState("idle");
              }}
            />
            <section
              className="voy-brief__copy-preview"
              aria-labelledby="voy-brief-copy-preview-title"
            >
              <div>
                <h3 id="voy-brief-copy-preview-title">
                  {t("brief.preview.title")}
                </h3>
                <p>{t("brief.preview.hint")}</p>
              </div>
              <textarea
                aria-label={t("brief.preview.label")}
                readOnly
                rows={10}
                value={copyPreview}
              />
            </section>
          </div>
          <div className="voy-brief">
            <header className="voy-brief__head">
              <p className="voy-eyebrow">
                {tripRoute(selectedData.origin, selectedData.destination)}
              </p>
              <h3 className="voy-brief__title">{selectedData.title}</h3>
              <p className="voy-brief__dates">
                {formatDateRange(selectedData.startDate, selectedData.endDate)}
              </p>
            </header>

            {selectedData.flights.length > 0 ? (
              <section
                className="voy-brief__section"
                aria-label={t("brief.flights")}
              >
                <h4 className="voy-brief__section-title">
                  {t("brief.flights")}
                </h4>
                {selectedData.flights.map((flight, index) => (
                  <BriefEntry
                    key={`flight-${index}`}
                    factType="flight_segment"
                    payload={flight}
                  />
                ))}
              </section>
            ) : null}

            {selectedData.stays.length > 0 ? (
              <section
                className="voy-brief__section"
                aria-label={t("brief.stays")}
              >
                <h4 className="voy-brief__section-title">{t("brief.stays")}</h4>
                {selectedData.stays.map((stay, index) => (
                  <BriefEntry
                    key={`stay-${index}`}
                    factType="lodging_stay"
                    payload={stay}
                  />
                ))}
              </section>
            ) : null}

            {selectedData.journeys.length > 0 ? (
              <section
                className="voy-brief__section"
                aria-label={t("brief.journeys")}
              >
                <h4 className="voy-brief__section-title">
                  {t("brief.journeys")}
                </h4>
                {selectedData.journeys.map((journey, index) => (
                  <BriefJourneyEntry
                    key={`journey-${index}`}
                    payload={journey}
                  />
                ))}
              </section>
            ) : null}

            {selectedData.tripItems.length > 0 ? (
              <section
                className="voy-brief__section"
                aria-label={t("brief.plans")}
              >
                <h4 className="voy-brief__section-title">{t("brief.plans")}</h4>
                {selectedData.tripItems.map((item) => (
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

            {selectedData.flights.length === 0 &&
            selectedData.stays.length === 0 &&
            selectedData.journeys.length === 0 &&
            selectedData.tripItems.length === 0 ? (
              <p className="voy-brief__empty">{t("brief.empty")}</p>
            ) : null}

            {selectedData.redactedFields.length > 0 ? (
              <p className="voy-brief__redaction">
                {t("brief.redaction", {
                  fields: selectedData.redactedFields
                    .map(redactedFieldLabel)
                    .join(", ")
                    .toLocaleLowerCase(APP_LOCALE),
                })}
              </p>
            ) : null}
            {copyState === "failed" ? (
              <p className="voy-brief__copy-error" role="status">
                {t("brief.copy.failed")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
