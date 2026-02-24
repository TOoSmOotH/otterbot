import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import type { WhatsAppConfig } from "./whatsapp-bridge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppSettingsResponse {
  enabled: boolean;
  allowedNumbers: string[];
  dataPath: string | null;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getWhatsAppSettings(): WhatsAppSettingsResponse {
  const rawNumbers = getConfig("whatsapp:allowed_numbers");
  let allowedNumbers: string[] = [];
  if (rawNumbers) {
    try { allowedNumbers = JSON.parse(rawNumbers); } catch { /* ignore */ }
  }

  return {
    enabled: getConfig("whatsapp:enabled") === "true",
    allowedNumbers,
    dataPath: getConfig("whatsapp:data_path") ?? null,
  };
}

export function updateWhatsAppSettings(data: {
  enabled?: boolean;
  allowedNumbers?: string[];
  dataPath?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("whatsapp:enabled", data.enabled ? "true" : "false");
  }
  if (data.allowedNumbers !== undefined) {
    setConfig("whatsapp:allowed_numbers", JSON.stringify(data.allowedNumbers));
  }
  if (data.dataPath !== undefined) {
    if (data.dataPath === "") {
      deleteConfig("whatsapp:data_path");
    } else {
      setConfig("whatsapp:data_path", data.dataPath);
    }
  }
}

export function getWhatsAppConfig(): WhatsAppConfig | null {
  const settings = getWhatsAppSettings();
  if (!settings.enabled) return null;

  return {
    dataPath: settings.dataPath ?? ".wwebjs_auth",
    allowedNumbers: settings.allowedNumbers,
  };
}
