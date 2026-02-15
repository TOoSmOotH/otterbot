import { test, expect } from "../fixtures";

test.describe("Settings - Templates (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("templates tab is accessible", async ({ page }) => {
    const templatesTab = page.locator('button:has-text("Templates")').first();
    await expect(templatesTab).toBeVisible({ timeout: 5_000 });
    await templatesTab.click();
  });

  test("built-in templates are listed", async ({ page }) => {
    const templatesTab = page.locator('button:has-text("Templates")').first();
    await templatesTab.click();

    // Should show COO template at minimum
    const modal = page.locator('.fixed.inset-0').first();
    await expect(
      modal.locator("text=COO").or(modal.locator("text=coo")).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Settings - Templates (API)", () => {
  test("clone and delete template via API", async ({ credentials }) => {
    // Login first
    const loginRes = await fetch("https://localhost:62627/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: credentials.setup.passphrase }),
    });
    const cookie = loginRes.headers.get("set-cookie") ?? "";

    // Get registry to find a built-in template
    const registryRes = await fetch("https://localhost:62627/api/registry", {
      headers: { Cookie: cookie },
    });
    const templates = await registryRes.json();
    expect(Array.isArray(templates)).toBe(true);

    // Find a built-in template to clone
    const builtIn = (templates as any[]).find((t) => t.builtIn);
    if (!builtIn) return;

    // Clone it
    const cloneRes = await fetch(
      `https://localhost:62627/api/registry/${builtIn.id}/clone`,
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
    );
    expect(cloneRes.ok).toBe(true);
    const cloned = await cloneRes.json();
    expect(cloned.builtIn).toBe(false);
    expect(cloned.clonedFromId).toBe(builtIn.id);

    // Delete the clone
    const deleteRes = await fetch(
      `https://localhost:62627/api/registry/${cloned.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
    );
    expect(deleteRes.ok).toBe(true);
  });
});
