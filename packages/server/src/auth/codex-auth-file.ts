import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sharedCodingAuthDir } from "../integrations/shell.js";
import { accountIdFromIdToken, type OAuthTokens } from "./openai-oauth.js";

/**
 * Bridge between otterbot's ChatGPT OAuth token bundle and the Codex CLI's
 * `auth.json`. The app and Codex use the SAME OpenAI OAuth client, so OpenAI
 * allows only one active token per account — two independent logins invalidate
 * each other. To let both coexist, this shared file is the single source of
 * truth: the app reads/writes it, Codex reads/writes it (it's bind-mounted into
 * every sandbox at `~/.codex/auth.json`), and whoever refreshes updates it.
 *
 * Schema (Codex's own format — kept exactly so Codex stays happy):
 *   { "OPENAI_API_KEY": null,
 *     "tokens": { "id_token", "access_token", "refresh_token", "account_id" },
 *     "last_refresh": "<RFC3339>" }
 */

interface CodexAuthJson {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string | null;
  };
  last_refresh?: string;
}

/** Path of the shared Codex auth file (bound into sandboxes at ~/.codex/auth.json). */
function codexAuthPath(): string {
  return join(sharedCodingAuthDir(), "codex", "auth.json");
}

/** The `exp` claim (epoch ms) from a JWT access token, or null if unreadable. */
function jwtExpiryMs(jwt: string): number | null {
  try {
    const seg = jwt.split(".")[1];
    if (!seg) return null;
    const payload = JSON.parse(Buffer.from(seg, "base64").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Convert a parsed Codex auth.json into our OAuthTokens, or null if it has none. */
export function codexJsonToOauth(j: CodexAuthJson): OAuthTokens | null {
  const t = j.tokens;
  if (!t?.access_token || !t.refresh_token) return null;
  const idToken = t.id_token ?? "";
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    idToken,
    accountId: t.account_id ?? (idToken ? accountIdFromIdToken(idToken) : null),
    // Codex doesn't store an expiry; derive it from the access token's JWT.
    expiresAt:
      jwtExpiryMs(t.access_token) ??
      (j.last_refresh ? Date.parse(j.last_refresh) || Date.now() : Date.now()) + 3_600_000,
  };
}

/** Serialize our OAuthTokens into Codex's auth.json shape. */
export function oauthToCodexJson(tokens: OAuthTokens, now: string): CodexAuthJson {
  return {
    OPENAI_API_KEY: null,
    tokens: {
      id_token: tokens.idToken,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      account_id: tokens.accountId,
    },
    last_refresh: now,
  };
}

/** Read the shared Codex auth file, or null if absent/empty/unparseable. */
export function readCodexAuth(path = codexAuthPath()): OAuthTokens | null {
  try {
    if (!existsSync(path)) return null;
    return codexJsonToOauth(JSON.parse(readFileSync(path, "utf8")) as CodexAuthJson);
  } catch {
    return null;
  }
}

/** File mtime in ms, or 0 when the file is missing — for change detection. */
export function codexAuthMtimeMs(path = codexAuthPath()): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Write our tokens into the shared Codex auth file (0600, dir created). */
export function writeCodexAuth(tokens: OAuthTokens, path = codexAuthPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(oauthToCodexJson(tokens, new Date().toISOString()), null, 2), {
    mode: 0o600,
  });
}

/** Remove the shared Codex auth file (sign-out everywhere). */
export function clearCodexAuth(path = codexAuthPath()): void {
  try {
    rmSync(path, { force: true });
  } catch {
    /* best-effort */
  }
}
