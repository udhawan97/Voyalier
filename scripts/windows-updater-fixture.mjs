import { readFileSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  assertNoAbsoluteWindowsPaths,
  FILE_NAME_HOST_AUTOMATION_ID,
  nativeDialogHostPolicy,
  WINDOWS_ACCESSIBLE_ACTION,
} from "./windows-native-file-dialog.mjs";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

const configuredCandidateVersion = JSON.parse(
  readFileSync(
    new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
).version;
if (!SEMVER.test(configuredCandidateVersion)) {
  throw new Error("the configured desktop version must be SemVer");
}

/**
 * The acceptance target is the version in the candidate's Tauri configuration.
 * Keeping this derived prevents a release-only harness pin from silently
 * lagging the synchronized product-version files.
 */
export const WINDOWS_ACCEPTANCE_CANDIDATE_VERSION = configuredCandidateVersion;

export const WINDOWS_PICKER_PHASE_MARKERS = Object.freeze([
  ["export:command-entered", "voyalier-picker-phase-export-01-command-entered"],
  ["export:container-ready", "voyalier-picker-phase-export-02-container-ready"],
  ["export:preset-valid", "voyalier-picker-phase-export-03-preset-valid"],
  ["export:before-dialog", "voyalier-picker-phase-export-04-before-dialog"],
  [
    "export:dialog-returned-none",
    "voyalier-picker-phase-export-05-dialog-returned-none",
  ],
  [
    "export:dialog-returned-some",
    "voyalier-picker-phase-export-06-dialog-returned-some",
  ],
  [
    "export:returned-path-valid",
    "voyalier-picker-phase-export-07-returned-path-valid",
  ],
  ["export:write-complete", "voyalier-picker-phase-export-08-write-complete"],
  [
    "restore:command-entered",
    "voyalier-picker-phase-restore-01-command-entered",
  ],
  ["restore:preset-valid", "voyalier-picker-phase-restore-02-preset-valid"],
  ["restore:before-dialog", "voyalier-picker-phase-restore-03-before-dialog"],
  [
    "restore:dialog-returned-none",
    "voyalier-picker-phase-restore-04-dialog-returned-none",
  ],
  [
    "restore:dialog-returned-some",
    "voyalier-picker-phase-restore-05-dialog-returned-some",
  ],
  [
    "restore:returned-path-valid",
    "voyalier-picker-phase-restore-06-returned-path-valid",
  ],
  ["restore:backup-read", "voyalier-picker-phase-restore-07-backup-read"],
  ["restore:inspected", "voyalier-picker-phase-restore-08-inspected"],
]);

const PICKER_PHASE_TRANSITIONS = new Map([
  [null, ["export:command-entered"]],
  ["export:command-entered", ["export:container-ready"]],
  ["export:container-ready", ["export:preset-valid"]],
  ["export:preset-valid", ["export:before-dialog"]],
  [
    "export:before-dialog",
    ["export:dialog-returned-none", "export:dialog-returned-some"],
  ],
  ["export:dialog-returned-none", []],
  ["export:dialog-returned-some", ["export:returned-path-valid"]],
  ["export:returned-path-valid", ["export:write-complete"]],
  ["export:write-complete", ["restore:command-entered"]],
  ["restore:command-entered", ["restore:preset-valid"]],
  ["restore:preset-valid", ["restore:before-dialog"]],
  [
    "restore:before-dialog",
    ["restore:dialog-returned-none", "restore:dialog-returned-some"],
  ],
  ["restore:dialog-returned-none", []],
  ["restore:dialog-returned-some", ["restore:returned-path-valid"]],
  ["restore:returned-path-valid", ["restore:backup-read"]],
  ["restore:backup-read", ["restore:inspected"]],
  ["restore:inspected", []],
]);

export function validateWindowsPickerPhaseTrace(
  phases,
  { requireComplete = false } = {},
) {
  if (
    !Array.isArray(phases) ||
    phases.some((phase) => typeof phase !== "string")
  ) {
    throw new Error("Windows picker phase trace must be a string array");
  }
  if (new Set(phases).size !== phases.length) {
    throw new Error("Windows picker phase trace contains a duplicate phase");
  }
  let previous = null;
  for (const phase of phases) {
    if (!PICKER_PHASE_TRANSITIONS.get(previous)?.includes(phase)) {
      throw new Error("Windows picker phase trace is unknown or out of order");
    }
    previous = phase;
  }
  if (requireComplete && previous !== "restore:inspected") {
    throw new Error("Windows picker phase trace is incomplete");
  }
  return phases;
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function requireLoopbackOrigin(origin) {
  const parsed = new URL(requireString(origin, "origin"));
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") {
    throw new Error("origin must be an http://127.0.0.1 loopback URL");
  }
  if (!parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      "origin must contain only a loopback host and explicit port",
    );
  }
  return parsed.origin;
}

