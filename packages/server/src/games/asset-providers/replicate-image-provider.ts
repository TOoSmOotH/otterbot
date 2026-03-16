/**
 * Replicate image generation provider.
 *
 * Uses the Replicate HTTP API to generate images via popular models
 * like SDXL, Flux, etc. Supports polling-based prediction workflow.
 */

import type { ImageGenProvider, ImageGenOptions, ImageGenResult } from "./types.js";

const DEFAULT_MODEL = "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc";
const REPLICATE_API = "https://api.replicate.com/v1";
const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 2000;

export class ReplicateImageProvider implements ImageGenProvider {
  type = "replicate" as const;

  constructor(
    private apiKey: string,
    private model: string = DEFAULT_MODEL,
  ) {}

  async generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult> {
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;

    // Create prediction
    const createRes = await fetch(`${REPLICATE_API}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: this.model.includes(":") ? this.model.split(":")[1] : this.model,
        input: {
          prompt: options?.style ? `${options.style} style: ${prompt}` : prompt,
          width: Math.min(width, 1024),
          height: Math.min(height, 1024),
          num_outputs: 1,
        },
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Replicate prediction failed (${createRes.status}): ${text}`);
    }

    const prediction = (await createRes.json()) as { id: string; status: string; urls: { get: string } };

    // Poll for completion
    let result = prediction;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      if (result.status === "succeeded" || result.status === "failed" || result.status === "canceled") break;

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

      const pollRes = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      if (!pollRes.ok) throw new Error(`Replicate poll failed (${pollRes.status})`);
      result = await pollRes.json();
    }

    if (result.status !== "succeeded") {
      throw new Error(`Replicate prediction ${result.status}: ${JSON.stringify(result)}`);
    }

    const output = (result as unknown as { output: string[] }).output;
    if (!output || output.length === 0) {
      throw new Error("Replicate returned no output");
    }

    // Download the image
    const imgRes = await fetch(output[0]);
    if (!imgRes.ok) throw new Error("Failed to download Replicate output image");
    const data = Buffer.from(await imgRes.arrayBuffer());

    return { data, mimeType: "image/png", provider: "replicate" };
  }
}
