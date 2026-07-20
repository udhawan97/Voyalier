import assert from "node:assert/strict";
import test from "node:test";

import { applyDescriptor, resolvePackIds } from "./build-offline-map.mjs";

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
