import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock auth module with an in-memory config store
// ---------------------------------------------------------------------------

const configStore = new Map<string, string>();

vi.mock("../../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// Mock global fetch for testTeamsConnection
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const {
  getTeamsSettings,
  updateTeamsSettings,
  testTeamsConnection,
} = await import("../teams-settings.js");

describe("Teams settings", () => {
  beforeEach(() => {
    configStore.clear();
    mockFetch.mockReset();
  });

  // -------------------------------------------------------------------------
  // getTeamsSettings
  // -------------------------------------------------------------------------

  describe("getTeamsSettings", () => {
    it("returns default state when nothing is configured", () => {
      const settings = getTeamsSettings();

      expect(settings).toEqual({
        enabled: false,
        appIdSet: false,
        appPasswordSet: false,
      });
    });

    it("returns enabled: true when teams:enabled is 'true'", () => {
      configStore.set("teams:enabled", "true");

      const settings = getTeamsSettings();
      expect(settings.enabled).toBe(true);
    });

    it("returns enabled: false when teams:enabled is 'false'", () => {
      configStore.set("teams:enabled", "false");

      const settings = getTeamsSettings();
      expect(settings.enabled).toBe(false);
    });

    it("reports appIdSet when app_id is configured", () => {
      configStore.set("teams:app_id", "some-app-id");

      const settings = getTeamsSettings();
      expect(settings.appIdSet).toBe(true);
    });

    it("reports appPasswordSet when app_password is configured", () => {
      configStore.set("teams:app_password", "some-password");

      const settings = getTeamsSettings();
      expect(settings.appPasswordSet).toBe(true);
    });

    it("returns full configured state", () => {
      configStore.set("teams:enabled", "true");
      configStore.set("teams:app_id", "my-id");
      configStore.set("teams:app_password", "my-pass");

      const settings = getTeamsSettings();
      expect(settings).toEqual({
        enabled: true,
        appIdSet: true,
        appPasswordSet: true,
      });
    });
  });

  // -------------------------------------------------------------------------
  // updateTeamsSettings
  // -------------------------------------------------------------------------

  describe("updateTeamsSettings", () => {
    it("sets enabled to true", () => {
      updateTeamsSettings({ enabled: true });

      expect(configStore.get("teams:enabled")).toBe("true");
    });

    it("sets enabled to false", () => {
      updateTeamsSettings({ enabled: false });

      expect(configStore.get("teams:enabled")).toBe("false");
    });

    it("sets appId", () => {
      updateTeamsSettings({ appId: "new-app-id" });

      expect(configStore.get("teams:app_id")).toBe("new-app-id");
    });

    it("deletes appId when set to empty string", () => {
      configStore.set("teams:app_id", "old-id");

      updateTeamsSettings({ appId: "" });

      expect(configStore.has("teams:app_id")).toBe(false);
    });

    it("sets appPassword", () => {
      updateTeamsSettings({ appPassword: "new-password" });

      expect(configStore.get("teams:app_password")).toBe("new-password");
    });

    it("deletes appPassword when set to empty string", () => {
      configStore.set("teams:app_password", "old-pass");

      updateTeamsSettings({ appPassword: "" });

      expect(configStore.has("teams:app_password")).toBe(false);
    });

    it("updates multiple fields at once", () => {
      updateTeamsSettings({
        enabled: true,
        appId: "id-123",
        appPassword: "pass-456",
      });

      expect(configStore.get("teams:enabled")).toBe("true");
      expect(configStore.get("teams:app_id")).toBe("id-123");
      expect(configStore.get("teams:app_password")).toBe("pass-456");
    });

    it("skips undefined fields", () => {
      configStore.set("teams:enabled", "true");
      configStore.set("teams:app_id", "existing-id");

      updateTeamsSettings({ appPassword: "new-pass" });

      // Existing values should not change
      expect(configStore.get("teams:enabled")).toBe("true");
      expect(configStore.get("teams:app_id")).toBe("existing-id");
      expect(configStore.get("teams:app_password")).toBe("new-pass");
    });

    it("handles empty update object", () => {
      configStore.set("teams:enabled", "true");

      updateTeamsSettings({});

      expect(configStore.get("teams:enabled")).toBe("true");
    });
  });

  // -------------------------------------------------------------------------
  // testTeamsConnection
  // -------------------------------------------------------------------------

  describe("testTeamsConnection", () => {
    it("returns error when app_id is missing", async () => {
      configStore.set("teams:app_password", "some-pass");

      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("App ID");
    });

    it("returns error when app_password is missing", async () => {
      configStore.set("teams:app_id", "some-id");

      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("App Password");
    });

    it("returns error when both credentials are missing", async () => {
      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("returns ok when token endpoint responds successfully", async () => {
      configStore.set("teams:app_id", "valid-id");
      configStore.set("teams:app_password", "valid-pass");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token-123" }),
      });

      const result = await testTeamsConnection();

      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("sends correct credentials to Bot Framework token endpoint", async () => {
      configStore.set("teams:app_id", "my-app-id");
      configStore.set("teams:app_password", "my-secret");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "t" }),
      });

      await testTeamsConnection();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }),
      );

      // Verify the body contains expected parameters
      const callArgs = mockFetch.mock.calls[0]!;
      const body = callArgs[1].body as string;
      expect(body).toContain("client_id=my-app-id");
      expect(body).toContain("client_secret=my-secret");
      expect(body).toContain("grant_type=client_credentials");
      expect(body).toContain("scope=https%3A%2F%2Fapi.botframework.com%2F.default");
    });

    it("returns error when token endpoint responds with failure", async () => {
      configStore.set("teams:app_id", "bad-id");
      configStore.set("teams:app_password", "bad-pass");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => "invalid_client: The client does not exist",
      });

      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Authentication failed");
    });

    it("returns error when network request fails", async () => {
      configStore.set("teams:app_id", "valid-id");
      configStore.set("teams:app_password", "valid-pass");

      mockFetch.mockRejectedValueOnce(new Error("Network timeout"));

      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Network timeout");
    });

    it("handles non-Error exceptions", async () => {
      configStore.set("teams:app_id", "valid-id");
      configStore.set("teams:app_password", "valid-pass");

      mockFetch.mockRejectedValueOnce("string error");

      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Unknown error");
    });
  });
});
