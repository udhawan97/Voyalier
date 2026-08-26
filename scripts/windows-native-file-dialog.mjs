import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const WINAPP_CLI = Object.freeze({
  name: "Microsoft Windows App CLI",
  tag: "v0.6.0",
  version: "0.6.0",
  releaseCommit: "b7494ed3b324d6e378cb17b477f2b1a9729765d0",
  assetName: "winappcli-x64.zip",
  assetUrl:
    "https://github.com/microsoft/winappCli/releases/download/v0.6.0/winappcli-x64.zip",
  archiveSha256:
    "f6dc42e3b4e4709c8f617003008e2cfdd9a51735e04e7170d60edda258db78a8",
  selector: "FileNameControlHost",
});

export const WINDOWS_DIALOG_COMMAND = Object.freeze({
  method: "WM_COMMAND/IDOK",
  message: "WM_COMMAND",
  messageId: 0x0111,
  controlId: 1,
  notification: "BN_CLICKED",
  notificationCode: 0,
  timeoutMs: 5_000,
  flags: 0x0001 | 0x0002 | 0x0020,
});

function requireString(value, name) {
  assert.equal(typeof value, "string", `${name} must be a string`);
  assert.notEqual(value.trim(), "", `${name} must not be empty`);
  return value.trim();
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeWindowsEvidenceText(value, environment = process.env) {
  let result = String(value ?? "").replaceAll("\r\n", "\n");
  const roots = [
    [environment.GITHUB_WORKSPACE, "<CHECKOUT>"],
    [environment.RUNNER_TEMP, "<RUNNER_TEMP>"],
    [environment.LOCALAPPDATA, "<LOCALAPPDATA>"],
    [environment.USERPROFILE, "<USERPROFILE>"],
    [environment.PNPM_HOME, "<PNPM_HOME>"],
  ]
    .filter(([root]) => typeof root === "string" && root !== "")
    .sort(([left], [right]) => right.length - left.length);
  for (const [root, token] of roots) {
    result = result.replace(new RegExp(regexEscape(root), "gi"), token);
  }
  return result
    .replace(/\b[A-Za-z]:[\\/][^\r\n"'`<>]*/g, "<ABSOLUTE_PATH>")
    .replace(/(?<!:)(?:\\\\|\/\/)[^\\/\s]+[\\/][^\r\n"'`<>]*/g, "<UNC_PATH>");
}

export function sanitizeWindowsEvidenceValue(value, environment = process.env) {
  if (typeof value === "string") {
    return sanitizeWindowsEvidenceText(value, environment);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWindowsEvidenceValue(item, environment));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizeWindowsEvidenceValue(item, environment),
      ]),
    );
  }
  return value;
}

export function assertNoAbsoluteWindowsPaths(value) {
  function visit(item, location) {
    if (typeof item === "string") {
      assert.doesNotMatch(
        item,
        /\b[A-Za-z]:[\\/]|(?<!:)(?:\\\\|\/\/)[^\\/\s]+[\\/]/,
        `absolute Windows path remained at ${location}`,
      );
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, `${location}[${index}]`));
      return;
    }
    if (item && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        visit(child, `${location}.${key}`);
      }
    }
  }
  visit(value, "evidence");
  return value;
}

function sanitized(value, environment = process.env) {
  return sanitizeWindowsEvidenceText(value, environment).slice(-4_000);
}

function commandEvidence(capture, environment = process.env) {
  return {
    exitCode: capture.exitCode,
    stdout: sanitized(capture.stdout, environment),
    stderr: sanitized(capture.stderr, environment),
  };
}

function executeCapturedRaw(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "pipe",
    timeout: options.timeout ?? 5 * 60 * 1000,
    windowsHide: true,
  });
  const capture = {
    exitCode: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
  const evidence = commandEvidence(capture, options.env ?? process.env);
  if (result.error || result.status !== 0) {
    const error = new Error(
      `${path.basename(command)} exited with ${result.status ?? "no status"}: ${evidence.stderr || evidence.stdout || "no output"}`,
      { cause: result.error },
    );
    error.commandEvidence = evidence;
    throw error;
  }
  return capture;
}

export function parseWindowsCommandJson(capture, environment = process.env) {
  const evidence = commandEvidence(capture, environment);
  try {
    const result = JSON.parse(capture.stdout);
    evidence.result = sanitizeWindowsEvidenceValue(result, environment);
    evidence.jsonParsed = true;
    return {
      result,
      evidence,
      stdoutSha256: createHash("sha256").update(capture.stdout).digest("hex"),
    };
  } catch (error) {
    evidence.jsonParsed = false;
    const wrapped = new Error(
      `command returned malformed JSON: ${evidence.stdout || "empty stdout"}`,
      { cause: error },
    );
    wrapped.commandEvidence = evidence;
    throw wrapped;
  }
}

