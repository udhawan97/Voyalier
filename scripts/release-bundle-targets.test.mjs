import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_DIR = path.join(ROOT, "apps", "desktop", "src-tauri");

function readConfig(name) {
  return JSON.parse(readFileSync(path.join(TAURI_DIR, name), "utf8"));
}

test("the base Tauri config fails closed without publishable bundle targets", () => {
  const config = readConfig("tauri.conf.json");

  assert.deepEqual(config.bundle.targets, []);
});

test("macOS and Windows own disjoint, platform-specific bundle targets", () => {
  const macos = readConfig("tauri.macos.conf.json").bundle.targets;
  const windows = readConfig("tauri.windows.conf.json").bundle.targets;

  assert.deepEqual(macos, ["app", "dmg"]);
  assert.deepEqual(windows, ["nsis", "msi"]);
  assert.deepEqual(
    macos.filter((target) => windows.includes(target)),
    [],
  );

  const supported = new Set([...macos, ...windows]);
  assert.equal(supported.has("deb"), false);
  assert.equal(supported.has("rpm"), false);
  assert.equal(supported.has("appimage"), false);
  assert.equal(
    existsSync(path.join(TAURI_DIR, "tauri.linux.conf.json")),
    false,
  );
});

test("only a version-tag push can enter the release job", () => {
  const workflow = readFileSync(
    path.join(ROOT, ".github/workflows/release.yml"),
    "utf8",
  );
  const job = (name) => {
    const match = workflow.match(
      new RegExp(
        `^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`,
        "m",
      ),
    );
    assert.ok(match, `missing ${name} job`);
    return match[1];
  };
  const release = job("desktop");
  const rehearsal = job("rehearsal");
  const gate = release.match(
    /^    if: github.event_name == '([^']+)' && startsWith\(github.ref, '([^']+)'\)$/m,
  );
  const manual = rehearsal.match(/^    if: github.event_name == '([^']+)'$/m);
  assert.ok(gate);
  assert.ok(manual);
  for (const [event, ref, builds, signs] of [
    ["workflow_dispatch", "refs/heads/main", true, false],
    ["workflow_dispatch", "refs/tags/v1.0.0", true, false],
    ["push", "refs/tags/v1.0.0", false, true],
    ["push", "refs/heads/main", false, false],
    ["push", "refs/tags/packs-v1", false, false],
  ]) {
    assert.equal(event === manual[1], builds);
    assert.equal(event === gate[1] && ref.startsWith(gate[2]), signs);
  }
  assert.match(workflow, /^permissions:\n  contents: read\n\njobs:/m);
  assert.doesNotMatch(
    rehearsal,
    /environment:|permissions:|secrets\.|release upload|attestations:|tauri-apps\/tauri-action/,
  );
  assert.match(rehearsal, /createUpdaterArtifacts":false/);
  assert.match(release, /environment: release/);
  assert.match(release, /releaseDraft: true/);
});
