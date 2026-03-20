import { basename, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { ModelGenProvider, ModelGenOptions, ModelGenResult } from "./types.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";

export class TrellisLocalModelProvider implements ModelGenProvider {
  type = "trellis-local" as const;

  constructor(private baseUrl: string = DEFAULT_BASE_URL) {}

  async generate(prompt: string, options?: ModelGenOptions): Promise<ModelGenResult> {
    const imagePath = options?.sourceImagePath;
    const imageUrl = options?.sourceImageUrl;
    const format = options?.format ?? "glb";
    const complexity = options?.complexity ?? "medium";
    const blenderPreset = options?.blenderPreset ?? "game-ready";

    const res = imagePath || imageUrl
      ? await this.generateFromImage(prompt, {
        imagePath,
        imageUrl,
        format,
        complexity,
        blenderPreset,
      })
      : await this.generateFromText(prompt, {
        format,
        complexity,
        blenderPreset,
      });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TRELLIS bridge failed (${res.status}): ${text}`);
    }

    const json = await res.json() as { modelBase64?: string; format?: string };
    if (!json.modelBase64) {
      throw new Error("TRELLIS bridge returned no model data");
    }

    return {
      data: Buffer.from(json.modelBase64, "base64"),
      format: json.format ?? options?.format ?? "glb",
      provider: "trellis-local",
    };
  }

  private async generateFromImage(
    prompt: string,
    input: {
      imagePath?: string;
      imageUrl?: string;
      format: string;
      complexity: string;
      blenderPreset: string;
    },
  ): Promise<Response> {
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("format", input.format);
    formData.append("complexity", input.complexity);
    formData.append("blenderPreset", input.blenderPreset);

    if (input.imagePath) {
      const fullPath = resolve(input.imagePath);
      const data = readFileSync(fullPath);
      formData.append("image", new Blob([new Uint8Array(data)]), basename(fullPath));
    }

    if (input.imageUrl) {
      formData.append("imageUrl", input.imageUrl);
    }

    return fetch(`${this.baseUrl}/generate-from-image`, {
      method: "POST",
      body: formData,
    });
  }

  private async generateFromText(
    prompt: string,
    input: { format: string; complexity: string; blenderPreset: string },
  ): Promise<Response> {
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("format", input.format);
    formData.append("complexity", input.complexity);
    formData.append("blenderPreset", input.blenderPreset);
    return fetch(`${this.baseUrl}/generate`, {
      method: "POST",
      body: formData,
    });
  }
}
