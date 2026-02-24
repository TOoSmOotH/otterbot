import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MattermostAvailableChannel {
  id: string;
  name: string;
  displayName: string;
  teamName: string;
}

export interface MattermostSettingsResponse {
  enabled: boolean;
  tokenSet: boolean;
  serverUrlSet: boolean;
  serverUrl: string | null;
  defaultTeam: string | null;
  requireMention: boolean;
  botUsername: string | null;
  allowedChannels: string[];
  availableChannels: MattermostAvailableChannel[];
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface MattermostTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  botUsername?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getMattermostSettings(availableChannels: MattermostAvailableChannel[] = []): MattermostSettingsResponse {
  const raw = getConfig("mattermost:allowed_channels");
  let allowedChannels: string[] = [];
  if (raw) {
    try { allowedChannels = JSON.parse(raw); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("mattermost:enabled") === "true",
    tokenSet: !!getConfig("mattermost:bot_token"),
    serverUrlSet: !!getConfig("mattermost:server_url"),
    serverUrl: getConfig("mattermost:server_url") ?? null,
    defaultTeam: getConfig("mattermost:default_team") ?? null,
    requireMention: getConfig("mattermost:require_mention") !== "false", // default true
    botUsername: getConfig("mattermost:bot_username") ?? null,
    allowedChannels,
    availableChannels,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateMattermostSettings(data: {
  enabled?: boolean;
  botToken?: string;
  serverUrl?: string;
  defaultTeam?: string;
  requireMention?: boolean;
  allowedChannels?: string[];
}): void {
  if (data.enabled !== undefined) {
    setConfig("mattermost:enabled", data.enabled ? "true" : "false");
  }
  if (data.botToken !== undefined) {
    if (data.botToken === "") {
      deleteConfig("mattermost:bot_token");
      deleteConfig("mattermost:bot_username");
    } else {
      setConfig("mattermost:bot_token", data.botToken);
    }
  }
  if (data.serverUrl !== undefined) {
    if (data.serverUrl === "") {
      deleteConfig("mattermost:server_url");
    } else {
      // Normalize: strip trailing slash
      setConfig("mattermost:server_url", data.serverUrl.replace(/\/+$/, ""));
    }
  }
  if (data.defaultTeam !== undefined) {
    if (data.defaultTeam === "") {
      deleteConfig("mattermost:default_team");
    } else {
      setConfig("mattermost:default_team", data.defaultTeam);
    }
  }
  if (data.requireMention !== undefined) {
    setConfig("mattermost:require_mention", data.requireMention ? "true" : "false");
  }
  if (data.allowedChannels !== undefined) {
    setConfig("mattermost:allowed_channels", JSON.stringify(data.allowedChannels));
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testMattermostConnection(): Promise<MattermostTestResult> {
  const token = getConfig("mattermost:bot_token");
  const serverUrl = getConfig("mattermost:server_url");
  if (!token) return { ok: false, error: "Mattermost bot token not configured." };
  if (!serverUrl) return { ok: false, error: "Mattermost server URL not configured." };

  const start = Date.now();

  try {
    const res = await fetch(`${serverUrl}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const user = (await res.json()) as { username?: string; id?: string };
    const username = user.username ?? undefined;
    if (username) {
      setConfig("mattermost:bot_username", username);
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
