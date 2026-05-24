import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CHATGPT_CODEX_BASE_URL } from "../auth/openai-oauth.js";
import { buildCodexHeaders } from "../auth/codex-request.js";
import { getOpenAiAuth } from "../auth/openai-auth-store.js";

/**
 * Image generation through ChatGPT Codex OAuth — the same transport otterbot's
 * chat model uses (`OpenAiCodexOAuthModel`), modeled after Hermes' `openai-codex`
 * image_gen plugin. We POST to the Codex backend Responses API with the built-in
 * `image_generation` tool (gpt-image-2) and pull the base64 PNG out of the SSE
 * stream. This uses the user's ChatGPT subscription, not a metered API key.
 */

/** Host model that carries the Responses request; the image work is the tool. */
const IMAGE_HOST_MODEL = "gpt-5.4";
/** The image model the `image_generation` tool runs (Hermes' gpt-image-2 tiers). */
const IMAGE_MODEL = "gpt-image-2";

export type ImageQuality = "low" | "medium" | "high";
const DEFAULT_QUALITY: ImageQuality = "medium";
const DEFAULT_SIZE = "1024x1024";

export interface ImageResult {
  ok: boolean;
  /** Base64-encoded PNG (no data: prefix) when ok. */
  b64?: string;
  error?: string;
}

export interface GenerateImageOpts {
  prompt: string;
  quality?: ImageQuality;
  size?: string;
}

export interface EditImageOpts extends GenerateImageOpts {
  /** Source image: an http(s) URL, a generated-image URL/filename, or a
   *  workspace-relative path. Resolved against the agent's own directories. */
  sourceImage: string;
  /** Optional mask image, resolved the same way as `sourceImage`. */
  mask?: string;
  /** The agent's images dir, used to resolve generated-image references. */
  imagesDir: string;
  /** The agent's workspace dir, used to resolve relative source paths. */
  workspaceDir: string;
}

/** Generate an image from a text prompt. */
export async function generateImage(opts: GenerateImageOpts): Promise<ImageResult> {
  return runImage(opts, []);
}

/** Edit/vary an existing image, optionally guided by a mask. */
export async function editImage(opts: EditImageOpts): Promise<ImageResult> {
  let parts: Array<Record<string, unknown>>;
  try {
    const source = await resolveImageDataUrl(opts.sourceImage, opts);
    parts = [{ type: "input_image", image_url: source }];
    if (opts.mask) {
      const mask = await resolveImageDataUrl(opts.mask, opts);
      parts.push({ type: "input_image_mask", image_url: mask });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return runImage(opts, parts);
}

async function runImage(
  opts: GenerateImageOpts,
  extraContent: Array<Record<string, unknown>>
): Promise<ImageResult> {
  const auth = getOpenAiAuth();
  if (!auth?.isConnected()) {
    return {
      ok: false,
      error: "Not connected to ChatGPT. Ask the user to connect ChatGPT in Settings → OpenAI.",
    };
  }

  const body = {
    model: IMAGE_HOST_MODEL,
    instructions:
      "You are an image generator. Call the image_generation tool to create exactly the image the user describes. Do not ask follow-up questions.",
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: opts.prompt }, ...extraContent],
      },
    ],
    tools: [
      {
        type: "image_generation",
        model: IMAGE_MODEL,
        quality: opts.quality ?? DEFAULT_QUALITY,
        size: opts.size ?? DEFAULT_SIZE,
        output_format: "png",
        partial_images: 1,
      },
    ],
    tool_choice: { type: "image_generation" },
    store: false,
    stream: true,
  };

  let res: Response;
  try {
    res = await fetch(`${CHATGPT_CODEX_BASE_URL}/responses`, {
      method: "POST",
      headers: await buildCodexHeaders(auth),
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!res.ok || !res.body) {
    return {
      ok: false,
      error: `image request failed: ${res.status} ${res.statusText} ${await safeText(res)}`,
    };
  }

  try {
    const b64 = await readImageStream(res.body);
    if (!b64) return { ok: false, error: "no image was returned by the model" };
    return { ok: true, b64 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read the Codex Responses SSE stream and return the final base64 PNG. Updates
 * from partial-image events and is overridden by the final
 * `image_generation_call` result (in the item-done event or the completed sweep).
 */
async function readImageStream(stream: ReadableStream<Uint8Array>): Promise<string | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let b64: string | null = null;

  const handle = (raw: string) => {
    const data = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event: ImageEvent;
    try {
      event = JSON.parse(data) as ImageEvent;
    } catch {
      return;
    }
    if (
      event.type === "response.image_generation_call.partial_image" &&
      typeof event.partial_image_b64 === "string"
    ) {
      b64 = event.partial_image_b64;
    } else if (
      event.type === "response.output_item.done" &&
      event.item?.type === "image_generation_call" &&
      typeof event.item.result === "string"
    ) {
      b64 = event.item.result;
    } else if (event.type === "response.completed") {
      for (const item of event.response?.output ?? []) {
        if (item?.type === "image_generation_call" && typeof item.result === "string") {
          b64 = item.result;
        }
      }
    } else if (event.type === "response.failed") {
      throw new Error(event.response?.error?.message ?? event.error?.message ?? "image generation failed");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      handle(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handle(buffer);
  return b64;
}

interface ImageEvent {
  type?: string;
  partial_image_b64?: string;
  item?: { type?: string; result?: string };
  response?: {
    output?: Array<{ type?: string; result?: string }>;
    error?: { message?: string };
  };
  error?: { message?: string };
}

/** Persist a base64 PNG into the agent's images dir; returns the filename. */
export function persistImage(imagesDir: string, b64: string): { file: string; path: string } {
  mkdirSync(imagesDir, { recursive: true });
  const file = `gen_${Date.now()}_${randomUUID().slice(0, 8)}.png`;
  const path = join(imagesDir, file);
  writeFileSync(path, Buffer.from(b64, "base64"));
  return { file, path };
}

/**
 * Resolve a source/mask reference to a `data:` URL the Responses API accepts.
 * Accepts an http(s) URL, a generated-image URL/bare filename (read from the
 * agent's images dir), or a workspace-relative path (confined to the workspace).
 */
async function resolveImageDataUrl(ref: string, opts: EditImageOpts): Promise<string> {
  const trimmed = ref.trim();
  // Already a data URL (e.g. a cross-agent artifact pre-resolved by the tool).
  if (trimmed.startsWith("data:")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const res = await fetch(trimmed);
    if (!res.ok) throw new Error(`could not fetch source image: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0] || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  // A generated-image reference, e.g. "/api/agents/<id>/images/gen_x.png" or a
  // bare "gen_x.png" — resolve a basename within the agent's images dir.
  const imagesMatch = trimmed.match(/(?:^|\/)images\/([^/]+)$/) ?? trimmed.match(/^([\w.-]+\.png)$/i);
  if (imagesMatch) {
    const name = basename(imagesMatch[1]);
    return readAsDataUrl(join(opts.imagesDir, name));
  }

  // Otherwise treat it as a workspace-relative (or absolute, within-workspace) path.
  const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(opts.workspaceDir, trimmed);
  if (!abs.startsWith(resolve(opts.workspaceDir))) {
    throw new Error("source image path must be inside the agent's workspace");
  }
  return readAsDataUrl(abs);
}

function readAsDataUrl(path: string): string {
  const buf = readFileSync(path);
  const mime = path.toLowerCase().endsWith(".jpg") || path.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : path.toLowerCase().endsWith(".webp")
      ? "image/webp"
      : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}
