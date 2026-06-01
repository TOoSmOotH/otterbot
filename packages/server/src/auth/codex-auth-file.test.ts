import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexJsonToOauth,
  oauthToCodexJson,
  readCodexAuth,
  writeCodexAuth,
} from "./codex-auth-file.js";
import type { OAuthTokens } from "./openai-oauth.js";

/** Minimal unsigned JWT with the given payload (base64url, no real signature). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

const expSec = Math.floor(Date.now() / 1000) + 3600;
const accessToken = jwt({ exp: expSec });
const idToken = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_123" } });
const tokens: OAuthTokens = {
  accessToken,
  refreshToken: "refresh-1",
  idToken,
  accountId: "acc_123",
  expiresAt: expSec * 1000,
};

describe("codex auth.json conversion", () => {
  it("serializes to Codex's schema", () => {
    const j = oauthToCodexJson(tokens, "2025-01-01T00:00:00.000Z");
    expect(j.OPENAI_API_KEY).toBeNull();
    expect(j.tokens).toEqual({
      id_token: idToken,
      access_token: accessToken,
      refresh_token: "refresh-1",
      account_id: "acc_123",
    });
    expect(j.last_refresh).toBe("2025-01-01T00:00:00.000Z");
  });

  it("round-trips and derives expiry from the access-token JWT", () => {
    const back = codexJsonToOauth(oauthToCodexJson(tokens, "2025-01-01T00:00:00.000Z"));
    expect(back).not.toBeNull();
    expect(back!.refreshToken).toBe("refresh-1");
    expect(back!.accountId).toBe("acc_123");
    expect(back!.expiresAt).toBe(expSec * 1000);
  });

  it("derives account_id from the id_token when absent", () => {
    const back = codexJsonToOauth({
      tokens: { access_token: accessToken, refresh_token: "r", id_token: idToken },
    });
    expect(back?.accountId).toBe("acc_123");
  });

  it("returns null when there is no usable token", () => {
    expect(codexJsonToOauth({})).toBeNull();
    expect(codexJsonToOauth({ OPENAI_API_KEY: "sk-..." })).toBeNull();
    // access token but no refresh token → not usable for us.
    expect(codexJsonToOauth({ tokens: { access_token: accessToken } })).toBeNull();
  });

  it("writes and reads the shared file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "codex-auth-")), "auth.json");
    expect(readCodexAuth(path)).toBeNull();
    writeCodexAuth(tokens, path);
    const back = readCodexAuth(path);
    expect(back?.refreshToken).toBe("refresh-1");
    expect(back?.accountId).toBe("acc_123");
  });
});
