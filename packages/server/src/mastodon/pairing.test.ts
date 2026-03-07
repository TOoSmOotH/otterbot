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

describe("mastodon pairing", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-mastodon-pairing-test-"));
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

  it("generates a pairing code and replaces previous code for same user", () => {
    const firstCode = generatePairingCode("u1", "alice");
    const secondCode = generatePairingCode("u1", "alice");

    expect(firstCode).toMatch(/^[A-F0-9]{6}$/);
    expect(secondCode).toMatch(/^[A-F0-9]{6}$/);
    expect(getConfig(`mastodon:pairing:${firstCode}`)).toBeUndefined();
    expect(getConfig(`mastodon:pairing:${secondCode}`)).toBeDefined();
  });

  it("approves valid pairing codes and persists paired user", () => {
    const code = generatePairingCode("u1", "alice");

    const paired = approvePairing(code);

    expect(paired).not.toBeNull();
    expect(paired?.mastodonId).toBe("u1");
    expect(paired?.mastodonAcct).toBe("alice");
    expect(getConfig(`mastodon:pairing:${code}`)).toBeUndefined();
    expect(isPaired("u1")).toBe(true);
    expect(getPairedUser("u1")?.mastodonAcct).toBe("alice");
  });

  it("rejects expired pairing codes and cleans them up", () => {
    const oldCreatedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    setConfig(
      "mastodon:pairing:EXPIRE1",
      JSON.stringify({
        code: "EXPIRE1",
        mastodonId: "u-expired",
        mastodonAcct: "expired-user",
        createdAt: oldCreatedAt,
      }),
    );

    const approved = approvePairing("EXPIRE1");

    expect(approved).toBeNull();
    expect(getConfig("mastodon:pairing:EXPIRE1")).toBeUndefined();
    expect(isPaired("u-expired")).toBe(false);
  });

  it("lists pending pairings and cleans expired entries", () => {
    const freshCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const oldCreatedAt = new Date(Date.now() - 61 * 60 * 1000).toISOString();

    setConfig(
      "mastodon:pairing:FRESH1",
      JSON.stringify({
        code: "FRESH1",
        mastodonId: "u-fresh",
        mastodonAcct: "fresh-user",
        createdAt: freshCreatedAt,
      }),
    );

    setConfig(
      "mastodon:pairing:EXPIRE2",
      JSON.stringify({
        code: "EXPIRE2",
        mastodonId: "u-expired",
        mastodonAcct: "expired-user",
        createdAt: oldCreatedAt,
      }),
    );

    const pending = listPendingPairings();

    expect(pending).toHaveLength(1);
    expect(pending[0]?.code).toBe("FRESH1");
    expect(getConfig("mastodon:pairing:EXPIRE2")).toBeUndefined();
  });

  it("rejects and revokes pairings", () => {
    const code = generatePairingCode("u1", "alice");

    expect(rejectPairing(code)).toBe(true);
    expect(rejectPairing(code)).toBe(false);

    const nextCode = generatePairingCode("u2", "bob");
    approvePairing(nextCode);

    expect(revokePairing("u2")).toBe(true);
    expect(revokePairing("u2")).toBe(false);
  });

  it("lists only valid paired users", () => {
    const code = generatePairingCode("u1", "alice");
    approvePairing(code);

    setConfig("mastodon:paired:broken", "not-json");

    const paired = listPairedUsers();

    expect(paired).toHaveLength(1);
    expect(paired[0]?.mastodonId).toBe("u1");
  });
});
