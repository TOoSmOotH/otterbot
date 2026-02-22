import { test, expect } from "../fixtures";

test.describe("Settings - Profile", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("profile section is the default view", async ({ page }) => {
    // Profile is the first item in the General group (defaultOpen: true)
    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal.locator("text=Profile").first()).toBeVisible({ timeout: 5_000 });
  });

  test("profile fields are visible", async ({ page }) => {
    const profileTab = page.locator('button:has-text("Profile")').first();
    if (await profileTab.isVisible()) {
      await profileTab.click();
    }

    const modal = page.locator(".fixed.inset-0").first();

    // Name field
    await expect(
      modal.locator("text=Name").first(),
    ).toBeVisible({ timeout: 5_000 });

    // Timezone field
    await expect(
      modal.locator("text=Timezone").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("avatar section is visible", async ({ page }) => {
    const profileTab = page.locator('button:has-text("Profile")').first();
    if (await profileTab.isVisible()) {
      await profileTab.click();
    }

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator("text=Avatar").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("save button is present", async ({ page }) => {
    const profileTab = page.locator('button:has-text("Profile")').first();
    if (await profileTab.isVisible()) {
      await profileTab.click();
    }

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator('button:has-text("Save")').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
