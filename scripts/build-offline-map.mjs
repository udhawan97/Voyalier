#!/usr/bin/env node
// Build every catalog-enabled PMTiles basemap in one run, verify each archive,
// and add provenance + integrity metadata to its pack JSON and the manifest.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const OUT_DIR = process.env.OUT_DIR ?? "dist/packs";
const PROTOMAPS_BUILD = process.env.PROTOMAPS_BUILD ?? "20260715";
const PMTILES_BIN = process.env.PMTILES_BIN ?? "pmtiles";
const MAX_BYTES = 128 * 1024 * 1024;

if (!/^\d{8}$/.test(PROTOMAPS_BUILD)) {
  throw new Error(`Refusing unsafe PROTOMAPS_BUILD: ${PROTOMAPS_BUILD}`);
}

export function resolvePackIds(catalog, configured = "") {
  const enabled = catalog
    .filter((pack) => pack.offlineMapAvailable)
    .map((pack) => pack.id);
  const requested = configured.trim()
    ? configured
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : enabled;
  const duplicate = requested.find(
    (id, index) => requested.indexOf(id) !== index,
  );
  if (duplicate) {
    throw new Error(`Duplicate offline map pack id: ${duplicate}`);
  }
  for (const id of requested) {
    if (!/^[a-z0-9-]+$/.test(id)) {
      throw new Error(`Refusing unsafe offline map pack id: ${id}`);
    }
    if (!enabled.includes(id)) {
      throw new Error(`Pack is not catalog-enabled for offline maps: ${id}`);
    }
  }
  if (requested.length === 0)
    throw new Error("No offline-map packs are enabled");
  return requested;
}

export function applyDescriptor(packContent, manifest, packId, descriptor) {
  if (packContent.packId !== packId) {
    throw new Error(`Pack content mismatch: expected ${packId}`);
  }
  const manifestPack = manifest.packs.find(
    (candidate) => candidate.id === packId,
  );
  if (!manifestPack) throw new Error(`Manifest is missing ${packId}`);
  packContent.offlineMap = descriptor;
  manifestPack.offlineMap = descriptor;
}

const DEFAULT_DEPS = {
  outDir: OUT_DIR,
  pmtilesBin: PMTILES_BIN,
  maxBytes: MAX_BYTES,
  run,
  readFile,
  rm,
  stat,
  writeFile,
  now: () => new Date().toISOString(),
};

export async function extractVerified(
  pack,
  sourceUrl,
  archivePath,
  overrides = {},
) {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const bbox = pack.bbox;
  const bounds = [bbox.west, bbox.south, bbox.east, bbox.north];
  if (!bounds.every(Number.isFinite)) {
    throw new Error(`Invalid bbox for ${pack.id}`);
  }

  // Large cities retry at a lower maximum zoom instead of bypassing the hard
  // archive cap. The chosen zoom is recorded in the descriptor.
  for (const requestedMaxZoom of [15, 14, 13]) {
    await deps.rm(archivePath, { force: true });
    await deps.run(deps.pmtilesBin, [
      "extract",
      sourceUrl,
      archivePath,
      `--bbox=${bounds.join(",")}`,
      `--maxzoom=${requestedMaxZoom}`,
    ]);
    await deps.run(deps.pmtilesBin, ["verify", archivePath]);
    const { stdout } = await deps.run(deps.pmtilesBin, [
      "show",
      archivePath,
      "--header-json",
    ]);
    const header = JSON.parse(stdout);
    if (header.tile_type !== "mvt" || header.maxzoom > requestedMaxZoom) {
      throw new Error(`Unexpected PMTiles header for ${pack.id}`);
    }
    const byteLength = (await deps.stat(archivePath)).size;
    if (byteLength > 0 && byteLength <= deps.maxBytes) {
      return { header, byteLength };
    }
    console.warn(
      `${pack.id} produced ${byteLength} bytes at z${requestedMaxZoom}; retrying below the ${deps.maxBytes}-byte cap`,
    );
  }
  throw new Error(
    `Offline map for ${pack.id} exceeds ${deps.maxBytes} bytes at z13`,
  );
}

async function buildOne(catalog, manifest, packId, deps) {
  const pack = catalog.find((candidate) => candidate.id === packId);
  if (!pack) throw new Error(`Unknown pack id: ${packId}`);

  const sourceUrl = `https://build.protomaps.com/${PROTOMAPS_BUILD}.pmtiles`;
  const assetName = `${packId}.pmtiles`;
  const archivePath = path.join(deps.outDir, assetName);
  const { header, byteLength } = await extractVerified(
    pack,
    sourceUrl,
    archivePath,
    deps,
  );
  const bytes = await deps.readFile(archivePath);
  const descriptor = {
    assetName,
    byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sourceName: "Protomaps Basemap",
    sourceUrl,
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    fetchedAt: deps.now(),
    minZoom: header.minzoom,
    maxZoom: header.maxzoom,
  };

  const packPath = path.join(deps.outDir, `${packId}.json`);
  const content = JSON.parse(await deps.readFile(packPath, "utf8"));
  applyDescriptor(content, manifest, packId, descriptor);
  await deps.writeFile(packPath, JSON.stringify(content));
  console.log(
    `Wrote ${assetName}: ${byteLength} bytes, sha256 ${descriptor.sha256}`,
  );
}

export async function buildOfflineMaps(catalogPath, overrides = {}) {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const catalog = JSON.parse(await deps.readFile(catalogPath, "utf8"));
  const packIds = resolvePackIds(
    catalog,
    process.env.OFFLINE_MAP_PACK_IDS ?? "",
  );
  const manifestPath = path.join(deps.outDir, "manifest.json");
  const manifest = JSON.parse(await deps.readFile(manifestPath, "utf8"));
  for (const packId of packIds) {
    await buildOne(catalog, manifest, packId, deps);
  }
  // One final write retains every descriptor produced in this run; a partial
  // single-city invocation cannot silently clobber the catalog-enabled set.
  await deps.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return packIds;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  buildOfflineMaps(process.argv[2] ?? "catalog.json").catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
