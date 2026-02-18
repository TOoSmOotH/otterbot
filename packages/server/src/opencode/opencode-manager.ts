/**
 * OpenCode process manager — writes config and manages the `opencode serve` child process.
 *
 * Two modes:
 *  - **Managed mode**: We write the config file and spawn/manage the process.
 *    Indicated by `opencode:api_url` pointing to 127.0.0.1 (local).
 *  - **External mode**: The user runs `opencode serve` themselves (remote URL).
 *    We don't touch the process.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig, setConfig } from "../auth/auth.js";
import { getProviderRow } from "../settings/settings.js";
import { nanoid } from "nanoid";

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
    server: {
      port: 4096,
      hostname: "127.0.0.1",
    },
  };

  writeFileSync(
    join(configDir, "opencode.json"),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );

  console.log(`[OpenCode] Config written to ${join(configDir, "opencode.json")}`);
}

// ---------------------------------------------------------------------------
// Process manager
// ---------------------------------------------------------------------------

let openCodeProcess: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2000;

/**
 * Resolve the API key for OpenCode. Tries:
 *  1. Explicit `opencode:provider_id` (set by wizard)
 *  2. Fallback to COO provider (for pre-wizard setups)
 */
function resolveProviderInfo(): {
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

/** Check if we should manage the OpenCode process (local URL) vs external mode */
function isManagedMode(): boolean {
  const apiUrl = getConfig("opencode:api_url") ?? "";
  // Managed if URL points to localhost/127.0.0.1 or isn't set yet (we'll set it)
  return !apiUrl || apiUrl.includes("127.0.0.1") || apiUrl.includes("localhost");
}

/**
 * Ensure the OpenCode config file and auth credentials exist.
 * Auto-generates them from stored settings or COO provider if missing.
 */
function ensureConfigAndCredentials(): boolean {
  // Ensure auth credentials exist
  if (!getConfig("opencode:username")) {
    const username = nanoid(32);
    const password = nanoid(32);
    setConfig("opencode:username", username);
    setConfig("opencode:password", password);
    console.log("[OpenCode] Auto-generated auth credentials.");
  }

  // Ensure api_url is set
  if (!getConfig("opencode:api_url")) {
    setConfig("opencode:api_url", "http://127.0.0.1:4096");
  }

  // Always (re)write config file to pick up provider/model changes and fixes
  const model = getConfig("opencode:model") ?? getConfig("coo_model");
  if (!model) {
    console.warn("[OpenCode] No model configured — cannot write config file.");
    return false;
  }

  const { apiKey, providerType, baseUrl } = resolveProviderInfo();
  const effectiveProviderType = getConfig("opencode:provider_type") ?? providerType ?? "anthropic";

  writeOpenCodeConfig({
    providerType: effectiveProviderType,
    model,
    apiKey,
    baseUrl,
  });

  return true;
}

export function startOpenCodeServer(): void {
  if (getConfig("opencode:enabled") !== "true") {
    console.log("[OpenCode] Not enabled — skipping server start.");
    return;
  }

  if (!isManagedMode()) {
    console.log("[OpenCode] External mode (remote URL) — not managing process.");
    return;
  }

  if (openCodeProcess && !openCodeProcess.killed) {
    console.log("[OpenCode] Server already running (pid=%d).", openCodeProcess.pid);
    return;
  }

  // Ensure config file and credentials exist before spawning
  if (!ensureConfigAndCredentials()) {
    console.error("[OpenCode] Cannot start — missing config. Configure via Settings or re-run setup wizard.");
    return;
  }

  const username = getConfig("opencode:username") ?? "";
  const password = getConfig("opencode:password") ?? "";
  const { apiKey } = resolveProviderInfo();

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_PROVIDER_API_KEY: apiKey ?? "",
  };

  console.log("[OpenCode] Starting `opencode serve`...");

  const child = spawn("opencode", ["serve"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  openCodeProcess = child;
  restartAttempts = 0;

  child.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[OpenCode stdout] ${line}`);
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.error(`[OpenCode stderr] ${line}`);
  });

  child.on("exit", (code, signal) => {
    console.warn(`[OpenCode] Process exited (code=${code}, signal=${signal}).`);
    openCodeProcess = null;

    // Auto-restart with backoff if it wasn't intentionally stopped
    if (getConfig("opencode:enabled") === "true" && !signal) {
      scheduleRestart();
    }
  });

  child.on("error", (err) => {
    console.error("[OpenCode] Failed to spawn process:", err.message);
    openCodeProcess = null;
  });
}

function scheduleRestart(): void {
  if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
    console.error(
      `[OpenCode] Reached max restart attempts (${MAX_RESTART_ATTEMPTS}). Giving up.`,
    );
    return;
  }

  restartAttempts++;
  const delay = BASE_BACKOFF_MS * Math.pow(2, restartAttempts - 1);
  console.log(
    `[OpenCode] Scheduling restart attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${delay}ms...`,
  );

  restartTimer = setTimeout(() => {
    restartTimer = null;
    startOpenCodeServer();
  }, delay);
}

export function stopOpenCodeServer(): void {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (!openCodeProcess) {
    return;
  }

  console.log("[OpenCode] Stopping server (pid=%d)...", openCodeProcess.pid);

  try {
    openCodeProcess.kill("SIGTERM");
  } catch {
    // Process may have already exited
  }

  openCodeProcess = null;
}

export function isOpenCodeRunning(): boolean {
  return openCodeProcess !== null && !openCodeProcess.killed;
}
