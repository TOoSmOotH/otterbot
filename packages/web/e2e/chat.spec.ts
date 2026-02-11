import { test, expect } from "@playwright/test";

test.describe("CEO Chat", () => {
  test("renders the chat panel with input", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=COO Chat")).toBeVisible();
    await expect(
      page.locator('textarea[placeholder="Message the COO..."]'),
    ).toBeVisible();
  });

  test("can type a message in the input", async ({ page }) => {
    await page.goto("/");
    const input = page.locator('textarea[placeholder="Message the COO..."]');
    await input.fill("Hello COO");
    await expect(input).toHaveValue("Hello COO");
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await page.goto("/");
    const sendButton = page.locator("button").filter({ has: page.locator("svg") }).last();
    await expect(sendButton).toBeDisabled();
  });
});
