import { useState } from "react";
import type { AppError, ProviderConfig, ProviderId } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { t } from "../app/i18n";
import { SectionTitle } from "../components/primitives";
import { KeyIcon } from "../components/icons";
import { Button } from "../components/Button";
import { ConfirmButton } from "../components/ConfirmButton";

type Busy = null | "key" | "clear" | "model";

/** Where each cloud provider mints an API key — shown in the "how to get a key" guide. */
const KEY_HELP: Partial<Record<ProviderId, string>> = {
  openai: "https://platform.openai.com/api-keys",
  anthropic: "https://console.anthropic.com/settings/keys",
};

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

  /**
   * Validate the pasted key against the provider, then store it only if it
   * wasn't actively rejected. A rejection (bad/revoked key) blocks the save; an
   * inconclusive check (offline) saves anyway with a "couldn't verify" note so a
   * transient hiccup never traps a valid key. The key is cleared from the DOM the
   * moment it's stored and is never rendered back.
   */
  async function saveKey() {
    setError(null);
    setBusy("key");
    try {
      const verdict = await gateway.validateProviderKey({
        provider: config.id,
        key: keyInput,
      });
      if (verdict.status === "rejected") {
        setError(verdict.message);
        return;
      }
      const updated = await gateway.setProviderKey({
        provider: config.id,
        key: keyInput,
      });
      setKeyInput("");
      onChanged(updated);
      announce(
        verdict.status === "valid"
          ? t("providers.announce.keyVerified", { provider: config.label })
          : t("providers.announce.keySavedUnverified", {
              provider: config.label,
            }),
      );
    } catch (caught) {
      setError((caught as AppError).message || t("providers.error"));
    } finally {
      setBusy(null);
    }
  }

  const help = KEY_HELP[config.id];
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
            <ConfirmButton
              label={t("providers.removeKey")}
              busy={busy === "clear"}
              onConfirm={() =>
                run(
                  "clear",
                  () => gateway.clearProviderKey(config.id),
                  t("providers.announce.keyRemoved", {
                    provider: config.label,
                  }),
                )
              }
            />
          </div>
        ) : (
          <div className="voy-providers__keyblock">
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
                onClick={saveKey}
              >
                {t("providers.validateSave")}
              </Button>
            </div>
            {help ? (
              <details className="voy-providers__help">
                <summary>{t("providers.help.summary")}</summary>
                <p className="voy-providers__help-intro">
                  {t("providers.help.intro", { provider: config.label })}
                </p>
                <ol className="voy-providers__help-steps">
                  <li>
                    {t("providers.help.step.account", {
                      provider: config.label,
                    })}
                  </li>
                  <li>
                    {t("providers.help.step.create.before")}
                    <a href={help} target="_blank" rel="noreferrer noopener">
                      {t("providers.help.step.create.link")}
                      <span className="voy-sr-only">
                        {t("a11y.opensInNewTab")}
                      </span>
                    </a>
                    {t("providers.help.step.create.after")}
                  </li>
                  <li>{t("providers.help.step.paste")}</li>
                </ol>
              </details>
            ) : null}
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
      <SectionTitle id="providers-title" icon={<KeyIcon />}>
        {t("providers.title")}
      </SectionTitle>

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
