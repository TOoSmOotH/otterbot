import { test, expect } from "@playwright/test";

test.describe("Full Flow", () => {
  test("three-panel layout renders correctly", async ({ page }) => {
    await page.goto("/");

    // Header
    await expect(page.locator("text=Otterbot")).toBeVisible();
    await expect(page.locator("text=Settings")).toBeVisible();

    // Three panels
    await expect(page.locator("text=COO Chat")).toBeVisible();
    await expect(page.locator("text=Agent Graph")).toBeVisible();
    await expect(page.locator("text=Message Bus")).toBeVisible();
  });

  test("app loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/");
    await page.waitForTimeout(2000);

    // Filter out expected errors (e.g. failed API calls if server isn't seeded)
    const criticalErrors = errors.filter(
      (e) => !e.includes("Failed to fetch") && !e.includes("net::ERR"),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
