import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedUpdaterPath,
  buildWindowsDriverCapabilities,
  buildWindowsUpdaterManifest,
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

test("pins installed, data-preservation, backup, and loopback evidence", () => {
  const report = {
    verdict: "PASS",
    stage: "complete",
    base: { version: "0.10.7" },
    candidate: { version: "0.11.0" },
    installed: { before: "0.10.7", after: "0.11.0", recovery: "0.11.0" },
    data: {
      tripCountBefore: 1,
      tripCountAfter: 1,
      tripCountAfterRecovery: 1,
      backupCount: 1,
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
});
