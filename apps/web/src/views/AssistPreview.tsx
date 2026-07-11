import { useId, useState } from "react";
import type {
  AppError,
  AssistReply,
  AssistRequestPreview,
  ProviderId,
} from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { describeError } from "../app/format";
import { Button } from "../components/Button";

/** Static labels for the picker; the authoritative label comes back on the preview. */
const PROVIDER_OPTIONS: { id: ProviderId; label: string }[] = [
  { id: "ollama", label: "Ollama (on-device)" },
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
];

/**
 * Shows exactly what Voyalier would send to a provider for this trip — the
 * consent step before any assist call exists. The request is built on-device
 * with confirmation codes and traveler names excluded by construction, so they
 * could never reach a provider. Nothing is transmitted; this is a preview only.
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

  async function load() {
    setError(null);
    setReply(null); // a new preview supersedes any earlier reply
    setRunError(null);
    setLoading(true);
    try {
      const result = await gateway.previewAssist(tripId, provider);
      setPreview(result);
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
      announce(`On-device assist finished with ${result.model}.`);
    } catch (caught) {
      setReply(null);
      setRunError(describeError(caught as AppError).title);
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

          {preview.leavesDevice ? (
            <p className="voy-assist__note">
              Cloud assist isn’t available yet — this stays a preview. Run
              on-device with Ollama to actually generate a reply.
            </p>
          ) : (
            <div className="voy-assist__run">
              <Button variant="primary" onClick={run} busy={running}>
                Run on-device assist
              </Button>
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
                    AI-generated from your confirmed plans. Voyalier never
                    treats this as authoritative — verify anything important
                    (entry rules, health, safety) against an official source.
                  </p>
                </>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <p className="voy-assist__scope">
        Preview shows exactly what would be sent. On-device runs stay on this
        device via Ollama; cloud providers remain preview-only for now.
      </p>
    </section>
  );
}
