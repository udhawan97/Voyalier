import { useId, useState } from "react";
import type {
  AdvisoryEntry,
  AdvisoryPanel,
  AdvisorySource,
  FcdoCountry,
  HealthNotice,
  SourceState,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDateTimeLocal } from "../app/format";
import { t } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { GlobeIcon } from "../components/icons";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
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
 * Tone for one card's own badge.
 *
 * Ranks are source-native — a US "Level 2" and a Canadian advisory-state 2 are
 * different claims — so this only ever colours the card it came from, and the
 * panel never sorts or compares by it.
 */
function badgeTone(rank: number | undefined): string {
  if (rank === undefined) return "";
  if (rank >= 3) return " voy-advice__badge--severe";
  if (rank === 2) return " voy-advice__badge--elevated";
  return "";
}

function statusMessage(
  state: SourceState,
  sourceName: string,
): string | null {
  switch (state) {
    case "kept":
      return t("advice.status.kept", { source: sourceName });
    case "unavailable":
      return t("advice.status.unavailable", { source: sourceName });
    case "notPublished":
      return t("advice.status.notPublished", { source: sourceName });
    case "fresh":
      return null;
  }
}

/** The government names, for statuses whose entry is absent from the panel. */
const SOURCE_NAMES: Record<AdvisorySource, string> = {
  "uk-fcdo": "UK Foreign, Commonwealth & Development Office",
  "us-state": "U.S. Department of State",
  "ca-gac": "Government of Canada — Global Affairs Canada",
  "de-aa": "Auswärtiges Amt (Germany)",
};

function AdvisoryCard({ entry }: { entry: AdvisoryEntry }) {
  const staleDays = daysSince(entry.retrievedAt);
  const isStale = staleDays !== null && staleDays > STALE_AFTER_DAYS;
  // The source publishes in its own language and Voyalier does not translate
  // it: without this the browser and any screen reader read it as English.
  const contentLang = entry.language === "en" ? undefined : entry.language;

  return (
    <article className="voy-advice__card">
      <header className="voy-advice__card-head">
        <h3 className="voy-advice__country">{entry.sourceName}</h3>
        <span
          className={`voy-advice__freshness${isStale ? " voy-advice__freshness--stale" : ""}`}
        >
          {isStale
            ? t("advice.stale", { days: staleDays as number })
            : t("advice.fresh")}
        </span>
      </header>

      {entry.levelLabel ? (
        <p
          className={`voy-advice__badge${badgeTone(entry.levelRank)}`}
          lang={contentLang}
        >
          {entry.levelLabel}
        </p>
      ) : null}

      {entry.summary ? (
        <blockquote className="voy-advice__summary" lang={contentLang}>
          {entry.summary}
        </blockquote>
      ) : null}

      {entry.changeDescription ? (
        <p className="voy-advice__change" lang={contentLang}>
          {entry.changeDescription}
        </p>
      ) : null}

      <p className="voy-advice__meta">
        <a href={entry.sourceUrl} target="_blank" rel="noreferrer noopener">
          {t("advice.readMore")}
          <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
        </a>
        <span aria-hidden="true"> · </span>
        {t("advice.retrieved", {
          stamp: formatSourceStamp(entry.retrievedAt),
        })}
        {entry.sourceUpdatedAt ? (
          <>
            <span aria-hidden="true"> · </span>
            {t("advice.sourceUpdated", {
              stamp: formatSourceStamp(entry.sourceUpdatedAt),
            })}
          </>
        ) : null}
      </p>
      <p className="voy-advice__licence">{entry.attribution}</p>
    </article>
  );
}

function HealthNotices({ notices }: { notices: HealthNotice[] }) {
  return (
    <section
      className="voy-advice__notices"
      aria-labelledby="advice-health-title"
    >
      <h3 id="advice-health-title" className="voy-advice__notices-title">
        {t("advice.healthNotices")}
      </h3>
      <ul className="voy-advice__notices-list">
        {notices.map((notice) => (
          <li key={notice.url}>
            <a href={notice.url} target="_blank" rel="noreferrer noopener">
              {notice.title}
              <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
            </a>
            {notice.summary ? <p>{notice.summary}</p> : null}
          </li>
        ))}
      </ul>
      <p className="voy-advice__licence">{t("advice.healthNotices.licence")}</p>
    </section>
  );
}

/**
 * Official travel advice from every government Voyalier can reach, fetched only
 * on an explicit click (the consent for one named set of keyless requests) and
 * shown verbatim: one card per source with its own wording, level scale,
 * language, licence, and retrieval time.
 *
 * Voyalier never asserts, clears, merges, or translates a requirement — each
 * card is that government's own words, and the levels are not comparable across
 * cards. A source that could not be reached says so rather than disappearing.
 */
export function TravelAdvice({
  tripId,
  panel,
  onFetched,
}: {
  tripId: string;
  panel: AdvisoryPanel | undefined;
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
  const fetchAction = useAsyncAction(
    (countrySlug: string) => gateway.fetchAdvisories({ tripId, countrySlug }),
    (fetched) => {
      announce(t("advice.announce.saved", { country: fetched.countryName }));
      onFetched();
    },
  );
  const fetchAdvice = () => {
    if (!slug) return;
    void fetchAction.run(slug);
  };
  const error = fetchAction.error;

  // Statuses annotate; they never gate. A migrated panel carries none, and a
  // fresh source needs no line of its own.
  const statusLines = (panel?.sourceStatus ?? [])
    .map((status) => ({
      source: status.source,
      message: statusMessage(status.state, SOURCE_NAMES[status.source]),
    }))
    .filter((line) => line.message !== null);

  return (
    <section className="voy-advice" aria-labelledby="advice-title">
      <SectionTitle id="advice-title" icon={<GlobeIcon />}>
        {t("advice.title")}
      </SectionTitle>

      {panel ? (
        <>
          <p className="voy-advice__cross-source">{t("advice.crossSource")}</p>
          <div className="voy-advice__cards">
            {panel.entries.map((entry) => (
              <AdvisoryCard key={entry.source} entry={entry} />
            ))}
          </div>

          {statusLines.length > 0 ? (
            <ul className="voy-advice__statuses">
              {statusLines.map((line) => (
                <li key={line.source}>{line.message}</li>
              ))}
            </ul>
          ) : null}

          {panel.healthNotices.length > 0 ? (
            <HealthNotices notices={panel.healthNotices} />
          ) : null}
        </>
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
          busy={fetchAction.busy}
          disabled={!slug}
        >
          {panel ? t("advice.fetchAgain") : t("advice.fetch")}
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
