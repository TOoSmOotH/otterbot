import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { listPairedUsers, listPendingPairings } from "./pairing.js";
import type { PairedUser, PendingPairing } from "./pairing.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface XSettingsResponse {
  enabled: boolean;
  credentialsSet: boolean;
  username: string | null;
  pairedUsers: PairedUser[];
  pendingPairings: PendingPairing[];
}

export interface XTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  username?: string;
  id?: string;
}

// ---------------------------------------------------------------------------
// Settings CRUD
// ---------------------------------------------------------------------------

export function getXSettings(): XSettingsResponse {
  return {
    enabled: getConfig("x:enabled") === "true",
    credentialsSet:
      !!getConfig("x:api_key") &&
      !!getConfig("x:api_secret") &&
      !!getConfig("x:access_token") &&
      !!getConfig("x:access_token_secret"),
    username: getConfig("x:username") ?? null,
    pairedUsers: listPairedUsers(),
    pendingPairings: listPendingPairings(),
  };
}

export function updateXSettings(data: {
  enabled?: boolean;
  apiKey?: string;
  apiSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
}): void {
  if (data.enabled !== undefined) {
    setConfig("x:enabled", data.enabled ? "true" : "false");
  }
  if (data.apiKey !== undefined) {
    if (data.apiKey === "") {
      deleteConfig("x:api_key");
    } else {
      setConfig("x:api_key", data.apiKey);
    }
  }
  if (data.apiSecret !== undefined) {
    if (data.apiSecret === "") {
      deleteConfig("x:api_secret");
    } else {
      setConfig("x:api_secret", data.apiSecret);
    }
  }
  if (data.accessToken !== undefined) {
    if (data.accessToken === "") {
      deleteConfig("x:access_token");
      deleteConfig("x:username");
    } else {
      setConfig("x:access_token", data.accessToken);
    }
  }
  if (data.accessTokenSecret !== undefined) {
    if (data.accessTokenSecret === "") {
      deleteConfig("x:access_token_secret");
    } else {
      setConfig("x:access_token_secret", data.accessTokenSecret);
    }
  }
}

// ---------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------

export async function testXConnection(): Promise<XTestResult> {
  const apiKey = getConfig("x:api_key");
  const apiSecret = getConfig("x:api_secret");
  const accessToken = getConfig("x:access_token");
  const accessTokenSecret = getConfig("x:access_token_secret");

  if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
    return { ok: false, error: "X/Twitter credentials not configured." };
  }

  const start = Date.now();

  try {
    // OAuth 1.0a signature for Twitter API v2
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const url = "https://api.x.com/2/users/me";
    const method = "GET";

    // Build OAuth parameters
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: apiKey,
      oauth_nonce: nonce,
      oauth_signature_method: "HMAC-SHA1",
      oauth_timestamp: timestamp,
      oauth_token: accessToken,
      oauth_version: "1.0",
    };

    // Create signature base string
    const paramString = Object.keys(oauthParams)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(oauthParams[k])}`)
      .join("&");

    const signatureBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${encodeURIComponent(apiSecret)}&${encodeURIComponent(accessTokenSecret)}`;

    // HMAC-SHA1 signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(signingKey),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signatureBase));
    const signature = Buffer.from(sig).toString("base64");

    oauthParams.oauth_signature = signature;

    // Build Authorization header
    const authHeader =
      "OAuth " +
      Object.keys(oauthParams)
        .sort()
        .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
        .join(", ");

    const res = await fetch(url, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        error: `API returned ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const json = (await res.json()) as { data?: { username?: string; id?: string } };
    const username = json.data?.username;

    if (username) {
      setConfig("x:username", username);
    }

    return {
      ok: true,
      latencyMs: Date.now() - start,
      username: username ?? undefined,
      id: json.data?.id,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
