import { chromium, type FullConfig } from "@playwright/test";
import { loadCredentials } from "../credentials";
import { waitForServer, completeSetup } from "../helpers/api";
import { resolve } from "node:path";

const AUTH_STATE_PATH = resolve(__dirname, "../.auth-state.json");

export default async function globalSetup(_config: FullConfig) {
  console.log("[e2e setup] Waiting for server...");
  await waitForServer(90_000);
  console.log("[e2e setup] Server is up.");

  const creds = loadCredentials();

  // Complete setup wizard via API
  console.log("[e2e setup] Completing setup wizard...");
  const setupRes = await completeSetup(creds.setup);
  if (!setupRes.ok) {
    const body = await setupRes.json().catch(() => ({}));
    // If setup is already complete, that's fine
    if (setupRes.status !== 400 || !(body as any).error?.includes("already")) {
      throw new Error(`Setup failed (${setupRes.status}): ${JSON.stringify(body)}`);
    }
    console.log("[e2e setup] Setup was already complete.");
  } else {
    console.log("[e2e setup] Setup completed successfully.");
  }

  // Launch browser, login, and save auth state
  console.log("[e2e setup] Logging in via browser...");
  const browser = await chromium.launch();
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  await page.goto("https://localhost:62627");

  // Wait for the login screen to appear
  await page.waitForSelector('input[type="password"]', { timeout: 15_000 });

  // Enter passphrase and submit — the button is a regular <button>, not type="submit"
  await page.fill('input[type="password"]', creds.setup.passphrase);
  await page.click('button:has-text("Sign In")');

  // Wait for the main app to load (header with "Smoothbot" text)
  await page.waitForSelector("header", { timeout: 15_000 });

  // Save auth state
  await context.storageState({ path: AUTH_STATE_PATH });
  console.log("[e2e setup] Auth state saved.");

  await browser.close();
}
