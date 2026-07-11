import { toAppError } from "../gateway/errors";
import type {
  BackupInfo,
  InstallOutcome,
  UpdaterGateway,
  UpdateProgress,
  UpdateStatus,
} from "./types";

// Non-generic on purpose: a concrete injected mock is assignable to this (and
// the real `bridge.core.invoke` returns `Promise<unknown>` when uninstantiated),
// whereas a generic `<T>() => Promise<T>` would reject any concrete function.
type InvokeFn = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

type ListenFn = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<() => void>;

/** Shape the Rust `updater_check` command returns (camelCase serde). */
interface RustUpdateCheck {
  status: "available" | "upToDate" | "disabled";
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
}

export interface TauriUpdaterOptions {
  /** Injectable invoke (tests). Defaults to `window.__TAURI__.core.invoke`. */
  invoke?: InvokeFn;
  /** Injectable event listener (tests). Defaults to `window.__TAURI__.event`. */
  listen?: ListenFn;
  /** Override OS detection (tests). */
  platform?: UpdaterGateway["platform"];
}

const PROGRESS_EVENT = "updater://progress";

function detectPlatform(): UpdaterGateway["platform"] {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * Drives the desktop updater through the fixed Rust command wrappers. It never
 * passes an endpoint, proxy, or headers — those are pinned in tauri.conf.json —
 * so there is no way for this layer to introduce a hidden network path. The
 * `updater_*` commands take no `input` arg (they receive the AppHandle); the KV
 * and backup commands use the standard `{ input }` envelope.
 */
export function createTauriUpdater(
  options: TauriUpdaterOptions = {},
): UpdaterGateway {
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

  const listen: ListenFn =
    options.listen ??
    ((event, handler) => {
      const bridge = window.__TAURI__;
      if (!bridge?.event) {
        // No event bridge: progress just won't stream; resolve to a no-op
        // unlisten so install still runs (with an indeterminate bar).
        return Promise.resolve(() => {});
      }
      return bridge.event.listen(event, handler);
    });

  async function callInput<T>(command: string, input: unknown): Promise<T> {
    try {
      return (await invoke(command, { input })) as T;
    } catch (error) {
      throw toAppError(error);
    }
  }

  async function callBare<T>(command: string): Promise<T> {
    try {
      return (await invoke(command)) as T;
    } catch (error) {
      throw toAppError(error);
    }
  }

  return {
    kind: "tauri",
    platform: options.platform ?? detectPlatform(),

    async check(): Promise<UpdateStatus> {
      const result = await callBare<RustUpdateCheck>("updater_check");
      return {
        availability: result.status,
        currentVersion: result.currentVersion,
        availableVersion: result.availableVersion,
        notes: result.notes,
      };
    },

    async install(
      onProgress?: (progress: UpdateProgress) => void,
    ): Promise<InstallOutcome> {
      let unlisten: (() => void) | undefined;
      if (onProgress) {
        unlisten = await listen(PROGRESS_EVENT, (event) =>
          onProgress(event.payload as UpdateProgress),
        );
      }
      try {
        return await callBare<InstallOutcome>("updater_install");
      } finally {
        unlisten?.();
      }
    },

    relaunch: () => callBare<void>("updater_relaunch"),

    getSetting: (key: string) =>
      callInput<string | null>("get_app_setting", { key }),

    setSetting: (key: string, value: string) =>
      callInput<void>("set_app_setting", { key, value }),

    backup: (label: string) =>
      callInput<BackupInfo>("backup_database", { label }),
  };
}
