/**
 * Per-agent SSH remote access.
 *
 * The agent has one managed `ed25519` keypair stored under its own profile
 * (`ssh/id_ed25519`, mode 0600). It never leaves the host and is *not* in the
 * sandboxed workspace, so `shell_exec` cannot read it. The user copies the
 * agent's public key into a remote host's `authorized_keys` to grant
 * passwordless login.
 *
 * Connections are gated by an allowlist: the agent may only reach the hosts the
 * user configured (`SSH_HOSTS`). An empty list means no access — fail-safe, like
 * the Proxmox vmid allowlist. Privileged commands (`sudo: true`) feed the stored
 * `SSH_SUDO_PASSWORD` to `sudo -S`, falling back to passwordless `sudo -n` when
 * no password is set.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Client, utils } from "ssh2";

/** Long enough for installs and test runs, matching the shell tool's budget. */
const TIMEOUT_MS = 300_000;
/** Per-stream output returned to the model. */
const MAX_OUTPUT = 24_000;
/** Handshake timeout — fail fast on an unreachable or wrong host. */
const READY_TIMEOUT_MS = 20_000;

const KEY_NAME = "id_ed25519";

/** A host the agent is allowed to reach, as configured in `SSH_HOSTS` (JSON). */
export interface ConfiguredHost {
  /** Friendly label the agent addresses the host by (defaults to `host`). */
  name: string;
  /** Hostname or IP to connect to. */
  host: string;
  port: number;
  /** Remote login user. */
  user: string;
}

/**
 * The agent's configured host allowlist (`SSH_HOSTS`, JSON). Tolerates an absent
 * or malformed value by returning an empty list rather than throwing — an empty
 * list simply means the agent may reach nothing.
 */
export function parseHosts(secrets: Map<string, string>): ConfiguredHost[] {
  const raw = secrets.get("SSH_HOSTS");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((v) => {
      const o = (v ?? {}) as { name?: unknown; host?: unknown; port?: unknown; user?: unknown };
      const host = typeof o.host === "string" ? o.host.trim() : "";
      const user = typeof o.user === "string" ? o.user.trim() : "";
      if (!host || !user) return null;
      const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : host;
      const port = Number(o.port);
      return {
        name,
        host,
        user,
        port: Number.isInteger(port) && port > 0 ? port : 22,
      };
    })
    .filter((h): h is ConfiguredHost => h !== null);
}

/**
 * Resolve a host reference (a configured `name` or `host`) to its full config.
 * This is the allowlist gate: any host not in `SSH_HOSTS` is refused, and an
 * empty list refuses everything. Matching is case-insensitive.
 */
export function resolveHost(secrets: Map<string, string>, ref: string): ConfiguredHost {
  const hosts = parseHosts(secrets);
  if (hosts.length === 0) {
    throw new Error(
      "No SSH hosts are configured for this agent. Add hosts in this skill's " +
        "Configure panel (the SSH_HOSTS allowlist) before connecting."
    );
  }
  const needle = ref.trim().toLowerCase();
  const match = hosts.find(
    (h) => h.name.toLowerCase() === needle || h.host.toLowerCase() === needle
  );
  if (!match) {
    throw new Error(
      `Host "${ref}" is not in this agent's allowlist ` +
        `(${hosts.map((h) => h.name).join(", ")}).`
    );
  }
  return match;
}

function privateKeyPath(sshDir: string): string {
  return join(sshDir, KEY_NAME);
}

function publicKeyPath(sshDir: string): string {
  return join(sshDir, `${KEY_NAME}.pub`);
}

/**
 * Ensure the agent has an `ed25519` keypair, generating one on first use.
 * Idempotent: returns the existing public key when already present. The private
 * key is written 0600 and stays out of the shell sandbox.
 */
export function ensureKey(sshDir: string): { publicKey: string; generated: boolean } {
  mkdirSync(sshDir, { recursive: true });
  const priv = privateKeyPath(sshDir);
  const pub = publicKeyPath(sshDir);
  if (existsSync(priv) && existsSync(pub)) {
    return { publicKey: readFileSync(pub, "utf8").trim(), generated: false };
  }
  const pair = utils.generateKeyPairSync("ed25519");
  writeFileSync(priv, pair.private, { mode: 0o600 });
  writeFileSync(pub, pair.public, { mode: 0o644 });
  return { publicKey: pair.public.trim(), generated: true };
}

/** The agent's public key, or a clear error if it hasn't generated one yet. */
export function publicKey(sshDir: string): string {
  const pub = publicKeyPath(sshDir);
  if (!existsSync(pub)) {
    throw new Error("No SSH key yet for this agent. Run ssh_generate_key first.");
  }
  return readFileSync(pub, "utf8").trim();
}

