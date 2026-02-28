import { defineModule, type ModuleContext } from "@otterbot/shared";
import { DiscordSupportClient } from "./discord-client.js";
import { pollGitHub, fullSyncGitHub } from "./github-indexer.js";
import { handleSupportMessage } from "./response-handler.js";
import { searchCodeTool, getFileTool, searchThreadsTool } from "./tools.js";
import { migration001 } from "./migrations/001-initial.js";

// ─── Discord client lifecycle ───────────────────────────────────────────────

let discordClient: DiscordSupportClient | null = null;

// ─── Module definition ──────────────────────────────────────────────────────

export default defineModule({
  manifest: {
    id: "discord-support",
    name: "Discord Support Bot",
    version: "0.1.0",
    description:
      "Monitors Discord forum channels and provides AI-powered support responses using indexed GitHub source code",
    author: "Otterbot",
  },

  agent: {
    defaultName: "Discord Support Agent",
    defaultPrompt: [
      "You are a support assistant that helps users with questions about a project's codebase.",
      "You have access to indexed source code and past support thread history.",
      "",
      "When answering questions:",
      "- Use the search_code tool to find relevant source files",
      "- Use the get_file tool to retrieve specific files",
      "- Use the search_threads tool to find similar past questions",
      "- Reference specific file paths and line numbers when relevant",
      "- Be concise but thorough",
      "- If you don't know the answer, say so honestly",
    ].join("\n"),
  },

  configSchema: {
    discord_token: {
      type: "secret",
      description:
        "Discord bot token for the support bot (separate from main Otterbot Discord)",
      required: true,
    },
    forum_channel_ids: {
      type: "string",
      description: "Comma-separated Discord forum channel IDs to monitor",
      required: true,
    },
    response_mode: {
      type: "select",
      description: "When to respond to forum threads",
      required: false,
      default: "auto",
      options: [
        { value: "auto", label: "Auto-respond to all messages" },
        { value: "mention", label: "Only respond when @mentioned" },
        { value: "new_threads", label: "Only respond to new thread openings" },
      ],
    },
    github_repo: {
      type: "string",
      description:
        "GitHub repository to index (owner/repo format, e.g. 'myorg/myproject')",
      required: true,
    },
    github_token: {
      type: "secret",
      description:
        "GitHub token for source code access (falls back to global github:token)",
      required: false,
    },
    github_branch: {
      type: "string",
      description: "Branch to index (defaults to repo's default branch)",
      required: false,
    },
    github_paths: {
      type: "string",
      description:
        "Comma-separated path prefixes to index (e.g. 'src/,docs/'). Empty = all",
      required: false,
    },
    github_extensions: {
      type: "string",
      description:
        "Comma-separated file extensions to index (e.g. '.ts,.js,.md'). Empty = common code extensions",
      required: false,
      default: ".ts,.js,.tsx,.jsx,.py,.go,.rs,.md,.yaml,.yml,.json",
    },
    max_file_size_kb: {
      type: "number",
      description: "Max file size in KB to index (default 100)",
      required: false,
      default: 100,
    },
    bot_name: {
      type: "string",
      description: "Display name the bot uses when describing itself",
      required: false,
      default: "Support Bot",
    },
  },

  triggers: [
    { type: "poll", intervalMs: 600_000, minIntervalMs: 120_000 },
  ],

  migrations: [migration001],

  tools: [searchCodeTool, getFileTool, searchThreadsTool],

  async onPoll(ctx) {
    return pollGitHub(ctx);
  },

  async onFullSync(ctx) {
    return fullSyncGitHub(ctx);
  },

  async onQuery(query, ctx) {
    const results = await ctx.knowledge.search(query, 5);

    if (results.length === 0) {
      return "No matching source files or discussions found.";
    }

    return results
      .map((doc) => {
        const isFile = doc.id.startsWith("file:");
        const label = isFile
          ? `File: ${(doc.metadata?.path as string) ?? doc.id}`
          : `Doc: ${doc.id}`;
        return `---\n${label}\n\n${doc.content}\n`;
      })
      .join("\n");
  },

  async onLoad(ctx: ModuleContext) {
    ctx.log("Discord Support module loading...");

    // Start Discord client if token is configured
    const token = ctx.getConfig("discord_token");
    if (token) {
      discordClient = new DiscordSupportClient(ctx, (message, thread) =>
        handleSupportMessage(ctx, discordClient!, message, thread),
      );
      await discordClient.start();
    } else {
      ctx.warn("discord_token not configured — Discord client will not start until configured");
    }
  },

  async onUnload(ctx: ModuleContext) {
    ctx.log("Discord Support module unloading...");
    if (discordClient) {
      await discordClient.stop();
      discordClient = null;
    }
  },
});
