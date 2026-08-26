import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allowedUpdaterPath,
  buildWindowsDriverCapabilities,
  buildWindowsUpdaterManifest,
  clearWebViewDevToolsPorts,
  mirrorWebViewDevToolsPort,
  validateWinAppToolEvidence,
  validateWindowsAcceptanceReport,
  validateWindowsPickerPreflightReport,
} from "./windows-updater-fixture.mjs";
import {
  assertNoAbsoluteWindowsPaths,
  parseWindowsCommandJson,
  sanitizeWindowsEvidenceText,
  sanitizeWindowsEvidenceValue,
  WINAPP_CLI,
} from "./windows-native-file-dialog.mjs";
import {
  classifyWindowsEvidenceArtifact,
  sanitizeWindowsAcceptanceEvidence,
} from "./sanitize-windows-acceptance-evidence.mjs";

const CANDIDATE_SHA = "c".repeat(40);
const WORKFLOW_RUN_ID = "123456";
const TOOL_EXECUTABLE = "<RUNNER_TEMP>\\winapp\\winapp.exe";
const PORTABLE_PATH = "<DIALOG_TEMP>\\voyalier-portable-acceptance.vbk";
const WINAPP_RUNTIME_ELEMENT_ID = "grp-filenamecontrol-a1b2c3d4";

function winAppToolEvidence() {
  return {
    name: WINAPP_CLI.name,
    tag: WINAPP_CLI.tag,
    versionExpected: WINAPP_CLI.version,
    versionReported: WINAPP_CLI.version,
    releaseCommit: WINAPP_CLI.releaseCommit,
    assetName: WINAPP_CLI.assetName,
    assetUrl: WINAPP_CLI.assetUrl,
    archivePath: "<RUNNER_TEMP>\\winappcli-x64-v0.6.0.zip",
    archiveSha256Expected: WINAPP_CLI.archiveSha256,
    archiveSha256Actual: WINAPP_CLI.archiveSha256,
    archiveHashVerified: true,
    hashVerifiedBeforeExtractionExecution: true,
    installRoot: "<RUNNER_TEMP>\\winapp",
    executablePath: TOOL_EXECUTABLE,
    executableCount: 1,
    executableWithinTemporaryRoot: true,
    archiveWithinTemporaryRoot: true,
    cacheDirectory: "<RUNNER_TEMP>\\winapp-cache",
    cacheWithinTemporaryRoot: true,
    firstRunMarker: "<RUNNER_TEMP>\\winapp-cache\\.first-run-complete",
    firstRunMarkerSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    firstRunMarkerBytes: 0,
    firstRunMarkerPreseededBeforeExecution: true,
    updateCheckDisabled: true,
    telemetryOptOut: true,
    pathFallbackUsed: false,
    latestUsed: false,
    globalInstallUsed: false,
    inputInjectionUsed: false,
    versionCommand: { exitCode: 0, stdout: "0.6.0", stderr: "" },
  };
}

