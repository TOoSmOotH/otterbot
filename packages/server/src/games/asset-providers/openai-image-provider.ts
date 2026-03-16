/**
 * OpenAI image generation provider.
 *
 * Supports DALL-E 3 and gpt-image-1 via the OpenAI images API.
 * Uses the existing LLM provider credential system for API key resolution.
 */

import type { ImageGenProvider, ImageGenOptions, ImageGenResult } from "./types.js";

export class OpenAIImageProvider implements ImageGenProvider {
  type = "openai" as const;

  constructor(private apiKey: string) {}

  async generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult> {
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;

    // Map dimensions to the closest supported size
    const size = this.resolveSize(width, height);

    const body: Record<string, unknown> = {
      model: "gpt-image-1",
      prompt,
      n: 1,
      size,
    };

    if (options?.style === "pixel-art") {
      body.prompt = `Pixel art style: ${prompt}`;
    }

    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI image generation failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as {
      data: Array<{ b64_json?: string; url?: string }>;
    };

    const item = json.data[0];
    let data: Buffer;

    if (item.b64_json) {
      data = Buffer.from(item.b64_json, "base64");
    } else if (item.url) {
      const imgRes = await fetch(item.url);
      if (!imgRes.ok) throw new Error("Failed to download generated image");
      data = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error("OpenAI returned no image data");
    }

    return { data, mimeType: "image/png", provider: "openai" };
  }

  private resolveSize(width: number, height: number): string {
    // gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024, auto
    if (width > height * 1.2) return "1536x1024";
    if (height > width * 1.2) return "1024x1536";
    return "1024x1024";
  }
}
