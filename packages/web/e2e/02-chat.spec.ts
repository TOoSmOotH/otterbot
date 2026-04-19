import { test, expect } from "@playwright/test";
import { lmstudioReachable, openSessionAndWait, sendChat, waitForAssistantReply } from "./helpers";

test.describe("chat round trip (requires LM Studio)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await lmstudioReachable(request)), "LM Studio not reachable; skipping LLM tests");
  });

  test("user message produces streamed assistant response", async ({ page }) => {
    await openSessionAndWait(page);
    await sendChat(page, "Say the single word: hello");
    const reply = await waitForAssistantReply(page);
    const text = (await reply.textContent()) ?? "";
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test("assistant supports multi-turn context in same session", async ({ page }) => {
    await openSessionAndWait(page);
    await sendChat(page, "My favorite color is teal. Remember that.");
    await waitForAssistantReply(page);
    await sendChat(page, "What color did I just say?");
    const reply = await waitForAssistantReply(page);
    const text = ((await reply.textContent()) ?? "").toLowerCase();
    expect(text).toContain("teal");
  });
});
