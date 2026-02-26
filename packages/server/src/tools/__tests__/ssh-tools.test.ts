import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Mock auth (required by seed.js which is called from migrateDb)
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

import { migrateDb, resetDb } from "../../db/index.js";
import { createSshExecTool } from "../ssh-exec.js";
import { createSshListKeysTool } from "../ssh-list-keys.js";
import { createSshListHostsTool } from "../ssh-list-hosts.js";
import { createSshConnectTool } from "../ssh-connect.js";
import { SshService } from "../../ssh/ssh-service.js";

describe("SSH Tools", () => {
  let tmpDir: string;
  let svc: SshService;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-ssh-tools-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    process.env.HOME = tmpDir;
    await migrateDb();
    svc = new SshService();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    delete process.env.HOME;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ssh_list_keys", () => {
    it("returns empty message when no keys configured", async () => {
      const tool = createSshListKeysTool();
      const result = JSON.parse(await (tool as any).execute({}));
      expect(result.keys).toEqual([]);
      expect(result.message).toContain("No SSH keys configured");
    });

    it("returns all keys with metadata", async () => {
      svc.generateKey({ name: "key1", username: "user1", allowedHosts: ["h1"] });
      svc.generateKey({ name: "key2", username: "user2", allowedHosts: ["h2", "h3"] });

      const tool = createSshListKeysTool();
      const result = JSON.parse(await (tool as any).execute({}));
      expect(result.keys).toHaveLength(2);
      expect(result.keys[0].name).toBeTruthy();
      expect(result.keys[0].username).toBeTruthy();
      expect(result.keys[0].fingerprint).toBeTruthy();
    });
  });

  describe("ssh_list_hosts", () => {
    it("returns hosts for a valid key", async () => {
      const key = svc.generateKey({ name: "hosts-key", username: "admin", allowedHosts: ["10.0.0.1", "10.0.0.2"], port: 2222 });

      const tool = createSshListHostsTool();
      const result = JSON.parse(await (tool as any).execute({ keyId: key.id }));
      expect(result.allowedHosts).toEqual(["10.0.0.1", "10.0.0.2"]);
      expect(result.username).toBe("admin");
      expect(result.port).toBe(2222);
    });

    it("returns error for non-existent key", async () => {
      const tool = createSshListHostsTool();
      const result = JSON.parse(await (tool as any).execute({ keyId: "fake" }));
      expect(result.error).toContain("not found");
    });
  });

  describe("ssh_exec", () => {
    it("rejects non-allowlisted host", async () => {
      const key = svc.generateKey({ name: "exec-key", username: "u", allowedHosts: ["good.host"] });

      const tool = createSshExecTool();
      const result = JSON.parse(await (tool as any).execute({
        keyId: key.id,
        host: "bad.host",
        command: "echo hi",
      }));

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not in the allowlist");
    });

    it("rejects blocked commands", async () => {
      const key = svc.generateKey({ name: "exec-block", username: "u", allowedHosts: ["h1"] });

      const tool = createSshExecTool();
      const result = JSON.parse(await (tool as any).execute({
        keyId: key.id,
        host: "h1",
        command: "rm -rf /etc",
      }));

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Blocked command");
    });

    it("rejects non-existent key", async () => {
      const tool = createSshExecTool();
      const result = JSON.parse(await (tool as any).execute({
        keyId: "nonexistent",
        host: "h1",
        command: "echo hi",
      }));

      expect(result.ok).toBe(false);
      expect(result.error).toContain("SSH key not found");
    });
  });

  describe("ssh_connect", () => {
    it("validates key exists", async () => {
      const tool = createSshConnectTool();
      const result = JSON.parse(await (tool as any).execute({
        keyId: "nonexistent",
        host: "h1",
      }));

      expect(result.error).toContain("not found");
    });

    it("validates host is in allowlist", async () => {
      const key = svc.generateKey({ name: "connect-key", username: "u", allowedHosts: ["good.host"] });

      const tool = createSshConnectTool();
      const result = JSON.parse(await (tool as any).execute({
        keyId: key.id,
        host: "bad.host",
      }));

      expect(result.error).toContain("not in the allowlist");
    });

    it("returns connection parameters for valid request", async () => {
      const key = svc.generateKey({ name: "connect-ok", username: "admin", allowedHosts: ["myhost"], port: 2222 });

      const tool = createSshConnectTool();
      const result = JSON.parse(await (tool as any).execute({
        keyId: key.id,
        host: "myhost",
      }));

      expect(result.ok).toBe(true);
      expect(result.keyId).toBe(key.id);
      expect(result.host).toBe("myhost");
      expect(result.username).toBe("admin");
      expect(result.port).toBe(2222);
    });
  });
});
