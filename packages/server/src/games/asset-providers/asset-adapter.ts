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
import { TrellisLocalModelProvider } from "./trellis-model-provider.js";
import { getLocalComputeStatus } from "../../local-compute/local-compute.js";
import {
  ComfyUIImageProvider,
  getComfyUiHealthStatus,
  listComfyPresets,
  listManagedComfyModels,
} from "./comfyui.js";

export interface AssetProviderCredentialStatus {
  type: AssetProviderType;
  dedicatedApiKeySet: boolean;
  dedicatedBaseUrlSet: boolean;
  providerApiKeySet: boolean;
  providerBaseUrlSet: boolean;
  apiKeyReady: boolean;
  baseUrlReady: boolean;
}

export interface AssetProviderHealthStatus {
  type: AssetProviderType;
  ready: boolean;
  status: "ready" | "needs-config" | "offline" | "fallback";
  message: string;
}

export interface ComfyUiSettingsSummary {
  baseUrl: string;
  sidecarUrl: string;
  health: Awaited<ReturnType<typeof getComfyUiHealthStatus>>;
  presets: ReturnType<typeof listComfyPresets>;
  models: ReturnType<typeof listManagedComfyModels>;
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

function resolveComfyBaseUrl(): string {
  return resolveBaseUrl("comfyui-local")
    ?? process.env.OTTERBOT_COMFYUI_URL
    ?? "http://comfyui:8188";
}

function resolveTrellisBaseUrl(): string {
  return resolveBaseUrl("trellis-local")
    ?? process.env.OTTERBOT_TRELLIS_URL
    ?? "http://trellis:8080";
}

async function checkEndpoint(baseUrl: string, path = "/"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
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
    case "comfyui-local": {
      const baseUrl = resolveComfyBaseUrl();
      const checkpoint = getConfig("asset:comfyui-local:checkpoint") ?? undefined;
      return new ComfyUIImageProvider(baseUrl, checkpoint);
    }
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
      const baseUrl = resolveBaseUrl("stable-diffusion") ?? resolveComfyBaseUrl();
      const checkpoint = getConfig("asset:comfyui-local:checkpoint") ?? undefined;
      return new ComfyUIImageProvider(baseUrl, checkpoint);
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
    case "trellis-local": {
      const baseUrl = resolveTrellisBaseUrl();
      return new TrellisLocalModelProvider(baseUrl);
    }
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
    "comfyui-local",
    "openai",
    "replicate",
    "trellis-local",
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

export async function getAssetProviderHealthStatuses(): Promise<Record<AssetProviderType, AssetProviderHealthStatus>> {
  const localCompute = getLocalComputeStatus();
  const credentials = getAssetProviderCredentialStatuses();

  const statuses: Record<AssetProviderType, AssetProviderHealthStatus> = {
    "comfyui-local": {
      type: "comfyui-local",
      ready: false,
      status: "needs-config",
      message: "Set a ComfyUI sidecar base URL to enable local image generation.",
    },
    openai: {
      type: "openai",
      ready: credentials.openai.apiKeyReady,
      status: credentials.openai.apiKeyReady ? "ready" : "needs-config",
      message: credentials.openai.apiKeyReady ? "Ready for cloud image generation." : "Requires an OpenAI API key.",
    },
    replicate: {
      type: "replicate",
      ready: credentials.replicate.apiKeyReady,
      status: credentials.replicate.apiKeyReady ? "ready" : "needs-config",
      message: credentials.replicate.apiKeyReady ? "Ready for cloud image, 3D, and sound generation." : "Requires a Replicate API key.",
    },
    "trellis-local": {
      type: "trellis-local",
      ready: false,
      status: localCompute.tier === "high" ? "needs-config" : "fallback",
      message: localCompute.tier === "high"
        ? "Set a local TRELLIS bridge URL to enable experimental 3D generation."
        : `Experimental TRELLIS is best on high-VRAM GPUs; current tier is ${localCompute.tier}.`,
    },
    "stable-diffusion": {
      type: "stable-diffusion",
      ready: credentials["stable-diffusion"].baseUrlReady,
      status: credentials["stable-diffusion"].baseUrlReady ? "ready" : "needs-config",
      message: credentials["stable-diffusion"].baseUrlReady ? "Legacy local image alias configured." : "Set a legacy Stable Diffusion-compatible base URL or use the ComfyUI sidecar.",
    },
    procedural: {
      type: "procedural",
      ready: true,
      status: "ready",
      message: "Always available fallback for CPU-safe local generation.",
    },
  };

  const comfyUrl = resolveComfyBaseUrl();
  if (comfyUrl) {
    const health = await getComfyUiHealthStatus(comfyUrl);
    const hasCheckpoint = health.checkpoints.length > 0 || listManagedComfyModels().some((record) => record.status === "installed" && record.modelType === "checkpoints");
    statuses["comfyui-local"] = {
      type: "comfyui-local",
      ready: health.reachable && hasCheckpoint,
      status: !health.reachable
        ? "offline"
        : hasCheckpoint
          ? "ready"
          : "needs-config",
      message: !health.reachable
        ? health.message
        : hasCheckpoint
          ? health.message
          : `${health.message} Install at least one checkpoint before selecting ComfyUI for generation.`,
    };
  }

  const trellisUrl = resolveTrellisBaseUrl();
  if (trellisUrl) {
    const healthy = await checkEndpoint(trellisUrl, "/health");
    statuses["trellis-local"] = {
      type: "trellis-local",
      ready: healthy && localCompute.tier === "high",
      status: healthy
        ? (localCompute.tier === "high" ? "ready" : "fallback")
        : "offline",
      message: !healthy
        ? `Configured TRELLIS image-to-3D bridge at ${trellisUrl}, but it is not reachable.`
        : localCompute.tier === "high"
          ? `Experimental TRELLIS bridge reachable at ${trellisUrl} for text-to-3D and image-to-3D jobs.`
          : `TRELLIS bridge is reachable, but current compute tier is ${localCompute.tier}; Otterbot may fall back to procedural 3D.`,
    };
  }

  return statuses;
}

export async function getComfyUiSettingsSummary(): Promise<ComfyUiSettingsSummary> {
  const baseUrl = resolveComfyBaseUrl();
  return {
    baseUrl,
    sidecarUrl: process.env.OTTERBOT_COMFYUI_URL ?? "http://comfyui:8188",
    health: await getComfyUiHealthStatus(baseUrl),
    presets: listComfyPresets(),
    models: listManagedComfyModels(),
  };
}

export function getAssetGenerationRecommendations() {
  const localCompute = getLocalComputeStatus();

  switch (localCompute.tier) {
    case "high":
      return {
        image: "comfyui-local" as AssetProviderType,
        model: "trellis-local" as AssetProviderType,
        sound: "procedural" as AssetProviderType,
        summary: "High-VRAM local stack: ComfyUI for images, experimental TRELLIS for 3D, procedural audio.",
      };
    case "medium":
    case "low":
      return {
        image: "comfyui-local" as AssetProviderType,
        model: "procedural" as AssetProviderType,
        sound: "procedural" as AssetProviderType,
        summary: "Balanced local stack: ComfyUI for images, procedural 3D and audio.",
      };
    case "cpu":
    default:
      return {
        image: "procedural" as AssetProviderType,
        model: "procedural" as AssetProviderType,
        sound: "procedural" as AssetProviderType,
        summary: "CPU-safe local stack: procedural generation first, with optional local endpoints if you accept slower performance.",
      };
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
