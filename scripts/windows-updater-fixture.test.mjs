import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowedUpdaterPath,
  buildWindowsDriverCapabilities,
  buildWindowsUpdaterManifest,
  mirrorWebViewDevToolsPort,
  validateWindowsAcceptanceReport,
} from "./windows-updater-fixture.mjs";

test("builds the exact loopback NSIS updater manifest", () => {
  const manifest = buildWindowsUpdaterManifest({
    version: "0.11.0",
    installerName: "Voyalier_0.11.0_x64-setup.exe",
    signature: "ephemeral-signature",
    origin: "http://127.0.0.1:48137",
    publishedAt: "2026-08-25T12:00:00Z",
  });

  assert.equal(manifest.version, "0.11.0");
  assert.deepEqual(Object.keys(manifest.platforms), [
    "windows-x86_64",
    "windows-x86_64-nsis",
  ]);
  assert.equal(
    manifest.platforms["windows-x86_64-nsis"].url,
    "http://127.0.0.1:48137/Voyalier_0.11.0_x64-setup.exe",
  );
});

test("refuses non-loopback manifests and unsafe installer names", () => {
  const base = {
    version: "0.11.0",
    installerName: "Voyalier_0.11.0_x64-setup.exe",
    signature: "ephemeral-signature",
    origin: "http://127.0.0.1:48137",
  };
  assert.throws(
    () =>
      buildWindowsUpdaterManifest({ ...base, origin: "https://example.test" }),
    /loopback/,
  );
  assert.throws(
    () =>
      buildWindowsUpdaterManifest({
        ...base,
        installerName: "../update-setup.exe",
      }),
    /bare NSIS/,
  );
  assert.throws(
    () => buildWindowsUpdaterManifest({ ...base, signature: "" }),
    /signature/,
  );
});

test("serves only the static manifest and the named installer", () => {
  const installer = "Voyalier_0.11.0_x64-setup.exe";
  assert.equal(allowedUpdaterPath("/latest.json", installer), true);
  assert.equal(allowedUpdaterPath(`/${installer}`, installer), true);
  assert.equal(allowedUpdaterPath("/latest.json?redirect=1", installer), false);
  assert.equal(allowedUpdaterPath("/../private.key", installer), false);
  assert.equal(allowedUpdaterPath("/other-setup.exe", installer), false);
});

test("nests an isolated WebView2 data directory under tauri options", () => {
  const capabilities = buildWindowsDriverCapabilities({
    application: "C:\\Program Files\\Voyalier\\Voyalier.exe",
    userDataFolder: "D:\\runner-temp\\voyalier-webview-base",
  });

  assert.deepEqual(capabilities, {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": {
          application: "C:\\Program Files\\Voyalier\\Voyalier.exe",
          args: [],
          webviewOptions: {
            userDataFolder: "D:\\runner-temp\\voyalier-webview-base",
          },
        },
      },
    },
  });
  assert.throws(
    () =>
      buildWindowsDriverCapabilities({
        application: "Voyalier.exe",
        userDataFolder: "D:\\runner-temp\\voyalier-webview-base",
      }),
    /absolute Windows path/,
  );
});

test("mirrors WebView2's nested DevTools port for EdgeDriver", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "voyalier-webview-port-"));
  try {
    const nested = path.join(root, "EBWebView");
    await mkdir(nested);
    await writeFile(path.join(nested, "DevToolsActivePort"), "48137\n/ws\n");

    const result = await mirrorWebViewDevToolsPort({
      userDataFolder: root,
      signal: new AbortController().signal,
      pollInterval: 1,
    });

    assert.deepEqual(result, {
      nestedPortObserved: true,
      rootPortMirrored: true,
      copyErrorCode: null,
    });
    assert.equal(
      await readFile(path.join(root, "DevToolsActivePort"), "utf8"),
      "48137\n/ws\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps product setup, updater backup, and portable restore on the installed UI", async () => {
  const source = await readFile(
    new URL("./windows-installed-updater-acceptance.mjs", import.meta.url),
    "utf8",
  );
  for (const forbiddenCommand of [
    "create_trip",
    "save_place",
    "add_packing_item",
    "create_trip_item",
    "backup_database",
    "updater_install",
    "export_backup",
    "stage_restore",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`invoke\\([^\\n]+[\"']${forbiddenCommand}[\"']`),
    );
  }
  for (const requiredControl of [
    "Download Kyoto city data",
    "Actualizar y reiniciar",
    "Guardar copia de seguridad",
    "Restaurar esta copia",
  ]) {
    assert.match(source, new RegExp(requiredControl));
  }
});

test("pins installed, data-preservation, backup, and loopback evidence", () => {
  const report = {
    verdict: "PASS",
    stage: "complete",
    base: {
      version: "0.10.7",
      sha: "cfd4eef671fc3fb23430e6d4a92be28e0b0e3436",
      automationPatch: {
        sha256: "a".repeat(64),
        changedFiles: ["apps/desktop/src-tauri/src/lib.rs"],
      },
    },
    candidate: { version: "0.11.0" },
    installed: { before: "0.10.7", after: "0.11.0", recovery: "0.11.0" },
    driver: {
      sessions: [
        { session: "base" },
        { session: "updated" },
        { session: "recovery" },
      ],
    },
    data: {
      tripCountBefore: 1,
      tripCountAfter: 1,
      tripCountAfterRecovery: 1,
      backupCount: 2,
    },
    journey: {
      tripCreatedViaUi: true,
      cityPackDownloadedViaUi: true,
      cityPackPlaceCount: 764,
      savedPlaceName: "Nishiki Market",
      packingLabel: "Museum pass",
      packingChecked: true,
      manualItemTitle: "Tea ceremony",
      todayObserved: true,
      searchObserved: true,
      localeBeforeUpdate: "es",
      localeAfterUpdate: "es",
      localeAfterRecovery: "es",
    },
    updaterController: {
      triggeredViaUi: true,
      harnessBackupCommandUsed: false,
      backupCountBefore: 0,
      backupCountAfter: 1,
    },
    portableBackup: {
      exportedViaUi: true,
      fileName: "voyalier-portable-acceptance.vbk",
      bytes: 4096,
      sha256: "b".repeat(64),
    },
    portableRestore: {
      stagedViaUi: true,
      appliedAfterReinstall: true,
      postBackupSentinelAbsent: true,
    },
    network: {
      requests: ["/latest.json", "/Voyalier_0.11.0_x64-setup.exe"],
      nonLoopbackRequests: 0,
      listeners: [],
    },
  };
  assert.equal(validateWindowsAcceptanceReport(report), report);
  assert.throws(
    () => validateWindowsAcceptanceReport({ ...report, stage: "updater-swap" }),
    /every installed-app stage/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        installed: { ...report.installed, after: "0.10.7" },
      }),
    /after the swap/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        driver: { sessions: [{ session: "base" }] },
      }),
    /all three packaged WebDriver sessions/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        base: {
          ...report.base,
          automationPatch: {
            ...report.base.automationPatch,
            changedFiles: ["Cargo.toml"],
          },
        },
      }),
    /unexpected file/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        journey: { ...report.journey, searchObserved: false },
      }),
    /UI journey is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        updaterController: {
          ...report.updaterController,
          backupCountAfter: 0,
        },
      }),
    /exactly one backup/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableRestore: {
          ...report.portableRestore,
          postBackupSentinelAbsent: false,
        },
      }),
    /restore and reinstall evidence is incomplete/,
  );
});
