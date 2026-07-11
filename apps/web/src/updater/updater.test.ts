import { describe, expect, it, vi } from "vitest";

import { createMockUpdater } from "./mockUpdater";
import { createTauriUpdater } from "./tauriUpdater";
import { createUnsupportedUpdater } from "./unsupportedUpdater";

describe("tauriUpdater", () => {
  it("maps updater_check and calls the bare command (no input envelope)", async () => {
    const invoke = vi.fn(async (command: string) => {
      expect(command).toBe("updater_check");
      return {
        status: "available",
        currentVersion: "0.3.0",
        availableVersion: "0.3.1",
        notes: "Fixes",
      };
    });
    const updater = createTauriUpdater({ invoke, platform: "macos" });

    const status = await updater.check();
    expect(status).toEqual({
      availability: "available",
      currentVersion: "0.3.0",
      availableVersion: "0.3.1",
      notes: "Fixes",
    });
    // Bare command: invoked with no args object (no `{ input }` envelope).
    expect(invoke).toHaveBeenCalledWith("updater_check");
  });

  it("wraps KV + backup commands in the { input } envelope", async () => {
    const invoke = vi.fn(async (command: string, args?: unknown) => {
      if (command === "get_app_setting") return "yes";
      if (command === "set_app_setting") return undefined;
      if (command === "backup_database") {
        return { path: "/b/x.sqlite3", label: "v0.3.0", createdAt: "t" };
      }
      throw new Error(`unexpected ${command} ${JSON.stringify(args)}`);
    });
    const updater = createTauriUpdater({ invoke, platform: "windows" });

    expect(await updater.getSetting("updater.consent")).toBe("yes");
    expect(invoke).toHaveBeenCalledWith("get_app_setting", {
      input: { key: "updater.consent" },
    });

    await updater.setSetting("updater.consent", "no");
    expect(invoke).toHaveBeenCalledWith("set_app_setting", {
      input: { key: "updater.consent", value: "no" },
    });

    const backup = await updater.backup("v0.3.0");
    expect(backup.path).toBe("/b/x.sqlite3");
    expect(invoke).toHaveBeenCalledWith("backup_database", {
      input: { label: "v0.3.0" },
    });
  });

  it("subscribes to progress during install and always unsubscribes", async () => {
    const unlisten = vi.fn();
    const listen = vi.fn(
      async (
        _event: string,
        handler: (event: { payload: unknown }) => void,
      ) => {
        handler({ payload: { downloaded: 50, total: 100 } });
        return unlisten;
      },
    );
    const invoke = vi.fn(async () => ({ status: "staged", version: "0.3.1" }));
    const updater = createTauriUpdater({ invoke, listen, platform: "macos" });

    const frames: Array<{ downloaded: number; total: number | null }> = [];
    const outcome = await updater.install((p) => frames.push(p));

    expect(outcome).toEqual({ status: "staged", version: "0.3.1" });
    expect(frames).toEqual([{ downloaded: 50, total: 100 }]);
    expect(listen).toHaveBeenCalledWith(
      "updater://progress",
      expect.any(Function),
    );
    expect(unlisten).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("updater_install");
  });

  it("unsubscribes progress even when install rejects", async () => {
    const unlisten = vi.fn();
    const listen = vi.fn(async () => unlisten);
    const invoke = vi.fn(async () => {
      throw { code: "internal/unexpected", message: "boom" };
    });
    const updater = createTauriUpdater({ invoke, listen, platform: "macos" });

    await expect(updater.install(() => {})).rejects.toMatchObject({
      code: "internal/unexpected",
    });
    expect(unlisten).toHaveBeenCalledOnce();
  });
});

describe("unsupportedUpdater", () => {
  it("reports unsupported and rejects mutating operations", async () => {
    const updater = createUnsupportedUpdater({ currentVersion: "0.3.0" });
    expect(updater.kind).toBe("unsupported");

    const status = await updater.check();
    expect(status.availability).toBe("unsupported");
    expect(status.currentVersion).toBe("0.3.0");

    // KV is a silent no-op; there is no desktop store to read.
    expect(await updater.getSetting("updater.consent")).toBeNull();
    await expect(updater.setSetting("k", "v")).resolves.toBeUndefined();

    await expect(updater.install()).rejects.toThrow(/unavailable/i);
    await expect(updater.relaunch()).rejects.toThrow(/unavailable/i);
    await expect(updater.backup("v0.3.0")).rejects.toThrow(/unavailable/i);
  });
});

describe("mockUpdater", () => {
  it("drives check/install/progress and records relaunch + backups", async () => {
    const updater = createMockUpdater({
      platform: "windows",
      currentVersion: "0.3.0",
      onCheck: {
        availability: "available",
        currentVersion: "0.3.0",
        availableVersion: "0.3.1",
        notes: "notes",
      },
      progress: [
        { downloaded: 25, total: 100 },
        { downloaded: 100, total: 100 },
      ],
    });

    expect((await updater.check()).availableVersion).toBe("0.3.1");

    const frames: number[] = [];
    const outcome = await updater.install((p) => frames.push(p.downloaded));
    expect(frames).toEqual([25, 100]);
    expect(outcome).toEqual({ status: "staged", version: "0.3.1" });

    await updater.backup("v0.3.0");
    expect(updater.backupCalls).toEqual(["v0.3.0"]);

    await updater.relaunch();
    expect(updater.relaunchCalls).toBe(1);
  });

  it("persists settings in its in-memory store", async () => {
    const updater = createMockUpdater({ settings: { seeded: "1" } });
    expect(await updater.getSetting("seeded")).toBe("1");
    expect(await updater.getSetting("missing")).toBeNull();
    await updater.setSetting("updater.consent", "yes");
    expect(await updater.getSetting("updater.consent")).toBe("yes");
    expect(updater.store.get("updater.consent")).toBe("yes");
  });

  it("rejects check and install when scripted to fail", async () => {
    const failing = createMockUpdater({ onCheck: new Error("offline") });
    await expect(failing.check()).rejects.toThrow("offline");

    const installFails = createMockUpdater({
      onInstall: new Error("verify failed"),
    });
    await expect(installFails.install()).rejects.toThrow("verify failed");
  });
});
