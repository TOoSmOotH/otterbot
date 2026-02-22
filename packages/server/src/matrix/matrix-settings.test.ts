import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../db/index.js";
import { setConfig, getConfig } from "../auth/auth.js";
import {
  getMatrixSettings,
  updateMatrixSettings,
  testMatrixConnection,
} from "./matrix-settings.js";

describe("MatrixSettings", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-matrix-settings-test-"));
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

  describe("getMatrixSettings", () => {
    it("returns defaults when nothing is configured", () => {
      const settings = getMatrixSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.homeserverUrl).toBeNull();
      expect(settings.accessTokenSet).toBe(false);
      expect(settings.userId).toBeNull();
      expect(settings.allowedRooms).toEqual([]);
      expect(settings.e2eeEnabled).toBe(false);
    });

    it("reflects stored configuration", () => {
      setConfig("matrix:enabled", "true");
      setConfig("matrix:homeserver_url", "https://matrix.example.com");
      setConfig("matrix:access_token", "syt_token123");
      setConfig("matrix:user_id", "@bot:example.com");
      setConfig("matrix:allowed_rooms", JSON.stringify(["!room1:example.com"]));
      setConfig("matrix:e2ee_enabled", "true");

      const settings = getMatrixSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.homeserverUrl).toBe("https://matrix.example.com");
      expect(settings.accessTokenSet).toBe(true);
      expect(settings.userId).toBe("@bot:example.com");
      expect(settings.allowedRooms).toEqual(["!room1:example.com"]);
      expect(settings.e2eeEnabled).toBe(true);
    });
  });

  describe("updateMatrixSettings", () => {
    it("updates enabled flag", () => {
      updateMatrixSettings({ enabled: true });
      expect(getConfig("matrix:enabled")).toBe("true");

      updateMatrixSettings({ enabled: false });
      expect(getConfig("matrix:enabled")).toBe("false");
    });

    it("stores homeserver URL", () => {
      updateMatrixSettings({ homeserverUrl: "https://matrix.org" });
      expect(getConfig("matrix:homeserver_url")).toBe("https://matrix.org");
    });

    it("clears homeserver URL with empty string", () => {
      setConfig("matrix:homeserver_url", "https://matrix.org");
      updateMatrixSettings({ homeserverUrl: "" });
      expect(getConfig("matrix:homeserver_url")).toBeUndefined();
    });

    it("stores access token", () => {
      updateMatrixSettings({ accessToken: "syt_token" });
      expect(getConfig("matrix:access_token")).toBe("syt_token");
    });

    it("clears access token and user_id with empty string", () => {
      setConfig("matrix:access_token", "syt_token");
      setConfig("matrix:user_id", "@bot:example.com");
      updateMatrixSettings({ accessToken: "" });
      expect(getConfig("matrix:access_token")).toBeUndefined();
      expect(getConfig("matrix:user_id")).toBeUndefined();
    });

    it("updates allowed rooms", () => {
      updateMatrixSettings({ allowedRooms: ["!room1:example.com", "!room2:example.com"] });
      const raw = getConfig("matrix:allowed_rooms");
      expect(JSON.parse(raw!)).toEqual(["!room1:example.com", "!room2:example.com"]);
    });

    it("updates e2ee flag", () => {
      updateMatrixSettings({ e2eeEnabled: true });
      expect(getConfig("matrix:e2ee_enabled")).toBe("true");
    });
  });

  describe("testMatrixConnection", () => {
    it("returns error when homeserver URL is not set", async () => {
      const result = await testMatrixConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("homeserver URL");
    });

    it("returns error when access token is not set", async () => {
      setConfig("matrix:homeserver_url", "https://matrix.example.com");
      const result = await testMatrixConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("access token");
    });
  });
});
