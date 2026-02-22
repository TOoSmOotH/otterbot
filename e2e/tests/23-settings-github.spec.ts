import { test, expect } from "../fixtures";

test.describe("Settings - GitHub", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("integrations group can be expanded", async ({ page }) => {
    // The Integrations group is defaultOpen: false — expand it
    const groupHeader = page.locator("text=Integrations").first();
    if (await groupHeader.isVisible()) {
      await groupHeader.click();
    }

    // Channels is currently the only item under Integrations
    await expect(
      page.locator('button:has-text("Channels")').first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("channels section renders platform cards", async ({ page }) => {
    // Expand Integrations group
    const groupHeader = page.locator("text=Integrations").first();
    if (await groupHeader.isVisible()) {
      await groupHeader.click();
    }

    const channelsTab = page.locator('button:has-text("Channels")').first();
    await channelsTab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal.locator("text=Channels").first()).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=WhatsApp")).toBeVisible();
    await expect(modal.locator("text=Telegram")).toBeVisible();
    await expect(modal.locator("text=Slack")).toBeVisible();
    await expect(modal.locator("text=Discord")).toBeVisible();
  });

  test("channels show coming soon badges", async ({ page }) => {
    const groupHeader = page.locator("text=Integrations").first();
    if (await groupHeader.isVisible()) {
      await groupHeader.click();
    }

    const channelsTab = page.locator('button:has-text("Channels")').first();
    await channelsTab.click();

    const modal = page.locator(".fixed.inset-0").first();
    const comingSoon = modal.locator("text=Coming Soon");
    await expect(comingSoon.first()).toBeVisible({ timeout: 5_000 });
  });

  test("security section is accessible", async ({ page }) => {
    // Security group is defaultOpen: false — expand it
    const groupHeader = page.locator("text=Security").first();
    if (await groupHeader.isVisible()) {
      await groupHeader.click();
    }

    const authTab = page.locator('button:has-text("Authentication")').first();
    await expect(authTab).toBeVisible({ timeout: 5_000 });
    await authTab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator("text=Authentication").first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=Change Passphrase")).toBeVisible();
  });

  test("security section shows 2FA and sessions", async ({ page }) => {
    const groupHeader = page.locator("text=Security").first();
    if (await groupHeader.isVisible()) {
      await groupHeader.click();
    }

    const authTab = page.locator('button:has-text("Authentication")').first();
    await authTab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator("text=Two-Factor Authentication"),
    ).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=Active Sessions")).toBeVisible();
  });
});
