/**
 * Stable Diffusion (local) image generation provider.
 *
 * Connects to a local ComfyUI or Automatic1111 (A1111) API endpoint.
 * Defaults to the A1111 /sdapi/v1/txt2img endpoint.
 */

import type { ImageGenProvider, ImageGenOptions, ImageGenResult } from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:7860";

export class StableDiffusionImageProvider implements ImageGenProvider {
  type = "stable-diffusion" as const;

  constructor(private baseUrl: string = DEFAULT_BASE_URL) {}

  async generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult> {
    const width = options?.width ?? 512;
    const height = options?.height ?? 512;

    const fullPrompt = options?.style ? `(${options.style}:1.3), ${prompt}` : prompt;

    const res = await fetch(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: fullPrompt,
        negative_prompt: "blurry, low quality, watermark, text",
        width: Math.round(width / 64) * 64, // Round to nearest 64
        height: Math.round(height / 64) * 64,
        steps: 20,
        cfg_scale: 7,
        sampler_name: "Euler a",
        batch_size: 1,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Stable Diffusion API failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { images: string[] };
    if (!json.images || json.images.length === 0) {
      throw new Error("Stable Diffusion returned no images");
    }

    const data = Buffer.from(json.images[0], "base64");
    return { data, mimeType: "image/png", provider: "stable-diffusion" };
  }
}
