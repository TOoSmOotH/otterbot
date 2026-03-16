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
  | "openai"
  | "replicate"
  | "stable-diffusion"
  | "procedural";

export interface AssetProviderMeta {
  type: AssetProviderType;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  capabilities: AssetCapability[];
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
    type: "stable-diffusion",
    label: "Stable Diffusion (Local)",
    needsApiKey: false,
    needsBaseUrl: true,
    capabilities: ["image", "sprite"],
  },
  {
    type: "procedural",
    label: "Procedural (No AI)",
    needsApiKey: false,
    needsBaseUrl: false,
    capabilities: ["image", "sprite", "model-3d", "sound"],
  },
];
