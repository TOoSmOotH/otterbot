import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { opencodeConfigHostPath } from "./shell.js";

/**
 * Generate the OpenCode config that registers Otterbot's configured providers
 * with opencode, so a coding-model preset like `lmstudio/qwen3-coder-30b` or
 * `opencode-go/glm-5.1` resolves. Each becomes an `@ai-sdk/openai-compatible`
 * provider pointed at the configured endpoint; opencode live-fetches each
 * provider's `/v1/models`, so we declare only the provider, not its models.
 *
 * opencode reads this file via `OPENCODE_CONFIG` (set for opencode runs), so no
 * `opencode auth login` is needed — auth flows from the provider's API key here.
 */

/** One configured provider, resolved to its OpenAI-compatible endpoint. */
export interface OpencodeProviderEntry {
  /** Otterbot provider id — also the opencode provider id and preset prefix. */
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
}

export interface OpencodeConfig {
  $schema: string;
  provider: Record<
    string,
    { npm: string; name: string; options: { baseURL: string; apiKey: string } }
  >;
}

/**
 * Build the opencode config object from resolved provider entries. Entries
 * without a base URL are skipped; a missing key is replaced with a placeholder
 * since opencode's openai-compatible provider expects a non-empty apiKey string
 * (local servers ignore it).
 */
export function buildOpencodeConfig(entries: OpencodeProviderEntry[]): OpencodeConfig {
  const provider: OpencodeConfig["provider"] = {};
  for (const e of entries) {
    if (!e.baseUrl) continue;
    provider[e.id] = {
      npm: "@ai-sdk/openai-compatible",
      name: e.label,
      options: { baseURL: e.baseUrl, apiKey: e.apiKey || "otterbot" },
    };
  }
  return { $schema: "https://opencode.ai/config.json", provider };
}

/** Write the generated config to its host path (bound into every sandbox). */
export function writeOpencodeConfig(entries: OpencodeProviderEntry[]): void {
  const path = opencodeConfigHostPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(buildOpencodeConfig(entries), null, 2));
}