function nativeDialogEvidence({
  title,
  action,
  expectedValueToken = PORTABLE_PATH,
}) {
  return {
    verdict: "PASS",
    title,
    dialogTitle: title,
    action,
    expectedValueToken,
    observedValueToken: expectedValueToken,
    nativeDialogPathConfirmed: true,
    selectedPathWithinTemp: true,
    filenameHostAutomationId: WINAPP_CLI.selector,
    toolExecutablePath: TOOL_EXECUTABLE,
    toolVersion: WINAPP_CLI.version,
    toolArchiveSha256: WINAPP_CLI.archiveSha256,
    dialogCount: 1,
    dialogEnabled: true,
    dialogOffscreen: false,
    dialogHwnd: 12345,
    hostCount: 1,
    hostAutomationId: WINAPP_CLI.selector,
    hostEnabled: true,
    hostOffscreen: false,
    discoveryCommand: {
      exitCode: 0,
      jsonParsed: true,
      stdout: "{}",
      stderr: "",
      result: {
        title,
        dialogCount: 1,
        dialogEnabled: true,
        dialogOffscreen: false,
        hwnd: 12345,
        hostCount: 1,
        hostAutomationId: WINAPP_CLI.selector,
        hostEnabled: true,
        hostOffscreen: false,
      },
    },
    setValue: {
      exitCode: 0,
      jsonParsed: true,
      stdout: `{"elementId":"${WINAPP_RUNTIME_ELEMENT_ID}","hwnd":12345}`,
      stderr: "",
      requestedSelector: WINAPP_CLI.selector,
      windowHwnd: 12345,
      result: { elementId: WINAPP_RUNTIME_ELEMENT_ID, hwnd: 12345 },
    },
    getValue: {
      exitCode: 0,
      jsonParsed: true,
      stdoutOmitted: true,
      stdoutSha256: "e".repeat(64),
      stderr: "",
      requestedSelector: WINAPP_CLI.selector,
      windowHwnd: 12345,
      result: { elementId: WINAPP_RUNTIME_ELEMENT_ID, textOmitted: true },
    },
    controlIdentityMatched: true,
    pathReadbackConfirmed: true,
    inputInjectionUsed: false,
    actionCandidateCount: 1,
    exactActionTargetCount: 1,
    actionName: action,
    actionControlType: "ControlType.Pane",
    actionAutomationId: "1",
    actionPattern: "LegacyIAccessiblePattern",
    actionInvoked: true,
    dialogDismissed: true,
    actionCommand: {
      exitCode: 0,
      jsonParsed: true,
      stdout: "{}",
      stderr: "",
      result: {
        hwnd: 12345,
        actionCandidateCount: 1,
        exactActionTargetCount: 1,
        actionName: action,
        actionControlType: "ControlType.Pane",
        actionAutomationId: "1",
        actionPattern: "LegacyIAccessiblePattern",
        actionInvoked: true,
        dialogDismissed: true,
      },
    },
  };
}

function pickerPreflightEvidence(tool = winAppToolEvidence()) {
  const markerPath =
    "<DIALOG_TEMP>\\voyalier-picker-preflight-0123456789abcdef01234567.txt";
  return {
    verdict: "PASS",
    stage: "complete",
    proofKind: "harness-tool-compatibility",
    productEvidence: false,
    candidateSha: CANDIDATE_SHA,
    workflowRunId: WORKFLOW_RUN_ID,
    tool,
    dialog: nativeDialogEvidence({
      title: "Voyalier picker bridge preflight 0123456789abcdef01234567",
      action: "Save",
      expectedValueToken: markerPath,
    }),
    marker: {
      fileName: "voyalier-picker-preflight-0123456789abcdef01234567.txt",
      selectedPathToken: markerPath,
      selectedPathWithinTemporaryRoot: true,
      bytes: 58,
      sha256: "d".repeat(64),
      expectedSha256: "d".repeat(64),
      contentConfirmed: true,
      hostReturnedExactPath: true,
      removed: true,
    },
    dialogHost: {
      exitCode: 0,
      stdoutOmitted: true,
      stdoutSha256: "f".repeat(64),
      stderr: "",
      jsonParsed: true,
      result: { result: "OK", selectedPathToken: markerPath },
    },
    temporaryRootRemoved: true,
  };
}

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

