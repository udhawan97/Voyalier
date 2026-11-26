import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  artifactInventory,
  assembleBom,
  npmInventory,
  rustInventory,
} from "./write-release-sbom.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "voyalier-sbom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function npmBom(components) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    metadata: {
      component: { type: "library", name: "voyalier", "bom-ref": "npm:root" },
      tools: {
        components: [{ type: "application", name: "pnpm", version: "11.7.0" }],
      },
    },
    components,
    dependencies: [
      {
        ref: "npm:root",
        dependsOn: components.map((component) => component["bom-ref"]),
      },
      ...components.map((component) => ({
        ref: component["bom-ref"],
        dependsOn: [],
      })),
    ],
  };
}

test("inventory retains package versions and labels scope and unknown declarations", () => {
  const packageOf = (name, version) => ({
    type: "library",
    name,
    version,
    "bom-ref": `pkg:npm/${name}@${version}`,
  });
  const runtime = packageOf("runtime", "1");
  const optional = packageOf("other-platform", "2");
  const tool = packageOf("docs", "1");
  const packages = npmBom([runtime, optional, tool]);
  const web = npmBom([runtime, optional]);
  const docs = npmBom([tool]);
  const licenses = new Map([
    ["runtime@1", "MIT"],
    ["docs@1", null],
  ]);
  const manifest = { dependencies: { runtime: "^1", local: "workspace:*" } };
  const result = npmInventory(packages, web, docs, licenses, manifest);
  const components = new Map(
    result.components.map((component) => [component.name, component]),
  );
  assert.deepEqual(components.get("runtime").licenses, [
    { license: { name: "MIT" } },
  ]);
  assert.equal(components.get("other-platform").licenses, undefined);
  assert.ok(
    components
      .get("docs")
      .properties.some(({ value }) => value === "missing-package-declaration"),
  );
  assert.ok(
    components
      .get("docs")
      .properties.some(({ value }) => value === "docs-production-resolution"),
  );
  assert.ok(
    components
      .get("other-platform")
      .properties.some(
        ({ value }) => value === "not-installed-on-inventory-host",
      ),
  );
  assert.throws(
    () => npmInventory(packages, web, docs, new Map(), manifest),
    /missing installed declaration/,
  );
  assert.throws(
    () =>
      npmInventory(
        packages,
        npmBom([packageOf("runtime", "2")]),
        docs,
        licenses,
        manifest,
      ),
    /missing component/,
  );
});

test("resolution reports the pinned Cargo Git source and separate bundled SQLite version", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "sqlite3"));
  await writeFile(
    path.join(root, "sqlite3", "sqlite3.h"),
    '#define SQLITE_VERSION "3.54.1"\n',
  );
  await writeFile(
    path.join(root, "sqlite3", "sqlite3.c"),
    "synthetic SQLite source",
  );

  const fixed = "e".repeat(40);
  const source = `git+https://github.com/example/dependency?rev=${fixed}#${fixed}`;
  const pkg = (id, name, extra = {}) => ({
    id,
    name,
    version: "0.1.0",
    license: "MIT",
    ...extra,
  });
  const node = (id, deps = [], features = []) => ({ id, deps, features });
  const input = {
    workspace_members: ["desktop"],
    packages: [
      pkg("desktop", "voyalier-desktop"),
      pkg("sqlite", "libsqlite3-sys", {
        source: "registry+https://github.com/rust-lang/crates.io-index",
        manifest_path: path.join(root, "Cargo.toml"),
      }),
      pkg("git", "dependency", { source }),
    ],
    resolve: {
      nodes: [
        node("desktop", [
          { pkg: "sqlite", dep_kinds: [{ kind: null }] },
          { pkg: "git", dep_kinds: [{ kind: "build" }] },
        ]),
        node("sqlite", [], ["bundled"]),
        node("git"),
      ],
    },
  };
  const rust = await rustInventory(input);
  const git = rust.components.find((item) => item.name === "dependency");
  assert.ok(git.purl.endsWith(fixed));
  assert.ok(
    git.properties.some(({ value }) => value === "desktop-build-resolution"),
  );
  const sqlite = rust.components.find((item) => item.name === "SQLite");
  assert.equal(sqlite.version, "3.54.1");
  assert.deepEqual(
    rust.dependencies.find((item) => item.ref.includes("libsqlite3-sys"))
      .dependsOn,
    [sqlite["bom-ref"]],
  );
  assert.ok(!JSON.stringify(rust).includes(root));
  input.resolve.nodes[1].features = [];
  await assert.rejects(rustInventory(input), /expects the bundled SQLite/);
});

