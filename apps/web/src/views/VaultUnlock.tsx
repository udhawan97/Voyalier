import { useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { useGateway } from "../app/context";
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
    } catch (caught) {
      setError((caught as AppError).message || "That passphrase didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="voy-unlock" aria-labelledby="unlock-title">
      <div className="voy-unlock__card">
        <LockIcon className="voy-unlock__icon" aria-hidden="true" />
        <h1 id="unlock-title" className="voy-unlock__title">
          Your vault is locked
        </h1>
        <p className="voy-unlock__intro">
          Enter your passphrase to open this workspace. It's used only on this
          device to unlock your encrypted trip data.
        </p>
        <form className="voy-unlock__form" onSubmit={submit}>
          <label className="voy-sr-only" htmlFor="unlock-input">
            Passphrase
          </label>
          <input
            id="unlock-input"
            className="voy-unlock__input"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            autoFocus
            placeholder="Passphrase"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            disabled={passphrase.length === 0}
          >
            Unlock
          </Button>
        </form>
        {error ? (
          <p className="voy-unlock__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
