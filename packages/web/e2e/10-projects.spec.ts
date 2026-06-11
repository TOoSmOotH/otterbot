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

  test("add-agent wizard adds an existing agent and can create a new one", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("command-trigger").click();
    await page.getByTestId("command-input").fill("Go to Projects");
    await page.getByTestId("command-input").press("Enter");

    // Create a minimal coding team, then open its dashboard. Use a unique name
    // so a fresh project is opened — the e2e server's DB persists across runs,
    // and reusing a name could reopen a project the COO already joined.
    const projectName = `Add Agent Wizard E2E ${Date.now()}`;
    await page.getByTestId("new-coding-team").click();
    await page.getByPlaceholder("Project name").fill(projectName);
    await page.getByRole("button", { name: "Create team" }).click();
    await page.getByText(projectName).first().click();

    // Open the wizard from the Additional agents section.
    await page.getByTestId("add-agent").click();
    await expect(page.getByText("Use an existing agent")).toBeVisible();
    await expect(page.getByText("New single agent")).toBeVisible();

    // Existing path: add the COO and confirm it lands in the members list.
    await page.getByText("Use an existing agent").click();
    await page.getByTestId("add-agent-pick").selectOption("coo");
    await page.getByTestId("add-agent-confirm").click();
    await expect(page.getByTestId("member-access-coo")).toBeVisible();

    // Single path: the "New single agent" card opens the standalone agent editor.
    await page.getByTestId("add-agent").click();
    await page.getByText("New single agent").click();
    await expect(page.getByTestId("agent-editor")).toBeVisible();
  });
});
