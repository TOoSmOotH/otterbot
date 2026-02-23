import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import type { TlonConfig } from "./tlon-bridge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TlonSettingsResponse {
  enabled: boolean;
  shipUrl: string | null;
  accessCodeSet: boolean;
  shipName: string | null;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getTlonSettings(): TlonSettingsResponse {
  return {
    enabled: getConfig("tlon:enabled") === "true",
    shipUrl: getConfig("tlon:ship_url") ?? null,
    accessCodeSet: !!getConfig("tlon:access_code"),
    shipName: getConfig("tlon:ship_name") ?? null,
  };
}

export function updateTlonSettings(data: {
  enabled?: boolean;
  shipUrl?: string;
  accessCode?: string;
  shipName?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("tlon:enabled", data.enabled ? "true" : "false");
  }
  if (data.shipUrl !== undefined) {
    if (data.shipUrl === "") {
      deleteConfig("tlon:ship_url");
    } else {
      setConfig("tlon:ship_url", data.shipUrl);
    }
  }
  if (data.accessCode !== undefined) {
    if (data.accessCode === "") {
      deleteConfig("tlon:access_code");
    } else {
      setConfig("tlon:access_code", data.accessCode);
    }
  }
  if (data.shipName !== undefined) {
    if (data.shipName === "") {
      deleteConfig("tlon:ship_name");
    } else {
      setConfig("tlon:ship_name", data.shipName);
    }
  }
}

export function getTlonConfig(): TlonConfig | null {
  const settings = getTlonSettings();
  if (!settings.enabled || !settings.shipUrl || !settings.shipName) return null;

  const accessCode = getConfig("tlon:access_code");
  if (!accessCode) return null;

  return {
    shipUrl: settings.shipUrl,
    accessCode,
    shipName: settings.shipName,
  };
}

export async function testTlonConnection(shipUrl: string, accessCode: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${shipUrl}/~/login`;
    const res = await fetch(url, {
      method: "PUT",
      body: `password=${encodeURIComponent(accessCode)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      redirect: "manual",
    });

    if (res.status === 204 || res.status === 200 || res.status === 302) {
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        return { ok: true };
      }
      return { ok: false, error: "Authentication succeeded but no session cookie returned" };
    }

    return { ok: false, error: `Authentication failed: HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Connection failed" };
  }
}
