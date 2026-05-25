import { join } from "node:path";
import type { Config } from "../../config.js";
import type { Transport } from "./transport.js";
import { LocalTransport } from "./local-transport.js";
import { DiscordTransport } from "./discord-transport.js";
import { MatrixTransport } from "./matrix-transport.js";

/**
 * Pick the agent-to-agent transport from config. Defaults to the in-process
 * local transport. `AGENT_TRANSPORT=discord` (with a bot token + channel id)
 * routes agent chatter through a shared Discord channel; `AGENT_TRANSPORT=matrix`
 * (with a homeserver URL, access token + room id) routes it through a shared
 * Matrix room instead.
 */
export function createTransport(cfg: Config): Transport {
  if (cfg.agentTransport === "discord") {
    if (cfg.discordBotToken && cfg.discordChannelId) {
      return new DiscordTransport(cfg.discordBotToken, cfg.discordChannelId);
    }
    console.warn(
      "[transport] AGENT_TRANSPORT=discord but DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID are missing; falling back to local"
    );
  }
  if (cfg.agentTransport === "matrix") {
    if (cfg.matrixHomeserverUrl && cfg.matrixAccessToken && cfg.matrixRoomId) {
      return new MatrixTransport(
        cfg.matrixHomeserverUrl,
        cfg.matrixAccessToken,
        cfg.matrixRoomId,
        join(cfg.dataDir, "matrix", "bus.json"),
        join(cfg.dataDir, "matrix", "crypto-bus")
      );
    }
    console.warn(
      "[transport] AGENT_TRANSPORT=matrix but MATRIX_HOMESERVER_URL / MATRIX_ACCESS_TOKEN / MATRIX_ROOM_ID are missing; falling back to local"
    );
  }
  return new LocalTransport();
}
