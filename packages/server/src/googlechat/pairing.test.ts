import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../db/index.js";
import { getConfig, setConfig } from "../auth/auth.js";
import {
  approvePairing,
  generatePairingCode,
  getPairedUser,
  isPaired,
  listPairedUsers,
  listPendingPairings,
  rejectPairing,
  revokePairing,
} from "./pairing.js";

describe("googlechat pairing", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-googlechat-pairing-test-"));
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

  it("generates and replaces pending code for the same Google Chat user", () => {
    const first = generatePairingCode("users/1", "Alice");
    const second = generatePairingCode("users/1", "Alice");

    expect(first).toMatch(/^[A-F0-9]{6}$/);
    expect(second).toMatch(/^[A-F0-9]{6}$/);
    expect(getConfig(`googlechat:pairing:${first}`)).toBeUndefined();
    expect(getConfig(`googlechat:pairing:${second}`)).toBeDefined();
  });

  it("approves valid codes and persists paired user", () => {
    const code = generatePairingCode("users/1", "Alice");

    const paired = approvePairing(code);

    expect(paired).toMatchObject({
      googleChatUserId: "users/1",
      googleChatUsername: "Alice",
    });
    expect(isPaired("users/1")).toBe(true);
    expect(getPairedUser("users/1")).toMatchObject({
      googleChatUserId: "users/1",
      googleChatUsername: "Alice",
    });
    expect(getConfig(`googlechat:pairing:${code}`)).toBeUndefined();
  });

  it("rejects expired pairing codes and deletes them", () => {
    setConfig("googlechat:pairing:EXPIRED", JSON.stringify({
      code: "EXPIRED",
      googleChatUserId: "users/old",
      googleChatUsername: "Old User",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }));

    const approved = approvePairing("EXPIRED");

    expect(approved).toBeNull();
    expect(getConfig("googlechat:pairing:EXPIRED")).toBeUndefined();
  });

  it("lists paired users and filters malformed or expired pending records", () => {
    setConfig("googlechat:paired:users/1", JSON.stringify({
      googleChatUserId: "users/1",
      googleChatUsername: "Alice",
      pairedAt: new Date().toISOString(),
    }));
    setConfig("googlechat:paired:broken", "{bad-json");

    setConfig("googlechat:pairing:VALID1", JSON.stringify({
      code: "VALID1",
      googleChatUserId: "users/2",
      googleChatUsername: "Bob",
      createdAt: new Date().toISOString(),
    }));
    setConfig("googlechat:pairing:EXPIRED", JSON.stringify({
      code: "EXPIRED",
      googleChatUserId: "users/3",
      googleChatUsername: "Carol",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }));
    setConfig("googlechat:pairing:BROKEN", "{bad-json");

    const paired = listPairedUsers();
    const pending = listPendingPairings();

    expect(paired).toHaveLength(1);
    expect(paired[0]?.googleChatUserId).toBe("users/1");
    expect(pending).toHaveLength(1);
    expect(pending[0]?.code).toBe("VALID1");
    expect(getConfig("googlechat:pairing:EXPIRED")).toBeUndefined();
  });

  it("rejects and revokes pairings", () => {
    const code = generatePairingCode("users/1", "Alice");

    expect(rejectPairing(code)).toBe(true);
    expect(rejectPairing(code)).toBe(false);

    const code2 = generatePairingCode("users/2", "Bob");
    expect(approvePairing(code2)).toBeTruthy();

    expect(revokePairing("users/2")).toBe(true);
    expect(revokePairing("users/2")).toBe(false);
    expect(isPaired("users/2")).toBe(false);
  });
});
