import { useState } from "react";
import type { AppError, ProviderConfig } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { t } from "../app/i18n";
import { Button } from "../components/Button";

type Busy = null | "key" | "clear" | "model";

function statusLabel(config: ProviderConfig): string {
  if (!config.keyRequired) return t("providers.status.onDevice");
  return config.hasKey
    ? t("providers.status.keyStored")
    : t("providers.status.noKey");
}

function ProviderRow({
  config,
  onChanged,
}: {
  config: ProviderConfig;
  onChanged: (updated: ProviderConfig) => void;
}) {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(config.model ?? "");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    kind: Busy,
    action: () => Promise<ProviderConfig>,
    done: string,
  ) {
    setError(null);
    setBusy(kind);
    try {
      onChanged(await action());
      announce(done);
    } catch (caught) {
      setError((caught as AppError).message || t("providers.error"));
    } finally {
      setBusy(null);
    }
  }

  const modelDirty =
    modelInput.trim().length > 0 && modelInput.trim() !== (config.model ?? "");

  return (
    <li className="voy-providers__row">
      <div className="voy-providers__row-head">
        <span className="voy-providers__name">{config.label}</span>
        <span
          className={`voy-providers__status voy-providers__status--${config.hasKey ? "on" : "off"}`}
        >
          {statusLabel(config)}
        </span>
      </div>

      {config.keyRequired ? (
        config.hasKey ? (
          <div className="voy-providers__keyrow">
            <span className="voy-providers__stored">
              {t("providers.stored")}
            </span>
            <Button
              variant="ghost"
              busy={busy === "clear"}
              onClick={() =>
                run(
                  "clear",
                  () => gateway.clearProviderKey(config.id),
                  t("providers.announce.keyRemoved", {
                    provider: config.label,
                  }),
                )
              }
            >
              {t("providers.removeKey")}
            </Button>
          </div>
        ) : (
          <div className="voy-providers__keyrow">
            <label className="voy-sr-only" htmlFor={`key-${config.id}`}>
              {t("providers.apiKey", { provider: config.label })}
            </label>
            <input
              id={`key-${config.id}`}
              className="voy-providers__input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={t("providers.apiKey.placeholder")}
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
            />
            <Button
              variant="secondary"
              busy={busy === "key"}
              disabled={keyInput.trim().length === 0}
              onClick={() =>
                run(
                  "key",
                  async () => {
                    const updated = await gateway.setProviderKey({
                      provider: config.id,
                      key: keyInput,
                    });
                    setKeyInput(""); // never retain the key in the DOM
                    return updated;
                  },
                  t("providers.announce.keySaved", { provider: config.label }),
                )
              }
            >
              {t("providers.saveKey")}
            </Button>
          </div>
        )
      ) : (
        <p className="voy-providers__note">{t("providers.onDeviceNote")}</p>
      )}

      <div className="voy-providers__modelrow">
        <label className="voy-sr-only" htmlFor={`model-${config.id}`}>
          {t("providers.model.label", { provider: config.label })}
        </label>
        <input
          id={`model-${config.id}`}
          className="voy-providers__input"
          type="text"
          autoComplete="off"
          placeholder={t("providers.model.placeholder")}
          value={modelInput}
          onChange={(event) => setModelInput(event.target.value)}
        />
        <Button
          variant="ghost"
          busy={busy === "model"}
          disabled={!modelDirty}
          onClick={() =>
            run(
              "model",
              () =>
                gateway.setProviderModel({
                  provider: config.id,
                  model: modelInput,
                }),
              t("providers.announce.modelSaved", { provider: config.label }),
            )
          }
        >
          {t("providers.saveModel")}
        </Button>
      </div>

      {error ? (
        <p className="voy-providers__error" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * BYOK provider configuration. Lazy — nothing is read until "Manage AI
 * providers" is clicked — so opening a trip never touches the keychain. Keys are
 * write-only: entered here, stored in the OS keychain, and never returned,
 * rendered, or persisted in the DOM. A stored key is used only to send a
 * previewed request when the user chooses to, under "Preview an AI request".
 */
export function AiProviders() {
  const gateway = useGateway();
  const [providers, setProviders] = useState<ProviderConfig[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setProviders(await gateway.listProviders());
    } finally {
      setLoading(false);
    }
  }

  function apply(updated: ProviderConfig) {
    setProviders(
      (prev) =>
        prev?.map((config) => (config.id === updated.id ? updated : config)) ??
        null,
    );
  }

  return (
    <section className="voy-providers" aria-labelledby="providers-title">
      <h2 id="providers-title" className="voy-providers__title">
        {t("providers.title")}
      </h2>

      {providers === null ? (
        <>
          <p className="voy-providers__intro">{t("providers.intro")}</p>
          <Button variant="secondary" busy={loading} onClick={load}>
            {t("providers.manage")}
          </Button>
        </>
      ) : (
        <ul className="voy-providers__list">
          {providers.map((config) => (
            <ProviderRow key={config.id} config={config} onChanged={apply} />
          ))}
        </ul>
      )}

      <p className="voy-providers__scope">{t("providers.scope")}</p>
    </section>
  );
}
