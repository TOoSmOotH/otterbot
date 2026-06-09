import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getConfig } from "../config.js";

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

/**
 * Minimal passwd/group files for the sandbox, generated once per process. The
 * host's real `/etc/passwd` is never exposed; tools still resolve the running
 * uid via getpwuid() against this stub. Returns null if it can't be written
 * (the passwd/group bind is then simply skipped).
 */
let idFiles: { passwd: string; group: string } | null | undefined;
function sandboxIdFiles(): { passwd: string; group: string } | null {
  if (idFiles === undefined) {
    try {
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      const passwd = join(tmpdir(), "otterbot-sandbox-passwd");
      const group = join(tmpdir(), "otterbot-sandbox-group");
      writeFileSync(
        passwd,
        `root:x:0:0:root:/root:/bin/sh\notter:x:${uid}:${gid}:otter:/workspace:/bin/sh\n`,
        { mode: 0o644 }
      );
      writeFileSync(group, `root:x:0:\notter:x:${gid}:\n`, { mode: 0o644 });
      idFiles = { passwd, group };
    } catch {
      idFiles = null;
    }
  }
  return idFiles;
}

/**
 * Environment for the confined command — explicit, never the server's env.
 * `toolsBin`, when set, is the shared coding-CLI bin dir (the tmp-overlay mount);
 * it sits after the per-agent workspace bins so a workspace-local install still
 * takes precedence over the shared one.
 */
