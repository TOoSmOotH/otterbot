import { AtpAgent } from "@atproto/api";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlueskySettingsResponse {
  enabled: boolean;
  credentialsSet: boolean;
  handle: string | null;
  service: string;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface BlueskyTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  handle?: string;
  did?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getBlueskySettings(): BlueskySettingsResponse {
  return {
    enabled: getConfig("bluesky:enabled") === "true",
    credentialsSet: !!getConfig("bluesky:identifier") && !!getConfig("bluesky:app_password"),
    handle: getConfig("bluesky:handle") ?? null,
    service: getConfig("bluesky:service") ?? "https://bsky.social",
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateBlueskySettings(data: {
  enabled?: boolean;
  identifier?: string;
  appPassword?: string;
  service?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("bluesky:enabled", data.enabled ? "true" : "false");
  }
  if (data.identifier !== undefined) {
    if (data.identifier === "") {
      deleteConfig("bluesky:identifier");
      deleteConfig("bluesky:handle");
    } else {
      setConfig("bluesky:identifier", data.identifier);
    }
  }
  if (data.appPassword !== undefined) {
    if (data.appPassword === "") {
      deleteConfig("bluesky:app_password");
    } else {
      setConfig("bluesky:app_password", data.appPassword);
    }
  }
  if (data.service !== undefined) {
    if (data.service === "") {
      deleteConfig("bluesky:service");
    } else {
      setConfig("bluesky:service", data.service);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testBlueskyConnection(): Promise<BlueskyTestResult> {
  const identifier = getConfig("bluesky:identifier");
  const appPassword = getConfig("bluesky:app_password");
  const service = getConfig("bluesky:service") ?? "https://bsky.social";

  if (!identifier || !appPassword) {
    return { ok: false, error: "Bluesky credentials not configured." };
  }

  const start = Date.now();
  const agent = new AtpAgent({ service });

  try {
    const response = await agent.login({ identifier, password: appPassword });
    const handle = response.data.handle;
    const did = response.data.did;

    // Cache the resolved handle
    if (handle) {
      setConfig("bluesky:handle", handle);
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      handle,
      did,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
