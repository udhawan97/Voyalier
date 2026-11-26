#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = {
  macos: { triple: "aarch64-apple-darwin", platform: "darwin", arch: "arm64" },
  windows: { triple: "x86_64-pc-windows-msvc", platform: "win32", arch: "x64" },
};
const SPEC_VERSION = "1.6";
const NS = "voyalier:sbom";
const ROOT = "voyalier:source-and-distribution";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashEntry = (content) => ({ alg: "SHA-256", content });
const byRef = (left, right) => {
  const a = left["bom-ref"] ?? left.ref;
  const b = right["bom-ref"] ?? right.ref;
  return a < b ? -1 : a > b ? 1 : 0;
};
const property = (key, value) => ({ name: `${NS}:${key}`, value });
const properties = (values) =>
  Object.entries(values).map(([key, value]) => property(key, String(value)));

function command(name, args) {
  // Windows installs pnpm as a .cmd shim. These arguments are constants; never
  // pass release paths, package metadata or user input through the shell here.
  return execFileSync(name, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === "win32" && name === "pnpm",
  }).trim();
}

function jsonCommand(name, args) {
  return JSON.parse(command(name, args));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function absent(error) {
  return error.code === "ENOENT";
}

async function directories(directory) {
  return (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

async function installedNpmLicenses() {
  // pnpm's virtual store has one real package directory per lock resolution
  // plus links to other packages. Read real manifests only. Repeated peer
  // resolutions must agree on the license for a given name and version.
  const layouts = await directories("node_modules/.pnpm");
  const licenses = new Map();
  for (const layout of layouts) {
    const modules = path.join(layout, "node_modules");
    const packages = await directories(modules).catch((error) => {
      if (absent(error)) return [];
      throw error;
    });
    for (const entry of packages) {
      const candidates = path.basename(entry).startsWith("@")
        ? await directories(entry)
        : [entry];
      for (const candidate of candidates) {
        const manifest = await readJson(
          path.join(candidate, "package.json"),
        ).catch((error) => {
          if (absent(error)) return null;
          throw error;
        });
        if (!manifest?.name || !manifest.version) continue;
        const name = `${manifest.name}@${manifest.version}`;
        const declared =
          typeof manifest.license === "string" ? manifest.license.trim() : "";
        const license = declared && declared !== "UNLICENSED" ? declared : null;
        if (licenses.has(name) && licenses.get(name) !== license) {
          throw new Error(`inconsistent installed npm licenses for ${name}`);
        }
        licenses.set(name, license);
      }
    }
  }
  if (!licenses.size)
    throw new Error("pnpm installed manifest inventory is empty");
  return licenses;
}

function licenseFields(license) {
  // Retain the upstream declaration verbatim. It may be an SPDX expression,
  // a license name or a reference to a license file. Do not claim a review.
  return license ? { licenses: [{ license: { name: license } }] } : {};
}

function readNpmGraph(bom) {
  if (
    bom.bomFormat !== "CycloneDX" ||
    bom.specVersion !== SPEC_VERSION ||
    bom.metadata?.tools?.components?.[0]?.name !== "pnpm" ||
    !bom.metadata.component?.["bom-ref"] ||
    !Array.isArray(bom.components) ||
    !Array.isArray(bom.dependencies)
  ) {
    throw new Error("unexpected pnpm CycloneDX output");
  }
  return bom;
}

function publicNpmComponent(component) {
  const { "bom-ref": ref, name, group, version, purl } = component;
  if (
    ref !== purl ||
    !/^pkg:npm\/(?:%40[\w.-]+\/)?[\w.-]+@[\w.+-]+$/.test(ref) ||
    !/^[\w.-]+$/.test(name) ||
    (group !== undefined && !/^@[\w.-]+$/.test(group)) ||
    !/^[\w.+-]+$/.test(version)
  )
    throw new Error("unsupported public pnpm package identity");
  const externalReferences = (component.externalReferences ?? []).map(
    ({ type, url, hashes }) => {
      const source = new URL(url);
      if (
        type !== "distribution" ||
        source.origin !== "https://registry.npmjs.org" ||
        source.username ||
        source.password ||
        source.search ||
        source.hash
      )
        throw new Error("unsupported pnpm distribution reference");
      return {
        type,
        url: source.href,
        ...(hashes && {
          hashes: hashes.map(({ alg, content }) => ({ alg, content })),
        }),
      };
    },
  );
  return {
    type: "library",
    "bom-ref": ref,
    name,
    ...(group && { group }),
    version,
    purl,
    ...(externalReferences.length > 0 && { externalReferences }),
  };
}

export function npmInventory(input, web, docs, licenses, webManifest) {
  const bom = readNpmGraph(input);
  const webGraph = readNpmGraph(web);
  const webComponents = webGraph.components;
  const docComponents = readNpmGraph(docs).components;
  const webRefs = new Set(
    webComponents.map((component) => component["bom-ref"]),
  );
  const docRefs = new Set(
    docComponents.map((component) => component["bom-ref"]),
  );
  const componentRefs = new Set(
    bom.components.map((component) => component["bom-ref"]),
  );
  for (const ref of [...webRefs, ...docRefs]) {
    if (!componentRefs.has(ref))
      throw new Error(`npm scope references missing component ${ref}`);
  }
  const packageName = (component) =>
    [component.group, component.name].filter(Boolean).join("/");
  const webRoot = webGraph.metadata.component["bom-ref"];
  const directRefs = new Set(
    webGraph.dependencies.find(({ ref }) => ref === webRoot)?.dependsOn,
  );
  const webNames = new Map(
    webComponents
      .filter((component) => directRefs.has(component["bom-ref"]))
      .map((component) => [packageName(component), component]),
  );
  for (const name of Object.keys(webManifest.dependencies ?? {})) {
    // Local workspace packages live in this repository. pnpm inventory reports
    // registry dependencies and their edges, with the Git SHA covering local code.
    if (webManifest.dependencies[name].startsWith("workspace:")) continue;
    const component = webNames.get(name);
    if (!component || !licenses.get(`${name}@${component.version}`)) {
      throw new Error(
        `missing installed declaration for direct web dependency ${name}`,
      );
    }
  }
  const components = bom.components.map((component) => {
    const ref = component["bom-ref"];
    const key = `${packageName(component)}@${component.version}`;
    const declared = licenses.get(key);
    return {
      ...publicNpmComponent(component),
      ...licenseFields(declared),
      properties: [
        ...properties({
          "input-scope":
            [
              webRefs.has(ref) && "web-production-resolution",
              docRefs.has(ref) && "docs-production-resolution",
            ]
              .filter(Boolean)
              .join(",") || "build-test-or-other-workspace-input",
          license: declared
            ? "declared-in-installed-package"
            : licenses.has(key)
              ? "missing-package-declaration"
              : "not-installed-on-inventory-host",
        }),
      ],
    };
  });
  return {
    tool: {
      type: "application",
      name: "pnpm",
      version: bom.metadata.tools.components[0].version,
    },
    root: bom.metadata.component["bom-ref"],
    components: [
      {
        ...publicNpmComponent(bom.metadata.component),
        properties: [property("input-scope", "pnpm-workspace")],
      },
      ...components,
    ],
    dependencies: bom.dependencies,
  };
}

export async function rustInventory(metadata) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const ids = new Map();
  for (const pkg of packages.values()) {
    let ref = `pkg:cargo/${encodeURIComponent(pkg.name)}@${encodeURIComponent(pkg.version)}`;
    if (pkg.source?.startsWith("git+")) {
      ref += `?vcs_url=${encodeURIComponent(publicGitSource(pkg.source))}`;
    } else if (
      pkg.source &&
      pkg.source !== "registry+https://github.com/rust-lang/crates.io-index"
    ) {
      throw new Error(`unexpected Cargo source for ${pkg.name}`);
    } else if (!pkg.source && !metadata.workspace_members.includes(pkg.id)) {
      throw new Error(`unexpected local Cargo package ${pkg.name}`);
    }
    ids.set(pkg.id, ref);
  }
  const desktop = metadata.workspace_members.find(
    (id) => packages.get(id)?.name === "voyalier-desktop",
  );
  if (!desktop) throw new Error("missing Cargo desktop workspace member");
  const walk = (includesKind) => {
    const seen = new Set();
    const pending = [desktop];
    while (pending.length) {
      const id = pending.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dependency of nodes.get(id).deps) {
        if (dependency.dep_kinds.some(({ kind }) => includesKind(kind))) {
          pending.push(dependency.pkg);
        }
      }
    }
    return seen;
  };
  const runtime = walk((kind) => kind === null);
  const buildAndRuntime = walk((kind) => kind !== "dev");
  const components = [];
  const dependencies = [];
  for (const [id, pkg] of packages) {
    const ref = ids.get(id);
    const node = nodes.get(id);
    const buildScope = runtime.has(id)
      ? "desktop-normal-resolution"
      : buildAndRuntime.has(id)
        ? "desktop-build-resolution"
        : "other-workspace-or-test-input";
    const component = {
      type: id === desktop ? "application" : "library",
      "bom-ref": ref,
      name: pkg.name,
      version: pkg.version,
      purl: ref,
      ...licenseFields(
        pkg.license ?? (pkg.license_file ? "See crate license file" : null),
      ),
      properties: properties({
        "input-scope": buildScope,
        "cargo-features": [...node.features].sort().join(",") || "none",
        "cargo-source": pkg.source?.startsWith("git+")
          ? publicGitSource(pkg.source)
          : (pkg.source ?? "workspace"),
        license: pkg.license
          ? "declared-in-cargo-manifest"
          : pkg.license_file
            ? "crate-license-file-review"
            : "missing-package-declaration",
      }),
    };
    components.push(component);
    const refs = node.deps.map(({ pkg: id }) => ids.get(id));
    if (refs.includes(undefined))
      throw new Error(`unknown Cargo dependency of ${pkg.name}`);
    if (pkg.name === "libsqlite3-sys" && runtime.has(id)) {
      if (
        !node.features.includes("bundled") ||
        node.features.includes("bundled-sqlcipher")
      ) {
        throw new Error("SQLite inventory expects the bundled SQLite library");
      }
      const sqlite = await bundledSqlite(pkg.manifest_path);
      components.push(sqlite);
      dependencies.push({ ref: sqlite["bom-ref"], dependsOn: [] });
      refs.push(sqlite["bom-ref"]);
    }
    dependencies.push({ ref, dependsOn: [...new Set(refs)].sort() });
  }
  if (!components.some((item) => item.name === "SQLite")) {
    throw new Error("bundled SQLite missing from the Cargo desktop graph");
  }
  return {
    components,
    dependencies,
    roots: metadata.workspace_members.map((id) => ids.get(id)).sort(),
  };
}

function publicGitSource(value) {
  const source = new URL(value.slice(4));
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    !/^#[0-9a-f]{40}$/.test(source.hash)
  ) {
    throw new Error(
      "Cargo Git dependency is not a public pinned HTTPS revision",
    );
  }
  source.search = "";
  return `git+${source.href}`;
}

