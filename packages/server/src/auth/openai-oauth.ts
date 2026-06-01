import { createHash, randomBytes } from "node:crypto";

/**
 * OpenAI "Sign in with ChatGPT" OAuth — the same authorization-code + PKCE flow
 * the Codex CLI uses, so a ChatGPT Plus/Pro subscription can back model calls
 * without a metered API key.
 *
 * NOTE: this targets OpenAI's subscription OAuth, which is officially intended
 * for the Codex CLI. Driving it from a third-party app works but is unofficial,
 * may break without warning, and is arguably against OpenAI's terms. The token
 * it yields only works against the ChatGPT Codex backend (Responses API), not
 * the standard `api.openai.com` key endpoint.
 */

export const OPENAI_OAUTH = {
  /** Public client id of the Codex CLI OAuth app. */
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  /** Loopback redirect — must match the Codex client's registered URI. */
  redirectPort: 1455,
  redirectPath: "/auth/callback",
  scope: "openid profile email offline_access",
} as const;

/** The ChatGPT Codex backend that subscription tokens authenticate against. */
export const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";

/** Codex model slugs — used as a fallback when live discovery is unavailable. */
const CODEX_MODELS = [
  "gpt-5.4-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
] as const;

/**
 * List the Codex models a ChatGPT subscription can serve, via the same
 * `/codex/models` endpoint the Codex CLI uses. Falls back to `CODEX_MODELS`
 * if discovery fails or returns nothing.
 */
export async function listCodexModels(accessToken: string): Promise<string[]> {
  try {
    const res = await fetch(`${CHATGPT_CODEX_BASE_URL}/models?client_version=1.0.0`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [...CODEX_MODELS];
    const body = (await res.json()) as {
      models?: Array<{ slug?: string; visibility?: string; priority?: number }>;
    };
    const models = (body.models ?? [])
      .filter((m) => typeof m.slug === "string" && m.visibility !== "hidden")
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((m) => m.slug as string);
    return models.length > 0 ? models : [...CODEX_MODELS];
  } catch {
    return [...CODEX_MODELS];
  }
}

function redirectUri(): string {
  return `http://localhost:${OPENAI_OAUTH.redirectPort}${OPENAI_OAUTH.redirectPath}`;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** Generate a PKCE verifier/challenge pair (S256). */
export function generatePkce(): Pkce {
  const verifier = base64Url(randomBytes(64));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState(): string {
  return base64Url(randomBytes(32));
}

/** Build the authorize URL the user opens in their browser. */
export function buildAuthorizeUrl(pkce: Pkce, state: string): string {
  const u = new URL(OPENAI_OAUTH.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", OPENAI_OAUTH.clientId);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", OPENAI_OAUTH.scope);
  u.searchParams.set("code_challenge", pkce.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  u.searchParams.set("id_token_add_organizations", "true");
  u.searchParams.set("codex_cli_simplified_flow", "true");
  return u.toString();
}

/** The token bundle persisted after a successful login. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  /** ChatGPT account id, needed as a request header against the Codex backend. */
  accountId: string | null;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(code: string, pkce: Pkce): Promise<OAuthTokens> {
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_OAUTH.clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: pkce.verifier,
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await safeText(res)}`);
  }
  return toTokens((await res.json()) as TokenResponse);
}

/** Refresh an expired access token. May rotate the refresh token. */
export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const res = await fetch(OPENAI_OAUTH.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: OPENAI_OAUTH.clientId,
      refresh_token: refreshToken,
      scope: OPENAI_OAUTH.scope,
    }),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: ${res.status} ${await safeText(res)}`);
  }
  const json = (await res.json()) as Partial<TokenResponse>;
  // A refresh response may omit the refresh token — then the old one stays valid.
  return toTokens({
    access_token: json.access_token ?? "",
    refresh_token: json.refresh_token ?? refreshToken,
    id_token: json.id_token ?? "",
    expires_in: json.expires_in ?? 3600,
  });
}

function toTokens(r: TokenResponse): OAuthTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    idToken: r.id_token,
    accountId: r.id_token ? accountIdFromIdToken(r.id_token) : null,
    expiresAt: Date.now() + r.expires_in * 1000,
  };
}

/** Pull the ChatGPT account id out of the id_token JWT payload (no signature check). */
export function accountIdFromIdToken(idToken: string): string | null {
  try {
    const segment = idToken.split(".")[1];
    if (!segment) return null;
    const payload = JSON.parse(Buffer.from(segment, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    const auth = payload["https://api.openai.com/auth"] as
      | { chatgpt_account_id?: string }
      | undefined;
    return auth?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
