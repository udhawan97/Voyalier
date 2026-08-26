import { copyFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  assertNoAbsoluteWindowsPaths,
  WINAPP_CLI,
} from "./windows-native-file-dialog.mjs";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

export function validateWinAppToolEvidence(tool) {
  if (
    tool?.name !== WINAPP_CLI.name ||
    tool?.tag !== WINAPP_CLI.tag ||
    tool?.versionExpected !== WINAPP_CLI.version ||
    tool?.versionReported !== WINAPP_CLI.version ||
    tool?.releaseCommit !== WINAPP_CLI.releaseCommit ||
    tool?.assetName !== WINAPP_CLI.assetName ||
    tool?.assetUrl !== WINAPP_CLI.assetUrl ||
    tool?.archiveSha256Expected !== WINAPP_CLI.archiveSha256 ||
    tool?.archiveSha256Actual !== WINAPP_CLI.archiveSha256 ||
    tool?.archiveHashVerified !== true ||
    tool?.hashVerifiedBeforeExtractionExecution !== true ||
    tool?.executableCount !== 1 ||
    tool?.executableWithinTemporaryRoot !== true ||
    tool?.archiveWithinTemporaryRoot !== true ||
    tool?.cacheWithinTemporaryRoot !== true ||
    tool?.updateCheckDisabled !== true ||
    tool?.telemetryOptOut !== true ||
    tool?.pathFallbackUsed !== false ||
    tool?.latestUsed !== false ||
    tool?.globalInstallUsed !== false ||
    tool?.inputInjectionUsed !== false ||
    !tool?.archivePath?.startsWith("<RUNNER_TEMP>\\") ||
    !tool?.installRoot?.startsWith("<RUNNER_TEMP>\\") ||
    !tool?.executablePath?.startsWith("<RUNNER_TEMP>\\") ||
    !tool?.cacheDirectory?.startsWith("<RUNNER_TEMP>\\") ||
    !tool?.firstRunMarker?.startsWith(`${tool.cacheDirectory}\\`) ||
    tool?.firstRunMarkerSha256 !==
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ||
    tool?.firstRunMarkerBytes !== 0 ||
    tool?.firstRunMarkerPreseededBeforeExecution !== true ||
    tool?.versionCommand?.exitCode !== 0 ||
    tool?.versionCommand?.stdout?.trim() !== WINAPP_CLI.version
  ) {
    throw new Error("Windows App CLI provenance evidence is incomplete");
  }
  assertNoAbsoluteWindowsPaths(tool);
  return tool;
}

function hasNativeDialogEvidence(dialog, tool) {
  return (
    dialog?.verdict === "PASS" &&
    dialog?.nativeDialogPathConfirmed === true &&
    dialog?.selectedPathWithinTemp === true &&
    dialog?.filenameHostAutomationId === WINAPP_CLI.selector &&
    dialog?.dialogTitle === dialog?.title &&
    dialog?.dialogCount === 1 &&
    dialog?.dialogEnabled === true &&
    dialog?.dialogOffscreen === false &&
    Number.isInteger(dialog?.dialogHwnd) &&
    dialog.dialogHwnd > 0 &&
    dialog?.hostCount === 1 &&
    dialog?.hostAutomationId === WINAPP_CLI.selector &&
    dialog?.hostEnabled === true &&
    dialog?.hostOffscreen === false &&
    dialog?.discoveryCommand?.exitCode === 0 &&
    dialog?.discoveryCommand?.jsonParsed === true &&
    dialog?.discoveryCommand?.result?.title === dialog?.title &&
    dialog?.discoveryCommand?.result?.dialogCount === dialog?.dialogCount &&
    dialog?.discoveryCommand?.result?.dialogEnabled === dialog?.dialogEnabled &&
    dialog?.discoveryCommand?.result?.dialogOffscreen ===
      dialog?.dialogOffscreen &&
    dialog?.discoveryCommand?.result?.hwnd === dialog?.dialogHwnd &&
    dialog?.discoveryCommand?.result?.hostCount === dialog?.hostCount &&
    dialog?.discoveryCommand?.result?.hostAutomationId ===
      WINAPP_CLI.selector &&
    dialog?.discoveryCommand?.result?.hostAutomationId ===
      dialog?.hostAutomationId &&
    dialog?.discoveryCommand?.result?.hostEnabled === dialog?.hostEnabled &&
    dialog?.discoveryCommand?.result?.hostOffscreen === dialog?.hostOffscreen &&
    dialog?.setValue?.exitCode === 0 &&
    dialog?.setValue?.jsonParsed === true &&
    dialog?.setValue?.requestedSelector === WINAPP_CLI.selector &&
    dialog?.setValue?.windowHwnd === dialog.dialogHwnd &&
    Number(dialog?.setValue?.result?.hwnd) === dialog.dialogHwnd &&
    typeof dialog?.setValue?.result?.elementId === "string" &&
    dialog.setValue.result.elementId !== "" &&
    dialog?.getValue?.exitCode === 0 &&
    dialog?.getValue?.jsonParsed === true &&
    dialog?.getValue?.stdoutOmitted === true &&
    /^[0-9a-f]{64}$/.test(dialog?.getValue?.stdoutSha256 ?? "") &&
    dialog?.getValue?.requestedSelector === WINAPP_CLI.selector &&
    dialog?.getValue?.windowHwnd === dialog.dialogHwnd &&
    dialog?.getValue?.result?.textOmitted === true &&
    dialog?.getValue?.result?.elementId ===
      dialog?.setValue?.result?.elementId &&
    dialog?.getValue?.result?.elementId !== "" &&
    dialog?.observedValueToken === dialog?.expectedValueToken &&
    dialog?.controlIdentityMatched === true &&
    dialog?.pathReadbackConfirmed === true &&
    dialog?.inputInjectionUsed === false &&
    dialog?.toolExecutablePath === tool?.executablePath &&
    dialog?.toolVersion === WINAPP_CLI.version &&
    dialog?.toolArchiveSha256 === WINAPP_CLI.archiveSha256 &&
    Number.isInteger(dialog?.actionCandidateCount) &&
    dialog.actionCandidateCount >= 1 &&
    dialog?.eligibleActionCount === 1 &&
    dialog?.actionInvoked === true &&
    dialog?.dialogDismissed === true &&
    dialog?.actionCommand?.exitCode === 0 &&
    dialog?.actionCommand?.jsonParsed === true &&
    dialog?.actionCommand?.result?.hwnd === dialog?.dialogHwnd &&
    dialog?.actionCommand?.result?.actionCandidateCount ===
      dialog?.actionCandidateCount &&
    dialog?.actionCommand?.result?.eligibleActionCount ===
      dialog?.eligibleActionCount &&
    dialog?.actionCommand?.result?.actionInvoked === dialog?.actionInvoked &&
    dialog?.actionCommand?.result?.dialogDismissed === dialog?.dialogDismissed
  );
}

