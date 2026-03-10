import { describe, it, expect } from "vitest";
import {
  parseChannelConfigs,
  serializeChannelConfigs,
  migrateFromLegacy,
  getChannelConfig,
  type ChannelConfig,
} from "../channel-config.js";

describe("channel-config", () => {
  // ─── parseChannelConfigs ─────────────────────────────────────────────

  describe("parseChannelConfigs", () => {
    it("returns empty array for undefined", () => {
      expect(parseChannelConfigs(undefined)).toEqual([]);
    });

    it("returns empty array for empty string", () => {
      expect(parseChannelConfigs("")).toEqual([]);
    });

    it("returns empty array for invalid JSON", () => {
      expect(parseChannelConfigs("{not json")).toEqual([]);
    });

    it("returns empty array for non-array JSON", () => {
      expect(parseChannelConfigs('{"foo": "bar"}')).toEqual([]);
    });

    it("parses valid channel configs", () => {
      const configs: ChannelConfig[] = [
        {
          channelId: "123",
          name: "help",
          type: "forum",
          responseMode: "auto",
          enabled: true,
        },
        {
          channelId: "456",
          name: "announcements",
          type: "announcement",
          responseMode: "announce",
          enabled: true,
        },
      ];
      const result = parseChannelConfigs(JSON.stringify(configs));
      expect(result).toEqual(configs);
    });

    it("filters out invalid entries", () => {
      const input = JSON.stringify([
        { channelId: "123", name: "valid", type: "text", responseMode: "auto", enabled: true },
        { name: "missing-id" },
        { channelId: "456" },
        "not an object",
        null,
      ]);
      const result = parseChannelConfigs(input);
      expect(result).toHaveLength(1);
      expect(result[0].channelId).toBe("123");
    });
  });

  // ─── serializeChannelConfigs ─────────────────────────────────────────

  describe("serializeChannelConfigs", () => {
    it("serializes configs to JSON", () => {
      const configs: ChannelConfig[] = [
        { channelId: "123", name: "test", type: "forum", responseMode: "auto", enabled: true },
      ];
      const result = serializeChannelConfigs(configs);
      expect(JSON.parse(result)).toEqual(configs);
    });

    it("serializes empty array", () => {
      expect(serializeChannelConfigs([])).toBe("[]");
    });
  });

  // ─── migrateFromLegacy ───────────────────────────────────────────────

  describe("migrateFromLegacy", () => {
    it("migrates comma-separated IDs with global mode", () => {
      const result = migrateFromLegacy("111,222,333", "mention");
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        channelId: "111",
        name: "Channel 111",
        type: "forum",
        responseMode: "mention",
        enabled: true,
      });
      expect(result[1].channelId).toBe("222");
      expect(result[2].channelId).toBe("333");
    });

    it("defaults to auto mode when empty string", () => {
      const result = migrateFromLegacy("123", "");
      expect(result[0].responseMode).toBe("auto");
    });

    it("handles whitespace in IDs", () => {
      const result = migrateFromLegacy(" 111 , 222 , ", "auto");
      expect(result).toHaveLength(2);
      expect(result[0].channelId).toBe("111");
      expect(result[1].channelId).toBe("222");
    });

    it("returns empty array for empty IDs", () => {
      const result = migrateFromLegacy("", "auto");
      expect(result).toEqual([]);
    });
  });

  // ─── getChannelConfig ────────────────────────────────────────────────

  describe("getChannelConfig", () => {
    const configs: ChannelConfig[] = [
      { channelId: "111", name: "help", type: "forum", responseMode: "auto", enabled: true },
      { channelId: "222", name: "general", type: "text", responseMode: "mention", enabled: false },
    ];

    it("finds a channel by ID", () => {
      const result = getChannelConfig(configs, "222");
      expect(result).toBeDefined();
      expect(result!.name).toBe("general");
    });

    it("returns undefined for unknown ID", () => {
      expect(getChannelConfig(configs, "999")).toBeUndefined();
    });

    it("returns undefined for empty configs", () => {
      expect(getChannelConfig([], "111")).toBeUndefined();
    });
  });

  // ─── Round-trip ──────────────────────────────────────────────────────

  describe("round-trip", () => {
    it("serialize then parse preserves data", () => {
      const configs: ChannelConfig[] = [
        { channelId: "123", name: "forum-help", type: "forum", responseMode: "new_threads", enabled: true },
        { channelId: "456", name: "releases", type: "announcement", responseMode: "announce", enabled: false },
      ];
      const serialized = serializeChannelConfigs(configs);
      const parsed = parseChannelConfigs(serialized);
      expect(parsed).toEqual(configs);
    });

    it("migrate then serialize then parse preserves data", () => {
      const migrated = migrateFromLegacy("111,222", "auto");
      const serialized = serializeChannelConfigs(migrated);
      const parsed = parseChannelConfigs(serialized);
      expect(parsed).toEqual(migrated);
    });
  });
});
