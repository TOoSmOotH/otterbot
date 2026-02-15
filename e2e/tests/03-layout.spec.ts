import { test, expect } from "../fixtures";

test.describe("Layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
  });

  test("three panels are visible", async ({ page }) => {
    // Chat panel (left)
    await expect(page.locator('[id="chat"]')).toBeVisible();
    // Graph panel (center)
    await expect(page.locator('[id="graph"]')).toBeVisible();
    // Stream panel (right)
    await expect(page.locator('[id="stream"]')).toBeVisible();
  });

  test("header shows branding", async ({ page }) => {
    await expect(page.locator("header")).toContainText("Otterbot");
  });

  test("Settings button is visible", async ({ page }) => {
    await expect(page.locator('button:has-text("Settings")')).toBeVisible();
  });

  test("Logout button is visible", async ({ page }) => {
    await expect(page.locator('button:has-text("Logout")')).toBeVisible();
  });

  test("tab bar shows Graph and Desktop tabs", async ({ page }) => {
    await expect(page.locator('button:has-text("Graph")')).toBeVisible();
    await expect(page.locator('button:has-text("Desktop")')).toBeVisible();
  });
});
