import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamsSettingsResponse {
  enabled: boolean;
  appIdSet: boolean;
  appPasswordSet: boolean;
  tenantId: string | null;
}

export interface TeamsTestResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getTeamsSettings(): TeamsSettingsResponse {
  return {
    enabled: getConfig("teams:enabled") === "true",
    appIdSet: !!getConfig("teams:app_id"),
    appPasswordSet: !!getConfig("teams:app_password"),
    tenantId: getConfig("teams:tenant_id") || null,
  };
}

export function updateTeamsSettings(data: {
  enabled?: boolean;
  appId?: string;
  appPassword?: string;
  tenantId?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("teams:enabled", data.enabled ? "true" : "false");
  }
  if (data.appId !== undefined) {
    if (data.appId === "") {
      deleteConfig("teams:app_id");
    } else {
      setConfig("teams:app_id", data.appId);
    }
  }
  if (data.appPassword !== undefined) {
    if (data.appPassword === "") {
      deleteConfig("teams:app_password");
    } else {
      setConfig("teams:app_password", data.appPassword);
    }
  }
  if (data.tenantId !== undefined) {
    if (data.tenantId === "") {
      deleteConfig("teams:tenant_id");
    } else {
      setConfig("teams:tenant_id", data.tenantId);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testTeamsConnection(): Promise<TeamsTestResult> {
  const appId = getConfig("teams:app_id");
  const appPassword = getConfig("teams:app_password");

  if (!appId || !appPassword) {
    return { ok: false, error: "Teams App ID and App Password must be configured." };
  }

  // Determine the token endpoint — use the configured tenant or the default
  // botframework.com tenant for multi-tenant apps.
  const tenantId = getConfig("teams:tenant_id") || "botframework.com";
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  // Validate credentials by requesting an access token from the Bot Framework token endpoint
  try {
    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appPassword,
      scope: "https://api.botframework.com/.default",
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `Authentication failed: ${body}` };
    }

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
