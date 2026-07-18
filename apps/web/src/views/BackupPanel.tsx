import { useEffect, useMemo, useState } from "react";
import type { AppError } from "@voyalier/contracts";

import { useAnnounce } from "../app/context";
import { t } from "../app/i18n";
import { formatDate } from "../app/format";
import { type BackupGateway, selectBackup } from "../backup";
import { Button } from "../components/Button";
import { SectionTitle } from "../components/primitives";
import { LockIcon } from "../components/icons";

const MIN_PASSPHRASE = 8;

type Mode = "idle" | "exporting" | "restoring";

/**
 * Save the whole workspace to one encrypted file, and restore it.
 *
 * Voyalier keeps everything on this device, and the vault passphrase has no
 * recovery — so without a backup, a lost computer is lost trips. The file
 * carries the vault's data key re-wrapped under a passphrase chosen here, which
 * is what lets it open on a different machine.
 *
 * Restoring is staged: it replaces the workspace at the next launch, after
 * snapshotting what was there, so nothing is destroyed mid-session.
 */
export function BackupPanel({
  backup: injected,
}: {
  /** Injectable transport (tests). Defaults to runtime detection. */
  backup?: BackupGateway;
}) {
  const announce = useAnnounce();
  const backup = useMemo(() => injected ?? selectBackup(), [injected]);
  const [mode, setMode] = useState<Mode>("idle");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let live = true;
    backup.hasPendingRestore().then(
      (next) => {
        if (live) setPending(next);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [backup]);

  function reset() {
    setMode("idle");
    setPassphrase("");
    setConfirm("");
    setError(null);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reset();
    } catch (caught) {
      setError((caught as AppError).message || t("backup.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  function guardPassphrase(): boolean {
    if (passphrase.length < MIN_PASSPHRASE) {
      setError(t("backup.error.tooShort", { min: MIN_PASSPHRASE }));
      return false;
    }
    return true;
  }

  if (backup.kind === "unsupported") {
    return (
      <section className="voy-backup" aria-labelledby="backup-title">
        <SectionTitle id="backup-title" icon={<LockIcon />}>
          {t("backup.section")}
        </SectionTitle>
        <p className="voy-backup__note">{t("backup.unsupported")}</p>
      </section>
    );
  }

  return (
    <section className="voy-backup" aria-labelledby="backup-title">
      <SectionTitle id="backup-title" icon={<LockIcon />}>
        {t("backup.section")}
      </SectionTitle>
      <p className="voy-backup__intro">{t("backup.intro")}</p>

      {pending ? (
        <p className="voy-backup__pending" role="status">
          {t("backup.restore.pending")}
        </p>
      ) : null}

      {notice ? (
        <p className="voy-backup__notice" role="status">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="voy-backup__error" role="alert">
          {error}
        </p>
      ) : null}

      {mode === "exporting" ? (
        <form
          className="voy-backup__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!guardPassphrase()) return;
            if (passphrase !== confirm) {
              setError(t("backup.error.mismatch"));
              return;
            }
            void run(async () => {
              const path = await backup.exportBackup(passphrase);
              // A cancelled picker is a normal outcome, not a failure.
              const message = path
                ? t("backup.export.done", { path })
                : t("backup.export.cancelled");
              setNotice(message);
              announce(message);
            });
          }}
        >
          <p className="voy-backup__hint">{t("backup.export.hint")}</p>
          <label className="voy-sr-only" htmlFor="backup-passphrase">
            {t("backup.passphrase")}
          </label>
          <input
            id="backup-passphrase"
            className="voy-backup__input"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={t("backup.passphrase.placeholder", {
              min: MIN_PASSPHRASE,
            })}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <label className="voy-sr-only" htmlFor="backup-confirm">
            {t("backup.confirmPassphrase")}
          </label>
          <input
            id="backup-confirm"
            className="voy-backup__input"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            placeholder={t("backup.confirmPassphrase.placeholder")}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <p className="voy-backup__warn">{t("backup.warn.noRecovery")}</p>
          <div className="voy-backup__actions">
            <Button
              type="submit"
              busy={busy}
              disabled={passphrase.length === 0}
            >
              {t("backup.export.confirm")}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t("vault.action.cancel")}
            </Button>
          </div>
        </form>
      ) : mode === "restoring" ? (
        <form
          className="voy-backup__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!guardPassphrase()) return;
            void run(async () => {
              const preview = await backup.stageRestore(passphrase);
              if (!preview) {
                const message = t("backup.restore.cancelled");
                setNotice(message);
                announce(message);
                return;
              }
              setPending(true);
              const message = t("backup.restore.staged", {
                // The manifest stamps an RFC3339 instant; formatDate takes a
                // calendar date and passes anything else through verbatim,
                // which would show the traveler a raw timestamp.
                date: formatDate(preview.createdAt.slice(0, 10)),
              });
              setNotice(message);
              announce(message);
            });
          }}
        >
          <p className="voy-backup__hint">{t("backup.restore.hint")}</p>
          <label className="voy-sr-only" htmlFor="restore-passphrase">
            {t("backup.passphrase")}
          </label>
          <input
            id="restore-passphrase"
            className="voy-backup__input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={t("backup.passphrase.placeholder", {
              min: MIN_PASSPHRASE,
            })}
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <div className="voy-backup__actions">
            <Button
              type="submit"
              variant="danger"
              busy={busy}
              disabled={passphrase.length === 0}
            >
              {t("backup.restore.confirm")}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t("vault.action.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="voy-backup__actions">
          <Button
            onClick={() => {
              setNotice(null);
              setMode("exporting");
            }}
          >
            {t("backup.export.action")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setNotice(null);
              setMode("restoring");
            }}
          >
            {t("backup.restore.action")}
          </Button>
        </div>
      )}

      <p className="voy-backup__excludes">{t("backup.excludes")}</p>
    </section>
  );
}
