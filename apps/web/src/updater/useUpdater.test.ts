import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createMockUpdater } from "./mockUpdater";
import type { UpdateStatus } from "./types";
import { UPDATER_KEYS } from "./types";
import { createUnsupportedUpdater } from "./unsupportedUpdater";
import { compareVersions, useUpdater } from "./useUpdater";

const available = (version: string): UpdateStatus => ({
  availability: "available",
  currentVersion: "0.3.0",
  availableVersion: version,
  notes: "Fixes",
});

const upToDate = (version: string): UpdateStatus => ({
  availability: "upToDate",
  currentVersion: version,
  availableVersion: null,
  notes: null,
});

describe("compareVersions", () => {
  it("orders dotted versions numerically", () => {
    expect(compareVersions("0.3.1", "0.3.0")).toBe(1);
    expect(compareVersions("0.3.0", "0.3.1")).toBe(-1);
    expect(compareVersions("0.3.0", "0.3.0")).toBe(0);
    expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
  });

  it("handles different segment counts and (per doc) ignores suffixes", () => {
    // Missing trailing segments read as 0.
    expect(compareVersions("0.3", "0.3.1")).toBe(-1);
    expect(compareVersions("0.3.0", "0.3")).toBe(0);
    // Leading zeros are numeric, not lexicographic.
    expect(compareVersions("0.03.0", "0.3.0")).toBe(0);
    // Pre-release suffixes are ignored (documented limitation).
    expect(compareVersions("0.3.1-rc1", "0.3.1")).toBe(0);
  });
});

