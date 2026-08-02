import type {
  RecheckChange,
  RecheckLine,
  RecheckReport,
} from "@voyalier/contracts";

import { useState } from "react";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatInstant } from "../app/format";
import { t } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { SectionTitle } from "../components/primitives";
import { SweepIcon } from "../components/icons";
import { SOURCE_NAMES } from "./TravelAdvice";

/**
 * "What changed since I last looked" (ADR-0016 §4).
 *
 * One button. No timer, no toggle, no "keep watching" — the click is the
 * consent, and the sentence above it names the hosts before the click, not
 * after. What comes back is per source, and the three quiet outcomes are all
 * spelled out rather than collapsed into silence: a source that was skipped
 * says so, a source that has never been fetched says so, and a source that
 * failed says so. Only the last is a failure, and none of them is an all-clear.
 */
export function RecheckPanel({
  tripId,
  onChecked,
}: {
  tripId: string;
  onChecked: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [result, setResult] = useState<RecheckReport | undefined>();
  const sweep = useAsyncAction(
    () => gateway.recheckTrip(tripId),
    (report) => {
      setResult(report);
      announce(
        report.lines.some((line) => line.outcome.code === "changed")
          ? t("recheck.announce.changed")
          : t("recheck.announce.quiet"),
      );
      // Anything refreshed is now stored, so the panels above it are stale.
      onChecked();
    },
  );
  const error = sweep.error;

  return (
    <section className="voy-panel voy-recheck" aria-labelledby="recheck-title">
      <SectionTitle id="recheck-title" icon={<SweepIcon />}>
        {t("recheck.title")}
      </SectionTitle>
      <p className="voy-panel__lede">{t("recheck.lede")}</p>
      <p className="voy-panel__note">{t("recheck.consent")}</p>

      <Button
        variant="secondary"
        onClick={() => void sweep.run()}
        busy={sweep.busy}
      >
        {t("recheck.action")}
      </Button>

      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}

      {result ? (
        <>
          <p className="voy-recheck__stamp">
            {t("recheck.checkedAt", { when: formatInstant(result.checkedAt) })}
          </p>
          <ul className="voy-recheck__list">
            {result.lines.map((line) => (
              <li key={line.source} className="voy-recheck__line">
                <span className="voy-recheck__source">
                  {t(`recheck.source.${line.source}`)}
                </span>
                <OutcomeText line={line} />
              </li>
            ))}
          </ul>
          {result.hostsContacted.length > 0 ? (
            <p className="voy-panel__note">
              {t("recheck.hosts", {
                hosts: result.hostsContacted.join(", "),
              })}
            </p>
          ) : (
            <p className="voy-panel__note">{t("recheck.hosts.none")}</p>
          )}
        </>
      ) : null}
    </section>
  );
}

function OutcomeText({ line }: { line: RecheckLine }) {
  const stamp = line.previouslyRetrievedAt
    ? formatInstant(line.previouslyRetrievedAt)
    : undefined;
  switch (line.outcome.code) {
    case "never_fetched":
      return (
        <span className="voy-recheck__outcome">
          {t("recheck.outcome.neverFetched")}
        </span>
      );
    case "skipped":
      return (
        <span className="voy-recheck__outcome">
          {stamp
            ? t("recheck.outcome.skippedSince", { when: stamp })
            : t("recheck.outcome.skipped")}
        </span>
      );
    case "unchanged":
      return (
        <span className="voy-recheck__outcome">
          {t("recheck.outcome.unchanged")}
        </span>
      );
    case "failed":
      return (
        <span className="voy-recheck__outcome voy-recheck__outcome--failed">
          {t("recheck.outcome.failed", { reason: line.outcome.reason })}
        </span>
      );
    case "changed": {
      const changes = line.outcome.changes;
      return (
        <ul className="voy-recheck__changes">
          {changes.map((change, index) => (
            <li key={`${change.code}-${index}`}>{changeText(change)}</li>
          ))}
        </ul>
      );
    }
  }
}

/**
 * Each change reads in the source's own words. Advisory levels are never
 * compared across governments — only against what this same government last
 * said — so the sentence always names which one moved.
 */
function changeText(change: RecheckChange): string {
  switch (change.code) {
    case "advisory_level":
      return t("recheck.change.advisoryLevel", {
        source: SOURCE_NAMES[change.source],
        from: change.from ?? t("recheck.change.noLevel"),
        to: change.to ?? t("recheck.change.noLevel"),
      });
    case "advisory_added":
      return t("recheck.change.advisoryAdded", {
        source: SOURCE_NAMES[change.source],
      });
    case "advisory_withdrawn":
      return t("recheck.change.advisoryWithdrawn", {
        source: SOURCE_NAMES[change.source],
      });
    case "health_notice_added":
      return t("recheck.change.healthAdded", { title: change.title });
    case "health_notice_cleared":
      return t("recheck.change.healthCleared", { title: change.title });
    case "alert_raised":
      return t("recheck.change.alertRaised", { headline: change.headline });
    case "alert_cleared":
      return t("recheck.change.alertCleared", { event: change.event });
    case "forecast_moved":
      return t("recheck.change.forecastMoved", {
        days: String(change.dayCount),
      });
  }
}
