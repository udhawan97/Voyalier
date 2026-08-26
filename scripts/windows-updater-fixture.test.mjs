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
  validateWindowsAcceptanceReport,
  validateWindowsPickerPhaseTrace,
  validateWindowsPickerPreflightReport,
  WINDOWS_PICKER_PHASE_MARKERS,
} from "./windows-updater-fixture.mjs";
import {
  assertNoAbsoluteWindowsPaths,
  FILE_NAME_HOST_AUTOMATION_ID,
  nativeDialogHostPolicy,
  parseWindowsCommandJson,
  sanitizeWindowsEvidenceText,
  sanitizeWindowsEvidenceValue,
  WINDOWS_ACCESSIBLE_ACTION,
} from "./windows-native-file-dialog.mjs";
import {
  classifyWindowsEvidenceArtifact,
  sanitizeWindowsAcceptanceEvidence,
} from "./sanitize-windows-acceptance-evidence.mjs";

const CANDIDATE_SHA = "c".repeat(40);
const WORKFLOW_RUN_ID = "123456";
const PORTABLE_PATH = "<DIALOG_TEMP>\\voyalier-portable-acceptance.vbk";
const COMPLETE_PICKER_PHASE_TRACE = WINDOWS_PICKER_PHASE_MARKERS.map(
  ([phase]) => phase,
).filter((phase) => !phase.endsWith(":dialog-returned-none"));

function nativeDialogEvidence({
  title,
  action,
  expectedValueToken = PORTABLE_PATH,
  presetMethod = "rfd::FileDialog::set_directory+set_file_name",
}) {
  const hostPolicy = nativeDialogHostPolicy(action);
  const hostCount = hostPolicy.required ? 1 : 0;
  const hostAutomationId =
    hostCount === 1 ? FILE_NAME_HOST_AUTOMATION_ID : null;
  const hostEnabled = hostCount === 1 ? true : null;
  const hostOffscreen = hostCount === 1 ? false : null;
  return {
    verdict: "PASS",
    title,
    dialogTitle: title,
    action,
    expectedValueToken,
    presetMethod,
    pathPresetExpected: true,
    externalSetterUsed: false,
    nativeDialogActionConfirmed: true,
    expectedPathWithinTemp: true,
    filenameHostAutomationId: FILE_NAME_HOST_AUTOMATION_ID,
    filenameHostRequired: hostPolicy.required,
    dialogCount: 1,
    dialogEnabled: true,
    dialogOffscreen: false,
    dialogHwnd: 12345,
    hostCount,
    hostAutomationId,
    hostEnabled,
    hostOffscreen,
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
        filenameHostRequired: hostPolicy.required,
        hostCount,
        hostAutomationId,
        hostEnabled,
        hostOffscreen,
      },
    },
    expectedPathSha256: "a".repeat(64),
    inputInjectionUsed: false,
    dialogCountBefore: 1,
    dialogCountAfter: 0,
    actionCandidateCount: 1,
    exactActionTargetCount: 1,
    actionName: action,
    actionControlType: "ControlType.Pane",
    actionAutomationId: "1",
    actionAutomationIdParsed: 1,
    actionMethod: WINDOWS_ACCESSIBLE_ACTION.method,
    invokePatternAvailable: false,
    legacyPatternAvailable: false,
    actionNativeControlHwnd: 67890,
    actionNativeControlBound: true,
    actionDialogReverified: true,
    actionTargetReverified: true,
    actionNativeIsWindow: true,
    actionNativeIsChild: true,
    actionNativeControlIdConfirmed: true,
    actionControlId: WINDOWS_ACCESSIBLE_ACTION.controlId,
    actionMsaaObjectId: WINDOWS_ACCESSIBLE_ACTION.objectId,
    actionMsaaInterfaceId: WINDOWS_ACCESSIBLE_ACTION.interfaceId,
    actionMsaaChildId: WINDOWS_ACCESSIBLE_ACTION.childId,
    actionMsaaHResult: 0,
    actionMsaaInterfaceNonNull: true,
    actionMsaaWindowBindingHResult: 0,
    actionMsaaBoundHwnd: 67890,
    actionAccessibleName: action,
    actionAccessibleDefaultAction: "Press",
    actionAccessibleRole: WINDOWS_ACCESSIBLE_ACTION.role,
    actionAccessibleState: 0x00100000,
    actionAccessibleBlockedStateMask:
      WINDOWS_ACCESSIBLE_ACTION.blockedStateMask,
    actionAccessibleInvocationCount: 1,
    actionAccessibleInvocationCompleted: true,
    actionAccessibleInterfaceReleased: true,
    actionProcessTimeoutMs: WINDOWS_ACCESSIBLE_ACTION.processTimeoutMs,
    actionInvoked: true,
    dialogDismissed: true,
    actionCommand: {
      exitCode: 0,
      jsonParsed: true,
      stdout: "{}",
      stderr: "",
      result: {
        hwnd: 12345,
        dialogCountBefore: 1,
        dialogCountAfter: 0,
        actionCandidateCount: 1,
        exactActionTargetCount: 1,
        actionName: action,
        actionControlType: "ControlType.Pane",
        actionAutomationId: "1",
        actionAutomationIdParsed: 1,
        actionMethod: WINDOWS_ACCESSIBLE_ACTION.method,
        invokePatternAvailable: false,
        legacyPatternAvailable: false,
        actionNativeControlHwnd: 67890,
        actionNativeControlBound: true,
        actionDialogReverified: true,
        actionTargetReverified: true,
        actionNativeIsWindow: true,
        actionNativeIsChild: true,
        actionNativeControlIdConfirmed: true,
        actionControlId: WINDOWS_ACCESSIBLE_ACTION.controlId,
        actionMsaaObjectId: WINDOWS_ACCESSIBLE_ACTION.objectId,
        actionMsaaInterfaceId: WINDOWS_ACCESSIBLE_ACTION.interfaceId,
        actionMsaaChildId: WINDOWS_ACCESSIBLE_ACTION.childId,
        actionMsaaHResult: 0,
        actionMsaaInterfaceNonNull: true,
        actionMsaaWindowBindingHResult: 0,
        actionMsaaBoundHwnd: 67890,
        actionAccessibleName: action,
        actionAccessibleDefaultAction: "Press",
        actionAccessibleRole: WINDOWS_ACCESSIBLE_ACTION.role,
        actionAccessibleState: 0x00100000,
        actionAccessibleBlockedStateMask:
          WINDOWS_ACCESSIBLE_ACTION.blockedStateMask,
        actionAccessibleInvocationCount: 1,
        actionAccessibleInvocationCompleted: true,
        actionAccessibleInterfaceReleased: true,
        actionProcessTimeoutMs: WINDOWS_ACCESSIBLE_ACTION.processTimeoutMs,
        inputInjectionUsed: false,
        actionInvoked: true,
        dialogDismissed: true,
      },
    },
  };
}

