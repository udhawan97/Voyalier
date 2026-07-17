import { useState } from "react";
import type { AppError, DocumentSummary } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDate } from "../app/format";
import { plural, t, type MessageKey } from "../app/i18n";
import {
  documentsScope,
  tripScope,
  useRevalidate,
  useScopeKey,
} from "../app/revalidate";
import { useAsyncData } from "../app/useAsync";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";
import { FileTextIcon } from "../components/icons";
import { Empty, SectionTitle, Skeleton } from "../components/primitives";

/**
 * "2026-07-09T15:20:00Z" → "Jul 9, 2026".
 *
 * `formatDate` takes a date-only contract value and returns anything else
 * untouched, which would print the raw timestamp. The clock time carries nothing
 * useful here — when you imported it, to the day, is the whole question.
 */
function formatImportedOn(timestamp: string): string {
  const match = /^\d{4}-\d{2}-\d{2}/.exec(timestamp);
  return match ? formatDate(match[0]) : timestamp;
}

const KIND_LABEL: Record<string, MessageKey> = {
  pasted_text: "documents.kind.pasted_text",
  html: "documents.kind.html",
  email: "documents.kind.email",
};

/**
 * One imported document: what it is, what it produced, and the two things a
 * privacy-first product owes the traveler — seeing it, and removing it.
 *
 * The body is fetched only when asked. It is sealed at rest and carries the
 * confirmation codes and traveler names the rest of the app works hard to keep
 * out of briefs and AI requests, so it is never pulled in a list.
 */
function DocumentRow({
  summary,
  onRemoved,
}: {
  summary: DocumentSummary;
  onRemoved: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { document, pendingCount, confirmedCount } = summary;

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    if (content !== null) {
      setOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const stored = await gateway.getDocument(document.id);
      setContent(stored.content);
      setOpen(true);
    } catch (caught) {
      setError(describeError(caught as AppError).title);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await gateway.deleteDocument(document.id);
      announce(t("documents.removed", { label: document.label }));
      onRemoved();
    } catch (caught) {
      setError(describeError(caught as AppError).title);
      setBusy(false);
    }
  }

  return (
    <li className="voy-doc">
      <div className="voy-doc__head">
        <span className="voy-doc__icon" aria-hidden="true">
          <FileTextIcon />
        </span>
        <div className="voy-doc__heading">
          <p className="voy-doc__label">{document.label}</p>
          <p className="voy-doc__meta">
            {t(KIND_LABEL[document.kind] ?? "documents.kind.pasted_text")}
            {" · "}
            {t("documents.imported", {
              date: formatImportedOn(document.importedAt),
            })}
            {" · "}
            {plural("documents.size", document.charCount)}
          </p>
          <p className="voy-doc__counts">
            {pendingCount > 0
              ? plural("documents.counts.pending", pendingCount)
              : null}
            {pendingCount > 0 && confirmedCount > 0 ? " · " : null}
            {confirmedCount > 0
              ? plural("documents.counts.confirmed", confirmedCount)
              : null}
          </p>
        </div>
      </div>

      {/* Deletion is not reversible and its blast radius depends on what this
          document produced, so say so before asking. */}
      {pendingCount > 0 || confirmedCount > 0 ? (
        <p className="voy-doc__warn">
          {pendingCount > 0
            ? plural("documents.removeWarning.pending", pendingCount)
            : null}
          {pendingCount > 0 && confirmedCount > 0 ? " " : null}
          {confirmedCount > 0 ? t("documents.removeWarning.confirmed") : null}
        </p>
      ) : null}

      {error ? (
        <p className="voy-doc__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="voy-doc__actions">
        <Button variant="ghost" onClick={toggle} busy={busy && !open}>
          {open ? t("documents.hide") : t("documents.view")}
        </Button>
        <ConfirmButton
          label={t("documents.remove")}
          onConfirm={remove}
          busy={busy}
        />
      </div>

      {open && content !== null ? (
        <pre className="voy-doc__body" aria-label={document.label}>
          {content}
        </pre>
      ) : null}
    </li>
  );
}

/**
 * The imported-documents manager.
 *
 * Voyalier reads confirmation emails full of confirmation codes and traveler
 * names, and until now kept them with no way to look at or delete them. For a
 * local-first, privacy-first product that was the loudest missing flow: the
 * promise is that your evidence stays yours, which has to include removing it.
 */
export function DocumentsPanel({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const revalidate = useRevalidate();
  const { status, data, error } = useAsyncData(
    () => gateway.listDocuments(tripId),
    useScopeKey(documentsScope(tripId)),
  );

  return (
    <section className="voy-docs" aria-labelledby="documents-title">
      <SectionTitle id="documents-title" icon={<FileTextIcon />}>
        {t("documents.title")}
      </SectionTitle>
      <p className="voy-docs__intro">{t("documents.intro")}</p>

      {status === "loading" && !data ? (
        <Skeleton height="3rem" />
      ) : error ? (
        <p className="voy-docs__error" role="alert">
          {describeError(error).title}
        </p>
      ) : data && data.length > 0 ? (
        <ul className="voy-docs__list">
          {data.map((summary) => (
            <DocumentRow
              key={summary.document.id}
              summary={summary}
              // Removing a document reaches beyond this panel: facts
              // confirmed from it are flagged `sourceRemoved`, and the cards
              // showing them live on the trip page. Naming both scopes is how
              // this panel says so — it used to need a callback prop from a
              // parent that then refetched itself entirely.
              onRemoved={() =>
                revalidate(documentsScope(tripId), tripScope(tripId))
              }
            />
          ))}
        </ul>
      ) : (
        <Empty icon={<FileTextIcon />} title={t("documents.empty")}>
          {t("documents.empty.hint")}
        </Empty>
      )}
    </section>
  );
}
