import { useId, useState } from "react";
import type {
  AppError,
  AssistActivityEntry,
  AssistReply,
  AssistRequestPreview,
  ProviderId,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError, formatDateTimeLocal } from "../app/format";
import { t, type MessageKey } from "../app/i18n";
import { Button } from "../components/Button";

/** Static labels for the picker; the authoritative label comes back on the preview. */
const PROVIDER_OPTIONS: { id: ProviderId; labelKey: MessageKey }[] = [
  { id: "ollama", labelKey: "assist.provider.ollama" },
  { id: "openai", labelKey: "assist.provider.openai" },
  { id: "anthropic", labelKey: "assist.provider.anthropic" },
];

/**
 * Shows exactly what Voyalier would send to a provider for this trip — the
 * consent step — and lets the user run it. The request is built on-device with
 * confirmation codes and traveler names excluded by construction, so they could
 * never reach a provider. Previewing sends nothing; running sends the shown
 * request (on-device for Ollama, to the provider for cloud) and logs it.
 */
export function AssistPreview({ tripId }: { tripId: string }) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const selectId = useId();
  const [provider, setProvider] = useState<ProviderId>("ollama");
  const [preview, setPreview] = useState<AssistRequestPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<AssistReply | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activity, setActivity] = useState<AssistActivityEntry[]>([]);

  async function refreshActivity() {
    try {
      setActivity(await gateway.listAssistActivity(tripId));
    } catch {
      // The log is a transparency aid; a read failure must not block assist.
    }
  }

  async function load() {
    setError(null);
    setReply(null); // a new preview supersedes any earlier reply
    setRunError(null);
    setLoading(true);
    try {
      const result = await gateway.previewAssist(tripId, provider);
      setPreview(result);
      // Surface past runs now that the user is engaging with assist.
      void refreshActivity();
      announce(
        result.leavesDevice
          ? t("assist.announce.previewCloud", {
              provider: result.providerLabel,
            })
          : t("assist.announce.previewLocal"),
      );
    } catch (caught) {
      setPreview(null);
      setError(describeError(caught as AppError).title);
    } finally {
      setLoading(false);
    }
  }

  async function run() {
    if (!preview) return;
    setRunError(null);
    setRunning(true);
    try {
      const result = await gateway.runAssist(tripId, preview.provider);
      setReply(result);
      void refreshActivity();
      announce(t("assist.announce.finished", { model: result.model }));
    } catch (caught) {
      setReply(null);
      const appError = caught as AppError;
      // Validation errors (e.g. "add an API key first") carry a useful message.
      setRunError(
        appError.code === "validation/invalid_input"
          ? appError.message
          : describeError(appError).title,
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="voy-assist" aria-labelledby="assist-title">
      <h2 id="assist-title" className="voy-assist__title">
        {t("assist.title")}
      </h2>
      <p className="voy-assist__intro">{t("assist.intro")}</p>

      <div className="voy-assist__controls">
        <label className="voy-sr-only" htmlFor={selectId}>
          {t("assist.selectLabel")}
        </label>
        <select
          id={selectId}
          className="voy-assist__select"
          value={provider}
          onChange={(event) => setProvider(event.target.value as ProviderId)}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={load} busy={loading}>
          {t("assist.preview")}
        </Button>
      </div>

      {error ? (
        <p className="voy-assist__error" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="voy-assist__result">
          <p
            className={`voy-assist__route voy-assist__route--${
              preview.leavesDevice ? "cloud" : "local"
            }`}
          >
            {preview.leavesDevice
              ? t("assist.route.cloud", { provider: preview.providerLabel })
              : t("assist.route.local", {
                  provider: preview.providerLabel,
                })}{" "}
            <span className="voy-assist__endpoint">{preview.endpoint}</span>
          </p>
          {preview.model ? (
            <p className="voy-assist__model">
              {t("assist.model", { model: preview.model })}
            </p>
          ) : null}
          <p className="voy-assist__meta">
            {preview.groundedIn.length > 0
              ? t("assist.grounded", { sources: preview.groundedIn.join(", ") })
              : t("assist.noGrounding")}
            {" · "}
            {t("assist.tokens", { tokens: preview.estimatedTokens })}
          </p>

          <h3 className="voy-assist__subhead">
            {t("assist.systemInstruction")}
          </h3>
          <pre className="voy-assist__block">{preview.systemPrompt}</pre>

          <h3 className="voy-assist__subhead">{t("assist.tripDetails")}</h3>
          <pre className="voy-assist__block">{preview.userContent}</pre>

          {preview.withheld.length > 0 ? (
            <>
              <h3 className="voy-assist__subhead">{t("assist.withheld")}</h3>
              <ul className="voy-assist__withheld">
                {preview.withheld.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="voy-assist__run">
            <Button variant="primary" onClick={run} busy={running}>
              {preview.leavesDevice
                ? t("assist.send", { provider: preview.providerLabel })
                : t("assist.runLocal")}
            </Button>
            {preview.leavesDevice ? (
              <p className="voy-assist__note">
                {t("assist.note", { provider: preview.providerLabel })}
              </p>
            ) : null}
            {runError ? (
              <p className="voy-assist__error" role="alert">
                {runError}
              </p>
            ) : null}
            {reply ? (
              <>
                <h3 className="voy-assist__subhead">
                  {t("assist.reply", { model: reply.model })}
                </h3>
                <pre className="voy-assist__block">{reply.text}</pre>
                <p className="voy-assist__disclaimer">
                  {t("assist.disclaimer")}
                </p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {activity.length > 0 ? (
        <div className="voy-assist__activity">
          <h3 className="voy-assist__subhead">{t("assist.recentRuns")}</h3>
          <ul className="voy-assist__log" aria-label={t("assist.log.aria")}>
            {activity.map((entry) => (
              <li key={entry.id} className="voy-assist__log-item">
                <span className="voy-assist__log-model">{entry.model}</span>
                <span className="voy-assist__log-time">
                  {formatDateTimeLocal(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="voy-assist__scope">{t("assist.scope")}</p>
    </section>
  );
}
