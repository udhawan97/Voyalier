import { useEffect, useRef, useState, type Ref, type RefObject } from "react";
import type {
  CandidateFact,
  ConfirmedFact,
  ExtractionMethod,
  FactPayload,
  FactType,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import {
  describeError,
  draftToPayload,
  factSubtitle,
  factTitle,
  factTypeLabel,
  fieldLabel,
  fieldsForType,
  formatFieldValue,
  methodLabel,
  payloadToDraft,
  warningSentence,
  type PayloadDraft,
} from "../app/format";
import { plural, t } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { Dialog } from "../components/Dialog";
import { FactPayloadForm } from "../components/FactPayloadForm";
import { AlertIcon, BedIcon, PlaneIcon } from "../components/icons";
import { Empty, EvidenceQuote, MethodChip } from "../components/primitives";

type Values = Record<string, string | undefined>;

const FACT_TYPES: FactType[] = [
  "flight_segment",
  "lodging_stay",
  "rail_journey",
  "coach_journey",
  "ferry_crossing",
  "car_rental",
];

const EXTRACTION_METHODS: ExtractionMethod[] = [
  "structured",
  "inferred",
  "manual",
  "assisted",
];

type ReviewFilters = {
  warningsOnly: boolean;
  factType: FactType | "all";
  method: ExtractionMethod | "all";
};

function filterCandidates(
  candidates: CandidateFact[],
  filters: ReviewFilters,
): CandidateFact[] {
  return candidates.filter(
    (candidate) =>
      (!filters.warningsOnly || candidate.warnings.length > 0) &&
      (filters.factType === "all" || candidate.factType === filters.factType) &&
      (filters.method === "all" || candidate.method === filters.method),
  );
}

function ReviewCard({
  candidate,
  currentFact,
  onDone,
  confirmRef,
  hidden,
}: {
  candidate: CandidateFact;
  currentFact?: ConfirmedFact;
  onDone: (id: string) => void;
  confirmRef: Ref<HTMLButtonElement>;
  hidden: boolean;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayloadDraft>(() =>
    payloadToDraft(candidate.payload),
  );

  // The card's heading, and the name its four actions act under: a queue of
  // these reads "Confirm, Edit & confirm, Dismiss" over and over otherwise, and
  // confirming the wrong one writes a fact into the trip.
  const title = factTitle(candidate.factType, candidate.payload);
  const values = candidate.payload as Values;
  const spans = new Map(
    candidate.fieldSpans.map((span) => [span.fieldPath, span]),
  );
  const presentFields = fieldsForType(candidate.factType).filter(
    (key) => values[key] != null && values[key] !== "",
  );

  // Two actions rather than one three-state `busy`, so each button reports its
  // own. Both used to cast `caught as AppError` over whatever was thrown --
  // including a TypeError from draftToPayload, which would have rendered as
  // "the local core could not be reached". `useAsyncAction` normalizes instead.
  const confirmAction = useAsyncAction<
    [editedPayload?: FactPayload, amendmentAction?: "replace" | "keep_both"],
    { candidate: CandidateFact; confirmedFact: ConfirmedFact }
  >(
    (editedPayload?: FactPayload, amendmentAction?: "replace" | "keep_both") =>
      gateway.confirmCandidate({
        candidateId: candidate.id,
        ...(editedPayload ? { editedPayload } : {}),
        ...(amendmentAction ? { amendmentAction } : {}),
      }),
    // The type arguments are explicit because `Args` is inferred from both
    // parameters, and a zero-argument onSuccess narrows the action's optional
    // payload straight out of the signature.
    () => {
      announce(t("review.announce.confirmed", { fact: title }));
      onDone(candidate.id);
    },
  );

  const rejectAction = useAsyncAction(
    () => gateway.rejectCandidate(candidate.id),
    () => {
      announce(t("review.announce.dismissed", { fact: title }));
      onDone(candidate.id);
    },
  );

  const busy = confirmAction.busy || rejectAction.busy;
  const error = confirmAction.error ?? rejectAction.error;

  return (
    <li className="voy-review" hidden={hidden}>
      <div className="voy-review__head">
        <span className="voy-review__icon" aria-hidden="true">
          {candidate.factType === "flight_segment" ? (
            <PlaneIcon />
          ) : (
            <BedIcon />
          )}
        </span>
        <div className="voy-review__heading">
          <p className="voy-review__title">{title}</p>
          <p className="voy-review__sub">
            {factTypeLabel(candidate.factType)} ·{" "}
            {factSubtitle(candidate.factType, candidate.payload)}
          </p>
        </div>
        <MethodChip method={candidate.method} />
      </div>

      {candidate.warnings.length > 0 ? (
        <ul className="voy-review__warnings">
          {candidate.warnings.map((code) => (
            <li key={code} className="voy-warning">
              <span className="voy-warning__icon" aria-hidden="true">
                <AlertIcon />
              </span>
              <span>{warningSentence(code)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {currentFact ? (
        <section
          className="voy-review__amendment"
          aria-label={t("review.amendment.label")}
        >
          <p className="voy-review__amendment-title">
            {t("review.amendment.title")}
          </p>
          <p className="voy-review__amendment-note">
            {t("review.amendment.note")}
          </p>
          <dl className="voy-review__diff">
            {fieldsForType(candidate.factType)
              .filter(
                (key) =>
                  (currentFact.payload as Values)[key] !==
                  (candidate.payload as Values)[key],
              )
              .map((key) => (
                <div key={key}>
                  <dt>{fieldLabel(key)}</dt>
                  <dd>
                    <span>
                      {formatFieldValue(
                        key,
                        (currentFact.payload as Values)[key] ?? "—",
                      )}
                    </span>
                    <span aria-hidden="true"> → </span>
                    <span>{formatFieldValue(key, values[key] ?? "—")}</span>
                  </dd>
                </div>
              ))}
          </dl>
        </section>
      ) : null}

      {editing ? (
        <div className="voy-review__edit">
          <p className="voy-review__editnote">{t("review.editnote")}</p>
          <FactPayloadForm
            factType={candidate.factType}
            draft={draft}
            onChange={setDraft}
            idPrefix={`edit-${candidate.id}`}
            tripId={candidate.tripId}
          />
        </div>
      ) : (
        <dl className="voy-review__fields">
          {presentFields.map((key) => {
            const span = spans.get(`payload.${key}`);
            return (
              <div className="voy-review__field" key={key}>
                <dt>{fieldLabel(key)}</dt>
                <dd>
                  {formatFieldValue(key, values[key] as string)}
                  {span ? (
                    <EvidenceQuote caption={t("review.evidence")}>
                      {span.excerpt}
                    </EvidenceQuote>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {error ? (
        <Banner tone="error" role="alert" title={describeError(error).title}>
          {describeError(error).body}
        </Banner>
      ) : null}

      <div className="voy-review__actions">
        {editing ? (
          <>
            <Button
              variant="ghost"
              aria-label={t("review.cancelEdit.label", { fact: title })}
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(payloadToDraft(candidate.payload));
              }}
            >
              {t("review.cancelEdit")}
            </Button>
            <Button
              ref={confirmRef}
              variant="primary"
              aria-label={t("review.saveConfirm.label", { fact: title })}
              busy={confirmAction.busy}
              disabled={busy}
              onClick={() =>
                void confirmAction.run(
                  draftToPayload(candidate.factType, draft),
                )
              }
            >
              {t("review.saveConfirm")}
            </Button>
          </>
        ) : currentFact ? (
          <>
            <Button
              ref={confirmRef}
              variant="primary"
              aria-label={t("review.amendment.replace.label", { fact: title })}
              busy={confirmAction.busy}
              disabled={busy}
              onClick={() => void confirmAction.run(undefined, "replace")}
            >
              {t("review.amendment.replace")}
            </Button>
            <Button
              variant="secondary"
              aria-label={t("review.amendment.keep.label", { fact: title })}
              disabled={busy}
              onClick={() => void confirmAction.run(undefined, "keep_both")}
            >
              {t("review.amendment.keep")}
            </Button>
            <ConfirmButton
              label={t("review.dismiss")}
              ariaLabel={t("review.dismiss.label", { fact: title })}
              busy={rejectAction.busy}
              disabled={busy}
              onConfirm={() => void rejectAction.run()}
            />
          </>
        ) : (
          <>
            <Button
              ref={confirmRef}
              variant="primary"
              aria-label={t("review.confirm.label", { fact: title })}
              busy={confirmAction.busy}
              disabled={busy}
              onClick={() => void confirmAction.run()}
            >
              {t("review.confirm")}
            </Button>
            <Button
              variant="secondary"
              aria-label={t("review.editConfirm.label", { fact: title })}
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              {t("review.editConfirm")}
            </Button>
            <ConfirmButton
              label={t("review.dismiss")}
              ariaLabel={t("review.dismiss.label", { fact: title })}
              busy={rejectAction.busy}
              disabled={busy}
              onConfirm={() => void rejectAction.run()}
            />
          </>
        )}
      </div>
    </li>
  );
}

export function CandidateReviewDialog({
  candidates,
  confirmedFacts = [],
  onClose,
  onResolved,
  returnFocusRef,
  completionFocusRef,
}: {
  candidates: CandidateFact[];
  confirmedFacts?: ConfirmedFact[];
  onClose: () => void;
  onResolved: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  completionFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [queue, setQueue] = useState<CandidateFact[]>(() => candidates);
  const [warningsOnly, setWarningsOnly] = useState(false);
  const [factType, setFactType] = useState<FactType | "all">("all");
  const [method, setMethod] = useState<ExtractionMethod | "all">("all");
  const pendingFocus = useRef<string | null>(null);
  const confirmRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const doneRef = useRef<HTMLButtonElement>(null);
  const warningsRef = useRef<HTMLInputElement>(null);
  const factTypeRef = useRef<HTMLSelectElement>(null);
  const methodRef = useRef<HTMLSelectElement>(null);

  const filters = { warningsOnly, factType, method } satisfies ReviewFilters;
  const visibleQueue = filterCandidates(queue, filters);
  const visibleIds = new Set(visibleQueue.map((candidate) => candidate.id));

  // After a resolution shrinks the queue, move focus to the next actionable
  // control so the keyboard flow never lands on a removed element.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === "__done__") doneRef.current?.focus();
    else if (target === "__filters__") {
      (
        (method !== "all" ? methodRef.current : null) ??
        (factType !== "all" ? factTypeRef.current : null) ??
        (warningsOnly ? warningsRef.current : null) ??
        factTypeRef.current
      )?.focus();
    }
    // The next card's primary button (Confirm or, in edit mode, Save & confirm);
    // fall back to the footer so focus never escapes the dialog.
    else (confirmRefs.current[target] ?? doneRef.current)?.focus();
  }, [queue, warningsOnly, factType, method]);

  function handleDone(id: string) {
    const index = visibleQueue.findIndex((candidate) => candidate.id === id);
    const next = queue.filter((candidate) => candidate.id !== id);
    const nextVisible = filterCandidates(next, filters);
    const nextItem = nextVisible[index] ?? nextVisible[nextVisible.length - 1];
    pendingFocus.current = nextItem
      ? nextItem.id
      : next.length > 0
        ? "__filters__"
        : "__done__";
    setQueue(next);
    onResolved();
  }

  function resetFilters() {
    setWarningsOnly(false);
    setFactType("all");
    setMethod("all");
    pendingFocus.current =
      visibleQueue.length === 0 ? (queue[0]?.id ?? null) : null;
  }

  const remaining = queue.length;

  return (
    <Dialog
      title={t("review.title")}
      onClose={onClose}
      size="lg"
      initialFocus="dialog"
      returnFocusRef={remaining === 0 ? completionFocusRef : returnFocusRef}
      description={remaining > 0 ? t("review.description") : undefined}
      footer={
        <Button
          ref={doneRef}
          variant={remaining === 0 ? "primary" : "ghost"}
          onClick={onClose}
        >
          {remaining === 0 ? t("action.done") : t("action.close")}
        </Button>
      }
    >
      {remaining === 0 ? (
        <Empty title={t("review.empty.title")}>{t("review.empty.body")}</Empty>
      ) : (
        <>
          <p className="voy-review__count" role="status">
            {visibleQueue.length === remaining
              ? plural("review.count", remaining)
              : t("review.filters.count", {
                  shown: visibleQueue.length,
                  total: remaining,
                })}
          </p>
          <div
            className="voy-review__filters"
            role="group"
            aria-label={t("review.filters.label")}
          >
            <label className="voy-review__filter voy-review__filter--check">
              <input
                ref={warningsRef}
                type="checkbox"
                checked={warningsOnly}
                onChange={(event) => setWarningsOnly(event.target.checked)}
              />
              <span>{t("review.filters.warnings")}</span>
            </label>
            <label className="voy-review__filter">
              <span>{t("review.filters.factType")}</span>
              <select
                ref={factTypeRef}
                className="voy-input"
                value={factType}
                onChange={(event) =>
                  setFactType(event.target.value as FactType | "all")
                }
              >
                <option value="all">{t("review.filters.allTypes")}</option>
                {FACT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {factTypeLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="voy-review__filter">
              <span>{t("review.filters.method")}</span>
              <select
                ref={methodRef}
                className="voy-input"
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as ExtractionMethod | "all")
                }
              >
                <option value="all">{t("review.filters.allMethods")}</option>
                {EXTRACTION_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {methodLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {visibleQueue.length === 0 ? (
            <Empty
              title={t("review.filters.empty.title")}
              action={
                <Button variant="secondary" onClick={resetFilters}>
                  {t("review.filters.reset")}
                </Button>
              }
            >
              {t("review.filters.empty.body")}
            </Empty>
          ) : null}
          <ul className="voy-review__list">
            {queue.map((candidate) => (
              <ReviewCard
                key={candidate.id}
                candidate={candidate}
                currentFact={confirmedFacts.find(
                  (fact) => fact.id === candidate.amendsFactId,
                )}
                onDone={handleDone}
                hidden={!visibleIds.has(candidate.id)}
                confirmRef={(node) => {
                  confirmRefs.current[candidate.id] = node;
                }}
              />
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
