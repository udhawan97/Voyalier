import type {
  BackupInfo,
  InstallOutcome,
  UpdaterGateway,
  UpdateStatus,
} from "./types";

export interface UnsupportedUpdaterOptions {
  /** The running web version, shown as `currentVersion`. */
  currentVersion?: string;
}

function unsupported(): Error {
  // Not an AppError code: this path has no desktop transport at all, so the UI
  // renders the honest "how to update" copy rather than an error banner.
  return new Error("In-app updates are unavailable in this environment.");
}

/**
 * The updater when there is no desktop shell — a plain browser, or the web app
 * run from source. `check()` reports `"unsupported"` so the UI can show the
 * honest dual instructions (run from source vs. download the packaged app)
 * instead of a live update button. The mutating operations reject; the UI never
 * calls them in this mode.
 */
export function createUnsupportedUpdater(
  options: UnsupportedUpdaterOptions = {},
): UpdaterGateway {
  const currentVersion = options.currentVersion ?? "unknown";
  return {
    kind: "unsupported",
    platform: "unknown",
    check: (): Promise<UpdateStatus> =>
      Promise.resolve({
        availability: "unsupported",
        currentVersion,
        availableVersion: null,
        notes: null,
      }),
    install: (): Promise<InstallOutcome> => Promise.reject(unsupported()),
    relaunch: (): Promise<void> => Promise.reject(unsupported()),
    // No desktop KV here: consent/skip persistence is a no-op, reads are empty.
    getSetting: (): Promise<string | null> => Promise.resolve(null),
    setSetting: (): Promise<void> => Promise.resolve(),
    backup: (): Promise<BackupInfo> => Promise.reject(unsupported()),
  };
}
