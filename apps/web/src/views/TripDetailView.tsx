import { useEffect, useRef, useState } from "react";
import type {
  CandidateFact,
  ConfirmedFact,
  FactLabel,
  ItineraryConflict,
  ReadinessCheck,
  ReadinessFindingCode,
  ReadinessItem,
  ReadinessStatus,
  ReadinessSummary,
  WorkspaceSearchHit,
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
import { plural, t, type MessageKey, type PluralBase } from "../app/i18n";
import { tripScope, useRevalidate, useScopeKey } from "../app/revalidate";
import { useAsyncAction, useAsyncData } from "../app/useAsync";
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
import { PlanningPanel } from "./PlanningPanel";
import { DeleteTripDialog } from "./DeleteTripDialog";
import { EditTripDialog } from "./EditTripDialog";
import { ImportDialog } from "./ImportDialog";
import { TravelAdvice } from "./TravelAdvice";
import { TripSearch } from "./TripSearch";
import { DestinationFacts } from "./DestinationFacts";
import { PublicHolidays } from "./PublicHolidays";
import { AboutPlace } from "./AboutPlace";
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
    <article
      className="voy-fact"
      tabIndex={-1}
      data-search-source="confirmed_fact"
      data-search-record={fact.id}
    >
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

/** The check's name. The core sends `id`; the words are ours. */
const READINESS_CHECK_TITLE: Record<ReadinessCheck, MessageKey> = {
  schedule_conflicts: "readiness.check.schedule_conflicts",
  lodging_coverage: "readiness.check.lodging_coverage",
  pending_review: "readiness.check.pending_review",
  entry_requirements: "readiness.check.entry_requirements",
  health_notices: "readiness.check.health_notices",
};

/**
 * How each finding becomes a sentence: a plain key, a plural base to count
 * against, or — for a link-only item, which asserts nothing — copy about the
 * check itself rather than a finding.
 *
 * An exhaustive `Record`, so adding a `ReadinessFindingCode` is a type error
 * here rather than a blank line in the panel.
 */
type FindingCopy =
  { key: MessageKey } | { plural: PluralBase } | { byCheck: true };

const READINESS_FINDING_COPY: Record<ReadinessFindingCode, FindingCopy> = {
  no_facts_yet: { key: "readiness.finding.no_facts_yet" },
  schedule_conflicts: { plural: "readiness.finding.schedule_conflicts" },
  schedule_notices: { plural: "readiness.finding.schedule_notices" },
  schedule_clear: { key: "readiness.finding.schedule_clear" },
  no_lodging_yet: { key: "readiness.finding.no_lodging_yet" },
  lodging_gaps: { key: "readiness.finding.lodging_gaps" },
  lodging_clear: { key: "readiness.finding.lodging_clear" },
  pending_review: { plural: "readiness.finding.pending_review" },
  nothing_pending: { key: "readiness.finding.nothing_pending" },
  link_only: { byCheck: true },
};

/** The link-only checks' own copy. Only these two are ever link-only. */
const READINESS_LINK_ONLY_DETAIL: Partial<Record<ReadinessCheck, MessageKey>> =
  {
    entry_requirements: "readiness.linkOnly.entry_requirements",
    health_notices: "readiness.linkOnly.health_notices",
  };

/**
 * Turn a readiness finding into a sentence.
 *
 * The core reports what it found and how many; the words and their plural forms
 * live here, so they can be translated. The core used to build this prose itself
 * — pluralizing with `format!("{singular}s")` — and it rendered raw.
 */
function readinessDetail(item: ReadinessItem): string {
  const copy = READINESS_FINDING_COPY[item.finding.code];
  if ("plural" in copy) return plural(copy.plural, item.finding.count ?? 0);
  if ("key" in copy) return t(copy.key);
  const key = READINESS_LINK_ONLY_DETAIL[item.id];
  return key ? t(key) : "";
}

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
                {t(READINESS_CHECK_TITLE[item.id])}
                <span className="voy-readiness__item-status">
                  {" · "}
                  {item.finding.code === "link_only"
                    ? t("readiness.checkYourself")
                    : t(READINESS_LABEL[item.status])}
                </span>
              </span>
              <span className="voy-readiness__detail">
                {readinessDetail(item)}
              </span>
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
  /**
   * Name one fact the way this interface names facts.
   *
   * The core decided *which* identifying detail the fact has; the noun phrase is
   * ours. Flight numbers and property names are the traveler's own data and go
   * through verbatim.
   */
  function conflictSubject(label: FactLabel): string {
    switch (label.code) {
      case "flight_number":
        return t("schedule.label.flight_number", { number: label.number });
      case "flight_route":
        return t("schedule.label.flight_route", {
          from: label.from,
          to: label.to,
        });
      case "flight":
        return t("schedule.label.flight");
      case "lodging_property":
        return t("schedule.label.lodging_property", {
          property: label.property,
        });
      case "lodging":
        return t("schedule.label.lodging");
    }
  }

  /** Turn a finding into the sentence a traveler reads. */
  function conflictSentence(conflict: ItineraryConflict): string {
    const [first, second] = conflict.subjects.map(conflictSubject);
    switch (conflict.kind) {
      case "flight_overlap":
        return t("schedule.flight_overlap", { first, second });
      case "lodging_overlap":
        return t("schedule.lodging_overlap", { first, second });
      case "lodging_gap": {
        const start = conflict.startDate ?? "";
        const last = conflict.endDate ?? start;
        // The real night count, so a locale with more plural categories than
        // English picks the right one rather than just one-versus-many.
        const nights =
          Math.round((Date.parse(last) - Date.parse(start)) / 86_400_000) + 1;
        return plural("schedule.lodging_gap", nights, { first: start, last });
      }
      case "planned_item_overlap": {
        const [firstPlan = "", secondPlan] = conflict.plannedItemTitles ?? [];
        if (!secondPlan && first) {
          return t("schedule.planned_item_fact_overlap", {
            plan: firstPlan,
            fact: first,
          });
        }
        return t("schedule.planned_item_overlap", {
          first: firstPlan,
          second: secondPlan ?? "",
        });
      }
    }
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
            key={`${conflict.kind}:${conflict.factIds.join(",")}:${conflict.plannedItemIds?.join(",") ?? ""}:${conflict.startDate ?? ""}`}
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
              {conflictSentence(conflict)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TripDetailView({
  tripId,
  searchTarget,
  onBack,
  onDeleted,
  onOpenSettings,
}: {
  tripId: string;
  searchTarget?: Pick<WorkspaceSearchHit, "source" | "recordId">;
  onBack: () => void;
  onDeleted: () => void;
  onOpenSettings?: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const revalidate = useRevalidate();
  const { status, data, error, reload } = useAsyncData(
    async () => {
      const [detail, pending] = await Promise.all([
        gateway.getTrip(tripId),
        gateway.listCandidates(tripId, "pending"),
      ]);
      return { detail, pending };
    },
    useScopeKey(tripScope(tripId)),
  );
  const searchTargetConsumed = useRef(false);
  const sectionHashConsumed = useRef(false);
  const reviewTriggerRef = useRef<HTMLElement | null>(null);
  const reviewCompletionFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!data || !searchTarget || searchTargetConsumed.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const focusTarget = () => {
      const exact = [
        ...document.querySelectorAll<HTMLElement>("[data-search-source]"),
      ].find(
        (element) =>
          element.dataset.searchSource === searchTarget.source &&
          element.dataset.searchRecord === searchTarget.recordId,
      );
      if (exact) {
        searchTargetConsumed.current = true;
        exact.scrollIntoView?.({ block: "center" });
        exact.focus({ preventScroll: true });
        return;
      }
      attempts += 1;
      if (
        attempts === 1 &&
        (searchTarget.source === "document" || searchTarget.source === "note")
      ) {
        document.getElementById("section-prepare")?.scrollIntoView?.();
      }
      if (attempts < 20) {
        timer = setTimeout(focusTarget, 50);
        return;
      }
      const fallback = document.getElementById(
        searchTarget.source === "document" || searchTarget.source === "note"
          ? "section-prepare"
          : "section-plan",
      );
      searchTargetConsumed.current = true;
      fallback?.setAttribute("tabindex", "-1");
      fallback?.focus({ preventScroll: true });
    };
    timer = setTimeout(focusTarget, 0);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [data, searchTarget]);

  useEffect(() => {
    if (!data || searchTarget || sectionHashConsumed.current) return;
    const id = globalThis.location?.hash.slice(1) ?? "";
    if (!/^section-(plan|prepare|discover|ai)$/.test(id)) return;

    sectionHashConsumed.current = true;
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView?.({ block: "start" });
    }, 0);
    return () => clearTimeout(timer);
  }, [data, searchTarget]);

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
  const exportAction = useAsyncAction(
    async () => {
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
    },
    () => announce(t("ics.done")),
  );

  const archiveAction = useAsyncAction(
    () => gateway.archiveTrip(tripId),
    () => {
      announce(t("detail.announce.archived"));
      reload();
    },
  );

  const unarchiveAction = useAsyncAction(
    () => gateway.unarchiveTrip(tripId),
    () => {
      announce(t("detail.announce.unarchived"));
      reload();
    },
  );

  const unconfirmAction = useAsyncAction(
    (fact: ConfirmedFact) => gateway.unconfirmFact(fact.id),
    (_result, fact) => {
      const title = factTitle(fact.factType, fact.payload);
      announce(
        fact.candidateId === null
          ? t("detail.announce.removed", { fact: title })
          : t("detail.announce.unconfirmed", { fact: title }),
      );
      reload();
    },
  );

  async function unconfirm(fact: ConfirmedFact) {
    setUnconfirmingId(fact.id);
    // run() never rejects, so the per-fact busy id always gets cleared.
    await unconfirmAction.run(fact);
    setUnconfirmingId(null);
  }

  // One place for whatever the last action failed with. These used to be
  // announced to screen readers and never rendered, so a sighted user watched
  // the button un-busy itself and saw nothing at all.
  const actionError =
    exportAction.error ??
    archiveAction.error ??
    unarchiveAction.error ??
    unconfirmAction.error;

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
  const hasItinerary =
    confirmedFacts.length > 0 || data.detail.tripItems.length > 0;

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
          {hasItinerary ? (
            <Button variant="ghost" onClick={() => setShowBrief(true)}>
              {t("detail.shareBrief")}
            </Button>
          ) : null}
          {/* Both confirmed facts and traveler-authored plans are exportable. */}
          {hasItinerary ? (
            <Button
              variant="ghost"
              onClick={() => exportAction.run()}
              busy={exportAction.busy}
            >
              {exportAction.busy ? t("ics.exporting") : t("ics.export")}
            </Button>
          ) : null}
          {isArchived ? (
            <Button
              variant="ghost"
              onClick={() => unarchiveAction.run()}
              busy={unarchiveAction.busy}
            >
              {t("detail.unarchive")}
            </Button>
          ) : (
            <Button
              variant="ghost"
              icon={<ArchiveIcon />}
              onClick={() => archiveAction.run()}
              busy={archiveAction.busy}
            >
              {t("detail.archive")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setShowDelete(true)}>
            {t("detail.delete")}
          </Button>
        </div>
      </header>

      {/* The four header actions used to only announce their failures, so a
          sighted user saw the button un-busy itself and nothing else. */}
      {actionError ? (
        <Banner
          tone="error"
          role="alert"
          title={describeError(actionError).title}
        >
          {describeError(actionError).body}
        </Banner>
      ) : null}

      <TripSectionNav />

      <TodayPanel tripId={tripId} />

      {pendingCount > 0 ? (
        <button
          ref={(node) => {
            reviewTriggerRef.current = node;
          }}
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
        <h2
          ref={(node) => {
            reviewCompletionFocusRef.current = node;
          }}
          id="blueprint-title"
          className="voy-detail__blueprint-title"
          tabIndex={-1}
        >
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

      <PlanningPanel
        tripId={tripId}
        savedPlaces={data.detail.savedPlaces}
        suggestions={data.detail.packingList}
        packingItems={data.detail.packingItems}
        tripItems={data.detail.tripItems}
        onChanged={() => revalidate(tripScope(tripId))}
      />

      {confirmedFacts.length > 0 || pendingCount > 0 ? (
        <ReadinessPanel readiness={readiness} />
      ) : null}

      {hasItinerary ? <ScheduleCheck conflicts={itineraryConflicts} /> : null}

      {/* Everything from here down is below the fold and several of these fetch
          on mount, so they wait until they are nearly on screen. */}
      <DeferredSection id="section-prepare">
        <TravelAdvice
          tripId={tripId}
          panel={data.detail.advisoryPanel}
          onFetched={() => reload()}
        />

        <WeatherOutlook
          tripId={tripId}
          destination={trip.destination}
          snapshot={data.detail.weather}
          packingList={data.detail.packingList}
          onFetched={() => reload()}
        />

        <DestinationFacts
          tripId={tripId}
          destination={trip.destination}
          snapshot={data.detail.destinationFacts}
          countryFacts={data.detail.countryFacts}
          astro={data.detail.astro}
          nearestAirports={data.detail.nearestAirports}
          worldHeritage={data.detail.worldHeritage}
          tipping={data.detail.tipping}
          timeDifference={data.detail.timeDifference}
          onFetched={() => reload()}
        />

        <PublicHolidays
          tripId={tripId}
          destination={trip.destination}
          snapshot={data.detail.publicHolidays}
          onFetched={() => reload()}
        />

        <AboutPlace
          tripId={tripId}
          destination={trip.destination}
          summary={data.detail.placeSummary}
          onFetched={() => reload()}
        />

        <TripNotes tripId={tripId} />

        <DocumentsPanel tripId={tripId} />

        <TripSearch tripId={tripId} />
      </DeferredSection>

      <DeferredSection id="section-discover">
        <CityPacks tripId={tripId} destination={trip.destination} />

        <Recommendations
          tripId={tripId}
          profile={data.detail.interestProfile}
          savedPlaces={data.detail.savedPlaces}
          onChanged={() => reload()}
        />

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
          returnFocusRef={reviewTriggerRef}
          completionFocusRef={reviewCompletionFocusRef}
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
