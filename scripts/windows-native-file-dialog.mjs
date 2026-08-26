import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const FILE_NAME_HOST_AUTOMATION_ID = "FileNameControlHost";

export const WINDOWS_ACCESSIBLE_ACTION = Object.freeze({
  method: "MSAA/IAccessible.accDoDefaultAction",
  objectId: 0xfffffffc,
  interfaceId: "618736e0-3c3d-11cf-810c-00aa00389b71",
  childId: 0,
  controlId: 1,
  role: 0x2b,
  blockedStateMask: 0x00000001 | 0x00008000 | 0x00010000,
  processTimeoutMs: 60_000,
});

function requireString(value, name) {
  assert.equal(typeof value, "string", `${name} must be a string`);
  assert.notEqual(value.trim(), "", `${name} must not be empty`);
  return value.trim();
}

function sha256Text(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
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

function powershellJson(script, timeout = 2 * 60 * 1000) {
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
    { timeout },
  );
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
      `${psQuote(FILE_NAME_HOST_AUTOMATION_ID)}); ` +
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
  const nativeAccessibleActionType =
    `using System; using System.Runtime.InteropServices; using Accessibility; ` +
    `public sealed class VoyalierAccessibleActionResult { ` +
    `public int HResult { get; set; } ` +
    `public bool InterfaceNonNull { get; set; } ` +
    `public int WindowBindingHResult { get; set; } ` +
    `public long BoundHwnd { get; set; } ` +
    `public string Name { get; set; } ` +
    `public string DefaultAction { get; set; } ` +
    `public int Role { get; set; } ` +
    `public int State { get; set; } ` +
    `public int InvocationCount { get; set; } ` +
    `public bool InvocationCompleted { get; set; } ` +
    `public bool InterfaceReleased { get; set; } ` +
    `public string ErrorType { get; set; } ` +
    `public string ErrorMessage { get; set; } ` +
    `public VoyalierAccessibleActionResult() { HResult = int.MinValue; ` +
    `WindowBindingHResult = int.MinValue; Role = -1; State = -1; } ` +
    `} ` +
    `public static class VoyalierNativeAccessibleAction { ` +
    `[DllImport("user32.dll", SetLastError=true)] ` +
    `[return: MarshalAs(UnmanagedType.Bool)] ` +
    `public static extern bool IsWindow(IntPtr hWnd); ` +
    `[DllImport("user32.dll", SetLastError=true)] ` +
    `[return: MarshalAs(UnmanagedType.Bool)] ` +
    `public static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd); ` +
    `[DllImport("user32.dll", SetLastError=true)] ` +
    `public static extern int GetDlgCtrlID(IntPtr hWnd); ` +
    `[DllImport("oleacc.dll", ExactSpelling=true, PreserveSig=true)] ` +
    `private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ` +
    `ref Guid interfaceId, [MarshalAs(UnmanagedType.Interface)] out object accessibleObject); ` +
    `[DllImport("oleacc.dll", ExactSpelling=true, PreserveSig=true)] ` +
    `private static extern int WindowFromAccessibleObject(IAccessible accessible, out IntPtr hwnd); ` +
    `public static VoyalierAccessibleActionResult Invoke(IntPtr expectedHwnd, ` +
    `string expectedName, uint objectId, string interfaceId, int childId, ` +
    `int expectedRole, int blockedStateMask) { ` +
    `var result = new VoyalierAccessibleActionResult(); object raw = null; ` +
    `try { ` +
    `var iid = new Guid(interfaceId); ` +
    `result.HResult = AccessibleObjectFromWindow(expectedHwnd, objectId, ref iid, out raw); ` +
    `if (result.HResult != 0) throw new COMException("AccessibleObjectFromWindow failed", result.HResult); ` +
    `if (raw == null) throw new InvalidOperationException("AccessibleObjectFromWindow returned null"); ` +
    `result.InterfaceNonNull = true; var accessible = (IAccessible)raw; ` +
    `IntPtr boundHwnd; result.WindowBindingHResult = ` +
    `WindowFromAccessibleObject(accessible, out boundHwnd); ` +
    `result.BoundHwnd = boundHwnd.ToInt64(); ` +
    `if (result.WindowBindingHResult != 0 || boundHwnd != expectedHwnd) ` +
    `throw new InvalidOperationException("accessible object HWND mismatch"); ` +
    `object self = childId; result.Name = accessible.accName[self]; ` +
    `result.DefaultAction = accessible.accDefaultAction[self]; ` +
    `result.Role = Convert.ToInt32(accessible.accRole[self]); ` +
    `result.State = Convert.ToInt32(accessible.accState[self]); ` +
    `if (!String.Equals(result.Name, expectedName, StringComparison.Ordinal)) ` +
    `throw new InvalidOperationException("accessible action name mismatch"); ` +
    `if (String.IsNullOrWhiteSpace(result.DefaultAction)) ` +
    `throw new InvalidOperationException("accessible default action is empty"); ` +
    `if (result.Role != expectedRole) ` +
    `throw new InvalidOperationException("accessible action role is not push button"); ` +
    `if ((result.State & blockedStateMask) != 0) ` +
    `throw new InvalidOperationException("accessible action state is unavailable or hidden"); ` +
    `accessible.accDoDefaultAction(self); result.InvocationCount = 1; ` +
    `result.InvocationCompleted = true; ` +
    `} catch (Exception error) { ` +
    `result.ErrorType = error.GetType().FullName; result.ErrorMessage = error.Message; ` +
    `} finally { ` +
    `if (raw != null && Marshal.IsComObject(raw)) { ` +
    `try { Marshal.FinalReleaseComObject(raw); result.InterfaceReleased = true; } ` +
    `catch (Exception releaseError) { result.InterfaceReleased = false; ` +
    `if (result.ErrorType == null) { result.ErrorType = releaseError.GetType().FullName; ` +
    `result.ErrorMessage = "accessible object release failed"; } } ` +
    `} ` +
    `} return result; ` +
    `} ` +
    `}`;
  return powershellJson(
    `Add-Type -AssemblyName UIAutomationClient; ` +
      `Add-Type -AssemblyName UIAutomationTypes; ` +
      `Add-Type -AssemblyName Accessibility; ` +
      `$accessibilityAssembly = [Accessibility.IAccessible].Assembly.Location; ` +
      `Add-Type -TypeDefinition ${psQuote(nativeAccessibleActionType)} ` +
      `-ReferencedAssemblies $accessibilityAssembly; ` +
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
      `$actionMethod = ${psQuote(WINDOWS_ACCESSIBLE_ACTION.method)} ` +
      `}; ` +
      `}; ` +
      `$actionAutomationIdParsed = $null; $actionControlId = $null; ` +
      `$actionNativeControlBound = $false; ` +
      `$actionDialogReverified = $false; $actionTargetReverified = $false; ` +
      `$actionNativeIsWindow = $false; $actionNativeIsChild = $false; ` +
      `$actionNativeControlIdConfirmed = $false; ` +
      `$actionMsaaObjectId = $null; $actionMsaaInterfaceId = $null; ` +
      `$actionMsaaChildId = $null; $actionMsaaHResult = $null; ` +
      `$actionMsaaInterfaceNonNull = $false; ` +
      `$actionMsaaWindowBindingHResult = $null; $actionMsaaBoundHwnd = $null; ` +
      `$actionAccessibleName = $null; $actionAccessibleDefaultAction = $null; ` +
      `$actionAccessibleRole = $null; $actionAccessibleState = $null; ` +
      `$actionAccessibleBlockedStateMask = $null; ` +
      `$actionAccessibleInvocationCount = 0; ` +
      `$actionAccessibleInvocationCompleted = $false; ` +
      `$actionAccessibleInterfaceReleased = $false; ` +
      `$actionProcessTimeoutMs = ${WINDOWS_ACCESSIBLE_ACTION.processTimeoutMs}; ` +
      `if ($actionMethod -eq "InvokePattern") { $selectedPattern.Invoke() } ` +
      `elseif ($actionMethod -eq "LegacyIAccessiblePattern") { ` +
      `$selectedPattern.DoDefaultAction() } ` +
      `elseif ($actionMethod -eq ${psQuote(WINDOWS_ACCESSIBLE_ACTION.method)}) { ` +
      `if ($selectedAutomationId -cne ${psQuote(String(WINDOWS_ACCESSIBLE_ACTION.controlId))}) { ` +
      `throw "patternless exact action does not expose canonical IDOK AutomationId" }; ` +
      `[int32]$parsedAutomationId = 0; ` +
      `if (-not [int32]::TryParse($selectedAutomationId, [ref]$parsedAutomationId) -or ` +
      `$parsedAutomationId -ne ${WINDOWS_ACCESSIBLE_ACTION.controlId}) { ` +
      `throw "patternless exact action AutomationId did not parse as IDOK" }; ` +
      `$actionAutomationIdParsed = $parsedAutomationId; ` +
      `if ($selectedNativeHwnd -le 0) { throw "patternless exact action has no native HWND" }; ` +
      `$actionDialogs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $titleCondition); ` +
      `if ($actionDialogs.Count -ne 1) { throw "expected one exact-title dialog before accessible action" }; ` +
      `$actionDialog = $actionDialogs.Item(0); ` +
      `$actionDialogHwnd = [int64]$actionDialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `$actionDialogEnabled = $actionDialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$actionDialogOffscreen = $actionDialog.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `if ($actionDialogHwnd -ne $observedHwnd -or $actionDialogHwnd -le 0 -or ` +
      `$actionDialogEnabled -ne $true -or $actionDialogOffscreen -ne $false) { ` +
      `throw "exact native dialog changed before accessible action" }; ` +
      `$actionDialogReverified = $true; ` +
      `$actionNameNow = [string]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty); ` +
      `$actionAutomationIdNow = [string]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty); ` +
      `$actionNativeHwndNow = [int64]$selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::NativeWindowHandleProperty); ` +
      `$actionEnabledNow = $selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsEnabledProperty); ` +
      `$actionOffscreenNow = $selectedCandidate.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::IsOffscreenProperty); ` +
      `if ($actionNameNow -cne $selectedName -or ` +
      `$actionAutomationIdNow -cne $selectedAutomationId -or ` +
      `$actionNativeHwndNow -ne $selectedNativeHwnd -or $actionEnabledNow -ne $true -or ` +
      `$actionOffscreenNow -ne $false) { throw "exact action changed before accessible action" }; ` +
      `$actionTargetReverified = $true; ` +
      `$dialogPtr = [IntPtr]$observedHwnd; $controlPtr = [IntPtr]$selectedNativeHwnd; ` +
      `$actionNativeIsWindow = [VoyalierNativeAccessibleAction]::IsWindow($controlPtr); ` +
      `if (-not $actionNativeIsWindow) { ` +
      `throw "patternless exact action native HWND is not a window" }; ` +
      `$actionNativeIsChild = [VoyalierNativeAccessibleAction]::IsChild($dialogPtr, $controlPtr); ` +
      `if (-not $actionNativeIsChild) { ` +
      `throw "patternless exact action native HWND is not a child of the dialog" }; ` +
      `$observedControlId = [VoyalierNativeAccessibleAction]::GetDlgCtrlID($controlPtr); ` +
      `if ($observedControlId -ne ${WINDOWS_ACCESSIBLE_ACTION.controlId}) { ` +
      `throw "patternless exact action native control is not IDOK" }; ` +
      `$actionNativeControlIdConfirmed = $true; $actionControlId = $observedControlId; ` +
      `$actionNativeControlBound = $true; ` +
      `$actionMsaaObjectId = [uint32]${WINDOWS_ACCESSIBLE_ACTION.objectId}; ` +
      `$actionMsaaInterfaceId = ${psQuote(WINDOWS_ACCESSIBLE_ACTION.interfaceId)}; ` +
      `$actionMsaaChildId = ${WINDOWS_ACCESSIBLE_ACTION.childId}; ` +
      `$actionAccessibleBlockedStateMask = ${WINDOWS_ACCESSIBLE_ACTION.blockedStateMask}; ` +
      `$msaaResult = [VoyalierNativeAccessibleAction]::Invoke(` +
      `$controlPtr, $action, $actionMsaaObjectId, $actionMsaaInterfaceId, ` +
      `$actionMsaaChildId, ${WINDOWS_ACCESSIBLE_ACTION.role}, ` +
      `$actionAccessibleBlockedStateMask); ` +
      `$actionMsaaHResult = $msaaResult.HResult; ` +
      `$actionMsaaInterfaceNonNull = $msaaResult.InterfaceNonNull; ` +
      `$actionMsaaWindowBindingHResult = $msaaResult.WindowBindingHResult; ` +
      `$actionMsaaBoundHwnd = $msaaResult.BoundHwnd; ` +
      `$actionAccessibleName = $msaaResult.Name; ` +
      `$actionAccessibleDefaultAction = $msaaResult.DefaultAction; ` +
      `$actionAccessibleRole = $msaaResult.Role; ` +
      `$actionAccessibleState = $msaaResult.State; ` +
      `$actionAccessibleInvocationCount = $msaaResult.InvocationCount; ` +
      `$actionAccessibleInvocationCompleted = $msaaResult.InvocationCompleted; ` +
      `$actionAccessibleInterfaceReleased = $msaaResult.InterfaceReleased; ` +
      `if ($actionMsaaHResult -ne 0 -or -not $actionMsaaInterfaceNonNull -or ` +
      `$actionMsaaWindowBindingHResult -ne 0 -or $actionMsaaBoundHwnd -ne $selectedNativeHwnd -or ` +
      `$actionAccessibleName -cne $action -or ` +
      `[string]::IsNullOrWhiteSpace($actionAccessibleDefaultAction) -or ` +
      `$actionAccessibleRole -ne ${WINDOWS_ACCESSIBLE_ACTION.role} -or ` +
      `($actionAccessibleState -band $actionAccessibleBlockedStateMask) -ne 0 -or ` +
      `$actionAccessibleInvocationCount -ne 1 -or ` +
      `-not $actionAccessibleInvocationCompleted -or -not $actionAccessibleInterfaceReleased) { ` +
      `throw "direct IAccessible action failed: $($msaaResult.ErrorType)" ` +
      `} ` +
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
      `actionControlId = $actionControlId; ` +
      `actionMsaaObjectId = $actionMsaaObjectId; ` +
      `actionMsaaInterfaceId = $actionMsaaInterfaceId; ` +
      `actionMsaaChildId = $actionMsaaChildId; ` +
      `actionMsaaHResult = $actionMsaaHResult; ` +
      `actionMsaaInterfaceNonNull = $actionMsaaInterfaceNonNull; ` +
      `actionMsaaWindowBindingHResult = $actionMsaaWindowBindingHResult; ` +
      `actionMsaaBoundHwnd = $actionMsaaBoundHwnd; ` +
      `actionAccessibleName = $actionAccessibleName; ` +
      `actionAccessibleDefaultAction = $actionAccessibleDefaultAction; ` +
      `actionAccessibleRole = $actionAccessibleRole; ` +
      `actionAccessibleState = $actionAccessibleState; ` +
      `actionAccessibleBlockedStateMask = $actionAccessibleBlockedStateMask; ` +
      `actionAccessibleInvocationCount = $actionAccessibleInvocationCount; ` +
      `actionAccessibleInvocationCompleted = $actionAccessibleInvocationCompleted; ` +
      `actionAccessibleInterfaceReleased = $actionAccessibleInterfaceReleased; ` +
      `actionProcessTimeoutMs = $actionProcessTimeoutMs; ` +
      `inputInjectionUsed = $false; ` +
      `actionInvoked = $true; dialogDismissed = $true; hwnd = $observedHwnd } ` +
      `| ConvertTo-Json -Compress; exit 0 ` +
      `}; ` +
      `Start-Sleep -Milliseconds 200 ` +
      `} while ((Get-Date) -lt $deadline); ` +
      `throw "native dialog did not dismiss (remaining $remaining)"`,
    WINDOWS_ACCESSIBLE_ACTION.processTimeoutMs,
  );
}

