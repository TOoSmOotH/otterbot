import { Client, GatewayIntentBits } from "discord.js";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordAvailableChannel {
  id: string;
  name: string;
  guildName: string;
}

export interface DiscordSettingsResponse {
  enabled: boolean;
  tokenSet: boolean;
  requireMention: boolean;
  botUsername: string | null;
  allowedChannels: string[];
  availableChannels: DiscordAvailableChannel[];
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface DiscordTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  botUsername?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getDiscordSettings(availableChannels: DiscordAvailableChannel[] = []): DiscordSettingsResponse {
  const raw = getConfig("discord:allowed_channels");
  let allowedChannels: string[] = [];
  if (raw) {
    try { allowedChannels = JSON.parse(raw); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("discord:enabled") === "true",
    tokenSet: !!getConfig("discord:bot_token"),
    requireMention: getConfig("discord:require_mention") !== "false", // default true
    botUsername: getConfig("discord:bot_username") ?? null,
    allowedChannels,
    availableChannels,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateDiscordSettings(data: {
  enabled?: boolean;
  botToken?: string;
  requireMention?: boolean;
  allowedChannels?: string[];
}): void {
  if (data.enabled !== undefined) {
    setConfig("discord:enabled", data.enabled ? "true" : "false");
  }
  if (data.botToken !== undefined) {
    if (data.botToken === "") {
      deleteConfig("discord:bot_token");
      deleteConfig("discord:bot_username");
    } else {
      setConfig("discord:bot_token", data.botToken);
    }
  }
  if (data.requireMention !== undefined) {
    setConfig("discord:require_mention", data.requireMention ? "true" : "false");
  }
  if (data.allowedChannels !== undefined) {
    setConfig("discord:allowed_channels", JSON.stringify(data.allowedChannels));
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testDiscordConnection(): Promise<DiscordTestResult> {
  const token = getConfig("discord:bot_token");
  if (!token) return { ok: false, error: "Discord bot token not configured." };

  const start = Date.now();
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(token);
    const username = client.user?.tag ?? client.user?.username ?? undefined;
    if (username) {
      setConfig("discord:bot_username", username);
    }
    client.destroy();
    return {
      ok: true,
      latencyMs: Date.now() - start,
      botUsername: username,
    };
  } catch (error) {
    client.destroy();
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
