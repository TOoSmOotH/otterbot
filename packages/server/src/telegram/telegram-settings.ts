import TelegramBot from "node-telegram-bot-api";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramSettingsResponse {
  enabled: boolean;
  tokenSet: boolean;
  botUsername: string | null;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface TelegramTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  botUsername?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getTelegramSettings(): TelegramSettingsResponse {
  return {
    enabled: getConfig("telegram:enabled") === "true",
    tokenSet: !!getConfig("telegram:bot_token"),
    botUsername: getConfig("telegram:bot_username") ?? null,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateTelegramSettings(data: {
  enabled?: boolean;
  botToken?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("telegram:enabled", data.enabled ? "true" : "false");
  }
  if (data.botToken !== undefined) {
    if (data.botToken === "") {
      deleteConfig("telegram:bot_token");
      deleteConfig("telegram:bot_username");
    } else {
      setConfig("telegram:bot_token", data.botToken);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testTelegramConnection(): Promise<TelegramTestResult> {
  const token = getConfig("telegram:bot_token");
  if (!token) return { ok: false, error: "Telegram bot token not configured." };

  const start = Date.now();
  const bot = new TelegramBot(token);

  try {
    const me = await bot.getMe();
    const username = me.username ?? undefined;
    if (username) {
      setConfig("telegram:bot_username", username);
    }
    return {
      ok: true,
      latencyMs: Date.now() - start,
      botUsername: username,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
