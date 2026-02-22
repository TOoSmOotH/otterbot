import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatrixSettingsResponse {
  enabled: boolean;
  homeserverUrl: string | null;
  accessTokenSet: boolean;
  userId: string | null;
  allowedRooms: string[];
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
  e2eeEnabled: boolean;
}

export interface MatrixTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  userId?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getMatrixSettings(): MatrixSettingsResponse {
  const raw = getConfig("matrix:allowed_rooms");
  let allowedRooms: string[] = [];
  if (raw) {
    try { allowedRooms = JSON.parse(raw); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("matrix:enabled") === "true",
    homeserverUrl: getConfig("matrix:homeserver_url") ?? null,
    accessTokenSet: !!getConfig("matrix:access_token"),
    userId: getConfig("matrix:user_id") ?? null,
    allowedRooms,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
    e2eeEnabled: getConfig("matrix:e2ee_enabled") === "true",
  };
}

export function updateMatrixSettings(data: {
  enabled?: boolean;
  homeserverUrl?: string;
  accessToken?: string;
  allowedRooms?: string[];
  e2eeEnabled?: boolean;
}): void {
  if (data.enabled !== undefined) {
    setConfig("matrix:enabled", data.enabled ? "true" : "false");
  }
  if (data.homeserverUrl !== undefined) {
    if (data.homeserverUrl === "") {
      deleteConfig("matrix:homeserver_url");
    } else {
      setConfig("matrix:homeserver_url", data.homeserverUrl);
    }
  }
  if (data.accessToken !== undefined) {
    if (data.accessToken === "") {
      deleteConfig("matrix:access_token");
      deleteConfig("matrix:user_id");
    } else {
      setConfig("matrix:access_token", data.accessToken);
    }
  }
  if (data.allowedRooms !== undefined) {
    setConfig("matrix:allowed_rooms", JSON.stringify(data.allowedRooms));
  }
  if (data.e2eeEnabled !== undefined) {
    setConfig("matrix:e2ee_enabled", data.e2eeEnabled ? "true" : "false");
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testMatrixConnection(): Promise<MatrixTestResult> {
  const homeserverUrl = getConfig("matrix:homeserver_url");
  const accessToken = getConfig("matrix:access_token");

  if (!homeserverUrl) return { ok: false, error: "Matrix homeserver URL not configured." };
  if (!accessToken) return { ok: false, error: "Matrix access token not configured." };

  const start = Date.now();

  try {
    // Use the /_matrix/client/v3/account/whoami endpoint to verify credentials
    const url = `${homeserverUrl.replace(/\/+$/, "")}/_matrix/client/v3/account/whoami`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { user_id?: string };
    if (data.user_id) {
      setConfig("matrix:user_id", data.user_id);
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      userId: data.user_id,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
