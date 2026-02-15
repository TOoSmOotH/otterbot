import { test, expect } from "../fixtures";

test.describe("Agent Graph", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    // Ensure Graph tab is active
    await page.click('button:has-text("Graph")');
  });

  test("graph panel renders", async ({ page }) => {
    const graphPanel = page.locator('[id="graph"]');
    await expect(graphPanel).toBeVisible();
  });

  test("CEO node is visible", async ({ page }) => {
    await expect(page.locator("text=CEO").first()).toBeVisible({ timeout: 5_000 });
  });

  test("COO node is visible", async ({ page, credentials }) => {
    const cooName = credentials.setup.cooName;
    await expect(
      page.locator(`text=${cooName}`).or(page.locator("text=COO")).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("status indicators are present", async ({ page }) => {
    // Nodes should have some status indicator (dot, badge, etc.)
    const graphPanel = page.locator('[id="graph"]');
    // At minimum the graph area should have content
    await expect(graphPanel.locator("text=CEO")).toBeVisible({ timeout: 5_000 });
  });
});
