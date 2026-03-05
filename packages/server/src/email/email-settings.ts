import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import type { EmailSettingsResponse } from "@otterbot/shared";

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getEmailSettings(): EmailSettingsResponse {
  return {
    enabled: getConfig("email:enabled") === "true",
    imapServer: getConfig("email:imap_server") ?? null,
    imapPort: parseInt(getConfig("email:imap_port") ?? "993", 10),
    imapTls: getConfig("email:imap_tls") !== "false",
    smtpServer: getConfig("email:smtp_server") ?? null,
    smtpPort: parseInt(getConfig("email:smtp_port") ?? "587", 10),
    smtpTls: getConfig("email:smtp_tls") !== "false",
    username: getConfig("email:username") ?? null,
    passwordSet: !!getConfig("email:password"),
    fromName: getConfig("email:from_name") ?? null,
  };
}

export function updateEmailSettings(data: {
  enabled?: boolean;
  imapServer?: string;
  imapPort?: number;
  imapTls?: boolean;
  smtpServer?: string;
  smtpPort?: number;
  smtpTls?: boolean;
  username?: string;
  password?: string;
  fromName?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("email:enabled", data.enabled ? "true" : "false");
  }
  if (data.imapServer !== undefined) {
    if (data.imapServer === "") deleteConfig("email:imap_server");
    else setConfig("email:imap_server", data.imapServer);
  }
  if (data.imapPort !== undefined) {
    setConfig("email:imap_port", String(data.imapPort));
  }
  if (data.imapTls !== undefined) {
    setConfig("email:imap_tls", data.imapTls ? "true" : "false");
  }
  if (data.smtpServer !== undefined) {
    if (data.smtpServer === "") deleteConfig("email:smtp_server");
    else setConfig("email:smtp_server", data.smtpServer);
  }
  if (data.smtpPort !== undefined) {
    setConfig("email:smtp_port", String(data.smtpPort));
  }
  if (data.smtpTls !== undefined) {
    setConfig("email:smtp_tls", data.smtpTls ? "true" : "false");
  }
  if (data.username !== undefined) {
    if (data.username === "") deleteConfig("email:username");
    else setConfig("email:username", data.username);
  }
  if (data.password !== undefined) {
    if (data.password === "") deleteConfig("email:password");
    else setConfig("email:password", data.password);
  }
  if (data.fromName !== undefined) {
    if (data.fromName === "") deleteConfig("email:from_name");
    else setConfig("email:from_name", data.fromName);
  }
}

export interface EmailConnectionConfig {
  imapServer: string;
  imapPort: number;
  imapTls: boolean;
  smtpServer: string;
  smtpPort: number;
  smtpTls: boolean;
  username: string;
  password: string;
  fromName?: string;
}

export function getEmailConnectionConfig(): EmailConnectionConfig | null {
  const settings = getEmailSettings();
  if (!settings.enabled || !settings.imapServer || !settings.smtpServer || !settings.username) {
    return null;
  }
  const password = getConfig("email:password");
  if (!password) return null;

  return {
    imapServer: settings.imapServer,
    imapPort: settings.imapPort,
    imapTls: settings.imapTls,
    smtpServer: settings.smtpServer,
    smtpPort: settings.smtpPort,
    smtpTls: settings.smtpTls,
    username: settings.username,
    password,
    fromName: settings.fromName ?? undefined,
  };
}
