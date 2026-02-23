/**
 * Gemini CLI manager — checks availability and health.
 *
 * Gemini CLI runs as a one-shot CLI invocation per task.
 * No background server is needed.
 */

import { execSync } from "node:child_process";
import { getConfig } from "../auth/auth.js";

/**
 * Check if the Gemini CLI is installed and accessible.
 */
export function isGeminiCliInstalled(): boolean {
  try {
    execSync("gemini --version", { encoding: "utf-8", timeout: 10_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Health check for Gemini CLI availability.
 */
export function isGeminiCliReady(): boolean {
  if (!isGeminiCliInstalled()) return false;
  return !!getConfig("gemini-cli:api_key");
}
