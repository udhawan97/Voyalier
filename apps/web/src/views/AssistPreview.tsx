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
import { Button } from "../components/Button";

/** Static labels for the picker; the authoritative label comes back on the preview. */
const PROVIDER_OPTIONS: { id: ProviderId; label: string }[] = [
  { id: "ollama", label: "Ollama (on-device)" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
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
          ? `Preview ready. This request would leave your device to ${result.providerLabel}.`
          : "Preview ready. This request would run locally on this device.",
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
      announce(`Assist finished with ${result.model}.`);
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
        Preview an AI request
      </h2>
      <p className="voy-assist__intro">
        See exactly what Voyalier would send to a provider for this trip.
        Confirmation codes and traveler names are never included, and nothing is
        sent.
      </p>

      <div className="voy-assist__controls">
        <label className="voy-sr-only" htmlFor={selectId}>
          Provider to preview
        </label>
        <select
          id={selectId}
          className="voy-assist__select"
          value={provider}
          onChange={(event) => setProvider(event.target.value as ProviderId)}
        >
          {PROVIDER_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={load} busy={loading}>
          Preview request
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
              ? `This request would leave your device to ${preview.providerLabel}.`
              : `This request would run locally on this device via ${preview.providerLabel}.`}{" "}
            <span className="voy-assist__endpoint">{preview.endpoint}</span>
          </p>
          {preview.model ? (
            <p className="voy-assist__model">Model: {preview.model}</p>
          ) : null}
          <p className="voy-assist__meta">
            {preview.groundedIn.length > 0
              ? `Grounded in ${preview.groundedIn.join(", ")}`
              : "No confirmed plans to ground in yet"}
            {" · "}~{preview.estimatedTokens} tokens
          </p>

          <h3 className="voy-assist__subhead">System instruction</h3>
          <pre className="voy-assist__block">{preview.systemPrompt}</pre>

          <h3 className="voy-assist__subhead">Trip details it would include</h3>
          <pre className="voy-assist__block">{preview.userContent}</pre>

          {preview.withheld.length > 0 ? (
            <>
              <h3 className="voy-assist__subhead">Withheld from the request</h3>
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
                ? `Send to ${preview.providerLabel}`
                : "Run on-device assist"}
            </Button>
            {preview.leavesDevice ? (
              <p className="voy-assist__note">
                This sends the request above to {preview.providerLabel} using
                your stored key. Add one under AI providers first if you
                haven’t.
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
                  Reply from {reply.model}
                </h3>
                <pre className="voy-assist__block">{reply.text}</pre>
                <p className="voy-assist__disclaimer">
                  AI-generated from your confirmed plans. Voyalier never treats
                  this as authoritative — verify anything important (entry
                  rules, health, safety) against an official source.
                </p>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {activity.length > 0 ? (
        <div className="voy-assist__activity">
          <h3 className="voy-assist__subhead">Recent assist runs</h3>
          <ul className="voy-assist__log" aria-label="Assist activity log">
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

      <p className="voy-assist__scope">
        Preview shows exactly what would be sent. On-device runs stay on this
        device via Ollama; cloud runs send the previewed request to your chosen
        provider using your stored key. Each completed run is listed above.
      </p>
    </section>
  );
}
