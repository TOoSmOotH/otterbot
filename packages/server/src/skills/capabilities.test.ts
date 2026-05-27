import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProfile, SkillConfigSchema } from "@otterbot/shared";
import { buildAgentContext, type AgentContext } from "../runtime/agent-context.js";
import { NullEmbedder } from "../embedding.js";
import { buildAgentTools } from "../agent/tools.js";
import { buildSystemPrompt } from "../agent/prompt.js";

/**
 * The capabilities redesign: enabled tool-bearing capabilities grant their
 * tools (on top of the profile's core toggles) and get their prompt injected
 * every turn.
 */

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "test",
    displayName: "Test",
    role: "agent",
    persona: "a tester",
    model: {
      chat: "test-chat",
      embedding: "test-embedding",
    },
    allowedChatServices: ["web"],
    transport: "local",
    slack: null,
    discord: null,
    matrix: null,
    email: null,
    artwork: { avatar: null },
    allowedPeers: [],
    canSpawnSubagents: false,
    subagentLimit: 0,
    dispatchToSubagent: false,
    browseTimeoutMs: null,
    maxSteps: null,
    canRunShell: false,
    canWebSearch: false,
    autoLearn: true,
    mcpServers: [],
    parentId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("capabilities", () => {
  let dir: string;
  let ctx: AgentContext;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-cap-"));
    ctx = buildAgentContext({
      profile: makeProfile(),
      chatModelRef: { provider: "x", account: "default", modelId: "m" },
      scopedSecrets: new Map(),
      contextWindow: 16_000,
      agentDbPath: join(dir, "agent.db"),
      skillsDir: join(dir, "skills"),
      workspaceDir: join(dir, "workspace"),
      browserProfileDir: join(dir, "browser"),
      imagesDir: join(dir, "images"),
      filesDir: join(dir, "files"),
      embedder: new NullEmbedder(),
      dbKey: null,
      defaultBrowseTimeoutMs: 60_000,
      defaultMaxSteps: 8,
    });
  });

  afterEach(() => {
    ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("tool-bearing capabilities default to enabled; pure-prompt skills do not", () => {
    const cap = ctx.skills.create({
      meta: {
        name: "Shell cap",
        description: "grants shell",
        version: "1.0.0",
        author: "t",
        tools: ["shell_exec"],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "do things",
      source: "builtin",
    });
    expect(cap.enabled).toBe(true);

    const skill = ctx.skills.create({
      meta: {
        name: "Pure prompt",
        description: "no tools",
        version: "1.0.0",
        author: "t",
        tools: [],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "a procedure",
      source: "authored",
    });
    expect(skill.enabled).toBe(false);
  });

  it("effectiveTools() is the union over enabled capabilities only", () => {
    ctx.skills.create({
      meta: {
        name: "Shell",
        description: "",
        version: "1.0.0",
        author: "t",
        tools: ["shell_exec"],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "x",
    });
    const web = ctx.skills.create({
      meta: {
        name: "Web",
        description: "",
        version: "1.0.0",
        author: "t",
        tools: ["web_search"],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "x",
    });
    expect([...ctx.skills.effectiveTools()].sort()).toEqual(["shell_exec", "web_search"]);

    // Disabling a capability drops its tools from the union.
    ctx.skills.setEnabled(web.id, false);
    expect([...ctx.skills.effectiveTools()]).toEqual(["shell_exec"]);
  });

  it("grants shell_exec via a capability even when canRunShell is false", () => {
    expect(ctx.profile.canRunShell).toBe(false);
    // Without a capability, no shell tool.
    expect(buildAgentTools(ctx).shell_exec).toBeUndefined();

    ctx.skills.create({
      meta: {
        name: "Shell cap",
        description: "",
        version: "1.0.0",
        author: "t",
        tools: ["shell_exec"],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "x",
    });
    expect(buildAgentTools(ctx).shell_exec).toBeDefined();
  });

  it("integration tools appear only when a capability grants them", () => {
    expect(buildAgentTools(ctx).send_email).toBeUndefined();
    ctx.skills.create({
      meta: {
        name: "Email cap",
        description: "",
        version: "1.0.0",
        author: "t",
        tools: ["send_email"],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "x",
    });
    expect(buildAgentTools(ctx).send_email).toBeDefined();
  });

  it("the agentic-browsing capability grants the full browser_* tool family", () => {
    expect(buildAgentTools(ctx).browser_navigate).toBeUndefined();
    ctx.skills.create({
      meta: {
        name: "Agentic browsing",
        description: "",
        version: "1.0.0",
        author: "t",
        tools: [
          "browser_navigate",
          "browser_snapshot",
          "browser_click",
          "browser_type",
          "browser_press",
          "browser_scroll",
          "browser_back",
          "browser_get_images",
          "browser_console",
          "browser_vision",
        ],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "x",
    });
    const tools = buildAgentTools(ctx);
    for (const name of [
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_type",
      "browser_press",
      "browser_scroll",
      "browser_back",
      "browser_get_images",
      "browser_console",
      "browser_vision",
    ]) {
      expect(tools[name], `${name} should be granted`).toBeDefined();
    }
  });

  it("round-trips a configSchema through the DB and the markdown frontmatter", () => {
    const configSchema: SkillConfigSchema = {
      description: "test config",
      fields: [
        { key: "host", label: "Host", type: "string", credentialKey: "PROXMOX_HOST" },
        {
          key: "vms",
          label: "VMs",
          type: "list",
          credentialKey: "PROXMOX_VMS",
          itemFields: [
            { key: "vmid", label: "VMID", type: "number" },
            {
              key: "snapshots",
              label: "Snapshots",
              type: "list",
              itemFields: [{ key: "name", label: "Snapshot", type: "string" }],
            },
          ],
        },
      ],
    };
    const created = ctx.skills.create({
      meta: {
        name: "Configurable",
        description: "",
        version: "1.0.0",
        author: "t",
        tools: ["shell_exec"],
        capabilities: [],
        parameters: {},
        tags: [],
        configSchema,
      },
      body: "x",
    });
    expect(created.meta.configSchema).toEqual(configSchema);

    // Re-read from disk (the markdown file) — proves the YAML frontmatter
    // round-trips the nested itemFields, not just the DB column.
    ctx.skills.loadFromDisk();
    expect(ctx.skills.get(created.id)?.meta.configSchema).toEqual(configSchema);
  });

  it("injects a skill's configured (non-secret) settings into its prompt block", async () => {
    const cap = ctx.skills.create({
      meta: {
        name: "Proxmox VM control",
        description: "manage vms",
        version: "1.0.0",
        author: "t",
        tools: ["shell_exec"],
        capabilities: [],
        parameters: {},
        tags: [],
        configSchema: {
          fields: [
            { key: "host", label: "Host", type: "string", credentialKey: "PROXMOX_HOST" },
            {
              key: "secret",
              label: "Secret",
              type: "secret",
              secret: true,
              credentialKey: "PROXMOX_TOKEN_SECRET",
            },
          ],
        },
      },
      body: "## Setup",
    });
    void cap;
    // ctx.secrets is the flat map the prompt reads; seed it directly.
    ctx.secrets.set("PROXMOX_HOST", "pve.lan");
    ctx.secrets.set("PROXMOX_TOKEN_SECRET", "super-secret");
    const built = await buildSystemPrompt(ctx, { userMessage: "hi there" });
    expect(built.system).toContain("Host: pve.lan");
    expect(built.system).not.toContain("super-secret");
  });

  it("prompt injects enabled capabilities under Active capabilities", async () => {
    const cap = ctx.skills.create({
      meta: {
        name: "GitHub via gh",
        description: "operate github",
        version: "1.0.0",
        author: "t",
        tools: ["shell_exec"],
        capabilities: [],
        parameters: {},
        tags: [],
      },
      body: "## Setup\ninstall gh",
    });
    const built = await buildSystemPrompt(ctx, { userMessage: "hello there" });
    expect(built.system).toContain("## Active capabilities");
    expect(built.system).toContain("### Capability: GitHub via gh");
    expect(built.system).toContain("install gh");
    expect(built.skillsUsed).toContain(cap.id);

    // A disabled capability is not injected.
    ctx.skills.setEnabled(cap.id, false);
    const built2 = await buildSystemPrompt(ctx, { userMessage: "hello there" });
    expect(built2.system).not.toContain("## Active capabilities");
  });
});
