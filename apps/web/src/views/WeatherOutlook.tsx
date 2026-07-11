import { useState } from "react";
import type { AppError, WeatherSnapshot } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDate, formatDateTimeLocal } from "../app/format";
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
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function fetchOutlook() {
    setError(null);
    setFetching(true);
    try {
      const fetched = await gateway.fetchWeather(tripId);
      announce(`Weather outlook for ${fetched.placeName} saved.`);
      onFetched();
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setFetching(false);
    }
  }

  const staleHours = snapshot ? hoursSince(snapshot.retrievedAt) : null;
  const isStale = staleHours !== null && staleHours > STALE_AFTER_HOURS;

  return (
    <section className="voy-weather" aria-labelledby="weather-title">
      <h2 id="weather-title" className="voy-weather__title">
        Weather outlook
      </h2>

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
                ? `Fetched ${staleHours} hours ago — fetch again for current numbers`
                : "Recently fetched"}
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
                      {Math.round(day.precipitationChancePct)}% rain
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {snapshot.coverage === "none" ? (
            <p className="voy-weather__coverage">
              Your trip starts beyond the ~16-day forecast horizon, so no days
              are available yet. Fetch again closer to departure.
            </p>
          ) : snapshot.coverage === "partial" ? (
            <p className="voy-weather__coverage">
              The forecast horizon covers only the first part of your trip.
              Later days will appear as departure gets closer.
            </p>
          ) : null}

          <p className="voy-weather__meta">
            <a
              href={snapshot.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Weather data by Open-Meteo.com
              <span className="voy-sr-only"> (opens in new tab)</span>
            </a>
            <span aria-hidden="true"> · </span>
            CC BY 4.0
            <span aria-hidden="true"> · </span>
            Retrieved {formatStamp(snapshot.retrievedAt)}
          </p>
        </article>
      ) : null}

      <div className="voy-weather__fetch">
        <Button variant="secondary" onClick={fetchOutlook} busy={fetching}>
          {snapshot ? "Fetch again" : "Fetch weather outlook"}
        </Button>
      </div>
      <p className="voy-weather__consent">
        Fetching sends your destination name (“{destination}”) to open-meteo.com
        to place it on the map, then retrieves the forecast. Nothing else about
        your trip leaves this device.
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
