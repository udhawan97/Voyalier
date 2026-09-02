import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { randomBytes } from "node:crypto";

import {
  sourceBrowserCsp,
  validateSourceApiOrigin,
} from "./src/sourceBrowserSecurity.ts";

export default defineConfig(() => {
  const nonce = randomBytes(24).toString("base64");
  const apiOrigin = validateSourceApiOrigin(
    process.env.VOYALIER_SOURCE_API_ORIGIN,
  );
  const launchId = process.env.VOYALIER_SOURCE_LAUNCH_ID;
  if (launchId && !/^[0-9a-f]{32}$/.test(launchId)) {
    throw new Error(
      "VOYALIER_SOURCE_LAUNCH_ID must be 16 bytes of hexadecimal",
    );
  }
  if (Boolean(apiOrigin) !== Boolean(launchId)) {
    throw new Error(
      "source mode requires both VOYALIER_SOURCE_API_ORIGIN and VOYALIER_SOURCE_LAUNCH_ID",
    );
  }

  return {
    plugins: [react()],
    html: { cspNonce: nonce },
    // MapLibre 6 is ESM-only and resolves its worker as a sibling URL. Vite's
    // dev pre-bundle moves the entry module without that sibling, producing a
    // 404 for maplibre-gl-worker.mjs; serve the package modules in place instead.
    optimizeDeps: { exclude: ["maplibre-gl"] },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      headers:
        apiOrigin && launchId
          ? {
              "Content-Security-Policy": sourceBrowserCsp(nonce, apiOrigin),
              "X-Voyalier-Source-Launch": launchId,
            }
          : {},
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: true,
      // A hang backstop, not a performance budget. The heaviest tests here mount
      // the whole app and drive it with userEvent; the slowest needs ~2s on an
      // idle machine, and CPU contention multiplies that 3-5x (measured: 8.9s at
      // load average 58 on a 10-core box). The 5s default therefore failed a
      // dozen files whenever anything else was compiling, which says nothing
      // about the change under test. Nothing here asserts latency — the one test
      // that does (performance.test.tsx) asserts a *ratio* between candidate
      // counts, so it is unaffected by how long it is allowed to take.
      testTimeout: 20_000,
    },
  };
});
