import { test, expect } from "@playwright/test";
import { lmstudioReachable, openSessionAndWait, sendChat, waitForAssistantReply } from "./helpers";

test.describe("self-learning loop (requires LM Studio)", () => {
  test.beforeEach(async ({ request }) => {
    test.skip(!(await lmstudioReachable(request)), "LM Studio not reachable; skipping learning tests");
  });

  test("explicit save_memory tool call persists a memory", async ({ page, request }) => {
    await openSessionAndWait(page);
    const phrase = `e2e-marker-${Date.now()}`;
    await sendChat(
      page,
      `Use the save_memory tool to record this fact: "The e2e marker for this run is ${phrase}". Respond with just: saved.`,
    );
    await waitForAssistantReply(page, 90_000);

    // Poll the memories endpoint for the marker.
    let matched: unknown = null;
    for (let i = 0; i < 10; i++) {
      const res = await request.get("/api/memories");
      const memories = (await res.json()) as Array<{ content: string }>;
      matched = memories.find((m) => m.content.includes(phrase));
      if (matched) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(matched).toBeTruthy();
  });

  test("explicit author_skill tool call persists a skill", async ({ page, request }) => {
    await openSessionAndWait(page);
    const skillName = `e2e-skill-${Date.now()}`;
    await sendChat(
      page,
      `Use the author_skill tool with name="${skillName}", description="test skill for e2e", body="Step 1: do thing.\nStep 2: done.". Respond with just: authored.`,
    );
    await waitForAssistantReply(page, 90_000);

    let matched: unknown = null;
    for (let i = 0; i < 10; i++) {
      const res = await request.get("/api/skills");
      const skills = (await res.json()) as Array<{ meta: { name: string } }>;
      matched = skills.find((s) => s.meta.name === skillName);
      if (matched) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    expect(matched).toBeTruthy();
  });

  test("skill import from markdown payload", async ({ request }) => {
    const name = `imported-e2e-${Date.now()}`;
    const md = `---\nname: ${name}\ndescription: imported for e2e\nversion: 1.0.0\nauthor: test\ntags: [e2e]\n---\n\n## Steps\n1. Test step\n`;
    const res = await request.post("/api/skills/import", {
      data: { raw: md },
      headers: { "content-type": "application/json" },
    });
    expect(res.ok()).toBeTruthy();

    const list = await (await request.get("/api/skills")).json();
    expect(
      (list as Array<{ meta: { name: string } }>).some((s) => s.meta.name === name),
    ).toBeTruthy();
  });
});
