import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("office sub-tab mounts a pixi canvas with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await gotoApp(page);

  await page.getByTestId("command-trigger").click();
  await page.getByTestId("command-input").fill("Go to Network");
  await page.getByTestId("command-input").press("Enter");
  await page.getByTestId("network-subtabs-office").click();

  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("slider", { name: "Office zoom" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();
  expect(errors, errors.join("\n")).toHaveLength(0);
});