async function bundledSqlite(manifest) {
  const directory = path.join(path.dirname(manifest), "sqlite3");
  const header = await readFile(path.join(directory, "sqlite3.h"), "utf8");
  const version = header.match(
    /^#define SQLITE_VERSION\s+"(\d+\.\d+\.\d+)"/m,
  )?.[1];
  if (!version)
    throw new Error("could not identify the bundled SQLite source version");
  const ref = `pkg:generic/sqlite@${version}`;
  return {
    type: "library",
    "bom-ref": ref,
    name: "SQLite",
    version,
    purl: ref,
    ...licenseFields("Public Domain"),
    hashes: [hashEntry(await hashFile(path.join(directory, "sqlite3.c")))],
    properties: properties({
      "input-scope": "bundled-native-source",
      "hash-scope": "sqlite3.c source amalgamation",
      license: "sqlite-public-domain-reviewed",
    }),
  };
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

async function assertDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(
      `expected regular bundle directory: ${path.basename(directory)}`,
    );
  }
}

export async function artifactInventory(bundleDir, platform, mode) {
  if (!Object.hasOwn(TARGETS, platform))
    throw new Error(`unsupported platform ${platform}`);
  if (mode !== "release" && mode !== "rehearsal")
    throw new Error(`unsupported artifact mode ${mode}`);
  await assertDirectory(bundleDir);
  const categories =
    platform === "macos"
      ? [
          ["dmg", /\.dmg$/, false],
          ...(mode === "release" ? [["macos", /\.app\.tar\.gz$/, true]] : []),
        ]
      : [
          ["nsis", /-setup\.exe$/, true],
          ["msi", /\.msi$/, true],
        ];
  const files = [];
  for (const [folder, pattern, signed] of categories) {
    const directory = path.join(bundleDir, folder);
    await assertDirectory(directory);
    const names = (await readdir(directory)).filter((name) =>
      pattern.test(name),
    );
    if (names.length !== 1)
      throw new Error(`expected exactly one ${folder} release asset`);
    const name = names[0];
    if (!/^[\w .+-]+$/.test(name))
      throw new Error(`unexpected ${folder} release asset name`);
    files.push([folder, name, "release-bundle"]);
    if (signed && mode === "release")
      files.push([folder, `${name}.sig`, "updater-signature"]);
  }
  return await Promise.all(
    files.map(async ([folder, name, role]) => {
      const file = path.join(bundleDir, folder, name);
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0) {
        throw new Error(
          `expected nonempty regular artifact: ${folder}/${name}`,
        );
      }
      const location = `${folder}/${name}`;
      return {
        type: "file",
        "bom-ref": `artifact:${location}`,
        name: location,
        hashes: [hashEntry(await hashFile(file))],
        properties: [property("input-scope", role)],
      };
    }),
  );
}

