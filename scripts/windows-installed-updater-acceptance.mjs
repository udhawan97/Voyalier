import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  allowedUpdaterPath,
  buildWindowsDriverCapabilities,
  buildWindowsUpdaterManifest,
  mirrorWebViewDevToolsPort,
  validateWindowsAcceptanceReport,
} from "./windows-updater-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_TAG = "v0.10.7";
const BASE_VERSION = "0.10.7";
const CANDIDATE_VERSION = "0.11.0";
const PORT = 48137;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TRIP_TITLE = "Windows updater acceptance - fictional Kyoto";
const TEMP_ROOT = path.join(
  process.env.RUNNER_TEMP ?? os.tmpdir(),
  `voyalier-windows-acceptance-${process.pid}`,
);
const BASE_ROOT = path.join(TEMP_ROOT, "base");
const BASE_AUTOMATION_PATCH = path.join(
  ROOT,
  "scripts/windows-v0.10.7-automation.patch",
);
const BASE_AUTOMATION_FILE = "apps/desktop/src-tauri/src/lib.rs";
const FIXTURE_ROOT = path.join(TEMP_ROOT, "updater");
const DATA_ROOT = path.join(TEMP_ROOT, "data");
const EVIDENCE_ROOT = path.join(ROOT, "windows-acceptance-evidence");
const KEY_PATH = path.join(TEMP_ROOT, "ephemeral-updater.key");
const DRIVER_URL = "http://127.0.0.1:4444";
const GIT = process.platform === "win32" ? "git.exe" : "git";
const PNPM_CLI = process.env.PNPM_HOME
  ? path.resolve(process.env.PNPM_HOME, "..", "pnpm", "bin", "pnpm.cjs")
  : null;
const DRIVER_DIAGNOSTICS = [];
const DRIVER_SESSIONS = ["base", "updated", "recovery"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
    timeout: options.timeout ?? 30 * 60 * 1000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    const detail = options.quiet
      ? `\n${result.stdout ?? ""}\n${result.stderr ?? ""}`.slice(-4000)
      : "";
    throw new Error(
      `${command} exited with ${result.status ?? "no status"}${detail}`,
      { cause: result.error },
    );
  }
  return (result.stdout ?? "").trim();
}

function runPnpm(args, options = {}) {
  if (process.platform === "win32") {
    assert.ok(PNPM_CLI, "PNPM_HOME is required on Windows");
    return run(process.execPath, [PNPM_CLI, ...args], options);
  }
  return run("pnpm", args, options);
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function powershell(script, { json = false } = {}) {
  const output = run(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    { quiet: true, timeout: 5 * 60 * 1000 },
  );
  if (!json || output === "") return output;
  return JSON.parse(output);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function findOne(root, predicate, description) {
  const matches = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(candidate);
      else if (predicate(candidate)) matches.push(candidate);
    }
  }
  await walk(root);
  assert.equal(
    matches.length,
    1,
    `expected one ${description}, found ${matches.join(", ") || "none"}`,
  );
  return matches[0];
}

async function waitFor(check, description, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`timed out waiting for ${description}`, { cause: lastError });
}

