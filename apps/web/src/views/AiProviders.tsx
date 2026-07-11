import { useState } from "react";
import type { AppError, ProviderConfig } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { Button } from "../components/Button";

type Busy = null | "key" | "clear" | "model";

function statusLabel(config: ProviderConfig): string {
  if (!config.keyRequired) return "On-device";
  return config.hasKey ? "Key stored" : "No key";
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
      setError(
        (caught as AppError).message || "That didn't work — nothing changed.",
      );
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
              API key stored in your keychain.
            </span>
            <Button
              variant="ghost"
              busy={busy === "clear"}
              onClick={() =>
                run(
                  "clear",
                  () => gateway.clearProviderKey(config.id),
                  `${config.label} key removed.`,
                )
              }
            >
              Remove key
            </Button>
          </div>
        ) : (
          <div className="voy-providers__keyrow">
            <label className="voy-sr-only" htmlFor={`key-${config.id}`}>
              {config.label} API key
            </label>
            <input
              id={`key-${config.id}`}
              className="voy-providers__input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your API key"
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
                  `${config.label} key saved.`,
                )
              }
            >
              Save key
            </Button>
          </div>
        )
      ) : (
        <p className="voy-providers__note">
          Runs locally on this device — no key needed.
        </p>
      )}

      <div className="voy-providers__modelrow">
        <label className="voy-sr-only" htmlFor={`model-${config.id}`}>
          {config.label} model
        </label>
        <input
          id={`model-${config.id}`}
          className="voy-providers__input"
          type="text"
          autoComplete="off"
          placeholder="Model (optional)"
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
              `${config.label} model saved.`,
            )
          }
        >
          Save model
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
 * rendered, or persisted in the DOM. Cloud assist itself is a later, opt-in
 * milestone.
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
        AI providers
      </h2>

      {providers === null ? (
        <>
          <p className="voy-providers__intro">
            Bring your own OpenAI or Anthropic key for optional cloud assist.
            Keys are stored in your device's keychain — never in Voyalier's
            files or any shared server.
          </p>
          <Button variant="secondary" busy={loading} onClick={load}>
            Manage AI providers
          </Button>
        </>
      ) : (
        <ul className="voy-providers__list">
          {providers.map((config) => (
            <ProviderRow key={config.id} config={config} onChanged={apply} />
          ))}
        </ul>
      )}

      <p className="voy-providers__scope">
        Keys stay in your OS keychain and never leave your device. Using a
        provider for assist is a later, opt-in milestone.
      </p>
    </section>
  );
}