export function buildWindowsUpdaterManifest({
  version,
  installerName,
  signature,
  origin,
  publishedAt,
}) {
  version = requireString(version, "version");
  if (!SEMVER.test(version)) throw new Error("version must be SemVer");

  installerName = requireString(installerName, "installerName");
  if (
    path.win32.basename(installerName) !== installerName ||
    path.posix.basename(installerName) !== installerName ||
    !installerName.toLowerCase().endsWith("-setup.exe")
  ) {
    throw new Error("installerName must be a bare NSIS -setup.exe filename");
  }

  signature = requireString(signature, "signature");
  if (signature.length > 16_384)
    throw new Error("signature is unexpectedly large");
  const safeOrigin = requireLoopbackOrigin(origin);
  const pubDate = new Date(publishedAt ?? Date.now());
  if (Number.isNaN(pubDate.valueOf()))
    throw new Error("publishedAt must be a date");

  const updater = {
    signature,
    url: `${safeOrigin}/${encodeURIComponent(installerName)}`,
  };
  return {
    version,
    notes: "Ephemeral Windows installed-updater acceptance fixture.",
    pub_date: pubDate.toISOString(),
    platforms: {
      // The explicit NSIS target is the release-contract key. The plain alias
      // matches tauri-action's compatibility output and older v2 target lookup.
      "windows-x86_64": updater,
      "windows-x86_64-nsis": updater,
    },
  };
}

export function allowedUpdaterPath(requestUrl, installerName) {
  installerName = requireString(installerName, "installerName");
  const url = new URL(requestUrl, "http://127.0.0.1");
  return (
    url.search === "" &&
    (url.pathname === "/latest.json" ||
      url.pathname === `/${encodeURIComponent(installerName)}`)
  );
}

export function buildWindowsDriverCapabilities({
  application,
  userDataFolder,
}) {
  application = requireString(application, "application");
  userDataFolder = requireString(userDataFolder, "userDataFolder");
  if (!path.win32.isAbsolute(application)) {
    throw new Error("application must be an absolute Windows path");
  }
  if (!path.win32.isAbsolute(userDataFolder)) {
    throw new Error("userDataFolder must be an absolute Windows path");
  }

  return {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": {
          application,
          args: [],
          webviewOptions: { userDataFolder },
        },
      },
    },
  };
}

export async function clearWebViewDevToolsPorts(userDataFolder) {
  userDataFolder = requireString(userDataFolder, "userDataFolder");
  if (!path.isAbsolute(userDataFolder)) {
    throw new Error("userDataFolder must be absolute");
  }
  await Promise.all(
    [
      path.join(userDataFolder, "DevToolsActivePort"),
      path.join(userDataFolder, "EBWebView", "DevToolsActivePort"),
    ].map((file) => rm(file, { force: true })),
  );
}

