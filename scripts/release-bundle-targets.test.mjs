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
