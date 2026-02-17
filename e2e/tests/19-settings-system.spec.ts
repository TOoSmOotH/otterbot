import { test, expect } from "../fixtures";

test.describe("Settings - System", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("system tab is accessible", async ({ page }) => {
    const tab = page.locator('button:has-text("System")').first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
  });

  test("system info section renders", async ({ page }) => {
    const tab = page.locator('button:has-text("System")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    // Should show the System heading
    await expect(
      modal.locator("text=System").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("about section shows application info", async ({ page }) => {
    const tab = page.locator('button:has-text("System")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal.locator("text=About").first()).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=Otterbot")).toBeVisible();
    await expect(modal.locator("text=MIT")).toBeVisible();
  });

  test("data management section renders", async ({ page }) => {
    const tab = page.locator('button:has-text("System")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator("text=Data Management").first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=Storage")).toBeVisible();
    await expect(modal.locator("text=Cache")).toBeVisible();
    await expect(modal.locator("text=Backup")).toBeVisible();
  });
});
