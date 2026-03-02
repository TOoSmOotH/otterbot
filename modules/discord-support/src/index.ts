import { defineModule, type ModuleContext } from "@otterbot/shared";
import { DiscordSupportClient } from "./discord-client.js";
import { pollGitHub, fullSyncGitHub, checkForNewReleases, recordAnnouncement } from "./github-indexer.js";
import { handleSupportMessage } from "./response-handler.js";
import { searchCodeTool, getFileTool, searchThreadsTool } from "./tools.js";
import { migration001 } from "./migrations/001-initial.js";
import { migration002 } from "./migrations/002-announcements.js";
import { migration003 } from "./migrations/003-multi-repo.js";
import { parseChannelConfigs } from "./channel-config.js";

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
      description: "Comma-separated Discord forum channel IDs to monitor (legacy)",
      required: false,
      hidden: true,
    },
    response_mode: {
      type: "select",
      description: "Global response mode (legacy)",
      required: false,
      default: "auto",
      hidden: true,
      options: [
        { value: "auto", label: "Auto-respond to all messages" },
        { value: "mention", label: "Only respond when @mentioned" },
        { value: "new_threads", label: "Only respond to new thread openings" },
      ],
    },
    channels_config: {
      type: "string",
      description: "Per-channel configuration (managed by the Channels UI)",
      required: false,
      hidden: true,
    },
    github_repo: {
      type: "string",
      description:
        "Comma-separated GitHub repos to index (owner/repo format, e.g. 'myorg/code,myorg/docs')",
      required: false,
    },
    github_token: {
      type: "secret",
      description:
        "GitHub token for API access (optional for public repos, increases rate limit from 60 to 5000 req/hr)",
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

  migrations: [migration001, migration002, migration003],

  tools: [searchCodeTool, getFileTool, searchThreadsTool],

  async onPoll(ctx) {
    const pollResult = await pollGitHub(ctx);

    // Check for new releases and post announcements
    if (discordClient) {
      try {
        const releaseResults = await checkForNewReleases(ctx);
        if (releaseResults.length > 0) {
          const configs = parseChannelConfigs(ctx.getConfig("channels_config"));
          const announceChannels = configs.filter(
            (c) => c.enabled && c.responseMode === "announce",
          );

          for (const { release, repoId } of releaseResults) {
            const title = release.name || release.tag_name;
            const body = release.body
              ? release.body.length > 1500
                ? release.body.slice(0, 1500) + "..."
                : release.body
              : "";
            const refId = `${repoId}:${release.tag_name}`;
            const content = [
              `**New Release: ${title}** (${repoId})`,
              body ? `\n${body}` : "",
              `\n[View Release](${release.html_url})`,
            ].join("");

            for (const channel of announceChannels) {
              try {
                await discordClient.sendToChannel(channel.channelId, content);
                recordAnnouncement(ctx, channel.channelId, "release", refId, repoId, content);
              } catch (err) {
                ctx.error(`Failed to announce release to channel ${channel.channelId}:`, err);
              }
            }

            // If no announce channels configured, still record so we don't re-check
            if (announceChannels.length === 0) {
              recordAnnouncement(ctx, "_none", "release", refId, repoId, content);
            }
          }

          if (releaseResults.length > 0 && announceChannels.length > 0) {
            ctx.log(`Announced ${releaseResults.length} release(s) to ${announceChannels.length} channel(s)`);
          }
        }
      } catch (err) {
        ctx.error("Failed to check/announce releases:", err);
      }
    }

    return pollResult;
  },

  async onFullSync(ctx) {
    return fullSyncGitHub(ctx);
  },

  async onWebhook(req, ctx) {
    const body = req.body as Record<string, unknown> | undefined;
    const action = body?.action as string | undefined;

    if (action === "list-channels") {
      if (!discordClient) {
        return { status: 400, body: { error: "Discord client not connected" } };
      }
      const channels = await discordClient.getGuildChannels();
      return { body: { channels } };
    }

    return { status: 400, body: { error: `Unknown action: ${action}` } };
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
      discordClient = new DiscordSupportClient(ctx, (message, channel) =>
        handleSupportMessage(ctx, discordClient!, message, channel),
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
