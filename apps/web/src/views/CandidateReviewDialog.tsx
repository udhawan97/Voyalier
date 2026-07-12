import { useEffect, useRef, useState, type Ref } from "react";
import type { AppError, CandidateFact, FactPayload } from "@voyalier/contracts";

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
  payloadToDraft,
  warningSentence,
  type PayloadDraft,
} from "../app/format";
import { plural, t } from "../app/i18n";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { FactPayloadForm } from "../components/FactPayloadForm";
import { AlertIcon, BedIcon, PlaneIcon } from "../components/icons";
import { Empty, EvidenceQuote, MethodChip } from "../components/primitives";

type Values = Record<string, string | undefined>;

function ReviewCard({
  candidate,
  onDone,
  confirmRef,
}: {
  candidate: CandidateFact;
  onDone: (id: string) => void;
  confirmRef: Ref<HTMLButtonElement>;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayloadDraft>(() =>
    payloadToDraft(candidate.payload),
  );
  const [busy, setBusy] = useState<"confirm" | "reject" | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const values = candidate.payload as Values;
  const spans = new Map(
    candidate.fieldSpans.map((span) => [span.fieldPath, span]),
  );
  const presentFields = fieldsForType(candidate.factType).filter(
    (key) => values[key] != null && values[key] !== "",
  );

  async function confirm(editedPayload?: FactPayload) {
    setBusy("confirm");
    setError(null);
    try {
      await gateway.confirmCandidate(
        editedPayload
          ? { candidateId: candidate.id, editedPayload }
          : { candidateId: candidate.id },
      );
      announce(
        t("review.announce.confirmed", {
          fact: factTitle(candidate.factType, candidate.payload),
        }),
      );
      onDone(candidate.id);
    } catch (caught) {
      setError(caught as AppError);
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setError(null);
    try {
      await gateway.rejectCandidate(candidate.id);
      announce(
        t("review.announce.dismissed", {
          fact: factTitle(candidate.factType, candidate.payload),
        }),
      );
      onDone(candidate.id);
    } catch (caught) {
      setError(caught as AppError);
      setBusy(null);
    }
  }

  return (
    <li className="voy-review">
      <div className="voy-review__head">
        <span className="voy-review__icon" aria-hidden="true">
          {candidate.factType === "flight_segment" ? (
            <PlaneIcon />
          ) : (
            <BedIcon />
          )}
        </span>
        <div className="voy-review__heading">
          <p className="voy-review__title">
            {factTitle(candidate.factType, candidate.payload)}
          </p>
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
              <code className="voy-warning__code">{code}</code>
              {/* the raw warning code is a debug token, not user copy */}
            </li>
          ))}
        </ul>
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
                <dd>{formatFieldValue(key, values[key] as string)}</dd>
                {span ? (
                  <EvidenceQuote caption={t("review.evidence")}>
                    {span.excerpt}
                  </EvidenceQuote>
                ) : null}
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
              disabled={busy !== null}
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
              busy={busy === "confirm"}
              disabled={busy !== null}
              onClick={() => confirm(draftToPayload(candidate.factType, draft))}
            >
              {t("review.saveConfirm")}
            </Button>
          </>
        ) : (
          <>
            <Button
              ref={confirmRef}
              variant="primary"
              busy={busy === "confirm"}
              disabled={busy !== null}
              onClick={() => confirm()}
            >
              {t("review.confirm")}
            </Button>
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setEditing(true)}
            >
              {t("review.editConfirm")}
            </Button>
            <Button
              variant="ghost"
              busy={busy === "reject"}
              disabled={busy !== null}
              onClick={reject}
            >
              {t("review.dismiss")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

export function CandidateReviewDialog({
  candidates,
  onClose,
  onResolved,
}: {
  candidates: CandidateFact[];
  onClose: () => void;
  onResolved: () => void;
}) {
  const [queue, setQueue] = useState<CandidateFact[]>(() => candidates);
  const pendingFocus = useRef<string | null>(null);
  const confirmRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const firstConfirmRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  // After a resolution shrinks the queue, move focus to the next actionable
  // control so the keyboard flow never lands on a removed element.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === "__done__") doneRef.current?.focus();
    // The next card's primary button (Confirm or, in edit mode, Save & confirm);
    // fall back to the footer so focus never escapes the dialog.
    else (confirmRefs.current[target] ?? doneRef.current)?.focus();
  }, [queue]);

  function handleDone(id: string) {
    const index = queue.findIndex((candidate) => candidate.id === id);
    const next = queue.filter((candidate) => candidate.id !== id);
    const nextItem = next[index] ?? next[next.length - 1] ?? null;
    pendingFocus.current = nextItem ? nextItem.id : "__done__";
    setQueue(next);
    onResolved();
  }

  const remaining = queue.length;

  return (
    <Dialog
      title={t("review.title")}
      onClose={onClose}
      size="lg"
      initialFocusRef={remaining > 0 ? firstConfirmRef : doneRef}
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
            {plural("review.count", remaining)}
          </p>
          <ul className="voy-review__list">
            {queue.map((candidate, index) => (
              <ReviewCard
                key={candidate.id}
                candidate={candidate}
                onDone={handleDone}
                confirmRef={(node) => {
                  confirmRefs.current[candidate.id] = node;
                  if (index === 0) firstConfirmRef.current = node;
                }}
              />
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
