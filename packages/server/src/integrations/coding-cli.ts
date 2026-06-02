import { spawn } from "node:child_process";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import { buildSandboxPlan, ensureWorkspace, type SandboxOpts } from "./shell.js";

/**
 * Run command-line coding agents — Claude Code, Codex, Gemini CLI, OpenCode —
 * inside the very same OS sandbox as `shell_exec` (`integrations/shell.ts`),
 * confined to the agent's workspace plus, when the agent belongs to a project,
 * the shared `/project` tree. Each tool authenticates from the agent's own
 * `/workspace` HOME (where the user logged it in), so subscriptions stay
 * per-agent.
 *
 * Two modes:
 *  - headless  → `runCodingCliHeadless` captures output and returns a summary,
 *                flowing back into the model's tool loop.
 *  - interactive → `startCodingSession` spawns the tool in a PTY whose live TUI
 *                  is streamed to the browser; the run resolves with a summary
 *                  when the process exits.
 *
 * A per-key mutex (`withCodingLock`) serializes runs so only one coding CLI
 * mutates a shared project tree at a time.
 */

export type CodingTool = "claude" | "codex" | "gemini" | "opencode";
export const CODING_TOOLS: CodingTool[] = ["claude", "codex", "gemini", "opencode"];

export function isCodingTool(v: string): v is CodingTool {
  return (CODING_TOOLS as string[]).includes(v);
}

/**
 * A resolved per-tool model configuration — the subset of a
 * {@link import("@otterbot/shared").CodingModelPreset} that drives flag
 * selection. Each tool reads the fields that apply to it (see {@link presetToArgs}).
 */
export interface ResolvedCodingModel {
  /** Model alias/id — claude (`opus`/`sonnet`/…), codex, gemini. */
  model?: string;
  /** Reasoning effort — claude (`--effort`) and codex (`model_reasoning_effort`). */
  effort?: string;
  /** opencode: the `provider/model` string passed to `-m`. */
  providerModel?: string;
}

/**
 * Translate a resolved model config into a tool's model-selection flags. Pure;
 * the single point that knows each CLI's knob syntax (so it is unit-tested).
 */
export function presetToArgs(tool: CodingTool, m: ResolvedCodingModel): string[] {
  switch (tool) {
    case "claude":
      return [
        ...(m.model ? ["--model", m.model] : []),
        ...(m.effort ? ["--effort", m.effort] : []),
      ];
    case "codex":
      return [
        ...(m.model ? ["-m", m.model] : []),
        // `-c key=value` overrides config.toml; the value is parsed as TOML.
        ...(m.effort ? ["-c", `model_reasoning_effort="${m.effort}"`] : []),
      ];
    case "gemini":
      return m.model ? ["-m", m.model] : [];
    case "opencode":
      return m.providerModel ? ["-m", m.providerModel] : [];
  }
}

/** How to invoke each tool non-interactively and as a live TUI. */
interface ToolSpec {
  bin: string;
  headless: (task: string, m: ResolvedCodingModel) => string[];
  interactive: (task: string, m: ResolvedCodingModel) => string[];
}

const TOOLS: Record<CodingTool, ToolSpec> = {
  // Positional task = full TUI; `-p` = headless print. Auto-approve so the run
  // completes unattended (it is already confined by otterbot's own sandbox).
  claude: {
    bin: "claude",
    headless: (task, m) => [
      ...presetToArgs("claude", m),
      "-p",
      task,
      "--dangerously-skip-permissions",
    ],
    interactive: (task, m) => [
      ...presetToArgs("claude", m),
      task,
      "--dangerously-skip-permissions",
    ],
  },
  // `codex exec` runs headless and exits; the bare TUI is seeded with the task.
  codex: {
    bin: "codex",
    headless: (task, m) => [
      "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      ...presetToArgs("codex", m),
      task,
    ],
    interactive: (task, m) => [...presetToArgs("codex", m), task],
  },
  gemini: {
    bin: "gemini",
    headless: (task, m) => [...presetToArgs("gemini", m), "-p", task, "--yolo"],
    interactive: (task, m) => [...presetToArgs("gemini", m), "-i", task, "--yolo"],
  },
  // OpenCode renders a TUI for `run` regardless, so both modes use it.
  opencode: {
    bin: "opencode",
    headless: (task, m) => ["run", ...presetToArgs("opencode", m), task],
    interactive: (task, m) => ["run", ...presetToArgs("opencode", m), task],
  },
};

