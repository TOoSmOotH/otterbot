import { generateText, tool, type Tool } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { AgentContext } from "../runtime/agent-context.js";
import type { AgentServices } from "../runtime/agent-services.js";
import { sendEmail } from "../integrations/email.js";
import { createIssue, listIssues } from "../integrations/github.js";
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  listVms,
  rollbackSnapshot,
  startVm,
  stopVm,
  vmStatus,
} from "../integrations/proxmox.js";
import { runAgentShell } from "../integrations/shell.js";
import { searchWeb } from "../integrations/web-search.js";
import { editImage, generateImage, persistImage } from "../integrations/image-gen.js";
import { persistArtifact } from "../integrations/artifacts.js";
import type { Artifact } from "@otterbot/shared";
import {
  browserBack,
  browserClick,
  browserConsole,
  browserEnvFor,
  browserGetImages,
  browserNavigate,
  browserPress,
  browserScreenshot,
  browserScroll,
  browserSnapshot,
  browserType,
} from "../integrations/browser.js";
import { resolveChatModel } from "../providers/registry.js";

/**
 * Resolve an `/api/agents/<id>/(files|images)/<name>` reference to a data URL
 * via the cross-agent binary read service, so `edit_image` can read another
 * agent's uploaded or generated image (e.g. the COO's upload). Returns the ref
 * unchanged when it isn't such a URL or no service is available.
 */
