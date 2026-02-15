import { test, expect } from "../fixtures";

test.describe("Settings - Models", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("models tab is accessible", async ({ page }) => {
    const modelsTab = page.locator('button:has-text("Models")').first();
    await expect(modelsTab).toBeVisible({ timeout: 5_000 });
    await modelsTab.click();
  });

  test("tier defaults are shown", async ({ page }) => {
    const modelsTab = page.locator('button:has-text("Models")').first();
    await modelsTab.click();

    // Should show tier configuration (e.g., COO tier, Worker tier, etc.)
    const modal = page.locator('.fixed.inset-0').first();
    await expect(
      modal.locator("text=COO").or(modal.locator("text=coo").or(modal.locator("text=Default"))).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("list models from provider (requires credentials)", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    const modelsTab = page.locator('button:has-text("Models")').first();
    await modelsTab.click();

    // Look for a model selector/dropdown
    const modelSelect = page.locator("select, [role='combobox'], [role='listbox']").first();
    if (await modelSelect.isVisible()) {
      await modelSelect.click();
      // Models should load from the provider
      await page.waitForTimeout(3000);
    }
  });
});
