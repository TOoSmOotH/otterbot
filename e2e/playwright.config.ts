import { defineConfig, devices } from "@playwright/test";

// Allow self-signed certificates for all Node.js fetch calls in tests
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  globalSetup: "./fixtures/setup.fixture.ts",
  use: {
    baseURL: "https://localhost:62627",
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    storageState: "./e2e/.auth-state.json",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
