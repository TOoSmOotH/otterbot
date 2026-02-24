import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppSettingsResponse {
  enabled: boolean;
  phoneNumber: string | null;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getWhatsAppSettings(): WhatsAppSettingsResponse {
  return {
    enabled: getConfig("whatsapp:enabled") === "true",
    phoneNumber: getConfig("whatsapp:phone_number") ?? null,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateWhatsAppSettings(data: {
  enabled?: boolean;
}): void {
  if (data.enabled !== undefined) {
    setConfig("whatsapp:enabled", data.enabled ? "true" : "false");
  }
}

/**
 * Return the path where Baileys auth state should be stored.
 * Defaults to a `whatsapp-auth` subdirectory under the configured data dir.
 */
export function getAuthStatePath(): string {
  return getConfig("whatsapp:auth_state_path") ?? "whatsapp-auth";
}
