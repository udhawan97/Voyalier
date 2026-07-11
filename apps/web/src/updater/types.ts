/**
 * The updater seam — deliberately SEPARATE from the frozen AppGateway. A
 * compromised webview must never be able to redirect an update, so the desktop
 * impl only calls fixed Rust command wrappers (endpoint + pubkey pinned in
 * tauri.conf.json); there is no caller-supplied proxy or headers anywhere here.
 */

/** How the running build can update, decided from the transport + a check. */
export type UpdaterMode = "packaged" | "devShell" | "browser";

/** Result of an update check. */
export type UpdateAvailability =
  | "available" // a newer signed release is offered
  | "upToDate" // running the latest
  | "disabled" // desktop shell present but updater off (dev/source build)
  | "unsupported"; // no desktop shell (running in a plain browser)

export interface UpdateStatus {
  availability: UpdateAvailability;
  currentVersion: string;
  /** The offered version, only when `availability === "available"`. */
  availableVersion: string | null;
  /** Raw release notes (already length-capped in Rust); render as inert text. */
  notes: string | null;
}

/** Emitted as bytes arrive. `total` is null when the server sent no length. */
export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/**
 * Outcome of an install. On macOS/Linux the bundle is swapped in place
 * (`"staged"`, a restart finishes it). On Windows the process is replaced during
 * install and the call typically never resolves — so callers must not depend on
 * a Windows return value.
 */
export interface InstallOutcome {
  status: "staged";
  version: string;
}

/** Metadata for a pre-update database backup (mirrors the Rust BackupInfo). */
export interface BackupInfo {
  path: string;
  label: string;
  createdAt: string;
}

/**
 * The updater operations the app depends on. `kind` discriminates the transport
 * so the state machine can pick per-platform / per-mode copy without probing
 * globals itself.
 */
export interface UpdaterGateway {
  /** Which transport backs this gateway. */
  readonly kind: "tauri" | "unsupported";
  /** OS family, for the per-platform install flow fork (Windows vs macOS). */
  readonly platform: "macos" | "windows" | "linux" | "unknown";
  /** Check GitHub Releases for a newer signed version. */
  check(): Promise<UpdateStatus>;
  /** Download + install the available update, reporting streamed progress. */
  install(
    onProgress?: (progress: UpdateProgress) => void,
  ): Promise<InstallOutcome>;
  /** Restart to finish a staged update. Never resolves on success. */
  relaunch(): Promise<void>;
  /** Durable KV: one-time consent + skipped/staged/last-seen versions. */
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  /** Snapshot the database before installing (a pre-update safety net). */
  backup(label: string): Promise<BackupInfo>;
  /** Delete all pre-update database backups; resolves to the count removed. */
  clearBackups(): Promise<number>;
}

/** app_settings keys the updater owns. Namespaced so they never collide. */
export const UPDATER_KEYS = {
  /** "yes" | "no" — the one-time auto-check consent answer (unset until asked). */
  consent: "updater.auto_check_consent",
  /** A version the user chose to skip; the pill stays quiet for exactly it. */
  skippedVersion: "updater.skipped_version",
  /** A version staged on disk and awaiting a restart (macOS/Linux). */
  stagedVersion: "updater.staged_version",
  /** The newest version the user has already been shown (toast de-dupe). */
  lastSeenVersion: "updater.last_seen_version",
} as const;
