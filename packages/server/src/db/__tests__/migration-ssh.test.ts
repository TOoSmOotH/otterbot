import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb, getDb, schema } from "../index.js";
import { eq } from "drizzle-orm";

// Mock auth (required by seed.js which is called from migrateDb)
vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn(() => undefined),
  setConfig: vi.fn(),
  deleteConfig: vi.fn(),
}));

describe("DB Migration — SSH tables", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-db-ssh-test-"));
    resetDb();
    process.env.DATABASE_URL = `file:${join(tmpDir, "test.db")}`;
    process.env.OTTERBOT_DB_KEY = "test-key";
    await migrateDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.DATABASE_URL;
    delete process.env.OTTERBOT_DB_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates ssh_keys table", () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.insert(schema.sshKeys)
      .values({
        id: "test-key-1",
        name: "Test Key",
        username: "testuser",
        privateKeyPath: "/tmp/test",
        fingerprint: "SHA256:abc123",
        keyType: "ed25519",
        allowedHosts: ["host1", "host2"],
        port: 22,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const key = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, "test-key-1")).get();
    expect(key).toBeTruthy();
    expect(key!.name).toBe("Test Key");
    expect(key!.username).toBe("testuser");
    expect(key!.privateKeyPath).toBe("/tmp/test");
    expect(key!.fingerprint).toBe("SHA256:abc123");
    expect(key!.keyType).toBe("ed25519");
    expect(key!.allowedHosts).toEqual(["host1", "host2"]);
    expect(key!.port).toBe(22);
  });

  it("creates ssh_sessions table", () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.insert(schema.sshSessions)
      .values({
        id: "test-session-1",
        sshKeyId: "key-1",
        host: "example.com",
        status: "active",
        startedAt: now,
        initiatedBy: "user",
        createdAt: now,
      })
      .run();

    const session = db.select().from(schema.sshSessions).where(eq(schema.sshSessions.id, "test-session-1")).get();
    expect(session).toBeTruthy();
    expect(session!.sshKeyId).toBe("key-1");
    expect(session!.host).toBe("example.com");
    expect(session!.status).toBe("active");
    expect(session!.initiatedBy).toBe("user");
    expect(session!.completedAt).toBeNull();
    expect(session!.terminalBuffer).toBeNull();
  });

  it("supports session terminal buffer", () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.insert(schema.sshSessions)
      .values({
        id: "test-session-buf",
        sshKeyId: "key-1",
        host: "example.com",
        status: "completed",
        startedAt: now,
        completedAt: now,
        terminalBuffer: "$ echo hello\nhello\n$ ",
        initiatedBy: "agent-123",
        createdAt: now,
      })
      .run();

    const session = db.select().from(schema.sshSessions).where(eq(schema.sshSessions.id, "test-session-buf")).get();
    expect(session!.terminalBuffer).toBe("$ echo hello\nhello\n$ ");
    expect(session!.initiatedBy).toBe("agent-123");
  });

  it("stores allowedHosts as JSON array", () => {
    const db = getDb();
    const now = new Date().toISOString();
    const hosts = ["192.168.1.1", "10.0.0.1", "prod.example.com"];

    db.insert(schema.sshKeys)
      .values({
        id: "test-hosts",
        name: "Hosts Test",
        username: "root",
        privateKeyPath: "/tmp/k",
        fingerprint: "SHA256:xyz",
        keyType: "rsa",
        allowedHosts: hosts,
        port: 2222,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const key = db.select().from(schema.sshKeys).where(eq(schema.sshKeys.id, "test-hosts")).get();
    expect(key!.allowedHosts).toEqual(hosts);
    expect(key!.keyType).toBe("rsa");
    expect(key!.port).toBe(2222);
  });

  it("seeds SSH Administrator registry entry", () => {
    const db = getDb();
    const entry = db.select().from(schema.registryEntries).where(eq(schema.registryEntries.id, "builtin-ssh-administrator")).get();
    expect(entry).toBeTruthy();
    expect(entry!.name).toBe("SSH Administrator");
    expect(entry!.role).toBe("worker");
    expect(entry!.builtIn).toBe(true);
  });

  it("seeds SSH administration skill", () => {
    const db = getDb();
    const skill = db.select().from(schema.skills).where(eq(schema.skills.id, "builtin-skill-ssh-administration")).get();
    expect(skill).toBeTruthy();
    expect(skill!.name).toBe("SSH Administration");
    expect(skill!.tools).toContain("ssh_exec");
    expect(skill!.tools).toContain("ssh_list_keys");
    expect(skill!.tools).toContain("ssh_list_hosts");
    expect(skill!.tools).toContain("ssh_connect");
  });

  it("assigns SSH skill to SSH Administrator", () => {
    const db = getDb();
    const assignments = db.select().from(schema.agentSkills)
      .where(eq(schema.agentSkills.registryEntryId, "builtin-ssh-administrator"))
      .all();
    expect(assignments.some((a) => a.skillId === "builtin-skill-ssh-administration")).toBe(true);
  });
});
