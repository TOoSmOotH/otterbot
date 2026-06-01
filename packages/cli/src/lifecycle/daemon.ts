/** Manage the otterbot server as a background daemon. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { probeServer, waitForServer } from "./detect.js";
import {
  dataDirPath,
  envFilePath,
  logFilePath,
  otterHome,
  packageVersion,
  pidFilePath,
  resolveServerTarget,
} from "./paths.js";

/** What we persist about a running daemon. */
interface DaemonRecord {
  pid: number;
  port: number;
  host: string;
  url: string;
  startedAt: string;
  version: string;
}

/** Rotate the daemon log once it grows past this size. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A connectable URL for a server bound to `host`:`port`. */
function healthUrl(host: string, port: number): string {
  const h = !host || host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${h}:${port}`;
}

function ensureHome(): void {
  mkdirSync(otterHome(), { recursive: true, mode: 0o700 });
  mkdirSync(dataDirPath(), { recursive: true });
}

/** Read `OTTERBOT_DB_KEY` from `~/.otterbot/.env`, generating it on first use. */
function ensureDbKey(): string {
  const path = envFilePath();
  if (existsSync(path)) {
    const match = readFileSync(path, "utf8").match(/^OTTERBOT_DB_KEY=(.+)$/m);
    if (match) return match[1].trim();
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(path, `OTTERBOT_DB_KEY=${key}\n`, { mode: 0o600 });
  return key;
}

function readRecord(): DaemonRecord | null {
  try {
    return JSON.parse(readFileSync(pidFilePath(), "utf8")) as DaemonRecord;
  } catch {
    return null;
  }
}

function clearRecord(): void {
  rmSync(pidFilePath(), { force: true });
}

/** True if a process with `pid` exists (regardless of who owns it). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function rotateLog(): void {
  const path = logFilePath();
  try {
    if (existsSync(path) && statSync(path).size > MAX_LOG_BYTES) {
      renameSync(path, `${path}.old`);
    }
  } catch {
    /* best effort — never block a start on log rotation */
  }
}

/** Last `lines` lines of the daemon log. */
function tailLog(lines: number): string {
  try {
    return readFileSync(logFilePath(), "utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "(no log yet)";
  }
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  url?: string;
  startedAt?: string;
  agentCount?: number;
}

/** Inspect the daemon: a live pid plus a health probe. Cleans a stale pid file. */
export async function status(): Promise<DaemonStatus> {
  const rec = readRecord();
  if (!rec) return { running: false };
  if (!pidAlive(rec.pid)) {
    clearRecord();
    return { running: false };
  }
  const probe = await probeServer(rec.url);
  return {
    running: probe.up,
    pid: rec.pid,
    url: rec.url,
    startedAt: rec.startedAt,
    agentCount: probe.up ? probe.agentCount : undefined,
  };
}

export interface StartResult {
  url: string;
  alreadyRunning: boolean;
  devMode: boolean;
}

/** Start the daemon detached. A no-op if a healthy server is already running. */
export async function start(opts: { port: number; host: string }): Promise<StartResult> {
  ensureHome();
  const url = healthUrl(opts.host, opts.port);

  // Already managed by a live pid file and healthy?
  const rec = readRecord();
  if (rec && pidAlive(rec.pid)) {
    const probe = await probeServer(rec.url);
    if (probe.up) return { url: rec.url, alreadyRunning: true, devMode: false };
  }
  // An otterbot server already answering on this port, untracked by us?
  if ((await probeServer(url)).up) {
    return { url, alreadyRunning: true, devMode: false };
  }

  const target = resolveServerTarget();
  const dbKey = ensureDbKey();
  rotateLog();

  // Open the log in append mode; the detached child keeps its own dup of the
  // descriptor, so the parent closes its copy right after spawning.
  const logFd = openSync(logFilePath(), "a");
  let pid: number | undefined;
  try {
    const child = spawn(target.command, target.args, {
      cwd: target.cwd,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        ...target.env,
        PORT: String(opts.port),
        HOST: opts.host,
        DATA_DIR: dataDirPath(),
        OTTERBOT_DB_KEY: dbKey,
      },
    });
    child.unref();
    pid = child.pid;
  } finally {
    closeSync(logFd);
  }
  if (pid === undefined) throw new Error("Failed to spawn the otterbot server process.");

  const record: DaemonRecord = {
    pid,
    port: opts.port,
    host: opts.host,
    url,
    startedAt: new Date().toISOString(),
    version: packageVersion(),
  };
  writeFileSync(pidFilePath(), JSON.stringify(record, null, 2));

  const ready = await waitForServer(url, { timeoutMs: 45_000 });
  if (!ready.up) {
    clearRecord();
    throw new Error(`The otterbot server did not become ready in time.\n\n${tailLog(40)}`);
  }
  return { url, alreadyRunning: false, devMode: target.devMode };
}

export interface StopResult {
  stopped: boolean;
  message: string;
}

/** Stop the daemon. Confirms the pid is a live, responding otterbot first. */
export async function stop(): Promise<StopResult> {
  const rec = readRecord();
  if (!rec) return { stopped: false, message: "otterbot is not running." };
  if (!pidAlive(rec.pid)) {
    clearRecord();
    return { stopped: false, message: "otterbot is not running (cleared a stale pid file)." };
  }
  // Confirm the pid is actually otterbot before signalling it — a pid can be
  // reused by an unrelated process after the daemon dies.
  if (!(await probeServer(rec.url)).up) {
    clearRecord();
    return {
      stopped: false,
      message: `Process ${rec.pid} is not responding as otterbot; left it untouched and cleared the pid file.`,
    };
  }
  process.kill(rec.pid, "SIGTERM");
  for (let i = 0; i < 25; i++) {
    await delay(200);
    if (!pidAlive(rec.pid)) {
      clearRecord();
      return { stopped: true, message: `Stopped otterbot (pid ${rec.pid}).` };
    }
  }
  try {
    process.kill(rec.pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  clearRecord();
  return { stopped: true, message: `Force-stopped otterbot (pid ${rec.pid}).` };
}

/** Ensure a daemon is up, starting one if needed. */
export async function ensureDaemon(opts: { port: number; host: string }): Promise<StartResult> {
  return start(opts);
}

/** Print the daemon log; with `follow`, keep streaming new output until interrupted. */
export async function showLogs(follow: boolean): Promise<void> {
  const path = logFilePath();
  if (!existsSync(path)) {
    console.log("(no log yet — run `otterbot start` first)");
    return;
  }
  process.stdout.write(readFileSync(path, "utf8"));
  if (!follow) return;

  let offset = statSync(path).size;
  for (;;) {
    await delay(500);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size < offset) offset = 0; // log was rotated/truncated
    if (size > offset) {
      const fd = openSync(path, "r");
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);
      process.stdout.write(buf.toString());
      offset = size;
    }
  }
}
