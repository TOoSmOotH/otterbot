import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test.describe("projects", () => {
  test("project index opens via ⌘K and offers a new team", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("command-trigger").click();
    await page.getByTestId("command-input").fill("Go to Projects");
    await page.getByTestId("command-input").press("Enter");
    await expect(page.getByTestId("new-coding-team")).toBeVisible();
  });
});