describe("useUpdater", () => {
  it("asks for consent once, then checks after the answer", async () => {
    const gw = createMockUpdater({ onCheck: upToDate("0.3.0") });
    const { result } = renderHook(() => useUpdater(gw));

    await waitFor(() => expect(result.current.phase.name).toBe("consent"));

    await act(async () => {
      await result.current.answerConsent(true);
    });
    expect(gw.store.get(UPDATER_KEYS.consent)).toBe("yes");
    await waitFor(() => expect(result.current.phase.name).toBe("upToDate"));
  });

  it("declining consent leaves manual-only idle", async () => {
    const gw = createMockUpdater({ onCheck: upToDate("0.3.0") });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("consent"));

    await act(async () => {
      await result.current.answerConsent(false);
    });
    expect(gw.store.get(UPDATER_KEYS.consent)).toBe("no");
    expect(result.current.phase.name).toBe("idle");
  });

  it("auto-checks with consent and surfaces an available update + skip/un-skip", async () => {
    const gw = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));
    expect((result.current.phase as { skipped: boolean }).skipped).toBe(false);

    await act(async () => {
      await result.current.skip();
    });
    expect(gw.store.get(UPDATER_KEYS.skippedVersion)).toBe("0.3.1");
    expect((result.current.phase as { skipped: boolean }).skipped).toBe(true);

    await act(async () => {
      await result.current.unskip();
    });
    expect(gw.store.get(UPDATER_KEYS.skippedVersion)).toBe("");
    expect((result.current.phase as { skipped: boolean }).skipped).toBe(false);
  });

  it("reports devShell for a disabled desktop build", async () => {
    const gw = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: {
        availability: "disabled",
        currentVersion: "0.3.0",
        availableVersion: null,
        notes: null,
      },
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("disabled"));
    expect(result.current.mode).toBe("devShell");
  });

  it("reports unsupported in a plain browser", async () => {
    const gw = createUnsupportedUpdater({ currentVersion: "0.3.0" });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("unsupported"));
    expect(result.current.mode).toBe("browser");
  });

  it("installs on macOS: backs up, stages, and persists the staged version", async () => {
    const gw = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
      progress: [{ downloaded: 50, total: 100 }],
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));

    await act(async () => {
      await result.current.install();
    });
    await waitFor(() => expect(result.current.phase.name).toBe("staged"));
    expect(gw.backupCalls).toEqual(["v0.3.1"]);
    expect(gw.store.get(UPDATER_KEYS.stagedVersion)).toBe("0.3.1");
    expect((result.current.phase as { version: string }).version).toBe("0.3.1");
  });

  it("installs on Windows: backs up then goes to installing/staged", async () => {
    const gw = createMockUpdater({
      platform: "windows",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));

    await act(async () => {
      await result.current.install();
    });
    // The mock resolves, so we land on staged; the real Windows process would
    // typically exit before returning.
    await waitFor(() => expect(result.current.phase.name).toBe("staged"));
    expect(gw.backupCalls).toEqual(["v0.3.1"]);
  });

  it("shows a staged update at mount and clears it once the build catches up", async () => {
    const gw = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "no",
        [UPDATER_KEYS.stagedVersion]: "0.3.1",
      },
      onCheck: upToDate("0.3.1"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    // consent "no" → no auto-check → the persisted staged version is shown.
    await waitFor(() => expect(result.current.phase.name).toBe("staged"));

    await act(async () => {
      await result.current.check();
    });
    // Running 0.3.1 >= staged 0.3.1 → the staged marker is cleared.
    await waitFor(() => expect(result.current.phase.name).toBe("upToDate"));
    expect(gw.store.get(UPDATER_KEYS.stagedVersion)).toBe("");
  });

  it("keeps showing a staged update when the auto-check fails (offline relaunch)", async () => {
    // consent=yes → mount auto-checks; the check throws (e.g. offline) but a
    // staged update is persisted, so the machine must surface "staged", not
    // bury it behind an error.
    const gw = createMockUpdater({
      platform: "macos",
      settings: {
        [UPDATER_KEYS.consent]: "yes",
        [UPDATER_KEYS.stagedVersion]: "0.3.1",
      },
      onCheck: new Error("offline"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("staged"));
    expect((result.current.phase as { version: string }).version).toBe("0.3.1");
    // The staged marker is preserved (a failed check must not clear it).
    expect(gw.store.get(UPDATER_KEYS.stagedVersion)).toBe("0.3.1");
  });

  it("maps an install failure to a coarse error", async () => {
    const gw = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
      onInstall: new Error("verify failed"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));
    await act(async () => {
      await result.current.install();
    });
    await waitFor(() => expect(result.current.phase.name).toBe("error"));
  });

  it("keeps a skipped version skipped across a fresh check", async () => {
    const gw = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "yes",
        [UPDATER_KEYS.skippedVersion]: "0.3.1",
      },
      onCheck: available("0.3.1"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));
    // A manual check still SHOWS the available version, but marked skipped.
    expect((result.current.phase as { skipped: boolean }).skipped).toBe(true);
  });

  it("consent=no with nothing staged settles on idle", async () => {
    const gw = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "no" },
      onCheck: available("0.3.1"),
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("idle"));
  });

  it("exposes the transient installing phase with streamed progress", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gw = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
      progress: [{ downloaded: 50, total: 100 }],
      hold,
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));

    let installed!: Promise<void>;
    await act(async () => {
      installed = result.current.install();
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.phase.name).toBe("installing"));
    expect((result.current.phase as { progress: unknown }).progress).toEqual({
      downloaded: 50,
      total: 100,
    });

    release();
    await act(async () => {
      await installed;
    });
    await waitFor(() => expect(result.current.phase.name).toBe("staged"));
  });

  it("fires justUpdated only when the running build is newer than last seen", async () => {
    // First run: no last-seen recorded → no toast, but last-seen is persisted.
    const first = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: upToDate("0.3.0"),
    });
    const { result: r1 } = renderHook(() => useUpdater(first));
    await waitFor(() => expect(r1.current.phase.name).toBe("upToDate"));
    expect(r1.current.justUpdated).toBeNull();
    expect(first.store.get(UPDATER_KEYS.lastSeenVersion)).toBe("0.3.0");

    // Newer running build than last seen → one-shot toast; dismiss clears it.
    const bumped = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "yes",
        [UPDATER_KEYS.lastSeenVersion]: "0.3.0",
      },
      onCheck: upToDate("0.3.1"),
    });
    const { result: r2 } = renderHook(() => useUpdater(bumped));
    await waitFor(() => expect(r2.current.justUpdated).toBe("0.3.1"));
    act(() => r2.current.dismissJustUpdated());
    await waitFor(() => expect(r2.current.justUpdated).toBeNull());

    // Downgrade → silent (never toast a lower version).
    const down = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "yes",
        [UPDATER_KEYS.lastSeenVersion]: "0.3.1",
      },
      onCheck: upToDate("0.3.0"),
    });
    const { result: r3 } = renderHook(() => useUpdater(down));
    await waitFor(() => expect(r3.current.phase.name).toBe("upToDate"));
    expect(r3.current.justUpdated).toBeNull();
  });

  it("clears the staged marker on restart (consent=no path)", async () => {
    const gw = createMockUpdater({
      settings: {
        [UPDATER_KEYS.consent]: "no",
        [UPDATER_KEYS.stagedVersion]: "0.3.1",
      },
    });
    const { result } = renderHook(() => useUpdater(gw));
    await waitFor(() => expect(result.current.phase.name).toBe("staged"));

    await act(async () => {
      await result.current.restart();
    });
    // Cleared so the next launch won't keep nagging "restart to finish".
    expect(gw.store.get(UPDATER_KEYS.stagedVersion)).toBe("");
    expect(gw.relaunchCalls).toBe(1);
  });

  it("restarts to finish and maps a failed check to a coarse error", async () => {
    const staged = createMockUpdater({
      platform: "macos",
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: available("0.3.1"),
    });
    const { result } = renderHook(() => useUpdater(staged));
    await waitFor(() => expect(result.current.phase.name).toBe("available"));
    await act(async () => {
      await result.current.restart();
    });
    expect(staged.relaunchCalls).toBe(1);

    const failing = createMockUpdater({
      settings: { [UPDATER_KEYS.consent]: "yes" },
      onCheck: new Error("boom"),
    });
    const { result: r2 } = renderHook(() => useUpdater(failing));
    await waitFor(() => expect(r2.current.phase.name).toBe("error"));
    // navigator.onLine defaults to true in jsdom → the generic (non-offline) copy.
    expect((r2.current.phase as { reason: string }).reason).toBe("generic");
  });
});

