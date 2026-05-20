import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuthStore,
  migrateLegacyToken,
  extractToken,
  labelFromUserAgent,
} from "./api-token.js";

let dataDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "otter-auth-"));
  originalEnv = process.env.OTTERBOT_API_TOKEN;
  delete process.env.OTTERBOT_API_TOKEN;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.OTTERBOT_API_TOKEN;
  else process.env.OTTERBOT_API_TOKEN = originalEnv;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("AuthStore — setup mode", () => {
  it("starts in setup mode when no env and no file", () => {
    const store = createAuthStore(dataDir);
    expect(store.mode()).toBe("setup");
    expect(store.hasPassword()).toBe(false);
    expect(store.validateToken("anything")).toBeNull();
  });

  it("rejects short passwords at setup", () => {
    const store = createAuthStore(dataDir);
    const result = store.setupPassword("short", "Test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least/);
  });

  it("setupPassword writes the file and mints a session", () => {
    const store = createAuthStore(dataDir);
    const result = store.setupPassword("correct-horse-battery", "First device");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sessionId).toMatch(/^[0-9a-f]{12}$/);
    expect(existsSync(join(dataDir, ".auth.json"))).toBe(true);
    // File mode is 0600 (owner-only).
    const stats = require("node:fs").statSync(join(dataDir, ".auth.json"));
    // Just check the perms low bits are zero for group/other.
    expect(stats.mode & 0o077).toBe(0);
  });

  it("rejects a second setup after the first", () => {
    const store = createAuthStore(dataDir);
    store.setupPassword("correct-horse-battery", "First");
    const again = store.setupPassword("another-password", "Second");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already/);
  });
});

describe("AuthStore — login + sessions", () => {
  it("login fails before setup", () => {
    const store = createAuthStore(dataDir);
    const result = store.login("anything", "Device");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/setup/);
  });

  it("login mints a new session token after setup", () => {
    const store = createAuthStore(dataDir);
    const setup = store.setupPassword("correct-horse-battery", "First");
    if (!setup.ok) throw new Error("setup failed");
    const login = store.login("correct-horse-battery", "Second device");
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.token).not.toBe(setup.token);
    expect(login.sessionId).not.toBe(setup.sessionId);

    const sessions = store.listSessions(null);
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.label).sort()).toEqual(["First", "Second device"]);
  });

  it("rejects wrong passwords", () => {
    const store = createAuthStore(dataDir);
    store.setupPassword("correct-horse-battery", "First");
    const bad = store.login("wrong-password-here", "Bad");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/invalid/);
  });

  it("validateToken accepts a live session token and rejects junk", () => {
    const store = createAuthStore(dataDir);
    const setup = store.setupPassword("correct-horse-battery", "First");
    if (!setup.ok) throw new Error("setup failed");
    expect(store.validateToken(setup.token)?.sessionId).toBe(setup.sessionId);
    expect(store.validateToken("definitely not a real token")).toBeNull();
    expect(store.validateToken("")).toBeNull();
  });

  it("revokeSession kills the token immediately", () => {
    const store = createAuthStore(dataDir);
    const setup = store.setupPassword("correct-horse-battery", "First");
    if (!setup.ok) throw new Error("setup failed");
    expect(store.revokeSession(setup.sessionId)).toBe(true);
    expect(store.validateToken(setup.token)).toBeNull();
    expect(store.listSessions(null)).toHaveLength(0);
    expect(store.revokeSession(setup.sessionId)).toBe(false);
  });

  it("listSessions marks the current session", () => {
    const store = createAuthStore(dataDir);
    const a = store.setupPassword("correct-horse-battery", "A");
    const b = store.login("correct-horse-battery", "B");
    if (!a.ok || !b.ok) throw new Error("setup/login failed");
    const list = store.listSessions(a.sessionId);
    expect(list.find((s) => s.id === a.sessionId)?.current).toBe(true);
    expect(list.find((s) => s.id === b.sessionId)?.current).toBe(false);
  });

  it("survives a reload by re-reading the file", () => {
    const first = createAuthStore(dataDir);
    const setup = first.setupPassword("correct-horse-battery", "Persistent");
    if (!setup.ok) throw new Error("setup failed");
    const reloaded = createAuthStore(dataDir);
    expect(reloaded.mode()).toBe("password");
    expect(reloaded.validateToken(setup.token)?.sessionId).toBe(setup.sessionId);
  });
});

