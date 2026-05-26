/**
 * Agentic browsing for an agent, on top of the `agent-browser` CLI (a fast
 * accessibility-tree browser-automation tool for AI agents). Modeled on the
 * Hermes `tools/browser_tool.py` port: the agent works the page through a
 * snapshot → ref → click/type loop rather than pixels.
 *
 * Each agent gets its **own persistent profile** (`--profile <dir>`, a real
 * Chrome user-data dir under the agent's profile directory) so logins and
 * cookies survive across tasks and restarts, plus its **own daemon session**
 * (`--session otter_<agentId>`) so concurrent agents never share a browser.
 * The browser is **headless** by default; `agent-browser` only opens a window
 * with `--headed`, which we never pass.
 *
 * Local headless Chromium is the only backend wired up here. Cloud providers
 * (Browserbase / Browser Use / Firecrawl), which `agent-browser` also supports
 * via `--provider`, are intentionally out of scope for now.
 */

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Per-agent browser identity: an isolated daemon session + persistent profile. */
export interface BrowserEnv {
  /** Daemon session name — namespaces this agent's browser. */
  session: string;
  /** Persistent Chrome user-data dir (cookies/logins survive here). */
  profileDir: string;
  /** Optional per-agent timeout override for browser commands (ms). */
  timeoutMs?: number;
}

/** Build the per-agent browser identity from an agent id and its profile dir. */
export function browserEnvFor(agentId: string, profileDir: string, timeoutMs?: number): BrowserEnv {
  return { session: `otter_${agentId}`, profileDir, timeoutMs };
}

/** Result handed back to the tool layer; mirrors the other integrations. */
export type BrowserResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/** One-time setup hint, surfaced when Chrome (or the CLI) isn't ready. */
const INSTALL_HINT =
  "Browser engine not ready. Run `agent-browser install` once on the host to " +
  "download Chrome (or `agent-browser install --with-deps` on Linux to also " +
  "install system libraries).";

/** Most navigations/snapshots are quick; allow plenty of headroom for slow pages. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Absolute path to the `agent-browser` CLI entry, resolved from the installed
 * package rather than a `node_modules/.bin` shim so it works regardless of cwd.
 * Resolved lazily and cached.
 */
let binPath: string | undefined;
function agentBrowserBin(): string {
  if (binPath) return binPath;
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("agent-browser/package.json");
  const pkg = require("agent-browser/package.json") as { bin?: string | Record<string, string> };
  const rel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.["agent-browser"];
  if (!rel) throw new Error("agent-browser package has no bin entry");
  binPath = join(dirname(pkgPath), rel);
  return binPath;
}

interface RawRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

/**
 * Run one `agent-browser` subcommand for an agent. Output is captured via temp
 * files, not pipes: `agent-browser` spawns a detached daemon that inherits the
 * child's stdio, so reading a pipe to EOF would hang until the daemon dies.
 * We wait on the CLI process exiting and read the files it left behind.
 */
async function runAgentBrowser(
  env: BrowserEnv,
  args: string[],
  timeoutMs = env.timeoutMs ?? DEFAULT_TIMEOUT_MS
): Promise<RawRun> {
  mkdirSync(env.profileDir, { recursive: true });
  const outPath = join(tmpdir(), `otter-ab-${randomUUID()}.out`);
  const errPath = join(tmpdir(), `otter-ab-${randomUUID()}.err`);
  const outFd = openSync(outPath, "w");
  const errFd = openSync(errPath, "w");

  const argv = [
    agentBrowserBin(),
    "--json",
    "--session",
    env.session,
    "--profile",
    env.profileDir,
    ...args,
  ];

  return new Promise<RawRun>((resolve) => {
    let settled = false;
    const child = spawn(process.execPath, argv, {
      stdio: ["ignore", outFd, errFd],
      env: process.env,
    });

    const readAndClean = (): { stdout: string; stderr: string } => {
      let stdout = "";
      let stderr = "";
      try { closeSync(outFd); } catch { /* already closed */ }
      try { closeSync(errFd); } catch { /* already closed */ }
      try { stdout = readFileSync(outPath, "utf8"); } catch { /* none */ }
      try { stderr = readFileSync(errPath, "utf8"); } catch { /* none */ }
      rmSync(outPath, { force: true });
      rmSync(errPath, { force: true });
      return { stdout, stderr };
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const { stdout, stderr } = readAndClean();
      resolve({ exitCode: null, stdout, stderr, timedOut, spawnError: err.message });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const { stdout, stderr } = readAndClean();
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
  });
}

/**
 * Turn a raw run into the tool-facing `{ ok }` shape. `agent-browser --json`
 * prints a `{ success, data, error }` envelope; we unwrap it so the agent sees
 * `data` on success and a plain message on failure.
 */
function toResult(run: RawRun): BrowserResult {
  if (run.spawnError) {
    return { ok: false, error: `Could not launch agent-browser: ${run.spawnError}. ${INSTALL_HINT}` };
  }
  if (run.timedOut) {
    return { ok: false, error: "Browser command timed out." };
  }
  const trimmed = run.stdout.trim();
  let parsed: unknown;
  if (trimmed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = trimmed; // non-JSON output (rare) — pass through as text
    }
  }

  // Unwrap the agent-browser JSON envelope when present.
  if (parsed && typeof parsed === "object" && "success" in parsed) {
    const env = parsed as { success: boolean; data?: unknown; error?: unknown };
    if (env.success) return { ok: true, result: env.data ?? null };
    const msg = env.error != null ? String(env.error) : run.stderr.trim() || "browser command failed";
    return withHint(msg);
  }

  if (run.exitCode !== 0) {
    const detail =
      run.stderr.trim() ||
      (typeof parsed === "string" ? parsed : parsed != null ? JSON.stringify(parsed) : "") ||
      "unknown error";
    return withHint(detail);
  }
  return { ok: true, result: parsed ?? null };
}

