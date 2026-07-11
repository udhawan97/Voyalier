import { useId, useState } from "react";
import type {
  AppError,
  FcdoCountry,
  TravelAdviceSnapshot,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDateTimeLocal } from "../app/format";
import { t } from "../app/i18n";
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
      announce(t("advice.announce.saved", { country: fetched.countryName }));
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
        {t("advice.title")}
      </h2>

      {snapshot ? (
        <article className="voy-advice__card">
          <header className="voy-advice__card-head">
            <h3 className="voy-advice__country">{snapshot.countryName}</h3>
            <span
              className={`voy-advice__freshness${isStale ? " voy-advice__freshness--stale" : ""}`}
            >
              {isStale
                ? t("advice.stale", { days: staleDays as number })
                : t("advice.fresh")}
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
              {t("advice.readMore")}
              <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
            </a>
            <span aria-hidden="true"> · </span>
            {t("advice.retrieved", {
              stamp: formatSourceStamp(snapshot.retrievedAt),
            })}
            {snapshot.sourceUpdatedAt ? (
              <>
                <span aria-hidden="true"> · </span>
                {t("advice.sourceUpdated", {
                  stamp: formatSourceStamp(snapshot.sourceUpdatedAt),
                })}
              </>
            ) : null}
          </p>
          <p className="voy-advice__licence">{t("advice.licence")}</p>
        </article>
      ) : null}

      <div className="voy-advice__fetch">
        <label className="voy-sr-only" htmlFor={selectId}>
          {t("advice.selectLabel")}
        </label>
        <select
          id={selectId}
          className="voy-advice__select"
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        >
          <option value="">{t("advice.chooseCountry")}</option>
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
          {snapshot ? t("advice.fetchAgain") : t("advice.fetch")}
        </Button>
      </div>
      <p className="voy-advice__consent">{t("advice.consent")}</p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