/** Build the argv passed to the sandbox for a tool + mode. Exposed for tests. */
export function buildCodingArgv(
  tool: CodingTool,
  task: string,
  opts: { interactive?: boolean; model?: ResolvedCodingModel } = {}
): string[] {
  const spec = TOOLS[tool];
  const m = opts.model ?? {};
  const args = opts.interactive ? spec.interactive(task, m) : spec.headless(task, m);
  return [spec.bin, ...args];
}

/** Strip ANSI/VT escape sequences so a summary is readable plain text. */
export function stripAnsi(input: string): string {
  return (
    input
      // OSC sequences: ESC ] … BEL  or  ESC ] … ESC backslash
      .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
      // CSI sequences: ESC [ … final byte
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // Two-character escapes: ESC followed by one byte in @.._
      .replace(/\x1b[@-Z\\-_]/g, "")
  );
}

/** Strip ANSI and normalize whitespace into a readable plain-text transcript. */
export function cleanOutput(buffer: string): string {
  return stripAnsi(buffer)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Collapse a raw terminal buffer to a readable tail for the model. */
export function summarizeOutput(buffer: string, maxChars = 6000): string {
  const cleaned = cleanOutput(buffer);
  if (cleaned.length <= maxChars) return cleaned;
  return "…[earlier output truncated]\n" + cleaned.slice(-maxChars);
}

const CODING_TIMEOUT_MS = 30 * 60_000;
const RING_BUFFER_SIZE = 100 * 1024;

export interface CodingRunOptions {
  tool: CodingTool;
  task: string;
  model?: ResolvedCodingModel;
  workspaceDir: string;
  secrets: Map<string, string>;
  /** Shared project tree to bind + run inside, when the agent has a project. */
  projectRepoPath?: string | null;
}

export interface CodingRunResult {
  ok: boolean;
  exitCode: number | null;
  /** Readable tail of the run, sized for the model's context. */
  summary: string;
  /** Full cleaned terminal output (the captured tty), for display only. */
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
  sandbox: string | null;
  error?: string;
}

function sandboxOptsFor(projectRepoPath?: string | null, interactive = false): SandboxOpts {
  return {
    interactive,
    projectRepoPath: projectRepoPath ?? undefined,
    startIn: projectRepoPath ? "project" : "workspace",
  };
}

/** Run a coding CLI non-interactively, capturing its output as a summary. */
export function runCodingCliHeadless(opts: CodingRunOptions): Promise<CodingRunResult> {
  ensureWorkspace(opts.workspaceDir);
  const argv = buildCodingArgv(opts.tool, opts.task, { model: opts.model });
  const built = buildSandboxPlan(
    opts.workspaceDir,
    opts.secrets,
    argv,
    sandboxOptsFor(opts.projectRepoPath)
  );
  if ("error" in built) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      summary: "",
      transcript: "",
      truncated: false,
      timedOut: false,
      sandbox: null,
      error: built.error,
    });
  }
  const { plan, sandbox } = built;

  return new Promise<CodingRunResult>((resolve) => {
    // The task is passed via argv, so the CLI needs no stdin. Redirect it from
    // /dev/null ("ignore") — otherwise the tool waits 3s for piped input and
    // prints a "no stdin data received" warning into the transcript.
    const child = spawn(plan.file, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buffer = "";
    let dropped = false;
    let timedOut = false;
    let done = false;

    const collect = (chunk: Buffer) => {
      if (buffer.length < RING_BUFFER_SIZE * 4) buffer += chunk.toString("utf8");
      else dropped = true;
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, CODING_TIMEOUT_MS);

    const finish = (result: CodingRunResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (err) =>
      finish({
        ok: false,
        exitCode: null,
        summary: "",
        transcript: "",
        truncated: false,
        timedOut: false,
        sandbox,
        error: `failed to start ${opts.tool} (${sandbox}): ${err.message}`,
      })
    );

    child.on("close", (code) =>
      finish({
        ok: code === 0 && !timedOut,
        exitCode: code,
        summary: summarizeOutput(buffer),
        transcript: cleanOutput(buffer),
        truncated: dropped,
        timedOut,
        sandbox,
      })
    );
  });
}

