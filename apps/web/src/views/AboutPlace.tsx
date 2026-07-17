import type { PlaceSummary } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDateTimeLocal } from "../app/format";
import { t } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { FileTextIcon } from "../components/icons";
import { useAsyncAction } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";

/** "2026-07-17T09:30:00Z" → "Jul 17, 2026 · 09:30" without timezone games. */
function formatStamp(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (!match) return iso;
  return formatDateTimeLocal(`${match[1]}T${match[2]}`);
}

/**
 * The "about this place" panel: a short encyclopedia summary of the
 * destination, fetched on an explicit click from Wikipedia. The prose stays
 * Wikipedia's — shown under CC BY-SA with attribution and a link back — never
 * presented as Voyalier's own words or as a safety claim.
 */
export function AboutPlace({
  tripId,
  destination,
  summary,
  onFetched,
}: {
  tripId: string;
  destination: string;
  summary: PlaceSummary | undefined;
  onFetched: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const fetchAction = useAsyncAction(
    () => gateway.fetchPlaceSummary(tripId),
    (fetched) => {
      announce(
        t("about.retrieved", { stamp: formatStamp(fetched.retrievedAt) }),
      );
      onFetched();
    },
  );
  const error = fetchAction.error;

  return (
    <section className="voy-about" aria-labelledby="about-title">
      <SectionTitle id="about-title" icon={<FileTextIcon />}>
        {t("about.title")}
      </SectionTitle>

      {summary ? (
        <div className="voy-about__body">
          {summary.description ? (
            <p className="voy-about__desc">{summary.description}</p>
          ) : null}
          <p className="voy-about__extract">{summary.extract}</p>
          <p className="voy-about__attr">
            {t("about.attribution")}{" "}
            <a href={summary.url} target="_blank" rel="noreferrer noopener">
              {t("about.readMore", { title: summary.title })}
            </a>
          </p>
        </div>
      ) : null}

      <div className="voy-about__fetch">
        <Button
          variant="secondary"
          onClick={() => fetchAction.run()}
          busy={fetchAction.busy}
        >
          {summary ? t("about.fetchAgain") : t("about.fetch")}
        </Button>
      </div>
      <p className="voy-about__consent">
        {t("about.consent", { destination })}
      </p>
      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}
    </section>
  );
}
