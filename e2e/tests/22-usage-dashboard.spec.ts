import { test, expect } from "../fixtures";
import { getStoredCookie } from "../helpers/api";

test.describe("Usage Dashboard (UI)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
  });

  test("usage tab is accessible from main layout", async ({ page }) => {
    const usageTab = page.locator('button:has-text("Usage")').first();
    await expect(usageTab).toBeVisible({ timeout: 5_000 });
    await usageTab.click();
  });

  test("summary cards are displayed", async ({ page }) => {
    const usageTab = page.locator('button:has-text("Usage")').first();
    await usageTab.click();

    await expect(page.locator("text=Total Tokens").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=Total Cost").first()).toBeVisible();
    await expect(page.locator("text=API Calls").first()).toBeVisible();
    await expect(page.locator("text=Top Model").first()).toBeVisible();
  });

  test("time range buttons are displayed", async ({ page }) => {
    const usageTab = page.locator('button:has-text("Usage")').first();
    await usageTab.click();

    await expect(page.locator("text=Today").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("text=7d").first()).toBeVisible();
    await expect(page.locator("text=30d").first()).toBeVisible();
    await expect(page.locator("text=All").first()).toBeVisible();
  });

  test("clicking time range updates active button", async ({ page }) => {
    const usageTab = page.locator('button:has-text("Usage")').first();
    await usageTab.click();

    // Click "7d" and verify it gets the active class
    const sevenDay = page.locator("button:has-text('7d')").first();
    await sevenDay.click();
    await expect(sevenDay).toHaveClass(/bg-primary/, { timeout: 5_000 });
  });
});

test.describe("Usage Dashboard (API)", () => {
  test("GET /api/usage/summary returns valid shape", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/usage/summary", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(data).toHaveProperty("totalInputTokens");
    expect(data).toHaveProperty("totalOutputTokens");
    expect(data).toHaveProperty("totalCost");
    expect(data).toHaveProperty("recordCount");
  });

  test("GET /api/usage/by-model returns array", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/usage/by-model", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/usage/by-agent returns array", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/usage/by-agent", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("GET /api/usage/recent returns array", async ({ credentials }) => {
    const cookie = getStoredCookie();

    const res = await fetch("https://localhost:62627/api/usage/recent?limit=5", {
      headers: { Cookie: cookie },
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});
