import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyDescriptor,
  buildOfflineMaps,
  extractVerified,
  resolvePackIds,
} from "./build-offline-map.mjs";

const catalog = [
  { id: "us-nashville", offlineMapAvailable: true },
  { id: "jp-kyoto", offlineMapAvailable: true },
  { id: "jp-tokyo", offlineMapAvailable: true },
  { id: "fr-paris", offlineMapAvailable: true },
  { id: "gb-london", offlineMapAvailable: false },
];

test("defaults to every catalog-enabled map in catalog order", () => {
  assert.deepEqual(resolvePackIds(catalog), [
    "us-nashville",
    "jp-kyoto",
    "jp-tokyo",
    "fr-paris",
  ]);
});

test("rejects a configured pack that the catalog does not enable", () => {
  assert.throws(
    () => resolvePackIds(catalog, "gb-london"),
    /not catalog-enabled/,
  );
});

test("rejects duplicate configured pack ids instead of hiding them", () => {
  assert.throws(
    () => resolvePackIds(catalog, "jp-kyoto,jp-kyoto"),
    /Duplicate offline map pack id: jp-kyoto/,
  );
});

test("descriptor injection preserves other manifest maps", () => {
  const manifest = {
    packs: [
      { id: "us-nashville", offlineMap: { sha256: "kept" } },
      { id: "jp-tokyo" },
    ],
  };
  const content = { packId: "jp-tokyo", places: [], articles: [] };
  applyDescriptor(content, manifest, "jp-tokyo", { sha256: "new" });
  assert.equal(manifest.packs[0].offlineMap.sha256, "kept");
  assert.equal(manifest.packs[1].offlineMap.sha256, "new");
  assert.equal(content.offlineMap.sha256, "new");
});

const pack = {
  id: "jp-tokyo",
  bbox: { west: 139.56, south: 35.53, east: 139.92, north: 35.82 },
};

async function withTempDir(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "voyalier-map-test-"));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function fakePmtiles({ sizes = { 15: 5, 14: 2 }, failVerify = false } = {}) {
  const calls = [];
  const run = async (_binary, args) => {
    calls.push(args);
    if (args[0] === "extract") {
      const maxZoom = Number(args.find((value) => value.startsWith("--maxzoom=")).split("=")[1]);
      await writeFile(args[2], Buffer.alloc(sizes[maxZoom] ?? 2, maxZoom));
      return { stdout: "" };
    }
    if (args[0] === "verify") {
      if (failVerify) throw new Error("archive verification failed");
      return { stdout: "" };
    }
    if (args[0] === "show") {
      const bytes = await readFile(args[1]);
      return {
        stdout: JSON.stringify({
          tile_type: "mvt",
          minzoom: 0,
          maxzoom: bytes[0],
        }),
      };
    }
    throw new Error(`Unexpected PMTiles command: ${args.join(" ")}`);
  };
  return { calls, run };
}

test("extract verifies the archive and retries below the size cap", async () => {
  await withTempDir(async (directory) => {
    const archivePath = path.join(directory, "tokyo.pmtiles");
    const fake = fakePmtiles();
    const result = await extractVerified(
      pack,
      "https://example.test/source.pmtiles",
      archivePath,
      { run: fake.run, rm, stat, maxBytes: 3 },
    );

    assert.equal(result.byteLength, 2);
    assert.equal(result.header.maxzoom, 14);
    assert.deepEqual(
      fake.calls.map((args) => args[0]),
      ["extract", "verify", "show", "extract", "verify", "show"],
    );
  });
});

test("extract rejects an unverifiable archive", async () => {
  await withTempDir(async (directory) => {
    const fake = fakePmtiles({ failVerify: true });
    await assert.rejects(
      extractVerified(
        pack,
        "https://example.test/source.pmtiles",
        path.join(directory, "tokyo.pmtiles"),
        { run: fake.run, rm, stat, maxBytes: 3 },
      ),
      /archive verification failed/,
    );
  });
});

test("extract rejects an archive that exceeds the cap at every zoom", async () => {
  await withTempDir(async (directory) => {
    const fake = fakePmtiles({ sizes: { 15: 4, 14: 4, 13: 4 } });
    await assert.rejects(
      extractVerified(
        pack,
        "https://example.test/source.pmtiles",
        path.join(directory, "tokyo.pmtiles"),
        { run: fake.run, rm, stat, maxBytes: 3 },
      ),
      /exceeds 3 bytes at z13/,
    );
  });
});

test("one publisher run retains verified outputs for all four enabled maps", async () => {
  await withTempDir(async (directory) => {
    const outDir = path.join(directory, "packs");
    await mkdir(outDir);
    const catalogPath = path.join(directory, "catalog.json");
    const four = catalog.slice(0, 4).map((entry, index) => ({
      ...entry,
      name: entry.id,
      bbox: { west: index, south: index, east: index + 1, north: index + 1 },
    }));
    await writeFile(catalogPath, JSON.stringify(four));
    await writeFile(
      path.join(outDir, "manifest.json"),
      JSON.stringify({ packs: four.map(({ id }) => ({ id })) }),
    );
    for (const { id } of four) {
      await writeFile(
        path.join(outDir, `${id}.json`),
        JSON.stringify({ packId: id, places: [], articles: [] }),
      );
    }
    const fake = fakePmtiles({ sizes: { 15: 2 } });

    const built = await buildOfflineMaps(catalogPath, {
      outDir,
      run: fake.run,
      rm,
      stat,
      readFile,
      writeFile,
      maxBytes: 3,
      now: () => "2026-07-20T12:00:00.000Z",
    });

    assert.deepEqual(built, four.map(({ id }) => id));
    const manifest = JSON.parse(
      await readFile(path.join(outDir, "manifest.json"), "utf8"),
    );
    for (const { id } of four) {
      assert.equal(manifest.packs.find((entry) => entry.id === id).offlineMap.assetName, `${id}.pmtiles`);
      const descriptor = JSON.parse(
        await readFile(path.join(outDir, `${id}.json`), "utf8"),
      ).offlineMap;
      assert.equal(descriptor.assetName, `${id}.pmtiles`);
      assert.equal((await stat(path.join(outDir, descriptor.assetName))).size, 2);
    }
  });
});
