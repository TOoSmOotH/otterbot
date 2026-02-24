import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const configStore = new Map<string, string>();

vi.mock("../auth/auth.js", () => ({
  getConfig: vi.fn((key: string) => configStore.get(key)),
  setConfig: vi.fn((key: string, value: string) => configStore.set(key, value)),
  deleteConfig: vi.fn((key: string) => configStore.delete(key)),
}));

// Mock the pairing module so settings tests don't need the database
vi.mock("./pairing.js", () => ({
  listPairedUsers: vi.fn(() => []),
  listPendingPairings: vi.fn(() => []),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TeamsSettings", () => {
  beforeEach(() => {
    configStore.clear();
    vi.clearAllMocks();
  });

  async function loadModule() {
    return await import("./teams-settings.js");
  }

  describe("getTeamsSettings", () => {
    it("returns disabled state when nothing is configured", async () => {
      const { getTeamsSettings } = await loadModule();
      const settings = getTeamsSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.appIdSet).toBe(false);
      expect(settings.appPasswordSet).toBe(false);
      expect(settings.tenantId).toBeNull();
    });

    it("reflects configured values", async () => {
      configStore.set("teams:enabled", "true");
      configStore.set("teams:app_id", "my-app-id");
      configStore.set("teams:app_password", "my-secret");
      configStore.set("teams:tenant_id", "my-tenant");

      const { getTeamsSettings } = await loadModule();
      const settings = getTeamsSettings();

      expect(settings.enabled).toBe(true);
      expect(settings.appIdSet).toBe(true);
      expect(settings.appPasswordSet).toBe(true);
      expect(settings.tenantId).toBe("my-tenant");
    });
  });

  describe("updateTeamsSettings", () => {
    it("stores enabled flag", async () => {
      const { updateTeamsSettings } = await loadModule();
      updateTeamsSettings({ enabled: true });

      expect(configStore.get("teams:enabled")).toBe("true");
    });

    it("stores app credentials", async () => {
      const { updateTeamsSettings } = await loadModule();
      updateTeamsSettings({ appId: "app-123", appPassword: "secret-456" });

      expect(configStore.get("teams:app_id")).toBe("app-123");
      expect(configStore.get("teams:app_password")).toBe("secret-456");
    });

    it("stores tenant ID", async () => {
      const { updateTeamsSettings } = await loadModule();
      updateTeamsSettings({ tenantId: "tenant-789" });

      expect(configStore.get("teams:tenant_id")).toBe("tenant-789");
    });

    it("deletes values when set to empty string", async () => {
      configStore.set("teams:app_id", "old-id");
      configStore.set("teams:app_password", "old-pw");
      configStore.set("teams:tenant_id", "old-tenant");

      const { updateTeamsSettings } = await loadModule();
      updateTeamsSettings({ appId: "", appPassword: "", tenantId: "" });

      expect(configStore.has("teams:app_id")).toBe(false);
      expect(configStore.has("teams:app_password")).toBe(false);
      expect(configStore.has("teams:tenant_id")).toBe(false);
    });
  });

  describe("testTeamsConnection", () => {
    it("returns error when credentials are not set", async () => {
      const { testTeamsConnection } = await loadModule();
      const result = await testTeamsConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("must be configured");
    });
  });
});
