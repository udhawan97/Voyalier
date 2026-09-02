import { useState } from "react";
import type { VaultStatus } from "@voyalier/contracts";

import { useAnnounce, useGateway, useVaultStatus } from "../app/context";
import { describeError } from "../app/format";
import { t } from "../app/i18n";
import { useAsyncAction } from "../app/useAsync";
import { Button } from "../components/Button";
import { SectionTitle } from "../components/primitives";
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
  const [mode, setMode] = useState<Mode>("idle");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  /** Local rules the traveler can fix by typing — length, and the two fields agreeing. */
  const [invalid, setInvalid] = useState<string | null>(null);

  // The status read used to swallow its rejection with an empty handler, and
  // `status === null` renders nothing, so an unreachable engine made the whole
  // vault section vanish out of Settings with no explanation at all.
  const vault = useVaultStatus();
  const status = vault.data;

  function reset() {
    setMode("idle");
    setPassphrase("");
    setConfirm("");
    setInvalid(null);
  }

  // The write half. It reported nothing to the topbar, so setting a passphrase
  // against a stopped engine left "Ready" above a generic sentence.
  const apply = useAsyncAction(
    async (action: () => Promise<VaultStatus>, done: string) => {
      await action();
      return done;
    },
    (done) => {
      announce(done);
      reset();
      vault.reload();
    },
  );
  const busy = apply.busy;
  const error = invalid ?? (apply.error ? t("vault.error.generic") : null);

  if (vault.status === "error") {
    return (
      <section className="voy-vault" aria-labelledby="vault-title">
        <SectionTitle id="vault-title" icon={<LockIcon />}>
          {t("vault.section")}
        </SectionTitle>
        <p className="voy-vault__error" role="alert">
          {describeError(vault.error!).title}
        </p>
      </section>
    );
  }
  if (!status) return null;

  return (
    <section className="voy-vault" aria-labelledby="vault-title">
      <SectionTitle id="vault-title" icon={<LockIcon />}>
        {t("vault.section")}
      </SectionTitle>

      {!status.active ? (
        <p className="voy-vault__note">{t("vault.inactive")}</p>
      ) : (
        <>
          <p className="voy-vault__intro">
            {t("vault.intro.base")}{" "}
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
                  setInvalid(null);
                  void apply.run(
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
                  setInvalid(
                    t("vault.error.tooShort", { min: MIN_PASSPHRASE }),
                  );
                  return;
                }
                if (passphrase !== confirm) {
                  setInvalid(t("vault.error.mismatch"));
                  return;
                }
                setInvalid(null);
                void apply.run(
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