async function fontInventory() {
  const directory = "apps/web/public/fonts";
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".woff2"))
    .sort();
  if (!files.length) throw new Error("expected bundled Voyalier fonts");
  if (!(await lstat(path.join(directory, "OFL.txt"))).isFile())
    throw new Error("missing bundled font license text");
  return await Promise.all(
    files.map(async (file) => ({
      type: "file",
      "bom-ref": `asset:fonts/${file}`,
      name: `fonts/${file}`,
      licenses: [{ license: { id: "OFL-1.1" } }],
      hashes: [hashEntry(await hashFile(path.join(directory, file)))],
      properties: [property("input-scope", "bundled-font-source")],
    })),
  );
}

export function assembleBom({
  js,
  rust,
  assets,
  artifacts,
  source,
  platform,
  mode,
  version,
}) {
  const components = [
    ...js.components,
    ...rust.components,
    ...assets,
    ...artifacts,
  ].sort(byRef);
  const dependencies = [
    ...js.dependencies,
    ...rust.dependencies,
    {
      ref: ROOT,
      dependsOn: [
        js.root,
        ...rust.roots,
        ...assets.map((item) => item["bom-ref"]),
      ].sort(),
    },
  ]
    .map(({ ref, dependsOn = [] }) => ({
      ref,
      dependsOn: [...new Set(dependsOn)].sort(),
    }))
    .sort(byRef);
  const refs = new Set([ROOT]);
  for (const item of components) {
    const ref = item["bom-ref"];
    if (!ref || !item.name || refs.has(ref))
      throw new Error(`invalid or duplicate component ref ${ref}`);
    refs.add(ref);
  }
  const dependencyRefs = new Set();
  for (const { ref, dependsOn } of dependencies) {
    if (
      !refs.has(ref) ||
      dependencyRefs.has(ref) ||
      dependsOn.some((item) => !refs.has(item))
    ) {
      throw new Error(
        `unresolved or duplicate dependency reference for ${ref}`,
      );
    }
    dependencyRefs.add(ref);
  }
  return {
    $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: SPEC_VERSION,
    version: 1,
    metadata: {
      lifecycles: [{ phase: mode === "source" ? "pre-build" : "post-build" }],
      tools: {
        components: [
          js.tool,
          { type: "application", name: "cargo", version: source.cargoVersion },
          { type: "application", name: "node", version: source.nodeVersion },
        ],
      },
      component: {
        type: "application",
        "bom-ref": ROOT,
        name: "Voyalier",
        version,
      },
      properties: properties({
        mode,
        target: TARGETS[platform].triple,
        "source-revision": source.revision,
        "Cargo.lock.sha256": source.cargoLock,
        "pnpm-lock.yaml.sha256": source.pnpmLock,
        scope:
          "Target-filtered Cargo and workspace pnpm dependency inputs with separately hashed distribution files. Input membership does not prove shipping or redistribution rights.",
        "artifact-refs":
          artifacts
            .map((item) => item["bom-ref"])
            .sort()
            .join(",") || "none",
        "license-review":
          "Use declared licenses and THIRD_PARTY_NOTICES.md to review actual redistribution and resolve relevant unknowns before promotion.",
      }),
    },
    components,
    dependencies,
    compositions: [{ aggregate: "incomplete", assemblies: [ROOT] }],
  };
}

