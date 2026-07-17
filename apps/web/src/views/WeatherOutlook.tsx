import type { WeatherSnapshot } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDate, formatDateTimeLocal } from "../app/format";
import { t } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { SectionTitle } from "../components/primitives";
import { CloudSunIcon } from "../components/icons";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

const STALE_AFTER_HOURS = 12;

function hoursSince(iso: string): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 3_600_000);
}

/** "2026-11-01T09:30:00Z" → "Nov 1, 2026 · 09:30" without timezone games. */
function formatStamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!match) return iso;
  return formatDateTimeLocal(`${match[1]}T${match[2]}`);
}

/**
 * Destination weather, fetched only on an explicit click. The consent copy
 * names exactly what leaves the device (the destination name) and where it
 * goes (open-meteo.com). Forecasts reach ~16 days out, so coverage is reported
 * honestly instead of padded. Weather is planning texture, never a safety
 * claim — attribution: "Weather data by Open-Meteo.com" (CC BY 4.0).
 */
export function WeatherOutlook({
  tripId,
  destination,
  snapshot,
  onFetched,
}: {
  tripId: string;
  destination: string;
  snapshot: WeatherSnapshot | undefined;
  onFetched: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fetchAction = useAsyncAction(
    () => gateway.fetchWeather(tripId),
    (fetched) => {
      announce(t("weather.announce.saved", { place: fetched.placeName }));
      onFetched();
    },
  );
  const fetchOutlook = () => fetchAction.run();
  const fetching = fetchAction.busy;
  const error = fetchAction.error;

  const staleHours = snapshot ? hoursSince(snapshot.retrievedAt) : null;
  const isStale = staleHours !== null && staleHours > STALE_AFTER_HOURS;

  return (
    <section className="voy-weather" aria-labelledby="weather-title">
      <SectionTitle id="weather-title" icon={<CloudSunIcon />}>
        {t("weather.title")}
      </SectionTitle>

      {snapshot ? (
        <article className="voy-weather__card">
          <header className="voy-weather__card-head">
            <h3 className="voy-weather__place">
              {snapshot.placeName}
              {snapshot.placeRegion ? (
                <span className="voy-weather__region">
                  {" · "}
                  {snapshot.placeRegion}
                </span>
              ) : null}
            </h3>
            <span
              className={`voy-weather__freshness${isStale ? " voy-weather__freshness--stale" : ""}`}
            >
              {isStale
                ? t("weather.stale", { hours: staleHours as number })
                : t("weather.fresh")}
            </span>
          </header>

          {snapshot.days.length > 0 ? (
            <ul className="voy-weather__days">
              {snapshot.days.map((day) => (
                <li key={day.date} className="voy-weather__day">
                  <span className="voy-weather__day-date">
                    {formatDate(day.date)}
                  </span>
                  <span className="voy-weather__day-desc">
                    {day.description}
                  </span>
                  <span className="voy-weather__day-temps">
                    {Math.round(day.tempMinC)}–{Math.round(day.tempMaxC)}°C
                  </span>
                  {day.precipitationChancePct != null ? (
                    <span className="voy-weather__day-precip">
                      {t("weather.rain", {
                        pct: Math.round(day.precipitationChancePct),
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {snapshot.coverage === "none" ? (
            <p className="voy-weather__coverage">
              {t("weather.coverage.none")}
            </p>
          ) : snapshot.coverage === "partial" ? (
            <p className="voy-weather__coverage">
              {t("weather.coverage.partial")}
            </p>
          ) : null}

          <p className="voy-weather__meta">
            <a
              href={snapshot.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("weather.attribution")}
              <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
            </a>
            <span aria-hidden="true"> · </span>
            CC BY 4.0
            <span aria-hidden="true"> · </span>
            {t("weather.retrieved", {
              stamp: formatStamp(snapshot.retrievedAt),
            })}
          </p>
        </article>
      ) : null}

      <div className="voy-weather__fetch">
        <Button variant="secondary" onClick={fetchOutlook} busy={fetching}>
          {snapshot ? t("weather.fetchAgain") : t("weather.fetch")}
        </Button>
      </div>
      <p className="voy-weather__consent">
        {t("weather.consent", { destination })}
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
