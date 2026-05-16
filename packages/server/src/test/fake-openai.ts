import { createServer, type Server, type ServerResponse } from "node:http";

/**
 * A fake OpenAI-compatible server for tests. Implements `/v1/chat/completions`
 * (streaming + non-streaming), `/v1/embeddings`, and `/v1/models` so the real
 * provider/runtime code path can be exercised end-to-end with no network and
 * fully deterministic output.
 */
export interface FakeOpenAI {
  /** Base URL ending in `/v1` — assign to `LMSTUDIO_BASE_URL`. */
  url: string;
  model: string;
  embeddingDim: number;
  /** Force the next chat completion to return exactly this text. */
  setNextReply(text: string): void;
  /** Number of chat completions served so far. */
  readonly chatRequests: number;
  close(): Promise<void>;
}

export async function startFakeOpenAI(
  opts: { embeddingDim?: number; port?: number } = {}
): Promise<FakeOpenAI> {
  const embeddingDim = opts.embeddingDim ?? 768;
  let nextReply: string | null = null;
  let chatRequests = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const url = req.url ?? "";
      let body: Record<string, unknown> = {};
      try {
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      } catch {
        body = {};
      }

      if (url.endsWith("/models")) {
        return json(res, { object: "list", data: [{ id: "fake-model", object: "model" }] });
      }

      if (url.endsWith("/embeddings")) {
        const raw = body.input;
        const inputs = Array.isArray(raw) ? raw : [raw ?? ""];
        return json(res, {
          object: "list",
          model: "fake-embed",
          data: inputs.map((t, i) => ({
            object: "embedding",
            index: i,
            embedding: embed(String(t), embeddingDim),
          })),
          usage: { prompt_tokens: 1, total_tokens: 1 },
        });
      }

      if (url.endsWith("/chat/completions")) {
        chatRequests++;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const lastUser = [...messages]
          .reverse()
          .find((m): m is { role: string; content: unknown } => {
            return !!m && typeof m === "object" && (m as { role?: string }).role === "user";
          });
        const userText =
          lastUser && typeof lastUser.content === "string" ? lastUser.content : "ack";
        const reply = nextReply ?? `OK: ${userText}`;
        nextReply = null;

        if (body.stream) {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          const id = "chatcmpl-fake";
          const created = Math.floor(Date.now() / 1000);
          sse(res, completionChunk(id, created, { role: "assistant" }, null));
          for (const piece of splitText(reply)) {
            sse(res, completionChunk(id, created, { content: piece }, null));
          }
          sse(res, completionChunk(id, created, {}, "stop"));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        return json(res, {
          id: "chatcmpl-fake",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "fake-model",
          choices: [
            { index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      }

      res.writeHead(404);
      res.end("not found");
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    url: `http://127.0.0.1:${port}/v1`,
    model: "fake-model",
    embeddingDim,
    setNextReply: (t: string) => {
      nextReply = t;
    },
    get chatRequests() {
      return chatRequests;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function json(res: ServerResponse, payload: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function sse(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function completionChunk(
  id: string,
  created: number,
  delta: Record<string, unknown>,
  finish: string | null
) {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function splitText(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += 8) out.push(text.slice(i, i + 8));
  return out.length ? out : [""];
}

/** Deterministic embedding: identical text → identical vector. */
function embed(text: string, dim: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = (h * 16777619) >>> 0;
  }
  const vec = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    const x = ((h * (i + 1)) >>> 0) % 9973;
    vec[i] = x / 9973 - 0.5;
  }
  return vec;
}
