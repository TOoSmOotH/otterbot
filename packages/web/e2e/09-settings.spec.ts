import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("settings", () => {
  test("opens from the gear and switches tabs", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("sidebar-gear").click();
    await expect(page.getByTestId("global-settings")).toBeVisible();

    await page.getByTestId("settings-tab-Appearance").click();
    await expect(page.getByTestId("theme-playful")).toBeVisible();
  });
});
