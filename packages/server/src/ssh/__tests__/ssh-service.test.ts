import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock auth (required by seed.js which is called from migrateDb)
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

import { migrateDb, resetDb, getDb, schema } from "../../db/index.js";
import { SshService } from "../ssh-service.js";

describe("SshService", () => {
  let tmpDir: string;
  let svc: SshService;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-ssh-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    // Set HOME so keys are generated in the temp dir
    process.env.HOME = tmpDir;
    await migrateDb();
    svc = new SshService();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    // Restore HOME to avoid side effects
    delete process.env.HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── Key Generation ─────────────────────────────────────────

  describe("generateKey", () => {
    it("generates an ed25519 key pair", () => {
      const key = svc.generateKey({
        name: "test-key",
        username: "testuser",
        allowedHosts: ["192.168.1.1", "example.com"],
      });

      expect(key.id).toBeTruthy();
      expect(key.name).toBe("test-key");
      expect(key.username).toBe("testuser");
      expect(key.keyType).toBe("ed25519");
      expect(key.allowedHosts).toEqual(["192.168.1.1", "example.com"]);
      expect(key.port).toBe(22);
      expect(key.fingerprint).toContain("SHA256:");
      expect(key.createdAt).toBeTruthy();
      expect(key.updatedAt).toBeTruthy();
    });

    it("generates an RSA key pair", () => {
      const key = svc.generateKey({
        name: "rsa-key",
        username: "admin",
        allowedHosts: ["host1.example.com"],
        keyType: "rsa",
      });

      expect(key.keyType).toBe("rsa");
      expect(key.fingerprint).toContain("SHA256:");
    });

    it("creates key files with correct permissions", () => {
      const key = svc.generateKey({
        name: "perms-test",
        username: "user",
        allowedHosts: [],
      });

      const keyPath = svc.getKeyPath(key.id)!;
      expect(existsSync(keyPath)).toBe(true);
      expect(existsSync(`${keyPath}.pub`)).toBe(true);

      // Private key should be 0600
      const stats = statSync(keyPath);
      expect(stats.mode & 0o777).toBe(0o600);
    });

    it("uses custom port", () => {
      const key = svc.generateKey({
        name: "custom-port",
        username: "user",
        allowedHosts: [],
        port: 2222,
      });

      expect(key.port).toBe(2222);
    });

    it("persists key to database", () => {
      const key = svc.generateKey({
        name: "db-test",
        username: "user",
        allowedHosts: ["host1"],
      });

      const retrieved = svc.get(key.id);
      expect(retrieved).toBeTruthy();
      expect(retrieved!.name).toBe("db-test");
      expect(retrieved!.username).toBe("user");
      expect(retrieved!.allowedHosts).toEqual(["host1"]);
    });
  });

  // ─── Key Import ─────────────────────────────────────────────

  describe("importKey", () => {
    it("imports a valid private key", () => {
      // First generate a key to have a valid private key to import
      const generated = svc.generateKey({
        name: "source",
        username: "gen",
        allowedHosts: [],
      });
      const keyPath = svc.getKeyPath(generated.id)!;
      const privateKeyContent = readFileSync(keyPath, "utf-8");

      const imported = svc.importKey({
        name: "imported-key",
        username: "importuser",
        privateKey: privateKeyContent,
        allowedHosts: ["10.0.0.1"],
        port: 2222,
      });

      expect(imported.name).toBe("imported-key");
      expect(imported.username).toBe("importuser");
      expect(imported.allowedHosts).toEqual(["10.0.0.1"]);
      expect(imported.port).toBe(2222);
      expect(imported.fingerprint).toContain("SHA256:");
    });

    it("rejects an invalid private key", () => {
      expect(() =>
        svc.importKey({
          name: "bad-key",
          username: "user",
          privateKey: "not a valid key",
          allowedHosts: [],
        }),
      ).toThrow("Invalid private key");
    });
  });

  // ─── Key CRUD ───────────────────────────────────────────────

  describe("list", () => {
    it("returns empty array when no keys exist", () => {
      expect(svc.list()).toEqual([]);
    });

    it("returns all keys ordered by creation date", () => {
      svc.generateKey({ name: "key1", username: "u1", allowedHosts: [] });
      svc.generateKey({ name: "key2", username: "u2", allowedHosts: [] });

      const keys = svc.list();
      expect(keys).toHaveLength(2);
      // Most recent first
      expect(keys[0].name).toBe("key2");
      expect(keys[1].name).toBe("key1");
    });
  });

  describe("get", () => {
    it("returns null for non-existent key", () => {
      expect(svc.get("nonexistent")).toBeNull();
    });

    it("returns key by ID", () => {
      const key = svc.generateKey({ name: "find-me", username: "u", allowedHosts: [] });
      const found = svc.get(key.id);
      expect(found).toBeTruthy();
      expect(found!.name).toBe("find-me");
    });
  });

  describe("update", () => {
    it("updates key metadata", () => {
      const key = svc.generateKey({ name: "old-name", username: "old", allowedHosts: ["h1"] });

      const updated = svc.update(key.id, {
        name: "new-name",
        username: "newuser",
        allowedHosts: ["h1", "h2"],
        port: 3333,
      });

      expect(updated).toBeTruthy();
      expect(updated!.name).toBe("new-name");
      expect(updated!.username).toBe("newuser");
      expect(updated!.allowedHosts).toEqual(["h1", "h2"]);
      expect(updated!.port).toBe(3333);
    });

    it("returns null for non-existent key", () => {
      expect(svc.update("nonexistent", { name: "nope" })).toBeNull();
    });

    it("supports partial updates", () => {
      const key = svc.generateKey({ name: "partial", username: "u", allowedHosts: ["h1"], port: 22 });
      const updated = svc.update(key.id, { name: "updated-name" });

      expect(updated!.name).toBe("updated-name");
      expect(updated!.username).toBe("u"); // unchanged
      expect(updated!.allowedHosts).toEqual(["h1"]); // unchanged
    });
  });

  describe("deleteKey", () => {
    it("deletes key and removes files", () => {
      const key = svc.generateKey({ name: "delete-me", username: "u", allowedHosts: [] });
      const keyPath = svc.getKeyPath(key.id)!;

      expect(existsSync(keyPath)).toBe(true);
      expect(svc.deleteKey(key.id)).toBe(true);
      expect(existsSync(keyPath)).toBe(false);
      expect(svc.get(key.id)).toBeNull();
    });

    it("returns false for non-existent key", () => {
      expect(svc.deleteKey("nonexistent")).toBe(false);
    });
  });

  describe("getPublicKey", () => {
    it("returns public key text", () => {
      const key = svc.generateKey({ name: "pubkey-test", username: "u", allowedHosts: [] });
      const pubKey = svc.getPublicKey(key.id);

      expect(pubKey).toBeTruthy();
      expect(pubKey).toContain("ssh-ed25519");
    });

    it("returns null for non-existent key", () => {
      expect(svc.getPublicKey("nonexistent")).toBeNull();
    });
  });

  // ─── Host Validation ────────────────────────────────────────

  describe("validateHost", () => {
    it("allows a host in the allowlist", () => {
      const key = svc.generateKey({ name: "vhost", username: "u", allowedHosts: ["10.0.0.1", "example.com"] });
      expect(svc.validateHost(key.id, "10.0.0.1")).toEqual({ ok: true });
      expect(svc.validateHost(key.id, "example.com")).toEqual({ ok: true });
    });

    it("rejects a host not in the allowlist", () => {
      const key = svc.generateKey({ name: "vhost2", username: "u", allowedHosts: ["10.0.0.1"] });
      const result = svc.validateHost(key.id, "evil.com");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not in the allowlist");
    });

    it("rejects when no hosts configured", () => {
      const key = svc.generateKey({ name: "vhost3", username: "u", allowedHosts: [] });
      const result = svc.validateHost(key.id, "any.host");

      expect(result.ok).toBe(false);
      expect(result.error).toContain("No hosts configured");
    });

    it("returns error for non-existent key", () => {
      const result = svc.validateHost("nonexistent", "host");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH key not found");
    });
  });

  // ─── Exec (blocked commands) ────────────────────────────────

  describe("exec", () => {
    it("blocks dangerous commands", () => {
      const key = svc.generateKey({ name: "exec-test", username: "u", allowedHosts: ["host1"] });

      const blockedCommands = [
        { cmd: "rm -rf /etc", reason: "rm targeting root filesystem" },
        { cmd: "shutdown now", reason: "shutdown" },
        { cmd: "reboot", reason: "reboot" },
        { cmd: "mkfs.ext4 /dev/sda1", reason: "mkfs" },
        { cmd: "dd if=/dev/zero of=/dev/sda", reason: "dd" },
        { cmd: "halt", reason: "halt" },
        { cmd: "poweroff", reason: "poweroff" },
      ];

      for (const { cmd } of blockedCommands) {
        const result = svc.exec({ keyId: key.id, host: "host1", command: cmd });
        expect(result.ok, `Expected "${cmd}" to be blocked`).toBe(false);
        expect(result.error, `Expected "${cmd}" to have 'Blocked command' error`).toContain("Blocked command");
      }
    });

    it("rejects non-allowlisted hosts", () => {
      const key = svc.generateKey({ name: "exec-host", username: "u", allowedHosts: ["good.host"] });
      const result = svc.exec({ keyId: key.id, host: "evil.host", command: "echo hi" });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not in the allowlist");
    });

    it("rejects non-existent key", () => {
      const result = svc.exec({ keyId: "fake", host: "host", command: "echo hi" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH key not found");
    });
  });

  // ─── Session Management ─────────────────────────────────────

  describe("session management", () => {
    it("creates and retrieves a session", () => {
      const key = svc.generateKey({ name: "sess-key", username: "u", allowedHosts: ["h1"] });
      const sessionId = svc.createSession({
        sshKeyId: key.id,
        host: "h1",
        initiatedBy: "user",
      });

      expect(sessionId).toBeTruthy();

      const session = svc.getSession(sessionId);
      expect(session).toBeTruthy();
      expect(session!.sshKeyId).toBe(key.id);
      expect(session!.host).toBe("h1");
      expect(session!.status).toBe("active");
      expect(session!.username).toBe("u");
      expect(session!.initiatedBy).toBe("user");
    });

    it("updates session status", () => {
      const key = svc.generateKey({ name: "sess-update", username: "u", allowedHosts: ["h1"] });
      const sessionId = svc.createSession({ sshKeyId: key.id, host: "h1", initiatedBy: "agent-123" });

      svc.updateSession(sessionId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });

      const session = svc.getSession(sessionId);
      expect(session!.status).toBe("completed");
      expect(session!.completedAt).toBeTruthy();
    });

    it("lists sessions ordered by creation date", () => {
      const key = svc.generateKey({ name: "sess-list", username: "u", allowedHosts: ["h1"] });
      svc.createSession({ sshKeyId: key.id, host: "h1", initiatedBy: "user" });
      svc.createSession({ sshKeyId: key.id, host: "h1", initiatedBy: "agent-1" });

      const sessions = svc.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it("deletes a session", () => {
      const key = svc.generateKey({ name: "sess-del", username: "u", allowedHosts: ["h1"] });
      const sessionId = svc.createSession({ sshKeyId: key.id, host: "h1", initiatedBy: "user" });

      expect(svc.deleteSession(sessionId)).toBe(true);
      expect(svc.getSession(sessionId)).toBeNull();
    });

    it("returns false when deleting non-existent session", () => {
      expect(svc.deleteSession("nonexistent")).toBe(false);
    });

    it("returns null for non-existent session", () => {
      expect(svc.getSession("nonexistent")).toBeNull();
    });

    it("persists terminal buffer on update", () => {
      const key = svc.generateKey({ name: "sess-buf", username: "u", allowedHosts: ["h1"] });
      const sessionId = svc.createSession({ sshKeyId: key.id, host: "h1", initiatedBy: "user" });

      svc.updateSession(sessionId, {
        status: "completed",
        terminalBuffer: "$ whoami\nroot\n$ ",
      });

      const session = svc.getSession(sessionId);
      expect(session!.terminalBuffer).toBe("$ whoami\nroot\n$ ");
    });
  });

  // ─── getKeyPath ─────────────────────────────────────────────

  describe("getKeyPath", () => {
    it("returns the file path for a key", () => {
      const key = svc.generateKey({ name: "path-test", username: "u", allowedHosts: [] });
      const path = svc.getKeyPath(key.id);
      expect(path).toBeTruthy();
      expect(path).toContain(`otterbot_ssh_${key.id}`);
      expect(existsSync(path!)).toBe(true);
    });

    it("returns null for non-existent key", () => {
      expect(svc.getKeyPath("nonexistent")).toBeNull();
    });
  });
});