async function fetchDriver(pathname, init = {}, timeout = 30_000) {
  let response;
  try {
    response = await fetch(`${DRIVER_URL}${pathname}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    throw new Error(
      `WebDriver ${init.method ?? "GET"} ${pathname} did not respond within ${timeout}ms`,
      { cause: error },
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.value?.error) {
    throw new Error(
      `WebDriver ${init.method ?? "GET"} ${pathname} failed: ${JSON.stringify(body)}`,
    );
  }
  return body.value ?? body;
}

async function startDriver(application, suffix) {
  const driverBinary = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    ".cargo",
    "bin",
    "tauri-driver.exe",
  );
  const logPath = path.join(EVIDENCE_ROOT, `tauri-driver-${suffix}.log`);
  const profile = `voyalier-acceptance-${suffix}`;
  assert.ok(DRIVER_SESSIONS.includes(suffix), "unexpected driver session");
  const userDataFolder = path.join(process.env.LOCALAPPDATA, "main", profile);
  await rm(userDataFolder, { recursive: true, force: true });
  await mkdir(userDataFolder, { recursive: true });
  const log = createWriteStream(logPath, { flags: "a" });
  await once(log, "open");
  const processHandle = spawn(driverBinary, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      VOYALIER_DATA_DIR: DATA_ROOT,
      VOYALIER_WINDOWS_WEBDRIVER_PROFILE: profile,
    },
    stdio: ["ignore", log, log],
    windowsHide: true,
  });
  processHandle.on("error", (error) =>
    log.write(`driver error: ${error.message}\n`),
  );
  await waitFor(
    async () => {
      const response = await fetch(`${DRIVER_URL}/status`, {
        signal: AbortSignal.timeout(1500),
      });
      return response.ok;
    },
    "tauri-driver",
    60_000,
  );
  const diagnostic = {
    session: suffix,
    isolatedUserDataFolder: true,
    nestedPortObserved: false,
    rootPortMirrored: false,
    copyErrorCode: null,
  };
  DRIVER_DIAGNOSTICS.push(diagnostic);
  const mirrorAbort = new AbortController();
  // WebView2 writes this file below EBWebView while EdgeDriver watches the
  // configured data-directory root. Mirror it while POST /session is blocked.
  // https://github.com/MicrosoftEdge/EdgeWebDriver/issues/109
  const mirrorPromise = mirrorWebViewDevToolsPort({
    userDataFolder,
    signal: mirrorAbort.signal,
  });
  let value;
  try {
    value = await fetchDriver(
      "/session",
      {
        method: "POST",
        body: JSON.stringify(
          buildWindowsDriverCapabilities({ application, userDataFolder }),
        ),
      },
      180_000,
    );
  } finally {
    mirrorAbort.abort();
    Object.assign(diagnostic, await mirrorPromise);
  }
  const sessionId = value.sessionId;
  assert.ok(sessionId, "tauri-driver did not return a session id");
  await waitFor(
    async () =>
      fetchDriver(`/session/${sessionId}/execute/sync`, {
        method: "POST",
        body: JSON.stringify({
          script: "return Boolean(window.__TAURI__?.core?.invoke)",
          args: [],
        }),
      }),
    "the packaged Tauri bridge",
  );
  return { processHandle, sessionId, log };
}

async function stopDriver(driver) {
  if (!driver) return;
  try {
    await fetchDriver(`/session/${driver.sessionId}`, { method: "DELETE" });
  } catch {
    // The updater intentionally destroys the old WebDriver session.
  }
  if (!driver.processHandle.killed) {
    spawnSync(
      "taskkill.exe",
      ["/PID", String(driver.processHandle.pid), "/T", "/F"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
  }
  driver.log.end();
  await waitFor(
    async () => {
      try {
        await fetch(`${DRIVER_URL}/status`, {
          signal: AbortSignal.timeout(500),
        });
        return false;
      } catch {
        return true;
      }
    },
    "tauri-driver to stop",
    30_000,
  ).catch(() => {});
}

async function execute(driver, script, args = []) {
  return fetchDriver(`/session/${driver.sessionId}/execute/sync`, {
    method: "POST",
    body: JSON.stringify({ script, args }),
  });
}

async function invoke(driver, command, input = null) {
  const result = await fetchDriver(
    `/session/${driver.sessionId}/execute/async`,
    {
      method: "POST",
      body: JSON.stringify({
        script: `
        const command = arguments[0];
        const input = arguments[1];
        const done = arguments[arguments.length - 1];
        const args = input === null ? undefined : { input };
        window.__TAURI__.core.invoke(command, args)
          .then((value) => done({ ok: true, value }))
          .catch((error) => done({
            ok: false,
            error: typeof error === "string" ? error : JSON.stringify(error),
          }));
      `,
        args: [command, input],
      }),
    },
  );
  if (!result?.ok)
    throw new Error(`${command} failed: ${result?.error ?? "unknown error"}`);
  return result.value;
}

async function screenshot(driver, name) {
  const encoded = await fetchDriver(`/session/${driver.sessionId}/screenshot`);
  await writeFile(
    path.join(EVIDENCE_ROOT, name),
    Buffer.from(encoded, "base64"),
  );
}

function installedProcesses(application) {
  const target = psQuote(path.resolve(application));
  const value = powershell(
    `$target = [IO.Path]::GetFullPath(${target}); ` +
      `@((Get-CimInstance Win32_Process | Where-Object { ` +
      `$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target ` +
      `} | Select-Object ProcessId, ExecutablePath, CreationDate)) | ConvertTo-Json -Compress`,
    { json: true },
  );
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stopInstalledProcesses(application) {
  const target = psQuote(path.resolve(application));
  powershell(
    `$target = [IO.Path]::GetFullPath(${target}); ` +
      `Get-CimInstance Win32_Process | Where-Object { ` +
      `$_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -eq $target ` +
      `} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
  );
}

function appListeners(application) {
  const processes = installedProcesses(application);
  if (processes.length === 0) return [];
  const pids = processes.map(({ ProcessId }) => Number(ProcessId));
  const values = powershell(
    `$pids = @(${pids.join(",")}); ` +
      `@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ` +
      `Where-Object { $pids -contains $_.OwningProcess } | ` +
      `Select-Object LocalAddress, LocalPort, OwningProcess) | ConvertTo-Json -Compress`,
    { json: true },
  );
  if (!values) return [];
  const rows = Array.isArray(values) ? values : [values];
  return rows.map((row) => ({
    address: row.LocalAddress,
    port: Number(row.LocalPort),
    processId: Number(row.OwningProcess),
    loopback: ["127.0.0.1", "::1"].includes(row.LocalAddress),
  }));
}

async function installApplication(installer) {
  run(installer, ["/S"], { timeout: 5 * 60 * 1000 });
  const installRoot = path.join(process.env.LOCALAPPDATA, "Voyalier");
  return waitFor(
    () =>
      findOne(
        installRoot,
        (candidate) =>
          candidate.toLowerCase().endsWith(".exe") &&
          path.basename(candidate).toLowerCase() !== "uninstall.exe",
        "installed Voyalier executable",
      ).catch(() => false),
    "the current-user Voyalier installation",
    120_000,
  );
}

async function uninstallApplication(application) {
  stopInstalledProcesses(application);
  const uninstaller = path.join(path.dirname(application), "uninstall.exe");
  await stat(uninstaller);
  run(uninstaller, ["/S"], { timeout: 5 * 60 * 1000 });
  await waitFor(
    async () => {
      try {
        await stat(application);
        return false;
      } catch {
        return true;
      }
    },
    "the application uninstall",
    120_000,
  );
}

async function startFixtureServer(manifest, installerPath, requestLog) {
  const installerName = path.basename(installerPath);
  const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const server = createServer(async (request, response) => {
    const remote = request.socket.remoteAddress ?? "unknown";
    requestLog.push({ method: request.method, url: request.url, remote });
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote);
    const allowedMethod = request.method === "GET" || request.method === "HEAD";
    if (
      !loopback ||
      !allowedMethod ||
      !allowedUpdaterPath(request.url, installerName)
    ) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found\n");
      return;
    }
    if (request.url === "/latest.json") {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": manifestBody.length,
        "cache-control": "no-store",
      });
      if (request.method !== "HEAD") response.end(manifestBody);
      else response.end();
      return;
    }
    const info = await stat(installerPath);
    response.writeHead(200, {
      "content-type": "application/vnd.microsoft.portable-executable",
      "content-length": info.size,
      "cache-control": "no-store",
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(installerPath).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  return server;
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function main() {
  assert.equal(
    process.platform,
    "win32",
    "this acceptance harness requires real Windows",
  );
  assert.ok(process.env.LOCALAPPDATA, "LOCALAPPDATA is required");
  await rm(EVIDENCE_ROOT, { recursive: true, force: true });
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  try {
    assert.equal(run(GIT, ["status", "--porcelain"], { quiet: true }), "");
  } catch (error) {
    await writeFile(
      path.join(EVIDENCE_ROOT, "windows-installed-updater.json"),
      `${JSON.stringify(
        {
          verdict: "FAIL",
          stage: "source-tree-guard",
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      )}\n`,
    );
    throw error;
  }
  const candidateSha = run(GIT, ["rev-parse", "HEAD"], { quiet: true });
  const baseSha = run(GIT, ["rev-parse", `${BASE_TAG}^{commit}`], {
    quiet: true,
  });
  const baseAutomationPatchSha256 = await sha256(BASE_AUTOMATION_PATCH);
  const configuredVersion = JSON.parse(
    await readFile(
      path.join(ROOT, "apps/desktop/src-tauri/tauri.conf.json"),
      "utf8",
    ),
  ).version;
  assert.equal(configuredVersion, CANDIDATE_VERSION);

  await mkdir(TEMP_ROOT, { recursive: true });
  await mkdir(FIXTURE_ROOT, { recursive: true });
  await mkdir(DATA_ROOT, { recursive: true });

  let driver;
  let server;
  let application;
  let candidateInstaller;
  let baseWorktreeAdded = false;
  const requestLog = [];
  const report = {
    verdict: "FAIL",
    candidate: { version: CANDIDATE_VERSION, sha: candidateSha },
    base: {
      version: BASE_VERSION,
      tag: BASE_TAG,
      sha: baseSha,
      automationPatch: {
        file: path.relative(ROOT, BASE_AUTOMATION_PATCH).replaceAll("\\", "/"),
        sha256: baseAutomationPatchSha256,
        changedFiles: [BASE_AUTOMATION_FILE],
      },
    },
    workflow: {
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    },
    driver: { sessions: DRIVER_DIAGNOSTICS },
  };

  try {
    run(GIT, ["worktree", "add", "--detach", BASE_ROOT, BASE_TAG]);
    baseWorktreeAdded = true;
    run(GIT, ["apply", "--check", BASE_AUTOMATION_PATCH], { cwd: BASE_ROOT });
    run(GIT, ["apply", BASE_AUTOMATION_PATCH], { cwd: BASE_ROOT });
    assert.equal(
      run(GIT, ["status", "--porcelain"], {
        cwd: BASE_ROOT,
        quiet: true,
      }),
      ` M ${BASE_AUTOMATION_FILE}`,
      "the base adaptation must modify only the pinned automation seam",
    );
    runPnpm(["install", "--frozen-lockfile"], { cwd: BASE_ROOT });

    const password = randomBytes(32).toString("base64url");
    runPnpm(
      [
        "--dir",
        path.join(ROOT, "apps/desktop"),
        "exec",
        "tauri",
        "signer",
        "generate",
        "--ci",
        "--password",
        password,
        "--write-keys",
        KEY_PATH,
      ],
      { quiet: true },
    );
    const publicKey = (await readFile(`${KEY_PATH}.pub`, "utf8")).trim();
    assert.ok(
      publicKey.startsWith("dW50cnVzdGVkIGNvbW1lbnQ6"),
      "unexpected public key shape",
    );

    const updaterConfig = {
      bundle: { createUpdaterArtifacts: true },
      plugins: {
        updater: {
          endpoints: [`${ORIGIN}/latest.json`],
          pubkey: publicKey,
          dangerousInsecureTransportProtocol: true,
        },
      },
    };
    const candidateConfig = path.join(TEMP_ROOT, "candidate-config.json");
    const baseConfig = path.join(TEMP_ROOT, "base-config.json");
    await writeFile(
      candidateConfig,
      `${JSON.stringify(updaterConfig, null, 2)}\n`,
    );
    await writeFile(
      baseConfig,
      `${JSON.stringify(
        {
          ...updaterConfig,
          bundle: { createUpdaterArtifacts: false },
        },
        null,
        2,
      )}\n`,
    );

    try {
      runPnpm(
        [
          "--dir",
          path.join(ROOT, "apps/desktop"),
          "exec",
          "tauri",
          "build",
          "--ci",
          "--bundles",
          "nsis",
          "--config",
          candidateConfig,
        ],
        {
          env: {
            ...process.env,
            TAURI_SIGNING_PRIVATE_KEY: KEY_PATH,
            TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
          },
        },
      );
    } finally {
      await rm(KEY_PATH, { force: true });
    }

    const candidateBundleRoot = path.join(ROOT, "target/release/bundle/nsis");
    const builtCandidate = await findOne(
      candidateBundleRoot,
      (candidate) => candidate.toLowerCase().endsWith("-setup.exe"),
      "candidate NSIS installer",
    );
    const builtSignature = `${builtCandidate}.sig`;
    await stat(builtSignature);
    candidateInstaller = path.join(FIXTURE_ROOT, path.basename(builtCandidate));
    await copyFile(builtCandidate, candidateInstaller);
    await copyFile(builtSignature, `${candidateInstaller}.sig`);
    const signature = (
      await readFile(`${candidateInstaller}.sig`, "utf8")
    ).trim();

    runPnpm(
      [
        "--dir",
        path.join(BASE_ROOT, "apps/desktop"),
        "exec",
        "tauri",
        "build",
        "--ci",
        "--bundles",
        "nsis",
        "--config",
        baseConfig,
      ],
      { cwd: BASE_ROOT },
    );
    const baseInstaller = await findOne(
      path.join(BASE_ROOT, "target/release/bundle/nsis"),
      (candidate) => candidate.toLowerCase().endsWith("-setup.exe"),
      "base NSIS installer",
    );

    const manifest = buildWindowsUpdaterManifest({
      version: CANDIDATE_VERSION,
      installerName: path.basename(candidateInstaller),
      signature,
      origin: ORIGIN,
    });
    const manifestPath = path.join(FIXTURE_ROOT, "latest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    report.artifact = {
      name: path.basename(candidateInstaller),
      bytes: (await stat(candidateInstaller)).size,
      sha256: await sha256(candidateInstaller),
      signatureSha256: await sha256(`${candidateInstaller}.sig`),
      manifestSha256: await sha256(manifestPath),
      manifestPlatforms: Object.keys(manifest.platforms),
    };

    application = await installApplication(baseInstaller);
    const expectedInstallRoot = path.join(process.env.LOCALAPPDATA, "Voyalier");
    assert.equal(path.dirname(application), expectedInstallRoot);
    server = await startFixtureServer(manifest, candidateInstaller, requestLog);

    report.stage = "base-driver-session";
    driver = await startDriver(application, "base");
    report.stage = "base-product-journey";
    const baseStatus = await invoke(driver, "updater_check");
    assert.equal(baseStatus.currentVersion, BASE_VERSION);
    assert.equal(baseStatus.status, "available");
    assert.equal(baseStatus.availableVersion, CANDIDATE_VERSION);
    const health = await invoke(driver, "health", {});
    assert.equal(health.intelligenceMode, "local");
    const trip = await invoke(driver, "create_trip", {
      title: TRIP_TITLE,
      origin: "Chicago",
      destination: "Kyoto",
      startDate: "2027-04-01",
      endDate: "2027-04-10",
    });
    assert.ok(trip.id);
    const tripsBefore = await invoke(driver, "list_trips", {});
    assert.deepEqual(
      tripsBefore.map(({ title }) => title),
      [TRIP_TITLE],
    );
    const backup = await invoke(driver, "backup_database", {
      label: "v0.11.0",
    });
    assert.ok(backup.fileName || backup.path || backup.createdAt);
    await screenshot(driver, "01-installed-v0.10.7.png");
    const baseProcesses = installedProcesses(application);
    assert.ok(
      baseProcesses.length >= 1,
      "the installed base process was not observed",
    );
    const basePids = new Set(
      baseProcesses.map(({ ProcessId }) => Number(ProcessId)),
    );

    report.stage = "updater-swap";
    await execute(
      driver,
      "window.__TAURI__.core.invoke('updater_install').catch(() => {}); return 'started';",
    );
    await waitFor(
      () =>
        requestLog.some(({ url }) =>
          String(url).endsWith(path.basename(candidateInstaller)),
        ),
      "the updater artifact request",
      180_000,
    );
    const reopened = await waitFor(
      () => {
        const processes = installedProcesses(application);
        return (
          processes.find(({ ProcessId }) => !basePids.has(Number(ProcessId))) ||
          false
        );
      },
      "the updated app to reopen",
      5 * 60 * 1000,
    );
    report.reopenedProcessId = Number(reopened.ProcessId);

    await stopDriver(driver);
    driver = undefined;
    stopInstalledProcesses(application);
    report.stage = "updated-driver-session";
    driver = await startDriver(application, "updated");
    report.stage = "updated-product-journey";
    const candidateStatus = await invoke(driver, "updater_check");
    assert.equal(candidateStatus.currentVersion, CANDIDATE_VERSION);
    assert.equal(candidateStatus.status, "upToDate");
    const tripsAfter = await invoke(driver, "list_trips", {});
    assert.deepEqual(
      tripsAfter.map(({ title }) => title),
      [TRIP_TITLE],
    );
    await screenshot(driver, "02-updated-v0.11.0.png");
    const listeners = appListeners(application);
    assert.ok(listeners.every(({ loopback }) => loopback));
    const backups = await readdir(path.join(DATA_ROOT, "backups")).catch(
      () => [],
    );
    assert.ok(backups.length >= 1, "the pre-update backup was not found");

    await stopDriver(driver);
    driver = undefined;
    await uninstallApplication(application);
    await stat(path.join(DATA_ROOT, "voyalier.sqlite3"));
    application = await installApplication(candidateInstaller);
    report.stage = "recovery-driver-session";
    driver = await startDriver(application, "recovery");
    report.stage = "recovery-product-journey";
    const recoveryStatus = await invoke(driver, "updater_check");
    assert.equal(recoveryStatus.currentVersion, CANDIDATE_VERSION);
    const tripsAfterRecovery = await invoke(driver, "list_trips", {});
    assert.deepEqual(
      tripsAfterRecovery.map(({ title }) => title),
      [TRIP_TITLE],
    );
    await screenshot(driver, "03-reinstall-recovery-v0.11.0.png");

    const requestPaths = requestLog.map(({ url }) => String(url).split("?")[0]);
    const nonLoopbackRequests = requestLog.filter(
      ({ remote }) =>
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote),
    ).length;
    Object.assign(report, {
      verdict: "PASS",
      stage: "complete",
      installed: {
        path: application,
        before: baseStatus.currentVersion,
        after: candidateStatus.currentVersion,
        recovery: recoveryStatus.currentVersion,
      },
      data: {
        databaseFile: "voyalier.sqlite3",
        tripTitle: TRIP_TITLE,
        tripCountBefore: tripsBefore.length,
        tripCountAfter: tripsAfter.length,
        tripCountAfterRecovery: tripsAfterRecovery.length,
        backupCount: backups.length,
      },
      network: {
        endpoint: `${ORIGIN}/latest.json`,
        requests: requestPaths,
        nonLoopbackRequests,
        listeners,
      },
    });
    validateWindowsAcceptanceReport(report);
    await writeFile(
      path.join(EVIDENCE_ROOT, "windows-installed-updater.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writeFile(
      path.join(EVIDENCE_ROOT, "summary.md"),
      [
        "# Windows installed updater acceptance",
        "",
        `- Verdict: **${report.verdict}**`,
        `- Candidate: \`${candidateSha}\` / ${CANDIDATE_VERSION}`,
        `- Base: \`${baseSha}\` / ${BASE_TAG}`,
        `- Base automation patch SHA-256: \`${baseAutomationPatchSha256}\``,
        `- Base adaptation: WebView2 automation only (not the historical installer binary)`,
        `- Installed path: \`${application}\``,
        `- Swap: ${baseStatus.currentVersion} -> ${candidateStatus.currentVersion}`,
        `- Reinstall recovery: ${recoveryStatus.currentVersion}`,
        `- Traveler-owned trip preserved: ${tripsAfterRecovery.length === 1 ? "yes" : "no"}`,
        `- Pre-update backups observed: ${backups.length}`,
        `- Fixture requests: ${requestPaths.join(", ")}`,
        `- Candidate SHA-256: \`${report.artifact.sha256}\``,
        "",
      ].join("\n"),
    );
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.network = {
      requests: requestLog.map(({ url }) => String(url)),
      nonLoopbackRequests: requestLog.filter(
        ({ remote }) =>
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote),
      ).length,
      listeners: application ? appListeners(application) : [],
    };
    await writeFile(
      path.join(EVIDENCE_ROOT, "windows-installed-updater.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    throw error;
  } finally {
    await stopDriver(driver).catch(() => {});
    if (application) stopInstalledProcesses(application);
    await closeServer(server).catch(() => {});
    await rm(KEY_PATH, { force: true });
    await rm(`${KEY_PATH}.pub`, { force: true });
    if (baseWorktreeAdded) {
      run(GIT, ["worktree", "remove", "--force", BASE_ROOT], {
        quiet: true,
        timeout: 5 * 60 * 1000,
      });
    }
    for (const suffix of DRIVER_SESSIONS) {
      await rm(
        path.join(
          process.env.LOCALAPPDATA,
          "main",
          `voyalier-acceptance-${suffix}`,
        ),
        { recursive: true, force: true },
      );
    }
    await rm(TEMP_ROOT, { recursive: true, force: true });
  }
}

await main();
