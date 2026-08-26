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
  clearWebViewDevToolsPorts,
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
const PACKING_LABEL = "Museum pass";
const MANUAL_ITEM_TITLE = "Tea ceremony";
const MANUAL_ITEM_LOCATION = "Gion";
const RESTORE_SENTINEL = "Post-backup sentinel";
const PORTABLE_BACKUP_NAME = "voyalier-portable-acceptance.vbk";
const JOURNEY_STARTED_AT = new Date();
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
const DRIVER_PROFILE = "voyalier-acceptance-journey";
let driverProfilePrepared = false;

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
  assert.ok(DRIVER_SESSIONS.includes(suffix), "unexpected driver session");
  const userDataFolder = path.join(
    process.env.LOCALAPPDATA,
    "main",
    DRIVER_PROFILE,
  );
  const preservedExistingProfile = driverProfilePrepared;
  if (!driverProfilePrepared) {
    assert.equal(
      suffix,
      "base",
      "the shared driver profile must start at base",
    );
    await rm(userDataFolder, { recursive: true, force: true });
    await mkdir(userDataFolder, { recursive: true });
    driverProfilePrepared = true;
  } else {
    assert.ok(
      (await stat(userDataFolder)).isDirectory(),
      "the shared driver profile disappeared between installed sessions",
    );
  }
  // Keep localStorage and the rest of the shared profile, but never let the
  // next EdgeDriver session consume a mirrored port from the prior process.
  await clearWebViewDevToolsPorts(userDataFolder);
  const log = createWriteStream(logPath, { flags: "a" });
  await once(log, "open");
  const processHandle = spawn(driverBinary, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      VOYALIER_DATA_DIR: DATA_ROOT,
      VOYALIER_WINDOWS_WEBDRIVER_PROFILE: DRIVER_PROFILE,
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
    profile: DRIVER_PROFILE,
    preservedExistingProfile,
    stalePortFilesCleared: true,
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

function isoDay(offset) {
  const date = new Date(JOURNEY_STARTED_AT);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function clickText(
  driver,
  text,
  { selector = "button", root = null, exact = true, last = false } = {},
) {
  return waitFor(
    () =>
      execute(
        driver,
        `
          const [wanted, selector, rootSelector, exact, last] = arguments;
          const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
          const scope = rootSelector ? document.querySelector(rootSelector) : document;
          if (!scope) return false;
          const candidates = Array.from(scope.querySelectorAll(selector)).filter((element) => {
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden") return false;
            if (element.disabled || element.getAttribute("aria-disabled") === "true") return false;
            const actual = normalize(element.innerText || element.textContent);
            return exact ? actual === normalize(wanted) : actual.includes(normalize(wanted));
          });
          const element = last ? candidates.at(-1) : candidates[0];
          if (!element) return false;
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
          return true;
        `,
        [text, selector, root, exact, last],
      ),
    `${selector} labelled ${text}`,
  );
}

async function clickAriaLabel(
  driver,
  label,
  { selector = "button", prefix = false } = {},
) {
  return waitFor(
    () =>
      execute(
        driver,
        `
          const [wanted, selector, prefix] = arguments;
          const elements = Array.from(document.querySelectorAll(selector));
          const element = elements.find((candidate) => {
            const actual = candidate.getAttribute("aria-label") ?? "";
            const style = getComputedStyle(candidate);
            const enabled = !candidate.disabled && candidate.getAttribute("aria-disabled") !== "true";
            const visible = style.display !== "none" && style.visibility !== "hidden";
            return enabled && visible && (prefix ? actual.startsWith(wanted) : actual === wanted);
          });
          if (!element) return false;
          const actual = element.getAttribute("aria-label");
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
          return actual;
        `,
        [label, selector, prefix],
      ),
    `${selector} with aria-label ${prefix ? "starting with " : ""}${label}`,
  );
}

async function fillByLabel(driver, labelText, value, { root = null } = {}) {
  return waitFor(
    () =>
      execute(
        driver,
        `
          const [wanted, value, rootSelector] = arguments;
          const normalize = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
          const scope = rootSelector ? document.querySelector(rootSelector) : document;
          if (!scope) return false;
          const label = Array.from(scope.querySelectorAll("label")).find((candidate) =>
            normalize(candidate.innerText || candidate.textContent).startsWith(normalize(wanted)),
          );
          if (!label) return false;
          const field = label.control ||
            (label.htmlFor ? document.getElementById(label.htmlFor) : null) ||
            label.querySelector("input, textarea, select");
          if (!field) return false;
          field.focus();
          const prototype = field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : field instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (!setter) return false;
          setter.call(field, value);
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
          return field.value === value;
        `,
        [labelText, value, root],
      ),
    `field labelled ${labelText}`,
  );
}

async function setCheckbox(driver, labelText, checked) {
  await waitFor(
    () =>
      execute(
        driver,
        `
          const [wanted, checked] = arguments;
          const normalize = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
          const label = Array.from(document.querySelectorAll("label")).find((candidate) =>
            normalize(candidate.innerText || candidate.textContent) === normalize(wanted),
          );
          const field = label?.control || label?.querySelector('input[type="checkbox"]');
          if (!field) return false;
          if (field.checked !== checked) field.click();
          return field.checked === checked;
        `,
        [labelText, checked],
      ),
    `checkbox ${labelText} to become ${checked ? "checked" : "unchecked"}`,
  );
}

async function readCheckboxState(driver, labelText, root) {
  return waitFor(
    () =>
      execute(
        driver,
        `
          const [wanted, rootSelector] = arguments;
          const normalize = (text) => String(text ?? "").replace(/\\s+/g, " ").trim();
          const scope = document.querySelector(rootSelector);
          if (!scope) return false;
          const label = Array.from(scope.querySelectorAll("label")).find(
            (candidate) => normalize(candidate.innerText || candidate.textContent) === normalize(wanted),
          );
          const field = label?.control || label?.querySelector('input[type="checkbox"]');
          if (!(field instanceof HTMLInputElement) || field.type !== "checkbox") return false;
          return { observed: true, checked: field.checked };
        `,
        [labelText, root],
      ),
    `checkbox ${labelText} inside ${root}`,
  );
}

async function waitForText(driver, text, { root = "body" } = {}) {
  return waitFor(
    () =>
      execute(
        driver,
        `
          const [selector, wanted] = arguments;
          const element = document.querySelector(selector);
          return Boolean(element?.innerText?.includes(wanted));
        `,
        [root, text],
      ),
    `${root} to contain ${text}`,
  );
}

function preservationSnapshot(detail, today, savedPlaceName, expectedIds) {
  const savedPlace = detail.savedPlaces.find(
    ({ name }) => name === savedPlaceName,
  );
  const packingItem = detail.packingItems.find(
    ({ label }) => label === PACKING_LABEL,
  );
  const manualItem = detail.tripItems.find(
    ({ title }) => title === MANUAL_ITEM_TITLE,
  );
  const todayItem = today.today.find(
    ({ title }) => title === MANUAL_ITEM_TITLE,
  );
  assert.ok(savedPlace, "the saved place was not preserved");
  assert.ok(packingItem, "the packing item was not preserved");
  assert.equal(packingItem.checked, true, "the packed state was not preserved");
  assert.ok(manualItem, "the manual plan item was not preserved");
  assert.equal(manualItem.startAt?.slice(0, 10), isoDay(0));
  assert.equal(today.referenceDate, isoDay(0));
  assert.ok(todayItem, "Today did not include the manual plan item");
  assert.equal(todayItem.date, isoDay(0));

  const snapshot = {
    savedPlaceId: savedPlace.id,
    savedPlaceName: savedPlace.name,
    packingItemId: packingItem.id,
    packingLabel: packingItem.label,
    packingChecked: packingItem.checked,
    manualItemId: manualItem.id,
    manualItemTitle: manualItem.title,
    manualItemStartAt: manualItem.startAt,
    todayReferenceDate: today.referenceDate,
    todayContainsManualItem: true,
  };
  if (expectedIds) {
    assert.equal(snapshot.savedPlaceId, expectedIds.savedPlaceId);
    assert.equal(snapshot.packingItemId, expectedIds.packingItemId);
    assert.equal(snapshot.manualItemId, expectedIds.manualItemId);
  }
  return snapshot;
}

async function observePreservedJourneyUi(driver, savedPlaceName) {
  await waitForText(driver, MANUAL_ITEM_TITLE, { root: ".voy-today" });
  await waitForText(driver, savedPlaceName, {
    root: 'section[aria-labelledby="saved-places-title"]',
  });
  const packing = await readCheckboxState(
    driver,
    PACKING_LABEL,
    'section[aria-labelledby="packing-checklist-title"]',
  );
  assert.equal(
    packing.checked,
    true,
    "the installed UI rendered the preserved packing item as unchecked",
  );
  return {
    savedPlaceObserved: true,
    packingCheckboxObserved: packing.observed,
    packingCheckboxChecked: packing.checked,
    todayObserved: true,
  };
}

async function readText(driver, selector) {
  return waitFor(
    () =>
      execute(
        driver,
        `
          const element = document.querySelector(arguments[0]);
          const text = element?.innerText?.replace(/\\s+/g, " ").trim();
          return text || false;
        `,
        [selector],
      ),
    `${selector} to contain text`,
  );
}

async function currentLocale(driver) {
  return execute(driver, "return document.documentElement.lang");
}

async function waitForLocale(driver, expected) {
  return waitFor(
    async () => ((await currentLocale(driver)) === expected ? expected : false),
    `document locale ${expected}`,
  );
}

async function backupCount() {
  return (await readdir(path.join(DATA_ROOT, "backups")).catch(() => []))
    .length;
}

function handleNativeFileDialog(title, filePath, action) {
  const relativePath = path.win32.relative(TEMP_ROOT, filePath);
  const selectedPathWithinTemp =
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.win32.sep}`) &&
    !path.win32.isAbsolute(relativePath);
  assert.ok(
    path.win32.isAbsolute(filePath) && selectedPathWithinTemp,
    "native dialog path must stay inside the disposable acceptance root",
  );
  assert.ok(
    ["Save", "Open"].includes(action),
    "native dialog action must be Save or Open",
  );
  powershell(
    `Add-Type -AssemblyName UIAutomationClient; ` +
      `Add-Type -AssemblyName UIAutomationTypes; ` +
      `$title = ${psQuote(title)}; $value = ${psQuote(filePath)}; ` +
      `$action = ${psQuote(action)}; ` +
      `$root = [System.Windows.Automation.AutomationElement]::RootElement; ` +
      `$titleCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty, $title); ` +
      `$fileNameCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001'); ` +
      `$actionCondition = [System.Windows.Automation.PropertyCondition]::new(` +
      `[System.Windows.Automation.AutomationElement]::NameProperty, $action); ` +
      `$deadline = (Get-Date).AddSeconds(90); ` +
      `do { ` +
      `$dialogs = $root.FindAll(` +
      `[System.Windows.Automation.TreeScope]::Children, $titleCondition); ` +
      `if ($dialogs.Count -gt 1) { throw 'multiple matching native dialogs' }; ` +
      `if ($dialogs.Count -eq 1) { ` +
      `$dialog = $dialogs.Item(0); ` +
      `$fileNames = $dialog.FindAll(` +
      `[System.Windows.Automation.TreeScope]::Descendants, $fileNameCondition); ` +
      `$actions = $dialog.FindAll(` +
      `[System.Windows.Automation.TreeScope]::Descendants, $actionCondition); ` +
      `if ($fileNames.Count -gt 1) { throw 'multiple filename controls' }; ` +
      `if ($actions.Count -gt 1) { throw 'multiple matching dialog actions' }; ` +
      `if ($fileNames.Count -eq 1 -and $actions.Count -eq 1) { ` +
      `$fileName = $fileNames.Item(0); $actionButton = $actions.Item(0); ` +
      `if ($fileName.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::ControlTypeProperty) ` +
      `-ne [System.Windows.Automation.ControlType]::Edit) { ` +
      `throw 'filename control is not an edit control' }; ` +
      `if ($actionButton.GetCurrentPropertyValue(` +
      `[System.Windows.Automation.AutomationElement]::ControlTypeProperty) ` +
      `-ne [System.Windows.Automation.ControlType]::Button) { ` +
      `throw 'dialog action is not a button' }; ` +
      `$valuePattern = $fileName.GetCurrentPattern(` +
      `[System.Windows.Automation.ValuePattern]::Pattern); ` +
      `$valuePattern.SetValue($value); ` +
      `if ($valuePattern.Current.Value -cne $value) { ` +
      `throw 'native dialog filename readback did not match' }; ` +
      `$invokePattern = $actionButton.GetCurrentPattern(` +
      `[System.Windows.Automation.InvokePattern]::Pattern); ` +
      `$invokePattern.Invoke(); exit 0 ` +
      `} }; Start-Sleep -Milliseconds 250 ` +
      `} while ((Get-Date) -lt $deadline); ` +
      `throw 'native Voyalier file dialog did not appear'`,
  );
  return { nativeDialogPathConfirmed: true, selectedPathWithinTemp };
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
    driver: {
      sharedJourneyProfile: true,
      sessions: DRIVER_DIAGNOSTICS,
    },
    preservation: {},
    ui: {},
  };

  try {
    run(GIT, ["worktree", "add", "--detach", BASE_ROOT, BASE_TAG]);
    baseWorktreeAdded = true;
    run(GIT, ["apply", "--unidiff-zero", "--check", BASE_AUTOMATION_PATCH], {
      cwd: BASE_ROOT,
    });
    run(GIT, ["apply", "--unidiff-zero", BASE_AUTOMATION_PATCH], {
      cwd: BASE_ROOT,
    });
    assert.equal(
      run(GIT, ["status", "--porcelain"], {
        cwd: BASE_ROOT,
        quiet: true,
      }),
      `M ${BASE_AUTOMATION_FILE}`,
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

    await waitForText(driver, "Trips");
    await clickText(driver, "Create a trip");
    await fillByLabel(driver, "From", "Chicago", { root: '[role="dialog"]' });
    await fillByLabel(driver, "To", "Kyoto", { root: '[role="dialog"]' });
    await fillByLabel(driver, "Start date", isoDay(-1), {
      root: '[role="dialog"]',
    });
    await fillByLabel(driver, "End date", isoDay(1), {
      root: '[role="dialog"]',
    });
    await fillByLabel(driver, "Trip name (optional)", TRIP_TITLE, {
      root: '[role="dialog"]',
    });
    await clickText(driver, "Create trip", { root: '[role="dialog"]' });
    await clickAriaLabel(driver, `Open ${TRIP_TITLE}`);
    await waitForText(driver, TRIP_TITLE);

    await clickText(driver, "Discover", { selector: "a" });
    await clickText(driver, "Download Kyoto city data", {
      root: ".voy-packs",
    });
    const cityPackSummary = await readText(driver, ".voy-packs__count");
    const cityPackPlaceMatch = cityPackSummary.match(/^([\d,]+) places?/);
    assert.ok(
      cityPackPlaceMatch && cityPackSummary.includes("offline"),
      `unexpected downloaded Kyoto pack summary: ${cityPackSummary}`,
    );
    const cityPackPlaceCount = Number(
      cityPackPlaceMatch[1].replaceAll(",", ""),
    );
    assert.ok(
      cityPackPlaceCount > 0,
      "the downloaded Kyoto pack had no places",
    );
    await clickText(driver, "Get recommendations", { root: ".voy-recs" });
    const savedPlaceName = await waitFor(
      () =>
        execute(
          driver,
          `
            const row = Array.from(document.querySelectorAll(".voy-recs__row")).find(
              (candidate) => Array.from(candidate.querySelectorAll("button")).some(
                (button) => button.textContent?.trim() === "Save place",
              ),
            );
            return row?.querySelector(".voy-recs__name")?.textContent?.trim() || false;
          `,
        ),
      "the first recommendation name",
    );
    assert.ok(savedPlaceName, "the saved recommendation name was not observed");
    await clickText(driver, "Save place", { root: ".voy-recs" });
    await waitForText(driver, "Saved", { root: ".voy-recs" });

    await clickText(driver, "Plan", { selector: "a" });
    await fillByLabel(driver, "Custom item", PACKING_LABEL, {
      root: ".voy-planning__inline-form",
    });
    await clickText(driver, "Add", {
      root: ".voy-planning__inline-form",
    });
    await setCheckbox(driver, PACKING_LABEL, true);

    await fillByLabel(driver, "Name", MANUAL_ITEM_TITLE, {
      root: ".voy-planning__item-form",
    });
    await fillByLabel(driver, "Location (optional)", MANUAL_ITEM_LOCATION, {
      root: ".voy-planning__item-form",
    });
    await fillByLabel(driver, "Start (optional)", `${isoDay(0)}T12:00`, {
      root: ".voy-planning__item-form",
    });
    await clickText(driver, "Add to plan", {
      root: ".voy-planning__item-form",
    });
    const baseUi = await observePreservedJourneyUi(driver, savedPlaceName);
    report.ui.base = baseUi;

    await clickAriaLabel(driver, "Search workspace");
    await fillByLabel(driver, "Search all trips", MANUAL_ITEM_TITLE, {
      root: ".voy-workspace-search",
    });
    await clickText(driver, "Search", { root: ".voy-workspace-search" });
    await waitForText(driver, MANUAL_ITEM_TITLE, {
      root: ".voy-workspace-search",
    });
    await waitForText(driver, TRIP_TITLE, { root: ".voy-workspace-search" });
    await clickText(driver, "Back");
    await waitForText(driver, TRIP_TITLE);

    const tripsBefore = await invoke(driver, "list_trips", {});
    assert.deepEqual(
      tripsBefore.map(({ title }) => title),
      [TRIP_TITLE],
    );
    const tripId = tripsBefore[0].id;
    const detailBefore = await invoke(driver, "get_trip", { tripId });
    const todayBefore = await invoke(driver, "get_today", { tripId });
    assert.equal(detailBefore.savedPlaces.length, 1);
    assert.equal(detailBefore.savedPlaces[0].name, savedPlaceName);
    assert.equal(
      detailBefore.packingItems.find(({ label }) => label === PACKING_LABEL)
        ?.checked,
      true,
    );
    assert.ok(
      detailBefore.tripItems.some(({ title }) => title === MANUAL_ITEM_TITLE),
      "the UI-created manual item was not persisted",
    );
    const basePreservation = preservationSnapshot(
      detailBefore,
      todayBefore,
      savedPlaceName,
    );
    report.preservation.base = basePreservation;
    await screenshot(driver, "01-base-installed-product-journey.png");

    await clickAriaLabel(driver, "Settings");
    await fillByLabel(driver, "Language", "es");
    await waitForText(driver, "Configuración");
    const localeBeforeUpdate = await waitForLocale(driver, "es");
    assert.equal(localeBeforeUpdate, "es");
    await clickText(driver, "No, lo haré manualmente", {
      root: ".voy-updates",
    });
    await clickText(driver, "Buscar actualizaciones", {
      root: ".voy-updates",
    });
    await waitForText(
      driver,
      `Actualización disponible: ${CANDIDATE_VERSION}`,
      {
        root: ".voy-updates",
      },
    );
    const backupCountBeforeUpdater = await backupCount();
    assert.equal(
      backupCountBeforeUpdater,
      0,
      "the disposable workspace unexpectedly had a pre-existing updater backup",
    );
    await screenshot(driver, "02-base-production-updater-ready.png");
    const baseProcesses = installedProcesses(application);
    assert.ok(
      baseProcesses.length >= 1,
      "the installed base process was not observed",
    );
    const basePids = new Set(
      baseProcesses.map(({ ProcessId }) => Number(ProcessId)),
    );

    report.stage = "updater-swap";
    await clickText(driver, "Actualizar y reiniciar", {
      root: ".voy-updates",
    });
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
    const backupCountAfterUpdater = await waitFor(async () => {
      const count = await backupCount();
      return count === backupCountBeforeUpdater + 1 ? count : false;
    }, "the production updater controller's pre-update backup");

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
    const localeAfterUpdate = await waitForLocale(driver, "es");
    assert.equal(localeAfterUpdate, "es");
    await clickAriaLabel(driver, "Voyalier — todos los viajes");
    await clickAriaLabel(driver, `Abrir ${TRIP_TITLE}`);
    await clickText(driver, "Planificar", { selector: "a" });
    const detailAfter = await invoke(driver, "get_trip", { tripId });
    const todayAfter = await invoke(driver, "get_today", { tripId });
    assert.equal(detailAfter.savedPlaces.length, 1);
    assert.equal(detailAfter.savedPlaces[0].name, savedPlaceName);
    assert.equal(
      detailAfter.packingItems.find(({ label }) => label === PACKING_LABEL)
        ?.checked,
      true,
    );
    assert.ok(
      detailAfter.tripItems.some(({ title }) => title === MANUAL_ITEM_TITLE),
    );
    report.preservation.updated = preservationSnapshot(
      detailAfter,
      todayAfter,
      savedPlaceName,
      basePreservation,
    );
    report.ui.updated = await observePreservedJourneyUi(driver, savedPlaceName);
    await clickAriaLabel(driver, "Buscar en el espacio de trabajo");
    await fillByLabel(driver, "Buscar en todos los viajes", MANUAL_ITEM_TITLE, {
      root: ".voy-workspace-search",
    });
    await clickText(driver, "Buscar", { root: ".voy-workspace-search" });
    await waitForText(driver, MANUAL_ITEM_TITLE, {
      root: ".voy-workspace-search",
    });
    await waitForText(driver, TRIP_TITLE, { root: ".voy-workspace-search" });
    await clickText(driver, "Volver");
    await waitForText(driver, TRIP_TITLE);
    await screenshot(driver, "03-updated-product-journey.png");
    const listeners = appListeners(application);
    assert.ok(listeners.every(({ loopback }) => loopback));

    report.stage = "portable-backup";
    await clickAriaLabel(driver, "Configuración");
    const portablePassphrase = randomBytes(24).toString("base64url");
    const portableBackupPath = path.join(TEMP_ROOT, PORTABLE_BACKUP_NAME);
    await clickText(driver, "Guardar copia de seguridad", {
      root: ".voy-backup",
    });
    await fillByLabel(
      driver,
      "Frase de contraseña de copia",
      portablePassphrase,
      {
        root: ".voy-backup__form",
      },
    );
    await fillByLabel(
      driver,
      "Confirmar frase de contraseña",
      portablePassphrase,
      {
        root: ".voy-backup__form",
      },
    );
    await clickText(driver, "Guardar copia", {
      root: ".voy-backup__form",
    });
    const portableBackupDialog = handleNativeFileDialog(
      "Save Voyalier backup",
      portableBackupPath,
      "Save",
    );
    const portableBackupNotice = await readText(driver, ".voy-backup__notice");
    assert.ok(
      portableBackupNotice.endsWith(portableBackupPath),
      `portable backup picker returned an unexpected path: ${portableBackupNotice}`,
    );
    const portableBackupStat = await stat(portableBackupPath);
    assert.ok(portableBackupStat.size > 0);
    const portableBackupSha256 = await sha256(portableBackupPath);
    await screenshot(driver, "04-portable-backup-exported.png");

    await clickText(driver, "Volver");
    await waitForText(driver, TRIP_TITLE);
    await clickText(driver, "Planificar", { selector: "a" });
    await fillByLabel(driver, "Nombre", RESTORE_SENTINEL, {
      root: ".voy-planning__item-form",
    });
    await fillByLabel(driver, "Inicio (opcional)", `${isoDay(0)}T18:00`, {
      root: ".voy-planning__item-form",
    });
    await clickText(driver, "Añadir al plan", {
      root: ".voy-planning__item-form",
    });
    await waitForText(driver, RESTORE_SENTINEL, {
      root: 'section[aria-labelledby="manual-plan-title"]',
    });
    const detailWithSentinel = await invoke(driver, "get_trip", { tripId });
    assert.ok(
      detailWithSentinel.tripItems.some(
        ({ title }) => title === RESTORE_SENTINEL,
      ),
    );

    await clickAriaLabel(driver, "Configuración");
    await clickText(driver, "Restaurar desde copia", {
      root: ".voy-backup",
    });
    await fillByLabel(
      driver,
      "Frase de contraseña de copia",
      portablePassphrase,
      {
        root: ".voy-backup__form",
      },
    );
    await clickText(driver, "Restaurar esta copia", {
      root: ".voy-backup__form",
    });
    const portableRestoreDialog = handleNativeFileDialog(
      "Choose a Voyalier backup",
      portableBackupPath,
      "Open",
    );
    await waitForText(driver, "Listo para restaurar la copia", {
      root: ".voy-backup",
    });
    assert.equal(await invoke(driver, "has_pending_restore", {}), true);
    await screenshot(driver, "05-portable-restore-staged.png");

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
    const localeAfterRecovery = await waitForLocale(driver, "es");
    assert.equal(localeAfterRecovery, "es");
    const detailAfterRecovery = await invoke(driver, "get_trip", { tripId });
    const todayAfterRecovery = await invoke(driver, "get_today", { tripId });
    assert.equal(detailAfterRecovery.savedPlaces.length, 1);
    assert.equal(detailAfterRecovery.savedPlaces[0].name, savedPlaceName);
    assert.equal(
      detailAfterRecovery.packingItems.find(
        ({ label }) => label === PACKING_LABEL,
      )?.checked,
      true,
    );
    assert.ok(
      detailAfterRecovery.tripItems.some(
        ({ title }) => title === MANUAL_ITEM_TITLE,
      ),
    );
    assert.equal(
      detailAfterRecovery.tripItems.some(
        ({ title }) => title === RESTORE_SENTINEL,
      ),
      false,
      "the post-backup sentinel survived, so the portable restore did not apply",
    );
    report.preservation.recovery = preservationSnapshot(
      detailAfterRecovery,
      todayAfterRecovery,
      savedPlaceName,
      basePreservation,
    );
    await clickAriaLabel(driver, "Voyalier — todos los viajes");
    await clickAriaLabel(driver, `Abrir ${TRIP_TITLE}`);
    await clickText(driver, "Planificar", { selector: "a" });
    report.ui.recovery = await observePreservedJourneyUi(
      driver,
      savedPlaceName,
    );
    await clickAriaLabel(driver, "Buscar en el espacio de trabajo");
    await fillByLabel(driver, "Buscar en todos los viajes", MANUAL_ITEM_TITLE, {
      root: ".voy-workspace-search",
    });
    await clickText(driver, "Buscar", { root: ".voy-workspace-search" });
    await waitForText(driver, MANUAL_ITEM_TITLE, {
      root: ".voy-workspace-search",
    });
    await screenshot(driver, "06-reinstall-restore-recovery.png");

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
        backupCount: await backupCount(),
      },
      journey: {
        tripCreatedViaUi: true,
        cityPackDownloadedViaUi: true,
        cityPackPlaceCount,
        savedPlaceName,
        packingLabel: PACKING_LABEL,
        packingChecked: true,
        manualItemTitle: MANUAL_ITEM_TITLE,
        todayObserved: true,
        searchObserved: true,
        localeBeforeUpdate,
        localeAfterUpdate,
        localeAfterRecovery,
      },
      updaterController: {
        triggeredViaUi: true,
        harnessBackupCommandUsed: false,
        backupCountBefore: backupCountBeforeUpdater,
        backupCountAfter: backupCountAfterUpdater,
      },
      portableBackup: {
        exportedViaUi: true,
        nativeDialogPathConfirmed:
          portableBackupDialog.nativeDialogPathConfirmed,
        selectedPathWithinTemp: portableBackupDialog.selectedPathWithinTemp,
        fileName: PORTABLE_BACKUP_NAME,
        bytes: portableBackupStat.size,
        sha256: portableBackupSha256,
      },
      portableRestore: {
        stagedViaUi: true,
        nativeDialogPathConfirmed:
          portableRestoreDialog.nativeDialogPathConfirmed,
        appliedAfterReinstall: true,
        postBackupSentinelAbsent: true,
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
        `- Installed UI journey preserved: ${tripsAfterRecovery.length === 1 ? "yes" : "no"}`,
        `- Saved place: ${savedPlaceName}`,
        `- Packing item checked: ${PACKING_LABEL}`,
        `- Today/search item: ${MANUAL_ITEM_TITLE}`,
        `- Locale across swap and recovery: es`,
        `- Production updater backup count: ${backupCountBeforeUpdater} -> ${backupCountAfterUpdater}`,
        `- Portable backup: ${PORTABLE_BACKUP_NAME} (${portableBackupStat.size} bytes, SHA-256 ${portableBackupSha256})`,
        `- Portable restore removed post-backup sentinel: yes`,
        `- Fixture requests: ${requestPaths.join(", ")}`,
        `- Candidate SHA-256: \`${report.artifact.sha256}\``,
        "",
      ].join("\n"),
    );
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    if (driver) {
      await screenshot(driver, "99-failure.png").catch(() => {});
      report.uiDiagnostic = await execute(
        driver,
        `
          return {
            locale: document.documentElement.lang,
            alerts: Array.from(document.querySelectorAll('[role="alert"]'))
              .map((element) => element.innerText?.replace(/\\s+/g, " ").trim())
              .filter(Boolean)
              .slice(0, 5),
            packSummary: document.querySelector('.voy-packs__count')
              ?.innerText?.replace(/\\s+/g, " ").trim() ?? null,
          };
        `,
      ).catch(() => null);
    }
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
    await rm(path.join(process.env.LOCALAPPDATA, "main", DRIVER_PROFILE), {
      recursive: true,
      force: true,
    });
    await rm(TEMP_ROOT, { recursive: true, force: true });
  }
}

await main();