test("clears stale WebView2 ports before mirroring the new session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "voyalier-webview-port-"));
  try {
    const nested = path.join(root, "EBWebView");
    await mkdir(nested);
    await writeFile(path.join(root, "DevToolsActivePort"), "41000\n/stale\n");
    await writeFile(path.join(nested, "DevToolsActivePort"), "41000\n/stale\n");
    await clearWebViewDevToolsPorts(root);
    await assert.rejects(
      readFile(path.join(root, "DevToolsActivePort"), "utf8"),
      { code: "ENOENT" },
    );
    await assert.rejects(
      readFile(path.join(nested, "DevToolsActivePort"), "utf8"),
      { code: "ENOENT" },
    );
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
    "Save place",
    "Search workspace",
    "Settings",
    "Actualizar y reiniciar",
    "Buscar en el espacio de trabajo",
    "Configuración",
    "Voyalier — todos los viajes",
    "Guardar copia de seguridad",
    "Restaurar esta copia",
  ]) {
    assert.match(source, new RegExp(requiredControl));
  }
  assert.match(
    source,
    /section\[aria-labelledby=\\?"packing-checklist-title\\?"\]/,
  );
  assert.match(source, /section\[aria-labelledby=\\?"saved-places-title\\?"\]/);
  assert.match(source, /section\[aria-labelledby=\\?"manual-plan-title\\?"\]/);
  assert.match(source, /readCheckboxState/);
  assert.match(source, /driveNativeFileDialog/);
  assert.match(source, /loadVerifiedWinAppTool/);
  assert.match(source, /portableBackupNotice\.endsWith\(portableBackupPath\)/);
  const screenshotHelper = source.slice(
    source.indexOf("async function screenshot"),
    source.indexOf("function installedProcesses"),
  );
  assert.match(screenshotHelper, /remainingAbsolutePathMatches/);
  assert.match(screenshotHelper, /pathRedactionConfirmed: true/);
  assert.doesNotMatch(screenshotHelper, /\.catch\(/);
  assert.doesNotMatch(source, /WScript\.Shell|Set-Clipboard|SendKeys/);
  assert.doesNotMatch(source, /#section-plan/);

  const nativeDialogSource = await readFile(
    new URL("./windows-native-file-dialog.mjs", import.meta.url),
    "utf8",
  );
  for (const requiredNativeProof of [
    "FileNameControlHost",
    "set-value",
    "get-value",
    "--window",
    "InvokePattern",
    "LegacyIAccessiblePattern",
    "ControlType.Pane",
    "dialogDismissed",
    "pathReadbackConfirmed",
  ]) {
    assert.match(nativeDialogSource, new RegExp(requiredNativeProof));
  }
  assert.doesNotMatch(
    nativeDialogSource,
    /send-keys|sendkeys|WScript\.Shell|Set-Clipboard|Clipboard|SetFocus\(/i,
  );
  assert.doesNotMatch(
    nativeDialogSource,
    /AutomationIdProperty, ['"](?:1148|1001)['"]/,
  );
  const actionBridge = nativeDialogSource.slice(
    nativeDialogSource.indexOf("function invokeExactAction"),
    nativeDialogSource.indexOf("export async function driveNativeFileDialog"),
  );
  const uniqueStateGate = actionBridge.indexOf(
    "if ($exactActionTargetCount -ne 1)",
  );
  const invokePatternProbe = actionBridge.indexOf(
    "[System.Windows.Automation.InvokePattern]::Pattern",
  );
  const candidateObservation = actionBridge.indexOf(
    "$candidateObservations.Add(",
  );
  assert.ok(
    uniqueStateGate !== -1 &&
      invokePatternProbe !== -1 &&
      uniqueStateGate < invokePatternProbe,
    "action uniqueness must be proven before pattern selection",
  );
  assert.ok(
    candidateObservation !== -1 && candidateObservation < uniqueStateGate,
    "failed action uniqueness must preserve safe candidate diagnostics",
  );

  const preflightSource = await readFile(
    new URL("./windows-picker-preflight.mjs", import.meta.url),
    "utf8",
  );
  assert.match(preflightSource, /System\.Windows\.Forms\.SaveFileDialog/);
  assert.match(preflightSource, /hostReturnedExactPath/);
  assert.match(preflightSource, /productEvidence: false/);

  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    new RegExp(WINAPP_CLI.assetUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(workflow, new RegExp(WINAPP_CLI.archiveSha256));
  const winAppInstallStep = workflow.slice(
    workflow.indexOf("Install the verified Windows App CLI"),
    workflow.indexOf("Prove the native picker bridge"),
  );
  assert.doesNotMatch(
    winAppInstallStep,
    /releases\/latest|winget|setup-WinAppCli|GITHUB_PATH/i,
  );
  const hashCheck = workflow.indexOf("if ($actualHash -cne $expectedHash)");
  const extraction = workflow.indexOf("Expand-Archive");
  const firstRunMarker = workflow.indexOf(
    "[System.IO.File]::WriteAllBytes($firstRunMarker, [byte[]]@())",
  );
  const execution = workflow.indexOf("--version");
  assert.ok(
    hashCheck !== -1 &&
      hashCheck < extraction &&
      extraction < firstRunMarker &&
      firstRunMarker < execution,
  );
  assert.match(
    winAppInstallStep,
    /VOYALIER_WINAPP_FIRST_RUN_MARKER_PRESEEDED_BEFORE_EXECUTION/,
  );
  const preflightStep = workflow.indexOf("Prove the native picker bridge");
  assert.ok(
    preflightStep !== -1 &&
      preflightStep < workflow.indexOf("dtolnay/rust-toolchain", preflightStep),
  );
  const sanitizationStep = workflow.indexOf(
    "node scripts/sanitize-windows-acceptance-evidence.mjs",
  );
  const uploadStep = workflow.indexOf(
    "Upload sanitized Windows acceptance evidence",
  );
  assert.ok(sanitizationStep !== -1 && sanitizationStep < uploadStep);
  assert.match(
    workflow,
    /steps\.sanitize_windows_evidence\.outcome == 'success'/,
  );
});

test("rejects unverified picker tooling and incomplete preflight proof", () => {
  const tool = winAppToolEvidence();
  const invalidTools = [
    { tag: "v0.6.1" },
    { versionReported: "0.6.1" },
    { releaseCommit: "e".repeat(40) },
    { assetName: "winappcli-arm64.zip" },
    { assetUrl: "https://example.test/winapp.zip" },
    { archiveSha256Actual: "e".repeat(64) },
    { archiveHashVerified: false },
    { hashVerifiedBeforeExtractionExecution: false },
    { executableCount: 2 },
    { firstRunMarkerPreseededBeforeExecution: false },
    { firstRunMarkerBytes: 1 },
    {
      versionCommand: {
        exitCode: 0,
        stdout: "Welcome to winapp\n0.6.0",
        stderr: "",
      },
    },
    { pathFallbackUsed: true },
    { latestUsed: true },
    { inputInjectionUsed: true },
  ];
  for (const invalid of invalidTools) {
    assert.throws(
      () => validateWinAppToolEvidence({ ...tool, ...invalid }),
      /provenance evidence is incomplete/,
    );
  }

  const preflight = pickerPreflightEvidence(tool);
  const invalidPreflights = [
    { ...preflight, productEvidence: true },
    { ...preflight, candidateSha: "e".repeat(40) },
    {
      ...preflight,
      dialog: { ...preflight.dialog, filenameHostAutomationId: "1148" },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, discoveryCommand: undefined },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        discoveryCommand: {
          ...preflight.dialog.discoveryCommand,
          result: {
            ...preflight.dialog.discoveryCommand.result,
            hwnd: 999,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionControlType: "ControlType.List",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionControlType: "ControlType.List",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAutomationId: undefined,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAutomationId: undefined,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        setValue: {
          ...preflight.dialog.setValue,
          requestedSelector: "wrong-control",
        },
        getValue: {
          ...preflight.dialog.getValue,
          requestedSelector: "wrong-control",
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        setValue: {
          ...preflight.dialog.setValue,
          result: { ...preflight.dialog.setValue.result, hwnd: 999 },
        },
      },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, pathReadbackConfirmed: false },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        getValue: {
          ...preflight.dialog.getValue,
          result: {
            ...preflight.dialog.getValue.result,
            elementId: "different-control",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, dialogDismissed: false },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, actionCommand: undefined },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            dialogDismissed: false,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        exactActionTargetCount: 2,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            exactActionTargetCount: 2,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionPattern: "Keyboard",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionPattern: "Keyboard",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, inputInjectionUsed: true },
    },
    {
      ...preflight,
      marker: { ...preflight.marker, contentConfirmed: false },
    },
  ];
  for (const invalid of invalidPreflights) {
    assert.throws(
      () =>
        validateWindowsPickerPreflightReport(invalid, {
          candidateSha: CANDIDATE_SHA,
          workflowRunId: WORKFLOW_RUN_ID,
        }),
      /preflight evidence is incomplete/,
    );
  }
});

test("sanitizes and recursively rejects absolute Windows evidence paths", () => {
  const environment = {
    RUNNER_TEMP: "D:\\a\\_temp",
    GITHUB_WORKSPACE: "D:\\a\\Voyalier\\Voyalier",
    LOCALAPPDATA: "C:\\Users\\runneradmin\\AppData\\Local",
    USERPROFILE: "C:\\Users\\runneradmin",
  };
  const sanitized = sanitizeWindowsEvidenceValue(
    {
      tool: "D:\\a\\_temp\\winapp\\winapp.exe",
      nested: [
        "C:\\Users\\runneradmin\\AppData\\Local\\Voyalier",
        "E:\\unrecognized\\private.vbk",
      ],
    },
    environment,
  );
  assert.deepEqual(sanitized, {
    tool: "<RUNNER_TEMP>\\winapp\\winapp.exe",
    nested: ["<LOCALAPPDATA>\\Voyalier", "<ABSOLUTE_PATH>"],
  });
  assert.equal(assertNoAbsoluteWindowsPaths(sanitized), sanitized);
  assert.equal(
    sanitizeWindowsEvidenceText("saved D:\\a\\_temp\\backup.vbk", environment),
    "saved <RUNNER_TEMP>\\backup.vbk",
  );
  assert.throws(
    () => assertNoAbsoluteWindowsPaths({ leaked: "C:\\private\\backup.vbk" }),
    /absolute Windows path remained/,
  );
  assert.equal(
    sanitizeWindowsEvidenceText("saved C:/private/backup.vbk", environment),
    "saved <ABSOLUTE_PATH>",
  );
  assert.equal(
    sanitizeWindowsEvidenceText(
      "saved //server/share/private.vbk",
      environment,
    ),
    "saved <UNC_PATH>",
  );
  assert.equal(
    sanitizeWindowsEvidenceText(
      "source https://github.com/microsoft/winappCli",
      environment,
    ),
    "source https://github.com/microsoft/winappCli",
  );
  assert.throws(
    () => assertNoAbsoluteWindowsPaths({ leaked: "C:/private/backup.vbk" }),
    /absolute Windows path remained/,
  );
  assert.throws(
    () =>
      assertNoAbsoluteWindowsPaths({ leaked: "//server/share/private.vbk" }),
    /absolute Windows path remained/,
  );
});

test("parses raw escaped Windows-path JSON before sanitizing command evidence", () => {
  const rawPath = "D:\\a\\_temp\\portable.vbk";
  const captured = parseWindowsCommandJson(
    {
      exitCode: 0,
      stdout: JSON.stringify({
        elementId: WINAPP_CLI.selector,
        text: rawPath,
      }),
      stderr: "",
    },
    { RUNNER_TEMP: "D:\\a\\_temp" },
  );
  assert.equal(captured.result.text, rawPath);
  assert.equal(captured.evidence.result.text, "<RUNNER_TEMP>\\portable.vbk");
  assert.doesNotMatch(captured.evidence.stdout, /D:\\\\a/);
  assert.match(captured.stdoutSha256, /^[0-9a-f]{64}$/);
});

test("classifies every uploadable Windows evidence artifact", async () => {
  assert.equal(classifyWindowsEvidenceArtifact("summary.md"), "text");
  assert.equal(
    classifyWindowsEvidenceArtifact("04-portable-backup-exported.png"),
    "png",
  );
  assert.throws(
    () => classifyWindowsEvidenceArtifact("private-backup.vbk"),
    /unclassified Windows acceptance artifact/,
  );
  assert.throws(
    () => classifyWindowsEvidenceArtifact("nested/private.txt"),
    /Expected values to be strictly equal/,
  );
  const root = await mkdtemp(path.join(os.tmpdir(), "voyalier-evidence-"));
  try {
    await writeFile(path.join(root, "private-backup.vbk"), "private");
    await assert.rejects(
      () => sanitizeWindowsAcceptanceEvidence(root),
      /unclassified Windows acceptance artifact/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pins installed, data-preservation, backup, and loopback evidence", () => {
  const nativePickerTool = winAppToolEvidence();
  const pickerPreflight = pickerPreflightEvidence(nativePickerTool);
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
    candidate: { version: "0.11.0", sha: CANDIDATE_SHA },
    workflow: { runId: WORKFLOW_RUN_ID },
    nativePickerTool,
    pickerPreflight,
    installed: {
      path: "<LOCALAPPDATA>\\Voyalier\\Voyalier.exe",
      before: "0.10.7",
      after: "0.11.0",
      recovery: "0.11.0",
    },
    driver: {
      sharedJourneyProfile: true,
      sessions: [
        {
          session: "base",
          profile: "voyalier-acceptance-journey",
          preservedExistingProfile: false,
          stalePortFilesCleared: true,
        },
        {
          session: "updated",
          profile: "voyalier-acceptance-journey",
          preservedExistingProfile: true,
          stalePortFilesCleared: true,
        },
        {
          session: "recovery",
          profile: "voyalier-acceptance-journey",
          preservedExistingProfile: true,
          stalePortFilesCleared: true,
        },
      ],
    },
    data: {
      tripCountBefore: 1,
      tripCountAfter: 1,
      tripCountAfterRecovery: 1,
      backupCount: 2,
    },
    preservation: Object.fromEntries(
      ["base", "updated", "recovery"].map((stage) => [
        stage,
        {
          savedPlaceId: "place-1",
          savedPlaceName: "Nishiki Market",
          packingItemId: "packing-1",
          packingLabel: "Museum pass",
          packingChecked: true,
          manualItemId: "item-1",
          manualItemTitle: "Tea ceremony",
          manualItemStartAt: "2026-08-25T12:00",
          todayReferenceDate: "2026-08-25",
          todayContainsManualItem: true,
        },
      ]),
    ),
    ui: Object.fromEntries(
      ["base", "updated", "recovery"].map((stage) => [
        stage,
        {
          savedPlaceObserved: true,
          packingCheckboxObserved: true,
          packingCheckboxChecked: true,
          todayObserved: true,
        },
      ]),
    ),
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
      screenshotPathRedacted: true,
      screenshotEvidence: {
        fileName: "04-portable-backup-exported.png",
        pathRedactionConfirmed: true,
        remainingAbsolutePathMatches: 0,
        written: true,
      },
      ...nativeDialogEvidence({
        title: "Save Voyalier backup",
        action: "Save",
      }),
      fileName: "voyalier-portable-acceptance.vbk",
      bytes: 4096,
      sha256: "b".repeat(64),
    },
    portableRestore: {
      stagedViaUi: true,
      ...nativeDialogEvidence({
        title: "Choose a Voyalier backup",
        action: "Open",
      }),
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
  assert.equal(validateWinAppToolEvidence(nativePickerTool), nativePickerTool);
  assert.equal(
    validateWindowsPickerPreflightReport(pickerPreflight, {
      candidateSha: CANDIDATE_SHA,
      workflowRunId: WORKFLOW_RUN_ID,
    }),
    pickerPreflight,
  );
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
        driver: {
          ...report.driver,
          sharedJourneyProfile: false,
        },
      }),
    /preserve one isolated WebView profile/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        driver: {
          ...report.driver,
          sessions: report.driver.sessions.map((session, index) =>
            index === 1
              ? { ...session, stalePortFilesCleared: false }
              : session,
          ),
        },
      }),
    /stale WebView debug port/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        preservation: {
          ...report.preservation,
          updated: {
            ...report.preservation.updated,
            manualItemId: "item-changed",
          },
        },
      }),
    /record identity changed/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        preservation: {
          ...report.preservation,
          recovery: {
            ...report.preservation.recovery,
            todayContainsManualItem: false,
          },
        },
      }),
    /traveler data evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        ui: {
          ...report.ui,
          updated: {
            ...report.ui.updated,
            packingCheckboxChecked: false,
          },
        },
      }),
    /installed UI evidence is incomplete/,
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
        portableBackup: {
          ...report.portableBackup,
          nativeDialogPathConfirmed: false,
        },
      }),
    /portable backup UI evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableBackup: {
          ...report.portableBackup,
          selectedPathWithinTemp: false,
        },
      }),
    /portable backup UI evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableBackup: {
          ...report.portableBackup,
          screenshotEvidence: {
            ...report.portableBackup.screenshotEvidence,
            pathRedactionConfirmed: false,
          },
        },
      }),
    /portable backup UI evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableBackup: {
          ...report.portableBackup,
          filenameHostAutomationId: "1148",
        },
      }),
    /portable backup UI evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableBackup: {
          ...report.portableBackup,
          observedValueToken: "<DIALOG_TEMP>\\wrong.vbk",
        },
      }),
    /portable backup UI evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableRestore: {
          ...report.portableRestore,
          nativeDialogPathConfirmed: false,
        },
      }),
    /restore and reinstall evidence is incomplete/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        portableRestore: {
          ...report.portableRestore,
          filenameHostAutomationId: "1148",
        },
      }),
    /restore and reinstall evidence is incomplete/,
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
