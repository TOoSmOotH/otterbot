import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignalSettingsResponse {
  enabled: boolean;
  /** URL for signal-cli JSON-RPC endpoint (e.g. "http://localhost:8080") */
  apiUrl: string | null;
  /** The registered phone number used by signal-cli */
  phoneNumber: string | null;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface SignalTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  phoneNumber?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getSignalSettings(): SignalSettingsResponse {
  return {
    enabled: getConfig("signal:enabled") === "true",
    apiUrl: getConfig("signal:api_url") ?? null,
    phoneNumber: getConfig("signal:phone_number") ?? null,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateSignalSettings(data: {
  enabled?: boolean;
  apiUrl?: string;
  phoneNumber?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("signal:enabled", data.enabled ? "true" : "false");
  }
  if (data.apiUrl !== undefined) {
    if (data.apiUrl === "") {
      deleteConfig("signal:api_url");
    } else {
      setConfig("signal:api_url", data.apiUrl);
    }
  }
  if (data.phoneNumber !== undefined) {
    if (data.phoneNumber === "") {
      deleteConfig("signal:phone_number");
    } else {
      setConfig("signal:phone_number", data.phoneNumber);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testSignalConnection(): Promise<SignalTestResult> {
  const apiUrl = getConfig("signal:api_url");
  const phoneNumber = getConfig("signal:phone_number");

  if (!apiUrl) return { ok: false, error: "Signal API URL not configured." };
  if (!phoneNumber) return { ok: false, error: "Signal phone number not configured." };

  const start = Date.now();

  try {
    // Use the signal-cli JSON-RPC listAccounts method to verify connectivity
    const res = await fetch(`${apiUrl.replace(/\/+$/, "")}/api/v1/accounts`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      phoneNumber,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
