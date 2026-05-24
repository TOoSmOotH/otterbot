import { randomUUID } from "node:crypto";
import type { OpenAiAuthStore } from "./openai-auth-store.js";

/**
 * Build the request headers the ChatGPT Codex backend expects, with a fresh
 * (auto-refreshed) bearer token. Shared by the chat transport
 * (`OpenAiCodexOAuthModel`) and the image-generation integration so the exact
 * header recipe — Cloudflare originator, account id, beta flag — lives in one
 * place. Modeled after Hermes' `_codex_cloudflare_headers`: requests from
 * non-residential IPs that don't advertise the Codex originator are 403'd.
 */
export async function buildCodexHeaders(auth: OpenAiAuthStore): Promise<Headers> {
  const token = await auth.accessToken();
  const headers = new Headers({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "text/event-stream",
    "openai-beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": "codex_cli_rs/0.0.0 (Otterbot)",
    session_id: randomUUID(),
  });
  const account = auth.accountId() ?? accountIdFromJwt(token);
  if (account) headers.set("ChatGPT-Account-ID", account);
  return headers;
}

/** Pull the ChatGPT account id from an access-token JWT (no signature check). */
export function accountIdFromJwt(token: string): string | null {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64").toString("utf8")
    ) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string };
    };
    return payload["https://api.openai.com/auth"]?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}
