import { useCallback, useEffect, useRef } from "react";

import { useUpdaterController } from "../app/context";
import { t } from "../app/i18n";
import { Button } from "../components/Button";

const RELEASES_URL = "https://github.com/udhawan97/Voyalier/releases";

/** The GitHub releases page as a new-tab link with an sr-only suffix. */
function ReleasesLink() {
  return (
    <a
      className="voy-updates__link"
      href={RELEASES_URL}
      target="_blank"
      rel="noreferrer noopener"
    >
      {t("updates.releases")}
      <span className="voy-sr-only">{t("a11y.opensInNewTab")}</span>
    </a>
  );
}

/**
 * The updates surface on the home screen (sibling of the vault panel). It reads
 * the single App-level updater controller and renders the current state — the
 * one-time consent ask, an available update with skip/un-skip, download
 * progress, a staged "restart to finish", honest errors, or the dev/browser
 * notices. Release notes are rendered as inert plain text (never HTML): they can
 * be attacker-influenced, so we show them verbatim under an "unverified" label.
 */
export function UpdatesPanel() {
  const {
    phase,
    platform,
    check,
    install,
    restart,
    skip,
    unskip,
    answerConsent,
  } = useUpdaterController();
  const windows = platform === "windows";

  // Keep focus off <body> when a user-initiated action ("Check", consent) makes
  // the phase — and thus the button subtree — change out from under the focused
  // control. We point `primaryRef` at each settled phase's main button and move
  // focus there once the transition settles. The mount auto-check never sets the
  // flag, so initial load never steals focus.
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (phase.name !== "checking" && restoreFocus.current) {
      restoreFocus.current = false;
      primaryRef.current?.focus();
    }
  }, [phase.name]);

  const runCheck = useCallback(() => {
    restoreFocus.current = true;
    void check();
  }, [check]);
  const runConsent = useCallback(
    (allow: boolean) => {
      restoreFocus.current = true;
      void answerConsent(allow);
    },
    [answerConsent],
  );

  function body() {
    switch (phase.name) {
      case "idle":
        return (
          <Button ref={primaryRef} variant="secondary" onClick={runCheck}>
            {t("updates.check")}
          </Button>
        );

      case "consent":
        return (
          <div className="voy-updates__consent">
            <p className="voy-updates__lead">{t("updates.consent.title")}</p>
            <p className="voy-updates__hint">{t("updates.consent.body")}</p>
            <div className="voy-updates__actions">
              <Button variant="primary" onClick={() => runConsent(true)}>
                {t("updates.consent.yes")}
              </Button>
              <Button variant="ghost" onClick={() => runConsent(false)}>
                {t("updates.consent.no")}
              </Button>
            </div>
          </div>
        );

      case "checking":
        return (
          <Button variant="secondary" busy disabled>
            {t("updates.checking")}
          </Button>
        );

      case "upToDate":
        return (
          <div className="voy-updates__row">
            <p className="voy-updates__lead">
              {t("updates.upToDate", { version: phase.currentVersion })}
            </p>
            <Button ref={primaryRef} variant="secondary" onClick={runCheck}>
              {t("updates.check")}
            </Button>
          </div>
        );

      case "available":
        return (
          <div className="voy-updates__available">
            <p className="voy-updates__lead">
              {t("updates.available.title", { version: phase.version })}
            </p>
            <p className="voy-updates__hint">{t("updates.available.body")}</p>
            {windows ? (
              <p className="voy-updates__hint">
                {t("updates.installWin.note")}
              </p>
            ) : null}
            {phase.notes ? (
              <div className="voy-updates__notes">
                <p className="voy-updates__notes-heading">
                  {t("updates.notes.heading")}
                </p>
                <pre className="voy-updates__notes-body">{phase.notes}</pre>
              </div>
            ) : null}
            <div className="voy-updates__actions">
              <Button
                ref={primaryRef}
                variant="primary"
                onClick={() => void install()}
              >
                {windows ? t("updates.installWin") : t("updates.install")}
              </Button>
              {phase.skipped ? (
                <>
                  <span className="voy-updates__skipped">
                    {t("updates.skipped")}
                  </span>
                  <Button variant="ghost" onClick={() => void unskip()}>
                    {t("updates.unskip")}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={() => void skip()}>
                  {t("updates.skip")}
                </Button>
              )}
            </div>
          </div>
        );

      case "installing": {
        const total = phase.progress?.total ?? null;
        const downloaded = phase.progress?.downloaded ?? 0;
        const percent =
          total && total > 0
            ? Math.min(100, Math.round((downloaded / total) * 100))
            : null;
        return (
          <div className="voy-updates__installing">
            <p className="voy-updates__lead">
              {windows ? t("updates.installingWin") : t("updates.installing")}
            </p>
            <div
              className="voy-updates__progress"
              role="progressbar"
              aria-label={t("updates.progress.aria")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <span
                className="voy-updates__progress-bar"
                style={{ width: percent != null ? `${percent}%` : undefined }}
              />
            </div>
            <p className="voy-updates__hint" aria-live="polite">
              {percent != null
                ? t("updates.progress.percent", { percent: String(percent) })
                : t("updates.progress.indeterminate")}
            </p>
          </div>
        );
      }

      case "staged":
        return (
          <div className="voy-updates__staged">
            <p className="voy-updates__lead">{t("updates.staged.title")}</p>
            <p className="voy-updates__hint">
              {t("updates.staged.body", { version: phase.version })}
            </p>
            <Button
              ref={primaryRef}
              variant="primary"
              onClick={() => void restart()}
            >
              {t("updates.restart")}
            </Button>
          </div>
        );

      case "error":
        return (
          <div className="voy-updates__error" role="alert">
            <p className="voy-updates__lead">
              {phase.reason === "offline"
                ? t("updates.error.offline")
                : t("updates.error.generic")}
            </p>
            <div className="voy-updates__actions">
              <Button ref={primaryRef} variant="secondary" onClick={runCheck}>
                {t("updates.retry")}
              </Button>
              <ReleasesLink />
            </div>
          </div>
        );

      case "disabled":
        return <p className="voy-updates__hint">{t("updates.disabled")}</p>;

      case "unsupported":
        return (
          <div className="voy-updates__unsupported">
            <p className="voy-updates__lead">
              {t("updates.unsupported.title")}
            </p>
            <p className="voy-updates__hint">
              {t("updates.unsupported.source")}
            </p>
            <p className="voy-updates__hint">
              {t("updates.unsupported.download")} <ReleasesLink />
            </p>
          </div>
        );

      default: {
        // Exhaustiveness guard: adding an UpdaterPhase without a case here is a
        // compile error rather than a silently-blank panel.
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  return (
    <section className="voy-updates" aria-labelledby="updates-title">
      <h2 id="updates-title" className="voy-updates__title">
        {t("updates.title")}
      </h2>
      <div className="voy-updates__body">{body()}</div>
    </section>
  );
}
