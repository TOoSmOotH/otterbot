import { test, expect } from "../fixtures";

test.describe("Settings - Live View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("live view tab is accessible", async ({ page }) => {
    // Live View is in the "Features" group which is defaultOpen: true
    const tab = page.locator('button:has-text("Live View")').first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
  });

  test("character selection UI renders", async ({ page }) => {
    const tab = page.locator('button:has-text("Live View")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator("text=Your Character").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("character description text is shown", async ({ page }) => {
    const tab = page.locator('button:has-text("Live View")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator("text=Choose your 3D character").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
