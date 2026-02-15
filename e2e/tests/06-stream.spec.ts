import { test, expect } from "../fixtures";

test.describe("Message Bus / Stream", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
  });

  test("stream panel renders", async ({ page }) => {
    const streamPanel = page.locator('[id="stream"]');
    await expect(streamPanel).toBeVisible();
  });

  test("shows Message Bus header or empty state", async ({ page }) => {
    const streamPanel = page.locator('[id="stream"]');
    await expect(
      streamPanel.locator("text=Message Bus").or(streamPanel.locator("text=message")).or(streamPanel.locator("text=No messages")).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("messages appear after chat interaction (requires credentials)", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    // Send a message
    const textarea = page.locator("textarea");
    await textarea.fill("Say hello");
    await textarea.press("Enter");

    // Wait for messages to appear in the stream panel
    const streamPanel = page.locator('[id="stream"]');
    await expect(
      streamPanel.locator('[class*="message"], [class*="entry"], [class*="item"]').first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
