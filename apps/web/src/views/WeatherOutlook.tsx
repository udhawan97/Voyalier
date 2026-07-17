import type {
  AirQualityDay,
  ClimateNormals,
  PackingSuggestion,
  WeatherAlert,
  WeatherSnapshot,
} from "@voyalier/contracts";

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

/** UV and air-quality chips for one day; silent when the readings are absent. */
function AirChips({ day }: { day: AirQualityDay | undefined }) {
  if (!day) return null;
  return (
    <>
      {day.uvIndexMax != null ? (
        <span className="voy-weather__day-uv">
          {t("weather.uv", { value: day.uvIndexMax })}
        </span>
      ) : null}
      {day.usAqiMax != null ? (
        <span className="voy-weather__day-aqi">
          {t("weather.aqi", { value: day.usAqiMax })}
        </span>
      ) : null}
    </>
  );
}

/**
 * What these dates have usually been like here.
 *
 * Always renders the sample behind the averages: "typically 4–16°C" means
 * nothing without knowing whether it rests on four days or four hundred, and
 * this is history, not a forecast.
 */
function Normals({ normals }: { normals: ClimateNormals }) {
  return (
    <div className="voy-weather__normals">
      <h4 className="voy-weather__normals-title">
        {t("weather.normals.title")}
      </h4>
      <p className="voy-weather__normals-range">
        {t("weather.normals.range", {
          low: Math.round(normals.avgLowC),
          high: Math.round(normals.avgHighC),
        })}
        <span aria-hidden="true"> · </span>
        {t("weather.normals.wet", { pct: Math.round(normals.wetDaySharePct) })}
      </p>
      <p className="voy-weather__normals-sample">
        {t("weather.normals.sample", {
          days: normals.sampleDays,
          years: normals.yearsSampled,
          from: normals.firstYear,
          to: normals.lastYear,
        })}
        <span aria-hidden="true"> · </span>
        {t("weather.normals.extremes", {
          coldest: Math.round(normals.coldestLowC),
          warmest: Math.round(normals.warmestHighC),
        })}
      </p>
    </div>
  );
}

/** Official alerts, verbatim and linked. Voyalier never summarizes one. */
function Alerts({ alerts }: { alerts: WeatherAlert[] }) {
  return (
    <section
      className="voy-weather__alerts"
      aria-labelledby="weather-alerts-title"
    >
      <h4 id="weather-alerts-title" className="voy-weather__alerts-title">
        {t("weather.alerts.title")}
      </h4>
      <ul className="voy-weather__alerts-list">
        {alerts.map((alert) => (
          <li
            key={alert.url}
            className={`voy-weather__alert voy-weather__alert--${alert.severity.toLowerCase()}`}
          >
            <a href={alert.url} target="_blank" rel="noreferrer noopener">
              {alert.headline || alert.event}
              <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
            </a>
            {alert.area ? (
              <p>{t("weather.alerts.area", { area: alert.area })}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="voy-weather__licence">{t("weather.alerts.attribution")}</p>
    </section>
  );
}

/**
 * Packing suggestions and the reading behind each one.
 *
 * The core sends codes and numbers; these are the words. Showing the reason
 * beside the suggestion is the point — it makes the advice checkable instead
 * of something the app just asserts.
 */
function PackingList({ list }: { list: PackingSuggestion[] }) {
  return (
    <section className="voy-weather__packing" aria-labelledby="packing-title">
      <h4 id="packing-title" className="voy-weather__packing-title">
        {t("packing.title")}
      </h4>
      <p className="voy-weather__packing-intro">{t("packing.intro")}</p>
      <ul className="voy-weather__packing-list">
        {list.map((item) => (
          <li key={item.code}>
            <span className="voy-weather__packing-what">
              {t(`packing.${item.code}`)}
            </span>
            <span className="voy-weather__packing-why">
              {t(`packing.reason.${item.reason.code}`, {
                value: item.reason.value ?? 0,
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
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
  packingList,
  onFetched,
}: {
  tripId: string;
  destination: string;
  snapshot: WeatherSnapshot | undefined;
  packingList: PackingSuggestion[];
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
  const airByDate = new Map(
    (snapshot?.airQuality ?? []).map((day) => [day.date, day]),
  );

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

          {snapshot.normals ? <Normals normals={snapshot.normals} /> : null}

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
                  <AirChips day={airByDate.get(day.date)} />
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
          {snapshot.alerts.length > 0 ? (
            <Alerts alerts={snapshot.alerts} />
          ) : null}
        </article>
      ) : null}

      {packingList.length > 0 ? <PackingList list={packingList} /> : null}

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
