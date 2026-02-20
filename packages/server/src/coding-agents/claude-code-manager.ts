/**
 * Claude Code manager — checks availability and health.
 *
 * Unlike OpenCode, Claude Code doesn't need a background server.
 * It runs as a one-shot CLI invocation per task.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getConfig } from "../auth/auth.js";

/**
 * Check if the Claude Code CLI is installed and accessible.
 */
export function isClaudeCodeInstalled(): boolean {
  try {
    execSync("claude --version", { encoding: "utf-8", timeout: 10_000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Claude Code OAuth session exists (for OAuth auth mode).
 */
export function hasClaudeCodeOAuthSession(): boolean {
  const claudeDir = join(homedir(), ".claude");
  return existsSync(claudeDir);
}

/**
 * Health check for Claude Code availability.
 */
export function isClaudeCodeReady(): boolean {
  if (!isClaudeCodeInstalled()) return false;

  const authMode = getConfig("claude-code:auth_mode") ?? "api-key";
  if (authMode === "api-key") {
    return !!getConfig("claude-code:api_key");
  }

  // OAuth mode — check for session directory
  return hasClaudeCodeOAuthSession();
}
