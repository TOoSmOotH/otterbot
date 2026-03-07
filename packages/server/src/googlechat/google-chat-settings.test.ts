import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PairedUser, PendingPairing } from "./pairing.js";

const configStore = new Map<string, string>();
const mockListPairedUsers = vi.fn((): PairedUser[] => []);
const mockListPendingPairings = vi.fn((): PendingPairing[] => []);
const mockGetClient = vi.fn();
const mockGoogleAuthConstructor = vi.fn();

vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

vi.mock("./pairing.js", () => ({
  listPairedUsers: () => mockListPairedUsers(),
  listPendingPairings: () => mockListPendingPairings(),
}));

vi.mock("googleapis", () => ({
  google: {
    auth: {
      GoogleAuth: class {
        constructor(config: Record<string, unknown>) {
          mockGoogleAuthConstructor(config);
        }

        getClient = (...args: unknown[]) => mockGetClient(...args);
      },
    },
  },
}));

const {
  getGoogleChatSettings,
  updateGoogleChatSettings,
  testGoogleChatConnection,
} = await import("./google-chat-settings.js");

describe("google-chat-settings", () => {
  beforeEach(() => {
    configStore.clear();
    mockListPairedUsers.mockReset().mockReturnValue([]);
    mockListPendingPairings.mockReset().mockReturnValue([]);
    mockGetClient.mockReset().mockResolvedValue({});
    mockGoogleAuthConstructor.mockReset();
  });

  it("returns defaults when unset", () => {
    const settings = getGoogleChatSettings();

    expect(settings).toEqual({
      enabled: false,
      serviceAccountKeySet: false,
      projectNumber: "",
      pairedUsers: [],
      pendingPairings: [],
    });
  });

  it("returns stored settings and pairing lists", () => {
    configStore.set("googlechat:enabled", "true");
    configStore.set("googlechat:service_account_key", JSON.stringify({ client_email: "a", private_key: "b" }));
    configStore.set("googlechat:project_number", "123456");

    const pairedUsers = [{ googleChatUserId: "users/1", googleChatUsername: "Alice", pairedAt: "2026-03-01T00:00:00.000Z" }];
    const pendingPairings = [{ code: "ABC123", googleChatUserId: "users/2", googleChatUsername: "Bob", createdAt: "2026-03-01T00:00:00.000Z" }];
    mockListPairedUsers.mockReturnValue(pairedUsers);
    mockListPendingPairings.mockReturnValue(pendingPairings);

    const settings = getGoogleChatSettings();

    expect(settings.enabled).toBe(true);
    expect(settings.serviceAccountKeySet).toBe(true);
    expect(settings.projectNumber).toBe("123456");
    expect(settings.pairedUsers).toEqual(pairedUsers);
    expect(settings.pendingPairings).toEqual(pendingPairings);
  });

  it("updates and clears settings fields", () => {
    updateGoogleChatSettings({
      enabled: true,
      serviceAccountKey: "service-key",
      projectNumber: "999999",
    });

    expect(configStore.get("googlechat:enabled")).toBe("true");
    expect(configStore.get("googlechat:service_account_key")).toBe("service-key");
    expect(configStore.get("googlechat:project_number")).toBe("999999");

    updateGoogleChatSettings({
      serviceAccountKey: "",
      projectNumber: "",
    });

    expect(configStore.has("googlechat:service_account_key")).toBe(false);
    expect(configStore.has("googlechat:project_number")).toBe(false);
  });

  it("returns error when service account key is missing", async () => {
    const result = await testGoogleChatConnection();

    expect(result).toEqual({
      ok: false,
      error: "Google Chat service account key must be configured.",
    });
  });

  it("returns error for invalid JSON", async () => {
    configStore.set("googlechat:service_account_key", "{broken");

    const result = await testGoogleChatConnection();

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/JSON|position|Expected/);
  });

  it("returns validation error when key lacks required fields", async () => {
    configStore.set("googlechat:service_account_key", JSON.stringify({ client_email: "bot@example.com" }));

    const result = await testGoogleChatConnection();

    expect(result).toEqual({
      ok: false,
      error: "Service account key is missing client_email or private_key.",
    });
  });

  it("returns ok and configures GoogleAuth for valid credentials", async () => {
    configStore.set("googlechat:service_account_key", JSON.stringify({
      client_email: "bot@example.com",
      private_key: "private-key",
      project_id: "my-project",
    }));

    const result = await testGoogleChatConnection();

    expect(result).toEqual({ ok: true });
    expect(mockGoogleAuthConstructor).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({
        client_email: "bot@example.com",
        private_key: "private-key",
      }),
      scopes: ["https://www.googleapis.com/auth/chat.bot"],
    }));
    expect(mockGetClient).toHaveBeenCalledOnce();
  });

  it("returns auth errors from GoogleAuth client initialization", async () => {
    configStore.set("googlechat:service_account_key", JSON.stringify({
      client_email: "bot@example.com",
      private_key: "private-key",
    }));
    mockGetClient.mockRejectedValue(new Error("invalid key"));

    const result = await testGoogleChatConnection();

    expect(result).toEqual({ ok: false, error: "invalid key" });
  });
});
