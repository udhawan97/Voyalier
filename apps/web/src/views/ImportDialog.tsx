import { useEffect, useRef, useState } from "react";
import {
  MAX_DOCUMENT_CHARS,
  countChars,
  type AppError,
  type CandidateFact,
  type DocumentKind,
  type ImportResult,
} from "@voyalier/contracts";

/**
 * How long a label may be.
 *
 * Voyalier's own limit, not the engine's — nothing behind this field counts, so
 * unlike the trip form's place fields there is no core constant to agree with.
 * It is declared here so the count the traveler sees and the cut they get are
 * the same number, measured the way the rest of the app measures (AGENTS.md:
 * limits count Unicode characters). The old `maxLength={200}` counted UTF-16
 * code units, so a label written with emoji was cut at 100 without a word.
 */
const MAX_IMPORT_LABEL_CHARS = 200;

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { plural, t } from "../app/i18n";
import { APP_LOCALE } from "../app/locale";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { ChoiceGroup } from "../components/ChoiceGroup";
import { Dialog } from "../components/Dialog";
import { TextArea, TextField } from "../components/fields";

/** Map a filename extension to the import format it most likely is. */
function kindForFilename(name: string): DocumentKind {
  const lower = name.toLowerCase();
  if (lower.endsWith(".eml")) return "email";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return "pasted_text";
}

/** Whether pasted content looks like the booking *page* the dialog invites. */
function looksLikeHtml(content: string): boolean {
  const head = content.trimStart().slice(0, 2000).toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.includes("application/ld+json") ||
    /<(div|table|body|span|section|article)[\s>]/.test(head)
  );
}

export function ImportDialog({
  tripId,
  onClose,
  onImported,
  onReview,
  onAddByHand,
}: {
  tripId: string;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
  onReview: (candidates: CandidateFact[]) => void;
  /** Offered when a document yields nothing, so the flow is not a dead end. */
  onAddByHand: () => void;
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
  // A failed submit renders its explanation at the top of a body the traveler
  // may have scrolled past. Nothing moved them to it, so a duplicate import
  // looked exactly like a button that did nothing.
  const alertRef = useRef<HTMLDivElement>(null);

  const charCount = countChars(content);
  const over = charCount > MAX_DOCUMENT_CHARS;
  const labelCount = countChars(label);
  const labelOver = labelCount > MAX_IMPORT_LABEL_CHARS;
  // Offered, never taken: the format picks the parser, and letting pasted
  // content choose its own parser hands that decision to whoever wrote it.
  const suggestHtml = kind === "pasted_text" && looksLikeHtml(content);

  useEffect(() => {
    if (!error && duplicateId === null) return;
    const node = alertRef.current;
    if (!node) return;
    // Absent in jsdom, and only ever an enhancement: focusing already reveals
    // the banner in a browser, so a missing implementation must not throw.
    node.scrollIntoView?.({ block: "nearest" });
    node.focus();
  }, [error, duplicateId]);

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
    if (countChars(text) > MAX_DOCUMENT_CHARS) {
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
            ) : (
              // Nothing found is a truthful answer and used to be the whole
              // answer: one "Done" and no way onward, though hand entry sits
              // two controls away in the view behind this dialog.
              <Button variant="primary" onClick={onAddByHand}>
                {t("import.done.addByHand")}
              </Button>
            )}
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
            disabled={over || labelOver || content.trim().length === 0}
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
        {/* `tabIndex` so the effect above can move the traveler to whichever of
            these appeared, rather than leaving them looking at an unchanged
            screen while the reason sits above the fold. */}
        <div ref={alertRef} tabIndex={-1}>
          {error ? (
            <Banner
              tone="error"
              role="alert"
              title={describeError(error).title}
            >
              {describeError(error).body}
            </Banner>
          ) : null}
          {duplicateId !== null ? (
            <Banner
              tone="warn"
              role="alert"
              title={t("import.duplicate.title")}
            >
              {/* The internal document id is a debug token, not user copy. */}
              {t("import.duplicate.body", { doc: "" })}
            </Banner>
          ) : null}
        </div>
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
        {/* No `maxLength`: the browser counts UTF-16 code units and cuts
            without a word, so an emoji-bearing label lost half its allowance
            silently. The limit is Voyalier's own (nothing behind this field
            counts), so it is enforced where it can be explained. */}
        <TextField
          id="import-label"
          label={t("import.label")}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          error={labelOver ? t("import.label.tooLong") : undefined}
          autoComplete="off"
          placeholder={t("import.label.placeholder")}
        />
        {labelCount > MAX_IMPORT_LABEL_CHARS - 40 ? (
          <p
            className={`voy-charcount${labelOver ? " is-over" : ""}`}
            aria-live="polite"
          >
            {t("import.charcount", {
              count: labelCount.toLocaleString(APP_LOCALE),
              max: MAX_IMPORT_LABEL_CHARS.toLocaleString(APP_LOCALE),
            })}
          </p>
        ) : null}
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
            max: MAX_DOCUMENT_CHARS.toLocaleString(APP_LOCALE),
          })}
        </p>
        {/* The format chooses the parser, so a booking page read as plain text
            is read by the wrong one. Offered rather than applied: inferring it
            would let whoever wrote the content pick the parser. */}
        {suggestHtml ? (
          <Banner tone="info" title={t("import.looksLikeHtml.title")}>
            <p>{t("import.looksLikeHtml.body")}</p>
            <Button variant="secondary" onClick={() => setKind("html")}>
              {t("import.looksLikeHtml.action")}
            </Button>
          </Banner>
        ) : null}
      </form>
    </Dialog>
  );
}
