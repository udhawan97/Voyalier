import { useRef, useState } from "react";
import type {
  AppError,
  CandidateFact,
  DocumentKind,
  ImportResult,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { plural, t } from "../app/i18n";
import { APP_LOCALE } from "../app/locale";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { Dialog } from "../components/Dialog";
import { TextArea, TextField } from "../components/fields";

const MAX_CHARS = 1_000_000;

/** Map a filename extension to the import format it most likely is. */
function kindForFilename(name: string): DocumentKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".eml")) return "email";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "pasted_text";
}

export function ImportDialog({
  tripId,
  onClose,
  onImported,
  onReview,
}: {
  tripId: string;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
  onReview: (candidates: CandidateFact[]) => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [kind, setKind] = useState<DocumentKind>("pasted_text");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<AppError | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const charCount = [...content].length; // code points, matching the contract
  const over = charCount > MAX_CHARS;

  // Read a local file's text on-device (no upload) and prime the form: infer the
  // format from the extension, default the label to the filename, and drop the
  // content into the same textarea the user could paste into.
  async function loadFile(file: File) {
    setError(null);
    setFieldError(null);
    setDuplicateId(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFieldError(t("import.file.unreadable"));
      return;
    }
    if ([...text].length > MAX_CHARS) {
      setFieldError(t("import.file.tooLarge"));
      return;
    }
    setContent(text);
    setKind(kindForFilename(file.name));
    if (!label.trim()) setLabel(file.name);
    announce(t("import.file.loaded", { name: file.name }));
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);
    setDuplicateId(null);
    if (content.trim().length === 0) {
      setFieldError(t("import.error.empty"));
      return;
    }
    if (over) {
      setFieldError(t("import.error.tooLarge"));
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
        setFieldError(t("import.error.wasEmpty"));
      } else if (appError.code === "document/too_large") {
        setFieldError(t("import.error.tooLarge"));
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
        title={t("import.done.title")}
        onClose={onClose}
        footer={
          <>
            {found > 0 ? (
              <Button
                variant="primary"
                onClick={() => onReview(result.candidates)}
              >
                {plural("import.review", found)}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              {t("action.done")}
            </Button>
          </>
        }
      >
        <div className="voy-import-done">
          <p className="voy-import-done__title">
            {t("import.done.label", { label: result.document.label })}
          </p>
          <p className="voy-import-done__body">
            {found === 0
              ? t("import.done.none")
              : plural("import.found", found)}
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={t("import.title")}
      onClose={onClose}
      description={t("import.description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="import-form"
            busy={submitting}
            disabled={over || content.trim().length === 0}
          >
            {t("import.submit")}
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
          <Banner tone="warn" role="alert" title={t("import.duplicate.title")}>
            {/* The internal document id is a debug token, not user copy. */}
            {t("import.duplicate.body", { doc: "" })}
          </Banner>
        ) : null}
        <div
          className={`voy-dropzone${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".eml,.html,.htm,.txt,text/plain,text/html,message/rfc822"
            className="voy-sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void loadFile(file);
              event.target.value = ""; // allow re-selecting the same file
            }}
          />
          <p className="voy-dropzone__hint">{t("import.file.hint")}</p>
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t("import.file.button")}
          </Button>
        </div>
        <div className="voy-field">
          <span className="voy-field__label">{t("import.format")}</span>
          <ChoiceGroup
            label={t("import.formatChoice")}
            value={kind}
            onChange={setKind}
            options={[
              { value: "pasted_text", label: t("import.format.text") },
              { value: "html", label: t("import.format.html") },
              { value: "email", label: t("import.format.email") },
            ]}
          />
        </div>
        <TextField
          id="import-label"
          label={t("import.label")}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={200}
          autoComplete="off"
          placeholder={t("import.label.placeholder")}
        />
        <TextArea
          id="import-content"
          label={t("import.content")}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          error={fieldError ?? undefined}
          rows={10}
          required
          placeholder={
            kind === "email"
              ? t("import.content.placeholder.email")
              : t("import.content.placeholder")
          }
        />
        <p
          className={`voy-charcount${over ? " is-over" : ""}`}
          aria-live="polite"
        >
          {t("import.charcount", {
            count: charCount.toLocaleString(APP_LOCALE),
            max: MAX_CHARS.toLocaleString(APP_LOCALE),
          })}
        </p>
      </form>
    </Dialog>
  );
}