function executeJson(command, args, options = {}) {
  const capture = executeCapturedRaw(command, args, options);
  return parseWindowsCommandJson(capture, options.env ?? process.env);
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function powershellJson(script) {
  return executeJson(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { timeout: 2 * 60 * 1000 },
  );
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function findExecutableMatches(root) {
  const matches = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.name.toLowerCase() === "winapp.exe")
        matches.push(candidate);
    }
  }
  walk(root);
  return matches;
}

export async function loadVerifiedWinAppTool(environment = process.env) {
  assert.equal(process.platform, "win32", "Windows App CLI requires Windows");
  const temporaryRoot = path.resolve(
    requireString(environment.RUNNER_TEMP, "RUNNER_TEMP"),
  );
  const archivePath = path.resolve(
    requireString(
      environment.VOYALIER_WINAPP_ARCHIVE,
      "VOYALIER_WINAPP_ARCHIVE",
    ),
  );
  const installRoot = path.resolve(
    requireString(
      environment.VOYALIER_WINAPP_INSTALL_ROOT,
      "VOYALIER_WINAPP_INSTALL_ROOT",
    ),
  );
  const executablePath = path.resolve(
    requireString(environment.VOYALIER_WINAPP_CLI, "VOYALIER_WINAPP_CLI"),
  );
  const cacheDirectory = path.resolve(
    requireString(
      environment.WINAPP_CLI_CACHE_DIRECTORY,
      "WINAPP_CLI_CACHE_DIRECTORY",
    ),
  );
  const firstRunMarker = path.resolve(
    requireString(
      environment.VOYALIER_WINAPP_FIRST_RUN_MARKER,
      "VOYALIER_WINAPP_FIRST_RUN_MARKER",
    ),
  );
  assert.equal(environment.VOYALIER_WINAPP_VERSION, WINAPP_CLI.version);
  assert.equal(environment.VOYALIER_WINAPP_TAG, WINAPP_CLI.tag);
  assert.equal(
    environment.VOYALIER_WINAPP_RELEASE_COMMIT,
    WINAPP_CLI.releaseCommit,
  );
  assert.equal(environment.VOYALIER_WINAPP_ASSET_NAME, WINAPP_CLI.assetName);
  assert.equal(environment.VOYALIER_WINAPP_ASSET_URL, WINAPP_CLI.assetUrl);
  assert.equal(
    environment.VOYALIER_WINAPP_ARCHIVE_SHA256,
    WINAPP_CLI.archiveSha256,
  );
  assert.equal(
    environment.VOYALIER_WINAPP_HASH_VERIFIED_BEFORE_EXTRACTION_EXECUTION,
    "true",
  );
  assert.equal(environment.VOYALIER_WINAPP_EXECUTABLE_COUNT, "1");
  assert.equal(
    environment.VOYALIER_WINAPP_FIRST_RUN_MARKER_PRESEEDED_BEFORE_EXECUTION,
    "true",
  );
  assert.equal(environment.WINAPP_CLI_UPDATE_CHECK, "0");
  assert.equal(environment.WINAPP_CLI_TELEMETRY_OPTOUT, "1");
  assert.ok(isInside(temporaryRoot, archivePath));
  assert.ok(isInside(temporaryRoot, installRoot));
  assert.ok(isInside(temporaryRoot, executablePath));
  assert.ok(isInside(temporaryRoot, cacheDirectory));
  assert.ok(isInside(cacheDirectory, firstRunMarker));
  assert.ok(isInside(installRoot, executablePath));
  assert.ok(statSync(archivePath).isFile());
  assert.ok(statSync(executablePath).isFile());
  assert.ok(statSync(cacheDirectory).isDirectory());
  assert.ok(statSync(firstRunMarker).isFile());
  assert.equal(statSync(firstRunMarker).size, 0);
  const executableMatches = findExecutableMatches(installRoot);
  assert.deepEqual(
    executableMatches.map((match) => path.resolve(match)),
    [executablePath],
  );
  const archiveSha256Actual = await sha256(archivePath);
  assert.equal(archiveSha256Actual, WINAPP_CLI.archiveSha256);
  const firstRunMarkerSha256 = await sha256(firstRunMarker);
  assert.equal(
    firstRunMarkerSha256,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  const versionCapture = executeCapturedRaw(executablePath, ["--version"], {
    env: environment,
  });
  const versionReported = versionCapture.stdout.trim();
  assert.equal(versionReported, WINAPP_CLI.version);
  const versionCommand = commandEvidence(versionCapture, environment);

  return {
    executablePath,
    environment,
    evidence: {
      name: WINAPP_CLI.name,
      tag: WINAPP_CLI.tag,
      versionExpected: WINAPP_CLI.version,
      versionReported,
      releaseCommit: WINAPP_CLI.releaseCommit,
      assetName: WINAPP_CLI.assetName,
      assetUrl: WINAPP_CLI.assetUrl,
      archivePath: sanitizeWindowsEvidenceText(archivePath, environment),
      archiveSha256Expected: WINAPP_CLI.archiveSha256,
      archiveSha256Actual,
      archiveHashVerified: true,
      hashVerifiedBeforeExtractionExecution: true,
      installRoot: sanitizeWindowsEvidenceText(installRoot, environment),
      executablePath: sanitizeWindowsEvidenceText(executablePath, environment),
      executableCount: executableMatches.length,
      executableWithinTemporaryRoot: true,
      archiveWithinTemporaryRoot: true,
      cacheDirectory: sanitizeWindowsEvidenceText(cacheDirectory, environment),
      cacheWithinTemporaryRoot: true,
      firstRunMarker: sanitizeWindowsEvidenceText(firstRunMarker, environment),
      firstRunMarkerSha256,
      firstRunMarkerBytes: 0,
      firstRunMarkerPreseededBeforeExecution: true,
      updateCheckDisabled: true,
      telemetryOptOut: true,
      pathFallbackUsed: false,
      latestUsed: false,
      globalInstallUsed: false,
      inputInjectionUsed: false,
      versionCommand,
    },
  };
}

function writeDiagnostic(file, record) {
  if (!file) return;
  mkdirSync(path.dirname(file), { recursive: true });
  const sanitizedRecord = sanitizeWindowsEvidenceValue(record);
  assertNoAbsoluteWindowsPaths(sanitizedRecord);
  writeFileSync(file, `${JSON.stringify(sanitizedRecord, null, 2)}\n`);
}

function discoverDialog(title) {
  return powershellJson(
    `Add-Type -AssemblyName UIAutomationClient; ` +
      `Add-Type -AssemblyName UIAutomationTypes; ` +
      `$title = ${psQuote(title)}; ` +
      `$root = [System.Windows.Automation.AutomationElement]::RootElement; ` +
      `$titleCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty, $title); ` +
      `$hostCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty, ` +
      `${psQuote(WINAPP_CLI.selector)}); ` +
      `$deadline = (Get-Date).AddSeconds(45); ` +
      `$lastDialogCount = 0; $lastHostCount = 0; ` +
      `do { ` +
      `$dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $titleCondition); ` +
      `$lastDialogCount = $dialogs.Count; ` +
      `if ($dialogs.Count -gt 1) { throw "multiple exact-title dialogs: $($dialogs.Count)" }; ` +
      `if ($dialogs.Count -eq 1) { ` +
      `$dialog = $dialogs.Item(0); ` +
      `$dialogEnabled = $dialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$dialogOffscreen = $dialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `$hwnd = [int64]$dialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `$hosts = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $hostCondition); ` +
      `$lastHostCount = $hosts.Count; ` +
      `if ($hosts.Count -gt 1) { throw "multiple semantic filename hosts: $($hosts.Count)" }; ` +
      `if ($hosts.Count -eq 1) { ` +
      `$fileNameHost = $hosts.Item(0); ` +
      `$hostAutomationId = [string]$fileNameHost.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty); ` +
      `$hostEnabled = $fileNameHost.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$hostOffscreen = $fileNameHost.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `if ($dialogEnabled -eq $true -and $dialogOffscreen -eq $false -and ` +
      `$hwnd -gt 0 -and $hostEnabled -eq $true -and $hostOffscreen -eq $false) { ` +
      `@{ title = $title; dialogCount = $dialogs.Count; dialogEnabled = $dialogEnabled; ` +
      `dialogOffscreen = $dialogOffscreen; hwnd = $hwnd; hostCount = $hosts.Count; ` +
      `hostAutomationId = $hostAutomationId; hostEnabled = $hostEnabled; ` +
      `hostOffscreen = $hostOffscreen } ` +
      `| ConvertTo-Json -Compress; exit 0 ` +
      `} ` +
      `} ` +
      `} ` +
      `Start-Sleep -Milliseconds 200 ` +
      `} while ((Get-Date) -lt $deadline); ` +
      `throw "exact native dialog did not become ready (dialogs $lastDialogCount, hosts $lastHostCount)"`,
  );
}

function invokeExactAction(title, hwnd, action) {
  const nativeDialogCommandType =
    `using System; using System.Runtime.InteropServices; ` +
    `public static class VoyalierNativeDialogCommand { ` +
    `[DllImport("user32.dll", SetLastError=true)] ` +
    `[return: MarshalAs(UnmanagedType.Bool)] ` +
    `public static extern bool IsWindow(IntPtr hWnd); ` +
    `[DllImport("user32.dll", SetLastError=true)] ` +
    `[return: MarshalAs(UnmanagedType.Bool)] ` +
    `public static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd); ` +
    `[DllImport("user32.dll", SetLastError=true)] ` +
    `public static extern int GetDlgCtrlID(IntPtr hWnd); ` +
    `[DllImport("user32.dll", EntryPoint="SendMessageTimeoutW", ExactSpelling=true, ` +
    `SetLastError=true, CharSet=CharSet.Unicode)] ` +
    `public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, ` +
    `UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result); ` +
    `}`;
  return powershellJson(
    `Add-Type -AssemblyName UIAutomationClient; ` +
      `Add-Type -AssemblyName UIAutomationTypes; ` +
      `Add-Type -TypeDefinition ${psQuote(nativeDialogCommandType)}; ` +
      `$title = ${psQuote(title)}; $expectedHwnd = [int64]${hwnd}; ` +
      `$action = ${psQuote(action)}; ` +
      `$root = [System.Windows.Automation.AutomationElement]::RootElement; ` +
      `$titleCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty, $title); ` +
      `$actionCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty, $action); ` +
      `$dialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $titleCondition); ` +
      `if ($dialogs.Count -ne 1) { throw "expected one exact-title dialog before invoke, found $($dialogs.Count)" }; ` +
      `$dialog = $dialogs.Item(0); ` +
      `$observedHwnd = [int64]$dialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `if ($observedHwnd -ne $expectedHwnd) { throw "native dialog HWND changed" }; ` +
      `$candidates = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, $actionCondition); ` +
      `$exactActionTargetCount = 0; $selectedCandidate = $null; ` +
      `$candidateObservations = [System.Collections.Generic.List[string]]::new(); ` +
      `for ($index = 0; $index -lt $candidates.Count; $index++) { ` +
      `$candidate = $candidates.Item($index); ` +
      `$candidateControlType = $candidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::ControlTypeProperty); ` +
      `$candidateEnabled = $candidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$candidateOffscreen = $candidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `$candidateAutomationId = [string]$candidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty); ` +
      `$candidateObservations.Add(` +
      `"index=$index,type=$($candidateControlType.ProgrammaticName),enabled=$candidateEnabled,offscreen=$candidateOffscreen,automationId=$candidateAutomationId"); ` +
      `if ($candidateControlType -ne [System.Windows.Automation.ControlType]::Button -and ` +
      `$candidateControlType -ne [System.Windows.Automation.ControlType]::Pane) { continue }; ` +
      `if ($candidateEnabled -ne $true) { continue }; ` +
      `if ($candidateOffscreen -ne $false) { continue }; ` +
      `$exactActionTargetCount += 1; ` +
      `if ($exactActionTargetCount -eq 1) { $selectedCandidate = $candidate } ` +
      `}; ` +
      `if ($exactActionTargetCount -ne 1) { ` +
      `throw "expected one exact-name enabled onscreen Button or Pane, raw $($candidates.Count), eligible $exactActionTargetCount, observations $($candidateObservations -join '|')" ` +
      `}; ` +
      `$selectedName = [string]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty); ` +
      `$selectedControlType = $selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::ControlTypeProperty); ` +
      `$selectedAutomationId = [string]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty); ` +
      `$selectedNativeHwnd = [int64]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `$selectedPattern = $null; $actionMethod = $null; ` +
      `$invokePatternAvailable = $false; $legacyPatternAvailable = $false; ` +
      `try { $selectedPattern = $selectedCandidate.GetCurrentPattern(` +
      `[System.Windows.Automation.InvokePattern]::Pattern); ` +
      `if ($null -eq $selectedPattern) { throw "null InvokePattern" }; ` +
      `$invokePatternAvailable = $true; $actionMethod = "InvokePattern" } catch { ` +
      `try { $selectedPattern = $selectedCandidate.GetCurrentPattern(` +
      `[System.Windows.Automation.LegacyIAccessiblePattern]::Pattern); ` +
      `if ($null -eq $selectedPattern) { throw "null LegacyIAccessiblePattern" }; ` +
      `$legacyPatternAvailable = $true; $actionMethod = "LegacyIAccessiblePattern" } catch { ` +
      `$actionMethod = ${psQuote(WINDOWS_DIALOG_COMMAND.method)} ` +
      `}; ` +
      `}; ` +
      `$actionCommandMessage = $null; $actionCommandMessageId = $null; ` +
      `$actionAutomationIdParsed = $null; $actionControlId = $null; ` +
      `$actionNotification = $null; ` +
      `$actionNotificationCode = $null; $actionCommandTimeoutMs = $null; ` +
      `$actionCommandFlags = $null; $actionNativeControlBound = $false; ` +
      `$actionDialogReverified = $false; $actionTargetReverified = $false; ` +
      `$actionNativeIsWindow = $false; $actionNativeIsChild = $false; ` +
      `$actionNativeControlIdConfirmed = $false; ` +
      `$actionCommandApiSucceeded = $false; $actionCommandResult = $null; ` +
      `$actionCommandDispatchStatus = $null; ` +
      `if ($actionMethod -eq "InvokePattern") { $selectedPattern.Invoke() } ` +
      `elseif ($actionMethod -eq "LegacyIAccessiblePattern") { ` +
      `$selectedPattern.DoDefaultAction() } ` +
      `elseif ($actionMethod -eq ${psQuote(WINDOWS_DIALOG_COMMAND.method)}) { ` +
      `if ($selectedAutomationId -cne ${psQuote(String(WINDOWS_DIALOG_COMMAND.controlId))}) { ` +
      `throw "patternless exact action does not expose canonical IDOK AutomationId" }; ` +
      `[int32]$parsedAutomationId = 0; ` +
      `if (-not [int32]::TryParse($selectedAutomationId, [ref]$parsedAutomationId) -or ` +
      `$parsedAutomationId -ne ${WINDOWS_DIALOG_COMMAND.controlId}) { ` +
      `throw "patternless exact action AutomationId did not parse as IDOK" }; ` +
      `$actionAutomationIdParsed = $parsedAutomationId; ` +
      `if ($selectedNativeHwnd -le 0) { throw "patternless exact action has no native HWND" }; ` +
      `$sendDialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $titleCondition); ` +
      `if ($sendDialogs.Count -ne 1) { throw "expected one exact-title dialog before native command" }; ` +
      `$sendDialog = $sendDialogs.Item(0); ` +
      `$sendDialogHwnd = [int64]$sendDialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `$sendDialogEnabled = $sendDialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$sendDialogOffscreen = $sendDialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `if ($sendDialogHwnd -ne $observedHwnd -or $sendDialogHwnd -le 0 -or ` +
      `$sendDialogEnabled -ne $true -or $sendDialogOffscreen -ne $false) { ` +
      `throw "exact native dialog changed before command" }; ` +
      `$actionDialogReverified = $true; ` +
      `$sendName = [string]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty); ` +
      `$sendAutomationId = [string]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty); ` +
      `$sendNativeHwnd = [int64]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `$sendEnabled = $selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$sendOffscreen = $selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `if ($sendName -cne $selectedName -or $sendAutomationId -cne $selectedAutomationId -or ` +
      `$sendNativeHwnd -ne $selectedNativeHwnd -or $sendEnabled -ne $true -or ` +
      `$sendOffscreen -ne $false) { throw "exact action changed before native command" }; ` +
      `$actionTargetReverified = $true; ` +
      `$dialogPtr = [IntPtr]$observedHwnd; $controlPtr = [IntPtr]$selectedNativeHwnd; ` +
      `$actionNativeIsWindow = [VoyalierNativeDialogCommand]::IsWindow($controlPtr); ` +
      `if (-not $actionNativeIsWindow) { ` +
      `throw "patternless exact action native HWND is not a window" }; ` +
      `$actionNativeIsChild = [VoyalierNativeDialogCommand]::IsChild($dialogPtr, $controlPtr); ` +
      `if (-not $actionNativeIsChild) { ` +
      `throw "patternless exact action native HWND is not a child of the dialog" }; ` +
      `$observedControlId = [VoyalierNativeDialogCommand]::GetDlgCtrlID($controlPtr); ` +
      `if ($observedControlId -ne ${WINDOWS_DIALOG_COMMAND.controlId}) { ` +
      `throw "patternless exact action native control is not IDOK" }; ` +
      `$actionNativeControlIdConfirmed = $true; ` +
      `$actionCommandMessage = ${psQuote(WINDOWS_DIALOG_COMMAND.message)}; ` +
      `$actionCommandMessageId = ${WINDOWS_DIALOG_COMMAND.messageId}; ` +
      `$actionControlId = $observedControlId; ` +
      `$actionNotification = ${psQuote(WINDOWS_DIALOG_COMMAND.notification)}; ` +
      `$actionNotificationCode = ${WINDOWS_DIALOG_COMMAND.notificationCode}; ` +
      `$actionCommandTimeoutMs = ${WINDOWS_DIALOG_COMMAND.timeoutMs}; ` +
      `$actionCommandFlags = ${WINDOWS_DIALOG_COMMAND.flags}; ` +
      `$actionNativeControlBound = $true; $nativeResult = [UIntPtr]::Zero; ` +
      `$sendStatus = [VoyalierNativeDialogCommand]::SendMessageTimeout(` +
      `$dialogPtr, [uint32]$actionCommandMessageId, ` +
      `[UIntPtr][uint64]$actionControlId, $controlPtr, ` +
      `[uint32]$actionCommandFlags, [uint32]$actionCommandTimeoutMs, [ref]$nativeResult); ` +
      `if ($sendStatus -eq [IntPtr]::Zero) { throw "bounded native dialog command failed" }; ` +
      `$actionCommandApiSucceeded = $true; ` +
      `$actionCommandResult = $nativeResult.ToUInt64(); ` +
      `$actionCommandDispatchStatus = $sendStatus.ToInt64() ` +
      `} else { throw "unsupported exact action method: $actionMethod" }; ` +
      `$deadline = (Get-Date).AddSeconds(30); $remaining = -1; ` +
      `do { ` +
      `$remainingDialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $titleCondition); ` +
      `$remaining = $remainingDialogs.Count; ` +
      `if ($remaining -gt 1) { throw "multiple exact-title dialogs after invoke: $remaining" }; ` +
      `if ($remaining -eq 0) { ` +
      `@{ dialogCountBefore = 1; dialogCountAfter = 0; ` +
      `actionCandidateCount = $candidates.Count; ` +
      `exactActionTargetCount = $exactActionTargetCount; ` +
      `actionName = $selectedName; ` +
      `actionControlType = [string]$selectedControlType.ProgrammaticName; ` +
      `actionAutomationId = $selectedAutomationId; actionMethod = $actionMethod; ` +
      `actionAutomationIdParsed = $actionAutomationIdParsed; ` +
      `invokePatternAvailable = $invokePatternAvailable; ` +
      `legacyPatternAvailable = $legacyPatternAvailable; ` +
      `actionNativeControlHwnd = $selectedNativeHwnd; ` +
      `actionNativeControlBound = $actionNativeControlBound; ` +
      `actionDialogReverified = $actionDialogReverified; ` +
      `actionTargetReverified = $actionTargetReverified; ` +
      `actionNativeIsWindow = $actionNativeIsWindow; ` +
      `actionNativeIsChild = $actionNativeIsChild; ` +
      `actionNativeControlIdConfirmed = $actionNativeControlIdConfirmed; ` +
      `actionCommandMessage = $actionCommandMessage; ` +
      `actionCommandMessageId = $actionCommandMessageId; ` +
      `actionControlId = $actionControlId; actionNotification = $actionNotification; ` +
      `actionNotificationCode = $actionNotificationCode; ` +
      `actionCommandTimeoutMs = $actionCommandTimeoutMs; ` +
      `actionCommandFlags = $actionCommandFlags; ` +
      `actionCommandApiSucceeded = $actionCommandApiSucceeded; ` +
      `actionCommandResult = $actionCommandResult; ` +
      `actionCommandDispatchStatus = $actionCommandDispatchStatus; ` +
      `actionCommandDestinationHwnd = $(if ($actionCommandMessage) { $observedHwnd } else { $null }); ` +
      `actionCommandWParam = $(if ($actionCommandMessage) { $actionControlId } else { $null }); ` +
      `actionCommandLParam = $(if ($actionCommandMessage) { $selectedNativeHwnd } else { $null }); ` +
      `inputInjectionUsed = $false; ` +
      `actionInvoked = $true; dialogDismissed = $true; hwnd = $observedHwnd } ` +
      `| ConvertTo-Json -Compress; exit 0 ` +
      `}; ` +
      `Start-Sleep -Milliseconds 200 ` +
      `} while ((Get-Date) -lt $deadline); ` +
      `throw "native dialog did not dismiss (remaining $remaining)"`,
  );
}