function resolveArtifactRef(ref: string | undefined, services?: AgentServices): string | undefined {
  if (!ref || !services) return ref;
  const m = ref.match(/\/agents\/([^/]+)\/(files|images)\/([^/?#]+)/);
  if (!m) return ref;
  const bin = services.readArtifactBinary(m[1], m[2] as "files" | "images", m[3]);
  if (!bin) return ref;
  return `data:${bin.mimeType};base64,${bin.data.toString("base64")}`;
}

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

  // Tools granted by enabled capabilities, on top of the profile's core
  // toggles. A capability grants a tool by listing it in its `meta.tools`.
  const granted = ctx.skills.effectiveTools();
  const canUse = (name: string, profileFlag: boolean) => profileFlag || granted.has(name);

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

  };

  // Integration tools — granted only by an enabled capability that declares
  // them (e.g. the `email` / `gh-auth` capabilities). They still need the
  // matching credentials (SMTP / GITHUB_TOKEN) configured for the agent.
  if (granted.has("send_email")) {
    tools.send_email = tool({
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
    });
  }

  if (granted.has("github_create_issue")) {
    tools.github_create_issue = tool({
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
    });
  }

  if (granted.has("github_list_issues")) {
    tools.github_list_issues = tool({
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
    });
  }

  // Proxmox VE VM management — granted by the `proxmox` capability. Each tool
  // is gated by the agent's PROXMOX_ALLOWED_VMIDS allowlist inside the
  // integration, so it can only touch VMs the user explicitly granted.
  if (granted.has("proxmox_list_vms")) {
    tools.proxmox_list_vms = tool({
      description:
        "List the Proxmox VMs this agent is allowed to manage, with their vmid, name, node, and status.",
      parameters: z.object({}),
      execute: async () => {
        try {
          return { ok: true, vms: await listVms(ctx.secrets) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_status")) {
    tools.proxmox_status = tool({
      description: "Get the current status of a Proxmox VM by its vmid.",
      parameters: z.object({ vmid: z.number().int().positive() }),
      execute: async ({ vmid }) => {
        try {
          return { ok: true, ...(await vmStatus(ctx.secrets, vmid)) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_start")) {
    tools.proxmox_start = tool({
      description: "Start a Proxmox VM by its vmid. Returns the Proxmox task id (UPID).",
      parameters: z.object({ vmid: z.number().int().positive() }),
      execute: async ({ vmid }) => {
        try {
          return { ok: true, ...(await startVm(ctx.secrets, vmid)) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_stop")) {
    tools.proxmox_stop = tool({
      description:
        "Stop a Proxmox VM. By default sends a graceful ACPI shutdown; set graceful=false " +
        "to hard-stop (pull the power). Returns the Proxmox task id (UPID).",
      parameters: z.object({
        vmid: z.number().int().positive(),
        graceful: z.boolean().default(true),
      }),
      execute: async ({ vmid, graceful }) => {
        try {
          return { ok: true, ...(await stopVm(ctx.secrets, { vmid, graceful })) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_list_snapshots")) {
    tools.proxmox_list_snapshots = tool({
      description: "List the snapshots of a Proxmox VM by its vmid.",
      parameters: z.object({ vmid: z.number().int().positive() }),
      execute: async ({ vmid }) => {
        try {
          return { ok: true, snapshots: await listSnapshots(ctx.secrets, vmid) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_rollback")) {
    tools.proxmox_rollback = tool({
      description:
        "Roll a Proxmox VM back to a named snapshot. This reverts the VM's disk and " +
        "(if captured) RAM to that snapshot. Returns the Proxmox task id (UPID).",
      parameters: z.object({
        vmid: z.number().int().positive(),
        snapname: z.string().min(1),
      }),
      execute: async ({ vmid, snapname }) => {
        try {
          return { ok: true, ...(await rollbackSnapshot(ctx.secrets, { vmid, snapname })) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_create_snapshot")) {
    tools.proxmox_create_snapshot = tool({
      description:
        "Take a new snapshot of a Proxmox VM. Returns the Proxmox task id (UPID).",
      parameters: z.object({
        vmid: z.number().int().positive(),
        snapname: z.string().min(1).describe("A name for the snapshot, e.g. \"before-test\"."),
        description: z.string().optional(),
      }),
      execute: async ({ vmid, snapname, description }) => {
        try {
          return { ok: true, ...(await createSnapshot(ctx.secrets, { vmid, snapname, description })) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  if (granted.has("proxmox_delete_snapshot")) {
    tools.proxmox_delete_snapshot = tool({
      description: "Delete a named snapshot of a Proxmox VM. Returns the Proxmox task id (UPID).",
      parameters: z.object({
        vmid: z.number().int().positive(),
        snapname: z.string().min(1),
      }),
      execute: async ({ vmid, snapname }) => {
        try {
          return { ok: true, ...(await deleteSnapshot(ctx.secrets, { vmid, snapname })) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  // Image generation via ChatGPT Codex OAuth (gpt-image-2) — granted by the
  // `image-gen` capability. Uses the instance-wide ChatGPT connection, so no
  // per-agent credential is needed; the result is saved and shown in the chat.
  if (granted.has("generate_image")) {
    tools.generate_image = tool({
      description:
        "Generate an image from a text prompt using ChatGPT (gpt-image-2). The " +
        "image is saved and shown in the chat; the result includes its URL. " +
        "Requires the user to have connected ChatGPT in Settings.",
      parameters: z.object({
        prompt: z.string().min(1).describe("A detailed description of the image to generate."),
        quality: z
          .enum(["low", "medium", "high"])
          .default("medium")
          .describe("Higher quality looks better but is slower."),
        size: z
          .string()
          .optional()
          .describe('Image size, e.g. "1024x1024", "1024x1536", or "1536x1024".'),
      }),
      execute: async ({ prompt, quality, size }) => {
        const res = await generateImage({ prompt, quality, size });
        if (!res.ok || !res.b64) return { ok: false, error: res.error ?? "image generation failed" };
        const { file } = persistImage(ctx.imagesDir, res.b64);
        return { ok: true, kind: "image", url: `/api/agents/${ctx.profile.id}/images/${file}`, prompt };
      },
    });
  }

  if (granted.has("edit_image")) {
    tools.edit_image = tool({
      description:
        "Edit or vary an existing image with ChatGPT (gpt-image-2), guided by a " +
        "prompt and optionally a mask. The source can be a previously generated " +
        "image URL, a file in your workspace, or an http(s) URL. The edited image " +
        "is saved and shown in the chat. Requires ChatGPT connected in Settings.",
      parameters: z.object({
        prompt: z.string().min(1).describe("How to change the image."),
        source_image: z
          .string()
          .min(1)
          .describe(
            "The image to edit: a generated-image or uploaded-file URL " +
              "(/api/agents/<id>/images|files/x.png, including another agent's), a " +
              "workspace-relative path, or an http(s) URL."
          ),
        mask: z
          .string()
          .optional()
          .describe("Optional mask image (same reference forms) marking the area to change."),
        quality: z.enum(["low", "medium", "high"]).default("medium"),
        size: z.string().optional().describe('Image size, e.g. "1024x1024".'),
      }),
      execute: async ({ prompt, source_image, mask, quality, size }) => {
        const res = await editImage({
          prompt,
          sourceImage: resolveArtifactRef(source_image, services) ?? source_image,
          mask: resolveArtifactRef(mask, services) ?? mask,
          quality,
          size,
          imagesDir: ctx.imagesDir,
          workspaceDir: ctx.workspaceDir,
        });
        if (!res.ok || !res.b64) return { ok: false, error: res.error ?? "image edit failed" };
        const { file } = persistImage(ctx.imagesDir, res.b64);
        return { ok: true, kind: "image", url: `/api/agents/${ctx.profile.id}/images/${file}`, prompt };
      },
    });
  }

  // Sandboxed shell — granted by `profile.canRunShell` or a capability.
  // Commands run on the host but are confined by an OS sandbox to the workspace.
  if (canUse("shell_exec", ctx.profile.canRunShell)) {
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
        const r = await runAgentShell(ctx.workspaceDir, ctx.shellSecrets(), command);
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

  // Web search — granted by `profile.canWebSearch` or a capability.
  if (canUse("web_search", ctx.profile.canWebSearch)) {
    tools.web_search = tool({
      description:
        "Search the web with DuckDuckGo. Returns a list of results, each with a " +
        "title, URL and snippet. Use it to find current information.",
      parameters: z.object({
        query: z.string().min(1).describe("The search query."),
      }),
      execute: async ({ query }) => {
        try {
          return { ok: true, results: await searchWeb(query) };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  // Agentic browsing (agent-browser) — granted together by the
  // `agentic-browsing` capability. Each agent drives its own persistent,
  // headless browser; work the page via the snapshot → ref → click/type loop.
  if (granted.has("browser_navigate")) {
    const browser = browserEnvFor(ctx.profile.id, ctx.browserProfileDir);

    tools.browser_navigate = tool({
      description:
        "Open a URL in your browser (launches it on first use). Call browser_snapshot " +
        "afterwards to see the page. Your browser is persistent — logins and cookies " +
        "carry over between tasks.",
      parameters: z.object({ url: z.string().url().describe("The URL to navigate to.") }),
      execute: ({ url }) => browserNavigate(browser, url),
    });

    tools.browser_snapshot = tool({
      description:
        "Capture the current page as an accessibility tree with @e<n> refs. This is how " +
        "you 'see' the page — every click/type targets a ref from here. Use interactive " +
        "to list only clickable/typable elements.",
      parameters: z.object({
        interactive: z
          .boolean()
          .default(true)
          .describe("Only include interactive elements (links, buttons, inputs)."),
        compact: z.boolean().default(false).describe("Drop empty structural nodes."),
      }),
      execute: ({ interactive, compact }) => browserSnapshot(browser, { interactive, compact }),
    });

    tools.browser_click = tool({
      description:
        "Click an element by its @e<n> ref (from browser_snapshot) or a CSS selector.",
      parameters: z.object({
        selector: z.string().min(1).describe("An @e<n> ref or a CSS selector."),
      }),
      execute: ({ selector }) => browserClick(browser, selector),
    });

    tools.browser_type = tool({
      description: "Type text into an input or textarea by its @e<n> ref or CSS selector.",
      parameters: z.object({
        selector: z.string().min(1).describe("An @e<n> ref or a CSS selector."),
        text: z.string().describe("The text to type."),
      }),
      execute: ({ selector, text }) => browserType(browser, selector, text),
    });

    tools.browser_press = tool({
      description: "Press a key or chord on the page, e.g. 'Enter', 'Tab', or 'Control+a'.",
      parameters: z.object({ key: z.string().min(1).describe("Key or chord to press.") }),
      execute: ({ key }) => browserPress(browser, key),
    });

    tools.browser_scroll = tool({
      description: "Scroll the page in a direction, optionally by a number of pixels.",
      parameters: z.object({
        direction: z.enum(["up", "down", "left", "right"]),
        pixels: z.number().int().positive().optional().describe("Pixels to scroll; omit for a page step."),
      }),
      execute: ({ direction, pixels }) => browserScroll(browser, direction, pixels),
    });

    tools.browser_back = tool({
      description: "Go back one entry in the browser history.",
      parameters: z.object({}),
      execute: () => browserBack(browser),
    });

    tools.browser_get_images = tool({
      description: "List the images on the current page (source URL, alt text, and natural size).",
      parameters: z.object({}),
      execute: () => browserGetImages(browser),
    });

    tools.browser_console = tool({
      description: "Read the browser console logs captured for the current page.",
      parameters: z.object({}),
      execute: () => browserConsole(browser),
    });

    tools.browser_vision = tool({
      description:
        "Take a screenshot of the current page and answer a question about it visually. " +
        "Use when the accessibility snapshot is not enough (e.g. layout, images, charts). " +
        "Requires a vision-capable model.",
      parameters: z.object({
        question: z.string().min(1).describe("What to look for or describe in the screenshot."),
      }),
      execute: async ({ question }) => {
        const shot = await browserScreenshot(browser);
        if (!shot.ok) return shot;
        try {
          const model = resolveChatModel(ctx.chatModelRef, ctx.secrets);
          const { text } = await generateText({
            model,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: question },
                  { type: "image", image: shot.base64 },
                ],
              },
            ],
          });
          return { ok: true, answer: text };
        } catch (err) {
          return {
            ok: false,
            error:
              `Vision analysis failed (the agent's model may not accept images): ` +
              (err instanceof Error ? err.message : String(err)),
          };
        }
      },
    });
  }

  // Tools discovered from the agent's MCP servers (populated after connect).
  Object.assign(tools, ctx.mcpTools);

  if (!services) return tools;

  tools.read_file = tool({
    description:
      "Read the text contents of a shared file by its reference, e.g. a doc " +
      "attached to a delegation or a file another agent produced. Pass the " +
      "file's path/URL (like /api/agents/<id>/files/<name>). Images and other " +
      "binary files cannot be read as text — reference those by URL instead.",
    parameters: z.object({
      path: z.string().min(1).describe("The file reference, e.g. /api/agents/<id>/files/<name>."),
    }),
    execute: async ({ path }) => {
      const m = path.match(/\/agents\/([^/]+)\/files\/([^/?#]+)/);
      if (!m) {
        return { ok: false, error: "Unrecognized file reference; expected /api/agents/<id>/files/<name>." };
      }
      return services.readArtifact(m[1], m[2]);
    },
  });

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

  if (canUse("spawn_subagent", ctx.profile.canSpawnSubagents)) {
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
        "Delegate a task to another agent by id and wait for its result. Use list_agents first to choose the right specialist. For large or structured context (briefs, specs, data), pass it as an `attachments` markdown doc instead of inlining it in `task` — the peer reads it with read_file. Keep `task` itself short.",
      parameters: z.object({
        agentId: z.string().min(1),
        task: z.string().min(1),
        attachments: z
          .array(
            z.object({
              name: z.string().min(1).describe("A filename, e.g. \"brief.md\"."),
              content: z.string().min(1).describe("The document's text (markdown)."),
            })
          )
          .optional()
          .describe("Documents to attach for the peer to read with read_file."),
      }),
      execute: async ({ agentId, task, attachments }) => {
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
        // Persist any attached docs to this (sending) agent's files dir; the
        // peer reads them on demand via read_file. Guard against oversized docs.
        const MAX_ATTACHMENT_BYTES = 1024 * 1024;
        const attached: Artifact[] = [];
        for (const a of attachments ?? []) {
          const data = Buffer.from(a.content, "utf8");
          if (data.byteLength > MAX_ATTACHMENT_BYTES) {
            return { ok: false, error: `Attachment "${a.name}" exceeds 1 MB; trim it or split it.` };
          }
          attached.push(
            persistArtifact({
              filesDir: ctx.filesDir,
              agentId: ctx.profile.id,
              data,
              name: a.name,
              mimeType: "text/markdown; charset=utf-8",
            })
          );
        }
        try {
          const res = await services.bus.request(
            {
              id: nanoid(),
              kind: "request",
              from: ctx.profile.id,
              to: agentId,
              threadId: nanoid(),
              correlationId: null,
              rootSpawnId: null,
              body: task,
              payload: attached.length ? { attachments: attached } : undefined,
              transport: ctx.profile.transport,
            },
            // A delegated task may itself spawn a subagent and run a slow tool
            // (e.g. image generation) — allow well beyond the 120s default.
            300_000
          );
          // Any files the peer produced ride back on the response payload; the
          // runtime surfaces these to display in this agent's chat.
          const payload = res.payload as { artifacts?: unknown } | undefined;
          const artifacts = Array.isArray(payload?.artifacts) ? payload!.artifacts : [];
          return { ok: true, kind: "delegate", from: agentId, result: res.body, artifacts };
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

  // Code reference (instance-wide cloned repos) — granted by the
  // `code-reference` capability. Search the shared index, then read the file.
  if (granted.has("list_reference_repos")) {
    tools.list_reference_repos = tool({
      description: "List the reference code repositories available to search.",
      parameters: z.object({}),
      execute: async () => ({ ok: true, repos: services.listCodeReferenceRepos() }),
    });
  }

  if (granted.has("code_search")) {
    tools.code_search = tool({
      description:
        "Exact keyword/regex grep across the configured reference repositories. " +
        "Best for finding a literal setting name, symbol, or string. Returns file " +
        "paths + line numbers; follow up with read_code to see surrounding context.",
      parameters: z.object({
        pattern: z.string().min(1).describe("Literal text (or a regex if regex=true) to find."),
        repo: z.string().optional().describe('Limit to one repo, "owner/name".'),
        regex: z.boolean().default(false),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ pattern, repo, regex, limit }) => ({
        ok: true,
        hits: await services.grepCodeReference(pattern, { repo, regex, limit }),
      }),
    });
  }

  if (granted.has("search_code")) {
    tools.search_code = tool({
      description:
        "Hybrid semantic + keyword search across reference repositories. Best for " +
        "conceptual questions when you don't know the exact term. Returns snippets " +
        "with file paths + line ranges; read_code for full context.",
      parameters: z.object({
        query: z.string().min(1),
        repo: z.string().optional().describe('Limit to one repo, "owner/name".'),
        limit: z.number().int().min(1).max(20).default(8),
      }),
      execute: async ({ query, repo, limit }) => ({
        ok: true,
        hits: await services.searchCodeReference(query, { repo, limit }),
      }),
    });
  }

  if (granted.has("read_code")) {
    tools.read_code = tool({
      description:
        "Read a file (or a line range) from a reference repository. Use after a " +
        "search hit to read the surrounding context — especially comments/annotations.",
      parameters: z.object({
        repo: z.string().describe('"owner/name"'),
        path: z.string().describe("Repo-relative file path."),
        startLine: z.number().int().min(1).optional(),
        endLine: z.number().int().min(1).optional(),
      }),
      execute: async ({ repo, path, startLine, endLine }) =>
        services.readCodeReference(
          repo,
          path,
          startLine ? { start: startLine, end: endLine } : undefined
        ),
    });
  }

  return tools;
}
