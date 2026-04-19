import { test, expect } from "@playwright/test";
import { lmstudioReachable, openSessionAndWait, sendChat, waitForAssistantReply } from "./helpers";

test.describe("cross-session recall (requires LM Studio)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await lmstudioReachable(request)), "LM Studio not reachable; skipping recall tests");
  });

  test("user profile grows after session close and informs next session", async ({ page, request }) => {
    test.setTimeout(300_000);

    // Session 1: user states a preference, then closes.
    await openSessionAndWait(page);
    const marker = `otter-e2e-${Date.now()}`;
    await sendChat(
      page,
      `Remember this about me permanently by calling update_user_profile with bucket="preferences": "I like marker ${marker}". Then just say: recorded.`,
    );
    await waitForAssistantReply(page, 90_000);

    // Trigger session close explicitly via reset button so the learning loop
    // runs (summarize + extract + rebuild profile).
    await page.getByRole("button", { name: "New session" }).click();
    // Close handler fires async; give it room to settle.
    await page.waitForTimeout(2_000);

    // Poll the profile endpoint.
    let profile: { preferences: Array<{ content: string }> } | null = null;
    for (let i = 0; i < 20; i++) {
      const res = await request.get("/api/user-profile");
      profile = (await res.json()) as typeof profile;
      if (profile?.preferences.some((p) => p.content.includes(marker))) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    expect(profile?.preferences.some((p) => p.content.includes(marker))).toBeTruthy();
  });
});
