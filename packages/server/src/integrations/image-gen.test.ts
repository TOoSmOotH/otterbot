import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initOpenAiAuth } from "../auth/openai-auth-store.js";
import { generateImage, persistImage } from "./image-gen.js";

/**
 * Exercises the Codex image transport without hitting the network: a fake
 * ChatGPT auth store + a stubbed `fetch` that streams a captured SSE response,
 * asserting we extract the final base64 PNG (final result overrides partials).
 */

const FINAL_B64 = Buffer.from("the-final-png-bytes").toString("base64");
const PARTIAL_B64 = Buffer.from("partial").toString("base64");

function sseResponse(body: string): Response {
  // A string body becomes a ReadableStream<Uint8Array>, like a real fetch.
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function connectAuth(): void {
  const store = new Map<string, string>();
  store.set(
    "openai_oauth",
    JSON.stringify({
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      idToken: "",
      accountId: "acct_123",
      expiresAt: Date.now() + 60 * 60 * 1000,
    })
  );
  initOpenAiAuth({
    getSetting: (k) => store.get(k) ?? null,
    setSetting: (k, v) => void store.set(k, v),
  });
}

describe("image-gen (Codex OAuth)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset the auth singleton so other suites aren't affected.
    initOpenAiAuth({ getSetting: () => null, setSetting: () => {} });
  });

  it("extracts the final base64 image from the SSE stream", async () => {
    connectAuth();
    const events = [
      `data: ${JSON.stringify({ type: "response.image_generation_call.partial_image", partial_image_b64: PARTIAL_B64 })}`,
      `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: FINAL_B64 } })}`,
      `data: ${JSON.stringify({ type: "response.completed", response: { output: [] } })}`,
      "data: [DONE]",
    ].join("\n\n") + "\n\n";

    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const res = await generateImage({ prompt: "a red otter", quality: "low" });
    expect(res.ok).toBe(true);
    expect(res.b64).toBe(FINAL_B64);

    // It posted to the Codex Responses endpoint with the image_generation tool.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/backend-api\/codex\/responses$/);
    const sent = JSON.parse(init.body as string);
    expect(sent.tools[0]).toMatchObject({ type: "image_generation", model: "gpt-image-2", quality: "low" });
    const headers = init.headers as Headers;
    expect(headers.get("ChatGPT-Account-ID")).toBe("acct_123");
    expect(headers.get("originator")).toBe("codex_cli_rs");
  });

  it("reports a clear error when ChatGPT is not connected", async () => {
    initOpenAiAuth({ getSetting: () => null, setSetting: () => {} });
    const res = await generateImage({ prompt: "anything" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connect ChatGPT/i);
  });

  it("persistImage writes a PNG and returns its filename", () => {
    const dir = mkdtempSync(join(tmpdir(), "otter-img-"));
    try {
      const { file, path } = persistImage(dir, FINAL_B64);
      expect(file).toMatch(/^gen_\d+_[0-9a-f]+\.png$/);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path).toString()).toBe("the-final-png-bytes");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
