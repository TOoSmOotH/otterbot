import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Agent management — create a new agent through the editor and confirm it
 * joins the roster and becomes selectable.
 */
test.describe("agents", () => {
  test("create a new agent via the editor", async ({ page }) => {
    await gotoApp(page);
    const name = `E2E Agent ${Date.now()}`;

    await page.getByTestId("new-agent").click();
    await expect(page.getByTestId("agent-editor")).toBeVisible();

    await page.getByTestId("agent-name").fill(name);
    await page.getByTestId("agent-save").click();

    // The editor closes and the new agent appears in the roster.
    await expect(page.getByTestId("agent-editor")).toBeHidden();
    await expect(page.getByTestId(`agent-card-${slugify(name)}`)).toBeVisible({ timeout: 15_000 });
  });

  test("the COO is pinned and labelled in the roster", async ({ page }) => {
    await gotoApp(page);
    const cooCard = page.getByTestId("agent-card-coo");
    await expect(cooCard).toContainText("COO");
  });
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
