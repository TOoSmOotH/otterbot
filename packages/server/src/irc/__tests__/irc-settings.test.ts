import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { migrateDb, resetDb } from "../../db/index.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getIrcSettings, updateIrcSettings, getIrcConfig } from "../irc-settings.js";

describe("IRC Settings", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "otterbot-irc-settings-test-"));
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

  describe("getIrcSettings", () => {
    it("returns defaults when nothing is configured", () => {
      const settings = getIrcSettings();
      expect(settings).toEqual({
        enabled: false,
        server: null,
        port: 6667,
        nickname: null,
        channels: [],
        tls: false,
        passwordSet: false,
        pairedUsers: [],
        pendingPairings: [],
      });
    });
  });

  describe("updateIrcSettings", () => {
    it("updates enabled state", () => {
      updateIrcSettings({ enabled: true });
      expect(getIrcSettings().enabled).toBe(true);

      updateIrcSettings({ enabled: false });
      expect(getIrcSettings().enabled).toBe(false);
    });

    it("updates server", () => {
      updateIrcSettings({ server: "irc.example.com" });
      expect(getIrcSettings().server).toBe("irc.example.com");
    });

    it("clears server when set to empty string", () => {
      updateIrcSettings({ server: "irc.example.com" });
      updateIrcSettings({ server: "" });
      expect(getIrcSettings().server).toBeNull();
    });

    it("updates port", () => {
      updateIrcSettings({ port: 6697 });
      expect(getIrcSettings().port).toBe(6697);
    });

    it("updates nickname", () => {
      updateIrcSettings({ nickname: "otterbot" });
      expect(getIrcSettings().nickname).toBe("otterbot");
    });

    it("updates channels", () => {
      updateIrcSettings({ channels: ["#general", "#dev"] });
      expect(getIrcSettings().channels).toEqual(["#general", "#dev"]);
    });

    it("updates TLS setting", () => {
      updateIrcSettings({ tls: true });
      expect(getIrcSettings().tls).toBe(true);
    });

    it("tracks password set state without exposing it", () => {
      updateIrcSettings({ password: "secret" });
      expect(getIrcSettings().passwordSet).toBe(true);

      updateIrcSettings({ password: "" });
      expect(getIrcSettings().passwordSet).toBe(false);
    });
  });

  describe("getIrcConfig", () => {
    it("returns null when not enabled", () => {
      updateIrcSettings({ server: "irc.example.com", nickname: "otterbot" });
      expect(getIrcConfig()).toBeNull();
    });

    it("returns null when server is missing", () => {
      updateIrcSettings({ enabled: true, nickname: "otterbot" });
      expect(getIrcConfig()).toBeNull();
    });

    it("returns null when nickname is missing", () => {
      updateIrcSettings({ enabled: true, server: "irc.example.com" });
      expect(getIrcConfig()).toBeNull();
    });

    it("returns config when fully configured", () => {
      updateIrcSettings({
        enabled: true,
        server: "irc.example.com",
        port: 6697,
        nickname: "otterbot",
        channels: ["#general"],
        tls: true,
        password: "secret",
      });

      const config = getIrcConfig();
      expect(config).toEqual({
        server: "irc.example.com",
        port: 6697,
        nickname: "otterbot",
        channels: ["#general"],
        tls: true,
        password: "secret",
      });
    });
  });
});
