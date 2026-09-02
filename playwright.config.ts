import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      testMatch: /browser-regressions\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: [
    {
      command: "./scripts/start-playwright-server.sh",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command:
        "VOYALIER_SOURCE_API_ORIGIN=http://127.0.0.1:8787 VOYALIER_SOURCE_LAUNCH_ID=0123456789abcdef0123456789abcdef pnpm --filter @voyalier/web exec vite --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
