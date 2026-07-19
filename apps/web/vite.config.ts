import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
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
});
