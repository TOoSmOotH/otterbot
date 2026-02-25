import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebchatSettingsResponse {
  enabled: boolean;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getWebchatSettings(): WebchatSettingsResponse {
  return {
    enabled: getConfig("webchat:enabled") === "true",
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateWebchatSettings(data: {
  enabled?: boolean;
}): void {
  if (data.enabled !== undefined) {
    setConfig("webchat:enabled", data.enabled ? "true" : "false");
  }
}

export function isWebchatEnabled(): boolean {
  return getConfig("webchat:enabled") === "true";
}
