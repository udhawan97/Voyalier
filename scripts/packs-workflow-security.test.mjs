import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL("../.github/workflows/packs.yml", import.meta.url),
  "utf8",
);
const build = workflow.slice(
  workflow.indexOf("  build:"),
  workflow.indexOf("  publish:"),
);
const publish = workflow.slice(workflow.indexOf("  publish:"));

test("pack builders have read-only repository authority", () => {
  assert.match(build, /permissions:\n      contents: read/);
  assert.doesNotMatch(build, /contents: write/);
  assert.match(
    publish,
    /permissions:\n      actions: read\n      contents: write/,
  );
});

test("DuckDB is an immutable official asset with its published checksum", () => {
  assert.match(
    workflow,
    /duckdb\/duckdb\/releases\/download\/v1\.5\.5\/duckdb_cli-linux-amd64\.zip/,
  );
  assert.match(
    workflow,
    /08c0ca117111fcede14239d0093792352befdc174218c344d232c13279643d05/,
  );
  assert.doesNotMatch(workflow, /install\.duckdb\.org/);
});

test("publish authority cannot select a product release", () => {
  assert.doesNotMatch(workflow, /release_tag:/);
  assert.match(publish, /RELEASE_TAG: packs-v1/);
  assert.match(publish, /isPrerelease/);
});