export function validateWindowsPickerPreflightReport(
  report,
  { candidateSha, workflowRunId } = {},
) {
  validateWinAppToolEvidence(report?.tool);
  if (
    report?.verdict !== "PASS" ||
    report?.stage !== "complete" ||
    report?.proofKind !== "harness-tool-compatibility" ||
    report?.productEvidence !== false ||
    !/^[0-9a-f]{40}$/.test(report?.candidateSha ?? "") ||
    (candidateSha && report.candidateSha !== candidateSha) ||
    (workflowRunId && report?.workflowRunId !== workflowRunId) ||
    !/^Voyalier picker bridge preflight [0-9a-f]{24}$/.test(
      report?.dialog?.title ?? "",
    ) ||
    report?.dialog?.action !== "Save" ||
    !hasNativeDialogEvidence(report?.dialog, report.tool) ||
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
    !/^[0-9a-f]{64}$/.test(report?.dialogHost?.stdoutSha256 ?? "") ||
    report?.dialogHost?.result?.result !== "OK" ||
    report?.dialogHost?.result?.selectedPathToken !==
      report?.dialog?.expectedValueToken ||
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
  if (report.candidate?.version !== "0.11.0") {
    throw new Error("acceptance candidate must be v0.11.0");
  }
  validateWinAppToolEvidence(report.nativePickerTool);
  validateWindowsPickerPreflightReport(report.pickerPreflight, {
    candidateSha: report.candidate?.sha,
    workflowRunId: report.workflow?.runId,
  });
  if (report.installed?.before !== "0.10.7") {
    throw new Error("installed base version was not observed");
  }
  if (report.installed?.after !== "0.11.0") {
    throw new Error(
      "installed candidate version was not observed after the swap",
    );
  }
  if (report.installed?.recovery !== "0.11.0") {
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
    !hasNativeDialogEvidence(report.portableBackup, report.nativePickerTool) ||
    report.portableBackup?.title !== "Save Voyalier backup" ||
    report.portableBackup?.action !== "Save" ||
    report.portableBackup?.screenshotPathRedacted !== true ||
    report.portableBackup?.screenshotPathRedacted !==
      report.portableBackup?.screenshotEvidence?.pathRedactionConfirmed ||
    report.portableBackup?.screenshotEvidence?.fileName !==
      "04-portable-backup-exported.png" ||
    report.portableBackup?.screenshotEvidence?.pathRedactionConfirmed !==
      true ||
    report.portableBackup?.screenshotEvidence?.remainingAbsolutePathMatches !==
      0 ||
    report.portableBackup?.screenshotEvidence?.written !== true ||
    report.portableBackup?.selectedPathWithinTemp !== true ||
    typeof report.portableBackup?.fileName !== "string" ||
    !report.portableBackup.fileName.endsWith(".vbk") ||
    path.win32.basename(report.portableBackup?.expectedValueToken ?? "") !==
      report.portableBackup.fileName ||
    !(report.portableBackup?.bytes > 0) ||
    !/^[0-9a-f]{64}$/.test(report.portableBackup?.sha256 ?? "")
  ) {
    throw new Error("the portable backup UI evidence is incomplete");
  }
  if (
    report.portableRestore?.stagedViaUi !== true ||
    !hasNativeDialogEvidence(report.portableRestore, report.nativePickerTool) ||
    report.portableRestore?.title !== "Choose a Voyalier backup" ||
    report.portableRestore?.action !== "Open" ||
    report.portableRestore?.expectedValueToken !==
      report.portableBackup?.expectedValueToken ||
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
