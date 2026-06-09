import { spawn } from "node:child_process";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import type { CodingSessionInfo, CodingSessionMode } from "@otterbot/shared";
import { buildSandboxPlan, ensureWorkspace, type SandboxOpts } from "./shell.js";

/**
 * Run command-line coding agents — Claude Code, Codex, Antigravity CLI, OpenCode —
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

export type CodingTool = "claude" | "codex" | "antigravity" | "opencode";
export const CODING_TOOLS: CodingTool[] = ["claude", "codex", "antigravity", "opencode"];

export function isCodingTool(v: string): v is CodingTool {
  return (CODING_TOOLS as string[]).includes(v);
}

/**
 * A resolved per-tool model configuration — the subset of a
 * {@link import("@otterbot/shared").CodingModelPreset} that drives flag
 * selection. Each tool reads the fields that apply to it (see {@link presetToArgs}).
 */
export interface ResolvedCodingModel {
  /** Model alias/id — claude (`opus`/`sonnet`/…), codex, antigravity (a display
   *  name like `Gemini 3.1 Pro (High)`). */
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
    case "antigravity":
      // `agy` takes a model display name verbatim, e.g. "Gemini 3.1 Pro (High)".
      return m.model ? ["--model", m.model] : [];
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
  // Antigravity CLI (`agy`): `-p` prints headless, `-i` seeds the TUI. Auto-approve
  // like Claude Code (`--dangerously-skip-permissions`) so the run completes
  // unattended — it is already confined by otterbot's own sandbox.
  antigravity: {
    bin: "agy",
    headless: (task, m) => [...presetToArgs("antigravity", m), "-p", task, "--dangerously-skip-permissions"],
    interactive: (task, m) => [...presetToArgs("antigravity", m), "-i", task, "--dangerously-skip-permissions"],
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
/**
 * Autonomous runs use the tool's interactive TUI (so output streams live), which
 * — unlike `-p` print mode — does NOT exit on its own; it returns to an idle
 * prompt when the task is done. We treat this many ms of total silence as
 * "finished" and gracefully terminate. Safe because every supported CLI animates
 * a spinner (sub-second cadence) while working, so sustained silence only happens
 * at the prompt. Overridable via OTTERBOT_CODING_IDLE_MS.
 */
const CODING_IDLE_DONE_MS = Number(process.env.OTTERBOT_CODING_IDLE_MS) || 30_000;

export interface CodingRunOptions {
  tool: CodingTool;
  task: string;
  model?: ResolvedCodingModel;
  workspaceDir: string;
  secrets: Map<string, string>;
  /** Shared project tree to bind + run inside, when the agent has a project. */
  projectWorkspacePath?: string | null;
  gitSsh?: import("./shell.js").GitSshSetup;
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

function sandboxOptsFor(
  projectWorkspacePath?: string | null,
  interactive = false,
  gitSsh?: import("./shell.js").GitSshSetup
): SandboxOpts {
  return {
    interactive,
    projectWorkspacePath: projectWorkspacePath ?? undefined,
    startIn: projectWorkspacePath ? "project" : "workspace",
    gitSsh,
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
    sandboxOptsFor(opts.projectWorkspacePath, false, opts.gitSsh)
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

/** A live coding-CLI session, tracked per agent for socket streaming. Either an
 *  interactive PTY (full TUI, accepts input) or a headless run (captured pipe
 *  output, read-only — `write`/`resize` are no-ops). */
export interface CodingSession {
  agentId: string;
  tool: CodingTool;
  mode: CodingSessionMode;
  /** ISO timestamp the run started — for the Activity-view list. */
  startedAt: string;
  /** Replay buffer for late-joining viewers. */
  getReplayBuffer(): string;
  /** Subscribe to raw output; returns an unsubscribe function. */
  onData(cb: (data: string) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  /** Resolves when the process exits, with a cleaned summary + full transcript.
   *  `completedByIdle` = the autonomous run went idle (returned to its prompt)
   *  and was gracefully ended; `timedOut` = hit the hard backstop. */
  exited: Promise<{
    exitCode: number;
    summary: string;
    transcript: string;
    timedOut: boolean;
    completedByIdle: boolean;
  }>;
}

const activeCodingSessions = new Map<string, CodingSession>();

export function getCodingSession(agentId: string): CodingSession | undefined {
  return activeCodingSessions.get(agentId);
}

/** Snapshot of every active coding session — for the Activity view + reconnects. */
export function listCodingSessions(): CodingSessionInfo[] {
  return [...activeCodingSessions.values()].map((s) => ({
    agentId: s.agentId,
    tool: s.tool,
    mode: s.mode,
    startedAt: s.startedAt,
  }));
}

/** A coding-session lifecycle event, broadcast to the UI by the socket layer. */
export type CodingLifecycleEvent =
  | ({ type: "started" } & CodingSessionInfo)
  | { type: "ended"; agentId: string };

const lifecycleListeners = new Set<(ev: CodingLifecycleEvent) => void>();

/** Subscribe to coding-session start/end events (both headless + interactive). */
export function onCodingLifecycle(cb: (ev: CodingLifecycleEvent) => void): () => void {
  lifecycleListeners.add(cb);
  return () => lifecycleListeners.delete(cb);
}

function emitLifecycle(ev: CodingLifecycleEvent): void {
  for (const cb of lifecycleListeners) cb(ev);
}

/** Register a session, announcing it; returns a de-register fn that announces the end. */
function registerSession(session: CodingSession): () => void {
  // One coding session per agent: tear down any existing one first.
  if (activeCodingSessions.get(session.agentId) !== session) {
    activeCodingSessions.get(session.agentId)?.kill();
  }
  activeCodingSessions.set(session.agentId, session);
  emitLifecycle({
    type: "started",
    agentId: session.agentId,
    tool: session.tool,
    mode: session.mode,
    startedAt: session.startedAt,
  });
  return () => {
    if (activeCodingSessions.get(session.agentId) === session) {
      activeCodingSessions.delete(session.agentId);
    }
    emitLifecycle({ type: "ended", agentId: session.agentId });
  };
}

export interface StartCodingSessionOptions extends CodingRunOptions {
  agentId: string;
  cols?: number;
  rows?: number;
  /**
   * "interactive" → the agent explicitly asked for a live session the user
   * drives (auto-popped in the UI); "autonomous" (default) → a run-to-completion
   * task that still streams its PTY so the user can watch/intervene, with a
   * timeout backstop so it can't hold the per-project lock forever.
   */
  mode?: CodingSessionMode;
}

/**
 * Spawn a coding CLI in a PTY confined to the agent's sandbox, register it as
 * the agent's active session, and stream its live output to subscribers — the
 * same mechanism the user attaches to in the browser. The task is passed via
 * argv (the tool's interactive/TUI invocation, NOT `-p`), so output streams as
 * it happens and the process exits when the task completes, resolving `exited`
 * with a summary. Returns `{ error }` when no sandbox is available — it never
 * runs unconfined. Replaces any session already active for the agent.
 */
export function startCodingSession(
  opts: StartCodingSessionOptions
): { session: CodingSession } | { error: string } {
  ensureWorkspace(opts.workspaceDir);

  const argv = buildCodingArgv(opts.tool, opts.task, { interactive: true, model: opts.model });
  const built = buildSandboxPlan(
    opts.workspaceDir,
    opts.secrets,
    argv,
    sandboxOptsFor(opts.projectWorkspacePath, true, opts.gitSsh)
  );
  if ("error" in built) return { error: built.error };

  const mode: CodingSessionMode = opts.mode ?? "autonomous";
  const { plan } = built;
  let term: pty.IPty;
  try {
    term = pty.spawn(plan.file, plan.args, {
      name: "xterm-256color",
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 40,
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
  let timedOut = false;
  let completedByIdle = false;
  const listeners = new Set<(data: string) => void>();
  type ExitInfo = {
    exitCode: number;
    summary: string;
    transcript: string;
    timedOut: boolean;
    completedByIdle: boolean;
  };
  let resolveExit!: (v: ExitInfo) => void;
  const exited = new Promise<ExitInfo>((r) => (resolveExit = r));

  const killTerm = () => {
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  };

  // Hard backstop for autonomous runs: never hold the per-project coding lock
  // longer than the timeout. Interactive sessions are user-driven, not capped.
  const hardTimer =
    mode === "autonomous"
      ? setTimeout(() => {
          timedOut = true;
          killTerm();
        }, CODING_TIMEOUT_MS)
      : null;

  // Completion detection for autonomous runs: the TUI streams continuously while
  // working, so sustained silence means it returned to its prompt → task done.
  let idleTimer: NodeJS.Timeout | null = null;
  const bumpIdle = () => {
    if (mode !== "autonomous") return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      completedByIdle = true;
      killTerm();
    }, CODING_IDLE_DONE_MS);
  };

  term.onData((data) => {
    ring += data;
    if (ring.length > RING_BUFFER_SIZE) ring = ring.slice(-RING_BUFFER_SIZE);
    for (const cb of listeners) cb(data);
    bumpIdle();
  });
  bumpIdle();

  const session: CodingSession = {
    agentId: opts.agentId,
    tool: opts.tool,
    mode,
    startedAt: new Date().toISOString(),
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

  const deregister = registerSession(session);
  term.onExit(({ exitCode }) => {
    if (hardTimer) clearTimeout(hardTimer);
    if (idleTimer) clearTimeout(idleTimer);
    deregister();
    listeners.clear();
    resolveExit({
      exitCode,
      summary: summarizeOutput(ring),
      transcript: cleanOutput(ring),
      timedOut,
      completedByIdle,
    });
  });

  return { session };
}

/**
 * Serialize coding runs by key so only one CLI mutates a shared tree at a time.
 * Callers key by project (its repo path) when present, else by agent.
 */
const locks = new Map<string, Promise<unknown>>();

export function codingLockKey(agentId: string, projectWorkspacePath?: string | null): string {
  return projectWorkspacePath ? `project:${projectWorkspacePath}` : `agent:${agentId}`;
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