/**
 * Wrap a user command for remote execution. Without sudo the command runs as-is
 * under the login shell. With sudo it is base64-encoded and decoded remotely so
 * arbitrary quoting can't break the wrapper or be injected into it; `sudo -S`
 * reads the password from stdin when one is available, otherwise `sudo -n`
 * requires passwordless (NOPASSWD) sudo.
 */
export function buildRemoteCommand(command: string, sudo: boolean, hasPassword: boolean): string {
  if (!sudo) return command;
  const b64 = Buffer.from(command, "utf8").toString("base64");
  const inner = `bash -c "$(echo ${b64} | base64 -d)"`;
  // base64/echo run in a command substitution and don't read our stdin, so the
  // password we write flows to sudo's prompt.
  return hasPassword ? `sudo -S -p '' ${inner}` : `sudo -n ${inner}`;
}

function clamp(s: string): { text: string; truncated: boolean } {
  if (s.length <= MAX_OUTPUT) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_OUTPUT), truncated: true };
}

interface KnownHosts {
  [hostPort: string]: string;
}

function knownHostsPath(sshDir: string): string {
  return join(sshDir, "known_hosts.json");
}

function readKnownHosts(sshDir: string): KnownHosts {
  const p = knownHostsPath(sshDir);
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as KnownHosts) : {};
  } catch {
    return {};
  }
}

/**
 * Trust-on-first-use host-key check. The first time we see a host we record a
 * hash of its key and accept; afterwards a changed key is refused (a possible
 * man-in-the-middle). Returns whether the presented key is acceptable.
 */
function verifyHostKey(sshDir: string, hostPort: string, key: Buffer): boolean {
  const fingerprint = createHash("sha256").update(key).digest("base64");
  const store = readKnownHosts(sshDir);
  const known = store[hostPort];
  if (!known) {
    store[hostPort] = fingerprint;
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(knownHostsPath(sshDir), JSON.stringify(store, null, 2), { mode: 0o600 });
    return true;
  }
  return known === fingerprint;
}

export interface SshExecResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  host: string;
}

export interface SshExecOptions {
  /** A configured host `name` or `host` (validated against the allowlist). */
  host: string;
  command: string;
  /** Run the command as root via sudo. */
  sudo?: boolean;
}

/**
 * Connect to an allowlisted host with the agent's key and run a command,
 * optionally as root. Resolves with structured output (never the password); a
 * connection or auth failure rejects with a descriptive error.
 */
export async function sshExec(
  sshDir: string,
  secrets: Map<string, string>,
  opts: SshExecOptions
): Promise<SshExecResult> {
  const target = resolveHost(secrets, opts.host); // allowlist gate (may throw)
  const priv = privateKeyPath(sshDir);
  if (!existsSync(priv)) {
    throw new Error("No SSH key yet for this agent. Run ssh_generate_key first.");
  }
  const privateKey = readFileSync(priv);
  const password = secrets.get("SSH_SUDO_PASSWORD") ?? "";
  const remoteCommand = buildRemoteCommand(opts.command, opts.sudo ?? false, password.length > 0);
  const hostPort = `${target.host}:${target.port}`;

  return new Promise<SshExecResult>((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      conn.end();
    }, TIMEOUT_MS);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    conn.on("ready", () => {
      conn.exec(remoteCommand, (err, stream) => {
        if (err) {
          conn.end();
          return finish(() => reject(err));
        }
        // Feed the sudo password (if any) then close stdin.
        if (opts.sudo && password) {
          stream.stdin.write(`${password}\n`);
        }
        stream.stdin.end();
        let exitCode: number | null = null;
        stream.on("data", (d: Buffer) => {
          if (stdout.length < MAX_OUTPUT) stdout += d.toString();
        });
        stream.stderr.on("data", (d: Buffer) => {
          if (stderr.length < MAX_OUTPUT) stderr += d.toString();
        });
        stream.on("close", (code: number | null) => {
          exitCode = typeof code === "number" ? code : null;
          conn.end();
          const out = clamp(stdout);
          const errOut = clamp(stderr);
          finish(() =>
            resolve({
              ok: exitCode === 0 && !timedOut,
              exitCode,
              stdout: out.text,
              stderr: errOut.text,
              truncated: out.truncated || errOut.truncated,
              timedOut,
              host: target.name,
            })
          );
        });
      });
    });

    conn.on("error", (err: Error) => {
      finish(() =>
        reject(
          timedOut
            ? new Error(`SSH command timed out after ${TIMEOUT_MS / 1000}s on ${target.name}.`)
            : new Error(`SSH to ${target.name} (${hostPort}) failed: ${err.message}`)
        )
      );
    });

    conn.connect({
      host: target.host,
      port: target.port,
      username: target.user,
      privateKey,
      readyTimeout: READY_TIMEOUT_MS,
      hostVerifier: (key: Buffer, cb: (ok: boolean) => void) =>
        cb(verifyHostKey(sshDir, hostPort, key)),
    });
  });
}
