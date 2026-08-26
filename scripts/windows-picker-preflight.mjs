import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertNoAbsoluteWindowsPaths,
  driveNativeFileDialog,
  loadVerifiedWinAppTool,
  pathIsInside,
  sanitizeWindowsEvidenceText,
  sanitizeWindowsEvidenceValue,
} from "./windows-native-file-dialog.mjs";
import { validateWindowsPickerDiagnosticReport } from "./windows-updater-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ROOT = path.join(ROOT, "windows-acceptance-evidence");
const PREFLIGHT_REPORT = path.join(
  EVIDENCE_ROOT,
  "windows-picker-preflight.json",
);

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function gitHead() {
  const result = spawnSync("git.exe", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function startStandardSaveDialog({
  title,
  expectedPath,
  markerContent,
  temporaryRoot,
  placeholderFileName,
}) {
  const script =
    `Add-Type -AssemblyName System.Windows.Forms; ` +
    `function Get-VoyalierHash([string]$value) { ` +
    `$bytes = [System.Text.Encoding]::UTF8.GetBytes($value); ` +
    `$sha = [System.Security.Cryptography.SHA256]::Create(); ` +
    `try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } ` +
    `finally { $sha.Dispose() } ` +
    `}; ` +
    `function Get-VoyalierOptionalHash($value) { ` +
    `if ($null -eq $value) { return $null }; return (Get-VoyalierHash $value) ` +
    `}; ` +
    `function Get-VoyalierFoldedHash($value) { ` +
    `if ($null -eq $value) { return $null }; ` +
    `return (Get-VoyalierHash ($value.ToUpperInvariant())) ` +
    `}; ` +
    `$expected = ${psQuote(expectedPath)}; ` +
    `$temporaryRoot = ${psQuote(temporaryRoot)}; ` +
    `$placeholderFileName = ${psQuote(placeholderFileName)}; ` +
    `$placeholder = [System.IO.Path]::Combine($temporaryRoot, $placeholderFileName); ` +
    `$dialog = [System.Windows.Forms.SaveFileDialog]::new(); ` +
    `$dialog.Title = ${psQuote(title)}; ` +
    `$dialog.InitialDirectory = ${psQuote(path.dirname(expectedPath))}; ` +
    `$dialog.FileName = $placeholderFileName; ` +
    `$dialog.Filter = 'Text files (*.txt)|*.txt'; ` +
    `$dialog.AddExtension = $true; $dialog.OverwritePrompt = $false; ` +
    `$result = $dialog.ShowDialog(); ` +
    `$selected = $dialog.FileName; ` +
    `$expectedCanonical = $null; $selectedCanonical = $null; $placeholderCanonical = $null; ` +
    `$expectedCanonicalized = $false; $selectedCanonicalized = $false; ` +
    `$placeholderCanonicalized = $false; ` +
    `try { $expectedCanonical = [System.IO.Path]::GetFullPath($expected); ` +
    `$expectedCanonicalized = $true } catch {}; ` +
    `try { $selectedCanonical = [System.IO.Path]::GetFullPath($selected); ` +
    `$selectedCanonicalized = $true } catch {}; ` +
    `try { $placeholderCanonical = [System.IO.Path]::GetFullPath($placeholder); ` +
    `$placeholderCanonicalized = $true } catch {}; ` +
    `$rootCanonical = [System.IO.Path]::GetFullPath($temporaryRoot).TrimEnd([char[]]@('\', '/')); ` +
    `$rootPrefix = $rootCanonical + [System.IO.Path]::DirectorySeparatorChar; ` +
    `$expectedWithin = $expectedCanonicalized -and ` +
    `$expectedCanonical.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase); ` +
    `$selectedWithin = $selectedCanonicalized -and ` +
    `$selectedCanonical.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase); ` +
    `$selectedRelativeToken = $null; ` +
    `if ($selectedWithin) { ` +
    `$relative = $selectedCanonical.Substring($rootPrefix.Length).Replace('/', '\'); ` +
    `$selectedRelativeToken = ${psQuote("<DIALOG_TEMP>\\")} + $relative ` +
    `}; ` +
    `$rawOrdinalEqual = [string]::Equals($selected, $expected, ` +
    `[System.StringComparison]::Ordinal); ` +
    `$rawOrdinalIgnoreCaseEqual = [string]::Equals($selected, $expected, ` +
    `[System.StringComparison]::OrdinalIgnoreCase); ` +
    `$canonicalOrdinalIgnoreCaseEqual = $expectedCanonicalized -and ` +
    `$selectedCanonicalized -and [string]::Equals($selectedCanonical, ` +
    `$expectedCanonical, [System.StringComparison]::OrdinalIgnoreCase); ` +
    `$selectedEqualsPlaceholderRawOrdinal = [string]::Equals($selected, $placeholder, ` +
    `[System.StringComparison]::Ordinal); ` +
    `$selectedEqualsPlaceholderRawOrdinalIgnoreCase = [string]::Equals($selected, $placeholder, ` +
    `[System.StringComparison]::OrdinalIgnoreCase); ` +
    `$selectedEqualsPlaceholderCanonicalIgnoreCase = $selectedCanonicalized -and ` +
    `$placeholderCanonicalized -and [string]::Equals($selectedCanonical, ` +
    `$placeholderCanonical, [System.StringComparison]::OrdinalIgnoreCase); ` +
    `$selectedBaseName = ''; ` +
    `try { $selectedBaseName = [string][System.IO.Path]::GetFileName($selected) } catch {}; ` +
    `$targetBaseName = [System.IO.Path]::GetFileName($expected); ` +
    `$selectedBaseNameKind = if ([string]::Equals($selectedBaseName, $targetBaseName, ` +
    `[System.StringComparison]::Ordinal)) { 'target' } elseif (` +
    `[string]::Equals($selectedBaseName, $placeholderFileName, ` +
    `[System.StringComparison]::Ordinal)) { 'placeholder' } else { 'other' }; ` +
    `$disclosedBaseName = if ($selectedBaseNameKind -eq 'other') { $null } else { $selectedBaseName }; ` +
    `$expectedRawSha256 = Get-VoyalierHash $expected; ` +
    `$selectedRawSha256 = Get-VoyalierHash $selected; ` +
    `$placeholderRawSha256 = Get-VoyalierHash $placeholder; ` +
    `$expectedRawCaseFoldedSha256 = Get-VoyalierFoldedHash $expected; ` +
    `$selectedRawCaseFoldedSha256 = Get-VoyalierFoldedHash $selected; ` +
    `$placeholderRawCaseFoldedSha256 = Get-VoyalierFoldedHash $placeholder; ` +
    `$expectedCanonicalSha256 = Get-VoyalierOptionalHash $expectedCanonical; ` +
    `$selectedCanonicalSha256 = Get-VoyalierOptionalHash $selectedCanonical; ` +
    `$placeholderCanonicalSha256 = Get-VoyalierOptionalHash $placeholderCanonical; ` +
    `$expectedCanonicalCaseFoldedSha256 = Get-VoyalierFoldedHash $expectedCanonical; ` +
    `$selectedCanonicalCaseFoldedSha256 = Get-VoyalierFoldedHash $selectedCanonical; ` +
    `$placeholderCanonicalCaseFoldedSha256 = Get-VoyalierFoldedHash $placeholderCanonical; ` +
    `$writeGatePassed = $result -eq [System.Windows.Forms.DialogResult]::OK -and ` +
    `$canonicalOrdinalIgnoreCaseEqual -and $expectedWithin -and $selectedWithin; ` +
    `$writeAttempted = $false; ` +
    `if ($writeGatePassed) { ` +
    `$writeAttempted = $true; $encoding = [System.Text.UTF8Encoding]::new($false); ` +
    `[System.IO.File]::WriteAllText($selectedCanonical, ${psQuote(markerContent)}, $encoding) ` +
    `}; ` +
    `$markerExists = [System.IO.File]::Exists($expectedCanonical); ` +
    `@{ diagnosticOnly = $true; hashEncoding = 'UTF-8'; result = $result.ToString(); ` +
    `expectedRawSha256 = $expectedRawSha256; selectedRawSha256 = $selectedRawSha256; ` +
    `placeholderRawSha256 = $placeholderRawSha256; ` +
    `expectedRawCaseFoldedSha256 = $expectedRawCaseFoldedSha256; ` +
    `selectedRawCaseFoldedSha256 = $selectedRawCaseFoldedSha256; ` +
    `placeholderRawCaseFoldedSha256 = $placeholderRawCaseFoldedSha256; ` +
    `expectedCanonicalized = $expectedCanonicalized; selectedCanonicalized = $selectedCanonicalized; ` +
    `placeholderCanonicalized = $placeholderCanonicalized; ` +
    `expectedCanonicalSha256 = $expectedCanonicalSha256; ` +
    `selectedCanonicalSha256 = $selectedCanonicalSha256; ` +
    `placeholderCanonicalSha256 = $placeholderCanonicalSha256; ` +
    `expectedCanonicalCaseFoldedSha256 = $expectedCanonicalCaseFoldedSha256; ` +
    `selectedCanonicalCaseFoldedSha256 = $selectedCanonicalCaseFoldedSha256; ` +
    `placeholderCanonicalCaseFoldedSha256 = $placeholderCanonicalCaseFoldedSha256; ` +
    `rawOrdinalEqual = $rawOrdinalEqual; rawOrdinalIgnoreCaseEqual = $rawOrdinalIgnoreCaseEqual; ` +
    `canonicalOrdinalIgnoreCaseEqual = $canonicalOrdinalIgnoreCaseEqual; ` +
    `selectedEqualsPlaceholderRawOrdinal = $selectedEqualsPlaceholderRawOrdinal; ` +
    `selectedEqualsPlaceholderRawOrdinalIgnoreCase = $selectedEqualsPlaceholderRawOrdinalIgnoreCase; ` +
    `selectedEqualsPlaceholderCanonicalIgnoreCase = $selectedEqualsPlaceholderCanonicalIgnoreCase; ` +
    `expectedWithinTemporaryRoot = $expectedWithin; selectedWithinTemporaryRoot = $selectedWithin; ` +
    `selectedRelativeToken = $selectedRelativeToken; selectedBaseNameKind = $selectedBaseNameKind; ` +
    `selectedBaseName = $disclosedBaseName; selectedBaseNameSha256 = $(Get-VoyalierHash $selectedBaseName); ` +
    `selectedBaseNameLength = $selectedBaseName.Length; ` +
    `selectedExtension = [System.IO.Path]::GetExtension($selectedBaseName); ` +
    `writeGatePassed = $writeGatePassed; writeAttempted = $writeAttempted; ` +
    `markerExists = $markerExists } ` +
    `| ConvertTo-Json -Compress`;
  const child = spawn(
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
    { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
  return { child, completion };
}

async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

async function withTimeout(promise, timeoutMs, description) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`timed out waiting for ${description}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  assert.equal(process.platform, "win32", "picker preflight requires Windows");
  const runnerTemp = path.resolve(process.env.RUNNER_TEMP ?? "");
  assert.ok(path.isAbsolute(runnerTemp));
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  const nonce = randomBytes(12).toString("hex");
  const preflightRoot = path.join(
    runnerTemp,
    `voyalier-picker-preflight-${process.pid}-${nonce}`,
  );
  const markerPath = path.join(
    preflightRoot,
    `voyalier-picker-preflight-${nonce}.txt`,
  );
  const markerContent = `Voyalier native picker bridge ${nonce}\n`;
  const placeholderFileName = "picker-preflight-placeholder.txt";
  const title = `Voyalier picker bridge preflight ${nonce}`;
  assert.ok(pathIsInside(runnerTemp, preflightRoot));
  assert.ok(pathIsInside(preflightRoot, markerPath));
  await mkdir(preflightRoot, { recursive: true });
  const report = {
    verdict: "FAIL",
    stage: "tool-provenance",
    proofKind: "harness-tool-compatibility",
    productEvidence: false,
    diagnosticOnly: true,
    candidateSha: gitHead(),
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  };
  let dialogProcess;
  try {
    const tool = await loadVerifiedWinAppTool();
    report.tool = tool.evidence;
    report.stage = "standard-save-dialog";
    dialogProcess = startStandardSaveDialog({
      title,
      expectedPath: markerPath,
      markerContent,
      temporaryRoot: preflightRoot,
      placeholderFileName,
    });
    report.dialog = await driveNativeFileDialog({
      tool,
      title,
      filePath: markerPath,
      action: "Save",
      temporaryRoot: preflightRoot,
      diagnosticPath: path.join(
        EVIDENCE_ROOT,
        "windows-picker-preflight-dialog.json",
      ),
    });
    const dialogResult = await withTimeout(
      dialogProcess.completion,
      30_000,
      "standard SaveFileDialog host",
    );
    report.dialogHost = {
      exitCode: dialogResult.code,
      stdoutOmitted: true,
      stdoutSha256: createHash("sha256")
        .update(dialogResult.stdout)
        .digest("hex"),
      stderr: sanitizeWindowsEvidenceText(dialogResult.stderr).slice(-4_000),
    };
    assert.equal(
      dialogResult.code,
      0,
      dialogResult.stderr || dialogResult.stdout,
    );
    const hostResult = JSON.parse(dialogResult.stdout);
    report.dialogHost.jsonParsed = true;
    const pathDiagnostics = {
      ...hostResult,
      dialogResult: hostResult.result,
      cliReadbackRawSha256: report.dialog.observedValueSha256,
      readbackEqualsExpected:
        report.dialog.expectedPathSha256 === report.dialog.observedValueSha256,
      selectedEqualsReadback:
        hostResult.selectedRawSha256 === report.dialog.observedValueSha256,
    };
    delete pathDiagnostics.result;
    report.pathDiagnostics = pathDiagnostics;
    report.dialogHost.result = pathDiagnostics;
    const markerStat = await stat(markerPath).catch(() => null);
    assert.equal(markerStat != null, pathDiagnostics.markerExists);
    let observedContent = null;
    if (markerStat) observedContent = await readFile(markerPath, "utf8");
    if (pathDiagnostics.writeAttempted)
      assert.equal(observedContent, markerContent);
    report.marker = {
      existsBeforeCleanup: markerStat != null,
      contentConfirmed: observedContent === markerContent,
      bytes: markerStat?.size ?? 0,
      sha256: markerStat ? await sha256(markerPath) : null,
      expectedSha256: createHash("sha256").update(markerContent).digest("hex"),
    };
    if (pathDiagnostics.writeAttempted) {
      assert.equal(report.marker.sha256, report.marker.expectedSha256);
    }
    await rm(markerPath, { force: true });
    await rm(preflightRoot, { recursive: true, force: true });
    report.marker.removed = true;
    report.temporaryRootRemoved = true;
    report.diagnosticOutcome = !pathDiagnostics.selectedCanonicalized
      ? "uncanonicalizable"
      : !pathDiagnostics.selectedWithinTemporaryRoot
        ? pathDiagnostics.selectedBaseNameKind === "placeholder"
          ? "outside-temp-placeholder"
          : "outside-temp"
        : pathDiagnostics.canonicalOrdinalIgnoreCaseEqual
          ? "canonical-equal"
          : pathDiagnostics.selectedEqualsPlaceholderCanonicalIgnoreCase
            ? "placeholder"
            : "transformed";
    report.stage = "diagnostic-complete";
    validateWindowsPickerDiagnosticReport(report, {
      candidateSha: report.candidateSha,
      workflowRunId: report.workflowRunId,
    });
    assertNoAbsoluteWindowsPaths(report);
    throw new Error(
      `diagnostic-only picker preflight completed: ${report.diagnosticOutcome}`,
    );
  } catch (error) {
    report.error = sanitizeWindowsEvidenceText(
      error instanceof Error ? error.message : String(error),
    );
    if (dialogProcess?.child.exitCode === null) dialogProcess.child.kill();
    await rm(markerPath, { force: true }).catch(() => {});
    await rm(preflightRoot, { recursive: true, force: true }).catch(() => {});
    const sanitizedReport = sanitizeWindowsEvidenceValue(report);
    assertNoAbsoluteWindowsPaths(sanitizedReport);
    await writeFile(
      PREFLIGHT_REPORT,
      `${JSON.stringify(sanitizedReport, null, 2)}\n`,
    );
    throw new Error(report.error);
  }
}

try {
  await main();
} catch (error) {
  const message = sanitizeWindowsEvidenceText(
    error instanceof Error ? error.message : String(error),
  )
    .replace(/\s+/g, " ")
    .trim();
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
