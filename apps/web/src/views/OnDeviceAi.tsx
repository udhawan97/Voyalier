import { useState } from "react";
import type { LocalAiStatus } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { pluralize } from "../app/format";
import { Button } from "../components/Button";

/**
 * Advisory, user-initiated detection of an optional on-device AI runtime
 * (Ollama). Device-AI availability is not per-trip, so Voyalier probes only when
 * asked rather than on every trip open. The probe is a local check — no
 * inference happens and nothing leaves the device — and any failure is treated
 * as "not detected". Voyalier stays fully usable regardless.
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
          On-device AI
        </h2>
        {checked ? (
          <span
            className={`voy-localai__badge voy-localai__badge--${detected ? "on" : "off"}`}
          >
            {detected ? "Available" : "Not detected"}
          </span>
        ) : null}
      </div>

      {!checked ? (
        <p className="voy-localai__detail">
          Voyalier can use a local Ollama for optional, private assist — nothing
          would leave your device. Check whether one is running.
        </p>
      ) : detected ? (
        models.length > 0 ? (
          <>
            <p className="voy-localai__detail">
              Ollama is running with {models.length}{" "}
              {pluralize(models.length, "model")} installed. Voyalier can use{" "}
              {models.length === 1 ? "it" : "them"} for optional, private assist
              — nothing leaves your device.
            </p>
            <ul className="voy-localai__models" aria-label="Installed models">
              {models.map((model) => (
                <li key={model.name}>{model.name}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="voy-localai__detail">
            Ollama is running but no models are installed. Pull one (for example{" "}
            <code>ollama pull llama3.2</code>) to enable optional on-device
            assist.
          </p>
        )
      ) : (
        <p className="voy-localai__detail">
          No on-device AI detected. Install{" "}
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            Ollama
            <span className="voy-sr-only"> (opens in new tab)</span>
          </a>{" "}
          to enable optional, private assist. Voyalier stays fully usable
          without it.
        </p>
      )}

      <div className="voy-localai__actions">
        <Button variant="secondary" onClick={check} busy={checking}>
          {checked ? "Check again" : "Check for on-device AI"}
        </Button>
      </div>

      <p className="voy-localai__scope">
        Detection only — a local check on this device. Assist that uses these
        models is a later milestone and will always be opt-in.
      </p>
    </section>
  );
}
