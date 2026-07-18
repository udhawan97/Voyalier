import type { BackupGateway } from "./types";

/**
 * Outside the desktop app there is no local database file, no OS keychain, and
 * no native picker, so backup and restore genuinely cannot work. The panel says
 * so plainly rather than offering a button that would fail — the same way the
 * updater degrades in a plain browser.
 */
export function createUnsupportedBackup(): BackupGateway {
  const unavailable = () =>
    Promise.reject(
      new Error("Backup and restore need the desktop app."),
    ) as Promise<never>;

  return {
    kind: "unsupported",
    exportBackup: unavailable,
    stageRestore: unavailable,
    hasPendingRestore: () => Promise.resolve(false),
  };
}