describe("updater operation ownership", () => {
  it.each(["macos", "windows"] as const)(
    "owns backup through installation on %s and rejects competing actions",
    async (platform) => {
      let releaseBackup!: () => void;
      let releaseInstall!: () => void;
      const backupPending = new Promise<void>((resolve) => {
        releaseBackup = resolve;
      });
      const installPending = new Promise<void>((resolve) => {
        releaseInstall = resolve;
      });
      const gw = createMockUpdater({
        platform,
        settings: { [UPDATER_KEYS.consent]: "yes" },
        onCheck: available("0.3.1"),
        hold: installPending,
      });
      const originalBackup = gw.backup;
      const backup = vi
        .spyOn(gw, "backup")
        .mockImplementation(async (label) => {
          await backupPending;
          return originalBackup(label);
        });
      const install = vi.spyOn(gw, "install");
      const check = vi.spyOn(gw, "check");
      const settings = vi.spyOn(gw, "setSetting");
      const { result } = renderHook(() => useUpdater(gw));
      await waitFor(() => expect(result.current.phase.name).toBe("available"));
      check.mockClear();
      settings.mockClear();
      let first!: Promise<void>;
      const competingActions = async () => {
        await result.current.install();
        await result.current.check();
        await result.current.skip();
        await result.current.unskip();
        await result.current.answerConsent(false);
        await result.current.restart();
        await expect(result.current.clearBackups()).rejects.toThrow();
      };
      await act(async () => {
        first = result.current.install();
        await competingActions();
      });
      expect(result.current.phase.name).toBe("preparing");
      expect(backup).toHaveBeenCalledTimes(1);
      expect(install).not.toHaveBeenCalled();
      expect(check).not.toHaveBeenCalled();
      expect(settings).not.toHaveBeenCalled();
      expect(gw.clearBackupsCalls).toBe(0);
      expect(gw.relaunchCalls).toBe(0);
      expect(result.current.autoCheck).toBe(true);
      await act(async () => {
        releaseBackup();
      });
      await waitFor(() => expect(result.current.phase.name).toBe("installing"));
      await act(async () => {
        await competingActions();
      });
      expect(result.current.phase.name).toBe("installing");
      expect(backup).toHaveBeenCalledTimes(1);
      expect(install).toHaveBeenCalledTimes(1);
      expect(check).not.toHaveBeenCalled();
      expect(settings).not.toHaveBeenCalled();
      expect(gw.clearBackupsCalls).toBe(0);
      expect(gw.relaunchCalls).toBe(0);
      await act(async () => {
        releaseInstall();
        await first;
      });
      expect(result.current.phase).toEqual({
        name: "staged",
        version: "0.3.1",
      });
      expect(gw.store.get(UPDATER_KEYS.stagedVersion)).toBe(
        platform === "macos" ? "0.3.1" : undefined,
      );
    },
  );

  it.each(["backup", "install"] as const)(
    "releases ownership after %s failure for an intentional retry",
    async (failure) => {
      const gw = createMockUpdater({
        settings: { [UPDATER_KEYS.consent]: "yes" },
        onCheck: available("0.3.1"),
      });
      const backup = vi.spyOn(gw, "backup");
      const install = vi.spyOn(gw, "install");
      if (failure === "backup")
        backup.mockRejectedValueOnce(new Error("locked"));
      else install.mockRejectedValueOnce(new Error("download failed"));
      const { result } = renderHook(() => useUpdater(gw));
      await waitFor(() => expect(result.current.phase.name).toBe("available"));
      await act(async () => {
        await result.current.install();
      });
      expect(result.current.phase).toEqual({
        name: "error",
        reason: failure === "backup" ? "backup" : "generic",
      });
      expect(install).toHaveBeenCalledTimes(failure === "backup" ? 0 : 1);
      await act(async () => {
        await result.current.check();
      });
      expect(result.current.phase.name).toBe("available");
      await act(async () => {
        await result.current.install();
      });
      expect(result.current.phase.name).toBe("staged");
      expect(backup).toHaveBeenCalledTimes(2);
      expect(install).toHaveBeenCalledTimes(failure === "backup" ? 1 : 2);
    },
  );
});

it("does not start installation while an earlier settings write owns the controller", async () => {
  const gw = createMockUpdater({
    settings: { [UPDATER_KEYS.consent]: "yes" },
    onCheck: available("0.3.1"),
  });
  const { result } = renderHook(() => useUpdater(gw));
  await waitFor(() => expect(result.current.phase.name).toBe("available"));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = gw.setSetting;
  vi.spyOn(gw, "setSetting").mockImplementationOnce(async (key, value) => {
    await pending;
    await original(key, value);
  });
  let skip!: Promise<void>;
  await act(async () => {
    skip = result.current.skip();
    await result.current.install();
  });
  expect(gw.backupCalls).toHaveLength(0);
  await act(async () => {
    release();
    await skip;
  });
  expect(result.current.phase).toMatchObject({
    name: "available",
    skipped: true,
  });
  await act(async () => {
    await result.current.install();
  });
  expect(gw.backupCalls).toHaveLength(1);
  expect(result.current.phase.name).toBe("staged");
});