export async function driveNativeFileDialog({
  title,
  filePath,
  action,
  temporaryRoot,
  diagnosticPath,
  presetMethod,
}) {
  title = requireString(title, "title");
  filePath = path.resolve(requireString(filePath, "filePath"));
  temporaryRoot = path.resolve(requireString(temporaryRoot, "temporaryRoot"));
  assert.ok(["Save", "Open"].includes(action));
  assert.ok(path.isAbsolute(filePath));
  assert.ok(isInside(temporaryRoot, filePath));
  assert.ok(
    [
      "System.Windows.Forms.SaveFileDialog.InitialDirectory+FileName",
      "rfd::FileDialog::set_directory+set_file_name",
    ].includes(presetMethod),
  );
  const expectedValueToken = `<DIALOG_TEMP>${path.sep}${path.relative(
    temporaryRoot,
    filePath,
  )}`;

  const record = {
    verdict: "FAIL",
    title,
    action,
    expectedValueToken,
    expectedPathSha256: sha256Text(filePath),
    filenameHostAutomationId: FILE_NAME_HOST_AUTOMATION_ID,
    presetMethod,
    pathPresetExpected: true,
    externalSetterUsed: false,
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
    assert.equal(observed.hostAutomationId, FILE_NAME_HOST_AUTOMATION_ID);
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
        WINDOWS_ACCESSIBLE_ACTION.method,
      ].includes(invoked.result?.actionMethod),
    );
    assert.equal(invoked.result?.dialogCountBefore, 1);
    assert.equal(invoked.result?.dialogCountAfter, 0);
    assert.equal(invoked.result?.inputInjectionUsed, false);
    if (invoked.result.actionMethod === WINDOWS_ACCESSIBLE_ACTION.method) {
      assert.equal(invoked.result.invokePatternAvailable, false);
      assert.equal(invoked.result.legacyPatternAvailable, false);
      assert.equal(
        invoked.result.actionAutomationId,
        String(WINDOWS_ACCESSIBLE_ACTION.controlId),
      );
      assert.equal(
        invoked.result.actionAutomationIdParsed,
        WINDOWS_ACCESSIBLE_ACTION.controlId,
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
        invoked.result.actionControlId,
        WINDOWS_ACCESSIBLE_ACTION.controlId,
      );
      assert.equal(
        invoked.result.actionMsaaObjectId,
        WINDOWS_ACCESSIBLE_ACTION.objectId,
      );
      assert.equal(
        invoked.result.actionMsaaInterfaceId,
        WINDOWS_ACCESSIBLE_ACTION.interfaceId,
      );
      assert.equal(
        invoked.result.actionMsaaChildId,
        WINDOWS_ACCESSIBLE_ACTION.childId,
      );
      assert.equal(invoked.result.actionMsaaHResult, 0);
      assert.equal(invoked.result.actionMsaaInterfaceNonNull, true);
      assert.equal(invoked.result.actionMsaaWindowBindingHResult, 0);
      assert.equal(
        invoked.result.actionMsaaBoundHwnd,
        invoked.result.actionNativeControlHwnd,
      );
      assert.equal(invoked.result.actionAccessibleName, action);
      assert.equal(
        typeof invoked.result.actionAccessibleDefaultAction,
        "string",
      );
      assert.notEqual(invoked.result.actionAccessibleDefaultAction.trim(), "");
      assert.equal(
        invoked.result.actionAccessibleRole,
        WINDOWS_ACCESSIBLE_ACTION.role,
      );
      assert.ok(Number.isInteger(invoked.result.actionAccessibleState));
      assert.equal(
        invoked.result.actionAccessibleState &
          WINDOWS_ACCESSIBLE_ACTION.blockedStateMask,
        0,
      );
      assert.equal(
        invoked.result.actionAccessibleBlockedStateMask,
        WINDOWS_ACCESSIBLE_ACTION.blockedStateMask,
      );
      assert.equal(invoked.result.actionAccessibleInvocationCount, 1);
      assert.equal(invoked.result.actionAccessibleInvocationCompleted, true);
      assert.equal(invoked.result.actionAccessibleInterfaceReleased, true);
      assert.equal(
        invoked.result.actionProcessTimeoutMs,
        WINDOWS_ACCESSIBLE_ACTION.processTimeoutMs,
      );
    } else if (invoked.result.actionMethod === "InvokePattern") {
      assert.equal(invoked.result.invokePatternAvailable, true);
      assert.equal(invoked.result.legacyPatternAvailable, false);
      assert.equal(invoked.result.actionAccessibleInvocationCount, 0);
    } else {
      assert.equal(invoked.result.invokePatternAvailable, false);
      assert.equal(invoked.result.legacyPatternAvailable, true);
      assert.equal(invoked.result.actionAccessibleInvocationCount, 0);
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
      actionControlId: invoked.result.actionControlId,
      actionMsaaObjectId: invoked.result.actionMsaaObjectId,
      actionMsaaInterfaceId: invoked.result.actionMsaaInterfaceId,
      actionMsaaChildId: invoked.result.actionMsaaChildId,
      actionMsaaHResult: invoked.result.actionMsaaHResult,
      actionMsaaInterfaceNonNull: invoked.result.actionMsaaInterfaceNonNull,
      actionMsaaWindowBindingHResult:
        invoked.result.actionMsaaWindowBindingHResult,
      actionMsaaBoundHwnd: invoked.result.actionMsaaBoundHwnd,
      actionAccessibleName: invoked.result.actionAccessibleName,
      actionAccessibleDefaultAction:
        invoked.result.actionAccessibleDefaultAction,
      actionAccessibleRole: invoked.result.actionAccessibleRole,
      actionAccessibleState: invoked.result.actionAccessibleState,
      actionAccessibleBlockedStateMask:
        invoked.result.actionAccessibleBlockedStateMask,
      actionAccessibleInvocationCount:
        invoked.result.actionAccessibleInvocationCount,
      actionAccessibleInvocationCompleted:
        invoked.result.actionAccessibleInvocationCompleted,
      actionAccessibleInterfaceReleased:
        invoked.result.actionAccessibleInterfaceReleased,
      actionProcessTimeoutMs: invoked.result.actionProcessTimeoutMs,
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
      process.env,
    );
    if (error?.commandEvidence) record.failedCommand = error.commandEvidence;
    writeDiagnostic(diagnosticPath, record);
    const safeError = new Error(record.error);
    if (record.failedCommand) {
      safeError.commandEvidence = sanitizeWindowsEvidenceValue(
        record.failedCommand,
        process.env,
      );
    }
    throw safeError;
  }
}

export function pathIsInside(parent, candidate) {
  return isInside(parent, candidate);
}
