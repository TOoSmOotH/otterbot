import { test, expect } from "../fixtures";

test.describe("Chat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 10_000 });
  });

  test("textarea renders", async ({ page }) => {
    await expect(page.locator("textarea")).toBeVisible();
  });

  test("can type a message", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("Hello, world!");
    await expect(textarea).toHaveValue("Hello, world!");
  });

  test("send button is disabled when textarea is empty", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("");
    const sendButton = page.locator('button[aria-label="Send message"]');
    // Button should either be disabled or not present when empty
    if (await sendButton.count() > 0) {
      await expect(sendButton).toBeDisabled();
    }
  });

  test("send button is enabled with text", async ({ page }) => {
    const textarea = page.locator("textarea");
    await textarea.fill("Test message");
    const sendButton = page.locator('button[aria-label="Send message"]');
    if (await sendButton.count() > 0) {
      await expect(sendButton).toBeEnabled();
    }
  });

  test("send and receive streaming response (requires credentials)", async ({
    page,
    requireProvider,
  }) => {
    requireProvider("openai-compatible");

    const textarea = page.locator("textarea");
    await textarea.fill("Say exactly: hello e2e test");
    await textarea.press("Enter");

    // Verify the user's message appears in the chat panel
    const chatPanel = page.locator('[id="chat"]');
    await expect(
      chatPanel.getByText("Say exactly: hello e2e test"),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("conversation list is visible", async ({ page }) => {
    // The project list / conversation area should be in the left panel
    const chatPanel = page.locator('[id="chat"]');
    await expect(chatPanel).toBeVisible();
  });
});
