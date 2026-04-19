import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — drives the full server + web stack against a
 * local LM Studio instance at http://localhost:1234/v1.
 *
 * Requirements:
 * - LM Studio running locally with a model loaded and the server enabled.
 * - LMSTUDIO_MODEL env var (defaults to `local-model`) matches a model id
 *   that LM Studio exposes.
 *
 * The test suite skips LLM-dependent assertions if LM Studio is unreachable,
 * so CI without a running model still passes the non-LLM spec file.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
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
      port: 3001,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      env: {
        LMSTUDIO_BASE_URL: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
        LMSTUDIO_MODEL: process.env.LMSTUDIO_MODEL ?? "local-model",
        DATA_DIR: process.env.E2E_DATA_DIR ?? "./data-e2e",
        SKILLS_DIR: process.env.E2E_SKILLS_DIR ?? "./data-e2e/skills",
      },
      timeout: 30_000,
    },
    {
      command: "pnpm --filter @otterbot/web dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 30_000,
    },
  ],
});
