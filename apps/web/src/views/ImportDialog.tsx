import { useState } from "react";
import type {
  AppError,
  DocumentKind,
  ImportResult,
} from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { describeError, pluralize } from "../app/format";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { Dialog } from "../components/Dialog";
import { TextArea, TextField } from "../components/fields";

const MAX_CHARS = 1_000_000;

export function ImportDialog({
  tripId,
  onClose,
  onImported,
  onReview,
}: {
  tripId: string;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
  onReview: () => void;
}) {
  const gateway = useGateway();
  const [kind, setKind] = useState<DocumentKind>("pasted_text");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const charCount = [...content].length; // code points, matching the contract
  const over = charCount > MAX_CHARS;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    setDuplicateId(null);
    if (content.trim().length === 0) {
      setFieldError("Paste some content to import.");
      return;
    }
    if (over) {
      setFieldError("This document is over the 1,000,000 character limit.");
      return;
    }
    setSubmitting(true);
    try {
      const imported = await gateway.importDocument({
        tripId,
        kind,
        label: label.trim() || undefined,
        content,
      });
      setResult(imported);
      onImported(imported);
    } catch (caught) {
      const appError = caught as AppError;
      if (appError.code === "document/empty") {
        setFieldError("The pasted content was empty.");
      } else if (appError.code === "document/too_large") {
        setFieldError("This document is over the 1,000,000 character limit.");
      } else if (appError.code === "document/duplicate") {
        setDuplicateId(appError.details?.existingDocumentId ?? "");
      } else {
        setError(appError);
      }
      setSubmitting(false);
    }
  }

  // Success state — a designed summary, not a toast.
  if (result) {
    const found = result.candidates.length;
    return (
      <Dialog
        title="Imported"
        onClose={onClose}
        footer={
          <>
            {found > 0 ? (
              <Button variant="primary" onClick={onReview}>
                Review {found} {pluralize(found, "suggestion")}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </>
        }
      >
        <div className="voy-import-done">
          <p className="voy-import-done__title">
            “{result.document.label}” imported.
          </p>
          <p className="voy-import-done__body">
            {found === 0
              ? "No new suggestions were found in this document."
              : `Voyalier found ${found} new ${pluralize(
                  found,
                  "suggestion",
                )} to review — nothing changes until you confirm.`}
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Import a document"
      onClose={onClose}
      description="Paste a confirmation email or booking page. Voyalier reads it on this device and shows you what it found before anything is saved."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="import-form"
            busy={submitting}
            disabled={over}
          >
            Import
          </Button>
        </>
      }
    >
      <form
        id="import-form"
        className="voy-form"
        onSubmit={handleSubmit}
        noValidate
      >
        {error ? (
          <Banner tone="error" role="alert" title={describeError(error).title}>
            {describeError(error).body}
          </Banner>
        ) : null}
        {duplicateId !== null ? (
          <Banner tone="warn" role="alert" title="Already imported">
            This exact content was imported before
            {duplicateId ? ` (document ${duplicateId})` : ""}. Edit the content
            to import something new.
          </Banner>
        ) : null}
        <div className="voy-field">
          <span className="voy-field__label">Format</span>
          <ChoiceGroup
            label="Document format"
            value={kind}
            onChange={setKind}
            options={[
              { value: "pasted_text", label: "Plain text" },
              { value: "html", label: "HTML" },
            ]}
          />
        </div>
        <TextField
          id="import-label"
          label="Label (optional)"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={200}
          autoComplete="off"
          placeholder="Flight confirmation"
        />
        <TextArea
          id="import-content"
          label="Content"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          error={fieldError ?? undefined}
          rows={10}
          required
          placeholder="Paste your confirmation here…"
        />
        <p
          className={`voy-charcount${over ? " is-over" : ""}`}
          aria-live="polite"
        >
          {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
        </p>
      </form>
    </Dialog>
  );
}
