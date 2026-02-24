import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import type { IrcConfig } from "./irc-bridge.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IrcSettingsResponse {
  enabled: boolean;
  server: string | null;
  port: number;
  nickname: string | null;
  channels: string[];
  tls: boolean;
  passwordSet: boolean;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getIrcSettings(): IrcSettingsResponse {
  const rawChannels = getConfig("irc:channels");
  let channels: string[] = [];
  if (rawChannels) {
    try { channels = JSON.parse(rawChannels); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("irc:enabled") === "true",
    server: getConfig("irc:server") ?? null,
    port: parseInt(getConfig("irc:port") ?? "6667", 10),
    nickname: getConfig("irc:nickname") ?? null,
    channels,
    tls: getConfig("irc:tls") === "true",
    passwordSet: !!getConfig("irc:password"),
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateIrcSettings(data: {
  enabled?: boolean;
  server?: string;
  port?: number;
  nickname?: string;
  channels?: string[];
  tls?: boolean;
  password?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("irc:enabled", data.enabled ? "true" : "false");
  }
  if (data.server !== undefined) {
    if (data.server === "") {
      deleteConfig("irc:server");
    } else {
      setConfig("irc:server", data.server);
    }
  }
  if (data.port !== undefined) {
    setConfig("irc:port", String(data.port));
  }
  if (data.nickname !== undefined) {
    if (data.nickname === "") {
      deleteConfig("irc:nickname");
    } else {
      setConfig("irc:nickname", data.nickname);
    }
  }
  if (data.channels !== undefined) {
    setConfig("irc:channels", JSON.stringify(data.channels));
  }
  if (data.tls !== undefined) {
    setConfig("irc:tls", data.tls ? "true" : "false");
  }
  if (data.password !== undefined) {
    if (data.password === "") {
      deleteConfig("irc:password");
    } else {
      setConfig("irc:password", data.password);
    }
  }
}

export function getIrcConfig(): IrcConfig | null {
  const settings = getIrcSettings();
  if (!settings.enabled || !settings.server || !settings.nickname) return null;

  return {
    server: settings.server,
    port: settings.port,
    nickname: settings.nickname,
    channels: settings.channels,
    tls: settings.tls,
    password: getConfig("irc:password") ?? undefined,
  };
}
