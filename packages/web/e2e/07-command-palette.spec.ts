import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("command palette", () => {
  test("opens, filters, and navigates to settings", async ({ page }) => {
    await gotoApp(page);

    await page.getByTestId("command-trigger").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();

    await page.getByTestId("command-input").fill("settings");
    await page.getByTestId("command-input").press("Enter");

    await expect(page.getByTestId("command-palette")).toBeHidden();
    await expect(page.getByTestId("global-settings")).toBeVisible();
  });

  test("escape closes the palette", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("command-trigger").click();
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.getByTestId("command-input").press("Escape");
    await expect(page.getByTestId("command-palette")).toBeHidden();
  });
});
