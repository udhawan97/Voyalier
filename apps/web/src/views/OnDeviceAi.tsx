import { useEffect, useState } from "react";
import type { AppError, LocalAiStatus } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { plural, t } from "../app/i18n";
import {
  pullCommand,
  RECOMMENDED_MODELS,
  type RecommendedModel,
} from "../app/models";
import { Button } from "../components/Button";

/**
 * One recommended-model card: an editable tag, the exact `ollama pull` command
 * (copyable), and — when Ollama is running — an in-app Download button that pulls
 * the model. The tag is prefilled but editable, so any other (or custom) model
 * still works; a pull error is surfaced verbatim rather than hidden.
 */
function ModelCard({
  model,
  canDownload,
  onDownloaded,
}: {
  model: RecommendedModel;
  canDownload: boolean;
  onDownloaded: () => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [tag, setTag] = useState(model.tag);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  // Reset the transient "Copied" label without leaking a timer past unmount.
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const trimmed = tag.trim();
  const command = pullCommand(tag);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable; the command stays visible to copy by hand.
    }
  }

  async function download() {
    setResult(null);
    setBusy(true);
    try {
      const pulled = await gateway.pullLocalModel(trimmed);
      setResult(pulled);
      announce(pulled.message);
      if (pulled.ok) onDownloaded();
    } catch (caught) {
      const message = (caught as AppError).message || t("providers.error");
      setResult({ ok: false, message });
      announce(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="voy-modelcard" aria-label={model.label}>
      <div className="voy-modelcard__head">
        <span className="voy-modelcard__name">{model.label}</span>
        <span className="voy-modelcard__size">{model.size}</span>
      </div>
      <p className="voy-modelcard__blurb">{model.blurb}</p>

      <label className="voy-sr-only" htmlFor={`model-tag-${model.id}`}>
        {t("localai.card.tag", { model: model.label })}
      </label>
      <input
        id={`model-tag-${model.id}`}
        className="voy-modelcard__tag"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={tag}
        onChange={(event) => setTag(event.target.value)}
      />
      <code className="voy-modelcard__cmd">{command}</code>

      <div className="voy-modelcard__actions">
        <Button variant="ghost" onClick={copy} disabled={trimmed.length === 0}>
          {copied ? t("localai.card.copied") : t("localai.card.copy")}
        </Button>
        <Button
          variant="secondary"
          busy={busy}
          disabled={!canDownload || trimmed.length === 0}
          onClick={download}
        >
          {t("localai.card.download")}
        </Button>
      </div>

      {busy ? (
        <p className="voy-modelcard__note">{t("localai.card.downloading")}</p>
      ) : !canDownload ? (
        <p className="voy-modelcard__note">{t("localai.card.needsRunning")}</p>
      ) : null}

      {result ? (
        <p
          className={`voy-modelcard__result voy-modelcard__result--${result.ok ? "ok" : "err"}`}
          role={result.ok ? "status" : "alert"}
        >
          {result.message}
        </p>
      ) : null}
    </li>
  );
}

/** The recommended-model cards, shared across the setup states. */
function ModelCards({
  canDownload,
  onDownloaded,
}: {
  canDownload: boolean;
  onDownloaded: () => void;
}) {
  return (
    <ul className="voy-modelcards" aria-label={t("localai.recommended.aria")}>
      {RECOMMENDED_MODELS.map((model) => (
        <ModelCard
          key={model.id}
          model={model}
          canDownload={canDownload}
          onDownloaded={onDownloaded}
        />
      ))}
    </ul>
  );
}

/** Install → start → get-a-model steps, shown when no runtime is detected. */
function SetupSteps() {
  return (
    <div className="voy-localai__setup">
      <p className="voy-localai__detail">{t("localai.setup.lead")}</p>
      <ol className="voy-localai__steps">
        <li>
          <span className="voy-localai__step-title">
            {t("localai.step.install.title")}
          </span>
          <p className="voy-localai__detail">
            {t("localai.step.install.before")}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("localai.ollama")}
              <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
            </a>
            {t("localai.step.install.after")}
          </p>
        </li>
        <li>
          <span className="voy-localai__step-title">
            {t("localai.step.start.title")}
          </span>
          <p className="voy-localai__detail">{t("localai.step.start.body")}</p>
        </li>
        <li>
          <span className="voy-localai__step-title">
            {t("localai.step.model.title")}
          </span>
          <p className="voy-localai__detail">{t("localai.step.model.body")}</p>
        </li>
      </ol>
    </div>
  );
}

/**
 * Advisory, user-initiated setup of an optional on-device AI runtime (Ollama).
 * Device-AI availability is not per-trip, so Voyalier probes only when asked. When
 * nothing is detected it guides install → start → download; when Ollama is running
 * it can download a model in-app. Everything here is local — no inference runs and
 * nothing leaves the device — and Voyalier stays fully usable regardless.
 */
export function OnDeviceAi() {
  const gateway = useGateway();
  const [status, setStatus] = useState<LocalAiStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  async function check() {
    setChecking(true);
    try {
      setStatus(await gateway.detectLocalAi());
    } catch {
      setStatus({ provider: "ollama", available: false, models: [] });
    } finally {
      setChecking(false);
      setChecked(true);
    }
  }

  const detected = status?.available === true;
  const models = status?.models ?? [];

  return (
    <section className="voy-localai" aria-labelledby="localai-title">
      <div className="voy-localai__head">
        <h2 id="localai-title" className="voy-localai__title">
          {t("localai.title")}
        </h2>
        {checked ? (
          <span
            className={`voy-localai__badge voy-localai__badge--${detected ? "on" : "off"}`}
          >
            {detected
              ? t("localai.badge.available")
              : t("localai.badge.notDetected")}
          </span>
        ) : null}
      </div>

      {!checked ? (
        <p className="voy-localai__detail">{t("localai.precheck")}</p>
      ) : detected ? (
        models.length > 0 ? (
          <>
            <p className="voy-localai__detail">
              {plural("localai.running", models.length)}
            </p>
            <ul
              className="voy-localai__models"
              aria-label={t("localai.models.aria")}
            >
              {models.map((model) => (
                <li key={model.name}>{model.name}</li>
              ))}
            </ul>
            <details className="voy-localai__more">
              <summary>{t("localai.addAnother")}</summary>
              <ModelCards canDownload onDownloaded={check} />
            </details>
          </>
        ) : (
          <>
            <p className="voy-localai__detail">{t("localai.nomodels.lead")}</p>
            <ModelCards canDownload onDownloaded={check} />
          </>
        )
      ) : (
        <>
          <SetupSteps />
          <ModelCards canDownload={false} onDownloaded={check} />
        </>
      )}

      <div className="voy-localai__actions">
        <Button variant="secondary" onClick={check} busy={checking}>
          {checked ? t("action.checkAgain") : t("localai.check")}
        </Button>
      </div>

      <p className="voy-localai__scope">{t("localai.scope")}</p>
    </section>
  );
}
