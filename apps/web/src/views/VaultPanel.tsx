import { useEffect, useState } from "react";
import type { AppError, VaultStatus } from "@voyalier/contracts";

import { useAnnounce, useGateway } from "../app/context";
import { t } from "../app/i18n";
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
      setError((caught as AppError).message || t("vault.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;

  return (
    <section className="voy-vault" aria-labelledby="vault-title">
      <h2 id="vault-title" className="voy-vault__title">
        <LockIcon className="voy-vault__title-icon" aria-hidden="true" />
        {t("vault.section")}
      </h2>

      {!status.active ? (
        <p className="voy-vault__note">{t("vault.inactive")}</p>
      ) : (
        <>
          <p className="voy-vault__intro">
            {t("vault.intro.base")}
            {status.protected
              ? t("vault.intro.protected")
              : t("vault.intro.unprotected")}
          </p>

          <p
            className={`voy-vault__state voy-vault__state--${
              status.protected ? "on" : "off"
            }`}
          >
            {status.protected ? t("vault.state.on") : t("vault.state.off")}
          </p>

          {status.protected ? (
            mode === "removing" ? (
              <form
                className="voy-vault__form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void apply(
                    () => gateway.removeVaultPassphrase(passphrase),
                    t("vault.announce.removed"),
                  );
                }}
              >
                <label className="voy-sr-only" htmlFor="vault-remove">
                  {t("vault.currentPassphrase")}
                </label>
                <input
                  id="vault-remove"
                  className="voy-vault__input"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("vault.currentPassphrase.placeholder")}
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
                    {t("vault.action.remove")}
                  </Button>
                  <Button variant="ghost" onClick={reset} disabled={busy}>
                    {t("vault.action.cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="ghost" onClick={() => setMode("removing")}>
                {t("vault.action.remove")}
              </Button>
            )
          ) : mode === "setting" ? (
            <form
              className="voy-vault__form"
              onSubmit={(event) => {
                event.preventDefault();
                if (passphrase.length < MIN_PASSPHRASE) {
                  setError(t("vault.error.tooShort", { min: MIN_PASSPHRASE }));
                  return;
                }
                if (passphrase !== confirm) {
                  setError(t("vault.error.mismatch"));
                  return;
                }
                void apply(
                  () => gateway.setVaultPassphrase(passphrase),
                  t("vault.announce.set"),
                );
              }}
            >
              <label className="voy-sr-only" htmlFor="vault-new">
                {t("vault.newPassphrase")}
              </label>
              <input
                id="vault-new"
                className="voy-vault__input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={t("vault.newPassphrase.placeholder", {
                  min: MIN_PASSPHRASE,
                })}
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <label className="voy-sr-only" htmlFor="vault-confirm">
                {t("vault.confirmPassphrase")}
              </label>
              <input
                id="vault-confirm"
                className="voy-vault__input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={t("vault.confirmPassphrase.placeholder")}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
              <p className="voy-vault__warn">{t("vault.warn.noRecovery")}</p>
              <div className="voy-vault__actions">
                <Button
                  type="submit"
                  variant="secondary"
                  busy={busy}
                  disabled={passphrase.length === 0}
                >
                  {t("vault.action.set")}
                </Button>
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  {t("vault.action.cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setMode("setting")}>
              {t("vault.action.add")}
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
