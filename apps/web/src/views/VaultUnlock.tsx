import { useState } from "react";

import { useGateway } from "../app/context";
import { t } from "../app/i18n";
import { Button } from "../components/Button";
import { LockIcon } from "../components/icons";

/**
 * Full-screen gate shown when the vault is locked (a passphrase is set but not
 * yet entered this session). Nothing else in the app can read encrypted trip
 * data until it is unlocked, so this stands in for the whole workspace.
 */
export function VaultUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const gateway = useGateway();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await gateway.unlockVault(passphrase);
      setPassphrase("");
      onUnlocked();
    } catch {
      setError(t("vault.unlock.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="voy-unlock" aria-labelledby="unlock-title">
      <div className="voy-unlock__card">
        <LockIcon className="voy-unlock__icon" aria-hidden="true" />
        <h1 id="unlock-title" className="voy-unlock__title">
          {t("vault.unlock.title")}
        </h1>
        <p className="voy-unlock__intro">{t("vault.unlock.intro")}</p>
        <form className="voy-unlock__form" onSubmit={submit}>
          <label className="voy-sr-only" htmlFor="unlock-input">
            {t("vault.unlock.passphrase")}
          </label>
          <input
            id="unlock-input"
            className="voy-unlock__input"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            autoFocus
            placeholder={t("vault.unlock.passphrase")}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={passphrase.length === 0}
          >
            {t("vault.unlock.action")}
          </Button>
        </form>
        {error ? (
          <p className="voy-unlock__error" role="alert">
            {error}
          </p>
        ) : null}
        <details className="voy-unlock__forgot">
          <summary>{t("vault.unlock.forgot")}</summary>
          <p>{t("vault.unlock.forgot.body")}</p>
        </details>
      </div>
    </section>
  );
}
