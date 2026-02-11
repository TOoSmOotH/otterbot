import { test, expect } from "@playwright/test";

test.describe("Agent Graph", () => {
  test("renders the agent graph panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Agent Graph")).toBeVisible();
  });

  test("shows the CEO node", async ({ page }) => {
    await page.goto("/");
    // The CEO node should always be present
    await expect(page.locator("text=CEO (You)")).toBeVisible();
  });

  test("shows the COO node when server is running", async ({ page }) => {
    await page.goto("/");
    // COO is always running on the server
    await expect(page.locator("text=COO").first()).toBeVisible({ timeout: 5000 });
  });
});
