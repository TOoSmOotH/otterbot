import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleChatSettingsResponse {
  enabled: boolean;
  serviceAccountKeySet: boolean;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface GoogleChatTestResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getGoogleChatSettings(): GoogleChatSettingsResponse {
  return {
    enabled: getConfig("googlechat:enabled") === "true",
    serviceAccountKeySet: !!getConfig("googlechat:service_account_key"),
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateGoogleChatSettings(data: {
  enabled?: boolean;
  serviceAccountKey?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("googlechat:enabled", data.enabled ? "true" : "false");
  }
  if (data.serviceAccountKey !== undefined) {
    if (data.serviceAccountKey === "") {
      deleteConfig("googlechat:service_account_key");
    } else {
      setConfig("googlechat:service_account_key", data.serviceAccountKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testGoogleChatConnection(): Promise<GoogleChatTestResult> {
  const serviceAccountKey = getConfig("googlechat:service_account_key");

  if (!serviceAccountKey) {
    return { ok: false, error: "Google Chat service account key must be configured." };
  }

  try {
    const keyData = JSON.parse(serviceAccountKey);
    if (!keyData.client_email || !keyData.private_key) {
      return { ok: false, error: "Service account key is missing client_email or private_key." };
    }

    // Attempt to obtain an access token using the service account credentials
    const { google } = await import("googleapis");
    const auth = new google.auth.GoogleAuth({
      credentials: keyData,
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    });

    await auth.getClient();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
