import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Agent Studio — open the studio for the COO and verify every settings tab
 * renders its content.
 */
test.describe("agent studio", () => {
  test("studio tabs render their sections", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("agent-card-coo").click();
    await page.getByTestId("view-studio").click();

    await page.getByTestId("studio-tab-Identity").click();
    await expect(page.getByText("Display name")).toBeVisible();

    await page.getByTestId("studio-tab-Persona").click();
    await expect(page.getByText(/Persona \(SOUL\.md\)/)).toBeVisible();

    await page.getByTestId("studio-tab-Model").click();
    await expect(page.getByText("Chat model")).toBeVisible();

    // The old "Skills" tab is merged into "Capabilities" — it must be gone.
    await expect(page.getByTestId("studio-tab-Skills")).toHaveCount(0);

    await page.getByTestId("studio-tab-Capabilities").click();
    await expect(page.getByText(/Installed capabilities/)).toBeVisible();
    await expect(page.getByText(/Capability catalog/)).toBeVisible();

    await page.getByTestId("studio-tab-Schedule").click();
    await expect(page.getByText(/Scheduled prompts run automatically/)).toBeVisible();

    await page.getByTestId("studio-tab-Memory").click();
    await expect(page.getByText("What this agent remembers across sessions.")).toBeVisible();

    await page.getByTestId("studio-tab-Credentials").click();
    await expect(page.getByText(/Secrets for this agent/)).toBeVisible();
  });
});
