import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertNoAbsoluteWindowsPaths,
  sanitizeWindowsEvidenceText,
  sanitizeWindowsEvidenceValue,
} from "./windows-native-file-dialog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_ROOT = path.join(ROOT, "windows-acceptance-evidence");
const TEXT_FILES = new Set([
  "sanitization.json",
  "summary.md",
  "tauri-driver-base.log",
  "tauri-driver-recovery.log",
  "tauri-driver-updated.log",
  "windows-installed-updater.json",
  "windows-picker-preflight-dialog.json",
  "windows-picker-preflight.json",
  "windows-portable-backup-dialog.json",
  "windows-portable-restore-dialog.json",
]);
const PNG_FILES = new Set([
  "01-base-installed-product-journey.png",
  "02-base-production-updater-ready.png",
  "03-updated-product-journey.png",
  "04-portable-backup-exported.png",
  "05-portable-restore-staged.png",
  "06-reinstall-restore-recovery.png",
  "99-failure.png",
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function classifyWindowsEvidenceArtifact(relativePath) {
  const normalized = String(relativePath).replaceAll("\\", "/");
  assert.equal(path.posix.basename(normalized), normalized);
  if (TEXT_FILES.has(normalized)) return "text";
  if (PNG_FILES.has(normalized)) return "png";
  throw new Error(`unclassified Windows acceptance artifact: ${normalized}`);
}

async function evidenceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await evidenceFiles(candidate)));
    else if (entry.isFile()) files.push(candidate);
    else throw new Error(`unsupported evidence entry: ${candidate}`);
  }
  return files;
}

export async function sanitizeWindowsAcceptanceEvidence(
  evidenceRoot = EVIDENCE_ROOT,
) {
  await mkdir(evidenceRoot, { recursive: true });
  const files = await evidenceFiles(evidenceRoot);
  const sanitized = [];
  const validatedPngs = [];
  for (const file of files) {
    const relative = path.relative(evidenceRoot, file).replaceAll("\\", "/");
    const kind = classifyWindowsEvidenceArtifact(relative);
    if (relative === "sanitization.json") continue;
    if (kind === "png") {
      const source = await readFile(file);
      assert.ok(
        source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
        `${relative} is not a PNG`,
      );
      validatedPngs.push(relative);
      continue;
    }
    const source = await readFile(file, "utf8");
    let output;
    if (path.extname(file).toLowerCase() === ".json") {
      output = `${JSON.stringify(
        sanitizeWindowsEvidenceValue(JSON.parse(source)),
        null,
        2,
      )}\n`;
      assertNoAbsoluteWindowsPaths(JSON.parse(output));
    } else {
      output = sanitizeWindowsEvidenceText(source);
      assertNoAbsoluteWindowsPaths(output);
    }
    await writeFile(file, output);
    sanitized.push(relative);
  }
  const report = {
    verdict: "PASS",
    absoluteWindowsPathsRejected: true,
    everyArtifactClassified: true,
    textFilesSanitized: sanitized.sort(),
    pngFilesSignatureValidated: validatedPngs.sort(),
  };
  assertNoAbsoluteWindowsPaths(report);
  await writeFile(
    path.join(evidenceRoot, "sanitization.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await sanitizeWindowsAcceptanceEvidence();
}
