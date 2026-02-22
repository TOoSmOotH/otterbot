import { test, expect } from "../fixtures";
import { getStoredCookie } from "../helpers/api";

test.describe("Settings - Pricing (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
    await page.click('button:has-text("Settings")');
  });

  test("pricing tab is accessible", async ({ page }) => {
    const tab = page.locator('button:has-text("Pricing")').first();
    await expect(tab).toBeVisible({ timeout: 5_000 });
    await tab.click();
  });

  test("pricing table renders with column headers", async ({ page }) => {
    const tab = page.locator('button:has-text("Pricing")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(modal.locator("text=Model Pricing").first()).toBeVisible({ timeout: 5_000 });
    await expect(modal.locator("text=Input $/M")).toBeVisible();
    await expect(modal.locator("text=Output $/M")).toBeVisible();
  });

  test("add model button is visible", async ({ page }) => {
    const tab = page.locator('button:has-text("Pricing")').first();
    await tab.click();

    const modal = page.locator(".fixed.inset-0").first();
    await expect(
      modal.locator('button:has-text("Add Model")').first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Settings - Pricing (API)", () => {
  test("GET /api/settings/pricing returns pricing data", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/settings/pricing", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toBeDefined();
    expect(typeof data).toBe("object");
  });

  test("PUT creates custom price, GET confirms, DELETE resets", async ({ credentials }) => {
    const cookie = getStoredCookie();

    // Create custom price
    const putRes = await fetch(
      "https://localhost:62627/api/settings/pricing/e2e-test-model",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ input: 1.5, output: 3.0 }),
      },
    );
    expect(putRes.ok).toBe(true);

    // Verify it appears with isCustom
    const getRes = await fetch("https://localhost:62627/api/settings/pricing", {
      headers: { Cookie: cookie },
    });
    const data = await getRes.json();
    const entry = data["e2e-test-model"];
    expect(entry).toBeDefined();
    expect(entry.isCustom).toBe(true);

    // Delete custom price
    const delRes = await fetch(
      "https://localhost:62627/api/settings/pricing/e2e-test-model",
      {
        method: "DELETE",
        headers: { Cookie: cookie },
      },
    );
    expect(delRes.ok).toBe(true);
  });
});
