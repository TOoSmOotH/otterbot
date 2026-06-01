import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestStack, type TestStack } from "./test/harness.js";
import { buildServer } from "./server.js";
import { persistArtifact } from "./integrations/artifacts.js";
import * as schema from "./db/schema.js";
import type { AgentMemoryExport } from "@otterbot/shared";

/** End-to-end HTTP API tests — exercises the real Fastify routes via inject(). */
describe("HTTP API (e2e)", () => {
  let stack: TestStack;
  let app: FastifyInstance;

  beforeAll(async () => {
    stack = await createTestStack();
    app = await buildServer(stack.orch, stack.cfg);
    await app.ready();
  }, 30_000);

  afterAll(async () => {
    await app.close();
    await stack.cleanup();
  });

  it("GET /api/agents lists agents including the COO", async () => {
    const res = await app.inject({ method: "GET", url: "/api/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ id: string }>;
    expect(body.some((a) => a.id === "coo")).toBe(true);
  });

  it("POST /api/agents creates an agent; missing name is rejected", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/api/agents",
      payload: { displayName: "Api Agent" },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { id: string }).id).toBe("api-agent");

    const bad = await app.inject({ method: "POST", url: "/api/agents", payload: {} });
    expect(bad.statusCode).toBe(400);
  });

  it("GET /api/agents/:id returns a profile or 404s", async () => {
    const found = await app.inject({ method: "GET", url: "/api/agents/coo" });
    expect(found.statusCode).toBe(200);
    expect((found.json() as { role: string }).role).toBe("coo");

    const missing = await app.inject({ method: "GET", url: "/api/agents/does-not-exist" });
    expect(missing.statusCode).toBe(404);
  });

  it("PATCH /api/agents/:id updates the profile", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Patch Me" } });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/agents/patch-me",
      payload: { persona: "an updated persona" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { persona: string }).persona).toBe("an updated persona");
  });

  it("manages per-agent skills (add, list, delete)", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Skill Agent" } });

    const add = await app.inject({
      method: "POST",
      url: "/api/agents/skill-agent/skills",
      payload: { name: "Greeting Skill", body: "Step 1. Say hello." },
    });
    expect(add.statusCode).toBe(200);
    const skillId = (add.json() as { id: string }).id;

    const list = await app.inject({ method: "GET", url: "/api/agents/skill-agent/skills" });
    expect((list.json() as unknown[]).length).toBe(1);

    const del = await app.inject({
      method: "DELETE",
      url: `/api/agents/skill-agent/skills/${skillId}`,
    });
    expect((del.json() as { ok: boolean }).ok).toBe(true);

    const after = await app.inject({ method: "GET", url: "/api/agents/skill-agent/skills" });
    expect((after.json() as unknown[]).length).toBe(0);
  });

  it("manages credentials independently (add, list keys, delete one)", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Cred API" } });

    // Add two credentials in separate merge requests.
    await app.inject({
      method: "PATCH",
      url: "/api/agents/cred-api/credentials",
      payload: { SLACK_BOT_TOKEN: "xoxb-1" },
    });
    await app.inject({
      method: "PATCH",
      url: "/api/agents/cred-api/credentials",
      payload: { GITHUB_TOKEN: "ghp-1" },
    });

    // GET returns key+scope tuples (never values), and adding GITHUB_TOKEN
    // did not wipe SLACK_BOT_TOKEN. SLACK_BOT_TOKEN gets the legacy default
    // 'broad' scope since this endpoint is called outside of `boot()` where
    // the auto-tagger runs.
    const list = await app.inject({ method: "GET", url: "/api/agents/cred-api/credentials" });
    const listed = (list.json() as { keys: Array<{ key: string; scope: string }> }).keys;
    expect(listed.map((c) => c.key)).toEqual(["GITHUB_TOKEN", "SLACK_BOT_TOKEN"]);

    // Deleting one key leaves the rest intact.
    const del = await app.inject({
      method: "DELETE",
      url: "/api/agents/cred-api/credentials/GITHUB_TOKEN",
    });
    expect((del.json() as { ok: boolean }).ok).toBe(true);
    const after = await app.inject({ method: "GET", url: "/api/agents/cred-api/credentials" });
    expect(
      (after.json() as { keys: Array<{ key: string }> }).keys.map((c) => c.key),
    ).toEqual(["SLACK_BOT_TOKEN"]);
  });

  it("scopes credentials by capability so the shell env can be filtered", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Scope API" } });

    // Add a credential with an explicit cap-scope.
    await app.inject({
      method: "PATCH",
      url: "/api/agents/scope-api/credentials",
      payload: { GITHUB_TOKEN: { value: "ghp-scope", scope: "cap:gh-auth" } },
    });
    const list = await app.inject({ method: "GET", url: "/api/agents/scope-api/credentials" });
    const rows = (list.json() as { keys: Array<{ key: string; scope: string }> }).keys;
    expect(rows.find((r) => r.key === "GITHUB_TOKEN")?.scope).toBe("cap:gh-auth");

    // Retag via the scope-only endpoint — no need to re-send the value.
    const retag = await app.inject({
      method: "PATCH",
      url: "/api/agents/scope-api/credentials/GITHUB_TOKEN/scope",
      payload: { scope: "direct" },
    });
    expect((retag.json() as { ok: boolean }).ok).toBe(true);
    const list2 = await app.inject({ method: "GET", url: "/api/agents/scope-api/credentials" });
    expect(
      (list2.json() as { keys: Array<{ key: string; scope: string }> }).keys.find(
        (r) => r.key === "GITHUB_TOKEN",
      )?.scope,
    ).toBe("direct");

    // Invalid scope strings are rejected.
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/agents/scope-api/credentials/GITHUB_TOKEN/scope",
      payload: { scope: "garbage" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("manages scheduled tasks (add valid, reject invalid, delete)", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Sched Agent" } });

    const add = await app.inject({
      method: "POST",
      url: "/api/agents/sched-agent/scheduled-tasks",
      payload: { cron: "0 9 * * *", prompt: "morning report" },
    });
    expect(add.statusCode).toBe(200);
    const taskId = (add.json() as { id: string }).id;

    const bad = await app.inject({
      method: "POST",
      url: "/api/agents/sched-agent/scheduled-tasks",
      payload: { cron: "not-a-cron", prompt: "x" },
    });
    expect(bad.statusCode).toBe(400);

    const del = await app.inject({ method: "DELETE", url: `/api/scheduled-tasks/${taskId}` });
    expect(del.statusCode).toBe(200);
  });

  it("GET /api/providers lists model providers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/providers" });
    const body = res.json() as Array<{ id: string }>;
    expect(body.some((p) => p.id === "anthropic")).toBe(true);
    expect(body.some((p) => p.id === "lmstudio")).toBe(true);
  });

  it("stores global settings and redacts provider API keys", async () => {
    const update = await app.inject({
      method: "PUT",
      url: "/api/settings/global",
      payload: {
        theme: "forest",
        models: [
          { id: "gpt", label: "GPT-4o", provider: "openai", account: "default", modelId: "gpt-4o", kind: "chat" },
          {
            id: "nomic",
            label: "Nomic",
            provider: "lmstudio",
            account: "default",
            modelId: "nomic-embed-text",
            kind: "embedding",
          },
          // Preserve the COO's models so it keeps resolving after this save.
          { id: "default-chat", label: "local", provider: "lmstudio", account: "default", modelId: stack.fake.model, kind: "chat" },
          { id: "default-embedding", label: "local", provider: "lmstudio", account: "default", modelId: stack.fake.model, kind: "embedding" },
        ],
        defaultChatModelId: "gpt",
        defaultEmbeddingModelId: "nomic",
        codingModelPresets: [
          { id: "opencode-kimi", label: "OpenCode · Kimi", tool: "opencode", providerModel: "moonshot/kimi-k2" },
        ],
        providers: {
          anthropic: [
            { account: "default", baseUrl: "https://api.anthropic.com/v1", apiKeyConfigured: false },
          ],
          openai: [
            {
              account: "default",
              baseUrl: "https://api.openai.com/v1",
              apiKeyConfigured: false,
              authMethod: "oauth",
              apiKey: "sk-test",
            },
          ],
          lmstudio: [
            { account: "default", baseUrl: stack.cfg.lmstudioBaseUrl, apiKeyConfigured: false },
          ],
          ollama: [
            { account: "default", baseUrl: "http://localhost:11434/v1", apiKeyConfigured: false },
          ],
        },
      },
    });
    expect(update.statusCode).toBe(200);
    const updated = update.json() as {
      theme: string;
      models: Array<{ id: string; provider: string; account: string; modelId: string; kind: string }>;
      defaultChatModelId: string;
      codingModelPresets: Array<{ id: string; tool: string; providerModel?: string }>;
      providers: {
        openai: Array<{
          account: string;
          apiKey?: string;
          apiKeyConfigured: boolean;
          authMethod?: string;
        }>;
      };
    };
    expect(updated.theme).toBe("forest");
    expect(updated.defaultChatModelId).toBe("gpt");
    expect(updated.codingModelPresets).toContainEqual(
      expect.objectContaining({ id: "opencode-kimi", tool: "opencode", providerModel: "moonshot/kimi-k2" })
    );
    expect(updated.models.find((m) => m.id === "gpt")).toMatchObject({
      provider: "openai",
      account: "default",
      modelId: "gpt-4o",
      kind: "chat",
    });
    const openaiDefault = updated.providers.openai[0];
    expect(openaiDefault.apiKey).toBeUndefined();
    expect(openaiDefault.apiKeyConfigured).toBe(true);
    expect(openaiDefault.authMethod).toBe("oauth");
    expect(stack.orch.getGlobalProviderSecrets().get("OPENAI_API_KEY")).toBe("sk-test");
    expect(stack.orch.getGlobalProviderSecrets().get("OPENAI_AUTH_METHOD")).toBe("oauth");
  });

  it("GET /api/bus/messages and /api/subagent-tasks return arrays", async () => {
    const bus = await app.inject({ method: "GET", url: "/api/bus/messages" });
    expect(Array.isArray(bus.json())).toBe(true);
    const tasks = await app.inject({ method: "GET", url: "/api/subagent-tasks" });
    expect(Array.isArray(tasks.json())).toBe(true);
  });

  it("DELETE /api/agents/coo is refused", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/agents/coo" });
    expect(res.statusCode).toBe(400);
  });

  it("setup-state reports and updates onboarding status", async () => {
    const before = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect(before.statusCode).toBe(200);
    expect((before.json() as { onboardingComplete: boolean }).onboardingComplete).toBe(false);

    await app.inject({ method: "POST", url: "/api/setup-state/complete" });

    const after = await app.inject({ method: "GET", url: "/api/setup-state" });
    expect((after.json() as { onboardingComplete: boolean }).onboardingComplete).toBe(true);
  });

  it("test-model rejects a request missing provider/modelId", async () => {
    const res = await app.inject({ method: "POST", url: "/api/test-model", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it(
    "test-model verifies a working model connection",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/test-model",
        payload: { provider: "lmstudio", modelId: stack.cfg.model },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { ok: boolean }).ok).toBe(true);
    },
    60_000
  );

  it("provider-models rejects a request missing provider", async () => {
    const res = await app.inject({ method: "POST", url: "/api/provider-models", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("provider-models lists the models a local server serves", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/provider-models",
      payload: { provider: "lmstudio" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; models?: string[] };
    expect(body.ok).toBe(true);
    expect(body.models).toContain(stack.cfg.model);
  });

  it("GET /api/skill-catalog lists the first-party capabilities", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skill-catalog" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{
      id: string;
      name: string;
      tools: string[];
      markdown: string;
    }>;
    expect(body.length).toBeGreaterThan(0);
    const gh = body.find((c) => c.id === "gh-auth");
    expect(gh).toBeDefined();
    expect(gh?.tools).toContain("shell_exec");
    expect(gh?.markdown).toContain("## Setup");
    expect(body.some((c) => c.id === "web-research" && c.tools.includes("web_search"))).toBe(true);
    expect(body.some((c) => c.id === "email" && c.tools.includes("send_email"))).toBe(true);
  });

  it("capability install rejects an unknown catalog id and a missing agent", async () => {
    const badSkill = await app.inject({
      method: "POST",
      url: "/api/agents/coo/skills/install",
      payload: { catalogId: "does-not-exist" },
    });
    expect(badSkill.statusCode).toBe(400);

    const badAgent = await app.inject({
      method: "POST",
      url: "/api/agents/nope/skills/install",
      payload: { catalogId: "gh-auth" },
    });
    expect(badAgent.statusCode).toBe(404);
  });

  it("installs a capability, toggles it, and grants its tool", async () => {
    const install = await app.inject({
      method: "POST",
      url: "/api/agents/coo/skills/install",
      payload: { catalogId: "gh-auth" },
    });
    expect(install.statusCode).toBe(200);
    const installed = install.json() as { id: string; enabled: boolean; meta: { tools: string[] } };
    expect(installed.id).toBe("gh-auth");
    expect(installed.enabled).toBe(true);
    expect(installed.meta.tools).toContain("shell_exec");

    const list = await app.inject({ method: "GET", url: "/api/agents/coo/skills" });
    expect((list.json() as Array<{ id: string }>).some((s) => s.id === "gh-auth")).toBe(true);

    const off = await app.inject({
      method: "PATCH",
      url: "/api/agents/coo/skills/gh-auth",
      payload: { enabled: false },
    });
    expect(off.statusCode).toBe(200);
    expect((off.json() as { enabled: boolean }).enabled).toBe(false);

    const edit = await app.inject({
      method: "PATCH",
      url: "/api/agents/coo/skills/gh-auth",
      payload: { body: "custom body" },
    });
    expect(edit.statusCode).toBe(200);
    expect((edit.json() as { body: string }).body).toBe("custom body");
  });

  it("reports ChatGPT OAuth status (disconnected by default)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/openai/status" });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { connected: boolean }).connected).toBe(false);
  });

  it("adds a memory manually and rejects empty content", async () => {
    const empty = await app.inject({
      method: "POST",
      url: "/api/agents/coo/memories",
      payload: { content: "   " },
    });
    expect(empty.statusCode).toBe(400);

    const added = await app.inject({
      method: "POST",
      url: "/api/agents/coo/memories",
      payload: { content: "The user's name is Mike.", category: "fact" },
    });
    expect(added.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/api/agents/coo/memories" });
    const body = list.json() as Array<{ content: string; source: string }>;
    expect(body.some((m) => m.content.includes("Mike") && m.source === "user")).toBe(true);
  });

  it(
    "lists conversations, fetches a transcript, and reports context status",
    async () => {
      const coo = stack.orch.getRuntime("coo");
      expect(coo).toBeDefined();
      await coo!.respond({
        conversationId: "conv-coo-history",
        userMessage: "Remember the number 42 for later.",
        onChunk: () => {},
      });

      const list = await app.inject({
        method: "GET",
        url: "/api/agents/coo/conversations",
      });
      expect(list.statusCode).toBe(200);
      const convs = list.json() as Array<{
        id: string;
        title: string | null;
        messageCount: number;
      }>;
      const conv = convs.find((c) => c.id === "conv-coo-history");
      expect(conv).toBeDefined();
      expect(conv?.title).toBeTruthy();
      expect(conv?.messageCount ?? 0).toBeGreaterThanOrEqual(2);

      const detail = await app.inject({
        method: "GET",
        url: "/api/agents/coo/conversations/conv-coo-history",
      });
      expect(detail.statusCode).toBe(200);
      const body = detail.json() as { messages: Array<{ role: string }> };
      expect(body.messages.length).toBeGreaterThanOrEqual(2);
      expect(body.messages[0].role).toBe("user");

      const context = await app.inject({
        method: "GET",
        url: "/api/agents/coo/conversations/conv-coo-history/context",
      });
      expect(context.statusCode).toBe(200);
      const status = context.json() as { usedTokens: number; overBudget: boolean };
      expect(status.usedTokens).toBeGreaterThan(0);
      expect(status.overBudget).toBe(false);

      const compact = await app.inject({
        method: "POST",
        url: "/api/agents/coo/conversations/conv-coo-history/compact",
        payload: { force: true },
      });
      expect(compact.statusCode).toBe(200);
      expect((compact.json() as { budgetTokens: number }).budgetTokens).toBeGreaterThan(0);
    },
    60_000
  );

  it("exports an agent's memory and merge-imports it into another", async () => {
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Mem Source" } });
    await app.inject({ method: "POST", url: "/api/agents", payload: { displayName: "Mem Dest" } });

    // Seed the source: a memory, a profile fact, and a session summary.
    await app.inject({
      method: "POST",
      url: "/api/agents/mem-source/memories",
      payload: { content: "The user keeps otters.", category: "fact" },
    });
    const src = stack.orch.getContext("mem-source")!;
    src.userProfile.addFact("facts", "Lives near a river");
    src.db
      .insert(schema.sessionSummaries)
      .values({
        id: "src-summary-1",
        conversationId: "conv-source-1",
        summary: "Discussed otter care.",
        keyPoints: ["otters need water"],
        createdAt: new Date().toISOString(),
      })
      .run();

    // Export.
    const exported = await app.inject({ method: "GET", url: "/api/agents/mem-source/memory/export" });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["content-disposition"]).toContain("mem-source-memory.json");
    const payload = exported.json() as AgentMemoryExport;
    expect(payload.otterbotMemoryExport).toBe(1);
    expect(payload.memories.some((m) => m.content.includes("otters"))).toBe(true);
    expect(payload.sessionSummaries).toHaveLength(1);
    expect(payload.userProfile.facts.some((f) => f.content === "Lives near a river")).toBe(true);

    // Import into the destination over a multipart upload.
    const importInto = (body: object) => {
      const boundary = "----otterbottest";
      const json = JSON.stringify(body);
      const multipart =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="mem.json"\r\n` +
        `Content-Type: application/json\r\n\r\n` +
        json +
        `\r\n--${boundary}--\r\n`;
      return app.inject({
        method: "POST",
        url: "/api/agents/mem-dest/memory/import",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: multipart,
      });
    };

    const imported = await importInto(payload);
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ memories: 1, summaries: 1, profileMerged: true });

    const dest = stack.orch.getContext("mem-dest")!;
    expect(dest.memory.exportAll()).toHaveLength(1);
    expect(dest.memory.exportAll()[0].id).not.toBe(payload.memories[0].id); // fresh id
    expect(dest.userProfile.get().facts.some((f) => f.content === "Lives near a river")).toBe(true);

    // A second import merges memories (count grows) and dedupes summaries by conversation.
    const again = await importInto(payload);
    expect(again.json()).toMatchObject({ memories: 1, summaries: 0 });
    expect(dest.memory.exportAll()).toHaveLength(2);

    // Garbage upload is rejected.
    const bad = await importInto({ not: "an export" });
    expect(bad.statusCode).toBe(400);
  });

  it("404s conversation routes for unknown agent and conversation", async () => {
    const badAgent = await app.inject({
      method: "GET",
      url: "/api/agents/does-not-exist/conversations",
    });
    expect(badAgent.statusCode).toBe(404);

    const badConv = await app.inject({
      method: "GET",
      url: "/api/agents/coo/conversations/no-such-conversation",
    });
    expect(badConv.statusCode).toBe(404);
  });

  it("serves an agent's produced files and guards path traversal", async () => {
    // Plant a file in the COO's artifacts dir, exactly as persistArtifact would.
    const art = persistArtifact({
      filesDir: stack.profiles.pathsFor("coo").files,
      agentId: "coo",
      data: Buffer.from("hello,world\n"),
      name: "data.csv",
    });

    const ok = await app.inject({ method: "GET", url: art.url });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/csv");
    // Non-image types are offered as a download.
    expect(ok.headers["content-disposition"]).toContain("attachment");
    expect(ok.body).toBe("hello,world\n");

    // Missing file 404s; traversal and unknown agents are rejected.
    const missing = await app.inject({ method: "GET", url: "/api/agents/coo/files/nope.csv" });
    expect(missing.statusCode).toBe(404);
    expect(stack.orch.agentFilePath("coo", "../../etc/passwd")).toBeNull();
    expect(stack.orch.agentFilePath("coo", "a/b.txt")).toBeNull();
    expect(stack.orch.agentFilePath("no-such-agent", art.id)).toBeNull();
  });

  it("accepts a chat file upload, rejects unsupported types and unknown agents", async () => {
    const upload = (agentId: string, filename: string, contentType: string, body: string) => {
      const boundary = "----otterbotupload";
      const multipart =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n` +
        body +
        `\r\n--${boundary}--\r\n`;
      return app.inject({
        method: "POST",
        url: `/api/agents/${agentId}/files`,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: multipart,
      });
    };

    // A supported text upload returns a fetchable Artifact reference.
    const ok = await upload("coo", "notes.md", "text/markdown", "# hello");
    expect(ok.statusCode).toBe(200);
    const art = ok.json() as { url: string; kind: string; name: string };
    expect(art.name).toBe("notes.md");
    const fetched = await app.inject({ method: "GET", url: art.url });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body).toBe("# hello");

    // Unsupported type → 415; unknown agent → 404.
    const bad = await upload("coo", "x.exe", "application/x-msdownload", "MZ");
    expect(bad.statusCode).toBe(415);
    const noAgent = await upload("does-not-exist", "a.txt", "text/plain", "hi");
    expect(noAgent.statusCode).toBe(404);
  });
});
