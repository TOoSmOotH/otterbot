/**
 * Studio configuration service — reads/writes per-studio config from the config table.
 *
 * Uses namespaced keys: studio:<scope>:<category>:<key>
 * Merge cascade: studio-specific → studio-global → system default
 */

import { getConfig, setConfig, deleteConfig } from "../auth/auth.js";
import type {
  StudioType,
  StudioConfig,
  StudioConfigBundle,
  ResolvedStudioConfig,
} from "@otterbot/shared";

type Scope = "global" | StudioType;

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function key(scope: Scope, ...parts: string[]): string {
  return `studio:${scope}:${parts.join(":")}`;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function readScope(scope: Scope): StudioConfig {
  const cfg: StudioConfig = {};

  const llmProvider = getConfig(key(scope, "llm", "provider"));
  const llmModel = getConfig(key(scope, "llm", "model"));
  if (llmProvider || llmModel) {
    cfg.llm = {};
    if (llmProvider) cfg.llm.provider = llmProvider;
    if (llmModel) cfg.llm.model = llmModel;
  }

  const disabledRaw = getConfig(key(scope, "tools", "disabled"));
  if (disabledRaw) {
    try {
      cfg.tools = { disabled: JSON.parse(disabledRaw) };
    } catch {
      // ignore invalid JSON
    }
  }

  const assetImage = getConfig(key(scope, "asset", "image"));
  const assetModel = getConfig(key(scope, "asset", "model"));
  const assetSound = getConfig(key(scope, "asset", "sound"));
  if (assetImage || assetModel || assetSound) {
    cfg.asset = {};
    if (assetImage) cfg.asset.image = assetImage;
    if (assetModel) cfg.asset.model = assetModel;
    if (assetSound) cfg.asset.sound = assetSound;
  }

  return cfg;
}

/** Get the full studio configuration bundle (global + all studio types). */
export function getStudioConfigBundle(): StudioConfigBundle {
  return {
    global: readScope("global"),
    game: readScope("game"),
    video: readScope("video"),
    app: readScope("app"),
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function writeOrDelete(k: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    setConfig(k, value);
  } else {
    deleteConfig(k);
  }
}

/** Update studio config for a given scope. Only provided fields are updated. */
export function setStudioConfig(scope: Scope, cfg: StudioConfig): void {
  if (cfg.llm) {
    if (cfg.llm.provider !== undefined) writeOrDelete(key(scope, "llm", "provider"), cfg.llm.provider);
    if (cfg.llm.model !== undefined) writeOrDelete(key(scope, "llm", "model"), cfg.llm.model);
  }

  if (cfg.tools) {
    if (cfg.tools.disabled !== undefined) {
      if (cfg.tools.disabled.length > 0) {
        setConfig(key(scope, "tools", "disabled"), JSON.stringify(cfg.tools.disabled));
      } else {
        deleteConfig(key(scope, "tools", "disabled"));
      }
    }
  }

  if (cfg.asset) {
    if (cfg.asset.image !== undefined) writeOrDelete(key(scope, "asset", "image"), cfg.asset.image);
    if (cfg.asset.model !== undefined) writeOrDelete(key(scope, "asset", "model"), cfg.asset.model);
    if (cfg.asset.sound !== undefined) writeOrDelete(key(scope, "asset", "sound"), cfg.asset.sound);
  }
}

/** Clear all config keys for a given scope. */
export function clearStudioConfig(scope: Scope): void {
  const keys = [
    key(scope, "llm", "provider"),
    key(scope, "llm", "model"),
    key(scope, "tools", "disabled"),
    key(scope, "asset", "image"),
    key(scope, "asset", "model"),
    key(scope, "asset", "sound"),
  ];
  for (const k of keys) {
    deleteConfig(k);
  }
}

// ---------------------------------------------------------------------------
// Resolve (merge cascade)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective studio config for a given studio type.
 * Merge order: studio-specific → global → system defaults.
 */
export function resolveStudioConfig(studioType: StudioType): ResolvedStudioConfig {
  const global = readScope("global");
  const specific = readScope(studioType);

  // System defaults from existing config keys
  const systemProvider = getConfig("worker_provider") ?? "";
  const systemModel = getConfig("worker_model") ?? "";
  const systemAssetImage = getConfig("asset:image:provider") ?? "procedural";
  const systemAssetModel = getConfig("asset:model:provider") ?? "procedural";
  const systemAssetSound = getConfig("asset:sound:provider") ?? "procedural";

  const globalDisabled = global.tools?.disabled ?? [];
  const specificDisabled = specific.tools?.disabled ?? [];

  return {
    llm: {
      provider: specific.llm?.provider ?? global.llm?.provider ?? systemProvider,
      model: specific.llm?.model ?? global.llm?.model ?? systemModel,
    },
    disabledTools: [...new Set([...globalDisabled, ...specificDisabled])],
    asset: {
      image: specific.asset?.image ?? global.asset?.image ?? systemAssetImage,
      model: specific.asset?.model ?? global.asset?.model ?? systemAssetModel,
      sound: specific.asset?.sound ?? global.asset?.sound ?? systemAssetSound,
    },
  };
}
