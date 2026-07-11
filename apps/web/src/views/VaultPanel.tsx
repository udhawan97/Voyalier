import { useEffect, useState } from "react";
import type { AppError, VaultStatus } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { Button } from "../components/Button";
import { LockIcon } from "../components/icons";

const MIN_PASSPHRASE = 8;

type Mode = "idle" | "setting" | "removing";

/**
 * The optional-passphrase control for the encrypted vault. Trip data
 * (confirmation codes, traveler names) is always encrypted at rest with a key in
 * the OS keychain; a passphrase is a second factor that also protects it if
 * someone reaches an already-unlocked machine. Setting one removes the key from
 * the keychain, so the app asks for the passphrase on the next launch.
 *
 * The passphrase is only ever sent to the local core to derive a key; it is
 * never stored, returned, or logged.
 */
export function VaultPanel() {
  const gateway = useGateway();
  const announce = useAnnounce();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    gateway.getVaultStatus().then(
      (next) => {
        if (live) setStatus(next);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [gateway]);

  function reset() {
    setMode("idle");
    setPassphrase("");
    setConfirm("");
    setError(null);
  }

  async function apply(action: () => Promise<VaultStatus>, done: string) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      announce(done);
      reset();
    } catch (caught) {
      setError((caught as AppError).message || "That didn't work.");
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;

  return (
    <section className="voy-vault" aria-labelledby="vault-title">
      <h2 id="vault-title" className="voy-vault__title">
        <LockIcon className="voy-vault__title-icon" aria-hidden="true" />
        Encryption
      </h2>

      {!status.active ? (
        <p className="voy-vault__note">
          A device keychain isn't available here, so sensitive fields are stored
          as plaintext and a passphrase can't be added. On macOS and Windows,
          Voyalier encrypts them automatically.
        </p>
      ) : (
        <>
          <p className="voy-vault__intro">
            Confirmation codes and traveler names are encrypted on this device.
            {status.protected
              ? " A passphrase you chose also guards the key — Voyalier asks for it when it launches."
              : " Add a passphrase for a second layer that protects your data even on an unlocked computer."}
          </p>

          <p
            className={`voy-vault__state voy-vault__state--${
              status.protected ? "on" : "off"
            }`}
          >
            {status.protected
              ? "Passphrase protection is on."
              : "Passphrase protection is off."}
          </p>

          {status.protected ? (
            mode === "removing" ? (
              <form
                className="voy-vault__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void apply(
                    () => gateway.removeVaultPassphrase(passphrase),
                    "Passphrase removed.",
                  );
                }}
              >
                <label className="voy-sr-only" htmlFor="vault-remove">
                  Current passphrase
                </label>
                <input
                  id="vault-remove"
                  className="voy-vault__input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Enter your current passphrase"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                />
                <div className="voy-vault__actions">
                  <Button
                    type="submit"
                    variant="danger"
                    busy={busy}
                    disabled={passphrase.length === 0}
                  >
                    Remove passphrase
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" onClick={() => setMode("removing")}>
                Remove passphrase
              </Button>
            )
          ) : mode === "setting" ? (
            <form
              className="voy-vault__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (passphrase.length < MIN_PASSPHRASE) {
                  setError(`Use at least ${MIN_PASSPHRASE} characters.`);
                  return;
                }
                if (passphrase !== confirm) {
                  setError("The two passphrases don't match.");
                  return;
                }
                void apply(
                  () => gateway.setVaultPassphrase(passphrase),
                  "Passphrase set.",
                );
              }}
            >
              <label className="voy-sr-only" htmlFor="vault-new">
                New passphrase
              </label>
              <input
                id="vault-new"
                className="voy-vault__input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={`New passphrase (${MIN_PASSPHRASE}+ characters)`}
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <label className="voy-sr-only" htmlFor="vault-confirm">
                Confirm passphrase
              </label>
              <input
                id="vault-confirm"
                className="voy-vault__input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder="Confirm passphrase"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
              <p className="voy-vault__warn">
                There is no recovery if you forget it — Voyalier can't reset a
                passphrase it never stores.
              </p>
              <div className="voy-vault__actions">
                <Button
                  type="submit"
                  variant="secondary"
                  busy={busy}
                  disabled={passphrase.length === 0}
                >
                  Set passphrase
                </Button>
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setMode("setting")}>
              Add a passphrase
            </Button>
          )}
        </>
      )}

      {error ? (
        <p className="voy-vault__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