export async function driveNativeFileDialog({
  tool,
  title,
  filePath,
  action,
  temporaryRoot,
  diagnosticPath,
}) {
  title = requireString(title, "title");
  filePath = path.resolve(requireString(filePath, "filePath"));
  temporaryRoot = path.resolve(requireString(temporaryRoot, "temporaryRoot"));
  assert.ok(["Save", "Open"].includes(action));
  assert.ok(path.isAbsolute(filePath));
  assert.ok(isInside(temporaryRoot, filePath));
  assert.equal(tool?.evidence?.archiveHashVerified, true);
  assert.equal(tool?.evidence?.versionReported, WINAPP_CLI.version);
  assert.equal(tool?.evidence?.inputInjectionUsed, false);
  const expectedValueToken = `<DIALOG_TEMP>${path.sep}${path.relative(
    temporaryRoot,
    filePath,
  )}`;

  const record = {
    verdict: "FAIL",
    title,
    action,
    expectedValueToken,
    filenameHostAutomationId: WINAPP_CLI.selector,
    toolExecutablePath: tool.evidence.executablePath,
    toolVersion: tool.evidence.versionReported,
    toolArchiveSha256: tool.evidence.archiveSha256Actual,
    selectedPathWithinTemp: true,
    nativeDialogPathConfirmed: false,
    inputInjectionUsed: false,
  };
  writeDiagnostic(diagnosticPath, record);
  try {
    const discovery = discoverDialog(title);
    record.discoveryCommand = discovery.evidence;
    const observed = discovery.result;
    assert.equal(observed.title, title);
    assert.equal(observed.dialogCount, 1);
    assert.equal(observed.dialogEnabled, true);
    assert.equal(observed.dialogOffscreen, false);
    assert.ok(Number.isInteger(observed.hwnd) && observed.hwnd > 0);
    assert.equal(observed.hostCount, 1);
    assert.equal(observed.hostAutomationId, WINAPP_CLI.selector);
    assert.equal(observed.hostEnabled, true);
    assert.equal(observed.hostOffscreen, false);
    record.dialogTitle = title;
    record.dialogCount = observed.dialogCount;
    record.dialogEnabled = observed.dialogEnabled;
    record.dialogOffscreen = observed.dialogOffscreen;
    record.dialogHwnd = observed.hwnd;
    record.hostCount = observed.hostCount;
    record.hostAutomationId = observed.hostAutomationId;
    record.hostEnabled = observed.hostEnabled;
    record.hostOffscreen = observed.hostOffscreen;
    writeDiagnostic(diagnosticPath, record);

    const setValue = executeJson(
      tool.executablePath,
      [
        "ui",
        "set-value",
        WINAPP_CLI.selector,
        filePath,
        "--window",
        String(observed.hwnd),
        "--json",
      ],
      { env: tool.environment },
    );
    setValue.evidence.requestedSelector = WINAPP_CLI.selector;
    setValue.evidence.windowHwnd = observed.hwnd;
    record.setValue = setValue.evidence;
    assert.equal(setValue.evidence.exitCode, 0);
    assert.equal(setValue.evidence.jsonParsed, true);
    assert.equal(typeof setValue.result?.elementId, "string");
    assert.notEqual(setValue.result.elementId, "");
    assert.equal(Number(setValue.result?.hwnd), observed.hwnd);
    writeDiagnostic(diagnosticPath, record);

    const getValue = executeJson(
      tool.executablePath,
      [
        "ui",
        "get-value",
        WINAPP_CLI.selector,
        "--window",
        String(observed.hwnd),
        "--json",
      ],
      { env: tool.environment },
    );
    assert.equal(getValue.evidence.exitCode, 0);
    assert.equal(getValue.evidence.jsonParsed, true);
    assert.equal(typeof getValue.result?.elementId, "string");
    assert.notEqual(getValue.result.elementId, "");
    assert.equal(getValue.result.elementId, setValue.result.elementId);
    assert.equal(getValue.result?.text, filePath);
    record.getValue = {
      exitCode: getValue.evidence.exitCode,
      jsonParsed: getValue.evidence.jsonParsed,
      stdoutOmitted: true,
      stdoutSha256: getValue.stdoutSha256,
      stderr: getValue.evidence.stderr,
      requestedSelector: WINAPP_CLI.selector,
      windowHwnd: observed.hwnd,
      result: {
        elementId: getValue.result.elementId,
        textOmitted: true,
      },
    };
    record.observedValueToken = expectedValueToken;
    record.controlIdentityMatched = true;
    record.pathReadbackConfirmed = true;
    writeDiagnostic(diagnosticPath, record);

    const invoked = invokeExactAction(title, observed.hwnd, action);
    record.actionCommand = invoked.evidence;
    assert.equal(invoked.result?.hwnd, observed.hwnd);
    assert.equal(invoked.result?.exactActionTargetCount, 1);
    assert.equal(invoked.result?.actionName, action);
    assert.ok(
      ["ControlType.Button", "ControlType.Pane"].includes(
        invoked.result?.actionControlType,
      ),
    );
    assert.equal(typeof invoked.result?.actionAutomationId, "string");
    assert.notEqual(invoked.result.actionAutomationId, "");
    assert.ok(
      [
        "InvokePattern",
        "LegacyIAccessiblePattern",
        WINDOWS_DIALOG_COMMAND.method,
      ].includes(invoked.result?.actionMethod),
    );
    assert.equal(invoked.result?.dialogCountBefore, 1);
    assert.equal(invoked.result?.dialogCountAfter, 0);
    assert.equal(invoked.result?.inputInjectionUsed, false);
    if (invoked.result.actionMethod === WINDOWS_DIALOG_COMMAND.method) {
      assert.equal(invoked.result.invokePatternAvailable, false);
      assert.equal(invoked.result.legacyPatternAvailable, false);
      assert.equal(
        invoked.result.actionAutomationId,
        String(WINDOWS_DIALOG_COMMAND.controlId),
      );
      assert.equal(
        invoked.result.actionAutomationIdParsed,
        WINDOWS_DIALOG_COMMAND.controlId,
      );
      assert.ok(Number.isInteger(invoked.result.actionNativeControlHwnd));
      assert.ok(invoked.result.actionNativeControlHwnd > 0);
      assert.equal(invoked.result.actionNativeControlBound, true);
      assert.equal(invoked.result.actionDialogReverified, true);
      assert.equal(invoked.result.actionTargetReverified, true);
      assert.equal(invoked.result.actionNativeIsWindow, true);
      assert.equal(invoked.result.actionNativeIsChild, true);
      assert.equal(invoked.result.actionNativeControlIdConfirmed, true);
      assert.equal(
        invoked.result.actionCommandMessage,
        WINDOWS_DIALOG_COMMAND.message,
      );
      assert.equal(
        invoked.result.actionCommandMessageId,
        WINDOWS_DIALOG_COMMAND.messageId,
      );
      assert.equal(
        invoked.result.actionControlId,
        WINDOWS_DIALOG_COMMAND.controlId,
      );
      assert.equal(
        invoked.result.actionNotification,
        WINDOWS_DIALOG_COMMAND.notification,
      );
      assert.equal(
        invoked.result.actionNotificationCode,
        WINDOWS_DIALOG_COMMAND.notificationCode,
      );
      assert.equal(
        invoked.result.actionCommandTimeoutMs,
        WINDOWS_DIALOG_COMMAND.timeoutMs,
      );
      assert.equal(
        invoked.result.actionCommandFlags,
        WINDOWS_DIALOG_COMMAND.flags,
      );
      assert.equal(invoked.result.actionCommandApiSucceeded, true);
      assert.ok(invoked.result.actionCommandDispatchStatus > 0);
      assert.equal(invoked.result.actionCommandDestinationHwnd, observed.hwnd);
      assert.equal(
        invoked.result.actionCommandWParam,
        WINDOWS_DIALOG_COMMAND.controlId,
      );
      assert.equal(
        invoked.result.actionCommandLParam,
        invoked.result.actionNativeControlHwnd,
      );
    } else if (invoked.result.actionMethod === "InvokePattern") {
      assert.equal(invoked.result.invokePatternAvailable, true);
      assert.equal(invoked.result.legacyPatternAvailable, false);
    } else {
      assert.equal(invoked.result.invokePatternAvailable, false);
      assert.equal(invoked.result.legacyPatternAvailable, true);
    }
    assert.equal(invoked.result?.actionInvoked, true);
    assert.equal(invoked.result?.dialogDismissed, true);
    Object.assign(record, {
      nativeDialogPathConfirmed: true,
      dialogCountBefore: invoked.result.dialogCountBefore,
      dialogCountAfter: invoked.result.dialogCountAfter,
      actionCandidateCount: invoked.result.actionCandidateCount,
      exactActionTargetCount: invoked.result.exactActionTargetCount,
      actionName: invoked.result.actionName,
      actionControlType: invoked.result.actionControlType,
      actionAutomationId: invoked.result.actionAutomationId,
      actionMethod: invoked.result.actionMethod,
      actionAutomationIdParsed: invoked.result.actionAutomationIdParsed,
      invokePatternAvailable: invoked.result.invokePatternAvailable,
      legacyPatternAvailable: invoked.result.legacyPatternAvailable,
      actionNativeControlHwnd: invoked.result.actionNativeControlHwnd,
      actionNativeControlBound: invoked.result.actionNativeControlBound,
      actionDialogReverified: invoked.result.actionDialogReverified,
      actionTargetReverified: invoked.result.actionTargetReverified,
      actionNativeIsWindow: invoked.result.actionNativeIsWindow,
      actionNativeIsChild: invoked.result.actionNativeIsChild,
      actionNativeControlIdConfirmed:
        invoked.result.actionNativeControlIdConfirmed,
      actionCommandMessage: invoked.result.actionCommandMessage,
      actionCommandMessageId: invoked.result.actionCommandMessageId,
      actionControlId: invoked.result.actionControlId,
      actionNotification: invoked.result.actionNotification,
      actionNotificationCode: invoked.result.actionNotificationCode,
      actionCommandTimeoutMs: invoked.result.actionCommandTimeoutMs,
      actionCommandFlags: invoked.result.actionCommandFlags,
      actionCommandApiSucceeded: invoked.result.actionCommandApiSucceeded,
      actionCommandResult: invoked.result.actionCommandResult,
      actionCommandDispatchStatus: invoked.result.actionCommandDispatchStatus,
      actionCommandDestinationHwnd: invoked.result.actionCommandDestinationHwnd,
      actionCommandWParam: invoked.result.actionCommandWParam,
      actionCommandLParam: invoked.result.actionCommandLParam,
      actionInvoked: true,
      dialogDismissed: true,
      verdict: "PASS",
    });
    writeDiagnostic(diagnosticPath, record);
    assertNoAbsoluteWindowsPaths(record);
    return record;
  } catch (error) {
    record.error = sanitized(
      error instanceof Error ? error.message : String(error),
      tool?.environment,
    );
    if (error?.commandEvidence) record.failedCommand = error.commandEvidence;
    writeDiagnostic(diagnosticPath, record);
    throw error;
  }
}

export function pathIsInside(parent, candidate) {
  return isInside(parent, candidate);
}
