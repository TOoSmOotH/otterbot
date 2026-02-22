/**
 * OpenCode config manager — writes the `opencode.json` config file
 * that `opencode run` reads at startup.
 *
 * The PTY client calls `ensureOpenCodeConfig()` before spawning to make
 * sure the config reflects the current provider/model/permission settings.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../auth/auth.js";
import { getProviderRow } from "../settings/settings.js";

// ---------------------------------------------------------------------------
// Provider type mapping: Otterbot provider type -> OpenCode provider ID
// ---------------------------------------------------------------------------

const PROVIDER_TYPE_MAP: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  ollama: "ollama",
  openrouter: "openrouter",
  "openai-compatible": "custom",
};

/** Provider types that need the @ai-sdk/openai-compatible npm adapter in OpenCode */
const NEEDS_COMPAT_ADAPTER = new Set(["ollama", "openai-compatible"]);

// ---------------------------------------------------------------------------
// Config writer
// ---------------------------------------------------------------------------

export interface OpenCodeConfigOptions {
  providerType: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  interactive?: boolean;
}

export function writeOpenCodeConfig(opts: OpenCodeConfigOptions): void {
  const configDir = join(homedir(), ".config", "opencode");
  mkdirSync(configDir, { recursive: true });

  let openCodeProvider = PROVIDER_TYPE_MAP[opts.providerType] ?? "custom";

  // If "openai" provider has a custom base URL, it's actually openai-compatible
  // and needs the compat adapter to avoid model validation against OpenAI's list
  if (openCodeProvider === "openai" && opts.baseUrl) {
    openCodeProvider = "custom";
  }

  // Build provider options — use env var reference to avoid writing raw keys to disk
  const providerOptions: Record<string, unknown> = {};
  if (opts.apiKey) {
    providerOptions.apiKey = "{env:OPENCODE_PROVIDER_API_KEY}";
  }
  if (opts.baseUrl) {
    providerOptions.baseURL = opts.baseUrl;
  }

  const providerEntry: Record<string, unknown> = {
    options: providerOptions,
  };

  // Use the openai-compatible SDK adapter for ollama, openai-compatible,
  // and any provider with a custom base URL
  const needsCompat = NEEDS_COMPAT_ADAPTER.has(opts.providerType) || opts.baseUrl;
  if (needsCompat) {
    providerEntry.npm = "@ai-sdk/openai-compatible";
    // Custom/compat providers must explicitly register their models
    providerEntry.models = { [opts.model]: {} };
  }

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [openCodeProvider]: providerEntry,
    },
    model: `${openCodeProvider}/${opts.model}`,
    // When interactive mode is on, require permission for tool use; otherwise auto-approve
    permission: opts.interactive ? "ask" : "allow",
  };

  writeFileSync(
    join(configDir, "opencode.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );

  console.log(`[OpenCode] Config written to ${join(configDir, "opencode.json")}`);
}

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the provider info for OpenCode. Tries:
 *  1. Explicit `opencode:provider_id` (set by wizard)
 *  2. Fallback to COO provider (for pre-wizard setups)
 */
export function resolveProviderInfo(): {
  apiKey: string | undefined;
  providerType: string | undefined;
  baseUrl: string | undefined;
} {
  // Try explicit OpenCode provider first
  const providerId = getConfig("opencode:provider_id");
  if (providerId) {
    const row = getProviderRow(providerId);
    if (row) {
      return {
        apiKey: row.apiKey ?? undefined,
        providerType: row.type,
        baseUrl: row.baseUrl ?? undefined,
      };
    }
  }

  // Fall back to COO provider
  const cooProviderId = getConfig("coo_provider");
  if (cooProviderId) {
    const row = getProviderRow(cooProviderId);
    if (row) {
      return {
        apiKey: row.apiKey ?? undefined,
        providerType: row.type,
        baseUrl: row.baseUrl ?? undefined,
      };
    }
  }

  return { apiKey: undefined, providerType: undefined, baseUrl: undefined };
}

// ---------------------------------------------------------------------------
// Config ensurer (called by PTY client before each spawn)
// ---------------------------------------------------------------------------

/**
 * Ensure the OpenCode config file is up-to-date.
 * Reads current settings and writes `~/.config/opencode/opencode.json`.
 * Returns true if config was successfully written.
 */
export function ensureOpenCodeConfig(): boolean {
  const model = getConfig("opencode:model") ?? getConfig("coo_model");
  if (!model) {
    console.warn("[OpenCode] No model configured — cannot write config file.");
    return false;
  }

  const { apiKey, providerType, baseUrl } = resolveProviderInfo();
  const effectiveProviderType = getConfig("opencode:provider_type") ?? providerType ?? "anthropic";

  const interactive = getConfig("opencode:interactive") === "true";
  writeOpenCodeConfig({
    providerType: effectiveProviderType,
    model,
    apiKey,
    baseUrl,
    interactive,
  });

  return true;
}
