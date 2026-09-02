import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sanitizeSourceEnvironment } from "./dev-launcher.mjs";

const source = readFileSync(
  new URL("./dev-launcher.mjs", import.meta.url),
  "utf8",
);
const viteConfig = readFileSync(
  new URL("../apps/web/vite.config.ts", import.meta.url),
  "utf8",
);

test("source launcher passes the credential only over an anonymous pipe", () => {
  assert.match(source, /randomBytes\(32\)/);
  assert.match(
    source,
    /stdio: \["ignore", "inherit", "inherit", "pipe", "pipe"\]/,
  );
  assert.match(source, /server\.stdio\[4\]\.end/);
  assert.match(source, /spawn\("\.\/target\/debug\/voyalier-server"/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
  assert.match(source, /delete process\.env\.DEBUG/);
  assert.match(source, /delete process\.env\.PWDEBUG/);
});

test("source children cannot inherit test, mock, live, or credential switches", () => {
  const callerEnvironment = {
    PATH: "/tooling/bin",
    VITE_LIVE_API: "1",
    VITE_LIVE_API_TOKEN: "caller-live-token",
    VITE_LIVE_API_URL: "http://evil.invalid",
    VITE_MOCK: "1",
    VOYALIER_BIND: "0.0.0.0:9999",
    VOYALIER_BOOTSTRAP_FD: "99",
    VOYALIER_CREDENTIAL_FD: "98",
    VOYALIER_DATA_DIR: "/tmp/legitimate-voyalier-data",
    VOYALIER_INTEGRATION_TEST: "1",
    VOYALIER_LOG: "warn",
    VOYALIER_SOURCE_API_ORIGIN: "http://evil.invalid",
    VOYALIER_SOURCE_LAUNCH_ID: "caller-launch-id",
    VOYALIER_TEST_API_TOKEN: "caller-test-token",
  };

  const sanitized = sanitizeSourceEnvironment(callerEnvironment, {
    VOYALIER_BIND: "127.0.0.1:0",
    VOYALIER_BOOTSTRAP_FD: "3",
    VOYALIER_CREDENTIAL_FD: "4",
  });

  assert.deepEqual(sanitized, {
    PATH: "/tooling/bin",
    VOYALIER_BIND: "127.0.0.1:0",
    VOYALIER_BOOTSTRAP_FD: "3",
    VOYALIER_CREDENTIAL_FD: "4",
    VOYALIER_DATA_DIR: "/tmp/legitimate-voyalier-data",
    VOYALIER_LOG: "warn",
  });
  assert.equal(callerEnvironment.VITE_MOCK, "1", "caller env is not mutated");
});

test("production child spawns use sanitized environments", () => {
  assert.doesNotMatch(source, /\.\.\.process\.env/);
  assert.match(source, /env: sanitizeSourceEnvironment\(sourceEnvironment/);
  assert.match(source, /env: sourceEnvironment/);
});

test("source launcher assigns a random API port and managed browser context", () => {
  assert.match(source, /VOYALIER_BIND: "127\.0\.0\.1:0"/);
  assert.match(source, /browser\.newContext\(\)/);
  assert.match(source, /location\.origin !== expectedOrigin/);
  assert.match(source, /x-voyalier-source-launch/);
  assert.match(source, /VOYALIER_SOURCE_LAUNCH_ID/);
});

test("Vite carries only the source CSP and no API proxy authority", () => {
  assert.match(viteConfig, /Content-Security-Policy/);
  assert.match(viteConfig, /html: \{ cspNonce: nonce \}/);
  assert.doesNotMatch(viteConfig, /\bproxy\s*:/);
});
