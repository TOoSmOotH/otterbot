import { test, expect } from "../fixtures";

test.describe("Settings - Providers", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("settings modal opens", async ({ page }) => {
    // Settings should show as a modal/overlay
    await expect(page.locator("text=Providers").first()).toBeVisible({ timeout: 5_000 });
  });

  test("setup provider is listed", async ({ page }) => {
    // Click the Providers tab if not already active
    const providersTab = page.locator('button:has-text("Providers")').first();
    if (await providersTab.isVisible()) {
      await providersTab.click();
    }
    // The provider created during setup should be listed
    await expect(
      page.locator("text=openai-compatible").or(page.locator("text=OpenAI Compatible")),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("add provider form is available", async ({ page }) => {
    const providersTab = page.locator('button:has-text("Providers")').first();
    if (await providersTab.isVisible()) {
      await providersTab.click();
    }
    // Should have an add button
    const addButton = page.locator('button:has-text("Add")').or(page.locator('button:has-text("New")'));
    await expect(addButton.first()).toBeVisible({ timeout: 5_000 });
  });

  test("test connection (requires credentials)", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    const providersTab = page.locator('button:has-text("Providers")').first();
    if (await providersTab.isVisible()) {
      await providersTab.click();
    }

    // Look for a test/verify button inside the settings modal
    const modal = page.locator('.fixed.inset-0').first();
    const testButton = modal.locator('button:has-text("Test")').first();
    if (await testButton.isVisible()) {
      await testButton.click();
      // Wait for test result
      await expect(
        modal.locator("text=success").or(modal.locator("text=Success").or(modal.locator("text=connected").or(modal.locator("text=Connected")))).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});
