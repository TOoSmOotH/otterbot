import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackAvailableChannel {
  id: string;
  name: string;
}

export interface SlackSettingsResponse {
  enabled: boolean;
  botTokenSet: boolean;
  signingSecretSet: boolean;
  appTokenSet: boolean;
  requireMention: boolean;
  botUsername: string | null;
  allowedChannels: string[];
  availableChannels: SlackAvailableChannel[];
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface SlackTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  botUsername?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getSlackSettings(availableChannels: SlackAvailableChannel[] = []): SlackSettingsResponse {
  const raw = getConfig("slack:allowed_channels");
  let allowedChannels: string[] = [];
  if (raw) {
    try { allowedChannels = JSON.parse(raw); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("slack:enabled") === "true",
    botTokenSet: !!getConfig("slack:bot_token"),
    signingSecretSet: !!getConfig("slack:signing_secret"),
    appTokenSet: !!getConfig("slack:app_token"),
    requireMention: getConfig("slack:require_mention") !== "false", // default true
    botUsername: getConfig("slack:bot_username") ?? null,
    allowedChannels,
    availableChannels,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateSlackSettings(data: {
  enabled?: boolean;
  botToken?: string;
  signingSecret?: string;
  appToken?: string;
  requireMention?: boolean;
  allowedChannels?: string[];
}): void {
  if (data.enabled !== undefined) {
    setConfig("slack:enabled", data.enabled ? "true" : "false");
  }
  if (data.botToken !== undefined) {
    if (data.botToken === "") {
      deleteConfig("slack:bot_token");
      deleteConfig("slack:bot_username");
    } else {
      setConfig("slack:bot_token", data.botToken);
    }
  }
  if (data.signingSecret !== undefined) {
    if (data.signingSecret === "") {
      deleteConfig("slack:signing_secret");
    } else {
      setConfig("slack:signing_secret", data.signingSecret);
    }
  }
  if (data.appToken !== undefined) {
    if (data.appToken === "") {
      deleteConfig("slack:app_token");
    } else {
      setConfig("slack:app_token", data.appToken);
    }
  }
  if (data.requireMention !== undefined) {
    setConfig("slack:require_mention", data.requireMention ? "true" : "false");
  }
  if (data.allowedChannels !== undefined) {
    setConfig("slack:allowed_channels", JSON.stringify(data.allowedChannels));
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testSlackConnection(): Promise<SlackTestResult> {
  const token = getConfig("slack:bot_token");
  if (!token) return { ok: false, error: "Slack bot token not configured." };

  const start = Date.now();

  try {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json() as { ok: boolean; user?: string; error?: string };

    if (!data.ok) {
      return { ok: false, error: data.error ?? "Authentication failed" };
    }

    const username = data.user ?? undefined;
    if (username) {
      setConfig("slack:bot_username", username);
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
