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
  tripRoute,
} from "../app/format";
import { buildIcs, icsFilename } from "../app/ics";
import { plural, t, type MessageKey } from "../app/i18n";
import { useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { DeferredSection } from "../components/DeferredSection";
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
import { DocumentsPanel } from "./DocumentsPanel";
import { TripNotes } from "./TripNotes";
import { TodayPanel } from "./TodayPanel";
import { AssistPreview } from "./AssistPreview";
import { AssistDraft } from "./AssistDraft";
import { CityPacks } from "./CityPacks";
import { MapPanel } from "./MapPanel";
import { Recommendations } from "./Recommendations";
import { DeleteTripDialog } from "./DeleteTripDialog";
import { EditTripDialog } from "./EditTripDialog";
import { ImportDialog } from "./ImportDialog";
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
          {t("detail.edited", {
            fields: fact.correctedFields
              .map((path) => fieldLabel(path))
              .join(", "),
          })}
        </p>
      ) : null}
      {/* The traveler deleted the document this came from. Say so, rather than
          let it pass as something they typed in by hand. */}
      {fact.sourceRemoved ? (
        <p className="voy-fact__sourceless">{t("documents.sourceRemoved")}</p>
      ) : null}
      <div className="voy-fact__actions">
        {/* No candidate means there is nothing to return the fact to, so
            unconfirming destroys it — guard that behind a two-step confirm. That
            covers both a hand-typed fact and one whose source document was
            deleted. Returning an imported fact to review is reversible, so it
            stays a plain click. */}
        {fact.candidateId === null ? (
          <ConfirmButton
            label={t("detail.remove")}
            onConfirm={() => onUnconfirm(fact)}
            busy={unconfirming}
          />
        ) : (
          <Button
            variant="ghost"
            onClick={() => onUnconfirm(fact)}
            busy={unconfirming}
          >
            {t("detail.unconfirm")}
          </Button>
        )}
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

/**
 * A sticky row of jump links for the long trip page.
 *
 * The targets are the section *wrappers*, not the headings inside them: those
 * sections are deferred, so their headings do not exist until the section
 * mounts, and a chip pointing at one would do nothing. A wrapper is always
 * there, and jumping to it is what brings the section in. `scroll-margin-top` in
 * CSS keeps the landing spot clear of the sticky nav. Plain anchors — no router,
 * so refresh and back behave exactly as they did.
 */
const TRIP_NAV: { label: MessageKey; target: string }[] = [
  { label: "tripnav.plan", target: "section-plan" },
  { label: "tripnav.prepare", target: "section-prepare" },
  { label: "tripnav.discover", target: "section-discover" },
  { label: "tripnav.ai", target: "section-ai" },
];

function TripSectionNav() {
  return (
    <nav className="voy-tripnav" aria-label={t("tripnav.label")}>
      {TRIP_NAV.map((item) => (
        <a
          key={item.target}
          className="voy-tripnav__chip"
          href={`#${item.target}`}
        >
          {t(item.label)}
        </a>
      ))}
    </nav>
  );
}

