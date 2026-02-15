import { test, expect } from "../fixtures";

test.describe("File Browser", () => {
  test("files API returns 404 for non-existent project", async ({ credentials }) => {
    const loginRes = await fetch("https://localhost:62627/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: credentials.setup.passphrase }),
    });
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    const res = await fetch("https://localhost:62627/api/projects/fake-id/files", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  test("Files tab is visible when in a project context", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });

    // Enter a project if one exists
    const projectLink = page.locator('[class*="project"], [data-testid*="project"]').first();
    if ((await projectLink.count()) > 0) {
      await projectLink.click();
      await expect(page.locator('button:has-text("Files")')).toBeVisible({ timeout: 5_000 });

      // Click Files tab
      await page.click('button:has-text("Files")');

      // Should show file browser content area
      const graphPanel = page.locator('[id="graph"]');
      await expect(graphPanel).toBeVisible();
    }
  });
});
