/**
 * Asset generation provider interfaces for the Game Studio.
 *
 * Follows the same adapter pattern as the LLM system:
 * - Provider interfaces define the contract
 * - Implementations are pluggable backends (OpenAI, Replicate, SD, procedural)
 * - Config resolves which provider to use from the settings/config table
 */

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

export type AssetProviderType =
  | "comfyui-local"
  | "openai"
  | "replicate"
  | "trellis-local"
  | "stable-diffusion"
  | "procedural";

export interface AssetProviderMeta {
  type: AssetProviderType;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  capabilities: AssetCapability[];
  local?: boolean;
  recommendedFor?: ("cpu" | "low" | "medium" | "high")[];
  experimental?: boolean;
  notes?: string;
}

export type AssetCapability = "image" | "sprite" | "model-3d" | "sound";

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export interface ImageGenOptions {
  width?: number;
  height?: number;
  /** Image style hint: pixel-art, photorealistic, cartoon, etc. */
  style?: string;
  /** Number of images to generate (default 1) */
  count?: number;
  /** Task category used to select a ComfyUI workflow/preset. */
  taskType?: "texture" | "sprite" | "icon" | "hero" | "image";
  /** Optional preset override for local ComfyUI generation. */
  presetId?: string;
  /** Optional advanced overrides for local ComfyUI generation. */
  checkpoint?: string;
  sampler?: string;
  steps?: number;
  cfgScale?: number;
}

export interface ImageGenResult {
  /** Raw image data as Buffer (PNG) */
  data: Buffer;
  /** MIME type (always image/png for now) */
  mimeType: string;
  /** Provider that generated this image */
  provider: AssetProviderType;
}

export interface ImageGenProvider {
  type: AssetProviderType;
  generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult>;
}

// ---------------------------------------------------------------------------
// 3D model generation
// ---------------------------------------------------------------------------

export interface ModelGenOptions {
  /** Desired format: glb, gltf, obj */
  format?: "glb" | "gltf" | "obj";
  /** Geometry complexity hint */
  complexity?: "low" | "medium" | "high";
  /** Optional local image path to drive image-to-3D generation. */
  sourceImagePath?: string;
  /** Optional source image URL exposed by Otterbot uploads. */
  sourceImageUrl?: string;
  /** Optional Blender cleanup preset used by the sidecar. */
  blenderPreset?: "preview" | "game-ready" | "high-detail";
}

export interface ModelGenResult {
  data: Buffer;
  format: string;
  provider: AssetProviderType;
}

export interface ModelGenProvider {
  type: AssetProviderType;
  generate(prompt: string, options?: ModelGenOptions): Promise<ModelGenResult>;
}

// ---------------------------------------------------------------------------
// Sound generation
// ---------------------------------------------------------------------------

export interface SoundGenOptions {
  /** Duration in seconds */
  durationSeconds?: number;
  /** Sound type hint */
  category?: "sfx" | "music" | "ambient";
  /** Desired format */
  format?: "wav" | "mp3" | "ogg";
  /** Tempo in BPM (60-200, for music generation) */
  tempo?: number;
  /** Musical key hint (e.g. "C major", "A minor") */
  key?: string;
  /** Mood descriptor (e.g. "upbeat", "melancholy", "tense") */
  mood?: string;
  /** Genre/style hint (e.g. "chiptune", "orchestral", "lo-fi", "electronic") */
  style?: string;
  /** Instrument hints for procedural music layers */
  instruments?: string[];
}

export interface SoundGenResult {
  data: Buffer;
  format: string;
  provider: AssetProviderType;
}

export interface SoundGenProvider {
  type: AssetProviderType;
  generate(prompt: string, options?: SoundGenOptions): Promise<SoundGenResult>;
}

// ---------------------------------------------------------------------------
// Provider metadata registry
// ---------------------------------------------------------------------------

export const ASSET_PROVIDER_META: AssetProviderMeta[] = [
  {
    type: "comfyui-local",
    label: "ComfyUI Sidecar (Local)",
    needsApiKey: false,
    needsBaseUrl: true,
    capabilities: ["image", "sprite"],
    local: true,
    recommendedFor: ["low", "medium", "high"],
    notes: "Real ComfyUI integration for local textures, sprites, icons, and concept art. Otterbot selects workflows and presets, and can manage local model downloads.",
  },
  {
    type: "openai",
    label: "OpenAI (DALL-E / gpt-image)",
    needsApiKey: true,
    needsBaseUrl: false,
    capabilities: ["image", "sprite"],
  },
  {
    type: "replicate",
    label: "Replicate",
    needsApiKey: true,
    needsBaseUrl: false,
    capabilities: ["image", "sprite", "model-3d", "sound"],
  },
  {
    type: "trellis-local",
    label: "TRELLIS Bridge (Local, Experimental)",
    needsApiKey: false,
    needsBaseUrl: true,
    capabilities: ["model-3d"],
    local: true,
    experimental: true,
    recommendedFor: ["high"],
    notes: "Local image-to-3D and text-to-3D through a TRELLIS sidecar, with optional Blender cleanup/export.",
  },
  {
    type: "stable-diffusion",
    label: "Stable Diffusion (Legacy Local)",
    needsApiKey: false,
    needsBaseUrl: true,
    capabilities: ["image", "sprite"],
    local: true,
    recommendedFor: ["low", "medium", "high"],
    notes: "Legacy local image option kept for compatibility. New setups should prefer ComfyUI Sidecar (Local).",
  },
  {
    type: "procedural",
    label: "Procedural (No AI)",
    needsApiKey: false,
    needsBaseUrl: false,
    capabilities: ["image", "sprite", "model-3d", "sound"],
    local: true,
    recommendedFor: ["cpu", "low", "medium", "high"],
    notes: "Always available fallback with no local service required.",
  },
];
