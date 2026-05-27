import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, statSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Exercises the SSH integration without touching the network. The pure helpers
 * (allowlist, key generation, sudo command building) are tested directly; a
 * mocked ssh2 `Client` drives `sshExec`'s connect/exec/close flow so we can
 * assert the host allowlist gates a connection and the sudo password is fed to
 * the remote command rather than leaking into the output.
 */

// A fake ssh2 Client that records what it was asked to do and lets the test
// drive its event flow. The most recent instance is exposed for assertions.
let lastClient: FakeClient | undefined;

class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
  stdin = { written: "", write(s: string) { this.written += s; }, end() {} };
}

class FakeClient extends EventEmitter {
  connectOpts: Record<string, unknown> | undefined;
  execCommand: string | undefined;
  stream = new FakeStream();
  constructor() {
    super();
    lastClient = this;
  }
  connect(opts: Record<string, unknown>) {
    this.connectOpts = opts;
    // Drive the host verifier (TOFU) the way ssh2 does during the handshake.
    const verify = opts.hostVerifier as ((key: Buffer, cb: (ok: boolean) => void) => void) | undefined;
    verify?.(Buffer.from("fake-host-key"), () => {});
    queueMicrotask(() => this.emit("ready"));
  }
  exec(command: string, cb: (err: Error | undefined, stream: FakeStream) => void) {
    this.execCommand = command;
    cb(undefined, this.stream);
    // Emit some output then close with the configured exit code.
    queueMicrotask(() => {
      this.stream.emit("data", Buffer.from("hello\n"));
      this.stream.stderr.emit("data", Buffer.from(""));
      this.stream.emit("close", 0);
    });
  }
  end() {}
}

vi.mock("ssh2", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  // ssh2 is CommonJS; its named exports may live on `default`. Keep the real
  // `utils` (used for key generation) and swap only the `Client`.
  const real = (mod.default ?? mod) as Record<string, unknown>;
  return { ...real, ...mod, Client: FakeClient };
});

// Imported after the mock is registered.
const { parseHosts, resolveHost, ensureKey, publicKey, buildRemoteCommand, sshExec } = await import(
  "./ssh.js"
);

function secrets(extra: Record<string, string> = {}): Map<string, string> {
  return new Map(
    Object.entries({
      SSH_HOSTS: JSON.stringify([{ name: "box", host: "10.0.0.7", port: 22, user: "ubuntu" }]),
      ...extra,
    })
  );
}

describe("ssh allowlist", () => {
  it("parses hosts, defaulting the port and dropping incomplete entries", () => {
    const s = secrets({
      SSH_HOSTS: JSON.stringify([
        { host: "a.lan", user: "root" }, // no name → name = host; no port → 22
        { name: "bad", host: "b.lan" }, // missing user → dropped
        { name: "c", user: "x" }, // missing host → dropped
      ]),
    });
    expect(parseHosts(s)).toEqual([{ name: "a.lan", host: "a.lan", port: 22, user: "root" }]);
  });

  it("tolerates an absent or malformed SSH_HOSTS", () => {
    expect(parseHosts(new Map())).toEqual([]);
    expect(parseHosts(new Map([["SSH_HOSTS", "not json"]]))).toEqual([]);
    expect(parseHosts(new Map([["SSH_HOSTS", JSON.stringify({})]]))).toEqual([]);
  });

  it("resolves a host by name or address, case-insensitively", () => {
    expect(resolveHost(secrets(), "box").host).toBe("10.0.0.7");
    expect(resolveHost(secrets(), "10.0.0.7").name).toBe("box");
    expect(resolveHost(secrets(), "BOX").user).toBe("ubuntu");
  });

  it("refuses a host that is not in the allowlist", () => {
    expect(() => resolveHost(secrets(), "evil.lan")).toThrow(/not in this agent's allowlist/);
  });

  it("refuses every host when the allowlist is empty", () => {
    expect(() => resolveHost(new Map(), "box")).toThrow(/No SSH hosts are configured/);
  });
});

describe("ssh key management", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-ssh-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("generates an ed25519 keypair with a 0600 private key, idempotently", () => {
    const first = ensureKey(dir);
    expect(first.generated).toBe(true);
    expect(first.publicKey.startsWith("ssh-ed25519 ")).toBe(true);
    expect(existsSync(join(dir, "id_ed25519"))).toBe(true);
    // Private key is owner-read/write only.
    expect(statSync(join(dir, "id_ed25519")).mode & 0o777).toBe(0o600);

    const second = ensureKey(dir);
    expect(second.generated).toBe(false);
    expect(second.publicKey).toBe(first.publicKey);
  });

  it("publicKey throws before a key exists and returns it afterwards", () => {
    expect(() => publicKey(dir)).toThrow(/Run ssh_generate_key first/);
    const { publicKey: pub } = ensureKey(dir);
    expect(publicKey(dir)).toBe(pub);
  });
});

describe("buildRemoteCommand", () => {
  it("passes a plain command through untouched", () => {
    expect(buildRemoteCommand("ls -la", false, false)).toBe("ls -la");
  });

  it("uses sudo -S with a password and base64-encodes the command", () => {
    const cmd = buildRemoteCommand("apt-get update", true, true);
    const b64 = Buffer.from("apt-get update", "utf8").toString("base64");
    expect(cmd).toBe(`sudo -S -p '' bash -c "$(echo ${b64} | base64 -d)"`);
  });

  it("uses sudo -n when no password is set", () => {
    const cmd = buildRemoteCommand("whoami", true, false);
    expect(cmd.startsWith("sudo -n bash -c ")).toBe(true);
    expect(cmd).not.toContain("-S");
  });
});

describe("sshExec", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "otter-ssh-"));
    lastClient = undefined;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses to connect to a host outside the allowlist", async () => {
    ensureKey(dir);
    await expect(sshExec(dir, secrets(), { host: "evil.lan", command: "id" })).rejects.toThrow(
      /not in this agent's allowlist/
    );
    expect(lastClient).toBeUndefined(); // never attempted a connection
  });

  it("requires a generated key before connecting", async () => {
    await expect(sshExec(dir, secrets(), { host: "box", command: "id" })).rejects.toThrow(
      /Run ssh_generate_key first/
    );
    expect(lastClient).toBeUndefined();
  });

  it("connects with the agent's key and returns command output", async () => {
    ensureKey(dir);
    const res = await sshExec(dir, secrets(), { host: "box", command: "echo hi" });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("hello\n");
    expect(res.host).toBe("box");
    expect(lastClient?.connectOpts?.host).toBe("10.0.0.7");
    expect(lastClient?.connectOpts?.username).toBe("ubuntu");
    expect(lastClient?.execCommand).toBe("echo hi");
    // Records the host key on first connect (trust on first use).
    expect(existsSync(join(dir, "known_hosts.json"))).toBe(true);
  });

  it("feeds the sudo password to the remote command, not the output", async () => {
    ensureKey(dir);
    const res = await sshExec(
      dir,
      secrets({ SSH_SUDO_PASSWORD: "s3cret" }),
      { host: "box", command: "id", sudo: true }
    );
    expect(res.ok).toBe(true);
    expect(lastClient?.execCommand?.startsWith("sudo -S -p '' ")).toBe(true);
    expect(lastClient?.stream.stdin.written).toBe("s3cret\n");
    // The password must never appear in returned output.
    expect(res.stdout).not.toContain("s3cret");
    expect(res.stderr).not.toContain("s3cret");
  });
});
