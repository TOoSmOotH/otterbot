import { describe, it, expect, beforeEach, vi } from "vitest";

const configStore = new Map<string, string>();

const mockListPairedUsers = vi.fn(() => []);
const mockListPendingPairings = vi.fn(() => []);

const mockVerifyCredentials = vi.fn();

vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("./pairing.js", () => ({
  listPairedUsers: (...args: unknown[]) => mockListPairedUsers(...args),
  listPendingPairings: (...args: unknown[]) => mockListPendingPairings(...args),
}));

vi.mock("masto", () => ({
  createRestAPIClient: vi.fn(() => ({
    v1: {
      accounts: {
        verifyCredentials: (...args: unknown[]) => mockVerifyCredentials(...args),
      },
    },
  })),
}));

const { getMastodonSettings, updateMastodonSettings, testMastodonConnection } = await import("./mastodon-settings.js");

describe("mastodon-settings", () => {
  beforeEach(() => {
    configStore.clear();
    mockListPairedUsers.mockReset().mockReturnValue([]);
    mockListPendingPairings.mockReset().mockReturnValue([]);
    mockVerifyCredentials.mockReset();
  });

  it("returns defaults when unset", () => {
    const settings = getMastodonSettings();

    expect(settings).toEqual({
      enabled: false,
      credentialsSet: false,
      displayName: null,
      acct: null,
      instanceUrl: "https://mastodon.social",
      pairedUsers: [],
      pendingPairings: [],
    });
  });

  it("returns stored settings and pairing state", () => {
    configStore.set("mastodon:enabled", "true");
    configStore.set("mastodon:instance_url", "https://mastodon.example");
    configStore.set("mastodon:access_token", "secret-token");
    configStore.set("mastodon:display_name", "Otter Bot");
    configStore.set("mastodon:acct", "otterbot");

    const pairedUsers = [{ mastodonId: "u1", mastodonAcct: "alice", pairedAt: "2026-03-01T00:00:00.000Z" }];
    const pendingPairings = [{ code: "ABC123", mastodonId: "u2", mastodonAcct: "bob", createdAt: "2026-03-01T00:00:00.000Z" }];
    mockListPairedUsers.mockReturnValue(pairedUsers);
    mockListPendingPairings.mockReturnValue(pendingPairings);

    const settings = getMastodonSettings();

    expect(settings.enabled).toBe(true);
    expect(settings.credentialsSet).toBe(true);
    expect(settings.instanceUrl).toBe("https://mastodon.example");
    expect(settings.displayName).toBe("Otter Bot");
    expect(settings.acct).toBe("otterbot");
    expect(settings.pairedUsers).toEqual(pairedUsers);
    expect(settings.pendingPairings).toEqual(pendingPairings);
  });

  it("updates enabled, instance URL, and token", () => {
    updateMastodonSettings({
      enabled: true,
      instanceUrl: "https://mastodon.example",
      accessToken: "token-123",
    });

    expect(configStore.get("mastodon:enabled")).toBe("true");
    expect(configStore.get("mastodon:instance_url")).toBe("https://mastodon.example");
    expect(configStore.get("mastodon:access_token")).toBe("token-123");
  });

  it("clears URL-related and token fields when empty strings are provided", () => {
    configStore.set("mastodon:instance_url", "https://mastodon.example");
    configStore.set("mastodon:acct", "otterbot");
    configStore.set("mastodon:display_name", "Otter Bot");
    configStore.set("mastodon:access_token", "token-123");

    updateMastodonSettings({
      instanceUrl: "",
      accessToken: "",
    });

    expect(configStore.has("mastodon:instance_url")).toBe(false);
    expect(configStore.has("mastodon:acct")).toBe(false);
    expect(configStore.has("mastodon:display_name")).toBe(false);
    expect(configStore.has("mastodon:access_token")).toBe(false);
  });

  it("returns error when credentials are missing", async () => {
    const result = await testMastodonConnection();

    expect(result).toEqual({
      ok: false,
      error: "Mastodon credentials not configured.",
    });
  });

  it("verifies connection and caches account metadata", async () => {
    configStore.set("mastodon:instance_url", "https://mastodon.example");
    configStore.set("mastodon:access_token", "token-123");

    mockVerifyCredentials.mockResolvedValue({
      id: "acct-id",
      acct: "otterbot",
      displayName: "Otter Bot",
    });

    const result = await testMastodonConnection();

    expect(result.ok).toBe(true);
    expect(result.id).toBe("acct-id");
    expect(result.acct).toBe("otterbot");
    expect(result.displayName).toBe("Otter Bot");
    expect(typeof result.latencyMs).toBe("number");

    expect(configStore.get("mastodon:acct")).toBe("otterbot");
    expect(configStore.get("mastodon:display_name")).toBe("Otter Bot");
  });

  it("returns SDK errors from verification", async () => {
    configStore.set("mastodon:instance_url", "https://mastodon.example");
    configStore.set("mastodon:access_token", "token-123");

    mockVerifyCredentials.mockRejectedValue(new Error("Unauthorized"));

    const result = await testMastodonConnection();

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
  });
});
