#!/usr/bin/env node
// Build one deterministic per-pack PMTiles basemap extract, verify it, and add
// its provenance + integrity metadata to that pack's JSON and the pack manifest.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const OUT_DIR = process.env.OUT_DIR ?? "dist/packs";
const PACK_ID = process.env.OFFLINE_MAP_PACK_ID ?? "us-nashville";
const PROTOMAPS_BUILD = process.env.PROTOMAPS_BUILD ?? "20260715";
const PMTILES_BIN = process.env.PMTILES_BIN ?? "pmtiles";
const MAX_BYTES = 128 * 1024 * 1024;

if (!/^[a-z0-9-]+$/.test(PACK_ID)) {
  throw new Error(`Refusing unsafe OFFLINE_MAP_PACK_ID: ${PACK_ID}`);
}
if (!/^\d{8}$/.test(PROTOMAPS_BUILD)) {
  throw new Error(`Refusing unsafe PROTOMAPS_BUILD: ${PROTOMAPS_BUILD}`);
}

async function main() {
  const catalogPath = process.argv[2] ?? "catalog.json";
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const pack = catalog.find((candidate) => candidate.id === PACK_ID);
  if (!pack) throw new Error(`Unknown pack id: ${PACK_ID}`);

  const bbox = pack.bbox;
  const bounds = [bbox.west, bbox.south, bbox.east, bbox.north];
  if (!bounds.every(Number.isFinite)) {
    throw new Error(`Invalid bbox for ${PACK_ID}`);
  }

  const sourceUrl = `https://build.protomaps.com/${PROTOMAPS_BUILD}.pmtiles`;
  const assetName = `${PACK_ID}.pmtiles`;
  const archivePath = path.join(OUT_DIR, assetName);
  await run(PMTILES_BIN, [
    "extract",
    sourceUrl,
    archivePath,
    `--bbox=${bounds.join(",")}`,
    "--maxzoom=15",
  ]);
  await run(PMTILES_BIN, ["verify", archivePath]);
  const { stdout } = await run(PMTILES_BIN, [
    "show",
    archivePath,
    "--header-json",
  ]);
  const header = JSON.parse(stdout);
  if (header.tile_type !== "mvt" || header.maxzoom > 15) {
    throw new Error(`Unexpected PMTiles header for ${PACK_ID}`);
  }

  const bytes = await readFile(archivePath);
  const byteLength = (await stat(archivePath)).size;
  if (byteLength === 0 || byteLength > MAX_BYTES) {
    throw new Error(
      `Offline map for ${PACK_ID} is ${byteLength} bytes; limit is ${MAX_BYTES}`,
    );
  }
  const descriptor = {
    assetName,
    byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceName: "Protomaps Basemap",
    sourceUrl,
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    fetchedAt: new Date().toISOString(),
    minZoom: header.minzoom,
    maxZoom: header.maxzoom,
  };

  const packPath = path.join(OUT_DIR, `${PACK_ID}.json`);
  const content = JSON.parse(await readFile(packPath, "utf8"));
  content.offlineMap = descriptor;
  await writeFile(packPath, JSON.stringify(content));

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifestPack = manifest.packs.find(
    (candidate) => candidate.id === PACK_ID,
  );
  if (!manifestPack) throw new Error(`Manifest is missing ${PACK_ID}`);
  manifestPack.offlineMap = descriptor;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(
    `Wrote ${assetName}: ${byteLength} bytes, sha256 ${descriptor.sha256}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
