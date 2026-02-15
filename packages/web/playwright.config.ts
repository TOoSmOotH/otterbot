import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @otterbot/server dev",
      port: 62626,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
    },
    {
      command: "pnpm --filter @otterbot/web dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
    },
  ],
});
