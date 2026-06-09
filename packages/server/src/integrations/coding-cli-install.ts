import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sharedCodingAuthDir, sharedCodingToolsDir } from "./shell.js";
import { CODING_TOOLS, withCodingLock, type CodingTool } from "./coding-cli.js";

/**
 * Install + detect the coding CLIs (Claude Code, Codex, Antigravity CLI, OpenCode)
 * ONCE for all agents. Binaries install into a single shared host dir
 * (`<data>/coding-tools` — an npm prefix for npm tools; the Antigravity Go binary
 * is dropped into its `bin/` by the official install script) that every sandbox
 * mounts read-only via
 * a tmp-overlay; logins live in a single shared store (`<data>/coding-cli-auth`)
 * bound into every sandbox HOME. So the user installs and logs in a single time,
 * not per agent. Install + detection run host-side (these are shared infra ops,
 * not per-agent sandboxed work); see `shell.ts` for how the mounts are wired.
 */

/**
 * How a tool is installed into the shared tools dir. Most are npm packages; the
 * Antigravity CLI ships a Go binary installed via Google's official script.
 */
export type CodingCliInstall =
  | { method: "npm"; pkg: string }
  | { method: "script"; url: string };

export interface CodingCliSpec {
  /** Human-readable name for the UI. */
  label: string;
  /** Binary name (under the shared tools `bin/`). */
  bin: string;
  /** How to install (or update to latest) the tool. */
  install: CodingCliInstall;
  /** The (interactive) login the user runs once from an agent's terminal. */
  loginCmd: string;
  /** Login credential file, relative to the shared auth store (best-effort). */
  authFile: string;
}

