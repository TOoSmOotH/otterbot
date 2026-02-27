import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NextcloudTalkSettingsResponse {
  enabled: boolean;
  serverUrl: string | null;
  serverUrlSet: boolean;
  usernameSet: boolean;
  appPasswordSet: boolean;
  botUsername: string | null;
  requireMention: boolean;
  allowedConversations: string[];
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface NextcloudTalkTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  botUsername?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getNextcloudTalkSettings(): NextcloudTalkSettingsResponse {
  const raw = getConfig("nextcloud-talk:allowed_conversations");
  let allowedConversations: string[] = [];
  if (raw) {
    try { allowedConversations = JSON.parse(raw); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("nextcloud-talk:enabled") === "true",
    serverUrl: getConfig("nextcloud-talk:server_url") ?? null,
    serverUrlSet: !!getConfig("nextcloud-talk:server_url"),
    usernameSet: !!getConfig("nextcloud-talk:username"),
    appPasswordSet: !!getConfig("nextcloud-talk:app_password"),
    botUsername: getConfig("nextcloud-talk:username") ?? null,
    requireMention: getConfig("nextcloud-talk:require_mention") !== "false", // default true
    allowedConversations,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateNextcloudTalkSettings(data: {
  enabled?: boolean;
  serverUrl?: string;
  username?: string;
  appPassword?: string;
  requireMention?: boolean;
  allowedConversations?: string[];
}): void {
  if (data.enabled !== undefined) {
    setConfig("nextcloud-talk:enabled", data.enabled ? "true" : "false");
  }
  if (data.serverUrl !== undefined) {
    if (data.serverUrl === "") {
      deleteConfig("nextcloud-talk:server_url");
    } else {
      // Normalize: strip trailing slash
      setConfig("nextcloud-talk:server_url", data.serverUrl.replace(/\/+$/, ""));
    }
  }
  if (data.username !== undefined) {
    if (data.username === "") {
      deleteConfig("nextcloud-talk:username");
    } else {
      setConfig("nextcloud-talk:username", data.username);
    }
  }
  if (data.appPassword !== undefined) {
    if (data.appPassword === "") {
      deleteConfig("nextcloud-talk:app_password");
    } else {
      setConfig("nextcloud-talk:app_password", data.appPassword);
    }
  }
  if (data.requireMention !== undefined) {
    setConfig("nextcloud-talk:require_mention", data.requireMention ? "true" : "false");
  }
  if (data.allowedConversations !== undefined) {
    setConfig("nextcloud-talk:allowed_conversations", JSON.stringify(data.allowedConversations));
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testNextcloudTalkConnection(): Promise<NextcloudTalkTestResult> {
  const serverUrl = getConfig("nextcloud-talk:server_url");
  const username = getConfig("nextcloud-talk:username");
  const appPassword = getConfig("nextcloud-talk:app_password");
  if (!serverUrl) return { ok: false, error: "Nextcloud server URL not configured." };
  if (!username) return { ok: false, error: "Nextcloud username not configured." };
  if (!appPassword) return { ok: false, error: "Nextcloud app password not configured." };

  const start = Date.now();
  const authHeader = "Basic " + Buffer.from(`${username}:${appPassword}`).toString("base64");

  try {
    const res = await fetch(`${serverUrl}/ocs/v2.php/cloud/user`, {
      headers: {
        Authorization: authHeader,
        "OCS-APIRequest": "true",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    }

    const data = (await res.json()) as {
      ocs?: { data?: { id?: string; displayname?: string } };
    };
    const displayName = data.ocs?.data?.displayname ?? data.ocs?.data?.id ?? username;

    return {
      ok: true,
      latencyMs: Date.now() - start,
      botUsername: displayName,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
