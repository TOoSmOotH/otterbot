import { google } from "googleapis";
import { nanoid } from "nanoid";
import { getDb, schema } from "../db/index.js";
import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import { eq, and, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Token refresh mutex — prevents concurrent refresh races
// ---------------------------------------------------------------------------

let refreshPromise: Promise<string> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOAuth2Client() {
  const clientId = getConfig("google:client_id");
  const clientSecret = getConfig("google:client_secret");
  const redirectBase = getConfig("google:redirect_base_url") ?? "";
  const redirectUri = `${redirectBase}/api/oauth/google/callback`;

  if (!clientId || !clientSecret) return null;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getGoogleSettings() {
  const clientId = getConfig("google:client_id");
  const clientSecret = getConfig("google:client_secret");
  const connectedEmail = getConfig("google:connected_email");
  const redirectBaseUrl = getConfig("google:redirect_base_url") ?? "";

  const db = getDb();
  const token = db
    .select()
    .from(schema.oauthTokens)
    .where(
      and(
        eq(schema.oauthTokens.provider, "google"),
        eq(schema.oauthTokens.accountId, "default"),
      ),
    )
    .get();

  return {
    clientIdSet: !!clientId,
    clientSecretSet: !!clientSecret,
    redirectBaseUrl,
    connected: !!token,
    connectedEmail: connectedEmail ?? null,
  };
}

export function updateGoogleCredentials(data: {
  clientId?: string;
  clientSecret?: string;
  redirectBaseUrl?: string;
}) {
  if (data.clientId !== undefined) {
    if (data.clientId) setConfig("google:client_id", data.clientId);
    else deleteConfig("google:client_id");
  }
  if (data.clientSecret !== undefined) {
    if (data.clientSecret) setConfig("google:client_secret", data.clientSecret);
    else deleteConfig("google:client_secret");
  }
  if (data.redirectBaseUrl !== undefined) {
    if (data.redirectBaseUrl) setConfig("google:redirect_base_url", data.redirectBaseUrl);
    else deleteConfig("google:redirect_base_url");
  }
}

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function beginOAuthFlow(): { url: string } | { error: string } {
  const client = getOAuth2Client();
  if (!client) {
    return { error: "Google client ID and secret must be configured first" };
  }

  const state = nanoid(32);
  setConfig("google:oauth:pending_state", state);

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });

  return { url };
}

export async function completeOAuthFlow(
  code: string,
  state: string,
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const pendingState = getConfig("google:oauth:pending_state");
  if (!pendingState || pendingState !== state) {
    return { ok: false, error: "Invalid OAuth state" };
  }
  deleteConfig("google:oauth:pending_state");

  const client = getOAuth2Client();
  if (!client) {
    return { ok: false, error: "Google credentials not configured" };
  }

  try {
    const { tokens } = await client.getToken(code);

    const db = getDb();
    const now = new Date().toISOString();

    // Upsert the token
    db.run(
      sql`INSERT INTO oauth_tokens (provider, account_id, access_token, refresh_token, expires_at, scopes, updated_at)
          VALUES ('google', 'default', ${tokens.access_token!}, ${tokens.refresh_token ?? null}, ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null}, ${GOOGLE_SCOPES.join(" ")}, ${now})
          ON CONFLICT (provider, account_id)
          DO UPDATE SET access_token = ${tokens.access_token!}, refresh_token = COALESCE(${tokens.refresh_token ?? null}, oauth_tokens.refresh_token), expires_at = ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null}, scopes = ${GOOGLE_SCOPES.join(" ")}, updated_at = ${now}`,
    );

    // Fetch the user's email
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email ?? "unknown";
    setConfig("google:connected_email", email);

    return { ok: true, email };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "OAuth token exchange failed",
    };
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const db = getDb();
  const row = db
    .select()
    .from(schema.oauthTokens)
    .where(
      and(
        eq(schema.oauthTokens.provider, "google"),
        eq(schema.oauthTokens.accountId, "default"),
      ),
    )
    .get();

  if (!row) return null;

  // Check if token needs refresh (within 5 min of expiry)
  if (row.expiresAt) {
    const expiresAt = new Date(row.expiresAt).getTime();
    const now = Date.now();
    if (expiresAt - now < 5 * 60 * 1000) {
      // Token is expiring — refresh it
      if (refreshPromise) return refreshPromise;

      refreshPromise = refreshAccessToken(row.refreshToken).finally(() => {
        refreshPromise = null;
      });
      return refreshPromise;
    }
  }

  return row.accessToken;
}

async function refreshAccessToken(
  refreshToken: string | null,
): Promise<string> {
  if (!refreshToken) {
    throw new Error("No refresh token available — re-authorize Google");
  }

  const client = getOAuth2Client();
  if (!client) {
    throw new Error("Google credentials not configured");
  }

  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();

  const db = getDb();
  const now = new Date().toISOString();
  db.update(schema.oauthTokens)
    .set({
      accessToken: credentials.access_token!,
      expiresAt: credentials.expiry_date
        ? new Date(credentials.expiry_date).toISOString()
        : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.oauthTokens.provider, "google"),
        eq(schema.oauthTokens.accountId, "default"),
      ),
    )
    .run();

  return credentials.access_token!;
}

export function disconnectGoogle() {
  const db = getDb();
  db.delete(schema.oauthTokens)
    .where(
      and(
        eq(schema.oauthTokens.provider, "google"),
        eq(schema.oauthTokens.accountId, "default"),
      ),
    )
    .run();

  deleteConfig("google:connected_email");
  deleteConfig("google:oauth:pending_state");
}

/** Get an authenticated OAuth2 client for Google API calls */
export async function getAuthenticatedClient(): Promise<import("googleapis").Common.OAuth2Client | null> {
  const accessToken = await getValidAccessToken();
  if (!accessToken) return null;

  const client = getOAuth2Client();
  if (!client) return null;

  client.setCredentials({ access_token: accessToken });
  return client;
}
