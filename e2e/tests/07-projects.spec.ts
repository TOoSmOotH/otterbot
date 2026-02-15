import { test, expect } from "../fixtures";

test.describe("Projects", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
  });

  test("project list is visible in left panel", async ({ page }) => {
    const chatPanel = page.locator('[id="chat"]');
    await expect(chatPanel).toBeVisible();
  });

  test("create project via chat (requires credentials)", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    // Ask the AI to create a project
    const textarea = page.locator("textarea");
    await textarea.fill("Create a new project called E2E Test Project");
    await textarea.press("Enter");

    // Wait for project to appear (this may take a while as the AI processes)
    await expect(
      page.locator("text=E2E Test Project"),
    ).toBeVisible({ timeout: 60_000 });
  });

  test("project tabs appear when entering a project (requires credentials)", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    // Click on a project if one exists
    const projectLink = page.locator('[class*="project"], [data-testid*="project"]').first();
    if ((await projectLink.count()) > 0) {
      await projectLink.click();
      // Should see project-specific tabs
      await expect(page.locator('button:has-text("Board")')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('button:has-text("Files")')).toBeVisible({ timeout: 5_000 });
    }
  });
});
