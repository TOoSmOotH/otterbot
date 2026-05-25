import { join } from "node:path";
import type { Config } from "../../config.js";
import type { ChatClient } from "./chat-client.js";
import { SlackChatClient } from "./slack-client.js";
import { DiscordChatClient } from "./discord-client.js";
import { MatrixChatClient } from "./matrix-client.js";

/** Chat services that exist as bot providers (excludes "web" / Socket.IO). */
export type ChatProviderId = "slack" | "discord" | "matrix";

/** Per-agent storage paths a connector client may need (Matrix uses them). */
export interface ProviderPaths {
  storagePath: string;
  cryptoStoragePath: string;
}

export interface ChatProvider {
  id: ChatProviderId;
  /** Credential keys the connector role needs (drives the reconcile signature). */
  connectorTokenKeys: string[];
  /** Build a connector client from per-agent secrets; null if creds missing. */
  connectorClient(secrets: Map<string, string>, paths: ProviderPaths): ChatClient | null;
  /** Build a transport client from instance config; null if creds missing. */
  transportClient(cfg: Config): ChatClient | null;
  /** The room/channel id the transport posts to; null if not configured. */
  transportRoomId(cfg: Config): string | null;
}

export const PROVIDERS: Record<ChatProviderId, ChatProvider> = {
  slack: {
    id: "slack",
    connectorTokenKeys: ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
    connectorClient(secrets) {
      const bot = secrets.get("SLACK_BOT_TOKEN");
      const app = secrets.get("SLACK_APP_TOKEN");
      return bot && app ? new SlackChatClient(bot, app) : null;
    },
    transportClient(cfg) {
      return cfg.slackBotToken && cfg.slackAppToken
        ? new SlackChatClient(cfg.slackBotToken, cfg.slackAppToken)
        : null;
    },
    transportRoomId: (cfg) => cfg.slackChannelId,
  },
  discord: {
    id: "discord",
    connectorTokenKeys: ["DISCORD_BOT_TOKEN"],
    connectorClient(secrets) {
      const bot = secrets.get("DISCORD_BOT_TOKEN");
      return bot ? new DiscordChatClient(bot) : null;
    },
    transportClient(cfg) {
      return cfg.discordBotToken ? new DiscordChatClient(cfg.discordBotToken) : null;
    },
    transportRoomId: (cfg) => cfg.discordChannelId,
  },
  matrix: {
    id: "matrix",
    connectorTokenKeys: ["MATRIX_HOMESERVER_URL", "MATRIX_ACCESS_TOKEN"],
    connectorClient(secrets, paths) {
      const url = secrets.get("MATRIX_HOMESERVER_URL");
      const token = secrets.get("MATRIX_ACCESS_TOKEN");
      return url && token
        ? new MatrixChatClient(url, token, paths.storagePath, paths.cryptoStoragePath)
        : null;
    },
    transportClient(cfg) {
      return cfg.matrixHomeserverUrl && cfg.matrixAccessToken
        ? new MatrixChatClient(
            cfg.matrixHomeserverUrl,
            cfg.matrixAccessToken,
            join(cfg.dataDir, "matrix", "bus.json"),
            join(cfg.dataDir, "matrix", "crypto-bus")
          )
        : null;
    },
    transportRoomId: (cfg) => cfg.matrixRoomId,
  },
};
