/**
 * Codex CLI manager — checks availability and health.
 *
 * Like Claude Code, Codex runs as a one-shot CLI invocation per task.
 * No background server is needed.
 */

import { execSync } from "node:child_process";
import { getConfig } from "../auth/auth.js";

/**
 * Check if the Codex CLI is installed and accessible.
 */
export function isCodexInstalled(): boolean {
  try {
    execSync("codex --version", { encoding: "utf-8", timeout: 10_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Health check for Codex availability.
 */
export function isCodexReady(): boolean {
  if (!isCodexInstalled()) return false;

  const authMode = getConfig("codex:auth_mode") ?? "api-key";
  if (authMode === "api-key") {
    return !!getConfig("codex:api_key");
  }

  // OAuth mode — assume ready if CLI is installed
  return true;
}
