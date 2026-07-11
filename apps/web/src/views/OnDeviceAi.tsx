import { useState } from "react";
import type { LocalAiStatus } from "@voyalier/contracts";

import { useGateway } from "../app/context";
import { pluralize } from "../app/format";
import { t } from "../app/i18n";
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
            {/* Count sentence keeps English pluralize()/it-them; a proper
                Intl.PluralRules pass will move it onto t() later. */}
            <p className="voy-localai__detail">
              Ollama is running with {models.length}{" "}
              {pluralize(models.length, "model")} installed. Voyalier can use{" "}
              {models.length === 1 ? "it" : "them"} for optional, private assist
              — nothing leaves your device.
            </p>
            <ul
              className="voy-localai__models"
              aria-label={t("localai.models.aria")}
            >
              {models.map((model) => (
                <li key={model.name}>{model.name}</li>
              ))}
            </ul>
          </>
        ) : (
          <p className="voy-localai__detail">
            {t("localai.noModels.before")}
            <code>ollama pull llama3.2</code>
            {t("localai.noModels.after")}
          </p>
        )
      ) : (
        <p className="voy-localai__detail">
          {t("localai.notDetected.before")}
          <a
            href="https://ollama.com"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("localai.ollama")}
            <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
          </a>
          {t("localai.notDetected.after")}
        </p>
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
