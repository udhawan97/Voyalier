import { createTauriBackup } from "./tauriBackup";
import type { BackupGateway } from "./types";
import { createUnsupportedBackup } from "./unsupportedBackup";

export type { BackupGateway, RestorePreview } from "./types";
export { createTauriBackup } from "./tauriBackup";
export { createUnsupportedBackup } from "./unsupportedBackup";

/**
 * Pick the backup transport at runtime, mirroring `selectUpdater`. There is no
 * mock arm: a scripted mock would have to fake writing a real file, and the
 * panel's honest "desktop app only" state is what the browser harness should
 * show anyway.
 */
export function selectBackup(): BackupGateway {
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return createTauriBackup();
  }
  return createUnsupportedBackup();
}
