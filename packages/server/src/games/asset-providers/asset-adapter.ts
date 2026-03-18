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
import type {
  AssetProviderType,
  ImageGenProvider,
  ModelGenProvider,
  SoundGenProvider,
} from "./types.js";
import type { StudioType } from "@otterbot/shared";
import { resolveStudioConfig } from "../../studios/studio-config-service.js";
import { ProceduralImageProvider } from "./procedural-image-provider.js";
import { ProceduralModelProvider } from "./procedural-model-provider.js";
import { ProceduralSoundProvider } from "./procedural-sound-provider.js";
import { OpenAIImageProvider } from "./openai-image-provider.js";
import { ReplicateImageProvider } from "./replicate-image-provider.js";
import { ReplicateSoundProvider } from "./replicate-sound-provider.js";
import { StableDiffusionImageProvider } from "./sd-image-provider.js";

export interface AssetProviderCredentialStatus {
  type: AssetProviderType;
  dedicatedApiKeySet: boolean;
  dedicatedBaseUrlSet: boolean;
  providerApiKeySet: boolean;
  providerBaseUrlSet: boolean;
  apiKeyReady: boolean;
  baseUrlReady: boolean;
}

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

function getProviderTableCredentialStatus(providerType: AssetProviderType): {
  apiKeySet: boolean;
  baseUrlSet: boolean;
} {
  try {
    const db = getDb();
    const rows = db.select().from(schema.providers).all();
    const row = rows.find((candidate) => candidate.type === providerType);
    return {
      apiKeySet: !!row?.apiKey,
      baseUrlSet: !!row?.baseUrl,
    };
  } catch {
    return {
      apiKeySet: false,
      baseUrlSet: false,
    };
  }
}

// ---------------------------------------------------------------------------
// Studio config helper
// ---------------------------------------------------------------------------

/** Resolve the effective asset provider type, checking studio overrides first. */
function resolveAssetProviderType(
  configKey: string,
  assetCategory: "image" | "model" | "sound",
  studioType?: StudioType,
): AssetProviderType {
  if (studioType) {
    try {
      const resolved = resolveStudioConfig(studioType);
      const override = resolved.asset[assetCategory];
      if (override && override !== "") return override as AssetProviderType;
    } catch {
      // studio config not available — fall through
    }
  }
  return (getConfig(configKey) ?? "procedural") as AssetProviderType;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get the configured image generation provider (falls back to procedural). */
export function getImageProvider(studioType?: StudioType): ImageGenProvider {
  const providerType = resolveAssetProviderType(CONFIG_IMAGE_PROVIDER, "image", studioType);

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
export function getModelProvider(studioType?: StudioType): ModelGenProvider {
  const providerType = resolveAssetProviderType(CONFIG_MODEL_PROVIDER, "model", studioType);

  switch (providerType) {
    // Future: Replicate 3D model generation (e.g., TripoSR, InstantMesh)
    case "procedural":
    default:
      return proceduralModel;
  }
}

/** Get the configured sound generation provider (falls back to procedural). */
export function getSoundProvider(studioType?: StudioType): SoundGenProvider {
  const providerType = resolveAssetProviderType(CONFIG_SOUND_PROVIDER, "sound", studioType);

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

export function getAssetProviderCredentialStatuses(): Record<AssetProviderType, AssetProviderCredentialStatus> {
  const providerTypes: AssetProviderType[] = [
    "openai",
    "replicate",
    "stable-diffusion",
    "procedural",
  ];

  return Object.fromEntries(providerTypes.map((providerType) => {
    const providerTableStatus = getProviderTableCredentialStatus(providerType);
    const dedicatedApiKeySet = !!getConfig(`asset:${providerType}:api_key`);
    const dedicatedBaseUrlSet = !!getConfig(`asset:${providerType}:base_url`);

    return [providerType, {
      type: providerType,
      dedicatedApiKeySet,
      dedicatedBaseUrlSet,
      providerApiKeySet: providerTableStatus.apiKeySet,
      providerBaseUrlSet: providerTableStatus.baseUrlSet,
      apiKeyReady: dedicatedApiKeySet || providerTableStatus.apiKeySet,
      baseUrlReady: dedicatedBaseUrlSet || providerTableStatus.baseUrlSet,
    }];
  })) as Record<AssetProviderType, AssetProviderCredentialStatus>;
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
