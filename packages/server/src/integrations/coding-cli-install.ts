import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sharedCodingAuthDir, sharedCodingToolsDir } from "./shell.js";
import { CODING_TOOLS, withCodingLock, type CodingTool } from "./coding-cli.js";

/**
 * Install + detect the coding CLIs (Claude Code, Codex, Gemini CLI, OpenCode)
 * ONCE for all agents. Binaries install into a single shared host dir
 * (`<data>/coding-tools`, an npm prefix) that every sandbox mounts read-only via
 * a tmp-overlay; logins live in a single shared store (`<data>/coding-cli-auth`)
 * bound into every sandbox HOME. So the user installs and logs in a single time,
 * not per agent. Install + detection run host-side (these are shared infra ops,
 * not per-agent sandboxed work); see `shell.ts` for how the mounts are wired.
 */

export interface CodingCliSpec {
  /** Human-readable name for the UI. */
  label: string;
  /** Binary name (under the shared tools `bin/`). */
  bin: string;
  /** npm package; installed as `<pkg>@latest` so installs pull the newest. */
  pkg: string;
  /** The (interactive) login the user runs once from an agent's terminal. */
  loginCmd: string;
  /** Login credential file, relative to the shared auth store (best-effort). */
  authFile: string;
}

export const CODING_CLI_SPECS: Record<CodingTool, CodingCliSpec> = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    pkg: "@anthropic-ai/claude-code",
    loginCmd: "claude",
    authFile: "claude/.credentials.json",
  },
  codex: {
    label: "Codex",
    bin: "codex",
    pkg: "@openai/codex",
    loginCmd: "codex login",
    authFile: "codex/auth.json",
  },
  gemini: {
    label: "Gemini CLI",
    bin: "gemini",
    pkg: "@google/gemini-cli",
    loginCmd: "gemini",
    authFile: "gemini/oauth_creds.json",
  },
  opencode: {
    label: "OpenCode",
    bin: "opencode",
    pkg: "opencode-ai",
    loginCmd: "opencode auth login",
    authFile: "opencode/auth.json",
  },
};

export interface CodingCliStatus {
  installed: boolean;
  /** First line of `<bin> --version`, when installed. */
  version?: string;
  /** Whether a logged-in credential file was found in the shared store. */
  loggedIn: boolean;
}

/** Probe the shared install + shared login store for every tool. Host-side. */
export function checkSharedCodingClis(): Record<CodingTool, CodingCliStatus> {
  const toolsBin = join(sharedCodingToolsDir(), "bin");
  const authRoot = sharedCodingAuthDir();
  const status = {} as Record<CodingTool, CodingCliStatus>;
  for (const tool of CODING_TOOLS) {
    const spec = CODING_CLI_SPECS[tool];
    const binPath = join(toolsBin, spec.bin);
    const installed = existsSync(binPath);
    let version: string | undefined;
    if (installed) {
      try {
        const r = spawnSync(binPath, ["--version"], { timeout: 10_000, encoding: "utf8" });
        version = (r.stdout || "").split("\n")[0]?.trim() || undefined;
      } catch {
        /* version is best-effort */
      }
    }
    status[tool] = {
      installed,
      ...(version ? { version } : {}),
      loggedIn: existsSync(join(authRoot, spec.authFile)),
    };
  }
  return status;
}

export interface CodingCliInstallResult {
  ok: boolean;
  /** Trimmed install output, for display. */
  output: string;
  error?: string;
}

/**
 * Install (or update to latest) one coding CLI into the shared tools dir, for
 * every agent at once. Serialized so two `npm i -g` runs can't corrupt the
 * shared prefix.
 */
export function installSharedCodingCli(tool: CodingTool): Promise<CodingCliInstallResult> {
  const spec = CODING_CLI_SPECS[tool];
  const prefix = sharedCodingToolsDir();
  return withCodingLock("shared-coding-install", async () => {
    try {
      mkdirSync(prefix, { recursive: true });
    } catch {
      /* the install below will surface a real problem */
    }
    return new Promise<CodingCliInstallResult>((resolve) => {
      const child = spawn("npm", ["install", "-g", `${spec.pkg}@latest`], {
        env: { ...process.env, npm_config_prefix: prefix },
      });
      let out = "";
      const cap = (c: Buffer) => {
        if (out.length < 1_000_000) out += c.toString("utf8");
      };
      child.stdout?.on("data", cap);
      child.stderr?.on("data", cap);
      child.on("error", (err) =>
        resolve({ ok: false, output: out.trim(), error: `failed to run npm: ${err.message}` })
      );
      child.on("close", (code) =>
        resolve(
          code === 0
            ? { ok: true, output: out.trim() }
            : { ok: false, output: out.trim(), error: `npm install exited with code ${code ?? "?"}` }
        )
      );
    });
  });
}