test("source and artifact identities are reproducible and dependent refs must exist", () => {
  const args = {
    js: {
      tool: { type: "application", name: "pnpm", version: "11.7.0" },
      root: "npm:root",
      components: [
        { type: "library", name: "voyalier", "bom-ref": "npm:root" },
      ],
      dependencies: [{ ref: "npm:root", dependsOn: [] }],
    },
    rust: { roots: [], components: [], dependencies: [] },
    assets: [],
    artifacts: [
      { type: "file", name: "b.dmg", "bom-ref": "artifact:b" },
      { type: "file", name: "a.dmg", "bom-ref": "artifact:a" },
    ],
    source: {
      revision: "a".repeat(40),
      cargoLock: "b".repeat(64),
      pnpmLock: "c".repeat(64),
      cargoVersion: "cargo test",
      nodeVersion: "v24",
    },
    platform: "macos",
    mode: "rehearsal",
    version: "1.0.0",
  };
  const bom = assembleBom(args);
  assert.equal(
    JSON.stringify(bom),
    JSON.stringify(
      assembleBom({ ...args, artifacts: [...args.artifacts].reverse() }),
    ),
  );
  assert.equal(bom.specVersion, "1.6");
  assert.equal(bom.compositions[0].aggregate, "incomplete");
  assert.deepEqual(
    bom.metadata.properties
      .filter(({ name }) => name.endsWith("sha256"))
      .map(({ value }) => value),
    [args.source.cargoLock, args.source.pnpmLock],
  );
  assert.throws(
    () => assembleBom({ ...args, js: { ...args.js, root: "absent" } }),
    /unresolved/,
  );
});

test("Windows bundles require both installer types and bind actual bytes and signed sidecars", async (t) => {
  const root = await fixture(t);
  await Promise.all(
    ["nsis", "msi"].map((part) => mkdir(path.join(root, part))),
  );
  const installer = path.join(root, "nsis", "Voyalier_0.12.0_x64-setup.exe");
  const msi = path.join(root, "msi", "Voyalier_0.12.0_x64_en-US.msi");
  await writeFile(installer, "ab");
  await assert.rejects(
    artifactInventory(root, "windows", "rehearsal"),
    /exactly one msi/,
  );
  await writeFile(msi, "abc");
  const result = await artifactInventory(root, "windows", "rehearsal");
  assert.deepEqual(
    result.map((item) => item.name),
    ["nsis/Voyalier_0.12.0_x64-setup.exe", "msi/Voyalier_0.12.0_x64_en-US.msi"],
  );
  assert.deepEqual(result[1].hashes, [
    {
      alg: "SHA-256",
      content:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
  ]);
  await assert.rejects(artifactInventory(root, "windows", "release"), {
    code: "ENOENT",
  });
  await writeFile(`${installer}.sig`, "NSIS test signature");
  await writeFile(`${msi}.sig`, "MSI test signature");
  assert.equal((await artifactInventory(root, "windows", "release")).length, 4);
});

test("macOS release requires an updater archive and refuses duplicate or redirected assets", async (t) => {
  const root = await fixture(t);
  await Promise.all(
    ["dmg", "macos"].map((part) => mkdir(path.join(root, part))),
  );
  const dmg = path.join(root, "dmg", "Voyalier.dmg");
  await writeFile(dmg, "abc");
  assert.equal((await artifactInventory(root, "macos", "rehearsal")).length, 1);
  await assert.rejects(
    artifactInventory(root, "macos", "release"),
    /exactly one macos/,
  );
  const archive = path.join(root, "macos", "Voyalier.app.tar.gz");
  await writeFile(archive, "abc");
  await writeFile(`${archive}.sig`, "signature");
  assert.equal((await artifactInventory(root, "macos", "release")).length, 3);
  const duplicate = path.join(root, "dmg", "Duplicate.dmg");
  await writeFile(duplicate, "another");
  await assert.rejects(
    artifactInventory(root, "macos", "rehearsal"),
    /exactly one dmg/,
  );
  await rm(duplicate);
  if (process.platform !== "win32") {
    await rm(dmg);
    await symlink(archive, dmg);
    await assert.rejects(
      artifactInventory(root, "macos", "release"),
      /nonempty regular artifact/,
    );
  }
  await assert.rejects(
    artifactInventory(root, "linux", "release"),
    /unsupported platform/,
  );
  await assert.rejects(
    artifactInventory(root, "android", "release"),
    /unsupported platform/,
  );
});