/** A live coding-CLI PTY session, tracked per agent for socket streaming. */
export interface CodingSession {
  agentId: string;
  tool: CodingTool;
  /** Replay buffer for late-joining viewers. */
  getReplayBuffer(): string;
  /** Subscribe to raw PTY output; returns an unsubscribe function. */
  onData(cb: (data: string) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Resolves when the process exits, with a cleaned summary of the session. */
  exited: Promise<{ exitCode: number; summary: string }>;
}

const activeCodingSessions = new Map<string, CodingSession>();

export function getCodingSession(agentId: string): CodingSession | undefined {
  return activeCodingSessions.get(agentId);
}

export interface StartCodingSessionOptions extends CodingRunOptions {
  agentId: string;
  cols?: number;
  rows?: number;
}

/**
 * Spawn a coding CLI in a PTY confined to the agent's sandbox, register it as
 * the agent's active session, and stream output to subscribers. Returns
 * `{ error }` when no sandbox is available — it never runs unconfined. Replaces
 * any session already active for the agent.
 */
export function startCodingSession(
  opts: StartCodingSessionOptions
): { session: CodingSession } | { error: string } {
  ensureWorkspace(opts.workspaceDir);
  // One coding session per agent: tear down any existing one first.
  activeCodingSessions.get(opts.agentId)?.kill();

  const argv = buildCodingArgv(opts.tool, opts.task, { interactive: true, model: opts.model });
  const built = buildSandboxPlan(
    opts.workspaceDir,
    opts.secrets,
    argv,
    sandboxOptsFor(opts.projectRepoPath, true)
  );
  if ("error" in built) return { error: built.error };

  const { plan } = built;
  let term: pty.IPty;
  try {
    term = pty.spawn(plan.file, plan.args, {
      name: "xterm-256color",
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: plan.cwd,
      env: plan.env as { [key: string]: string },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const hint = /posix_spawn/i.test(message)
      ? " — the pty native binary is missing; reinstall dependencies (`pnpm install`)"
      : "";
    return { error: `failed to start ${opts.tool}: ${message}${hint}` };
  }

  let ring = "";
  const listeners = new Set<(data: string) => void>();
  let resolveExit!: (v: { exitCode: number; summary: string }) => void;
  const exited = new Promise<{ exitCode: number; summary: string }>((r) => (resolveExit = r));

  term.onData((data) => {
    ring += data;
    if (ring.length > RING_BUFFER_SIZE) ring = ring.slice(-RING_BUFFER_SIZE);
    for (const cb of listeners) cb(data);
  });

  const session: CodingSession = {
    agentId: opts.agentId,
    tool: opts.tool,
    getReplayBuffer: () => ring,
    onData(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    write: (data) => term.write(data),
    resize: (cols, rows) => {
      try {
        term.resize(cols, rows);
      } catch {
        /* raced with exit */
      }
    },
    kill: () => {
      try {
        term.kill();
      } catch {
        /* already gone */
      }
    },
    exited,
  };

  term.onExit(({ exitCode }) => {
    if (activeCodingSessions.get(opts.agentId) === session) {
      activeCodingSessions.delete(opts.agentId);
    }
    listeners.clear();
    resolveExit({ exitCode, summary: summarizeOutput(ring) });
  });

  activeCodingSessions.set(opts.agentId, session);
  return { session };
}

/**
 * Serialize coding runs by key so only one CLI mutates a shared tree at a time.
 * Callers key by project (its repo path) when present, else by agent.
 */
const locks = new Map<string, Promise<unknown>>();

export function codingLockKey(agentId: string, projectRepoPath?: string | null): string {
  return projectRepoPath ? `project:${projectRepoPath}` : `agent:${agentId}`;
}

/** True when another run already holds the lock for this key. */
export function isCodingLockBusy(key: string): boolean {
  return locks.has(key);
}

export async function withCodingLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const chained = prior.then(() => gate);
  locks.set(key, chained);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    // Clear only if no later run chained onto us.
    if (locks.get(key) === chained) locks.delete(key);
  }
}
