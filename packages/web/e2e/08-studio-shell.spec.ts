import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("studio shell", () => {
  test("sidebar shows company sections and the COO under Leadership", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("section-label-leadership")).toBeVisible();
    await expect(page.getByTestId("agent-card-coo")).toBeVisible();
  });

  test("settings gear opens settings", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("sidebar-gear").click();
    await expect(page.getByTestId("global-settings")).toBeVisible();
  });

  test("chat shows a channel-style header for the active agent", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("channel-title")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
  });
});
