import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NostrSettingsResponse {
  enabled: boolean;
  privateKeySet: boolean;
  relays: string[];
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface NostrConfig {
  privateKey: string;
  relays: string[];
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getNostrSettings(): NostrSettingsResponse {
  const rawRelays = getConfig("nostr:relays");
  let relays: string[] = [];
  if (rawRelays) {
    try { relays = JSON.parse(rawRelays); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("nostr:enabled") === "true",
    privateKeySet: !!getConfig("nostr:private_key"),
    relays,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateNostrSettings(data: {
  enabled?: boolean;
  privateKey?: string;
  relays?: string[];
}): void {
  if (data.enabled !== undefined) {
    setConfig("nostr:enabled", data.enabled ? "true" : "false");
  }
  if (data.privateKey !== undefined) {
    if (data.privateKey === "") {
      deleteConfig("nostr:private_key");
    } else {
      setConfig("nostr:private_key", data.privateKey);
    }
  }
  if (data.relays !== undefined) {
    setConfig("nostr:relays", JSON.stringify(data.relays));
  }
}

export function getNostrConfig(): NostrConfig | null {
  const settings = getNostrSettings();
  if (!settings.enabled || !settings.privateKeySet) return null;

  const privateKey = getConfig("nostr:private_key");
  if (!privateKey) return null;

  return {
    privateKey,
    relays: settings.relays.length > 0
      ? settings.relays
      : ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
  };
}
