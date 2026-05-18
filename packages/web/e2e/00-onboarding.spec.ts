import { test, expect } from "@playwright/test";

/**
 * First-run onboarding. Runs the wizard end to end when it appears (a fresh
 * data directory); skips when onboarding has already been completed on a
 * persisted data directory.
 */
test.describe("onboarding", () => {
  test("first-run wizard configures the COO", async ({ page }) => {
    await page.goto("/");
    const wizard = page.getByTestId("onboarding-wizard");
    // Wait for the app to settle: setup-state is fetched async, so either the
    // wizard (fresh install) or the agent roster (already onboarded) appears.
    await Promise.race([
      wizard.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {}),
      page
        .getByTestId("agent-card-coo")
        .waitFor({ state: "visible", timeout: 15_000 })
        .catch(() => {}),
    ]);
    const present = await wizard.isVisible().catch(() => false);
    test.skip(!present, "onboarding already completed for this data directory");

    await page.getByRole("button", { name: "Get started" }).click();
    // Chat model → embedding model → personality. Skip embeddings so the test
    // never triggers a built-in model download.
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: /^Skip/ }).click();
    await page.getByTestId("onboarding-finish").click();

    await expect(wizard).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId("agent-card-coo")).toBeVisible();
  });
});
