import { createMockUpdater } from "./mockUpdater";
import { createTauriUpdater } from "./tauriUpdater";
import type { UpdaterGateway } from "./types";
import { createUnsupportedUpdater } from "./unsupportedUpdater";

export type {
  BackupInfo,
  InstallOutcome,
  UpdaterGateway,
  UpdaterMode,
  UpdateAvailability,
  UpdateProgress,
  UpdateStatus,
} from "./types";
export { UPDATER_KEYS } from "./types";
export { createTauriUpdater } from "./tauriUpdater";
export { createUnsupportedUpdater } from "./unsupportedUpdater";
export { createMockUpdater } from "./mockUpdater";
export type { MockUpdater } from "./mockUpdater";

/**
 * Pick the updater transport at runtime, mirroring `selectGateway`:
 *   - VITE_MOCK=1            → scripted mock (also used in UI-dev / tests)
 *   - "__TAURI__" in window  → desktop IPC wrappers (never inferred from URL)
 *   - otherwise              → unsupported (plain browser / run-from-source)
 */
export function selectUpdater(): UpdaterGateway {
  if (import.meta.env.VITE_MOCK === "1") return createMockUpdater();
  if (typeof window !== "undefined" && "__TAURI__" in window) {
    return createTauriUpdater();
  }
  return createUnsupportedUpdater();
}
