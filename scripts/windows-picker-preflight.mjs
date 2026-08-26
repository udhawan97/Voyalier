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

function startStandardSaveDialog({ title, expectedPath, markerContent }) {
  const script =
    `Add-Type -AssemblyName System.Windows.Forms; ` +
    `$expected = ${psQuote(expectedPath)}; ` +
    `$dialog = [System.Windows.Forms.SaveFileDialog]::new(); ` +
    `$dialog.Title = ${psQuote(title)}; ` +
    `$dialog.InitialDirectory = ${psQuote(path.dirname(expectedPath))}; ` +
    `$dialog.FileName = 'picker-preflight-placeholder.txt'; ` +
    `$dialog.Filter = 'Text files (*.txt)|*.txt'; ` +
    `$dialog.AddExtension = $true; $dialog.OverwritePrompt = $false; ` +
    `$result = $dialog.ShowDialog(); ` +
    `if ($result -ne [System.Windows.Forms.DialogResult]::OK) { ` +
    `throw "preflight dialog returned $result" }; ` +
    `if ($dialog.FileName -cne $expected) { throw 'preflight selected path mismatch' }; ` +
    `$encoding = [System.Text.UTF8Encoding]::new($false); ` +
    `[System.IO.File]::WriteAllText($dialog.FileName, ${psQuote(markerContent)}, $encoding); ` +
    `@{ result = $result.ToString(); selectedPath = $dialog.FileName } ` +
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
    stage: "tool-provenance",
    proofKind: "harness-tool-compatibility",
    productEvidence: false,
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
    report.dialogHost.result = {
      result: hostResult.result,
      selectedPathToken: report.dialog.expectedValueToken,
    };
    assert.equal(hostResult.result, "OK");
    assert.equal(hostResult.selectedPath, markerPath);
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
    throw error;
  }
}

await main();
