import { useCallback, useEffect, useRef, useState } from "react";

import {
  UPDATER_KEYS,
  type UpdaterGateway,
  type UpdaterMode,
  type UpdateProgress,
} from "./types";

/**
 * The updater state machine (App-level). States are honest and small — the
 * plugin only gives coarse errors, so we never parse its strings; instead we
 * split on `navigator.onLine`. The install flow forks by platform: on Windows
 * the process exits during install (no "ready → restart"), on macOS/Linux the
 * bundle is staged and a restart finishes it.
 *
 * IMPORTANT: pass a STABLE `gateway` (a module singleton or `useMemo`'d value).
 * A fresh gateway object every render re-fires the mount effect — repeated
 * auto-checks and backup/install churn — because `check` is memoized on it.
 */
export type UpdaterPhase =
  | { name: "idle" }
  | { name: "consent" } // one-time auto-check ask (packaged, unanswered)
  | { name: "checking" }
  | { name: "upToDate"; currentVersion: string }
  | {
      name: "available";
      version: string;
      notes: string | null;
      skipped: boolean;
    }
  | { name: "preparing"; version: string }
  | { name: "installing"; version: string; progress: UpdateProgress | null }
  | { name: "staged"; version: string } // downloaded, awaiting restart
  | { name: "error"; reason: "offline" | "generic" | "backup" }
  | { name: "disabled" } // desktop dev/source build
  | { name: "unsupported"; currentVersion: string }; // plain browser

export interface UpdaterController {
  phase: UpdaterPhase;
  mode: UpdaterMode;
  platform: UpdaterGateway["platform"];
  /** Set to the running version when this launch is newer than the last one the
   *  user saw — drives a one-shot "updated to vX" toast. Null otherwise. */
  justUpdated: string | null;
  dismissJustUpdated: () => void;
  /** Whether the daily auto-check is on (consent = "yes"). Drives the panel
   *  toggle so the one-time consent can be reversed later (D1). */
  autoCheck: boolean;
  check: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  skip: () => Promise<void>;
  unskip: () => Promise<void>;
  answerConsent: (allow: boolean) => Promise<void>;
  /** Delete all pre-update database backups; resolves to the count removed. */
  clearBackups: () => Promise<number>;
}

