import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config — drives the full server + web stack.
 *
 * The suite is self-contained: a fake OpenAI-compatible model server is
 * started automatically, so no LM Studio or cloud API key is required.
 * Set LMSTUDIO_BASE_URL to point at a real model instead if desired.
 */
const FAKE_MODEL_PORT = 8745;
const MODEL_URL = process.env.LMSTUDIO_BASE_URL ?? `http://127.0.0.1:${FAKE_MODEL_PORT}/v1`;
const MODEL_ID = process.env.LMSTUDIO_MODEL ?? "fake-model";
const useFakeModel = !process.env.LMSTUDIO_BASE_URL;
// A deterministic token so the suite can pre-seed localStorage and skip the
// AuthGate prompt. Re-used across the helper.
const E2E_API_TOKEN = process.env.OTTERBOT_API_TOKEN ?? "e2e-test-token-otterbot";
process.env.OTTERBOT_API_TOKEN = E2E_API_TOKEN;

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
      use: {
        ...devices["Desktop Chrome"],
        // Point at a system-installed Chromium when set, so machines that
        // already have a browser can skip the Playwright download.
        ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: [
    ...(useFakeModel
      ? [
          {
            command: "pnpm --filter @otterbot/server exec tsx src/test/fake-model-server.ts",
            port: FAKE_MODEL_PORT,
            reuseExistingServer: !process.env.CI,
            cwd: "../..",
            timeout: 20_000,
          },
        ]
      : []),
    {
      command: "pnpm --filter @otterbot/server dev",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      env: {
        LMSTUDIO_BASE_URL: MODEL_URL,
        LMSTUDIO_MODEL: MODEL_ID,
        DATA_DIR: process.env.E2E_DATA_DIR ?? "./packages/server/data-e2e",
        OTTERBOT_API_TOKEN: E2E_API_TOKEN,
      },
      timeout: 40_000,
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
