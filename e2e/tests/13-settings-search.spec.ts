import { test, expect } from "../fixtures";
import { getStoredCookie } from "../helpers/api";

test.describe("Settings - Search (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("search tab is accessible", async ({ page }) => {
    const searchTab = page.locator('button:has-text("Search")').first();
    await expect(searchTab).toBeVisible({ timeout: 5_000 });
    await searchTab.click();
  });

  test("search providers are listed", async ({ page }) => {
    const searchTab = page.locator('button:has-text("Search")').first();
    await searchTab.click();

    const modal = page.locator('.fixed.inset-0').first();
    await expect(
      modal.locator("text=Brave").or(modal.locator("text=SearXNG")).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("configure and test search (requires credentials)", async ({
    page,
    requireSearch,
  }) => {
    requireSearch("brave");

    const searchTab = page.locator('button:has-text("Search")').first();
    await searchTab.click();

    const modal = page.locator('.fixed.inset-0').first();
    const testButton = modal.locator('button:has-text("Test")').first();
    if (await testButton.isVisible()) {
      await testButton.click();
      await expect(
        modal.locator("text=success").or(modal.locator("text=Success")).first(),
      ).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe("Settings - Search (API)", () => {
  test("search API returns settings", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/settings/search", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toBeDefined();
  });
});
