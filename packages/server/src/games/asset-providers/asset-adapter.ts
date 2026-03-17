/**
 * Asset generation adapter — resolves the configured provider for each asset type.
 *
 * Follows the same pattern as llm/adapter.ts:
 * - Reads provider configuration from the config table
 * - Falls back to the procedural provider when nothing is configured
 * - Credential resolution reuses the existing provider system
 */

import { getConfig } from "../../auth/auth.js";
import { getDb, schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import type {
  AssetProviderType,
  ImageGenProvider,
  ModelGenProvider,
  SoundGenProvider,
} from "./types.js";
import { ProceduralImageProvider } from "./procedural-image-provider.js";
import { ProceduralModelProvider } from "./procedural-model-provider.js";
import { ProceduralSoundProvider } from "./procedural-sound-provider.js";
import { OpenAIImageProvider } from "./openai-image-provider.js";
import { ReplicateImageProvider } from "./replicate-image-provider.js";
import { ReplicateSoundProvider } from "./replicate-sound-provider.js";
import { StableDiffusionImageProvider } from "./sd-image-provider.js";

// Config keys used by the asset system
const CONFIG_IMAGE_PROVIDER = "asset:image:provider"; // "openai" | "replicate" | "stable-diffusion" | "procedural"
const CONFIG_SOUND_PROVIDER = "asset:sound:provider";
const CONFIG_MODEL_PROVIDER = "asset:model:provider";

// Singleton fallbacks
const proceduralImage = new ProceduralImageProvider();
const proceduralModel = new ProceduralModelProvider();
const proceduralSound = new ProceduralSoundProvider();

/**
 * Resolve API key for an asset provider.
 *
 * First checks for a dedicated asset provider key (asset:<type>:api_key),
 * then falls back to the LLM providers table (reuse existing OpenAI/Replicate keys).
 */
function resolveApiKey(providerType: AssetProviderType): string | undefined {
  // Check dedicated asset provider key
  const dedicated = getConfig(`asset:${providerType}:api_key`);
  if (dedicated) return dedicated;

  // Reuse from LLM providers table
  try {
    const db = getDb();
    const rows = db.select().from(schema.providers).all();
    for (const row of rows) {
      if (row.type === providerType && row.apiKey) {
        return row.apiKey;
      }
    }
  } catch {
    // DB not ready — ignore
  }

  return undefined;
}

function resolveBaseUrl(providerType: AssetProviderType): string | undefined {
  const url = getConfig(`asset:${providerType}:base_url`);
  if (url) return url;

  // Reuse from providers table
  try {
    const db = getDb();
    const rows = db.select().from(schema.providers).all();
    for (const row of rows) {
      if (row.type === providerType && row.baseUrl) {
        return row.baseUrl;
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the configured image generation provider (falls back to procedural). */
export function getImageProvider(): ImageGenProvider {
  const providerType = (getConfig(CONFIG_IMAGE_PROVIDER) ?? "procedural") as AssetProviderType;

  switch (providerType) {
    case "openai": {
      const apiKey = resolveApiKey("openai");
      if (!apiKey) {
        console.warn("[asset-adapter] OpenAI image provider configured but no API key found, falling back to procedural");
        return proceduralImage;
      }
      return new OpenAIImageProvider(apiKey);
    }
    case "replicate": {
      const apiKey = resolveApiKey("replicate");
      if (!apiKey) {
        console.warn("[asset-adapter] Replicate provider configured but no API key found, falling back to procedural");
        return proceduralImage;
      }
      return new ReplicateImageProvider(apiKey);
    }
    case "stable-diffusion": {
      const baseUrl = resolveBaseUrl("stable-diffusion");
      return new StableDiffusionImageProvider(baseUrl);
    }
    case "procedural":
    default:
      return proceduralImage;
  }
}

/** Get the configured 3D model generation provider (falls back to procedural). */
export function getModelProvider(): ModelGenProvider {
  const providerType = (getConfig(CONFIG_MODEL_PROVIDER) ?? "procedural") as AssetProviderType;

  switch (providerType) {
    // Future: Replicate 3D model generation (e.g., TripoSR, InstantMesh)
    case "procedural":
    default:
      return proceduralModel;
  }
}

/** Get the configured sound generation provider (falls back to procedural). */
export function getSoundProvider(): SoundGenProvider {
  const providerType = (getConfig(CONFIG_SOUND_PROVIDER) ?? "procedural") as AssetProviderType;

  switch (providerType) {
    case "replicate": {
      const apiKey = resolveApiKey("replicate");
      if (!apiKey) {
        console.warn("[asset-adapter] Replicate sound provider configured but no API key found, falling back to procedural");
        return proceduralSound;
      }
      const musicModel = getConfig("asset:replicate:sound_model") ?? undefined;
      return new ReplicateSoundProvider(apiKey, musicModel, musicModel);
    }
    case "procedural":
    default:
      return proceduralSound;
  }
}

/** Get the currently configured provider type for each asset category. */
export function getAssetProviderConfig(): {
  image: AssetProviderType;
  model: AssetProviderType;
  sound: AssetProviderType;
} {
  return {
    image: (getConfig(CONFIG_IMAGE_PROVIDER) ?? "procedural") as AssetProviderType,
    model: (getConfig(CONFIG_MODEL_PROVIDER) ?? "procedural") as AssetProviderType,
    sound: (getConfig(CONFIG_SOUND_PROVIDER) ?? "procedural") as AssetProviderType,
  };
}
