import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../db/index.js";
import { setConfig, getConfig } from "../auth/auth.js";
import {
  generatePairingCode,
  isPaired,
  getPairedUser,
  approvePairing,
  rejectPairing,
  revokePairing,
  listPairedUsers,
  listPendingPairings,
} from "./pairing.js";

describe("bluesky pairing", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-bluesky-pairing-test-"));
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

  it("generates and stores a pending pairing code", () => {
    const code = generatePairingCode("did:plc:alice", "alice.bsky.social");
    expect(code).toMatch(/^[A-F0-9]{6}$/);

    const pending = listPendingPairings();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      code,
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice.bsky.social",
    });
  });

  it("removes an existing pending code for the same did before generating a new one", () => {
    setConfig("bluesky:pairing:OLD123", JSON.stringify({
      code: "OLD123",
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice-old.bsky.social",
      createdAt: new Date().toISOString(),
    }));

    const newCode = generatePairingCode("did:plc:alice", "alice.bsky.social");

    expect(getConfig("bluesky:pairing:OLD123")).toBeUndefined();
    expect(getConfig(`bluesky:pairing:${newCode}`)).toBeTruthy();
    expect(listPendingPairings()).toHaveLength(1);
  });

  it("approves a valid pairing and marks user as paired", () => {
    const code = generatePairingCode("did:plc:alice", "alice.bsky.social");

    const approved = approvePairing(code);

    expect(approved).toMatchObject({
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice.bsky.social",
    });
    expect(isPaired("did:plc:alice")).toBe(true);
    expect(getPairedUser("did:plc:alice")).toMatchObject({
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice.bsky.social",
    });
    expect(getConfig(`bluesky:pairing:${code}`)).toBeUndefined();
  });

  it("rejects expired pairing codes and deletes them", () => {
    setConfig("bluesky:pairing:EXPIRE", JSON.stringify({
      code: "EXPIRE",
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice.bsky.social",
      createdAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
    }));

    const approved = approvePairing("EXPIRE");
    expect(approved).toBeNull();
    expect(getConfig("bluesky:pairing:EXPIRE")).toBeUndefined();
  });

  it("rejectPairing and revokePairing return booleans and remove records", () => {
    const code = generatePairingCode("did:plc:alice", "alice.bsky.social");
    expect(rejectPairing(code)).toBe(true);
    expect(rejectPairing(code)).toBe(false);

    const code2 = generatePairingCode("did:plc:alice", "alice.bsky.social");
    expect(approvePairing(code2)).toBeTruthy();
    expect(revokePairing("did:plc:alice")).toBe(true);
    expect(revokePairing("did:plc:alice")).toBe(false);
    expect(isPaired("did:plc:alice")).toBe(false);
  });

  it("lists paired users and filters malformed/expired pending records", () => {
    setConfig("bluesky:paired:did:plc:alice", JSON.stringify({
      blueskyDid: "did:plc:alice",
      blueskyHandle: "alice.bsky.social",
      pairedAt: new Date().toISOString(),
    }));
    setConfig("bluesky:paired:bad", "{bad-json");

    setConfig("bluesky:pairing:VALID1", JSON.stringify({
      code: "VALID1",
      blueskyDid: "did:plc:bob",
      blueskyHandle: "bob.bsky.social",
      createdAt: new Date().toISOString(),
    }));
    setConfig("bluesky:pairing:EXPIRED", JSON.stringify({
      code: "EXPIRED",
      blueskyDid: "did:plc:carol",
      blueskyHandle: "carol.bsky.social",
      createdAt: new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString(),
    }));
    setConfig("bluesky:pairing:BROKEN", "{bad-json");

    const paired = listPairedUsers();
    const pending = listPendingPairings();

    expect(paired).toHaveLength(1);
    expect(paired[0]!.blueskyDid).toBe("did:plc:alice");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.code).toBe("VALID1");
    expect(getConfig("bluesky:pairing:EXPIRED")).toBeUndefined();
  });
});