function buildEnv(
  home: string,
  secrets: Map<string, string>,
  toolsBin?: string
): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    PATH: [
      `${home}/bin`,
      `${home}/.local/bin`,
      `${home}/.npm-global/bin`,
      ...(toolsBin ? [toolsBin] : []),
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

/**
 * Env that points git at a bound SSH key for transport + (optional) signing.
 * Paths are the locations git will see: the in-sandbox `/workspace/.ssh/*` on
 * bwrap, or the real host paths on macOS (sandbox-exec doesn't remap).
 */
function gitSshEnv(
  gitSsh: GitSshSetup,
  paths: { keyPath: string; knownHostsPath?: string; signingPubPath?: string }
): Record<string, string> {
  const known = paths.knownHostsPath ? ` -o UserKnownHostsFile=${paths.knownHostsPath}` : "";
  const env: Record<string, string> = {
    GIT_SSH_COMMAND: `ssh -i ${paths.keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new${known}`,
  };
  if (gitSsh.committer) {
    env.GIT_AUTHOR_NAME = gitSsh.committer.name;
    env.GIT_AUTHOR_EMAIL = gitSsh.committer.email;
    env.GIT_COMMITTER_NAME = gitSsh.committer.name;
    env.GIT_COMMITTER_EMAIL = gitSsh.committer.email;
  }
  if (paths.signingPubPath) {
    env.GIT_CONFIG_COUNT = "3";
    env.GIT_CONFIG_KEY_0 = "gpg.format";
    env.GIT_CONFIG_VALUE_0 = "ssh";
    env.GIT_CONFIG_KEY_1 = "user.signingkey";
    env.GIT_CONFIG_VALUE_1 = paths.signingPubPath;
    env.GIT_CONFIG_KEY_2 = "commit.gpgsign";
    env.GIT_CONFIG_VALUE_2 = "true";
  }
  return env;
}

// --- Shared coding-CLI tools + credentials ---------------------------------
//
// The coding CLIs (claude/codex/antigravity/opencode) are installed ONCE into a
// shared host dir and their logins live in ONE shared store, so the user
// installs and logs in a single time for all agents — not per agent. Each
// sandbox gets:
//   - the shared tools dir mounted at `/opt/otter-tools` via a `--tmp-overlay`,
//     so binaries are read from the shared base while any writes (e.g. an
//     in-session self-update) go to a throwaway per-mount tmpfs — no agent can
//     poison the shared binaries or another agent's copy.
//   - each tool's credential dir bind-mounted (writable) from the shared store
//     into the sandbox HOME, so a single login authenticates every agent and
//     OAuth token refresh writes back to the shared store.

/** Mount point of the shared coding-CLI tools inside the sandbox. A top-level
 *  path (not under the `--ro-bind`-mounted `/opt`) so bwrap can create it. */
const CODING_TOOLS_MOUNT = "/otter-tools";

/** Per-tool credential dirs, shared across agents. `home` is relative to HOME. */
const SHARED_AUTH_DIRS: { sub: string; home: string }[] = [
  { sub: "claude", home: ".claude" },
  { sub: "codex", home: ".codex" },
  // The Antigravity CLI (`agy`) reuses ~/.gemini for its OAuth creds + state.
  { sub: "gemini", home: ".gemini" },
  { sub: "opencode", home: ".local/share/opencode" },
];

/** Host dir holding the one shared install of the coding CLIs. */
export function sharedCodingToolsDir(): string {
  return join(getConfig().dataDir, "coding-tools");
}

/** Host dir holding the one shared set of coding-CLI logins. */
export function sharedCodingAuthDir(): string {
  return join(getConfig().dataDir, "coding-cli-auth");
}

/** Host path of the generated opencode provider config (bound into the sandbox). */
export function opencodeConfigHostPath(): string {
  return join(sharedCodingAuthDir(), "opencode", "otter.json");
}

/** Where the generated opencode config appears inside the sandbox (HOME=/workspace). */
export const OPENCODE_CONFIG_SANDBOX_PATH = "/workspace/.local/share/opencode/otter.json";

interface CodingShare {
  toolsSrc: string;
  toolsBin: string;
  authBinds: { src: string; dest: string }[];
}

/**
 * Shared tools + credential mounts for an agent's sandbox, or null when no
 * shared install exists yet (so ordinary sandboxes are unchanged until the user
 * installs the coding CLIs). Best-effort ensures the host dirs + workspace
 * mountpoints exist so the binds succeed.
 */
function codingShareFor(workspaceDir: string): CodingShare | null {
  const toolsSrc = sharedCodingToolsDir();
  if (!existsSync(toolsSrc)) return null;
  const authRoot = sharedCodingAuthDir();
  const authBinds = SHARED_AUTH_DIRS.map(({ sub, home }) => ({
    src: join(authRoot, sub),
    dest: `/workspace/${home}`,
  }));
  try {
    for (const { sub, home } of SHARED_AUTH_DIRS) {
      mkdirSync(join(authRoot, sub), { recursive: true });
      // Pre-create the workspace mountpoint so bwrap can bind the store over it.
      mkdirSync(join(workspaceDir, home), { recursive: true });
    }
  } catch {
    /* best-effort; a failed bind below will surface any real problem */
  }
  return { toolsSrc, toolsBin: `${CODING_TOOLS_MOUNT}/bin`, authBinds };
}

interface SpawnPlan {
  file: string;
  args: string[];
  env: Record<string, string> | NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * A Git account's SSH identity to expose for git-over-SSH inside the sandbox.
 * The private key is bound **read-only** (never copied into the workspace) and
 * only when an agent is explicitly assigned a Git-account-backed connection.
 */
export interface GitSshSetup {
  /** Host path to the materialized private key (0600). Must exist at plan-build time. */
  keyPath: string;
  /** Host path to a known_hosts file, if any. */
  knownHostsPath?: string;
  /** Commit author/committer identity. */
  committer?: { name: string; email: string };
  /** Host path to the public key used for SSH commit signing, when enabled. */
  signingKeyPath?: string;
}

export interface SandboxOpts {
  /**
   * Interactive PTY session. Skips bwrap's `--new-session` so the PTY the
   * caller allocated stays the controlling terminal (Ctrl+C / job control).
   */
  interactive?: boolean;
  /**
   * A shared project *workspace* dir to expose, writable, alongside the agent's
   * own workspace. It holds each of the project's repos as a sibling subdir
   * (`<workspace>/<repo>`), so members collaborate across one or more codebases
   * while `HOME` (`/workspace`) — and thus each agent's per-tool CLI credentials
   * — stays private. Several agents in the same project bind the same dir here.
   * On bwrap it is bound at `/project`; on macOS sandbox-exec there is no
   * remapping, so the real path is simply made writable.
   */
  projectWorkspacePath?: string;
  /**
   * Bind the project tree read-only (`--ro-bind`) instead of writable. Used for
   * project members granted read-only access — they can read/grep the source
   * but cannot modify it. bwrap only; sandbox-exec does not enforce this.
   */
  projectReadOnly?: boolean;
  /**
   * Expose a Git account's SSH key for git-over-SSH inside the sandbox. Binds
   * the key read-only at `~/.ssh/id_ed25519` and sets `GIT_SSH_COMMAND` (+ commit
   * signing). Opt-in per connection assignment; capability-gated upstream.
   */
  gitSsh?: GitSshSetup;
  /**
   * Where the command starts. `"project"` requires `projectWorkspacePath` and starts
   * the command inside the shared tree; anything else starts in `/workspace`.
   */
  startIn?: "workspace" | "project";
}

/** Mount point of the shared project tree inside the bwrap sandbox. */
const PROJECT_MOUNT = "/project";

/** bwrap: bind only the workspace writable; system dirs read-only; rest hidden. */
function bwrapPlan(
  workspaceDir: string,
  secrets: Map<string, string>,
  innerArgv: string[],
  opts: SandboxOpts
): SpawnPlan {
  const share = codingShareFor(workspaceDir);
  const env = buildEnv("/workspace", secrets, share?.toolsBin);
  const nodeDir = dirname(process.execPath);
  const ids = sandboxIdFiles();
  const args = [
    "--ro-bind", "/usr", "/usr",
    "--ro-bind-try", "/bin", "/bin",
    "--ro-bind-try", "/sbin", "/sbin",
    "--ro-bind-try", "/lib", "/lib",
    "--ro-bind-try", "/lib32", "/lib32",
    "--ro-bind-try", "/lib64", "/lib64",
    "--ro-bind-try", "/opt", "/opt",
    "--ro-bind-try", nodeDir, nodeDir,
    // Only the slices of /etc tooling needs — DNS, TLS roots, the dynamic
    // linker cache, timezone — never the host's full config directory.
    "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
    "--ro-bind-try", "/etc/hosts", "/etc/hosts",
    "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
    "--ro-bind-try", "/etc/ssl", "/etc/ssl",
    "--ro-bind-try", "/etc/ca-certificates", "/etc/ca-certificates",
    "--ro-bind-try", "/etc/pki", "/etc/pki",
    "--ro-bind-try", "/etc/ld.so.cache", "/etc/ld.so.cache",
    "--ro-bind-try", "/etc/ld.so.conf", "/etc/ld.so.conf",
    "--ro-bind-try", "/etc/ld.so.conf.d", "/etc/ld.so.conf.d",
    "--ro-bind-try", "/etc/alternatives", "/etc/alternatives",
    "--ro-bind-try", "/etc/terminfo", "/etc/terminfo",
    "--ro-bind-try", "/etc/localtime", "/etc/localtime",
    // Stub passwd/group so getpwuid() works without exposing host accounts.
    ...(ids
      ? [
          "--ro-bind-try", ids.passwd, "/etc/passwd",
          "--ro-bind-try", ids.group, "/etc/group",
        ]
      : []),
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--bind", workspaceDir, "/workspace",
  ];
  // Shared coding CLIs: tools via a tmp-overlay (read shared base, writes land
  // in a throwaway tmpfs) + each tool's shared login bound writable into HOME.
  // Must come after the /workspace bind since the auth binds nest under it.
  if (share) {
    args.push("--overlay-src", share.toolsSrc, "--tmp-overlay", CODING_TOOLS_MOUNT);
    for (const b of share.authBinds) args.push("--bind", b.src, b.dest);
  }
  // The shared project tree, when the agent belongs to a project. Bound
  // writable so collaborating agents edit one codebase; HOME stays /workspace.
  if (opts.projectWorkspacePath) {
    args.push(opts.projectReadOnly ? "--ro-bind" : "--bind", opts.projectWorkspacePath, PROJECT_MOUNT);
  }
  // A Git account's SSH key, when the agent has a git-account-backed connection.
  // Bound read-only under HOME/.ssh; the key is never written into the workspace.
  if (opts.gitSsh) {
    args.push("--ro-bind", opts.gitSsh.keyPath, "/workspace/.ssh/id_ed25519");
    if (opts.gitSsh.knownHostsPath) {
      args.push("--ro-bind-try", opts.gitSsh.knownHostsPath, "/workspace/.ssh/known_hosts");
    }
    if (opts.gitSsh.signingKeyPath) {
      args.push("--ro-bind-try", opts.gitSsh.signingKeyPath, "/workspace/.ssh/id_ed25519.pub");
    }
    Object.assign(
      env,
      gitSshEnv(opts.gitSsh, {
        keyPath: "/workspace/.ssh/id_ed25519",
        knownHostsPath: opts.gitSsh.knownHostsPath ? "/workspace/.ssh/known_hosts" : undefined,
        signingPubPath: opts.gitSsh.signingKeyPath ? "/workspace/.ssh/id_ed25519.pub" : undefined,
      })
    );
  }
  const startDir = opts.startIn === "project" && opts.projectWorkspacePath ? PROJECT_MOUNT : "/workspace";
  args.push(
    "--chdir", startDir,
    "--unshare-all",
    "--share-net",
    "--die-with-parent"
  );
  // `--new-session` (setsid) hardens against TIOCSTI injection, but it detaches
  // from the controlling tty — fine for a one-shot command, but it breaks Ctrl+C
  // and job control in an interactive shell. The interactive PTY is dedicated to
  // one session anyway, so there is no shared terminal to inject into.
  if (!opts.interactive) args.push("--new-session");
  args.push("--clearenv");
  for (const [key, value] of Object.entries(env)) args.push("--setenv", key, value);
  args.push("--", ...innerArgv);
  return { file: "bwrap", args, env: process.env };
}

/** sandbox-exec: confine file writes to the workspace (+ temp dirs). */
function sandboxExecPlan(
  workspaceDir: string,
  secrets: Map<string, string>,
  innerArgv: string[],
  opts: SandboxOpts
): SpawnPlan {
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    "(allow file-write*",
    `  (subpath ${JSON.stringify(workspaceDir)})`,
    // The shared project tree, when the agent belongs to a project.
    ...(opts.projectWorkspacePath ? [`  (subpath ${JSON.stringify(opts.projectWorkspacePath)})`] : []),
    '  (subpath "/private/tmp")',
    '  (subpath "/private/var/tmp")',
    '  (subpath "/private/var/folders")',
    '  (literal "/dev/null")',
    '  (regex #"^/dev/tty"))',
  ].join("\n");
  // macOS has no overlay/bind remapping: surface the shared tools on PATH by
  // their real host path (reads are allowed by default). Shared-login binds are
  // bwrap-only, so on macOS each agent still logs in under its own workspace.
  const toolsSrc = sharedCodingToolsDir();
  const toolsBin = existsSync(toolsSrc) ? join(toolsSrc, "bin") : undefined;
  return {
    file: "/usr/bin/sandbox-exec",
    args: ["-p", profile, ...innerArgv],
    env: {
      ...buildEnv(workspaceDir, secrets, toolsBin),
      ...(opts.gitSsh
        ? gitSshEnv(opts.gitSsh, {
            keyPath: opts.gitSsh.keyPath,
            knownHostsPath: opts.gitSsh.knownHostsPath,
            signingPubPath: opts.gitSsh.signingKeyPath,
          })
        : {}),
    },
    // sandbox-exec does not remap paths, so the project's real host path is the
    // working directory when starting in the shared tree.
    cwd: opts.startIn === "project" && opts.projectWorkspacePath ? opts.projectWorkspacePath : workspaceDir,
  };
}

/** Refusal shown when no OS sandbox is available — code never runs unconfined. */
const NO_SANDBOX_ERROR =
  "Shell access needs a sandbox and none is available. Install bubblewrap " +
  "(`apt install bubblewrap`) on Linux, or run otterbot on macOS. " +
  "Refusing to run the command unconfined.";

export interface SandboxPlan {
  plan: SpawnPlan;
  /** The sandbox tool selected. */
  sandbox: string;
}

/**
 * Build the spawn plan that runs `innerArgv` confined to the agent's workspace,
 * picking whichever OS sandbox is available. Returns `{ error }` instead when
 * none is — callers must refuse rather than run unconfined.
 */
export function buildSandboxPlan(
  workspaceDir: string,
  secrets: Map<string, string>,
  innerArgv: string[],
  opts: SandboxOpts = {}
): SandboxPlan | { error: string } {
  if (hasBwrap()) {
    return { plan: bwrapPlan(workspaceDir, secrets, innerArgv, opts), sandbox: "bwrap" };
  }
  if (hasSandboxExec()) {
    return { plan: sandboxExecPlan(workspaceDir, secrets, innerArgv, opts), sandbox: "sandbox-exec" };
  }
  return { error: NO_SANDBOX_ERROR };
}

/**
 * Default `.bashrc` seeded into a fresh workspace. The workspace is the shell's
 * HOME, so this is what the interactive terminal reads. `shell_exec` runs a
 * non-interactive `sh -c` and never sources it — its PATH comes from buildEnv.
 * PATH is re-exported defensively; the prompt and aliases are guarded to the
 * interactive case so sourcing this elsewhere is harmless.
 */
const DEFAULT_BASHRC = `# Seeded by otterbot — edit freely, it won't be overwritten.
export PATH="$HOME/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

case $- in
  *i*)
    PS1='\\[\\e[36m\\]\\w\\[\\e[0m\\] $ '
    alias ll='ls -alF'
    alias la='ls -A'
    alias ..='cd ..'
    alias grep='grep --color=auto'
    ;;
esac
`;

/** Login-shell entry points; both just source `.bashrc`. */
const DEFAULT_PROFILE = `# Seeded by otterbot — edit freely, it won't be overwritten.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
`;

/**
 * Create the workspace directory (and `~/bin`) and seed shell dotfiles on first
 * use. Seeding is best-effort and never clobbers existing files, so the user's
 * own edits in this persistent workspace survive. Both `shell_exec` and the
 * interactive terminal call this before spawning.
 */
export function ensureWorkspace(workspaceDir: string): void {
  try {
    mkdirSync(join(workspaceDir, "bin"), { recursive: true });
  } catch {
    /* the spawn below will surface any real problem */
  }
  const seed = (name: string, contents: string) => {
    const path = join(workspaceDir, name);
    try {
      if (!existsSync(path)) writeFileSync(path, contents, { mode: 0o644 });
    } catch {
      /* best-effort; a missing dotfile is not fatal */
    }
  };
  seed(".bashrc", DEFAULT_BASHRC);
  seed(".bash_profile", DEFAULT_PROFILE);
  seed(".profile", DEFAULT_PROFILE);
}

/** Run a shell command confined to the agent's workspace directory. */
export function runAgentShell(
  workspaceDir: string,
  secrets: Map<string, string>,
  command: string,
  opts: { projectWorkspacePath?: string; projectReadOnly?: boolean; gitSsh?: GitSshSetup } = {}
): Promise<ShellResult> {
  ensureWorkspace(workspaceDir);

  const built = buildSandboxPlan(workspaceDir, secrets, ["/bin/sh", "-c", command], {
    projectWorkspacePath: opts.projectWorkspacePath,
    projectReadOnly: opts.projectReadOnly,
    gitSsh: opts.gitSsh,
  });
  if ("error" in built) {
    return Promise.resolve({
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      truncated: false,
      sandbox: null,
      error: built.error,
    });
  }
  const { plan, sandbox } = built;

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
