import { test, expect } from "../fixtures";
import { getStoredCookie } from "../helpers/api";

test.describe("Desktop Tab (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
  });

  test("Desktop tab is visible", async ({ page }) => {
    await expect(page.locator('button:has-text("Desktop")')).toBeVisible();
  });

  test("clicking Desktop tab switches view", async ({ page }) => {
    await page.click('button:has-text("Desktop")');

    const desktopTab = page.locator('button:has-text("Desktop")');
    await expect(desktopTab).toBeVisible();

    const graphPanel = page.locator('[id="graph"]');
    await expect(graphPanel).toBeVisible();
  });

  test("shows status message when desktop is disabled", async ({ page }) => {
    await page.click('button:has-text("Desktop")');

    const graphPanel = page.locator('[id="graph"]');
    await expect(
      graphPanel.locator("text=Desktop").or(graphPanel.locator("text=disabled").or(graphPanel.locator("text=not available").or(graphPanel.locator("text=enable")))).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Desktop Tab (API)", () => {
  test("desktop API returns disabled status", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/desktop/status", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data.enabled).toBe(false);
  });
});