export const CODING_CLI_SPECS: Record<CodingTool, CodingCliSpec> = {
  claude: {
    label: "Claude Code",
    bin: "claude",
    install: { method: "npm", pkg: "@anthropic-ai/claude-code" },
    loginCmd: "claude",
    authFile: "claude/.credentials.json",
  },
  codex: {
    label: "Codex",
    bin: "codex",
    install: { method: "npm", pkg: "@openai/codex" },
    // Device-auth flow (code + URL): the browser/loopback OAuth can't complete
    // in the sandboxed terminal.
    loginCmd: "codex login --device-auth",
    authFile: "codex/auth.json",
  },
  antigravity: {
    label: "Antigravity CLI",
    bin: "agy",
    // Go binary, not an npm package: install via Google's official script.
    install: { method: "script", url: "https://antigravity.google/cli/install.sh" },
    // First interactive run prints a Google-OAuth URL to open. `agy` reuses
    // ~/.gemini, so its creds land in the shared `gemini` cred dir (see shell.ts).
    loginCmd: "agy",
    authFile: "gemini/oauth_creds.json",
  },
  opencode: {
    label: "OpenCode",
    bin: "opencode",
    install: { method: "npm", pkg: "opencode-ai" },
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
  /** Latest version on the npm registry, when known (from the cached check). */
  latest?: string;
  /** True when installed and a newer version is published. */
  updateAvailable?: boolean;
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
  const binDir = join(prefix, "bin");
  return withCodingLock("shared-coding-install", async () => {
    try {
      mkdirSync(binDir, { recursive: true });
    } catch {
      /* the install below will surface a real problem */
    }
    return new Promise<CodingCliInstallResult>((resolve) => {
      // npm tools: `npm i -g <pkg>@latest` into the shared prefix. Script tools
      // (Antigravity): pipe the official installer to bash, targeting the shared
      // `bin/` via `--dir`. HOME is pointed at the throwaway prefix so the
      // installer's PATH/alias edits don't touch the server user's shell profile.
      const child =
        spec.install.method === "npm"
          ? spawn("npm", ["install", "-g", `${spec.install.pkg}@latest`], {
              env: { ...process.env, npm_config_prefix: prefix },
            })
          : spawn("bash", ["-c", 'curl -fsSL "$AGY_URL" | bash -s -- --dir "$AGY_DIR"'], {
              env: { ...process.env, HOME: prefix, AGY_URL: spec.install.url, AGY_DIR: binDir },
            });
      let out = "";
      const cap = (c: Buffer) => {
        if (out.length < 1_000_000) out += c.toString("utf8");
      };
      child.stdout?.on("data", cap);
      child.stderr?.on("data", cap);
      child.on("error", (err) =>
        resolve({ ok: false, output: out.trim(), error: `failed to run installer: ${err.message}` })
      );
      child.on("close", (code) =>
        resolve(
          code === 0
            ? { ok: true, output: out.trim() }
            : { ok: false, output: out.trim(), error: `install exited with code ${code ?? "?"}` }
        )
      );
    });
  });
}

// --- Update checking -------------------------------------------------------
//
// The shared base is pinned `@latest` at install time but doesn't move on its
// own, so it can fall behind the registry. We compare the installed version
// against the npm registry's latest and surface "update available" in the UI.
// A daily background check (CodingCliUpdateChecker) caches the latest versions
// so the check is cheap on read and can light a passive indicator.

export type LatestVersions = Record<CodingTool, string | null>;

/** Minimal settings backend (the orchestrator's app_settings) for the cache. */
export interface CodingCliSettingsStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

const LATEST_CACHE_KEY = "coding_cli_latest";

function emptyLatest(): LatestVersions {
  const m = {} as LatestVersions;
  for (const tool of CODING_TOOLS) m[tool] = null;
  return m;
}

/** Pull the first `x.y.z` out of a version string (installed `--version` output
 *  often has extra words, e.g. "codex-cli 0.135.0"). */
function semver(v: string | undefined): [number, number, number] | null {
  const m = (v ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is strictly newer than `installed`. Conservative: returns
 *  false if either version can't be parsed (never nag on uncertainty). */
export function isNewerVersion(latest: string | undefined, installed: string | undefined): boolean {
  const a = semver(latest);
  const b = semver(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Fetch the registry `latest` version for every tool (null on any failure). */
async function fetchLatestVersions(): Promise<LatestVersions> {
  const out = emptyLatest();
  await Promise.all(
    CODING_TOOLS.map(async (tool) => {
      const spec = CODING_CLI_SPECS[tool];
      // Only npm tools have a registry to query; script-installed tools (the
      // Antigravity Go binary) leave `null` and never flag a phantom update.
      if (spec.install.method !== "npm") return;
      try {
        const res = await fetch(`https://registry.npmjs.org/${spec.install.pkg}/latest`, {
          signal: AbortSignal.timeout(8000),
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { version?: string };
        if (body.version) out[tool] = body.version;
      } catch {
        /* leave null — best-effort */
      }
    })
  );
  return out;
}

/** Read the cached latest versions (from the daily check), empty if none. */
function cachedLatestVersions(store: CodingCliSettingsStore): LatestVersions {
  try {
    const raw = store.getSetting(LATEST_CACHE_KEY);
    if (raw) return { ...emptyLatest(), ...(JSON.parse(raw).latest ?? {}) };
  } catch {
    /* fall through to empty */
  }
  return emptyLatest();
}

/** Fetch fresh latest versions and cache them. Returns the fetched map. */
export async function refreshLatestVersions(store: CodingCliSettingsStore): Promise<LatestVersions> {
  const latest = await fetchLatestVersions();
  store.setSetting(LATEST_CACHE_KEY, JSON.stringify({ checkedAt: Date.now(), latest }));
  return latest;
}

/**
 * Shared install/login status for every tool, enriched with the cached latest
 * version + an `updateAvailable` flag. Local + cache only (no network).
 */
export function sharedCodingStatus(store: CodingCliSettingsStore): Record<CodingTool, CodingCliStatus> {
  const status = checkSharedCodingClis();
  const latest = cachedLatestVersions(store);
  for (const tool of CODING_TOOLS) {
    const lv = latest[tool];
    if (lv) {
      status[tool].latest = lv;
      status[tool].updateAvailable = status[tool].installed && isNewerVersion(lv, status[tool].version);
    }
  }
  return status;
}

/**
 * Periodically refreshes the cached latest versions so the UI can flag updates
 * without a network call on every read. Mirrors ForgeMonitor's timer pattern.
 */
export class CodingCliUpdateChecker {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly store: CodingCliSettingsStore) {}

  start(intervalMs: number): void {
    if (this.timer) return;
    void refreshLatestVersions(this.store).catch(() => {});
    this.timer = setInterval(() => void refreshLatestVersions(this.store).catch(() => {}), intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