describe("AuthStore — change password", () => {
  it("rejects when the current password is wrong", () => {
    const store = createAuthStore(dataDir);
    store.setupPassword("correct-horse-battery", "A");
    const r = store.changePassword("wrong-current-x", "brand-new-strong", null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/current/);
  });

  it("rotates the kept session and revokes the rest", () => {
    const store = createAuthStore(dataDir);
    const a = store.setupPassword("correct-horse-battery", "A");
    const b = store.login("correct-horse-battery", "B");
    if (!a.ok || !b.ok) throw new Error("setup/login failed");

    const result = store.changePassword("correct-horse-battery", "brand-new-strong", a.sessionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A's old token no longer works; the new one does.
    expect(store.validateToken(a.token)).toBeNull();
    expect(store.validateToken(result.token)?.sessionId).toBe(a.sessionId);
    // B was revoked.
    expect(store.validateToken(b.token)).toBeNull();
    // Login from now on uses the new password.
    expect(store.login("correct-horse-battery", "x").ok).toBe(false);
    expect(store.login("brand-new-strong", "x").ok).toBe(true);
  });
});

describe("AuthStore — env-pinned mode", () => {
  it("uses the env token directly and rejects setup/login", () => {
    process.env.OTTERBOT_API_TOKEN = "env-pinned-secret";
    const store = createAuthStore(dataDir);
    expect(store.mode()).toBe("env");
    expect(store.hasPassword()).toBe(true);
    expect(store.path()).toBeNull();
    expect(store.validateToken("env-pinned-secret")?.sessionId).toBe("env");
    expect(store.validateToken("anything else")).toBeNull();
    expect(store.setupPassword("password123", "X").ok).toBe(false);
    expect(store.login("password123", "X").ok).toBe(false);
    expect(existsSync(join(dataDir, ".auth.json"))).toBe(false);
  });
});

describe("migrateLegacyToken", () => {
  it("imports the old .api-token contents as the password and deletes the file", () => {
    const legacyPath = join(dataDir, ".api-token");
    writeFileSync(legacyPath, "my-old-password-from-v1\n");
    const store = createAuthStore(dataDir);
    expect(store.mode()).toBe("setup");
    migrateLegacyToken(dataDir, store);
    expect(store.mode()).toBe("password");
    // The legacy file is removed.
    expect(existsSync(legacyPath)).toBe(false);
    // The migrated password works for login.
    const login = store.login("my-old-password-from-v1", "after-migrate");
    expect(login.ok).toBe(true);
  });

  it("does nothing when env is pinned", () => {
    process.env.OTTERBOT_API_TOKEN = "env-pinned-secret";
    const legacyPath = join(dataDir, ".api-token");
    writeFileSync(legacyPath, "ignored-old-password");
    const store = createAuthStore(dataDir);
    migrateLegacyToken(dataDir, store);
    // Legacy file is left alone in env mode.
    expect(existsSync(legacyPath)).toBe(true);
    expect(readFileSync(legacyPath, "utf8")).toBe("ignored-old-password");
  });
});

describe("extractToken", () => {
  it("reads the Authorization header", () => {
    expect(
      extractToken({ headers: { authorization: "Bearer abc123" } })
    ).toBe("abc123");
  });

  it("reads ?token=… from the query", () => {
    expect(extractToken({ headers: {}, query: { token: "from-query" } })).toBe("from-query");
  });

  it("reads the otterbot_token cookie", () => {
    expect(
      extractToken({
        headers: { cookie: "otterbot_token=cookie-value; other=ignored" },
      })
    ).toBe("cookie-value");
  });

  it("returns null when nothing is present", () => {
    expect(extractToken({ headers: {} })).toBeNull();
  });
});

describe("labelFromUserAgent", () => {
  it("identifies common browser/OS combos", () => {
    expect(labelFromUserAgent("Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0")).toMatch(/Chrome on Linux/);
    expect(labelFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1")).toMatch(
      /Safari on macOS/
    );
    expect(labelFromUserAgent(undefined)).toBe("Unknown device");
  });
});
