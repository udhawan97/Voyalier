import type {
  BackupInfo,
  InstallOutcome,
  UpdaterGateway,
  UpdateProgress,
  UpdateStatus,
} from "./types";

export interface MockUpdaterOptions {
  platform?: UpdaterGateway["platform"];
  currentVersion?: string;
  /** Result of check(); pass an Error to reject. Defaults to upToDate. */
  onCheck?: UpdateStatus | Error;
  /** Progress frames emitted, in order, during install(). */
  progress?: UpdateProgress[];
  /** Result of install(); pass an Error to reject. Defaults to a staged swap. */
  onInstall?: InstallOutcome | Error;
  /** Awaited after progress but before install() resolves, to hold it open so a
   *  test can observe the transient "installing" phase. */
  hold?: Promise<void>;
  /** Seed values for the in-memory KV store. */
  settings?: Record<string, string>;
}

/** A mock updater with public inspection fields for assertions. */
export interface MockUpdater extends UpdaterGateway {
  readonly store: Map<string, string>;
  relaunchCalls: number;
  backupCalls: string[];
  clearBackupsCalls: number;
}

/**
 * A fully scripted updater for tests and UI development. It drives the state
 * machine through every state — available/upToDate/disabled/unsupported, the
 * win/mac install fork, progress, staged-restart, skip/un-skip, and errors —
 * without any desktop shell. Nothing here touches the network.
 */
export function createMockUpdater(
  options: MockUpdaterOptions = {},
): MockUpdater {
  const currentVersion = options.currentVersion ?? "0.3.0";
  const store = new Map<string, string>(Object.entries(options.settings ?? {}));

  const defaultCheck: UpdateStatus = {
    availability: "upToDate",
    currentVersion,
    availableVersion: null,
    notes: null,
  };

  const mock: MockUpdater = {
    kind: "tauri",
    platform: options.platform ?? "macos",
    store,
    relaunchCalls: 0,
    backupCalls: [],
    clearBackupsCalls: 0,

    check(): Promise<UpdateStatus> {
      if (options.onCheck instanceof Error)
        return Promise.reject(options.onCheck);
      return Promise.resolve(options.onCheck ?? defaultCheck);
    },

    async install(
      onProgress?: (progress: UpdateProgress) => void,
    ): Promise<InstallOutcome> {
      for (const frame of options.progress ?? []) {
        onProgress?.(frame);
        // Yield so listeners observe frames as distinct microtasks.
        await Promise.resolve();
      }
      if (options.hold) await options.hold;
      if (options.onInstall instanceof Error) throw options.onInstall;
      return (
        options.onInstall ?? {
          status: "staged",
          version:
            (options.onCheck && !(options.onCheck instanceof Error)
              ? options.onCheck.availableVersion
              : null) ?? currentVersion,
        }
      );
    },

    relaunch(): Promise<void> {
      mock.relaunchCalls += 1;
      return Promise.resolve();
    },

    getSetting: (key: string): Promise<string | null> =>
      Promise.resolve(store.get(key) ?? null),

    setSetting: (key: string, value: string): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },

    backup: (label: string): Promise<BackupInfo> => {
      mock.backupCalls.push(label);
      return Promise.resolve({
        path: `/tmp/pre-update-${label}.sqlite3`,
        label,
        createdAt: "2026-07-11T00:00:00Z",
      });
    },

    clearBackups: (): Promise<number> => {
      mock.clearBackupsCalls += 1;
      const count = mock.backupCalls.length;
      mock.backupCalls = [];
      return Promise.resolve(count);
    },
  };

  return mock;
}