/** Numeric dotted-version compare; pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function useUpdater(gateway: UpdaterGateway): UpdaterController {
  const [phase, setPhase] = useState<UpdaterPhase>({ name: "idle" });
  const [mode, setMode] = useState<UpdaterMode>(
    gateway.kind === "unsupported" ? "browser" : "packaged",
  );
  // React state does not change synchronously with a click. This owner covers
  // the first backup await as well as download/install and metadata writes.
  // Other actions also hold it so an older completion cannot overwrite install.
  const operationPending = useRef(false);
  const [justUpdated, setJustUpdated] = useState<string | null>(null);
  const [autoCheck, setAutoCheck] = useState(false);

  /** A staged version still pending unless the running build already caught up. */
  const reconcileStaged = useCallback(
    async (running: string): Promise<string | null> => {
      const staged = await gateway.getSetting(UPDATER_KEYS.stagedVersion);
      if (staged && compareVersions(running, staged) >= 0) {
        await gateway.setSetting(UPDATER_KEYS.stagedVersion, "");
        return null;
      }
      return staged || null;
    },
    [gateway],
  );

  const errorReason = (): "offline" | "generic" =>
    typeof navigator !== "undefined" && navigator.onLine === false
      ? "offline"
      : "generic";

  const check = useCallback(async () => {
    if (operationPending.current) return;
    operationPending.current = true;
    setPhase({ name: "checking" });
    try {
      const status = await gateway.check();
      if (status.availability === "disabled") {
        setMode("devShell");
        setPhase({ name: "disabled" });
        return;
      }
      if (status.availability === "unsupported") {
        setPhase({
          name: "unsupported",
          currentVersion: status.currentVersion,
        });
        return;
      }
      // One-shot "you're now on a newer version" signal: fire only when a
      // previous last-seen exists (never on first run) and the running build is
      // newer (silent on downgrade). Persist so the next launch compares fresh.
      const lastSeen = await gateway.getSetting(UPDATER_KEYS.lastSeenVersion);
      if (lastSeen && compareVersions(status.currentVersion, lastSeen) > 0) {
        setJustUpdated(status.currentVersion);
      }
      await gateway.setSetting(
        UPDATER_KEYS.lastSeenVersion,
        status.currentVersion,
      );

      const staged = await reconcileStaged(status.currentVersion);
      if (staged) {
        setPhase({ name: "staged", version: staged });
        return;
      }
      if (status.availability === "available" && status.availableVersion) {
        const skipped = await gateway.getSetting(UPDATER_KEYS.skippedVersion);
        setPhase({
          name: "available",
          version: status.availableVersion,
          notes: status.notes,
          skipped: skipped === status.availableVersion,
        });
        return;
      }
      setPhase({ name: "upToDate", currentVersion: status.currentVersion });
    } catch {
      // A failed check must not bury a genuinely-staged update behind an error
      // (§8: a staged version short-circuits to "restart to finish"). Prefer the
      // persisted staged version — e.g. a macOS user who staged an update, quit,
      // and relaunched offline should still be told to restart, not see an error.
      const staged = await gateway
        .getSetting(UPDATER_KEYS.stagedVersion)
        .catch(() => null);
      if (staged) setPhase({ name: "staged", version: staged });
      else setPhase({ name: "error", reason: errorReason() });
    } finally {
      operationPending.current = false;
    }
  }, [gateway, reconcileStaged]);

  const install = useCallback(async () => {
    if (operationPending.current || phase.name !== "available") return;
    operationPending.current = true;
    const version = phase.version;
    setPhase({ name: "preparing", version });
    try {
      try {
        // Fail closed before touching the bundle, retaining the operation owner
        // even when a large or protected workspace takes time to authenticate.
        await gateway.backup(`v${version}`);
      } catch {
        setPhase({ name: "error", reason: "backup" });
        return;
      }
      setPhase({ name: "installing", version, progress: null });
      if (gateway.platform === "windows") {
        // NSIS normally exits and relaunches the process; retain ownership for
        // the whole pending call. Do not persist a macOS-style restart marker.
        const outcome = await gateway.install();
        setPhase({ name: "staged", version: outcome.version });
      } else {
        const outcome = await gateway.install((progress) =>
          setPhase((prev) =>
            prev.name === "installing" ? { ...prev, progress } : prev,
          ),
        );
        await gateway.setSetting(UPDATER_KEYS.stagedVersion, outcome.version);
        setPhase({ name: "staged", version: outcome.version });
      }
    } catch {
      setPhase({ name: "error", reason: errorReason() });
    } finally {
      operationPending.current = false;
    }
  }, [gateway, phase]);

  const restart = useCallback(async () => {
    if (operationPending.current) return;
    operationPending.current = true;
    try {
      // Clear the staged marker before relaunching (including consent=no).
      await gateway.setSetting(UPDATER_KEYS.stagedVersion, "").catch(() => {});
      await gateway.relaunch().catch(() => {});
    } finally {
      operationPending.current = false;
    }
  }, [gateway]);

  const skip = useCallback(async () => {
    if (operationPending.current || phase.name !== "available") return;
    operationPending.current = true;
    try {
      await gateway.setSetting(UPDATER_KEYS.skippedVersion, phase.version);
      setPhase({ ...phase, skipped: true });
    } finally {
      operationPending.current = false;
    }
  }, [gateway, phase]);

  const unskip = useCallback(async () => {
    if (operationPending.current || phase.name !== "available") return;
    operationPending.current = true;
    try {
      await gateway.setSetting(UPDATER_KEYS.skippedVersion, "");
      setPhase({ ...phase, skipped: false });
    } finally {
      operationPending.current = false;
    }
  }, [gateway, phase]);

  const answerConsent = useCallback(
    async (allow: boolean) => {
      if (operationPending.current) return;
      operationPending.current = true;
      try {
        await gateway.setSetting(UPDATER_KEYS.consent, allow ? "yes" : "no");
        setAutoCheck(allow);
        if (!allow) setPhase({ name: "idle" });
      } finally {
        operationPending.current = false;
      }
      if (allow) await check();
    },
    [gateway, check],
  );

  const clearBackups = useCallback(async () => {
    if (operationPending.current)
      throw new Error("update operation in progress");
    operationPending.current = true;
    try {
      return await gateway.clearBackups();
    } finally {
      operationPending.current = false;
    }
  }, [gateway]);

  // Mount: pick up a staged update, then honor the one-time consent answer.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (gateway.kind === "unsupported") {
        const status = await gateway.check();
        if (!cancelled) {
          setMode("browser");
          setPhase({
            name: "unsupported",
            currentVersion: status.currentVersion,
          });
        }
        return;
      }
      const [consent, staged] = await Promise.all([
        gateway.getSetting(UPDATER_KEYS.consent),
        gateway.getSetting(UPDATER_KEYS.stagedVersion),
      ]);
      if (cancelled) return;
      setAutoCheck(consent === "yes");
      // A live check (auto or manual) reconciles a staged version against the
      // running build; with consent it happens immediately below.
      if (consent === "yes") {
        await check();
        return;
      }
      if (staged) {
        setPhase({ name: "staged", version: staged });
        return;
      }
      if (consent === null) {
        setPhase({ name: "consent" });
        return;
      }
      setPhase({ name: "idle" }); // consent "no" → manual checks only
    })();
    return () => {
      cancelled = true;
    };
  }, [gateway, check]);

  return {
    phase,
    mode,
    platform: gateway.platform,
    justUpdated,
    dismissJustUpdated: () => setJustUpdated(null),
    autoCheck,
    check,
    install,
    restart,
    skip,
    unskip,
    answerConsent,
    clearBackups,
  };
}
