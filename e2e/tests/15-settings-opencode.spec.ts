import { test, expect } from "../fixtures";

test.describe("Settings - OpenCode (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("OpenCode tab is accessible", async ({ page }) => {
    const opencodeTab = page.locator('button:has-text("OpenCode")').first();
    await expect(opencodeTab).toBeVisible({ timeout: 5_000 });
    await opencodeTab.click();
  });

  test("config fields are visible", async ({ page }) => {
    const opencodeTab = page.locator('button:has-text("OpenCode")').first();
    await opencodeTab.click();

    const modal = page.locator('.fixed.inset-0').first();
    await expect(
      modal.locator("text=OpenCode").or(modal.locator("text=API URL").or(modal.locator("text=Enable"))).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("test connection (requires OpenCode credentials)", async ({
    page,
    requireOpenCode,
  }) => {
    requireOpenCode();

    const opencodeTab = page.locator('button:has-text("OpenCode")').first();
    await opencodeTab.click();

    const testButton = page.locator('button:has-text("Test")').first();
    if (await testButton.isVisible()) {
      await testButton.click();
      await expect(
        page.locator("text=success").or(page.locator("text=Success").or(page.locator("text=connected"))),
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe("Settings - OpenCode (API)", () => {
  test("OpenCode API returns settings", async ({ credentials }) => {
    const loginRes = await fetch("https://localhost:62627/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: credentials.setup.passphrase }),
    });
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const res = await fetch("https://localhost:62627/api/settings/opencode", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toBeDefined();
  });
});