const READINESS_LABEL: Record<ReadinessStatus, MessageKey> = {
  not_checked: "readiness.label.not_checked",
  clear: "readiness.label.clear",
  monitor: "readiness.label.monitor",
  action_needed: "readiness.label.action_needed",
  critical: "readiness.label.critical",
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
          {t("readiness.title")}
        </h2>
        <span
          className={`voy-readiness__overall voy-readiness__overall--${readiness.status}`}
        >
          {t(READINESS_LABEL[readiness.status])}
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
                  {item.id === "entry_requirements" ||
                  item.id === "health_notices"
                    ? t("readiness.checkYourself")
                    : t(READINESS_LABEL[item.status])}
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
                        <span className="voy-sr-only">
                          {t("a11y.opensInNewTab")}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="voy-readiness__scope">{t("readiness.scope")}</p>
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
          {t("schedule.title")}
        </h2>
        <p className="voy-schedule__clear">
          <span className="voy-schedule__clear-icon" aria-hidden="true">
            <CheckIcon />
          </span>
          {t("schedule.clear")}
        </p>
      </section>
    );
  }
  return (
    <section className="voy-schedule" aria-labelledby="schedule-title">
      <h2 className="voy-schedule__title">
        <span id="schedule-title">{t("schedule.title")}</span>
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
                {conflict.severity === "warning"
                  ? t("schedule.conflict")
                  : t("schedule.notice")}
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
  onOpenSettings,
  reloadKey,
}: {
  tripId: string;
  onBack: () => void;
  onDeleted: () => void;
  onOpenSettings?: () => void;
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

  const [exporting, setExporting] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAddFact, setShowAddFact] = useState(false);
  // Holds the exact candidates to review (from the pending list or a fresh
  // import) so the dialog never depends on an in-flight refetch settling first.
  const [reviewCandidates, setReviewCandidates] = useState<
    CandidateFact[] | null
  >(null);
  const [showDelete, setShowDelete] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [unarchiving, setUnarchiving] = useState(false);
  const [unconfirmingId, setUnconfirmingId] = useState<string | null>(null);

  /**
   * Save the trip as an .ics file. Everything happens on this device: the brief
   * is built by the local core, turned into calendar text here, and handed to
   * the browser as a blob. Nothing is uploaded, and no calendar is contacted.
   *
   * It exports the *brief*, not the raw facts, so the Rust core's
   * generation-time exclusion of confirmation codes and traveler names carries
   * into the file — a .ics usually ends up in a synced cloud calendar.
   */
  async function exportCalendar() {
    setExporting(true);
    try {
      const brief = await gateway.getTripBrief(tripId);
      const ics = buildIcs(brief, {
        flightSummary: (flight) => t("ics.summary.flight", { flight }),
        staySummary: (property) => t("ics.summary.stay", { property }),
        description: t("ics.description"),
      });
      const url = URL.createObjectURL(
        new Blob([ics], { type: "text/calendar;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = icsFilename(brief.title);
      anchor.click();
      // Release the blob once the click has been handled.
      URL.revokeObjectURL(url);
      announce(t("ics.done"));
    } catch (caught) {
      announce(describeError(caught as AppError).title || t("ics.error"));
    } finally {
      setExporting(false);
    }
  }

  async function archive() {
    setArchiving(true);
    try {
      await gateway.archiveTrip(tripId);
      announce(t("detail.announce.archived"));
      reload();
    } catch (caught) {
      announce(describeError(caught as AppError).title);
    } finally {
      setArchiving(false);
    }
  }

  async function unarchive() {
    setUnarchiving(true);
    try {
      await gateway.unarchiveTrip(tripId);
      announce(t("detail.announce.unarchived"));
      reload();
    } catch (caught) {
      announce(describeError(caught as AppError).title);
    } finally {
      setUnarchiving(false);
    }
  }

  async function unconfirm(fact: ConfirmedFact) {
    setUnconfirmingId(fact.id);
    try {
      await gateway.unconfirmFact(fact.id);
      const title = factTitle(fact.factType, fact.payload);
      announce(
        fact.candidateId === null
          ? t("detail.announce.removed", { fact: title })
          : t("detail.announce.unconfirmed", { fact: title }),
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
      <span>{t("detail.back")}</span>
    </button>
  );

  if (status === "loading" && !data) {
    return (
      <section className="voy-detail" aria-busy="true" role="status">
        <span className="voy-sr-only">{t("detail.loading")}</span>
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
                {t("detail.backToTrips")}
              </Button>
            ) : (
              <Button variant="secondary" icon={<RetryIcon />} onClick={reload}>
                {t("action.retry")}
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
            <span className="voy-sr-only">{t("detail.status")}</span>
            <TripStatusBadge status={trip.status} />
          </p>
        </div>
        <div className="voy-detail__actions">
          <Button
            variant="primary"
            icon={<PlusIcon />}
            onClick={() => setShowImport(true)}
          >
            {t("detail.import")}
          </Button>
          <Button variant="secondary" onClick={() => setShowAddFact(true)}>
            {t("detail.addFact")}
          </Button>
          <Button variant="ghost" onClick={() => setShowEdit(true)}>
            {t("detail.edit")}
          </Button>
          {confirmedFacts.length > 0 ? (
            <Button variant="ghost" onClick={() => setShowBrief(true)}>
              {t("detail.shareBrief")}
            </Button>
          ) : null}
          {/* Same gate as the brief: nothing confirmed, nothing to export. */}
          {confirmedFacts.length > 0 ? (
            <Button variant="ghost" onClick={exportCalendar} busy={exporting}>
              {exporting ? t("ics.exporting") : t("ics.export")}
            </Button>
          ) : null}
          {isArchived ? (
            <Button variant="ghost" onClick={unarchive} busy={unarchiving}>
              {t("detail.unarchive")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              icon={<ArchiveIcon />}
              onClick={archive}
              busy={archiving}
            >
              {t("detail.archive")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setShowDelete(true)}>
            {t("detail.delete")}
          </Button>
        </div>
      </header>

      <TripSectionNav />

      <TodayPanel tripId={tripId} />

      {pendingCount > 0 ? (
        <button
          type="button"
          className="voy-pending-entry"
          onClick={() => setReviewCandidates(pending)}
        >
          <CountBadge
            count={pendingCount}
            label={plural("tripcard.pending", pendingCount)}
          />
          <span className="voy-pending-entry__text">
            <strong>{plural("import.review", pendingCount)}</strong>
            <span>{t("detail.pending.desc")}</span>
          </span>
          <ChevronRightIcon aria-hidden="true" />
        </button>
      ) : (
        <p className="voy-detail__nopending">{t("detail.nopending")}</p>
      )}

      <div className="voy-detail__blueprint" id="section-plan">
        <h2 id="blueprint-title" className="voy-detail__blueprint-title">
          {t("detail.blueprint")}
        </h2>
        {confirmedFacts.length > 0 ? (
          <p className="voy-detail__blueprint-sub">
            {t("detail.blueprint.sub")}
          </p>
        ) : null}
        {confirmedFacts.length === 0 ? (
          <Empty
            title={t("detail.empty.title")}
            action={
              <div className="voy-empty__actions">
                <Button
                  variant="primary"
                  icon={<PlusIcon />}
                  onClick={() => setShowImport(true)}
                >
                  {t("detail.importDocument")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setShowAddFact(true)}
                >
                  {t("detail.addFact")}
                </Button>
              </div>
            }
          >
            {t("detail.empty.body")}
          </Empty>
        ) : (
          <>
            <FactGroup
              title={t("brief.flights")}
              icon={<PlaneIcon />}
              facts={flights}
              onUnconfirm={unconfirm}
              unconfirmingId={unconfirmingId}
            />
            <FactGroup
              title={t("brief.stays")}
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

      {/* Everything from here down is below the fold and several of these fetch
          on mount, so they wait until they are nearly on screen. */}
      <DeferredSection id="section-prepare">
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

        <TripNotes tripId={tripId} />

        <DocumentsPanel
          tripId={tripId}
          reloadKey={reloadKey}
          onChanged={() => reload()}
        />

        <TripSearch tripId={tripId} />
      </DeferredSection>

      <DeferredSection id="section-discover">
        <CityPacks tripId={tripId} destination={trip.destination} />

        <Recommendations tripId={tripId} />

        <MapPanel
          tripId={tripId}
          center={
            data.detail.weather
              ? {
                  lat: data.detail.weather.latitude,
                  lon: data.detail.weather.longitude,
                  name: data.detail.weather.placeName,
                }
              : undefined
          }
        />
      </DeferredSection>

      {/* AI sits last on purpose: everything above works without it. */}
      <DeferredSection id="section-ai">
        <AssistPreview tripId={tripId} onOpenSettings={onOpenSettings} />

        <AssistDraft
          tripId={tripId}
          onDrafted={(candidates) => {
            setReviewCandidates(candidates);
            reload();
          }}
        />
      </DeferredSection>

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
            announce(
              t("detail.announce.added", {
                fact: factTitle(fact.factType, fact.payload),
              }),
            );
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

      {showEdit ? (
        <EditTripDialog
          trip={trip}
          onClose={() => setShowEdit(false)}
          onUpdated={() => {
            setShowEdit(false);
            announce(t("detail.announce.updated"));
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
