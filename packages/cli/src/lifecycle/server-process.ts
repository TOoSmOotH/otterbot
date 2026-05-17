/** Boot an Otterbot server as a child process and wait for it to be ready. */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForServer } from "./detect.js";

export interface ServerHandle {
  /** Child process id. */
  pid: number | undefined;
  /** True — this server was started by us, so we own its lifecycle. */
  ownedByUs: true;
  /** Whether the server was launched in dev mode (slower boot). */
  devMode: boolean;
  /** Terminate the server (SIGTERM, escalating to SIGKILL). */
  kill: () => void;
  /** Last lines of the child's stdout/stderr — useful on failure. */
  logTail: () => string;
}

/** Walk up from this file until a directory containing `pnpm-workspace.yaml`. */
export function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("could not locate the Otterbot repo root (pnpm-workspace.yaml not found)");
}

/** Keep only the last `max` lines pushed into it. */
function ringBuffer(max: number) {
  const lines: string[] = [];
  return {
    push(chunk: string) {
      for (const line of chunk.split(/\r?\n/)) {
        if (line) lines.push(line);
      }
      if (lines.length > max) lines.splice(0, lines.length - max);
    },
    tail: () => lines.join("\n"),
  };
}

/**
 * Start the server. Prefers the compiled `packages/server/dist/index.js`; if it
 * is not built, falls back to `pnpm --filter @otterbot/server dev`. Resolves
 * once the server answers a health probe, or rejects if it exits early or the
 * readiness deadline passes.
 */
export async function spawnServer(opts: {
  serverUrl: string;
  port: number;
  host?: string;
  onTick?: (elapsedSec: number) => void;
}): Promise<ServerHandle> {
  const repoRoot = findRepoRoot();
  const distEntry = resolve(repoRoot, "packages/server/dist/index.js");
  const devMode = !existsSync(distEntry);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(opts.port),
    ...(opts.host ? { HOST: opts.host } : {}),
  };

  const child: ChildProcess = devMode
    ? spawn("pnpm", ["--filter", "@otterbot/server", "dev"], {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    : spawn(process.execPath, [distEntry], {
        cwd: repoRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

  const logs = ringBuffer(50);
  child.stdout?.on("data", (d: Buffer) => logs.push(d.toString()));
  child.stderr?.on("data", (d: Buffer) => logs.push(d.toString()));

  let exited = false;
  let exitInfo = "";
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = `server process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
  });

  let killed = false;
  const kill = () => {
    if (killed || exited || child.pid === undefined) return;
    killed = true;
    child.kill("SIGTERM");
    const escalate = setTimeout(() => {
      if (!exited) child.kill("SIGKILL");
    }, 3000);
    escalate.unref();
  };

  // Race readiness against an early exit of the child.
  const ready = waitForServer(opts.serverUrl, { timeoutMs: 30_000, onTick: opts.onTick });
  const result = await ready;

  if (!result.up) {
    kill();
    const detail = exited ? exitInfo : "timed out waiting for the server to become ready";
    throw new Error(`${detail}\n\n${logs.tail()}`);
  }

  return {
    pid: child.pid,
    ownedByUs: true,
    devMode,
    kill,
    logTail: logs.tail,
  };
}
