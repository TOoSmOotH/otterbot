import { test as base, expect } from "@playwright/test";
import { test } from "../fixtures";
import { loadCredentials } from "../credentials";

test.describe("Authentication", () => {
  test("authenticated user sees main app", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Otterbot")).toBeVisible();
  });

  test("logout redirects to login screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Logout")');
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 10_000 });
  });

  test("401 without session cookie", async () => {
    const res = await fetch("https://localhost:62627/api/settings", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});

// Tests that use a fresh context (no stored auth)
base.describe("Authentication (no auth)", () => {
  base.use({ ignoreHTTPSErrors: true });

  base("wrong passphrase shows error", async ({ page }) => {
    await page.goto("https://localhost:62627");
    await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
    await page.fill('input[type="password"]', "wrong-passphrase");
    await page.click('button:has-text("Sign In")');
    // Should show error and stay on login
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator("text=Invalid").or(page.locator("text=invalid").or(page.locator("text=error")))).toBeVisible({ timeout: 5_000 });
  });

  base("re-login with correct passphrase succeeds", async ({ page }) => {
    const creds = loadCredentials();
    await page.goto("https://localhost:62627");
    await page.waitForSelector('input[type="password"]', { timeout: 15_000 });
    await page.fill('input[type="password"]', creds.setup.passphrase);
    await page.click('button:has-text("Sign In")');
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("text=Otterbot")).toBeVisible();
  });
});
