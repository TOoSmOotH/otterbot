import { test, expect } from "@playwright/test";

test.describe("Message Stream", () => {
  test("renders the message stream panel", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Message Bus")).toBeVisible();
  });

  test("shows empty state when no messages", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=No messages yet")).toBeVisible();
  });
});
