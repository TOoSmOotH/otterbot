import { createRestAPIClient } from "masto";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MastodonSettingsResponse {
  enabled: boolean;
  credentialsSet: boolean;
  displayName: string | null;
  acct: string | null;
  instanceUrl: string;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface MastodonTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  acct?: string;
  id?: string;
  displayName?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getMastodonSettings(): MastodonSettingsResponse {
  return {
    enabled: getConfig("mastodon:enabled") === "true",
    credentialsSet: !!getConfig("mastodon:instance_url") && !!getConfig("mastodon:access_token"),
    displayName: getConfig("mastodon:display_name") ?? null,
    acct: getConfig("mastodon:acct") ?? null,
    instanceUrl: getConfig("mastodon:instance_url") ?? "https://mastodon.social",
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateMastodonSettings(data: {
  enabled?: boolean;
  instanceUrl?: string;
  accessToken?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("mastodon:enabled", data.enabled ? "true" : "false");
  }
  if (data.instanceUrl !== undefined) {
    if (data.instanceUrl === "") {
      deleteConfig("mastodon:instance_url");
      deleteConfig("mastodon:acct");
      deleteConfig("mastodon:display_name");
    } else {
      setConfig("mastodon:instance_url", data.instanceUrl);
    }
  }
  if (data.accessToken !== undefined) {
    if (data.accessToken === "") {
      deleteConfig("mastodon:access_token");
    } else {
      setConfig("mastodon:access_token", data.accessToken);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testMastodonConnection(): Promise<MastodonTestResult> {
  const instanceUrl = getConfig("mastodon:instance_url");
  const accessToken = getConfig("mastodon:access_token");

  if (!instanceUrl || !accessToken) {
    return { ok: false, error: "Mastodon credentials not configured." };
  }

  const start = Date.now();

  try {
    const client = createRestAPIClient({
      url: instanceUrl,
      accessToken,
    });

    const account = await client.v1.accounts.verifyCredentials();

    // Cache the resolved account info
    if (account.acct) {
      setConfig("mastodon:acct", account.acct);
    }
    if (account.displayName) {
      setConfig("mastodon:display_name", account.displayName);
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      acct: account.acct,
      id: account.id,
      displayName: account.displayName,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
