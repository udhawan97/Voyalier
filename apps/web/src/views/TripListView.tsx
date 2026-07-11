import { useRef, useState } from "react";
import type { AppError, TripSummary } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import {
  describeError,
  formatDateRange,
  pluralize,
  tripRoute,
} from "../app/format";
import { t } from "../app/i18n";
import { useAsyncData } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ArchiveIcon, PlusIcon, RetryIcon } from "../components/icons";
import {
  CountBadge,
  Empty,
  Skeleton,
  TripStatusBadge,
} from "../components/primitives";
import { CreateTripDialog } from "./CreateTripDialog";
import { DeleteTripDialog } from "./DeleteTripDialog";
import { VaultPanel } from "./VaultPanel";

function TripCard({
  trip,
  onOpen,
  onArchive,
  onDelete,
  archiving,
}: {
  trip: TripSummary;
  onOpen: (id: string) => void;
  onArchive: (trip: TripSummary) => void;
  onDelete: (trip: TripSummary) => void;
  archiving: boolean;
}) {
  return (
    <article
      className={`voy-tripcard${trip.status === "archived" ? " is-archived" : ""}`}
    >
      <div className="voy-tripcard__head">
        <h2 className="voy-tripcard__title">
          <button
            type="button"
            className="voy-tripcard__open"
            onClick={() => onOpen(trip.id)}
            aria-label={t("tripcard.open", { title: trip.title })}
          >
            {trip.title}
          </button>
        </h2>
        <TripStatusBadge status={trip.status} />
      </div>
      <p className="voy-tripcard__route">
        {tripRoute(trip.origin, trip.destination)}
      </p>
      <p className="voy-tripcard__dates">
        {formatDateRange(trip.startDate, trip.endDate)}
      </p>
      <div className="voy-tripcard__counts">
        <span className="voy-tripcard__count">
          <strong>{trip.confirmedFactCount}</strong> confirmed{" "}
          {pluralize(trip.confirmedFactCount, "fact")}
        </span>
        {trip.pendingCandidateCount > 0 ? (
          <span className="voy-tripcard__count">
            <CountBadge
              count={trip.pendingCandidateCount}
              label={`pending ${pluralize(
                trip.pendingCandidateCount,
                "suggestion",
              )}`}
            />
            <span>to review</span>
          </span>
        ) : null}
      </div>
      <div className="voy-tripcard__actions">
        {trip.status !== "archived" ? (
          <Button
            variant="ghost"
            onClick={() => onArchive(trip)}
            busy={archiving}
            icon={<ArchiveIcon />}
          >
            {t("tripcard.archive")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => onDelete(trip)}>
          {t("tripcard.delete")}
        </Button>
      </div>
    </article>
  );
}

export function TripListView({
  onOpenTrip,
  reloadKey,
}: {
  onOpenTrip: (id: string) => void;
  reloadKey: number;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const { status, data, error, reload } = useAsyncData(
    () => gateway.listTrips(),
    `trips:${reloadKey}`,
  );
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TripSummary | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);

  async function archive(trip: TripSummary) {
    setArchivingId(trip.id);
    try {
      await gateway.archiveTrip(trip.id);
      announce(t("triplist.announce.archived", { title: trip.title }));
      reload();
    } catch (caught) {
      announce(describeError(caught as AppError).title);
    } finally {
      setArchivingId(null);
    }
  }

  const trips = data ?? [];

  return (
    <section className="voy-triplist" aria-labelledby="triplist-heading">
      <header className="voy-triplist__head">
        <div>
          <p className="voy-eyebrow">{t("triplist.eyebrow")}</p>
          <h1 id="triplist-heading">{t("triplist.title")}</h1>
        </div>
        <Button
          ref={createBtnRef}
          variant="primary"
          icon={<PlusIcon />}
          onClick={() => setShowCreate(true)}
        >
          {t("triplist.create")}
        </Button>
      </header>

      {status === "loading" && !data ? (
        <div className="voy-triplist__grid" role="status" aria-busy="true">
          <span className="voy-sr-only">{t("triplist.loading")}</span>
          {[0, 1, 2].map((index) => (
            <article
              className="voy-tripcard voy-tripcard--skeleton"
              key={index}
            >
              <Skeleton width="60%" height="1.4rem" />
              <Skeleton width="40%" />
              <Skeleton width="50%" />
              <Skeleton width="70%" />
            </article>
          ))}
        </div>
      ) : null}

      {status === "error" && !data ? (
        <Banner
          tone="error"
          role="alert"
          title={describeError(error!).title}
          action={
            <Button variant="secondary" icon={<RetryIcon />} onClick={reload}>
              {t("action.retry")}
            </Button>
          }
        >
          {describeError(error!).body}
        </Banner>
      ) : null}

      {status !== "loading" && data && trips.length === 0 ? (
        <Empty
          title={t("triplist.empty.title")}
          action={
            <Button
              variant="primary"
              icon={<PlusIcon />}
              onClick={() => setShowCreate(true)}
            >
              {t("triplist.create")}
            </Button>
          }
        >
          {t("triplist.empty.body")}
        </Empty>
      ) : null}

      {trips.length > 0 ? (
        <div className="voy-triplist__grid">
          {trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              onOpen={onOpenTrip}
              onArchive={archive}
              onDelete={setDeleteTarget}
              archiving={archivingId === trip.id}
            />
          ))}
        </div>
      ) : null}

      <VaultPanel />

      {showCreate ? (
        <CreateTripDialog
          onClose={() => setShowCreate(false)}
          onCreated={(trip) => {
            setShowCreate(false);
            announce(t("triplist.announce.created", { title: trip.title }));
            reload();
          }}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteTripDialog
          trip={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            const title = deleteTarget.title;
            setDeleteTarget(null);
            announce(t("triplist.announce.deleted", { title }));
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