async function main([mode, platform, bundleDir, output, ...unexpected]) {
  if (
    !["source", "rehearsal", "release"].includes(mode) ||
    !Object.hasOwn(TARGETS, platform) ||
    !output ||
    !bundleDir ||
    unexpected.length ||
    (mode === "source") !== (bundleDir === "-")
  )
    throw new Error(
      "usage: write-release-sbom.mjs source|rehearsal|release macos|windows BUNDLE_DIR|- OUTPUT",
    );
  const target = TARGETS[platform];
  if (
    mode !== "source" &&
    (target.platform !== process.platform || target.arch !== process.arch)
  ) {
    throw new Error(
      "artifact inventory requires its native release build host and architecture",
    );
  }
  const revision = command("git", ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(revision))
    throw new Error("missing exact source revision");
  // The inventory names HEAD. Refuse changes in any tracked input, including
  // a lockfile rewritten by the preceding build.
  try {
    command("git", ["diff", "--quiet", "HEAD", "--"]);
  } catch (error) {
    throw new Error("release inventory requires a clean tracked checkout", {
      cause: error,
    });
  }
  const cargoVersion = command("cargo", ["--version"]);
  const cargo = jsonCommand("cargo", [
    "metadata",
    "--locked",
    "--offline",
    "--format-version",
    "1",
    "--filter-platform",
    target.triple,
  ]);
  const args = [
    "sbom",
    "--sbom-format",
    "cyclonedx",
    "--sbom-spec-version",
    SPEC_VERSION,
    "--lockfile-only",
  ];
  const js = npmInventory(
    jsonCommand("pnpm", args),
    jsonCommand("pnpm", [
      "--filter",
      "@voyalier/web",
      "--fail-if-no-match",
      ...args,
      "--prod",
    ]),
    jsonCommand("pnpm", [
      "--filter",
      "@voyalier/docs",
      "--fail-if-no-match",
      ...args,
      "--prod",
    ]),
    await installedNpmLicenses(),
    await readJson("apps/web/package.json"),
  );
  const rust = await rustInventory(cargo);
  const assets = await fontInventory();
  const artifacts =
    mode === "source" ? [] : await artifactInventory(bundleDir, platform, mode);
  const source = {
    revision,
    cargoVersion,
    nodeVersion: process.version,
    cargoLock: sha256(await readFile("Cargo.lock")),
    pnpmLock: sha256(await readFile("pnpm-lock.yaml")),
  };
  const { version, packageManager } = await readJson("package.json");
  if (packageManager !== `pnpm@${js.tool.version}`) {
    throw new Error("inventory expects the workspace-pinned pnpm version");
  }
  const bom = assembleBom({
    js,
    rust,
    assets,
    artifacts,
    source,
    platform,
    mode,
    version,
  });
  await writeFile(output, `${JSON.stringify(bom, null, 2)}\n`, { flag: "wx" });
  const unknown = bom.components.filter((item) =>
    item.properties?.some(
      ({ name, value }) =>
        name === `${NS}:license` &&
        /missing|not-installed|file-review/.test(value),
    ),
  ).length;
  console.log(
    `Wrote CycloneDX 1.6 inventory for ${target.triple}: ${bom.components.length} components, ${artifacts.length} artifacts, ${unknown} unresolved license declarations.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
