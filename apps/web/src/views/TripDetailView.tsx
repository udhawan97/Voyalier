import { useState } from "react";
import type {
  AppError,
  CandidateFact,
  ConfirmedFact,
  ItineraryConflict,
  ReadinessStatus,
  ReadinessSummary,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import {
  describeError,
  factSubtitle,
  factTitle,
  fieldLabel,
  fieldsForType,
  formatDateRange,
  formatFieldValue,
  pluralize,
  tripRoute,
} from "../app/format";
import { useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import {
  AlertIcon,
  ArchiveIcon,
  ArrowLeftIcon,
  BedIcon,
  CheckIcon,
  ChevronRightIcon,
  DotIcon,
  PlaneIcon,
  PlusIcon,
  RetryIcon,
} from "../components/icons";
import {
  CountBadge,
  Empty,
  MethodChip,
  Skeleton,
  TripStatusBadge,
} from "../components/primitives";
import { AddFactDialog } from "./AddFactDialog";
import { BriefDialog } from "./BriefDialog";
import { CandidateReviewDialog } from "./CandidateReviewDialog";
import { AiProviders } from "./AiProviders";
import { AssistPreview } from "./AssistPreview";
import { CityPacks } from "./CityPacks";
import { DeleteTripDialog } from "./DeleteTripDialog";
import { ImportDialog } from "./ImportDialog";
import { OnDeviceAi } from "./OnDeviceAi";
import { TravelAdvice } from "./TravelAdvice";
import { TripSearch } from "./TripSearch";
import { WeatherOutlook } from "./WeatherOutlook";

type Values = Record<string, string | undefined>;

/** Itinerary order: by a wall-clock field, undated last. Lexicographic is safe. */
function byField(key: string) {
  return (a: ConfirmedFact, b: ConfirmedFact) => {
    const av = (a.payload as Values)[key] ?? "￿";
    const bv = (b.payload as Values)[key] ?? "￿";
    return av < bv ? -1 : av > bv ? 1 : 0;
  };
}

function FactCard({
  fact,
  onUnconfirm,
  unconfirming,
}: {
  fact: ConfirmedFact;
  onUnconfirm: (fact: ConfirmedFact) => void;
  unconfirming: boolean;
}) {
  const values = fact.payload as Values;
  const present = fieldsForType(fact.factType).filter(
    (key) => values[key] != null && values[key] !== "",
  );
  return (
    <article className="voy-fact">
      <div className="voy-fact__head">
        <span className="voy-fact__icon" aria-hidden="true">
          {fact.factType === "flight_segment" ? <PlaneIcon /> : <BedIcon />}
        </span>
        <div className="voy-fact__heading">
          <p className="voy-fact__title">
            {factTitle(fact.factType, fact.payload)}
          </p>
          <p className="voy-fact__sub">
            {factSubtitle(fact.factType, fact.payload)}
          </p>
        </div>
        <MethodChip method={fact.method} />
      </div>
      <dl className="voy-fact__fields">
        {present.map((key) => (
          <div className="voy-fact__field" key={key}>
            <dt>{fieldLabel(key)}</dt>
            <dd>{formatFieldValue(key, values[key] as string)}</dd>
          </div>
        ))}
      </dl>
      {fact.correctedFields.length > 0 ? (
        <p className="voy-fact__edited">
          Edited before confirming:{" "}
          {fact.correctedFields.map((path) => fieldLabel(path)).join(", ")}
        </p>
      ) : null}
      <div className="voy-fact__actions">
        <Button
          variant="ghost"
          onClick={() => onUnconfirm(fact)}
          busy={unconfirming}
        >
          Unconfirm
        </Button>
      </div>
    </article>
  );
}

function FactGroup({
  title,
  icon,
  facts,
  onUnconfirm,
  unconfirmingId,
}: {
  title: string;
  icon: React.ReactNode;
  facts: ConfirmedFact[];
  onUnconfirm: (fact: ConfirmedFact) => void;
  unconfirmingId: string | null;
}) {
  if (facts.length === 0) return null;
  return (
    <section className="voy-factgroup" aria-label={title}>
      <h3 className="voy-factgroup__title">
        <span className="voy-factgroup__icon" aria-hidden="true">
          {icon}
        </span>
        {title}
        <span className="voy-factgroup__count">{facts.length}</span>
      </h3>
      <div className="voy-factgroup__list">
        {facts.map((fact) => (
          <FactCard
            key={fact.id}
            fact={fact}
            onUnconfirm={onUnconfirm}
            unconfirming={unconfirmingId === fact.id}
          />
        ))}
      </div>
    </section>
  );
}

const READINESS_LABEL: Record<ReadinessStatus, string> = {
  not_checked: "Not started",
  clear: "On track",
  monitor: "Worth a look",
  action_needed: "Needs attention",
  critical: "Critical",
};

/**
 * Deterministic plan-completeness rollup plus a link-only entry-requirements
 * reference. Status is always spelled out in words, never conveyed by color
 * alone; the entry item reads "Check yourself" because Voyalier never asserts
 * or clears entry rules.
 */
function ReadinessPanel({ readiness }: { readiness: ReadinessSummary }) {
  return (
    <section className="voy-readiness" aria-labelledby="readiness-title">
      <div className="voy-readiness__head">
        <h2 id="readiness-title" className="voy-readiness__title">
          Readiness
        </h2>
        <span
          className={`voy-readiness__overall voy-readiness__overall--${readiness.status}`}
        >
          {READINESS_LABEL[readiness.status]}
        </span>
      </div>
      <ul className="voy-readiness__list">
        {readiness.items.map((item) => (
          <li key={item.id} className="voy-readiness__item">
            <span
              className={`voy-readiness__dot voy-readiness__dot--${item.status}`}
              aria-hidden="true"
            >
              <DotIcon />
            </span>
            <span className="voy-readiness__body">
              <span className="voy-readiness__item-title">
                {item.title}
                <span className="voy-readiness__item-status">
                  {" · "}
                  {item.id === "entry_requirements"
                    ? "Check yourself"
                    : READINESS_LABEL[item.status]}
                </span>
              </span>
              <span className="voy-readiness__detail">{item.detail}</span>
              {item.links && item.links.length > 0 ? (
                <ul className="voy-readiness__links">
                  {item.links.map((link) => (
                    <li key={link.url}>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {link.label}
                        <span className="voy-sr-only"> (opens in new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="voy-readiness__scope">
        Plan completeness plus official starting points. Voyalier never asserts
        or clears entry, health, or safety requirements — sourced, dated
        readiness arrives in a later milestone.
      </p>
    </section>
  );
}

/**
 * Deterministic, advisory schedule review over the confirmed itinerary.
 * Severity is always carried by the text badge, never by color/icon alone.
 */
function ScheduleCheck({ conflicts }: { conflicts: ItineraryConflict[] }) {
  if (conflicts.length === 0) {
    return (
      <section className="voy-schedule" aria-labelledby="schedule-title">
        <h2 id="schedule-title" className="voy-schedule__title">
          Schedule check
        </h2>
        <p className="voy-schedule__clear">
          <span className="voy-schedule__clear-icon" aria-hidden="true">
            <CheckIcon />
          </span>
          No schedule conflicts found in your confirmed plans.
        </p>
      </section>
    );
  }
  return (
    <section className="voy-schedule" aria-labelledby="schedule-title">
      <h2 className="voy-schedule__title">
        <span id="schedule-title">Schedule check</span>
        <span className="voy-schedule__count">{conflicts.length}</span>
      </h2>
      <ul className="voy-schedule__list">
        {conflicts.map((conflict) => (
          <li
            key={`${conflict.kind}:${conflict.factIds.join(",")}:${conflict.startDate ?? ""}`}
            className={`voy-schedule__item voy-schedule__item--${conflict.severity}`}
          >
            <span className="voy-schedule__icon" aria-hidden="true">
              <AlertIcon />
            </span>
            <span className="voy-schedule__text">
              <span className="voy-schedule__badge">
                {conflict.severity === "warning" ? "Conflict" : "Notice"}
              </span>
              {conflict.message}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TripDetailView({
  tripId,
  onBack,
  onDeleted,
  reloadKey,
}: {
  tripId: string;
  onBack: () => void;
  onDeleted: () => void;
  reloadKey: number;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const { status, data, error, reload } = useAsyncData(async () => {
    const [detail, pending] = await Promise.all([
      gateway.getTrip(tripId),
      gateway.listCandidates(tripId, "pending"),
    ]);
    return { detail, pending };
  }, `trip:${tripId}:${reloadKey}`);

  const [showImport, setShowImport] = useState(false);
  const [showAddFact, setShowAddFact] = useState(false);
  // Holds the exact candidates to review (from the pending list or a fresh
  // import) so the dialog never depends on an in-flight refetch settling first.
  const [reviewCandidates, setReviewCandidates] = useState<
    CandidateFact[] | null
  >(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [unconfirmingId, setUnconfirmingId] = useState<string | null>(null);

  async function archive() {
    setArchiving(true);
    try {
      await gateway.archiveTrip(tripId);
      announce("Trip archived.");
      reload();
    } catch (caught) {
      announce(describeError(caught as AppError).title);
    } finally {
      setArchiving(false);
    }
  }

  async function unconfirm(fact: ConfirmedFact) {
    setUnconfirmingId(fact.id);
    try {
      await gateway.unconfirmFact(fact.id);
      announce(
        `${factTitle(fact.factType, fact.payload)} moved back to review.`,
      );
      reload();
    } catch (caught) {
      announce(describeError(caught as AppError).title);
    } finally {
      setUnconfirmingId(null);
    }
  }

  const backButton = (
    <button type="button" className="voy-back" onClick={onBack}>
      <ArrowLeftIcon aria-hidden="true" />
      <span>All trips</span>
    </button>
  );

  if (status === "loading" && !data) {
    return (
      <section className="voy-detail" aria-busy="true" role="status">
        <span className="voy-sr-only">Loading trip…</span>
        {backButton}
        <div className="voy-detail__head">
          <Skeleton width="40%" height="2.4rem" />
          <Skeleton width="24%" />
        </div>
        <div className="voy-factgroup__list">
          <article className="voy-fact voy-fact--skeleton">
            <Skeleton width="50%" height="1.2rem" />
            <Skeleton width="70%" />
            <Skeleton width="60%" />
          </article>
        </div>
      </section>
    );
  }

  if (status === "error" && !data) {
    return (
      <section className="voy-detail">
        {backButton}
        <Banner
          tone="error"
          role="alert"
          title={describeError(error!).title}
          action={
            error!.code === "trip/not_found" ? (
              <Button variant="secondary" onClick={onBack}>
                Back to trips
              </Button>
            ) : (
              <Button variant="secondary" icon={<RetryIcon />} onClick={reload}>
                Retry
              </Button>
            )
          }
        >
          {describeError(error!).body}
        </Banner>
      </section>
    );
  }

  if (!data) return null;

  const { trip, confirmedFacts, itineraryConflicts, readiness } = data.detail;
  const pending = data.pending;
  const pendingCount = data.detail.pendingCandidateCount;
  const flights = confirmedFacts
    .filter((fact) => fact.factType === "flight_segment")
    .sort(byField("departureLocal"));
  const stays = confirmedFacts
    .filter((fact) => fact.factType === "lodging_stay")
    .sort(byField("checkinDate"));
  const isArchived = trip.status === "archived";

  return (
    <section className="voy-detail" aria-labelledby="detail-heading">
      {backButton}

      <header className="voy-detail__head">
        <div className="voy-detail__headmain">
          <p className="voy-eyebrow">
            {tripRoute(trip.origin, trip.destination)}
          </p>
          <h1 id="detail-heading">{trip.title}</h1>
          <p className="voy-detail__dates">
            {formatDateRange(trip.startDate, trip.endDate)}
            <span aria-hidden="true"> · </span>
            <span className="voy-sr-only">Status: </span>
            <TripStatusBadge status={trip.status} />
          </p>
        </div>
        <div className="voy-detail__actions">
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => setShowImport(true)}
          >
            Import
          </Button>
          <Button variant="secondary" onClick={() => setShowAddFact(true)}>
            Add a fact
          </Button>
          {confirmedFacts.length > 0 ? (
            <Button variant="ghost" onClick={() => setShowBrief(true)}>
              Share brief
            </Button>
          ) : null}
          {!isArchived ? (
            <Button
              variant="ghost"
              icon={<ArchiveIcon />}
              onClick={archive}
              busy={archiving}
            >
              Archive
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setShowDelete(true)}>
            Delete
          </Button>
        </div>
      </header>

      {pendingCount > 0 ? (
        <button
          type="button"
          className="voy-pending-entry"
          onClick={() => setReviewCandidates(pending)}
        >
          <CountBadge
            count={pendingCount}
            label={`pending ${pluralize(pendingCount, "suggestion")}`}
          />
          <span className="voy-pending-entry__text">
            <strong>
              Review {pendingCount} {pluralize(pendingCount, "suggestion")}
            </strong>
            <span>
              Confirm or dismiss what Voyalier found in your documents.
            </span>
          </span>
          <ChevronRightIcon aria-hidden="true" />
        </button>
      ) : (
        <p className="voy-detail__nopending">
          No suggestions waiting. Import a document to find more.
        </p>
      )}

      <div className="voy-detail__blueprint">
        <h2 className="voy-detail__blueprint-title">Blueprint</h2>
        {confirmedFacts.length === 0 ? (
          <Empty
            title="Your Blueprint is empty"
            action={
              <div className="voy-empty__actions">
                <Button
                  variant="primary"
                  icon={<PlusIcon />}
                  onClick={() => setShowImport(true)}
                >
                  Import a document
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowAddFact(true)}
                >
                  Add a fact
                </Button>
              </div>
            }
          >
            Confirmed flights and stays land here in itinerary order. Import a
            confirmation or add a fact by hand to begin.
          </Empty>
        ) : (
          <>
            <FactGroup
              title="Flights"
              icon={<PlaneIcon />}
              facts={flights}
              onUnconfirm={unconfirm}
              unconfirmingId={unconfirmingId}
            />
            <FactGroup
              title="Stays"
              icon={<BedIcon />}
              facts={stays}
              onUnconfirm={unconfirm}
              unconfirmingId={unconfirmingId}
            />
          </>
        )}
      </div>

      {confirmedFacts.length > 0 || pendingCount > 0 ? (
        <ReadinessPanel readiness={readiness} />
      ) : null}

      {confirmedFacts.length > 0 ? (
        <ScheduleCheck conflicts={itineraryConflicts} />
      ) : null}

      <TravelAdvice
        tripId={tripId}
        snapshot={data.detail.travelAdvice}
        onFetched={() => reload()}
      />

      <WeatherOutlook
        tripId={tripId}
        destination={trip.destination}
        snapshot={data.detail.weather}
        onFetched={() => reload()}
      />

      <TripSearch tripId={tripId} />

      <OnDeviceAi />

      <AiProviders />

      <AssistPreview tripId={tripId} />

      <CityPacks />

      {showImport ? (
        <ImportDialog
          tripId={tripId}
          onClose={() => setShowImport(false)}
          onImported={() => reload()}
          onReview={(candidates) => {
            setShowImport(false);
            setReviewCandidates(candidates);
            reload();
          }}
        />
      ) : null}

      {showAddFact ? (
        <AddFactDialog
          tripId={tripId}
          onClose={() => setShowAddFact(false)}
          onAdded={(fact) => {
            setShowAddFact(false);
            announce(`${factTitle(fact.factType, fact.payload)} added.`);
            reload();
          }}
        />
      ) : null}

      {reviewCandidates ? (
        <CandidateReviewDialog
          candidates={reviewCandidates}
          onClose={() => setReviewCandidates(null)}
          onResolved={() => reload()}
        />
      ) : null}

      {showDelete ? (
        <DeleteTripDialog
          trip={trip}
          onClose={() => setShowDelete(false)}
          onDeleted={onDeleted}
        />
      ) : null}

      {showBrief ? (
        <BriefDialog tripId={tripId} onClose={() => setShowBrief(false)} />
      ) : null}
    </section>
  );
}
