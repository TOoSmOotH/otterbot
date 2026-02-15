import { test, expect } from "../fixtures";
import { getSetupStatus } from "../helpers/api";

test.describe("Setup Wizard", () => {
  test("setup status API returns complete", async () => {
    const status = await getSetupStatus();
    expect(status.setupComplete).toBe(true);
  });

  test("app does not show setup wizard when already configured", async ({ page }) => {
    await page.goto("/");
    // Should NOT see the setup wizard — should go straight to the main app
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("text=Smoothbot")).toBeVisible();
  });

  test("re-setup returns 400", async () => {
    const res = await fetch("https://localhost:62627/api/setup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passphrase: "another-passphrase",
        provider: "openai",
        model: "gpt-4",
        userName: "Test",
        userTimezone: "UTC",
        cooName: "COO",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already");
  });
});
