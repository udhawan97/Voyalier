import { useId, useState } from "react";
import type {
  AppError,
  FcdoCountry,
  TravelAdviceSnapshot,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDateTimeLocal } from "../app/format";
import { useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

const STALE_AFTER_DAYS = 7;

function daysSince(iso: string): number | null {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((Date.now() - parsed) / 86_400_000);
}

/** "2026-06-30T11:02:00.000+01:00" → "Jun 30, 2026 · 11:02" (verbatim wall clock). */
function formatSourceStamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!match) return iso;
  return formatDateTimeLocal(`${match[1]}T${match[2]}`);
}

/**
 * Official travel advice, fetched only on an explicit click (the consent for a
 * single, named, keyless request to www.gov.uk) and shown verbatim with its
 * source, licence, and retrieval time. Voyalier never asserts or clears
 * requirements — the snapshot is the source's own words.
 */
export function TravelAdvice({
  tripId,
  snapshot,
  onFetched,
}: {
  tripId: string;
  snapshot: TravelAdviceSnapshot | undefined;
  onFetched: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const selectId = useId();
  const { data: countries } = useAsyncData<FcdoCountry[]>(
    () => gateway.listAdviceCountries(),
    "advice-countries",
  );
  const [slug, setSlug] = useState("");
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  async function fetchAdvice() {
    if (!slug) return;
    setError(null);
    setFetching(true);
    try {
      const fetched = await gateway.fetchTravelAdvice({
        tripId,
        countrySlug: slug,
      });
      announce(`Official advice for ${fetched.countryName} saved.`);
      onFetched();
    } catch (caught) {
      setError(caught as AppError);
    } finally {
      setFetching(false);
    }
  }

  const staleDays = snapshot ? daysSince(snapshot.retrievedAt) : null;
  const isStale = staleDays !== null && staleDays > STALE_AFTER_DAYS;

  return (
    <section className="voy-advice" aria-labelledby="advice-title">
      <h2 id="advice-title" className="voy-advice__title">
        Official travel advice
      </h2>

      {snapshot ? (
        <article className="voy-advice__card">
          <header className="voy-advice__card-head">
            <h3 className="voy-advice__country">{snapshot.countryName}</h3>
            <span
              className={`voy-advice__freshness${isStale ? " voy-advice__freshness--stale" : ""}`}
            >
              {isStale
                ? `Fetched ${staleDays} days ago — fetch again before you rely on it`
                : "Recently fetched"}
            </span>
          </header>
          {snapshot.alertStatus.length > 0 ? (
            <ul className="voy-advice__alerts">
              {snapshot.alertStatus.map((status) => (
                <li key={status}>{status.split("-").join(" ")}</li>
              ))}
            </ul>
          ) : null}
          {snapshot.summary ? (
            <blockquote className="voy-advice__summary">
              {snapshot.summary}
            </blockquote>
          ) : null}
          {snapshot.changeDescription ? (
            <p className="voy-advice__change">{snapshot.changeDescription}</p>
          ) : null}
          <p className="voy-advice__meta">
            <a
              href={snapshot.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Read the full advice on GOV.UK
              <span className="voy-sr-only"> (opens in new tab)</span>
            </a>
            <span aria-hidden="true"> · </span>
            Retrieved {formatSourceStamp(snapshot.retrievedAt)}
            {snapshot.sourceUpdatedAt ? (
              <>
                <span aria-hidden="true"> · </span>
                Source updated {formatSourceStamp(snapshot.sourceUpdatedAt)}
              </>
            ) : null}
          </p>
          <p className="voy-advice__licence">
            Written for UK passport holders. Contains public sector information
            licensed under the Open Government Licence v3.0.
          </p>
        </article>
      ) : null}

      <div className="voy-advice__fetch">
        <label className="voy-sr-only" htmlFor={selectId}>
          Country to fetch official advice for
        </label>
        <select
          id={selectId}
          className="voy-advice__select"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        >
          <option value="">Choose a country…</option>
          {(countries ?? []).map((country) => (
            <option key={country.slug} value={country.slug}>
              {country.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          onClick={fetchAdvice}
          busy={fetching}
          disabled={!slug}
        >
          {snapshot ? "Fetch again" : "Fetch official advice"}
        </Button>
      </div>
      <p className="voy-advice__consent">
        Fetching contacts www.gov.uk once from this device and stores a dated
        copy locally. Nothing else is sent, and nothing about your trip leaves
        this device.
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
