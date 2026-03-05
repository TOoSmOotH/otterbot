import { describe, it, expect, beforeEach, vi } from "vitest";

import type { PairedUser, PendingPairing } from "./pairing.js";

const configStore = new Map<string, string>();
const listPairedUsersMock = vi.fn((): PairedUser[] => []);
const listPendingPairingsMock = vi.fn((): PendingPairing[] => []);
const loginMock = vi.fn();
const atpAgentCtorMock = vi.fn();

vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("./pairing.js", () => ({
  listPairedUsers: listPairedUsersMock,
  listPendingPairings: listPendingPairingsMock,
}));

vi.mock("@atproto/api", () => ({
  AtpAgent: class {
    service: string;

    constructor(opts: { service: string }) {
      this.service = opts.service;
      atpAgentCtorMock(opts);
    }

    async login(params: { identifier: string; password: string }) {
      return loginMock(params);
    }
  },
}));

const {
  getBlueskySettings,
  updateBlueskySettings,
  testBlueskyConnection,
} = await import("./bluesky-settings.js");

describe("bluesky-settings", () => {
  beforeEach(() => {
    configStore.clear();
    listPairedUsersMock.mockReset();
    listPendingPairingsMock.mockReset();
    listPairedUsersMock.mockReturnValue([]);
    listPendingPairingsMock.mockReturnValue([]);
    loginMock.mockReset();
    atpAgentCtorMock.mockReset();
  });

  it("returns defaults when configuration is empty", () => {
    expect(getBlueskySettings()).toEqual({
      enabled: false,
      credentialsSet: false,
      handle: null,
      service: "https://bsky.social",
      pairedUsers: [],
      pendingPairings: [],
    });
  });

  it("returns configured values and pairing lists", () => {
    const paired = [{ blueskyDid: "did:plc:alice", blueskyHandle: "alice.bsky.social", pairedAt: "2026-03-05T00:00:00.000Z" }];
    const pending = [{ code: "ABC123", blueskyDid: "did:plc:bob", blueskyHandle: "bob.bsky.social", createdAt: "2026-03-05T00:00:00.000Z" }];
    listPairedUsersMock.mockReturnValue(paired);
    listPendingPairingsMock.mockReturnValue(pending);
    configStore.set("bluesky:enabled", "true");
    configStore.set("bluesky:identifier", "otter.bsky.social");
    configStore.set("bluesky:app_password", "app-pass");
    configStore.set("bluesky:handle", "otter.bsky.social");
    configStore.set("bluesky:service", "https://example.social");

    expect(getBlueskySettings()).toEqual({
      enabled: true,
      credentialsSet: true,
      handle: "otter.bsky.social",
      service: "https://example.social",
      pairedUsers: paired,
      pendingPairings: pending,
    });
  });

  it("updates and clears configuration fields", () => {
    updateBlueskySettings({
      enabled: true,
      identifier: "otter.bsky.social",
      appPassword: "pass",
      service: "https://example.social",
    });

    expect(configStore.get("bluesky:enabled")).toBe("true");
    expect(configStore.get("bluesky:identifier")).toBe("otter.bsky.social");
    expect(configStore.get("bluesky:app_password")).toBe("pass");
    expect(configStore.get("bluesky:service")).toBe("https://example.social");

    configStore.set("bluesky:handle", "otter.bsky.social");
    updateBlueskySettings({
      identifier: "",
      appPassword: "",
      service: "",
    });

    expect(configStore.has("bluesky:identifier")).toBe(false);
    expect(configStore.has("bluesky:handle")).toBe(false);
    expect(configStore.has("bluesky:app_password")).toBe(false);
    expect(configStore.has("bluesky:service")).toBe(false);
  });

  it("reports an error when credentials are missing", async () => {
    const result = await testBlueskyConnection();
    expect(result).toEqual({
      ok: false,
      error: "Bluesky credentials not configured.",
    });
    expect(atpAgentCtorMock).not.toHaveBeenCalled();
  });

  it("logs in successfully, returns profile fields, and caches handle", async () => {
    configStore.set("bluesky:identifier", "otter.bsky.social");
    configStore.set("bluesky:app_password", "app-pass");
    configStore.set("bluesky:service", "https://example.social");
    loginMock.mockResolvedValue({
      data: {
        handle: "otter.bsky.social",
        did: "did:plc:otter",
      },
    });

    const result = await testBlueskyConnection();

    expect(atpAgentCtorMock).toHaveBeenCalledWith({ service: "https://example.social" });
    expect(loginMock).toHaveBeenCalledWith({
      identifier: "otter.bsky.social",
      password: "app-pass",
    });
    expect(result.ok).toBe(true);
    expect(result.handle).toBe("otter.bsky.social");
    expect(result.did).toBe("did:plc:otter");
    expect(typeof result.latencyMs).toBe("number");
    expect(configStore.get("bluesky:handle")).toBe("otter.bsky.social");
  });

  it("returns AtpAgent login errors", async () => {
    configStore.set("bluesky:identifier", "otter.bsky.social");
    configStore.set("bluesky:app_password", "app-pass");
    loginMock.mockRejectedValue(new Error("invalid credentials"));

    const result = await testBlueskyConnection();
    expect(result).toEqual({
      ok: false,
      error: "invalid credentials",
    });
  });
});
