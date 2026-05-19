import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The "local" shell backend for an agent's `shell_exec` tool.
 *
 * Commands run on the host machine but are confined to the agent's own
 * workspace directory by a lightweight OS sandbox — `bwrap` (bubblewrap) on
 * Linux, `sandbox-exec` on macOS. The workspace is the only writable location
 * and, on Linux, the only host directory the command can even see; the host
 * home, otterbot's data and other agents are not mounted. If neither sandbox
 * tool is available the command is refused — it never runs unconfined.
 */

export interface ShellResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** The sandbox used, or null when the command could not be run. */
  sandbox: string | null;
  /** Set when the command could not be run at all. */
  error?: string;
}

/** Generous — long enough for `npm install` and friends. */
const TIMEOUT_MS = 300_000;
/** Per-stream output returned to the model. */
const MAX_OUTPUT = 24_000;
/** Hard cap on what we buffer in memory, per stream. */
const MAX_BUFFER = 8 * 1024 * 1024;

let bwrapChecked = false;
let bwrapOk = false;

/** Whether `bwrap` (bubblewrap) is available — checked once and cached. */
function hasBwrap(): boolean {
  if (!bwrapChecked) {
    bwrapChecked = true;
    try {
      bwrapOk = spawnSync("bwrap", ["--version"], { timeout: 4000 }).status === 0;
    } catch {
      bwrapOk = false;
    }
  }
  return bwrapOk;
}

function hasSandboxExec(): boolean {
  return process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec");
}

/** Environment for the confined command — explicit, never the server's env. */
function buildEnv(home: string, secrets: Map<string, string>): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    PATH: [
      `${home}/.npm-global/bin`,
      "/usr/local/sbin",
      "/usr/local/bin",
      "/usr/sbin",
      "/usr/bin",
      "/sbin",
      "/bin",
    ].join(":"),
    // Keep `npm i -g` installs inside the workspace so they persist per-agent.
    npm_config_prefix: `${home}/.npm-global`,
    TERM: "xterm-256color",
    LANG: process.env.LANG ?? "C.UTF-8",
  };
  // The agent's own credentials (GITHUB_TOKEN, ANTHROPIC_API_KEY, …) so tools
  // like `gh` and `claude` work. Only well-formed env var names.
  for (const [key, value] of secrets) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
  }
  return env;
}

interface SpawnPlan {
  file: string;
  args: string[];
  env: Record<string, string> | NodeJS.ProcessEnv;
  cwd?: string;
}

/** bwrap: bind only the workspace writable; system dirs read-only; rest hidden. */
function bwrapPlan(workspaceDir: string, secrets: Map<string, string>, command: string): SpawnPlan {
  const env = buildEnv("/workspace", secrets);
  const nodeDir = dirname(process.execPath);
  const args = [
    "--ro-bind", "/usr", "/usr",
    "--ro-bind-try", "/bin", "/bin",
    "--ro-bind-try", "/sbin", "/sbin",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib32", "/lib32",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/etc", "/etc",
    "--ro-bind-try", "/opt", "/opt",
    "--ro-bind-try", nodeDir, nodeDir,
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--bind", workspaceDir, "/workspace",
    "--chdir", "/workspace",
    "--unshare-all",
    "--share-net",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
  ];
  for (const [key, value] of Object.entries(env)) args.push("--setenv", key, value);
  args.push("--", "/bin/sh", "-c", command);
  return { file: "bwrap", args, env: process.env };
}

/** sandbox-exec: confine file writes to the workspace (+ temp dirs). */
function sandboxExecPlan(
  workspaceDir: string,
  secrets: Map<string, string>,
  command: string
): SpawnPlan {
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    `  (subpath ${JSON.stringify(workspaceDir)})`,
    '  (subpath "/private/tmp")',
    '  (subpath "/private/var/tmp")',
    '  (subpath "/private/var/folders")',
    '  (literal "/dev/null")',
    '  (regex #"^/dev/tty"))',
  ].join("\n");
  return {
    file: "/usr/bin/sandbox-exec",
    args: ["-p", profile, "/bin/sh", "-c", command],
    env: buildEnv(workspaceDir, secrets),
    cwd: workspaceDir,
  };
}

/** Run a shell command confined to the agent's workspace directory. */
export function runAgentShell(
  workspaceDir: string,
  secrets: Map<string, string>,
  command: string
): Promise<ShellResult> {
  try {
    mkdirSync(workspaceDir, { recursive: true });
  } catch {
    /* the spawn below will surface any real problem */
  }

  let plan: SpawnPlan;
  let sandbox: string;
  if (hasBwrap()) {
    plan = bwrapPlan(workspaceDir, secrets, command);
    sandbox = "bwrap";
  } else if (hasSandboxExec()) {
    plan = sandboxExecPlan(workspaceDir, secrets, command);
    sandbox = "sandbox-exec";
  } else {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      truncated: false,
      sandbox: null,
      error:
        "Shell access needs a sandbox and none is available. Install bubblewrap " +
        "(`apt install bubblewrap`) on Linux, or run otterbot on macOS. " +
        "Refusing to run the command unconfined.",
    });
  }

  return new Promise<ShellResult>((resolve) => {
    const child = spawn(plan.file, plan.args, { cwd: plan.cwd, env: plan.env });
    let stdout = "";
    let stderr = "";
    let dropped = false;
    let timedOut = false;
    let done = false;

    const collect = (chunk: Buffer, into: "out" | "err") => {
      const text = chunk.toString("utf8");
      if (into === "out") {
        if (stdout.length < MAX_BUFFER) stdout += text;
        else dropped = true;
      } else {
        if (stderr.length < MAX_BUFFER) stderr += text;
        else dropped = true;
      }
    };
    child.stdout?.on("data", (c: Buffer) => collect(c, "out"));
    child.stderr?.on("data", (c: Buffer) => collect(c, "err"));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    const finish = (result: ShellResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.on("error", (err) => {
      finish({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        truncated: false,
        sandbox,
        error: `failed to start the sandbox (${sandbox}): ${err.message}`,
      });
    });

    child.on("close", (code) => {
      const clip = (s: string) =>
        s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n…[output truncated]" : s;
      const outClipped = clip(stdout);
      const errClipped = clip(stderr);
      finish({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout: outClipped,
        stderr: errClipped,
        timedOut,
        truncated: dropped || outClipped.length < stdout.length || errClipped.length < stderr.length,
        sandbox,
      });
    });
  });
}
