import { tool, type Tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { AgentContext } from "../runtime/agent-context.js";
import type { AgentServices } from "../runtime/agent-services.js";
import { sendEmail } from "../integrations/email.js";
import { createIssue, listIssues } from "../integrations/github.js";
import { runAgentShell } from "../integrations/shell.js";

/**
 * Build the tool set for an agent, scoped to its own context. When cross-agent
 * `services` are available, coordination tools (delegate, spawn, broadcast) are
 * added — `delegate`/`broadcast` only for the COO.
 */
export function buildAgentTools(
  ctx: AgentContext,
  services?: AgentServices
): Record<string, Tool> {
  const skills = ctx.skills;
  const profile = ctx.userProfile;
  const memory = ctx.memory;
  const isCoo = ctx.profile.role === "coo";

  const tools: Record<string, Tool> = {
    list_skills: tool({
      description: "List all skills available to the agent. Returns names, descriptions, and tags.",
      parameters: z.object({}),
      execute: async () =>
        skills.list().map((s) => ({
          id: s.id,
          name: s.meta.name,
          description: s.meta.description,
          tags: s.meta.tags,
          useCount: s.useCount,
        })),
    }),

    author_skill: tool({
      description:
        "Author a new reusable skill. Use when you've just completed a task in a way that would be worth repeating. Provide clear procedural steps in the body.",
      parameters: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        body: z.string().min(1),
        tags: z.array(z.string()).default([]),
      }),
      execute: async ({ name, description, body, tags }) => {
        const skill = skills.create({
          meta: {
            name,
            description,
            version: "1.0.0",
            author: ctx.profile.id,
            tools: [],
            capabilities: [],
            parameters: {},
            tags,
          },
          body,
          source: "authored",
        });
        return { id: skill.id, created: true };
      },
    }),

    update_skill: tool({
      description:
        "Update an existing skill, either replacing its body or appending a refinement note. Use the skill's id from list_skills.",
      parameters: z.object({
        id: z.string().min(1),
        body: z.string().optional(),
        appendNote: z.string().optional(),
        description: z.string().optional(),
      }),
      execute: async ({ id, body, appendNote, description }) => {
        const updated = skills.update(id, {
          body,
          appendNote,
          meta: description ? { description } : undefined,
        });
        if (!updated) return { ok: false, reason: "skill not found" };
        return { ok: true, id: updated.id };
      },
    }),

    update_user_profile: tool({
      description:
        "Add a known fact, preference, or goal to the user's persistent profile. Use sparingly for durable attributes only.",
      parameters: z.object({
        bucket: z.enum(["preferences", "goals", "facts"]),
        content: z.string().min(1),
      }),
      execute: async ({ bucket, content }) => {
        profile.addFact(bucket, content);
        return { ok: true };
      },
    }),

    search_memory: tool({
      description:
        "Search this agent's long-term memory (hybrid keyword + semantic search). Use to recall facts saved in earlier sessions.",
      parameters: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(6),
      }),
      execute: async ({ query, limit }) => {
        const hits = await memory.search(query, { limit });
        return hits.map((h) => ({
          content: h.entry.content,
          category: h.entry.category,
          importance: h.entry.importance,
          score: h.score,
          via: h.via,
        }));
      },
    }),

    save_memory: tool({
      description:
        "Save something to long-term memory so you still know it in future sessions. Call this " +
        "whenever the user tells you to remember something, or shares a durable fact, preference, " +
        "or instruction about themselves or their work. Saving is the only way a memory persists " +
        "— acknowledging it in chat does not save it.",
      parameters: z.object({
        content: z
          .string()
          .min(1)
          .describe(
            'The thing to remember, as a clear standalone statement. e.g. "The user\'s name is Mike."'
          ),
        category: z
          .enum(["fact", "preference", "instruction", "relationship", "general"])
          .default("fact")
          .describe("What kind of memory this is."),
        importance: z.number().int().min(1).max(10).default(6),
      }),
      execute: async ({ content, category, importance }) => {
        const entry = memory.save({ content, category, importance, source: "agent" });
        return { ok: true, id: entry.id };
      },
    }),

    send_email: tool({
      description:
        "Send an email from this agent's own email account. Requires SMTP credentials configured for the agent.",
      parameters: z.object({
        to: z.string().min(3),
        subject: z.string().min(1),
        text: z.string().min(1),
      }),
      execute: async ({ to, subject, text }) => {
        try {
          const res = await sendEmail(ctx.secrets, { to, subject, text });
          return { ok: true, messageId: res.messageId };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    github_create_issue: tool({
      description:
        "Create a GitHub issue in owner/repo using this agent's GitHub token. Requires GITHUB_TOKEN configured.",
      parameters: z.object({
        repo: z.string().regex(/^[^/]+\/[^/]+$/, "must be owner/repo"),
        title: z.string().min(1),
        body: z.string().default(""),
      }),
      execute: async ({ repo, title, body }) => {
        try {
          const res = await createIssue(ctx.secrets, { repo, title, body });
          return { ok: true, number: res.number, url: res.url };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    github_list_issues: tool({
      description: "List open issues in a GitHub repo (owner/repo).",
      parameters: z.object({
        repo: z.string().regex(/^[^/]+\/[^/]+$/, "must be owner/repo"),
      }),
      execute: async ({ repo }) => {
        try {
          return { ok: true, issues: await listIssues(ctx.secrets, { repo }) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };

  // Sandboxed shell — opt-in per agent (profile.canRunShell). Commands run on
  // the host but are confined by an OS sandbox to the agent's workspace.
  if (ctx.profile.canRunShell) {
    tools.shell_exec = tool({
      description:
        "Run a shell command in this agent's sandboxed workspace directory. The " +
        "workspace persists across calls and is the command's HOME, so installed " +
        "tools, SSH keys and configs stick around. Commands are confined to the " +
        "workspace — they cannot read or modify anything outside it. Each call is a " +
        "fresh shell, so chain steps with '&&' or persist state to files. The " +
        "agent's own credentials are available as environment variables.",
      parameters: z.object({
        command: z.string().min(1).describe("Shell command to run (bash/sh syntax)."),
      }),
      execute: async ({ command }) => {
        const r = await runAgentShell(ctx.workspaceDir, ctx.secrets, command);
        if (r.error) return { ok: false, error: r.error };
        return {
          ok: r.ok,
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
          ...(r.timedOut ? { timedOut: true } : {}),
          ...(r.truncated ? { truncated: true } : {}),
        };
      },
    });
  }

  if (!services) return tools;

  tools.schedule_task = tool({
    description:
      "Schedule a recurring prompt for yourself using a cron expression (e.g. '0 9 * * *' for 9am daily). The prompt runs automatically on that schedule.",
    parameters: z.object({
      cron: z.string().min(1),
      prompt: z.string().min(1),
    }),
    execute: async ({ cron, prompt }) => {
      const task = services.scheduleTask(ctx.profile.id, cron, prompt);
      if (!task) return { ok: false, error: `Invalid cron expression: ${cron}` };
      return { ok: true, id: task.id, nextRunAt: task.nextRunAt };
    },
  });

  tools.list_scheduled_tasks = tool({
    description: "List your scheduled (cron) tasks.",
    parameters: z.object({}),
    execute: async () => services.listScheduledTasks(ctx.profile.id),
  });

  tools.cancel_scheduled_task = tool({
    description: "Cancel one of your scheduled tasks by id.",
    parameters: z.object({ id: z.string().min(1) }),
    execute: async ({ id }) => ({ ok: services.cancelScheduledTask(id) }),
  });

  tools.list_agents = tool({
    description:
      "List the other agents you can coordinate with. Returns their id, name, role, and what they specialize in.",
    parameters: z.object({}),
    execute: async () => {
      const others = services.listAgents().filter((a) => a.id !== ctx.profile.id);
      // The COO may reach every agent; other agents see only their permitted peers.
      if (isCoo) return others;
      const peerIds = new Set(ctx.profile.allowedPeers.map((p) => p.agentId));
      return others.filter((a) => peerIds.has(a.id));
    },
  });

  if (ctx.profile.canSpawnSubagents) {
    tools.spawn_subagent = tool({
      description:
        "Spawn a temporary subagent to pursue a focused goal in parallel and report back its findings. Use for research fan-out — spawn several, each on a different source.",
      parameters: z.object({ goal: z.string().min(1) }),
      execute: async ({ goal }) => {
        const res = await services.spawnSubagent(ctx.profile.id, goal);
        return { ok: true, subagentId: res.subagentId, summary: res.summary };
      },
    });
  }

  if (isCoo || ctx.profile.allowedPeers.length > 0) {
    tools.delegate = tool({
      description:
        "Delegate a task to another agent by id and wait for its result. Use list_agents first to choose the right specialist.",
      parameters: z.object({
        agentId: z.string().min(1),
        task: z.string().min(1),
      }),
      execute: async ({ agentId, task }) => {
        const known = services.listAgents();
        if (!known.some((a) => a.id === agentId)) {
          return {
            ok: false,
            error: `No agent "${agentId}". Known agents: ${known.map((a) => a.id).join(", ")}`,
          };
        }
        // The COO may message any agent; others only their permitted peers.
        if (!isCoo && !ctx.profile.allowedPeers.some((p) => p.agentId === agentId)) {
          const permitted = ctx.profile.allowedPeers.map((p) => p.agentId).join(", ") || "(none)";
          return {
            ok: false,
            error: `Not permitted to message "${agentId}". Permitted peers: ${permitted}`,
          };
        }
        try {
          const res = await services.bus.request({
            id: nanoid(),
            kind: "request",
            from: ctx.profile.id,
            to: agentId,
            threadId: nanoid(),
            correlationId: null,
            rootSpawnId: null,
            body: task,
            transport: ctx.profile.transport,
          });
          return { ok: true, from: agentId, result: res.body };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (isCoo || ctx.profile.allowedPeers.some((p) => p.shareMemory)) {
    tools.search_peer_memory = tool({
      description:
        "Search another agent's long-term memory (read-only). Use list_agents to find agent ids you may access.",
      parameters: z.object({
        agentId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(6),
      }),
      execute: async ({ agentId, query, limit }) => {
        // The COO may read any agent's memory; others need an explicit grant.
        if (
          !isCoo &&
          !ctx.profile.allowedPeers.some((p) => p.agentId === agentId && p.shareMemory)
        ) {
          return { ok: false, error: `Not permitted to read the memory of "${agentId}".` };
        }
        const hits = await services.searchPeerMemory(agentId, query, limit);
        return {
          ok: true,
          hits: hits.map((h) => ({
            content: h.entry.content,
            category: h.entry.category,
            importance: h.entry.importance,
            score: h.score,
            via: h.via,
          })),
        };
      },
    });
  }

  if (isCoo) {
    tools.broadcast = tool({
      description: "Send an announcement to every agent. Does not wait for replies.",
      parameters: z.object({ message: z.string().min(1) }),
      execute: async ({ message }) => {
        services.bus.publish({
          id: nanoid(),
          kind: "broadcast",
          from: ctx.profile.id,
          to: null,
          threadId: nanoid(),
          correlationId: null,
          rootSpawnId: null,
          body: message,
          transport: ctx.profile.transport,
        });
        return { ok: true };
      },
    });
  }

  return tools;
}
