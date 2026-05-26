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

/** Hooks a connector client may use to persist credentials it derives at runtime. */
export interface ConnectorContext {
  /** Persist a secret back to the agent's store (e.g. a minted Matrix token). */
  persistSecret: (key: string, value: string) => void;
}

export interface ChatProvider {
  id: ChatProviderId;
  /** Credential keys the connector role needs (drives the reconcile signature). */
  connectorTokenKeys: string[];
  /** Build a connector client from per-agent secrets; null if creds missing. */
  connectorClient(
    secrets: Map<string, string>,
    paths: ProviderPaths,
    ctx: ConnectorContext
  ): ChatClient | null;
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
    // Login credentials, not a pasted token: otterbot mints its own device so the
    // crypto store is owned exclusively (see MatrixAuth in matrix-client.ts).
    connectorTokenKeys: ["MATRIX_HOMESERVER_URL", "MATRIX_USER", "MATRIX_PASSWORD"],
    connectorClient(secrets, paths, ctx) {
      const url = secrets.get("MATRIX_HOMESERVER_URL");
      const user = secrets.get("MATRIX_USER");
      const password = secrets.get("MATRIX_PASSWORD");
      if (!url || !user || !password) return null;
      return new MatrixChatClient(
        url,
        {
          token: secrets.get("MATRIX_ACCESS_TOKEN") ?? null,
          deviceId: secrets.get("MATRIX_DEVICE_ID") ?? null,
          login: { user, password },
          persist: (token, deviceId) => {
            ctx.persistSecret("MATRIX_ACCESS_TOKEN", token);
            ctx.persistSecret("MATRIX_DEVICE_ID", deviceId);
          },
        },
        paths.storagePath,
        paths.cryptoStoragePath
      );
    },
    transportClient(cfg) {
      return cfg.matrixHomeserverUrl && cfg.matrixAccessToken
        ? new MatrixChatClient(
            cfg.matrixHomeserverUrl,
            {
              token: cfg.matrixAccessToken,
              deviceId: null,
              // The bus transport is instance-wide token config; no login/persist.
              login: null,
              persist: () => {},
            },
            join(cfg.dataDir, "matrix", "bus.json"),
            join(cfg.dataDir, "matrix", "crypto-bus")
          )
        : null;
    },
    transportRoomId: (cfg) => cfg.matrixRoomId,
  },
};
