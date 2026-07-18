import { toAppError } from "../gateway/errors";
import type { BackupGateway, RestorePreview } from "./types";

// Non-generic on purpose, matching the updater: a concrete injected mock is
// assignable to this, whereas a generic `<T>() => Promise<T>` would not be.
type InvokeFn = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export interface TauriBackupOptions {
  /** Injectable invoke (tests). Defaults to `window.__TAURI__.core.invoke`. */
  invoke?: InvokeFn;
}

/**
 * Drives backup and restore through the Rust command wrappers. The passphrase
 * is passed as a command argument and used only to derive a key in the local
 * core; it is never stored, returned, or logged. The file picker runs Rust-side,
 * so this layer never holds a path it did not receive back from a command.
 */
export function createTauriBackup(
  options: TauriBackupOptions = {},
): BackupGateway {
  const invoke: InvokeFn =
    options.invoke ??
    ((command, args) => {
      const bridge = window.__TAURI__;
      if (!bridge) {
        return Promise.reject(
          new Error("The desktop bridge is unavailable."),
        ) as Promise<never>;
      }
      return bridge.core.invoke(command, args);
    });

  async function call<T>(command: string, input: unknown): Promise<T> {
    try {
      return (await invoke(command, { input })) as T;
    } catch (error) {
      throw toAppError(error);
    }
  }

  return {
    kind: "tauri",

    exportBackup: (passphrase: string) =>
      call<string | null>("export_backup", { passphrase }),

    stageRestore: (passphrase: string) =>
      call<RestorePreview | null>("stage_restore", { passphrase }),

    hasPendingRestore: () => call<boolean>("has_pending_restore", {}),
  };
}
