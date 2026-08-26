import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertNoAbsoluteWindowsPaths,
  driveNativeFileDialog,
  pathIsInside,
  sanitizeWindowsEvidenceText,
  sanitizeWindowsEvidenceValue,
} from "./windows-native-file-dialog.mjs";
import { validateWindowsPickerPreflightReport } from "./windows-updater-fixture.mjs";

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
}) {
  const script =
    `$ErrorActionPreference = 'Stop'; ` +
    `Add-Type -AssemblyName System.Windows.Forms; ` +
    `function Get-VoyalierHash([string]$value) { ` +
    `$bytes = [System.Text.Encoding]::UTF8.GetBytes($value); ` +
    `$sha = [System.Security.Cryptography.SHA256]::Create(); ` +
    `try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } ` +
    `finally { $sha.Dispose() } ` +
    `}; ` +
    `$expected = ${psQuote(expectedPath)}; ` +
    `$temporaryRoot = ${psQuote(temporaryRoot)}; ` +
    `$dialog = [System.Windows.Forms.SaveFileDialog]::new(); ` +
    `$dialog.Title = ${psQuote(title)}; ` +
    `$dialog.InitialDirectory = ${psQuote(path.dirname(expectedPath))}; ` +
    `$dialog.FileName = ${psQuote(path.basename(expectedPath))}; ` +
    `$dialog.Filter = 'Text files (*.txt)|*.txt'; ` +
    `$dialog.AddExtension = $true; $dialog.OverwritePrompt = $false; ` +
    `$result = $dialog.ShowDialog(); ` +
    `if ($result -ne [System.Windows.Forms.DialogResult]::OK) { ` +
    `throw "preflight dialog returned $result" }; ` +
    `$expectedCanonical = [System.IO.Path]::GetFullPath($expected); ` +
    `$selectedCanonical = [System.IO.Path]::GetFullPath($dialog.FileName); ` +
    `$separators = [char[]]@([System.IO.Path]::DirectorySeparatorChar, ` +
    `[System.IO.Path]::AltDirectorySeparatorChar); ` +
    `$rootCanonical = [System.IO.Path]::GetFullPath($temporaryRoot).TrimEnd($separators); ` +
    `$rootPrefix = $rootCanonical + [System.IO.Path]::DirectorySeparatorChar; ` +
    `$expectedWithin = $expectedCanonical.StartsWith($rootPrefix, ` +
    `[System.StringComparison]::OrdinalIgnoreCase); ` +
    `$selectedWithin = $selectedCanonical.StartsWith($rootPrefix, ` +
    `[System.StringComparison]::OrdinalIgnoreCase); ` +
    `$canonicalOrdinalIgnoreCaseEqual = [string]::Equals($selectedCanonical, ` +
    `$expectedCanonical, [System.StringComparison]::OrdinalIgnoreCase); ` +
    `if (-not $expectedWithin -or -not $selectedWithin -or ` +
    `-not $canonicalOrdinalIgnoreCaseEqual) { ` +
    `throw 'preflight selected path mismatch' }; ` +
    `$encoding = [System.Text.UTF8Encoding]::new($false); ` +
    `[System.IO.File]::WriteAllText($selectedCanonical, ${psQuote(markerContent)}, $encoding); ` +
    `@{ result = $result.ToString(); ` +
    `expectedCanonicalSha256 = $(Get-VoyalierHash $expectedCanonical); ` +
    `selectedCanonicalSha256 = $(Get-VoyalierHash $selectedCanonical); ` +
    `canonicalOrdinalIgnoreCaseEqual = $canonicalOrdinalIgnoreCaseEqual; ` +
    `expectedWithinTemporaryRoot = $expectedWithin; ` +
    `selectedWithinTemporaryRoot = $selectedWithin; ` +
    `writeAttempted = $true; markerExists = $true } ` +
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
  const title = `Voyalier picker bridge preflight ${nonce}`;
  assert.ok(pathIsInside(runnerTemp, preflightRoot));
  assert.ok(pathIsInside(preflightRoot, markerPath));
  await mkdir(preflightRoot, { recursive: true });
  const report = {
    verdict: "FAIL",
    stage: "standard-save-dialog",
    proofKind: "harness-native-dialog-action",
    productEvidence: false,
    diagnosticOnly: false,
    candidateSha: gitHead(),
    workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  };
  let dialogProcess;
  try {
    dialogProcess = startStandardSaveDialog({
      title,
      expectedPath: markerPath,
      markerContent,
      temporaryRoot: preflightRoot,
    });
    report.dialog = await driveNativeFileDialog({
      title,
      filePath: markerPath,
      action: "Save",
      temporaryRoot: preflightRoot,
      presetMethod:
        "System.Windows.Forms.SaveFileDialog.InitialDirectory+FileName",
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
    assert.equal(dialogResult.stderr, "", "standard dialog host wrote stderr");
    const hostResult = JSON.parse(dialogResult.stdout);
    report.dialogHost.jsonParsed = true;
    report.dialogHost.result = hostResult;
    assert.equal(hostResult.result, "OK");
    assert.equal(hostResult.canonicalOrdinalIgnoreCaseEqual, true);
    assert.equal(hostResult.expectedWithinTemporaryRoot, true);
    assert.equal(hostResult.selectedWithinTemporaryRoot, true);
    assert.equal(
      hostResult.expectedCanonicalSha256,
      hostResult.selectedCanonicalSha256,
    );
    assert.equal(hostResult.writeAttempted, true);
    assert.equal(hostResult.markerExists, true);
    const markerStat = await stat(markerPath);
    const observedContent = await readFile(markerPath, "utf8");
    assert.equal(observedContent, markerContent);
    report.marker = {
      fileName: path.basename(markerPath),
      selectedPathToken: report.dialog.expectedValueToken,
      selectedPathWithinTemporaryRoot: true,
      bytes: markerStat.size,
      sha256: await sha256(markerPath),
      expectedSha256: createHash("sha256").update(markerContent).digest("hex"),
      contentConfirmed: true,
      hostReturnedExactPath: true,
    };
    assert.equal(report.marker.sha256, report.marker.expectedSha256);
    await rm(markerPath, { force: true });
    report.marker.removed = true;
    await rm(preflightRoot, { recursive: true, force: true });
    report.temporaryRootRemoved = true;
    report.stage = "complete";
    report.verdict = "PASS";
    validateWindowsPickerPreflightReport(report, {
      candidateSha: report.candidateSha,
      workflowRunId: report.workflowRunId,
    });
    assertNoAbsoluteWindowsPaths(report);
    await writeFile(PREFLIGHT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
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
