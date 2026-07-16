#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const bundleDir = process.argv[2];
const outputPath = process.argv[3];
if (!bundleDir || !outputPath) {
  throw new Error("usage: write-release-checksums.mjs BUNDLE_DIR OUTPUT_PATH");
}

const releaseAsset = /(?:\.dmg|\.app\.tar\.gz|-setup\.exe|\.msi|\.sig)$/;

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
    }),
  );
  return nested.flat();
}

const files = (await filesBelow(bundleDir))
  .filter((file) => releaseAsset.test(file))
  .sort((left, right) => left.localeCompare(right));
if (files.length === 0)
  throw new Error(`no release assets found in ${bundleDir}`);

const lines = await Promise.all(
  files.map(async (file) => {
    const digest = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    return `${digest}  ${path.relative(bundleDir, file).split(path.sep).join("/")}`;
  }),
);
await writeFile(outputPath, `${lines.join("\n")}\n`);
