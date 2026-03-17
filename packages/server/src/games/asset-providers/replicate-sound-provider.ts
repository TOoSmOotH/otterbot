/**
 * Replicate sound generation provider.
 *
 * Uses the Replicate HTTP API to generate audio via MusicGen (music)
 * and AudioGen (SFX/ambient). Follows the same polling pattern as
 * ReplicateImageProvider.
 */

import type { SoundGenProvider, SoundGenOptions, SoundGenResult } from "./types.js";

const DEFAULT_MUSIC_MODEL = "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043ac7f315571e8e2de2fc8589cc";
const DEFAULT_SFX_MODEL = "meta/musicgen:671ac645ce5e552cc63a54a2bbff63fcf798043ac7f315571e8e2de2fc8589cc";

const REPLICATE_API = "https://api.replicate.com/v1";
const MAX_POLL_ATTEMPTS = 120;
const POLL_INTERVAL_MS = 3000;

export class ReplicateSoundProvider implements SoundGenProvider {
  type = "replicate" as const;

  constructor(
    private apiKey: string,
    private musicModel: string = DEFAULT_MUSIC_MODEL,
    private sfxModel: string = DEFAULT_SFX_MODEL,
  ) {}

  async generate(prompt: string, options?: SoundGenOptions): Promise<SoundGenResult> {
    const category = options?.category ?? "sfx";
    const duration = options?.durationSeconds ?? (category === "music" ? 8 : 3);
    const model = category === "music" ? this.musicModel : this.sfxModel;

    // Build the prompt with style/mood hints
    let fullPrompt = prompt;
    if (options?.style) fullPrompt = `${options.style} style: ${fullPrompt}`;
    if (options?.mood) fullPrompt = `${options.mood} mood, ${fullPrompt}`;

    const input: Record<string, unknown> = {
      prompt: fullPrompt,
      duration: Math.min(duration, 30), // Cap at 30s for API limits
      model_version: "stereo-melody-large",
    };

    if (options?.tempo) {
      // Include tempo hint in prompt since MusicGen doesn't have a direct BPM input
      input.prompt = `${input.prompt}, ${options.tempo} BPM`;
    }

    // Create prediction
    const createRes = await fetch(`${REPLICATE_API}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: model.includes(":") ? model.split(":")[1] : model,
        input,
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`Replicate sound prediction failed (${createRes.status}): ${text}`);
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
      throw new Error(`Replicate sound prediction ${result.status}: ${JSON.stringify(result)}`);
    }

    const output = (result as unknown as { output: string }).output;
    if (!output) {
      throw new Error("Replicate returned no output");
    }

    // Download the audio — MusicGen returns a single audio URL (WAV)
    const audioUrl = typeof output === "string" ? output : (output as unknown as string[])[0];
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error("Failed to download Replicate output audio");
    const data = Buffer.from(await audioRes.arrayBuffer());

    // Detect format from content-type or URL
    const contentType = audioRes.headers.get("content-type") ?? "";
    let format = "wav";
    if (contentType.includes("mpeg") || audioUrl.endsWith(".mp3")) format = "mp3";
    else if (contentType.includes("ogg") || audioUrl.endsWith(".ogg")) format = "ogg";

    return { data, format, provider: "replicate" };
  }
}
