/**
 * OpenCode process manager — writes config and manages the `opencode serve` child process.
 */

import { spawn, type ChildProcess } from "node:child_process";
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
  "openai-compatible": "openai",
};

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

  const openCodeProvider = PROVIDER_TYPE_MAP[opts.providerType] ?? "openai";

  // Build provider config — use env var reference to avoid writing raw keys to disk
  const providerConfig: Record<string, unknown> = {};
  if (opts.apiKey) {
    providerConfig.apiKey = "{env:OPENCODE_PROVIDER_API_KEY}";
  }
  if (opts.baseUrl) {
    providerConfig.baseUrl = opts.baseUrl;
  }

  const config = {
    provider: {
      [openCodeProvider]: providerConfig,
    },
    model: {
      default: `${openCodeProvider}/${opts.model}`,
    },
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

function resolveApiKey(): string | undefined {
  const providerId = getConfig("opencode:provider_id");
  if (!providerId) return undefined;
  const row = getProviderRow(providerId);
  return row?.apiKey ?? undefined;
}

export function startOpenCodeServer(): void {
  if (getConfig("opencode:enabled") !== "true") {
    console.log("[OpenCode] Not enabled — skipping server start.");
    return;
  }

  if (openCodeProcess && !openCodeProcess.killed) {
    console.log("[OpenCode] Server already running (pid=%d).", openCodeProcess.pid);
    return;
  }

  const username = getConfig("opencode:username") ?? "";
  const password = getConfig("opencode:password") ?? "";
  const apiKey = resolveApiKey() ?? "";

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_PROVIDER_API_KEY: apiKey,
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