function pickerPreflightEvidence() {
  const markerPath =
    "<DIALOG_TEMP>\\voyalier-picker-preflight-0123456789abcdef01234567.txt";
  return {
    verdict: "PASS",
    stage: "complete",
    proofKind: "harness-native-dialog-action",
    productEvidence: false,
    diagnosticOnly: false,
    candidateSha: CANDIDATE_SHA,
    workflowRunId: WORKFLOW_RUN_ID,
    dialog: nativeDialogEvidence({
      title: "Voyalier picker bridge preflight 0123456789abcdef01234567",
      action: "Save",
      expectedValueToken: markerPath,
      presetMethod:
        "System.Windows.Forms.SaveFileDialog.InitialDirectory+FileName",
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
      result: {
        result: "OK",
        expectedCanonicalSha256: "a".repeat(64),
        selectedCanonicalSha256: "a".repeat(64),
        canonicalOrdinalIgnoreCaseEqual: true,
        expectedWithinTemporaryRoot: true,
        selectedWithinTemporaryRoot: true,
        writeAttempted: true,
        markerExists: true,
      },
    },
    temporaryRootRemoved: true,
  };
}

test("requires the semantic filename host only for Save dialogs", () => {
  assert.deepEqual(nativeDialogHostPolicy("Save"), {
    required: true,
    minimum: 1,
    maximum: 1,
  });
  assert.deepEqual(nativeDialogHostPolicy("Open"), {
    required: false,
    minimum: 0,
    maximum: 1,
  });
  assert.throws(() => nativeDialogHostPolicy("Cancel"), /unsupported action/);
});

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
  const restoreStage = source.indexOf('report.stage = "portable-restore"');
  const restoreUi = source.indexOf(
    'await clickText(driver, "Restaurar desde copia"',
    restoreStage,
  );
  const restorePicker = source.indexOf(
    "const portableRestoreDialog = await driveNativeFileDialog",
    restoreUi,
  );
  assert.ok(
    restoreStage !== -1 &&
      restoreUi !== -1 &&
      restorePicker !== -1 &&
      restoreStage < restoreUi &&
      restoreUi < restorePicker,
    "the restore diagnostic stage must precede the restore UI and picker",
  );
  assert.match(source, /VOYALIER_WINDOWS_ACCEPTANCE_BACKUP_PATH/);
  assert.match(source, /IFileDialog\.SetFolder\+SetFileName via rfd 0\.16\.0/);
  assert.match(source, /`Copia guardada en \$\{portableBackupPath\}`/);
  assert.match(source, /process\.stderr\.write\(`\$\{message\}\\n`\)/);
  assert.match(source, /\.replace\(\/\\s\+\/g, " "\)\s*\.trim\(\)/);
  const screenshotHelper = source.slice(
    source.indexOf("async function screenshot"),
    source.indexOf("function installedProcesses"),
  );
  assert.match(screenshotHelper, /remainingAbsolutePathMatches/);
  assert.match(screenshotHelper, /querySelectorAll/);
  assert.match(
    screenshotHelper,
    /\.voy-sr-only\[role="status"\]\[aria-live="polite"\]/,
  );
  assert.match(screenshotHelper, /expectedRedactedStatusCount/);
  assert.match(screenshotHelper, /redaction\?\.redactedStatusCount/);
  assert.match(
    source,
    /"04-portable-backup-exported\.png",\s*\{\s*expectedRedactedStatusCount: 1/,
  );
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
    "pathPresetExpected",
    "externalSetterUsed",
    "presetMethod",
    "expectedPathWithinTemp",
    "nativeDialogActionConfirmed",
    "InvokePattern",
    "LegacyIAccessiblePattern",
    "ControlType.Pane",
    "MSAA/IAccessible.accDoDefaultAction",
    "AccessibleObjectFromWindow",
    "WindowFromAccessibleObject",
    "accDoDefaultAction",
    "GetDlgCtrlID",
    "IsChild",
    "dialogDismissed",
  ]) {
    assert.match(nativeDialogSource, new RegExp(requiredNativeProof));
  }
  assert.doesNotMatch(
    nativeDialogSource,
    /send-keys|sendkeys|WScript\.Shell|Set-Clipboard|Clipboard|SetFocus\(|SetActiveWindow|SendInput|PostMessage|SendMessage|BM_CLICK|WM_COMMAND/i,
  );
  assert.doesNotMatch(
    nativeDialogSource,
    /AutomationIdProperty, ['"](?:1148|1001)['"]/,
  );
  assert.match(nativeDialogSource, /\$ErrorActionPreference = 'Stop'/);
  assert.equal(
    nativeDialogSource.match(/accessible\.accDoDefaultAction\(self\)/g)?.length,
    1,
    "the direct accessibility fallback must invoke the default action exactly once",
  );
  const nativeDialogDriver = nativeDialogSource.slice(
    nativeDialogSource.indexOf("export async function driveNativeFileDialog"),
    nativeDialogSource.indexOf("export function pathIsInside"),
  );
  assert.doesNotMatch(
    nativeDialogDriver,
    /set-value|get-value|loadVerifiedWinAppTool|WINAPP_CLI|selectedPathWithinTemp|nativeDialogPathConfirmed/,
  );
  assert.doesNotMatch(nativeDialogDriver, /throw error;/);
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
  const legacyPatternProbe = actionBridge.indexOf(
    "[System.Windows.Automation.LegacyIAccessiblePattern]::Pattern",
  );
  const accessibleAction = actionBridge.indexOf(
    "$msaaResult = [VoyalierNativeAccessibleAction]::Invoke(",
  );
  const canonicalIdGuard = actionBridge.indexOf(
    "patternless exact action does not expose canonical IDOK AutomationId",
  );
  const childHwndGuard = actionBridge.indexOf(
    "patternless exact action native HWND is not a child of the dialog",
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
  assert.ok(
    invokePatternProbe < legacyPatternProbe &&
      legacyPatternProbe < canonicalIdGuard &&
      canonicalIdGuard < childHwndGuard &&
      childHwndGuard < accessibleAction,
    "direct IAccessible must remain the final, identity-guarded action method",
  );

  const desktopSource = await readFile(
    new URL("../apps/desktop/src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  for (const requiredPresetGuard of [
    "VOYALIER_WINDOWS_ACCEPTANCE_BACKUP_PATH",
    "windows_automation_config(",
    "FILE_ATTRIBUTE_REPARSE_POINT",
    "WINDOWS_ACCEPTANCE_BACKUP_FILE_NAME",
    ".set_directory(&preset.directory)",
    ".set_file_name(&preset.file_name)",
    ".set_file_name(default_backup_file_name())",
    "WindowsStartupAutomation::from_environment()",
    ".create_new(true)",
  ]) {
    assert.ok(desktopSource.includes(requiredPresetGuard));
  }
  for (const environmentRead of [
    /std::env::var\("TAURI_WEBVIEW_AUTOMATION"\)/g,
    /std::env::var\("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"\)/g,
    /std::env::var\("VOYALIER_WINDOWS_WEBDRIVER_PROFILE"\)/g,
    /std::env::var_os\("RUNNER_TEMP"\)/g,
    /std::env::var_os\("VOYALIER_WINDOWS_ACCEPTANCE_BACKUP_PATH"\)/g,
  ]) {
    assert.equal(
      desktopSource.match(environmentRead)?.length,
      1,
      "each acceptance input must be read exactly once at process setup",
    );
  }
  for (const [, markerFileName] of WINDOWS_PICKER_PHASE_MARKERS) {
    assert.ok(
      desktopSource.includes(markerFileName),
      `desktop phase marker is missing: ${markerFileName}`,
    );
  }
  assert.match(
    desktopSource,
    /async fn export_backup/,
    "the blocking Save picker must run from an asynchronous Tauri command",
  );
  assert.match(
    desktopSource,
    /async fn stage_restore/,
    "the blocking Open picker must run from an asynchronous Tauri command",
  );
  const exportSource = desktopSource.slice(
    desktopSource.indexOf("fn export_backup"),
    desktopSource.indexOf("fn stage_restore"),
  );
  const restoreSource = desktopSource.slice(
    desktopSource.indexOf("fn stage_restore"),
    desktopSource.indexOf("fn has_pending_restore"),
  );
  assert.ok(
    exportSource.indexOf("validate_chosen_path") !== -1 &&
      exportSource.indexOf("validate_chosen_path") <
        exportSource.indexOf("write_new_backup_file"),
    "the returned save target must be validated before any write",
  );
  assert.ok(
    exportSource.indexOf("ExportBeforeDialog") <
      exportSource.indexOf("blocking_save_file") &&
      exportSource.indexOf("blocking_save_file") <
        exportSource.indexOf("ExportDialogReturnedNone") &&
      exportSource.indexOf("blocking_save_file") <
        exportSource.indexOf("ExportDialogReturnedSome"),
    "export diagnostics must bracket the native dialog call",
  );
  assert.ok(
    exportSource.indexOf("write_new_backup_file") <
      exportSource.indexOf("std::fs::write"),
    "the active acceptance preset must use atomic create while ordinary launches keep their existing write",
  );
  assert.ok(
    restoreSource.indexOf("validate_chosen_path") !== -1 &&
      restoreSource.indexOf("validate_chosen_path") <
        restoreSource.indexOf("std::fs::read"),
    "the returned restore target must be validated before any read",
  );
  assert.ok(
    restoreSource.indexOf("RestoreBeforeDialog") <
      restoreSource.indexOf("blocking_pick_file") &&
      restoreSource.indexOf("blocking_pick_file") <
        restoreSource.indexOf("RestoreDialogReturnedNone") &&
      restoreSource.indexOf("blocking_pick_file") <
        restoreSource.indexOf("RestoreDialogReturnedSome"),
    "restore diagnostics must bracket the native dialog call",
  );

  const preflightSource = await readFile(
    new URL("./windows-picker-preflight.mjs", import.meta.url),
    "utf8",
  );
  assert.match(preflightSource, /System\.Windows\.Forms\.SaveFileDialog/);
  assert.match(preflightSource, /canonicalOrdinalIgnoreCaseEqual/);
  assert.match(preflightSource, /\$ErrorActionPreference = 'Stop'/);
  assert.match(preflightSource, /DirectorySeparatorChar/);
  assert.match(preflightSource, /AltDirectorySeparatorChar/);
  assert.match(preflightSource, /diagnosticOnly: false/);
  assert.match(preflightSource, /productEvidence: false/);
  assert.match(preflightSource, /process\.stderr\.write\(`\$\{message\}\\n`\)/);
  assert.match(preflightSource, /\.replace\(\/\\s\+\/g, " "\)\s*\.trim\(\)/);

  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    workflow,
    /winappcli|Windows App CLI|windows_picker_diagnostic/i,
  );
  assert.match(workflow, /inputs\.windows_acceptance/);
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

test("rejects incomplete native picker preflight proof", () => {
  const preflight = pickerPreflightEvidence();
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
          stderr: "nonterminating discovery error",
        },
      },
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
        externalSetterUsed: true,
      },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, nativeDialogPathConfirmed: true },
    },
    {
      ...preflight,
      dialog: { ...preflight.dialog, selectedPathWithinTemp: true },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        setValue: { exitCode: 0 },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        presetMethod: "rfd::FileDialog::set_directory+set_file_name",
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
          stderr: "nonterminating action error",
        },
      },
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
        actionMethod: "Keyboard",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMethod: "Keyboard",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAutomationId: "01",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAutomationId: "01",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        invokePatternAvailable: true,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            invokePatternAvailable: true,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaObjectId: 0,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaObjectId: 0,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionNativeIsChild: false,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionNativeIsChild: false,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaBoundHwnd: 0,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaBoundHwnd: 0,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaInterfaceNonNull: false,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaInterfaceNonNull: false,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionProcessTimeoutMs: 0,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionProcessTimeoutMs: 0,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaInterfaceId: "wrong-interface",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaInterfaceId: "wrong-interface",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaChildId: 1,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaChildId: 1,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaHResult: -1,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaHResult: -1,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionMsaaWindowBindingHResult: -1,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionMsaaWindowBindingHResult: -1,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleName: "save",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleName: "save",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleDefaultAction: " ",
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleDefaultAction: " ",
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleRole: 0,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleRole: 0,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleState: 1,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleState: 1,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleInvocationCount: 0,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleInvocationCount: 0,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleInvocationCompleted: false,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleInvocationCompleted: false,
          },
        },
      },
    },
    {
      ...preflight,
      dialog: {
        ...preflight.dialog,
        actionAccessibleInterfaceReleased: false,
        actionCommand: {
          ...preflight.dialog.actionCommand,
          result: {
            ...preflight.dialog.actionCommand.result,
            actionAccessibleInterfaceReleased: false,
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
        elementId: FILE_NAME_HOST_AUTOMATION_ID,
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

test("accepts only ordered allowlisted Windows picker phase traces", () => {
  const diagnosticPrefix = COMPLETE_PICKER_PHASE_TRACE.slice(0, 4);
  assert.equal(
    validateWindowsPickerPhaseTrace(diagnosticPrefix),
    diagnosticPrefix,
  );
  assert.equal(
    validateWindowsPickerPhaseTrace(COMPLETE_PICKER_PHASE_TRACE, {
      requireComplete: true,
    }),
    COMPLETE_PICKER_PHASE_TRACE,
  );
  assert.deepEqual(
    validateWindowsPickerPhaseTrace([
      ...diagnosticPrefix,
      "export:dialog-returned-none",
    ]),
    [...diagnosticPrefix, "export:dialog-returned-none"],
  );
  assert.throws(
    () =>
      validateWindowsPickerPhaseTrace([
        "export:command-entered",
        "export:command-entered",
      ]),
    /duplicate phase/,
  );
  assert.throws(
    () =>
      validateWindowsPickerPhaseTrace([
        "export:command-entered",
        "export:before-dialog",
      ]),
    /unknown or out of order/,
  );
  assert.throws(
    () => validateWindowsPickerPhaseTrace(["export:unknown"]),
    /unknown or out of order/,
  );
  assert.throws(
    () =>
      validateWindowsPickerPhaseTrace(diagnosticPrefix, {
        requireComplete: true,
      }),
    /incomplete/,
  );
});

test("pins installed, data-preservation, backup, and loopback evidence", () => {
  const pickerPreflight = pickerPreflightEvidence();
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
    pickerPreflight,
    pickerPhases: COMPLETE_PICKER_PHASE_TRACE,
    pickerPreset: {
      method: "IFileDialog.SetFolder+SetFileName via rfd 0.16.0",
      ordinaryLaunchUnchangedWhenInactive: true,
      completeAutomationGateRequired: true,
      targetEnvironmentReadOnce: true,
      dedicatedTargetProvided: true,
      canonicalRunnerRootConfirmed: true,
      canonicalParentConfirmed: true,
      parentIsReparsePoint: false,
      strictTemporaryRootContainment: true,
      exactFileName: "voyalier-portable-acceptance.vbk",
      exactExtension: ".vbk",
      targetToken: PORTABLE_PATH,
      targetSha256: "a".repeat(64),
      externalSetterUsed: false,
      targetAbsentBeforeSave: true,
    },
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
      returnedPathNoticeEqualsPreset: true,
      createdNewFile: true,
      screenshotPathRedacted: true,
      screenshotEvidence: {
        fileName: "04-portable-backup-exported.png",
        pathRedactionConfirmed: true,
        redactedStatusCount: 1,
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
      candidateReturnedPathGuardPassed: true,
      guardedTargetMatchesExport: true,
      preReadSha256: "b".repeat(64),
      preReadSha256MatchesExport: true,
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
  const withDialogEvidence = (field, evidence) => {
    const candidate = structuredClone(report);
    Object.assign(candidate[field], evidence);
    Object.assign(candidate[field].discoveryCommand.result, evidence);
    return candidate;
  };
  const openWithFilenameHost = withDialogEvidence("portableRestore", {
    hostCount: 1,
    hostAutomationId: FILE_NAME_HOST_AUTOMATION_ID,
    hostEnabled: true,
    hostOffscreen: false,
  });
  assert.equal(
    validateWindowsAcceptanceReport(openWithFilenameHost),
    openWithFilenameHost,
  );
  const rejectedDialogEvidence = [
    withDialogEvidence("portableRestore", {
      hostCount: 1,
      hostAutomationId: "WrongFileNameHost",
      hostEnabled: true,
      hostOffscreen: false,
    }),
    withDialogEvidence("portableRestore", {
      hostCount: 1,
      hostAutomationId: FILE_NAME_HOST_AUTOMATION_ID,
      hostEnabled: false,
      hostOffscreen: false,
    }),
    withDialogEvidence("portableRestore", {
      hostCount: 1,
      hostAutomationId: FILE_NAME_HOST_AUTOMATION_ID,
      hostEnabled: true,
      hostOffscreen: true,
    }),
    withDialogEvidence("portableRestore", {
      filenameHostRequired: true,
    }),
    withDialogEvidence("portableRestore", {
      hostCount: 2,
    }),
  ];
  for (const rejected of rejectedDialogEvidence) {
    assert.throws(
      () => validateWindowsAcceptanceReport(rejected),
      /portable restore and reinstall evidence is incomplete/,
    );
  }
  const saveWithoutFilenameHost = withDialogEvidence("portableBackup", {
    hostCount: 0,
    hostAutomationId: null,
    hostEnabled: null,
    hostOffscreen: null,
  });
  const rejectedSaveDialogEvidence = [
    saveWithoutFilenameHost,
    withDialogEvidence("portableBackup", {
      hostEnabled: false,
    }),
    withDialogEvidence("portableBackup", {
      hostOffscreen: true,
    }),
    withDialogEvidence("portableBackup", {
      hostAutomationId: "WrongFileNameHost",
    }),
    withDialogEvidence("portableBackup", {
      hostCount: 2,
    }),
    withDialogEvidence("portableBackup", {
      filenameHostRequired: false,
    }),
  ];
  for (const rejected of rejectedSaveDialogEvidence) {
    assert.throws(
      () => validateWindowsAcceptanceReport(rejected),
      /portable backup UI evidence is incomplete/,
    );
  }
  assert.equal(
    validateWindowsPickerPreflightReport(pickerPreflight, {
      candidateSha: CANDIDATE_SHA,
      workflowRunId: WORKFLOW_RUN_ID,
    }),
    pickerPreflight,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceReport({
        ...report,
        pickerPhases: COMPLETE_PICKER_PHASE_TRACE.slice(0, -1),
      }),
    /phase trace is incomplete/,
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
          nativeDialogActionConfirmed: false,
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
            redactedStatusCount: 0,
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
          expectedPathWithinTemp: false,
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
          returnedPathNoticeEqualsPreset: false,
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
          selectedSameTargetAsExport: true,
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
          nativeDialogActionConfirmed: false,
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
