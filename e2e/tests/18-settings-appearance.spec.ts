import { test, expect } from "../fixtures";

test.describe("Settings - Appearance", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("appearance tab is accessible", async ({ page }) => {
    const tab = page.locator('button:has-text("Appearance")').first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
  });

  test("three theme options are shown", async ({ page }) => {
    const tab = page.locator('button:has-text("Appearance")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal.locator("text=Theme").first()).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=Dark")).toBeVisible();
    await expect(modal.locator("text=Otter")).toBeVisible();
    await expect(modal.locator("text=Light")).toBeVisible();
  });

  test("clicking Dark theme sets data-theme", async ({ page }) => {
    const tab = page.locator('button:has-text("Appearance")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    // Click the Dark theme button
    await modal.locator("text=Dark").first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", {
      timeout: 5_000,
    });
  });

  test("clicking Otter theme sets data-theme", async ({ page }) => {
    const tab = page.locator('button:has-text("Appearance")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await modal.locator("text=Otter").first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "otter", {
      timeout: 5_000,
    });
  });

  test("clicking Light theme sets data-theme", async ({ page }) => {
    const tab = page.locator('button:has-text("Appearance")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await modal.locator("text=Light").first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light", {
      timeout: 5_000,
    });
  });

  test("active theme has ring indicator", async ({ page }) => {
    const tab = page.locator('button:has-text("Appearance")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    // One of the theme buttons should have the ring-primary class
    const activeTheme = modal.locator(".ring-primary, .border-primary.ring-1");
    await expect(activeTheme.first()).toBeVisible({ timeout: 5_000 });
  });
});