export async function mirrorWebViewDevToolsPort({
  userDataFolder,
  signal,
  pollInterval = 100,
}) {
  userDataFolder = requireString(userDataFolder, "userDataFolder");
  if (!path.isAbsolute(userDataFolder)) {
    throw new Error("userDataFolder must be absolute");
  }
  const nested = path.join(userDataFolder, "EBWebView", "DevToolsActivePort");
  const destination = path.join(userDataFolder, "DevToolsActivePort");
  let lastErrorCode = null;

  while (!signal?.aborted) {
    try {
      await copyFile(nested, destination);
      return {
        nestedPortObserved: true,
        rootPortMirrored: true,
        copyErrorCode: null,
      };
    } catch (error) {
      lastErrorCode = error?.code ?? "UNKNOWN";
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return {
    nestedPortObserved: false,
    rootPortMirrored: false,
    copyErrorCode: lastErrorCode,
  };
}

function hasNativeDialogEvidence(dialog) {
  let hostPolicy;
  try {
    hostPolicy = nativeDialogHostPolicy(dialog?.action);
  } catch {
    return false;
  }
  const commandResult = dialog?.actionCommand?.result;
  const hostEvidenceValid =
    dialog?.filenameHostRequired === hostPolicy.required &&
    Number.isInteger(dialog?.hostCount) &&
    dialog.hostCount >= hostPolicy.minimum &&
    dialog.hostCount <= hostPolicy.maximum &&
    (dialog.hostCount === 0
      ? dialog?.hostAutomationId == null &&
        dialog?.hostEnabled == null &&
        dialog?.hostOffscreen == null
      : dialog?.hostAutomationId === FILE_NAME_HOST_AUTOMATION_ID &&
        dialog?.hostEnabled === true &&
        dialog?.hostOffscreen === false);
  const discoveryHostEvidenceValid =
    dialog?.discoveryCommand?.result?.filenameHostRequired ===
      hostPolicy.required &&
    dialog?.discoveryCommand?.result?.hostCount === dialog?.hostCount &&
    dialog?.discoveryCommand?.result?.hostAutomationId ===
      dialog?.hostAutomationId &&
    dialog?.discoveryCommand?.result?.hostEnabled === dialog?.hostEnabled &&
    dialog?.discoveryCommand?.result?.hostOffscreen === dialog?.hostOffscreen;
  const patternMethodValid =
    (dialog?.actionMethod === "InvokePattern" &&
      dialog?.invokePatternAvailable === true &&
      dialog?.legacyPatternAvailable === false &&
      dialog?.actionNativeControlBound === false &&
      dialog?.actionAccessibleInvocationCount === 0 &&
      dialog?.actionMsaaObjectId == null) ||
    (dialog?.actionMethod === "LegacyIAccessiblePattern" &&
      dialog?.invokePatternAvailable === false &&
      dialog?.legacyPatternAvailable === true &&
      dialog?.actionNativeControlBound === false &&
      dialog?.actionAccessibleInvocationCount === 0 &&
      dialog?.actionMsaaObjectId == null);
  const accessibleMethodValid =
    dialog?.actionMethod === WINDOWS_ACCESSIBLE_ACTION.method &&
    dialog?.invokePatternAvailable === false &&
    dialog?.legacyPatternAvailable === false &&
    dialog?.actionAutomationId ===
      String(WINDOWS_ACCESSIBLE_ACTION.controlId) &&
    dialog?.actionAutomationIdParsed === WINDOWS_ACCESSIBLE_ACTION.controlId &&
    Number.isInteger(dialog?.actionNativeControlHwnd) &&
    dialog.actionNativeControlHwnd > 0 &&
    dialog?.actionNativeControlBound === true &&
    dialog?.actionDialogReverified === true &&
    dialog?.actionTargetReverified === true &&
    dialog?.actionNativeIsWindow === true &&
    dialog?.actionNativeIsChild === true &&
    dialog?.actionNativeControlIdConfirmed === true &&
    dialog?.actionControlId === WINDOWS_ACCESSIBLE_ACTION.controlId &&
    dialog?.actionMsaaObjectId === WINDOWS_ACCESSIBLE_ACTION.objectId &&
    dialog?.actionMsaaInterfaceId === WINDOWS_ACCESSIBLE_ACTION.interfaceId &&
    dialog?.actionMsaaChildId === WINDOWS_ACCESSIBLE_ACTION.childId &&
    dialog?.actionMsaaHResult === 0 &&
    dialog?.actionMsaaInterfaceNonNull === true &&
    dialog?.actionMsaaWindowBindingHResult === 0 &&
    dialog?.actionMsaaBoundHwnd === dialog?.actionNativeControlHwnd &&
    dialog?.actionAccessibleName === dialog?.actionName &&
    typeof dialog?.actionAccessibleDefaultAction === "string" &&
    dialog.actionAccessibleDefaultAction.trim() !== "" &&
    dialog?.actionAccessibleRole === WINDOWS_ACCESSIBLE_ACTION.role &&
    Number.isInteger(dialog?.actionAccessibleState) &&
    (dialog.actionAccessibleState &
      WINDOWS_ACCESSIBLE_ACTION.blockedStateMask) ===
      0 &&
    dialog?.actionAccessibleBlockedStateMask ===
      WINDOWS_ACCESSIBLE_ACTION.blockedStateMask &&
    dialog?.actionAccessibleInvocationCount === 1 &&
    dialog?.actionAccessibleInvocationCompleted === true &&
    dialog?.actionAccessibleInterfaceReleased === true &&
    dialog?.actionProcessTimeoutMs ===
      WINDOWS_ACCESSIBLE_ACTION.processTimeoutMs;
  return (
    dialog?.verdict === "PASS" &&
    dialog?.nativeDialogActionConfirmed === true &&
    dialog?.expectedPathWithinTemp === true &&
    dialog?.filenameHostAutomationId === FILE_NAME_HOST_AUTOMATION_ID &&
    dialog?.pathPresetExpected === true &&
    dialog?.externalSetterUsed === false &&
    dialog?.setValue == null &&
    dialog?.getValue == null &&
    dialog?.nativeDialogPathConfirmed == null &&
    dialog?.selectedPathWithinTemp == null &&
    SHA256.test(dialog?.expectedPathSha256 ?? "") &&
    [
      "System.Windows.Forms.SaveFileDialog.InitialDirectory+FileName",
      "rfd::FileDialog::set_directory+set_file_name",
    ].includes(dialog?.presetMethod) &&
    dialog?.dialogTitle === dialog?.title &&
    dialog?.dialogCount === 1 &&
    dialog?.dialogEnabled === true &&
    dialog?.dialogOffscreen === false &&
    Number.isInteger(dialog?.dialogHwnd) &&
    dialog.dialogHwnd > 0 &&
    hostEvidenceValid &&
    dialog?.discoveryCommand?.exitCode === 0 &&
    dialog?.discoveryCommand?.jsonParsed === true &&
    dialog?.discoveryCommand?.stderr === "" &&
    dialog?.discoveryCommand?.result?.title === dialog?.title &&
    dialog?.discoveryCommand?.result?.dialogCount === dialog?.dialogCount &&
    dialog?.discoveryCommand?.result?.dialogEnabled === dialog?.dialogEnabled &&
    dialog?.discoveryCommand?.result?.dialogOffscreen ===
      dialog?.dialogOffscreen &&
    dialog?.discoveryCommand?.result?.hwnd === dialog?.dialogHwnd &&
    discoveryHostEvidenceValid &&
    dialog?.inputInjectionUsed === false &&
    dialog?.dialogCountBefore === 1 &&
    dialog?.dialogCountAfter === 0 &&
    Number.isInteger(dialog?.actionCandidateCount) &&
    dialog.actionCandidateCount >= 1 &&
    dialog?.exactActionTargetCount === 1 &&
    dialog?.actionName === dialog?.action &&
    ["ControlType.Button", "ControlType.Pane"].includes(
      dialog?.actionControlType,
    ) &&
    typeof dialog?.actionAutomationId === "string" &&
    dialog.actionAutomationId !== "" &&
    (patternMethodValid || accessibleMethodValid) &&
    dialog?.actionInvoked === true &&
    dialog?.dialogDismissed === true &&
    dialog?.actionCommand?.exitCode === 0 &&
    dialog?.actionCommand?.jsonParsed === true &&
    dialog?.actionCommand?.stderr === "" &&
    dialog?.actionCommand?.result?.hwnd === dialog?.dialogHwnd &&
    dialog?.actionCommand?.result?.actionCandidateCount ===
      dialog?.actionCandidateCount &&
    dialog?.actionCommand?.result?.exactActionTargetCount ===
      dialog?.exactActionTargetCount &&
    dialog?.actionCommand?.result?.actionName === dialog?.actionName &&
    dialog?.actionCommand?.result?.actionControlType ===
      dialog?.actionControlType &&
    dialog?.actionCommand?.result?.actionAutomationId ===
      dialog?.actionAutomationId &&
    commandResult?.actionMethod === dialog?.actionMethod &&
    commandResult?.actionAutomationIdParsed ===
      dialog?.actionAutomationIdParsed &&
    commandResult?.invokePatternAvailable === dialog?.invokePatternAvailable &&
    commandResult?.legacyPatternAvailable === dialog?.legacyPatternAvailable &&
    commandResult?.actionNativeControlHwnd ===
      dialog?.actionNativeControlHwnd &&
    commandResult?.actionNativeControlBound ===
      dialog?.actionNativeControlBound &&
    commandResult?.actionDialogReverified === dialog?.actionDialogReverified &&
    commandResult?.actionTargetReverified === dialog?.actionTargetReverified &&
    commandResult?.actionNativeIsWindow === dialog?.actionNativeIsWindow &&
    commandResult?.actionNativeIsChild === dialog?.actionNativeIsChild &&
    commandResult?.actionNativeControlIdConfirmed ===
      dialog?.actionNativeControlIdConfirmed &&
    commandResult?.actionControlId === dialog?.actionControlId &&
    commandResult?.actionMsaaObjectId === dialog?.actionMsaaObjectId &&
    commandResult?.actionMsaaInterfaceId === dialog?.actionMsaaInterfaceId &&
    commandResult?.actionMsaaChildId === dialog?.actionMsaaChildId &&
    commandResult?.actionMsaaHResult === dialog?.actionMsaaHResult &&
    commandResult?.actionMsaaInterfaceNonNull ===
      dialog?.actionMsaaInterfaceNonNull &&
    commandResult?.actionMsaaWindowBindingHResult ===
      dialog?.actionMsaaWindowBindingHResult &&
    commandResult?.actionMsaaBoundHwnd === dialog?.actionMsaaBoundHwnd &&
    commandResult?.actionAccessibleName === dialog?.actionAccessibleName &&
    commandResult?.actionAccessibleDefaultAction ===
      dialog?.actionAccessibleDefaultAction &&
    commandResult?.actionAccessibleRole === dialog?.actionAccessibleRole &&
    commandResult?.actionAccessibleState === dialog?.actionAccessibleState &&
    commandResult?.actionAccessibleBlockedStateMask ===
      dialog?.actionAccessibleBlockedStateMask &&
    commandResult?.actionAccessibleInvocationCount ===
      dialog?.actionAccessibleInvocationCount &&
    commandResult?.actionAccessibleInvocationCompleted ===
      dialog?.actionAccessibleInvocationCompleted &&
    commandResult?.actionAccessibleInterfaceReleased ===
      dialog?.actionAccessibleInterfaceReleased &&
    commandResult?.actionProcessTimeoutMs === dialog?.actionProcessTimeoutMs &&
    commandResult?.dialogCountBefore === dialog?.dialogCountBefore &&
    commandResult?.dialogCountAfter === dialog?.dialogCountAfter &&
    commandResult?.inputInjectionUsed === dialog?.inputInjectionUsed &&
    dialog?.actionCommand?.result?.actionInvoked === dialog?.actionInvoked &&
    dialog?.actionCommand?.result?.dialogDismissed === dialog?.dialogDismissed
  );
}

export function validateWindowsPickerPreflightReport(
  report,
  { candidateSha, workflowRunId } = {},
) {
  if (
    report?.verdict !== "PASS" ||
    report?.stage !== "complete" ||
    report?.diagnosticOnly === true ||
    report?.proofKind !== "harness-native-dialog-action" ||
    report?.productEvidence !== false ||
    !/^[0-9a-f]{40}$/.test(report?.candidateSha ?? "") ||
    (candidateSha && report.candidateSha !== candidateSha) ||
    (workflowRunId && report?.workflowRunId !== workflowRunId) ||
    !/^Voyalier picker bridge preflight [0-9a-f]{24}$/.test(
      report?.dialog?.title ?? "",
    ) ||
    report?.dialog?.action !== "Save" ||
    report?.dialog?.presetMethod !==
      "System.Windows.Forms.SaveFileDialog.InitialDirectory+FileName" ||
    !hasNativeDialogEvidence(report?.dialog) ||
    report?.marker?.selectedPathToken !== report?.dialog?.expectedValueToken ||
    report?.marker?.selectedPathWithinTemporaryRoot !== true ||
    report?.marker?.hostReturnedExactPath !== true ||
    report?.marker?.contentConfirmed !== true ||
    report?.marker?.removed !== true ||
    !(report?.marker?.bytes > 0) ||
    !/^[0-9a-f]{64}$/.test(report?.marker?.sha256 ?? "") ||
    report?.marker?.sha256 !== report?.marker?.expectedSha256 ||
    report?.dialogHost?.exitCode !== 0 ||
    report?.dialogHost?.jsonParsed !== true ||
    report?.dialogHost?.stdoutOmitted !== true ||
    report?.dialogHost?.stderr !== "" ||
    !/^[0-9a-f]{64}$/.test(report?.dialogHost?.stdoutSha256 ?? "") ||
    report?.dialogHost?.result?.result !== "OK" ||
    report?.dialogHost?.result?.expectedCanonicalSha256 !==
      report?.dialogHost?.result?.selectedCanonicalSha256 ||
    report?.dialogHost?.result?.canonicalOrdinalIgnoreCaseEqual !== true ||
    report?.dialogHost?.result?.expectedWithinTemporaryRoot !== true ||
    report?.dialogHost?.result?.selectedWithinTemporaryRoot !== true ||
    report?.dialogHost?.result?.writeAttempted !== true ||
    report?.dialogHost?.result?.markerExists !== true ||
    report?.temporaryRootRemoved !== true
  ) {
    throw new Error("Windows picker preflight evidence is incomplete");
  }
  assertNoAbsoluteWindowsPaths(report);
  return report;
}

export function validateWindowsAcceptanceReport(report) {
  if (!report || report.verdict !== "PASS") {
    throw new Error("acceptance report must have a PASS verdict");
  }
  if (report.stage !== "complete") {
    throw new Error(
      "acceptance report did not complete every installed-app stage",
    );
  }
  if (report.base?.version !== "0.10.7") {
    throw new Error("acceptance base must be the public v0.10.7 release");
  }
  if (report.base?.sha !== "cfd4eef671fc3fb23430e6d4a92be28e0b0e3436") {
    throw new Error("acceptance base source must be the exact v0.10.7 commit");
  }
  if (!/^[0-9a-f]{64}$/.test(report.base?.automationPatch?.sha256 ?? "")) {
    throw new Error("acceptance base automation patch hash is missing");
  }
  if (
    JSON.stringify(report.base?.automationPatch?.changedFiles) !==
    JSON.stringify(["apps/desktop/src-tauri/src/lib.rs"])
  ) {
    throw new Error("acceptance base adaptation changed an unexpected file");
  }
  if (report.candidate?.version !== WINDOWS_ACCEPTANCE_CANDIDATE_VERSION) {
    throw new Error(
      `acceptance candidate must be v${WINDOWS_ACCEPTANCE_CANDIDATE_VERSION}`,
    );
  }
  validateWindowsPickerPreflightReport(report.pickerPreflight, {
    candidateSha: report.candidate?.sha,
    workflowRunId: report.workflow?.runId,
  });
  if (
    report.nativePickerTool != null ||
    report.pickerPreset?.method !==
      "IFileDialog.SetFolder+SetFileName via rfd 0.16.0" ||
    report.pickerPreset?.ordinaryLaunchUnchangedWhenInactive !== true ||
    report.pickerPreset?.completeAutomationGateRequired !== true ||
    report.pickerPreset?.targetEnvironmentReadOnce !== true ||
    report.pickerPreset?.dedicatedTargetProvided !== true ||
    report.pickerPreset?.canonicalRunnerRootConfirmed !== true ||
    report.pickerPreset?.canonicalParentConfirmed !== true ||
    report.pickerPreset?.parentIsReparsePoint !== false ||
    report.pickerPreset?.strictTemporaryRootContainment !== true ||
    report.pickerPreset?.exactFileName !== "voyalier-portable-acceptance.vbk" ||
    report.pickerPreset?.exactExtension !== ".vbk" ||
    report.pickerPreset?.targetToken !==
      "<DIALOG_TEMP>\\voyalier-portable-acceptance.vbk" ||
    !SHA256.test(report.pickerPreset?.targetSha256 ?? "") ||
    report.pickerPreset?.externalSetterUsed !== false ||
    report.pickerPreset?.targetAbsentBeforeSave !== true
  ) {
    throw new Error("the dormant Windows picker preset evidence is incomplete");
  }
  validateWindowsPickerPhaseTrace(report.pickerPhases, {
    requireComplete: true,
  });
  if (report.installed?.before !== "0.10.7") {
    throw new Error("installed base version was not observed");
  }
  if (report.installed?.after !== WINDOWS_ACCEPTANCE_CANDIDATE_VERSION) {
    throw new Error(
      "installed candidate version was not observed after the swap",
    );
  }
  if (report.installed?.recovery !== WINDOWS_ACCEPTANCE_CANDIDATE_VERSION) {
    throw new Error("reinstall recovery did not reopen the candidate");
  }
  if (!report.installed?.path?.startsWith("<LOCALAPPDATA>\\")) {
    throw new Error("installed application path was not safely tokenized");
  }
  const driverSessions = report.driver?.sessions?.map(({ session }) => session);
  if (
    JSON.stringify(driverSessions) !==
    JSON.stringify(["base", "updated", "recovery"])
  ) {
    throw new Error("all three packaged WebDriver sessions were not observed");
  }
  const driverProfiles = report.driver?.sessions?.map(({ profile }) => profile);
  const preservedProfiles = report.driver?.sessions?.map(
    ({ preservedExistingProfile }) => preservedExistingProfile,
  );
  if (
    report.driver?.sharedJourneyProfile !== true ||
    new Set(driverProfiles).size !== 1 ||
    !driverProfiles?.[0] ||
    JSON.stringify(preservedProfiles) !== JSON.stringify([false, true, true])
  ) {
    throw new Error(
      "the packaged sessions did not preserve one isolated WebView profile",
    );
  }
  if (
    report.driver.sessions.some(
      ({ stalePortFilesCleared }) => stalePortFilesCleared !== true,
    )
  ) {
    throw new Error(
      "a packaged session could have reused a stale WebView debug port",
    );
  }
  if (report.data?.tripCountBefore !== 1 || report.data?.tripCountAfter !== 1) {
    throw new Error("traveler-owned data did not survive the updater swap");
  }
  if (report.data?.tripCountAfterRecovery !== 1) {
    throw new Error("traveler-owned data did not survive reinstall recovery");
  }
  if (!(report.data?.backupCount >= 1)) {
    throw new Error("the pre-update backup was not observed");
  }
  const preservationStages = ["base", "updated", "recovery"].map(
    (stage) => report.preservation?.[stage],
  );
  if (
    preservationStages.some(
      (stage) =>
        !stage ||
        typeof stage.savedPlaceId !== "string" ||
        !stage.savedPlaceId ||
        typeof stage.packingItemId !== "string" ||
        !stage.packingItemId ||
        typeof stage.manualItemId !== "string" ||
        !stage.manualItemId ||
        typeof stage.savedPlaceName !== "string" ||
        !stage.savedPlaceName.trim() ||
        typeof stage.packingLabel !== "string" ||
        !stage.packingLabel.trim() ||
        typeof stage.manualItemTitle !== "string" ||
        !stage.manualItemTitle.trim() ||
        stage.packingChecked !== true ||
        stage.todayContainsManualItem !== true ||
        typeof stage.todayReferenceDate !== "string" ||
        stage.manualItemStartAt?.slice(0, 10) !== stage.todayReferenceDate,
    )
  ) {
    throw new Error("stage-specific traveler data evidence is incomplete");
  }
  for (const key of ["savedPlaceId", "packingItemId", "manualItemId"]) {
    if (new Set(preservationStages.map((stage) => stage[key])).size !== 1) {
      throw new Error(
        "traveler record identity changed across installed stages",
      );
    }
  }
  for (const key of [
    "savedPlaceName",
    "packingLabel",
    "manualItemTitle",
    "todayReferenceDate",
  ]) {
    if (new Set(preservationStages.map((stage) => stage[key])).size !== 1) {
      throw new Error("traveler record values changed across installed stages");
    }
  }
  const uiStages = ["base", "updated", "recovery"].map(
    (stage) => report.ui?.[stage],
  );
  if (
    uiStages.some(
      (stage) =>
        !stage ||
        stage.savedPlaceObserved !== true ||
        stage.packingCheckboxObserved !== true ||
        stage.packingCheckboxChecked !== true ||
        stage.todayObserved !== true,
    )
  ) {
    throw new Error("stage-specific installed UI evidence is incomplete");
  }
  if (
    report.journey?.tripCreatedViaUi !== true ||
    report.journey?.cityPackDownloadedViaUi !== true ||
    !Number.isInteger(report.journey?.cityPackPlaceCount) ||
    report.journey.cityPackPlaceCount <= 0 ||
    typeof report.journey?.savedPlaceName !== "string" ||
    report.journey.savedPlaceName.trim() === "" ||
    typeof report.journey?.packingLabel !== "string" ||
    report.journey.packingLabel.trim() === "" ||
    report.journey?.packingChecked !== true ||
    typeof report.journey?.manualItemTitle !== "string" ||
    report.journey.manualItemTitle.trim() === "" ||
    report.journey?.todayObserved !== true ||
    report.journey?.searchObserved !== true
  ) {
    throw new Error("the installed product UI journey is incomplete");
  }
  for (const locale of [
    report.journey?.localeBeforeUpdate,
    report.journey?.localeAfterUpdate,
    report.journey?.localeAfterRecovery,
  ]) {
    if (locale !== "es") {
      throw new Error(
        "the selected Spanish locale did not survive every stage",
      );
    }
  }
  if (
    report.updaterController?.triggeredViaUi !== true ||
    report.updaterController?.harnessBackupCommandUsed !== false ||
    !Number.isInteger(report.updaterController?.backupCountBefore) ||
    !Number.isInteger(report.updaterController?.backupCountAfter) ||
    report.updaterController.backupCountAfter !==
      report.updaterController.backupCountBefore + 1
  ) {
    throw new Error(
      "the production updater controller did not create exactly one backup",
    );
  }
  if (
    report.portableBackup?.exportedViaUi !== true ||
    !hasNativeDialogEvidence(report.portableBackup) ||
    report.portableBackup?.returnedPathEqualsPreset != null ||
    report.portableBackup?.title !== "Save Voyalier backup" ||
    report.portableBackup?.action !== "Save" ||
    report.portableBackup?.presetMethod !==
      "rfd::FileDialog::set_directory+set_file_name" ||
    report.portableBackup?.returnedPathNoticeEqualsPreset !== true ||
    report.portableBackup?.createdNewFile !== true ||
    report.portableBackup?.expectedPathSha256 !==
      report.pickerPreset?.targetSha256 ||
    report.portableBackup?.screenshotPathRedacted !== true ||
    report.portableBackup?.screenshotPathRedacted !==
      report.portableBackup?.screenshotEvidence?.pathRedactionConfirmed ||
    report.portableBackup?.screenshotEvidence?.fileName !==
      "04-portable-backup-exported.png" ||
    report.portableBackup?.screenshotEvidence?.pathRedactionConfirmed !==
      true ||
    report.portableBackup?.screenshotEvidence?.redactedStatusCount !== 1 ||
    report.portableBackup?.screenshotEvidence?.remainingAbsolutePathMatches !==
      0 ||
    report.portableBackup?.screenshotEvidence?.written !== true ||
    report.portableBackup?.fileName !== "voyalier-portable-acceptance.vbk" ||
    path.win32.basename(report.portableBackup?.expectedValueToken ?? "") !==
      report.portableBackup.fileName ||
    !(report.portableBackup?.bytes > 0) ||
    !/^[0-9a-f]{64}$/.test(report.portableBackup?.sha256 ?? "")
  ) {
    throw new Error("the portable backup UI evidence is incomplete");
  }
  if (
    report.portableRestore?.stagedViaUi !== true ||
    !hasNativeDialogEvidence(report.portableRestore) ||
    report.portableRestore?.returnedPathEqualsPreset != null ||
    report.portableRestore?.selectedSameTargetAsExport != null ||
    report.portableRestore?.title !== "Choose a Voyalier backup" ||
    report.portableRestore?.action !== "Open" ||
    report.portableRestore?.presetMethod !==
      "rfd::FileDialog::set_directory+set_file_name" ||
    report.portableRestore?.candidateReturnedPathGuardPassed !== true ||
    report.portableRestore?.guardedTargetMatchesExport !== true ||
    report.portableRestore?.expectedPathSha256 !==
      report.pickerPreset?.targetSha256 ||
    report.portableRestore?.expectedValueToken !==
      report.portableBackup?.expectedValueToken ||
    report.portableRestore?.preReadSha256 !== report.portableBackup?.sha256 ||
    report.portableRestore?.preReadSha256MatchesExport !== true ||
    report.portableRestore?.appliedAfterReinstall !== true ||
    report.portableRestore?.postBackupSentinelAbsent !== true
  ) {
    throw new Error(
      "the portable restore and reinstall evidence is incomplete",
    );
  }
  if (!report.network?.requests?.includes("/latest.json")) {
    throw new Error("the updater manifest was not requested");
  }
  if (
    !report.network?.requests?.some((request) => request.endsWith("-setup.exe"))
  ) {
    throw new Error("the NSIS updater artifact was not requested");
  }
  if (report.network?.nonLoopbackRequests !== 0) {
    throw new Error("the fixture server observed a non-loopback request");
  }
  if (
    !Array.isArray(report.network?.listeners) ||
    report.network.listeners.some((listener) => !listener.loopback)
  ) {
    throw new Error("the installed app exposed a non-loopback listener");
  }
  assertNoAbsoluteWindowsPaths(report);
  return report;
}
