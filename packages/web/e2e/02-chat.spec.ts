import { test, expect } from "@playwright/test";
import { gotoApp, sendChat } from "./helpers";

/**
 * Chat tests — send a message to the COO and verify the user message and a
 * streamed assistant reply render. Runs against the fake model server, so the
 * reply is deterministic.
 */
test.describe("chat", () => {
  test("sending a message shows the user bubble", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("agent-card-coo").click();
    await sendChat(page, "hello otterbot");
    await expect(page.getByTestId("message-user").last()).toContainText("hello otterbot");
  });

  test("the agent streams a reply", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("agent-card-coo").click();
    await sendChat(page, "give me a one line answer");
    await expect(page.getByTestId("message-assistant").last()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("message-assistant").last()).not.toBeEmpty();
  });

  test("browse history, start a new conversation, and resume an old one", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("agent-card-coo").click();
    await sendChat(page, "remember my favorite color is teal");
    await expect(page.getByTestId("message-assistant").last()).toBeVisible({ timeout: 60_000 });

    // The sent conversation appears in the history browser, titled from its
    // first message.
    await page.getByRole("button", { name: "History" }).click();
    const item = page.getByTestId("conversation-item").first();
    await expect(item).toBeVisible({ timeout: 10_000 });
    await expect(item).toContainText("teal");

    // Starting a new conversation clears the transcript.
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await expect(page.getByTestId("message-user")).toHaveCount(0);

    // Reopening the prior conversation reloads its messages from the server.
    await page.getByTestId("conversation-item").first().click();
    await expect(page.getByTestId("message-user").first()).toContainText("teal");
  });

  test("the context panel shows token usage and compacts", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("agent-card-coo").click();
    await sendChat(page, "give me a short answer");
    await expect(page.getByTestId("message-assistant").last()).toBeVisible({ timeout: 60_000 });

    await page.getByRole("button", { name: "Context" }).click();
    const panel = page.getByTestId("context-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("tokens", { timeout: 10_000 });

    await page.getByTestId("compact-button").click();
    await expect(panel).toBeVisible();
  });
});
