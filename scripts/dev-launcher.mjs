import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const WEB_ORIGIN = "http://127.0.0.1:5173";
const SOURCE_ENV_DENYLIST = [
  "DEBUG",
  "PWDEBUG",
  "VITE_LIVE_API",
  "VITE_LIVE_API_TOKEN",
  "VITE_LIVE_API_URL",
  "VITE_MOCK",
  "VOYALIER_BIND",
  "VOYALIER_BOOTSTRAP_FD",
  "VOYALIER_CREDENTIAL_FD",
  "VOYALIER_INTEGRATION_TEST",
  "VOYALIER_SOURCE_API_ORIGIN",
  "VOYALIER_SOURCE_LAUNCH_ID",
  "VOYALIER_TEST_API_TOKEN",
];

export function sanitizeSourceEnvironment(baseEnvironment, overrides = {}) {
  const sanitized = { ...baseEnvironment };
  for (const name of SOURCE_ENV_DENYLIST) delete sanitized[name];
  return { ...sanitized, ...overrides };
}

function waitForSuccess(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal ?? `status ${code}`})`));
    });
  });
}

function waitForLine(stream, child) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(
      () => reject(new Error("the local API did not publish its address")),
      120_000,
    );
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffered += chunk;
      const newline = buffered.indexOf("\n");
      if (newline !== -1) {
        clearTimeout(timeout);
        resolve(buffered.slice(0, newline).trim());
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`the local API exited before startup (status ${code})`));
    });
  });
}

async function waitForWeb(child, launchId) {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before startup (status ${child.exitCode})`);
    }
    try {
      const response = await fetch(WEB_ORIGIN);
      if (
        response.ok &&
        response.headers.get("x-voyalier-source-launch") === launchId
      ) {
        return;
      }
    } catch {
      // Vite has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not become ready");
}

export async function launchSourceBrowser() {
  const build = spawn("cargo", ["build", "--locked", "-p", "voyalier-server"], {
    stdio: "inherit",
  });
  await waitForSuccess(build, "local API build");

  // Protocol/inspector debugging can print init-script arguments. Source mode
  // never opts the launch credential into those diagnostic logs.
  delete process.env.DEBUG;
  delete process.env.PWDEBUG;
  const { chromium } = await import("@playwright/test");
  const sourceEnvironment = sanitizeSourceEnvironment(process.env);
  const bearer = randomBytes(32).toString("hex");
  const launchId = randomBytes(16).toString("hex");
  const server = spawn("./target/debug/voyalier-server", [], {
    env: sanitizeSourceEnvironment(sourceEnvironment, {
      VOYALIER_BIND: "127.0.0.1:0",
      VOYALIER_BOOTSTRAP_FD: "3",
      VOYALIER_CREDENTIAL_FD: "4",
    }),
    stdio: ["ignore", "inherit", "inherit", "pipe", "pipe"],
  });
  let vite;
  let browser;
  const stop = async () => {
    if (browser?.isConnected()) await browser.close().catch(() => {});
    if (vite?.exitCode === null) vite.kill("SIGTERM");
    if (server.exitCode === null) server.kill("SIGTERM");
  };

  try {
    server.stdio[4].end(`${bearer}\n`);
    const apiOrigin = await waitForLine(server.stdio[3], server);
    const parsedApi = new URL(apiOrigin);
    if (parsedApi.protocol !== "http:" || parsedApi.hostname !== "127.0.0.1") {
      throw new Error("the local API published a non-loopback address");
    }

    vite = spawn(
      "pnpm",
      ["--filter", "@voyalier/web", "exec", "vite", "--host", "127.0.0.1"],
      {
        env: sanitizeSourceEnvironment(sourceEnvironment, {
          VOYALIER_SOURCE_API_ORIGIN: parsedApi.origin,
          VOYALIER_SOURCE_LAUNCH_ID: launchId,
        }),
        stdio: "inherit",
      },
    );
    await waitForWeb(vite, launchId);
    browser = await chromium.launch({
      env: sourceEnvironment,
      headless: false,
    });
    const context = await browser.newContext();
    await context.addInitScript(
      ({ expectedOrigin, baseUrl, launchBearer }) => {
        if (location.origin !== expectedOrigin) return;
        Object.defineProperty(window, "__VOYALIER_HTTP_BOOTSTRAP__", {
          configurable: true,
          enumerable: false,
          value: { baseUrl, bearer: launchBearer },
          writable: false,
        });
      },
      {
        expectedOrigin: WEB_ORIGIN,
        baseUrl: parsedApi.origin,
        launchBearer: bearer,
      },
    );
    const page = await context.newPage();
    await page.goto(WEB_ORIGIN);

    await new Promise((resolve) => {
      const finish = () => resolve(undefined);
      process.once("SIGINT", finish);
      process.once("SIGTERM", finish);
      browser.once("disconnected", finish);
      server.once("exit", finish);
      vite.once("exit", finish);
    });
  } finally {
    await stop();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  launchSourceBrowser().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
