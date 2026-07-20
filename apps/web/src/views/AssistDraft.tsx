import { useState } from "react";
import type {
  AppError,
  AssistRequestPreview,
  CandidateFact,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { plural, t } from "../app/i18n";
import { groundingLabel } from "../app/localizedContract";
import { SectionTitle } from "../components/primitives";
import { SparklesIcon } from "../components/icons";
import { Button } from "../components/Button";

/**
 * On-device AI draft for filling missing lodging dates from the trip's own
 * imported text. Ollama-only — the preview shows exactly what would be read and
 * states that nothing leaves the device. Running produces *pending* candidates
 * the user reviews (accept / edit / reject); a reply that doesn't validate saves
 * nothing and shows why.
 */
export function AssistDraft({
  tripId,
  onDrafted,
}: {
  tripId: string;
  onDrafted: (candidates: CandidateFact[]) => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [preview, setPreview] = useState<AssistRequestPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  // The preview reports whether there is any imported text to read.
  const hasDocuments = preview
    ? !preview.groundedIn.includes("no imported documents yet")
    : false;

  async function load() {
    setError(null);
    setEmpty(false);
    setLoading(true);
    try {
      setPreview(await gateway.previewAssistDraft(tripId, "lodging_dates"));
    } catch (caught) {
      setPreview(null);
      setError(describeError(caught as AppError).title);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    setError(null);
    setEmpty(false);
    setRunning(true);
    try {
      const result = await gateway.runAssistDraft(tripId, "lodging_dates");
      if (result.candidates.length === 0) {
        setEmpty(true);
      } else {
        announce(plural("draft.announce.drafted", result.candidates.length));
        onDrafted(result.candidates);
      }
    } catch (caught) {
      const appError = caught as AppError;
      setError(describeError(appError).body);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="voy-assist" aria-labelledby="draft-title">
      <SectionTitle id="draft-title" icon={<SparklesIcon />}>
        {t("draft.title")}
      </SectionTitle>
      <p className="voy-assist__intro">{t("draft.intro")}</p>

      <div className="voy-assist__controls">
        <Button variant="secondary" onClick={load} busy={loading}>
          {t("draft.preview")}
        </Button>
      </div>

      {error ? (
        <p className="voy-assist__error" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="voy-assist__result">
          <p className="voy-assist__route voy-assist__route--local">
            {t("draft.route")}{" "}
            <span className="voy-assist__endpoint">{preview.endpoint}</span>
          </p>
          <p className="voy-assist__meta">
            {preview.groundedIn.length > 0
              ? t("assist.grounded", {
                  sources: preview.groundedIn.map(groundingLabel).join(", "),
                })
              : t("assist.noGrounding")}
            {" · "}
            {t("assist.tokens", { tokens: preview.estimatedTokens })}
          </p>

          <h3 className="voy-assist__subhead">{t("draft.instruction")}</h3>
          <pre className="voy-assist__block">{preview.systemPrompt}</pre>

          <h3 className="voy-assist__subhead">{t("draft.reads")}</h3>
          <pre className="voy-assist__block">{preview.userContent}</pre>

          <div className="voy-assist__run">
            {hasDocuments ? (
              <Button variant="primary" onClick={run} busy={running}>
                {t("draft.run")}
              </Button>
            ) : (
              <p className="voy-assist__note">{t("draft.needDocs")}</p>
            )}
            {empty ? (
              <p className="voy-assist__note" role="status">
                {t("draft.none")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <p className="voy-assist__scope">{t("draft.scope")}</p>
    </section>
  );
}
