import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDb, resetDb } from "../db/index.js";
import { setConfig, getConfig } from "../auth/auth.js";
import {
  getSignalSettings,
  updateSignalSettings,
  testSignalConnection,
} from "./signal-settings.js";

describe("SignalSettings", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-signal-settings-test-"));
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

  describe("getSignalSettings", () => {
    it("returns defaults when nothing is configured", () => {
      const settings = getSignalSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.apiUrl).toBeNull();
      expect(settings.phoneNumber).toBeNull();
      expect(settings.pairedUsers).toEqual([]);
      expect(settings.pendingPairings).toEqual([]);
    });

    it("reflects stored configuration", () => {
      setConfig("signal:enabled", "true");
      setConfig("signal:api_url", "http://localhost:8080");
      setConfig("signal:phone_number", "+15551234567");

      const settings = getSignalSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.apiUrl).toBe("http://localhost:8080");
      expect(settings.phoneNumber).toBe("+15551234567");
    });
  });

  describe("updateSignalSettings", () => {
    it("updates enabled flag", () => {
      updateSignalSettings({ enabled: true });
      expect(getConfig("signal:enabled")).toBe("true");

      updateSignalSettings({ enabled: false });
      expect(getConfig("signal:enabled")).toBe("false");
    });

    it("stores API URL", () => {
      updateSignalSettings({ apiUrl: "http://localhost:8080" });
      expect(getConfig("signal:api_url")).toBe("http://localhost:8080");
    });

    it("clears API URL with empty string", () => {
      setConfig("signal:api_url", "http://localhost:8080");
      updateSignalSettings({ apiUrl: "" });
      expect(getConfig("signal:api_url")).toBeUndefined();
    });

    it("stores phone number", () => {
      updateSignalSettings({ phoneNumber: "+15551234567" });
      expect(getConfig("signal:phone_number")).toBe("+15551234567");
    });

    it("clears phone number with empty string", () => {
      setConfig("signal:phone_number", "+15551234567");
      updateSignalSettings({ phoneNumber: "" });
      expect(getConfig("signal:phone_number")).toBeUndefined();
    });
  });

  describe("testSignalConnection", () => {
    it("returns error when API URL is not set", async () => {
      const result = await testSignalConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("API URL");
    });

    it("returns error when phone number is not set", async () => {
      setConfig("signal:api_url", "http://localhost:8080");
      const result = await testSignalConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("phone number");
    });
  });
});
