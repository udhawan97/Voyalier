import type { BackupGateway } from "./types";

/**
 * A browser-from-source build can still be backed by AppService's local SQLite
 * workspace and, where available, its OS-keychain vault. What the browser lacks
 * is the packaged desktop's native file picker and portable encrypted backup
 * bridge, so those integrated export/restore controls genuinely cannot work
 * here. The panel names that capability boundary instead of denying the data
 * that needs protection.
 */
export function createUnsupportedBackup(): BackupGateway {
  const unavailable = () =>
    Promise.reject(
      new Error("Backup and restore need the desktop app."),
    ) as Promise<never>;

  return {
    kind: "unsupported",
    exportBackup: unavailable,
    inspectRestore: unavailable,
    confirmRestore: unavailable,
    cancelRestoreInspection: () => Promise.resolve(false),
    hasPendingRestore: () => Promise.resolve(false),
    unstageRestore: () => Promise.resolve(false),
  };
}
