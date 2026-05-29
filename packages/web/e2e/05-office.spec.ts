import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("office sub-tab mounts a pixi canvas with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await gotoApp(page);

  await page.getByTestId("view-network").click();
  await page.getByRole("button", { name: "Office" }).click();

  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 10_000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});
