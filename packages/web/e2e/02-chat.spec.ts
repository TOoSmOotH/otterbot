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
});