/** Append the one-time install hint when an error smells like a missing Chrome. */
function withHint(message: string): { ok: false; error: string } {
  const looksLikeMissingChrome = /install|chrome|chromium|browser bin|shared librar/i.test(message);
  return { ok: false, error: looksLikeMissingChrome ? `${message}\n${INSTALL_HINT}` : message };
}

/** Navigate to a URL (launches the browser on first use). */
export async function browserNavigate(env: BrowserEnv, url: string): Promise<BrowserResult> {
  return toResult(await runAgentBrowser(env, ["open", url]));
}

/**
 * Capture the page's accessibility tree with `@e<n>` refs — the input for every
 * other action. `interactive` trims it to clickable/typable elements; `compact`
 * drops empty structural nodes.
 */
export async function browserSnapshot(
  env: BrowserEnv,
  opts: { interactive?: boolean; compact?: boolean } = {}
): Promise<BrowserResult> {
  const args = ["snapshot"];
  if (opts.interactive) args.push("-i");
  if (opts.compact) args.push("-c");
  return toResult(await runAgentBrowser(env, args));
}

/** Click an element by `@e<n>` ref (from a snapshot) or CSS selector. */
export async function browserClick(env: BrowserEnv, selector: string): Promise<BrowserResult> {
  return toResult(await runAgentBrowser(env, ["click", selector]));
}

/** Type text into an element by ref/selector. */
export async function browserType(
  env: BrowserEnv,
  selector: string,
  text: string
): Promise<BrowserResult> {
  return toResult(await runAgentBrowser(env, ["type", selector, text]));
}

/** Press a key or chord (e.g. `Enter`, `Tab`, `Control+a`). */
export async function browserPress(env: BrowserEnv, key: string): Promise<BrowserResult> {
  return toResult(await runAgentBrowser(env, ["press", key]));
}

/** Scroll the page in a direction, optionally by a pixel amount. */
export async function browserScroll(
  env: BrowserEnv,
  direction: "up" | "down" | "left" | "right",
  pixels?: number
): Promise<BrowserResult> {
  const args = ["scroll", direction];
  if (pixels != null) args.push(String(pixels));
  return toResult(await runAgentBrowser(env, args));
}

/** Go back one entry in history. */
export async function browserBack(env: BrowserEnv): Promise<BrowserResult> {
  return toResult(await runAgentBrowser(env, ["back"]));
}

/**
 * List the images on the current page (src + alt + natural size). `agent-browser`
 * has no dedicated images command, so this evaluates a small DOM query.
 */
export async function browserGetImages(env: BrowserEnv): Promise<BrowserResult> {
  const js =
    "JSON.stringify(Array.from(document.images).slice(0,50)" +
    ".map(i=>({src:i.currentSrc||i.src,alt:i.alt,width:i.naturalWidth,height:i.naturalHeight})))";
  return toResult(await runAgentBrowser(env, ["eval", js]));
}

/** Read the page's captured console logs. */
export async function browserConsole(env: BrowserEnv): Promise<BrowserResult> {
  return toResult(await runAgentBrowser(env, ["console"]));
}

/**
 * Take a PNG screenshot of the current page and return it base64-encoded, for
 * handing to a vision model. Returns the raw bytes so the caller decides how to
 * present them.
 */
export async function browserScreenshot(
  env: BrowserEnv
): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  const shotPath = join(tmpdir(), `otter-ab-${randomUUID()}.png`);
  const run = await runAgentBrowser(env, ["screenshot", shotPath]);
  const res = toResult(run);
  if (!res.ok) return res;
  try {
    const base64 = readFileSync(shotPath).toString("base64");
    return { ok: true, base64 };
  } catch (err) {
    return { ok: false, error: `Screenshot saved but could not be read: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    rmSync(shotPath, { force: true });
  }
}

/**
 * Best-effort teardown of an agent's browser daemon session. Fire-and-forget —
 * called when an agent shuts down. Closing a session that was never opened is a
 * harmless no-op.
 */
export function closeBrowserSession(env: BrowserEnv): void {
  try {
    const child = spawn(
      process.execPath,
      [agentBrowserBin(), "--session", env.session, "close"],
      { stdio: "ignore", detached: true }
    );
    child.on("error", () => { /* engine missing / nothing to close — ignore */ });
    child.unref();
  } catch {
    /* ignore — teardown is best-effort */
  }
}
